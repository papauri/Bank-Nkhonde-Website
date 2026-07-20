<?php
/**
 * Contribution payment endpoints: list, obligations, record, approve, reject.
 *
 * THIS FILE MOVES REAL MONEY. Every currency value is handled as an integer
 * count of minor units via api/lib/money.php. No float ever touches an amount.
 *
 * THE APP IS A LEDGER, NOT A PAYMENT PROCESSOR. No money moves through it. A
 * member pays OFFLINE (cash / bank transfer / mobile money), uploads a photo of
 * the receipt, and an admin or the treasurer approves or rejects the claim.
 * `approvalStatus` is the real state machine:
 *
 *   record  -> a 'pending' claim. The member's standing does NOT move. A payment
 *              nobody has verified is an assertion, not a fact.
 *   approve -> an admin/treasurer confirms the cash landed. ONLY THEN are the
 *              member's derived flags (seedMoneyPaid, monthlyContributionsCurrent,
 *              eligibleForLoan) recomputed FROM THE LEDGER, in the same
 *              transaction. Those flags decide whether someone may borrow money,
 *              so they are never incremented — always re-derived from the rows.
 *   reject  -> the claim is refused with a recorded reason. Rejected money is
 *              never counted as paid anywhere in this file (see
 *              PAYMENT_SETTLED_STATUSES).
 *
 * Authorization is re-checked server-side on every call via require_role()
 * against the members table. A uid, a role, or an "amount due" in a request body
 * is never an authorization claim and never a source of truth: what a member
 * owes always comes from group_rules, never from the client.
 */

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/session.php';
require_once __DIR__ . '/../lib/money.php';
require_once __DIR__ . '/../../config/database.php';

const PAYMENT_TYPES = ['seed_money', 'monthly_contribution', 'service_fee'];

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'mobile_money'];

// The month ENUM, in calendar order. The index IS the month number.
const PAYMENT_MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

// Money that has been VERIFIED. Only these statuses count as paid, anywhere in
// this file — a 'pending' claim buys no standing and a 'rejected' one buys none
// either, whatever the row's amountPaid happens to read.
const PAYMENT_SETTLED_STATUSES = ['approved', 'completed'];

// Admin-equivalent gate. A treasurer takes the cash in person, so they approve.
const PAYMENT_ADMIN_ROLES = ['admin', 'senior_admin', 'treasurer'];
const PAYMENT_ANY_MEMBER_ROLES = ['member', 'admin', 'senior_admin', 'treasurer'];

if (!function_exists('payment_money_input_to_string')) {
    /**
     * Normalise a JSON-decoded money input into a decimal string for
     * money_to_minor(). A JSON float is formatted to 2dp here — that is a parse
     * of a value we were handed, not arithmetic. No float is used to COMPUTE money.
     */
    function payment_money_input_to_string($value): string
    {
        if (is_int($value)) {
            return (string) $value;
        }
        if (is_float($value)) {
            return sprintf('%.2f', $value);
        }
        if (is_string($value)) {
            return trim($value);
        }
        json_error('Invalid amount.', 422);
    }
}

if (!function_exists('payment_day')) {
    /**
     * Normalise a datetime string to midnight of its calendar day.
     *
     * Whole-day arithmetic is the whole point: dueDate carries whatever time of
     * day the obligation was written, and "today" carries the time the member
     * happens to be looking. Neither should shift the number of days charged.
     *
     * @throws InvalidArgumentException on an unparseable date.
     */
    function payment_day(string $value): DateTimeImmutable
    {
        try {
            $date = new DateTimeImmutable($value);
        } catch (Exception $e) {
            throw new InvalidArgumentException('Invalid date value.');
        }

        return $date->setTime(0, 0, 0);
    }
}

if (!function_exists('payment_fetch_rules')) {
    /**
     * The group's contribution rules, or null when the group has no rules row.
     * This is the ONLY source of truth for what a member owes.
     */
    function payment_fetch_rules(PDO $pdo, string $groupId): ?array
    {
        $stmt = $pdo->prepare(
            'SELECT seedMoneyAmount, seedMoneyDueDate, seedMoneyRequired, '
            . 'seedMoneyAllowPartialPayment, seedMoneyMustBeFullyPaid, '
            . 'monthlyContributionAmount, monthlyContributionDayOfMonth, '
            . 'monthlyContributionRequired, monthlyContributionAllowPartialPayment, '
            . 'serviceFeeAmount, serviceFeeRequired, serviceFeeDueDate, '
            . 'contributionPenaltyType, contributionPenaltyDailyAmount, '
            . 'contributionPenaltyGracePeriodDays '
            . 'FROM group_rules WHERE groupId = :groupId LIMIT 1'
        );
        $stmt->execute([':groupId' => $groupId]);
        $rules = $stmt->fetch();

        return $rules === false ? null : $rules;
    }
}

if (!function_exists('compute_contribution_penalty')) {
    /**
     * Live penalty position for ONE contribution obligation.
     *
     * THE RULE (same engine shape as the loan penalty):
     *   An obligation still in arrears after its grace period accrues a FIXED MWK
     *   AMOUNT PER DAY until the arrears are cleared.
     *
     *     firstChargeable = dueDate + gracePeriodDays
     *     daysCharged     = whole days between firstChargeable and today
     *     accrued         = dailyAmount * MAX(0, daysCharged)
     *
     *   * A fixed cash amount per day — NOT a percentage of the arrears, and not
     *     a one-off charge.
     *   * Zero while inside the grace period.
     *   * Zero once the arrears are cleared: the charge accrues only while money
     *     is actually owed.
     *
     * COMPUTED ON READ. It grows every night and there is no cron in this system,
     * so any persisted running total is stale by morning. Nothing here is stored.
     *
     * @param array|null  $rules        group_rules row, or null when the group has none.
     * @param string|null $dueDate      The obligation's due date; null when unscheduled.
     * @param int         $arrearsMinor What is still owed, in minor units.
     * @param string|null $asOf         Defaults to today.
     *
     * @return array{
     *     dailyAmount:string, gracePeriodDays:int, firstChargeableDay:?string,
     *     daysCharged:int, amountAccrued:string, dueDate:?string, asOf:string
     * }
     *
     * @throws RuntimeException when the group's penalty config cannot be honoured.
     */
    function compute_contribution_penalty(
        ?array $rules,
        ?string $dueDate,
        int $arrearsMinor,
        ?string $asOf = null
    ): array {
        $asOfDay = payment_day($asOf ?? 'now');

        $zero = [
            'dailyAmount' => '0.00',
            'gracePeriodDays' => 0,
            'firstChargeableDay' => null,
            'daysCharged' => 0,
            'amountAccrued' => '0.00',
            'dueDate' => null,
            'asOf' => $asOfDay->format('Y-m-d'),
        ];

        // A group with no rules row has no penalty policy, so there is nothing to
        // charge. Likewise, an obligation with nothing owed, or one that was never
        // given a due date, cannot be late. These are the only paths that return
        // zero WITHOUT consulting the config — every other zero below is an
        // explicitly configured zero.
        if ($rules === null || $arrearsMinor <= 0 || $dueDate === null || trim($dueDate) === '') {
            return $zero;
        }

        $type = (string) ($rules['contributionPenaltyType'] ?? '');

        // Percentage penalties are implemented NOWHERE in this codebase. Guessing
        // at the maths would invent charges against real members, so the engine
        // refuses outright and the handler surfaces it as a 501. It does not fall
        // back to zero: silently charging nothing is as wrong as charging wrongly.
        if ($type === 'percentage') {
            throw new RuntimeException('Percentage contribution penalties are not implemented.');
        }
        if ($type !== 'fixed') {
            throw new RuntimeException('Unknown contribution penalty type in this group\'s rules.');
        }

        $dailyRaw = $rules['contributionPenaltyDailyAmount'] ?? null;

        // Configured 'fixed' but with no daily amount set: the group intended to
        // charge something and has not said how much. Never quietly charge 0.
        if ($dailyRaw === null || $dailyRaw === '') {
            throw new RuntimeException(
                'This group charges a fixed daily contribution penalty but '
                . 'contributionPenaltyDailyAmount is not set.'
            );
        }

        try {
            $dailyMinor = money_to_minor((string) $dailyRaw);
        } catch (InvalidArgumentException $e) {
            throw new RuntimeException('contributionPenaltyDailyAmount is not a valid money value.');
        }

        $graceDays = (int) ($rules['contributionPenaltyGracePeriodDays'] ?? 0);
        if ($graceDays < 0) {
            $graceDays = 0;
        }

        $dueDay = payment_day($dueDate);
        $firstChargeable = $dueDay->modify('+' . $graceDays . ' day');

        // Clamped at zero: inside the grace period nothing is owed. The day the
        // grace expires is day 0 — the first FULL day past it is day 1.
        $daysCharged = $firstChargeable < $asOfDay
            ? (int) $firstChargeable->diff($asOfDay)->days
            : 0;

        return [
            'dailyAmount' => money_from_minor($dailyMinor),
            'gracePeriodDays' => $graceDays,
            'firstChargeableDay' => $firstChargeable->format('Y-m-d'),
            'daysCharged' => $daysCharged,
            'amountAccrued' => money_from_minor($dailyMinor * $daysCharged),
            'dueDate' => $dueDay->format('Y-m-d'),
            'asOf' => $asOfDay->format('Y-m-d'),
        ];
    }
}

if (!function_exists('payment_penalty_or_501')) {
    /**
     * Run the penalty engine, mapping its refusal to a 501. The engine throws
     * rather than guessing when a group's penalty config cannot be honoured
     * (percentage penalties, or 'fixed' with no daily amount) — a wrong charge
     * against a real member is worse than a failed request.
     */
    function payment_penalty_or_501(?array $rules, ?string $dueDate, int $arrearsMinor): array
    {
        try {
            return compute_contribution_penalty($rules, $dueDate, $arrearsMinor);
        } catch (RuntimeException $e) {
            json_error($e->getMessage(), 501);
        }
    }
}

if (!function_exists('payment_rule_amount_minor')) {
    /**
     * What a payment type COSTS, straight from group_rules — never from the
     * client. A client-supplied "what I owe" is not a fact.
     *
     * @return int|null Minor units, or null when the group has not configured it.
     */
    function payment_rule_amount_minor(?array $rules, string $paymentType): ?int
    {
        if ($rules === null) {
            return null;
        }

        $column = [
            'seed_money' => 'seedMoneyAmount',
            'monthly_contribution' => 'monthlyContributionAmount',
            'service_fee' => 'serviceFeeAmount',
        ][$paymentType] ?? null;

        if ($column === null) {
            return null;
        }

        $raw = $rules[$column] ?? null;
        if ($raw === null || trim((string) $raw) === '') {
            return null;
        }

        try {
            return money_to_minor(trim((string) $raw));
        } catch (InvalidArgumentException $e) {
            return null;
        }
    }
}

if (!function_exists('payment_due_date')) {
    /**
     * The due date for an obligation, derived from group_rules.
     *
     * The monthly contribution's date is built from monthlyContributionDayOfMonth,
     * clamped to the length of the month so a "day 31" rule does not overflow
     * February into March. When the group has NOT set a day, the obligation falls
     * due on the LAST day of the month — the most lenient reading. An unset rule
     * must never be turned into an earlier due date, because an earlier due date
     * means a bigger penalty for a member the group never actually charged.
     *
     * @return string|null 'Y-m-d H:i:s', or null when the group set no date.
     */
    function payment_due_date(?array $rules, string $paymentType, ?string $month, int $year): ?string
    {
        if ($rules === null) {
            return null;
        }

        if ($paymentType === 'seed_money') {
            $raw = $rules['seedMoneyDueDate'] ?? null;
            return $raw === null || trim((string) $raw) === '' ? null : (string) $raw;
        }

        if ($paymentType === 'service_fee') {
            $raw = $rules['serviceFeeDueDate'] ?? null;
            return $raw === null || trim((string) $raw) === '' ? null : (string) $raw;
        }

        $monthIndex = array_search((string) $month, PAYMENT_MONTHS, true);
        if ($monthIndex === false) {
            return null;
        }

        $firstOfMonth = payment_day(sprintf('%04d-%02d-01', $year, $monthIndex + 1));
        $daysInMonth = (int) $firstOfMonth->format('t');

        $configured = $rules['monthlyContributionDayOfMonth'] ?? null;
        $day = ($configured === null || trim((string) $configured) === '')
            ? $daysInMonth
            : (int) $configured;

        // Clamp into the month. min() before max() would let a 0 through.
        $day = max(1, min($day, $daysInMonth));

        return $firstOfMonth->setDate($year, $monthIndex + 1, $day)->format('Y-m-d H:i:s');
    }
}

if (!function_exists('payment_settled_minor')) {
    /**
     * How much VERIFIED money a member has put against one obligation.
     *
     * Only approved/completed rows count. A pending claim is an assertion and a
     * rejected one is a refusal; neither buys any standing.
     *
     * Summed row-wise in integer minor units rather than with SQL SUM(): an
     * aggregate comes back as a string of uncertain scale, and coercing it would
     * mean a float touching money.
     */
    function payment_settled_minor(
        PDO $pdo,
        string $groupId,
        string $uid,
        string $paymentType,
        ?int $year = null,
        ?string $month = null
    ): int {
        $sql = 'SELECT amountPaid FROM payments '
            . 'WHERE groupId = :groupId AND uid = :uid AND paymentType = :paymentType '
            . "AND approvalStatus IN ('approved', 'completed')";
        $params = [
            ':groupId' => $groupId,
            ':uid' => $uid,
            ':paymentType' => $paymentType,
        ];

        if ($year !== null) {
            $sql .= ' AND year = :year';
            $params[':year'] = $year;
        }
        if ($month !== null) {
            $sql .= ' AND month = :month';
            $params[':month'] = $month;
        }

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        $settledMinor = 0;
        foreach ($stmt->fetchAll() as $row) {
            $settledMinor += money_to_minor(trim((string) $row['amountPaid']));
        }

        return $settledMinor;
    }
}

if (!function_exists('payment_fetch_row')) {
    /**
     * The existing obligation row for (group, member, type, year, month), or null.
     * month is NULL for everything except a monthly contribution, so the two cases
     * need different SQL — the difference is a literal in text we control, never
     * caller input.
     */
    function payment_fetch_row(
        PDO $pdo,
        string $groupId,
        string $uid,
        string $paymentType,
        int $year,
        ?string $month
    ): ?array {
        $base = 'SELECT * FROM payments '
            . 'WHERE groupId = :groupId AND uid = :uid AND paymentType = :paymentType AND year = :year ';
        $params = [
            ':groupId' => $groupId,
            ':uid' => $uid,
            ':paymentType' => $paymentType,
            ':year' => $year,
        ];

        if ($month === null) {
            $stmt = $pdo->prepare($base . 'AND month IS NULL LIMIT 1');
        } else {
            $stmt = $pdo->prepare($base . 'AND month = :month LIMIT 1');
            $params[':month'] = $month;
        }

        $stmt->execute($params);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }
}

if (!function_exists('payment_fetch_member')) {
    /**
     * A member row in a group, or null. The caller decides whether a missing or
     * inactive member is a 404 or a 409.
     */
    function payment_fetch_member(PDO $pdo, string $groupId, string $uid): ?array
    {
        $stmt = $pdo->prepare(
            'SELECT groupId, uid, fullName, email, role, status, seedMoneyPaid, '
            . 'monthlyContributionsCurrent, eligibleForLoan '
            . 'FROM members WHERE groupId = :groupId AND uid = :uid LIMIT 1'
        );
        $stmt->execute([
            ':groupId' => $groupId,
            ':uid' => $uid,
        ]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }
}

if (!function_exists('payment_recompute_member_flags')) {
    /**
     * Re-derive a member's standing FROM THE LEDGER and write it back.
     *
     * These three flags decide whether someone may borrow the group's money, so
     * they are NEVER incremented and never inferred from the payment being
     * approved. Every one of them is re-derived here with a fresh query against
     * the rows that actually exist. A stale flag lends real cash to someone who
     * has not paid.
     *
     *   seedMoneyPaid  — verified seed money >= the group's seedMoneyAmount.
     *   monthlyContributionsCurrent — no monthly obligation in the current year is
     *                    both past its due date and still unsettled.
     *   eligibleForLoan — both of the above. Strict AND: a group that sets
     *                    seedMoneyMustBeFullyPaid is asking for exactly this, and
     *                    for a group that does not, the strict rule is the one that
     *                    cannot over-lend. Erring toward NOT lending is the only
     *                    safe direction to err in.
     *
     * @return array{seedMoneyPaid:int, monthlyContributionsCurrent:int, eligibleForLoan:int}
     */
    function payment_recompute_member_flags(
        PDO $pdo,
        string $groupId,
        string $uid,
        ?array $rules
    ): array {
        // --- seedMoneyPaid, from the seed_money rows. ---
        $seedRequired = (int) ($rules['seedMoneyRequired'] ?? 0) === 1;
        $seedDueMinor = payment_rule_amount_minor($rules, 'seed_money');

        if (!$seedRequired || $seedDueMinor === null || $seedDueMinor <= 0) {
            // The group asks for no seed money, so there is none outstanding.
            $seedMoneyPaid = 1;
        } else {
            $seedPaidMinor = payment_settled_minor($pdo, $groupId, $uid, 'seed_money');
            $seedMoneyPaid = $seedPaidMinor >= $seedDueMinor ? 1 : 0;
        }

        // --- monthlyContributionsCurrent, from the monthly_contribution rows. ---
        // A row counts as BEHIND when its due date has passed and it is either
        // still in arrears or still awaiting approval. An unverified claim does not
        // make a member current: if a pending row could clear this flag, anyone
        // could unlock a loan by uploading a photo of nothing.
        $behindStmt = $pdo->prepare(
            'SELECT COUNT(*) AS n FROM payments '
            . "WHERE groupId = :groupId AND uid = :uid AND paymentType = 'monthly_contribution' "
            . 'AND year = :year AND dueDate < :today '
            . "AND (arrears > 0 OR approvalStatus IN ('unpaid', 'pending', 'rejected'))"
        );
        $behindStmt->execute([
            ':groupId' => $groupId,
            ':uid' => $uid,
            ':year' => (int) date('Y'),
            ':today' => payment_day('now')->format('Y-m-d H:i:s'),
        ]);
        $monthlyCurrent = (int) $behindStmt->fetch()['n'] === 0 ? 1 : 0;

        $eligible = ($seedMoneyPaid === 1 && $monthlyCurrent === 1) ? 1 : 0;

        $update = $pdo->prepare(
            'UPDATE members SET seedMoneyPaid = :seedMoneyPaid, '
            . 'monthlyContributionsCurrent = :monthlyCurrent, eligibleForLoan = :eligible '
            . 'WHERE groupId = :groupId AND uid = :uid'
        );
        $update->execute([
            ':seedMoneyPaid' => $seedMoneyPaid,
            ':monthlyCurrent' => $monthlyCurrent,
            ':eligible' => $eligible,
            ':groupId' => $groupId,
            ':uid' => $uid,
        ]);

        return [
            'seedMoneyPaid' => $seedMoneyPaid,
            'monthlyContributionsCurrent' => $monthlyCurrent,
            'eligibleForLoan' => $eligible,
        ];
    }
}

if (!function_exists('list_payments')) {
    /**
     * GET payments.list — the group's payment rows, each with its LIVE penalty.
     *
     * A plain member sees ONLY their own rows, and the restriction is applied IN
     * THE SQL. That is an authorization boundary, not a display filter: rows a
     * member may not see are never loaded, so they cannot leak through a response
     * shape, an error, or a later refactor.
     */
    function list_payments(): void
    {
        $groupId = (string) ($_GET['groupId'] ?? '');
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        $caller = require_role($groupId, PAYMENT_ANY_MEMBER_ROLES);

        $sql = 'SELECT * FROM payments WHERE groupId = :groupId';
        $params = [':groupId' => $groupId];

        if (isset($_GET['year']) && $_GET['year'] !== '') {
            $year = (int) $_GET['year'];
            if ($year < 2000 || $year > 2100) {
                json_error('year is not a valid year.', 422);
            }
            $sql .= ' AND year = :year';
            $params[':year'] = $year;
        }

        // THE AUTHORIZATION BOUNDARY. Not a UI filter.
        if ($caller['role'] === 'member') {
            $sql .= ' AND uid = :uid';
            $params[':uid'] = $caller['uid'];
        }

        $sql .= ' ORDER BY year DESC, createdAt DESC';

        $pdo = getDbConnection();
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        $rules = payment_fetch_rules($pdo, $groupId);

        $payments = [];
        $collectedVerifiedMinor = 0;
        $arrearsTotalMinor = 0;
        $penaltyAccruedMinor = 0;
        foreach ($stmt->fetchAll() as $row) {
            $arrearsMinor = money_to_minor(trim((string) $row['arrears']));

            // Computed on read — the charge grows every night and nothing stores it.
            $row['penalty'] = payment_penalty_or_501(
                $rules,
                $row['dueDate'] === null ? null : (string) $row['dueDate'],
                $arrearsMinor
            );

            if (in_array((string) $row['approvalStatus'], ['approved', 'completed'], true)) {
                $collectedVerifiedMinor += money_to_minor(trim((string) $row['amountPaid']));
            }
            $arrearsTotalMinor += $arrearsMinor;
            $penaltyAccruedMinor += money_to_minor(trim((string) $row['penalty']['amountAccrued']));

            $payments[] = $row;
        }

        json_response([
            'payments' => $payments,
            'summary' => [
                'verifiedCollected' => money_from_minor($collectedVerifiedMinor),
                'arrears' => money_from_minor($arrearsTotalMinor),
                'penaltyAccrued' => money_from_minor($penaltyAccruedMinor),
                'totalArrears' => money_from_minor($arrearsTotalMinor + $penaltyAccruedMinor),
            ],
        ]);
    }
}

if (!function_exists('my_obligations')) {
    /**
     * GET payments.obligations — "what do I owe, right now".
     *
     * For the CALLER ONLY. Everything owed is derived from group_rules; the rows
     * only say what has been paid against it. An obligation with no row yet is
     * still an obligation — a member who has never paid owes the full amount, and
     * showing them nothing would be a lie.
     *
     * Paid figures count VERIFIED money only. A pending claim is shown separately
     * so the member can see it is awaiting approval, but it never reduces what
     * they owe until an admin says the cash arrived.
     */
    function my_obligations(): void
    {
        $groupId = (string) ($_GET['groupId'] ?? '');
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        $caller = require_role($groupId, PAYMENT_ANY_MEMBER_ROLES);

        $pdo = getDbConnection();
        $rules = payment_fetch_rules($pdo, $groupId);

        // Defaults to the CALLER's own obligations. An admin/treasurer recording a
        // payment on a member's behalf needs to see what THAT member owes, so an
        // explicit uid is honoured — but ONLY for an admin-equivalent role. A plain
        // member passing someone else's uid is refused, never silently ignored.
        // Same privilege rule as record_payment()'s targetUid.
        $uid = (string) $caller['uid'];
        $requested = $_GET['uid'] ?? null;
        if (is_string($requested) && trim($requested) !== '' && trim($requested) !== (string) $caller['uid']) {
            if (!in_array((string) $caller['role'], PAYMENT_ADMIN_ROLES, true)) {
                json_error('You may only view your own obligations.', 403);
            }
            $uid = trim($requested);
            // The uid must be a real member of THIS group — never an arbitrary uid.
            // payment_fetch_member() returns null (it does not throw), so check it.
            if (payment_fetch_member($pdo, $groupId, $uid) === null) {
                json_error('That member is not in this group.', 404);
            }
        }

        // Defaults to the current year. An explicit year lets an overview page ask
        // "what was outstanding in 2025?" — the obligation figures are derived from
        // the ledger for that year, so a past cycle can be reviewed rather than
        // being invisible. Bounded, like list_payments' year param.
        $year = (int) date('Y');
        if (isset($_GET['year']) && $_GET['year'] !== '') {
            $year = (int) $_GET['year'];
            if ($year < 2000 || $year > 2100) {
                json_error('Invalid year.', 422);
            }
        }

        // --- Seed money. ---
        $seedDueMinor = payment_rule_amount_minor($rules, 'seed_money');
        $seedPaidMinor = payment_settled_minor($pdo, $groupId, $uid, 'seed_money');
        $seedArrearsMinor = $seedDueMinor === null ? 0 : max(0, $seedDueMinor - $seedPaidMinor);
        $seedDueDate = payment_due_date($rules, 'seed_money', null, $year);

        $seed = [
            'required' => (int) ($rules['seedMoneyRequired'] ?? 0) === 1,
            'configured' => $seedDueMinor !== null,
            'totalAmount' => money_from_minor($seedDueMinor ?? 0),
            'amountPaid' => money_from_minor($seedPaidMinor),
            'arrears' => money_from_minor($seedArrearsMinor),
            'dueDate' => $seedDueDate,
            'penalty' => payment_penalty_or_501($rules, $seedDueDate, $seedArrearsMinor),
        ];

        // --- Monthly contributions, month by month across the current year. ---
        $monthlyDueMinor = payment_rule_amount_minor($rules, 'monthly_contribution');
        $months = [];

        foreach (PAYMENT_MONTHS as $month) {
            $paidMinor = payment_settled_minor(
                $pdo,
                $groupId,
                $uid,
                'monthly_contribution',
                $year,
                $month
            );
            $arrearsMinor = $monthlyDueMinor === null ? 0 : max(0, $monthlyDueMinor - $paidMinor);
            $dueDate = payment_due_date($rules, 'monthly_contribution', $month, $year);

            $row = payment_fetch_row($pdo, $groupId, $uid, 'monthly_contribution', $year, $month);

            $months[] = [
                'month' => $month,
                'totalAmount' => money_from_minor($monthlyDueMinor ?? 0),
                'amountPaid' => money_from_minor($paidMinor),
                'arrears' => money_from_minor($arrearsMinor),
                'dueDate' => $dueDate,
                'approvalStatus' => $row === null ? 'unpaid' : (string) $row['approvalStatus'],
                'penalty' => payment_penalty_or_501($rules, $dueDate, $arrearsMinor),
            ];
        }

        // --- Service fee. ---
        $feeRequired = (int) ($rules['serviceFeeRequired'] ?? 0) === 1;
        $serviceFee = null;

        if ($feeRequired) {
            $feeDueMinor = payment_rule_amount_minor($rules, 'service_fee');
            $feePaidMinor = payment_settled_minor($pdo, $groupId, $uid, 'service_fee', $year);
            $feeArrearsMinor = $feeDueMinor === null ? 0 : max(0, $feeDueMinor - $feePaidMinor);
            $feeDueDate = payment_due_date($rules, 'service_fee', null, $year);

            $serviceFee = [
                'required' => true,
                'configured' => $feeDueMinor !== null,
                'totalAmount' => money_from_minor($feeDueMinor ?? 0),
                'amountPaid' => money_from_minor($feePaidMinor),
                'arrears' => money_from_minor($feeArrearsMinor),
                'dueDate' => $feeDueDate,
                'penalty' => payment_penalty_or_501($rules, $feeDueDate, $feeArrearsMinor),
            ];
        }

        $member = payment_fetch_member($pdo, $groupId, $uid);

        // Summary — sums of the SAME per-item figures already computed above
        // (seed money, every month, service fee). No re-fetch, no new query.
        $contributedMinor = $seedPaidMinor;
        $arrearsMinor = $seedArrearsMinor;
        $penaltyAccruedMinor = money_to_minor(trim((string) $seed['penalty']['amountAccrued']));
        foreach ($months as $monthRow) {
            $contributedMinor += money_to_minor(trim((string) $monthRow['amountPaid']));
            $arrearsMinor += money_to_minor(trim((string) $monthRow['arrears']));
            $penaltyAccruedMinor += money_to_minor(trim((string) $monthRow['penalty']['amountAccrued']));
        }
        if ($serviceFee !== null) {
            $contributedMinor += money_to_minor(trim((string) $serviceFee['amountPaid']));
            $arrearsMinor += money_to_minor(trim((string) $serviceFee['arrears']));
            $penaltyAccruedMinor += money_to_minor(trim((string) $serviceFee['penalty']['amountAccrued']));
        }

        json_response([
            'year' => $year,
            'seedMoney' => $seed,
            'monthlyContributions' => [
                'totalAmount' => money_from_minor($monthlyDueMinor ?? 0),
                'configured' => $monthlyDueMinor !== null,
                'required' => (int) ($rules['monthlyContributionRequired'] ?? 0) === 1,
                'months' => $months,
            ],
            'serviceFee' => $serviceFee,
            'standing' => [
                'seedMoneyPaid' => (int) ($member['seedMoneyPaid'] ?? 0) === 1,
                'monthlyContributionsCurrent' => (int) ($member['monthlyContributionsCurrent'] ?? 0) === 1,
                'eligibleForLoan' => (int) ($member['eligibleForLoan'] ?? 0) === 1,
            ],
            'summary' => [
                'contributed' => money_from_minor($contributedMinor),
                'arrears' => money_from_minor($arrearsMinor),
                'penaltyAccrued' => money_from_minor($penaltyAccruedMinor),
            ],
        ]);
    }
}

if (!function_exists('record_payment')) {
    /**
     * POST payments.record — log an offline payment as a PENDING claim.
     *
     * Nothing about the member's standing moves here. The row carries the claim
     * and the receipt; an admin decides whether it is true.
     */
    function record_payment(): void
    {
        $body = read_json_body();

        $groupId = (string) ($body['groupId'] ?? '');
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        $paymentType = (string) ($body['paymentType'] ?? '');
        if (!in_array($paymentType, PAYMENT_TYPES, true)) {
            json_error('paymentType must be one of: seed_money, monthly_contribution, service_fee.', 422);
        }

        $method = (string) ($body['paymentMethod'] ?? '');
        if (!in_array($method, PAYMENT_METHODS, true)) {
            json_error('paymentMethod must be one of: cash, bank_transfer, mobile_money.', 422);
        }

        // month is set ONLY for a monthly contribution, and must be a real month.
        $month = null;
        if ($paymentType === 'monthly_contribution') {
            $month = (string) ($body['month'] ?? '');
            if (!in_array($month, PAYMENT_MONTHS, true)) {
                json_error('month is required for a monthly contribution and must be a calendar month.', 422);
            }
        }

        $year = isset($body['year']) && $body['year'] !== '' ? (int) $body['year'] : (int) date('Y');
        if ($year < 2000 || $year > 2100) {
            json_error('year is not a valid year.', 422);
        }

        $caller = require_role($groupId, PAYMENT_ANY_MEMBER_ROLES);

        // WHO IS THIS PAYMENT FOR? A member may only ever pay for themselves. An
        // admin or treasurer may record one on behalf of a member who handed over
        // cash in person — that, and only that, is what targetUid is for.
        $targetUid = (string) $caller['uid'];
        $onBehalf = false;

        $requested = $body['targetUid'] ?? null;
        if (is_string($requested) && trim($requested) !== '' && trim($requested) !== (string) $caller['uid']) {
            if (!in_array((string) $caller['role'], PAYMENT_ADMIN_ROLES, true)) {
                json_error('You do not have permission to record a payment for another member.', 403);
            }
            $targetUid = trim($requested);
            $onBehalf = true;
        }

        $pdo = getDbConnection();

        $member = payment_fetch_member($pdo, $groupId, $targetUid);
        if ($member === null) {
            json_error('That member is not in this group.', 404);
        }
        if ((string) $member['status'] !== 'active') {
            json_error('That member is not active in this group.', 409);
        }

        try {
            $amountMinor = money_to_minor(payment_money_input_to_string($body['amount'] ?? ''));
        } catch (InvalidArgumentException $e) {
            json_error('amount must be an amount with at most 2 decimals.', 422);
        }

        if ($amountMinor <= 0) {
            json_error('amount must be greater than zero.', 422);
        }

        // WHAT IS OWED COMES FROM THE GROUP'S RULES. A client-supplied "what I owe"
        // is not a fact — it is a number a member typed.
        $rules = payment_fetch_rules($pdo, $groupId);
        $totalMinor = payment_rule_amount_minor($rules, $paymentType);
        if ($totalMinor === null || $totalMinor <= 0) {
            json_error('This group has not configured an amount for this payment type.', 409);
        }

        $dueDate = payment_due_date($rules, $paymentType, $month, $year);

        $existing = payment_fetch_row($pdo, $groupId, $targetUid, $paymentType, $year, $month);

        // ONE un-adjudicated claim at a time per obligation. A second pending claim
        // would aggregate into the same amountPaid as the first, and neither could
        // then be rejected without guessing which money to take back out.
        if ($existing !== null && (string) $existing['approvalStatus'] === 'pending') {
            json_error(
                'A payment for this obligation is already awaiting approval; '
                . 'it must be approved or rejected first.',
                409
            );
        }

        $priorPaidMinor = $existing === null
            ? 0
            : money_to_minor(trim((string) $existing['amountPaid']));

        // A rejected claim was never money. Its amountPaid is inert (nothing in this
        // file counts a rejected row), so a re-submission starts from the VERIFIED
        // position, not from the refused one.
        if ($existing !== null && (string) $existing['approvalStatus'] === 'rejected') {
            $priorPaidMinor = payment_settled_minor(
                $pdo,
                $groupId,
                $targetUid,
                $paymentType,
                $year,
                $month
            );
        }

        $newPaidMinor = $priorPaidMinor + $amountMinor;

        // An overpayment is REFUSED, never silently credited: this system has no
        // concept of a credit balance, and inventing one here would put money on the
        // ledger that no rule knows how to pay back. The single exception is an
        // explicit ADVANCE on the monthly contribution — paying next month early is
        // a thing members really do, and the group's own rules allow for it.
        $isAdvance = !empty($body['isAdvancedPayment']) && $paymentType === 'monthly_contribution';

        if ($newPaidMinor > $totalMinor && !$isAdvance) {
            json_error('Payment exceeds the amount due.', 422);
        }

        $arrearsMinor = max(0, $totalMinor - $newPaidMinor);

        $proofUrl = $body['proofOfPaymentImageUrl'] ?? null;
        $proofUrl = is_string($proofUrl) && trim($proofUrl) !== '' ? trim($proofUrl) : null;
        $proofName = $body['proofOfPaymentFileName'] ?? null;
        $proofName = is_string($proofName) && trim($proofName) !== '' ? trim($proofName) : null;
        $proofSize = isset($body['proofOfPaymentFileSize']) && is_numeric($body['proofOfPaymentFileSize'])
            ? (int) $body['proofOfPaymentFileSize']
            : null;
        $notes = $body['notes'] ?? null;
        $notes = is_string($notes) && trim($notes) !== '' ? trim($notes) : null;

        $now = payment_day('now');
        $proofUploadedAt = $proofUrl === null ? null : date('Y-m-d H:i:s');

        // dueDate is NOT NULL on the row. When the group configured no date for this
        // type, the obligation falls due the day it is recorded — it cannot be late
        // before it exists, and the penalty engine treats an unconfigured obligation
        // as unscheduled anyway.
        $rowDueDate = $dueDate ?? $now->format('Y-m-d H:i:s');

        $pdo->beginTransaction();
        try {
            if ($existing === null) {
                $paymentId = bin2hex(random_bytes(16));

                $insert = $pdo->prepare(
                    'INSERT INTO payments '
                    . '(paymentId, groupId, uid, year, paymentType, month, totalAmount, amountPaid, '
                    . 'arrears, approvalStatus, paymentStatus, proofOfPaymentImageUrl, '
                    . 'proofOfPaymentFileName, proofOfPaymentFileSize, proofOfPaymentUploadedBy, '
                    . 'proofOfPaymentUploadedAt, dueDate, paidAt, createdAt, updatedAt, paymentMethod, '
                    . 'notes, recordedManually, isAdvancedPayment) '
                    . 'VALUES (:paymentId, :groupId, :uid, :year, :paymentType, :month, :totalAmount, '
                    . ":amountPaid, :arrears, 'pending', 'Pending', :proofUrl, :proofName, :proofSize, "
                    . ':proofBy, :proofAt, :dueDate, NOW(), NOW(), NOW(), :paymentMethod, :notes, '
                    . ':recordedManually, :isAdvance)'
                );
                $insert->execute([
                    ':paymentId' => $paymentId,
                    ':groupId' => $groupId,
                    ':uid' => $targetUid,
                    ':year' => $year,
                    ':paymentType' => $paymentType,
                    ':month' => $month,
                    ':totalAmount' => money_from_minor($totalMinor),
                    ':amountPaid' => money_from_minor($newPaidMinor),
                    ':arrears' => money_from_minor($arrearsMinor),
                    ':proofUrl' => $proofUrl,
                    ':proofName' => $proofName,
                    ':proofSize' => $proofSize,
                    ':proofBy' => $proofUrl === null ? null : $caller['uid'],
                    ':proofAt' => $proofUploadedAt,
                    ':dueDate' => $rowDueDate,
                    ':paymentMethod' => $method,
                    ':notes' => $notes,
                    ':recordedManually' => $onBehalf ? 1 : 0,
                    ':isAdvance' => $isAdvance ? 1 : 0,
                ]);
            } else {
                $paymentId = (string) $existing['paymentId'];

                // totalAmount is re-read from the rules every time. If the group
                // changed the contribution amount, the obligation changes with it.
                $update = $pdo->prepare(
                    'UPDATE payments SET totalAmount = :totalAmount, amountPaid = :amountPaid, '
                    . "arrears = :arrears, approvalStatus = 'pending', paymentStatus = 'Pending', "
                    . 'proofOfPaymentImageUrl = COALESCE(:proofUrl, proofOfPaymentImageUrl), '
                    . 'proofOfPaymentFileName = COALESCE(:proofName, proofOfPaymentFileName), '
                    . 'proofOfPaymentFileSize = COALESCE(:proofSize, proofOfPaymentFileSize), '
                    . 'proofOfPaymentUploadedBy = COALESCE(:proofBy, proofOfPaymentUploadedBy), '
                    . 'proofOfPaymentUploadedAt = COALESCE(:proofAt, proofOfPaymentUploadedAt), '
                    . 'dueDate = :dueDate, paidAt = NOW(), updatedAt = NOW(), '
                    . 'paymentMethod = :paymentMethod, notes = :notes, '
                    . 'recordedManually = :recordedManually, isAdvancedPayment = :isAdvance, '
                    . 'rejectionReason = NULL, rejectedBy = NULL, rejectedAt = NULL '
                    . 'WHERE paymentId = :paymentId'
                );
                $update->execute([
                    ':totalAmount' => money_from_minor($totalMinor),
                    ':amountPaid' => money_from_minor($newPaidMinor),
                    ':arrears' => money_from_minor($arrearsMinor),
                    ':proofUrl' => $proofUrl,
                    ':proofName' => $proofName,
                    ':proofSize' => $proofSize,
                    ':proofBy' => $proofUrl === null ? null : $caller['uid'],
                    ':proofAt' => $proofUploadedAt,
                    ':dueDate' => $rowDueDate,
                    ':paymentMethod' => $method,
                    ':notes' => $notes,
                    ':recordedManually' => $onBehalf ? 1 : 0,
                    ':isAdvance' => $isAdvance ? 1 : 0,
                    ':paymentId' => $paymentId,
                ]);
            }

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        $stmt = $pdo->prepare('SELECT * FROM payments WHERE paymentId = :paymentId LIMIT 1');
        $stmt->execute([':paymentId' => $paymentId]);
        $payment = $stmt->fetch();

        json_response([
            'payment' => $payment,
            // The claim is NOT yet money. Say so plainly.
            'awaitingApproval' => true,
            'penalty' => payment_penalty_or_501($rules, $rowDueDate, $arrearsMinor),
        ], 201);
    }
}

if (!function_exists('approve_payment')) {
    /**
     * POST payments.approve — an admin/treasurer confirms the cash landed.
     *
     * This is the moment a claim becomes money. The member's standing is recomputed
     * FROM THE LEDGER in the same transaction, because an approved payment that
     * does not move the member's standing is a corrupt record — they would have
     * paid and still be locked out of a loan.
     */
    function approve_payment(): void
    {
        $body = read_json_body();
        $paymentId = (string) ($body['paymentId'] ?? '');
        if ($paymentId === '') {
            json_error('paymentId is required.', 422);
        }

        $pdo = getDbConnection();

        $stmt = $pdo->prepare('SELECT * FROM payments WHERE paymentId = :paymentId LIMIT 1');
        $stmt->execute([':paymentId' => $paymentId]);
        $payment = $stmt->fetch();

        if ($payment === false) {
            json_error('Payment not found.', 404);
        }

        // The groupId for the gate comes from the ROW, never from the caller.
        $groupId = (string) $payment['groupId'];
        $caller = require_role($groupId, PAYMENT_ADMIN_ROLES);

        if ((string) $payment['approvalStatus'] !== 'pending') {
            json_error('Only a pending payment can be approved.', 409);
        }

        $arrearsMinor = money_to_minor(trim((string) $payment['arrears']));
        $cleared = $arrearsMinor <= 0;

        $rules = payment_fetch_rules($pdo, $groupId);

        $pdo->beginTransaction();
        try {
            $claim = $pdo->prepare(
                'UPDATE payments SET approvalStatus = :approvalStatus, paymentStatus = :paymentStatus, '
                . 'approvedBy = :approvedBy, approvedAt = NOW(), '
                . 'proofOfPaymentVerifiedBy = :verifiedBy, proofOfPaymentVerifiedAt = NOW(), '
                . 'rejectedBy = NULL, rejectedAt = NULL, rejectionReason = NULL, updatedAt = NOW() '
                . "WHERE paymentId = :paymentId AND approvalStatus = 'pending'"
            );
            $claim->execute([
                ':approvalStatus' => $cleared ? 'completed' : 'approved',
                ':paymentStatus' => $cleared ? 'Completed' : 'Pending',
                ':approvedBy' => $caller['uid'],
                ':verifiedBy' => $caller['uid'],
                ':paymentId' => $paymentId,
            ]);

            // Guards a concurrent double-approval: only one caller can win the row,
            // and the loser applies nothing.
            if ($claim->rowCount() !== 1) {
                $pdo->rollBack();
                json_error('Only a pending payment can be approved.', 409);
            }

            // Derived, never incremented. Fresh queries, inside the transaction.
            $flags = payment_recompute_member_flags($pdo, $groupId, (string) $payment['uid'], $rules);

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        $stmt->execute([':paymentId' => $paymentId]);

        json_response([
            'payment' => $stmt->fetch(),
            'member' => $flags,
        ]);
    }
}

if (!function_exists('reject_payment')) {
    /**
     * POST payments.reject — an admin/treasurer refuses a claim, with a reason.
     *
     * ROLLING THE CLAIM BACK OUT
     * --------------------------
     * The payments table stores ONE row per obligation, and record_payment adds a
     * new submission into that row's amountPaid. The row therefore has no record of
     * how much any single submission contributed — only the running total.
     *
     * Two things make the rollback safe anyway:
     *
     *   1. record_payment refuses a second claim while one is still pending, so a
     *      pending row carries at most ONE un-adjudicated submission.
     *   2. The delta is recoverable: the VERIFIED position is re-derived from the
     *      approved/completed rows, and amountPaid is reset to exactly that. The
     *      rejected claim is subtracted by reconstruction, not by guesswork.
     *
     * And the belt-and-braces: nothing in this file ever counts a rejected row as
     * money. Standing, eligibility and obligations are all computed from
     * approved/completed rows only, so even if amountPaid on a rejected row were
     * wrong, it could not lend anyone a tambala.
     */
    function reject_payment(): void
    {
        $body = read_json_body();
        $paymentId = (string) ($body['paymentId'] ?? '');
        $reason = trim((string) ($body['rejectionReason'] ?? ''));

        if ($paymentId === '') {
            json_error('paymentId is required.', 422);
        }
        if ($reason === '') {
            json_error('rejectionReason is required.', 422);
        }

        $pdo = getDbConnection();

        $stmt = $pdo->prepare('SELECT * FROM payments WHERE paymentId = :paymentId LIMIT 1');
        $stmt->execute([':paymentId' => $paymentId]);
        $payment = $stmt->fetch();

        if ($payment === false) {
            json_error('Payment not found.', 404);
        }

        // The groupId for the gate comes from the ROW, never from the caller.
        $groupId = (string) $payment['groupId'];
        $caller = require_role($groupId, PAYMENT_ADMIN_ROLES);

        if ((string) $payment['approvalStatus'] !== 'pending') {
            json_error('Only a pending payment can be rejected.', 409);
        }

        $uid = (string) $payment['uid'];
        $paymentType = (string) $payment['paymentType'];
        $year = (int) $payment['year'];
        $month = $payment['month'] === null ? null : (string) $payment['month'];

        $totalMinor = money_to_minor(trim((string) $payment['totalAmount']));

        // The VERIFIED position, re-derived from the ledger. This row is pending, so
        // it contributes nothing to it — which is precisely what makes it the
        // amountPaid the row must fall back to.
        $settledMinor = payment_settled_minor($pdo, $groupId, $uid, $paymentType, $year, $month);
        $arrearsMinor = max(0, $totalMinor - $settledMinor);

        $rules = payment_fetch_rules($pdo, $groupId);

        $pdo->beginTransaction();
        try {
            $claim = $pdo->prepare(
                "UPDATE payments SET approvalStatus = 'rejected', paymentStatus = 'Pending', "
                . 'amountPaid = :amountPaid, arrears = :arrears, '
                . 'rejectedBy = :rejectedBy, rejectedAt = NOW(), rejectionReason = :reason, '
                . 'updatedAt = NOW() '
                . "WHERE paymentId = :paymentId AND approvalStatus = 'pending'"
            );
            $claim->execute([
                ':amountPaid' => money_from_minor($settledMinor),
                ':arrears' => money_from_minor($arrearsMinor),
                ':rejectedBy' => $caller['uid'],
                ':reason' => $reason,
                ':paymentId' => $paymentId,
            ]);

            // Same guard as approve: a concurrent adjudication loses safely rather
            // than rolling the claim out twice.
            if ($claim->rowCount() !== 1) {
                $pdo->rollBack();
                json_error('Only a pending payment can be rejected.', 409);
            }

            // The claim is gone, so the member's standing may have changed — a
            // rejected contribution can put them back into arrears, and back out of
            // loan eligibility.
            $flags = payment_recompute_member_flags($pdo, $groupId, $uid, $rules);

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        $stmt->execute([':paymentId' => $paymentId]);

        json_response([
            'payment' => $stmt->fetch(),
            'member' => $flags,
        ]);
    }
}
