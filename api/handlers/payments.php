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
require_once __DIR__ . '/../lib/penalty.php';
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

// Flow figures group_accounting_summary() exposes a period drill-down for
// (J3 slice 1). outstandingLoanPrincipal / penaltiesOutstanding /
// penaltiesCharged / cashPosition / penaltiesCollected / penaltiesWaived are
// point-in-time or derived facts, not a sum-over-a-period flow, so they are
// deliberately NOT here — later slices, if ever.
const PAYMENT_ACCOUNTING_DRILL_FIGURES = [
    'totalContributed', 'totalDisbursed', 'loanRepaymentsReceived', 'interestEarned',
];

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
            . 'contributionPenaltyGracePeriodDays, contributionPenaltyDailyRate, '
            . 'contributionPenaltyMonthlyRate, contributionPenaltyMonthlyAmount, '
            . 'contributionPenaltyPeriod, '
            // The cycle window bounds the obligation clock
            // (payment_cycle_months_to_date): a month before the group's cycle
            // started was never owed. Omitting these columns does not fail
            // loudly — it silently bills the whole calendar year.
            . 'cycleDurationStartDate, cycleDurationEndDate, cycleDurationMonths '
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
     * THE RULE — two configured modes, sharing one grace/accrual shape:
     *
     *   firstChargeable = dueDate + gracePeriodDays   (both modes)
     *
     *   'fixed'      A flat MWK amount per day late:
     *                  accrued = dailyAmount * MAX(0, daysCharged)
     *
     *   'percentage' A percentage OF THE FULL OBLIGATION per elapsed period:
     *                  accrued = obligation * rate% * periodsCharged
     *                DELIBERATE OWNER DECISION (BL-6(b)): the percentage basis is
     *                the obligation's FULL amount (what the payment type costs per
     *                group_rules), NOT the member's remaining arrears. Do not
     *                "simplify" this back to arrears — a member who has paid down
     *                most of an obligation still owes the same percentage charge
     *                on the full amount that was due, by design. Whether a
     *                penalty applies at all is unaffected: that gate is still
     *                "is anything still owed and late" ($arrearsMinor <= 0 below).
     *                The PERIOD is the group's explicit contributionPenaltyPeriod
     *                selector ('day' uses contributionPenaltyDailyRate +
     *                daysCharged; 'month' uses contributionPenaltyMonthlyRate +
     *                whole elapsed months) — no more inferring the period from
     *                which rate happens to be non-zero.
     *                The arithmetic is integer-only, using the same
     *                rate-in-hundredths / divide-by-10000 / round-half-up
     *                convention as compute_loan_schedule()'s interest.
     *
     *   Both modes:
     *   * Zero while inside the grace period.
     *   * Zero once the arrears are cleared: the charge accrues only while money
     *     is actually owed.
     *   * A mode configured with no amount/rate THROWS rather than charging
     *     zero — silently charging nothing is as wrong as charging wrongly.
     *
     * COMPUTED ON READ. It grows every night and there is no cron in this system,
     * so any persisted running total is stale by morning. Only SETTLED penalties
     * — paid or waived — are persisted (in penalty_settlements, paymentId-scoped),
     * because a settlement is a fact that has stopped accruing. This mirrors
     * compute_loan_penalty()'s loanId-scoped netting exactly.
     *
     * @param array|null  $rules          group_rules row, or null when the group has none.
     * @param string|null $dueDate        The obligation's due date; null when unscheduled.
     * @param int         $arrearsMinor   What is still owed, in minor units. Still
     *                                    the gate for WHETHER a penalty applies.
     * @param int         $obligationMinor The obligation's FULL amount (the payment
     *                                    type's rule cost), in minor units. THE
     *                                    PERCENTAGE BASIS (BL-6(b)) — required, no
     *                                    fallback, so a missed call site fails
     *                                    loudly rather than silently charging on
     *                                    arrears.
     * @param string|null $paymentId      The obligation's payments row id, when one
     *                                    exists, so already-settled amounts can be
     *                                    netted off. Null when no row exists yet
     *                                    (an obligation never claimed has nothing to
     *                                    net against, and amountOutstanding equals
     *                                    amountAccrued).
     * @param string|null $asOf           Defaults to today.
     *
     * @return array{
     *     dailyAmount:string, gracePeriodDays:int, firstChargeableDay:?string,
     *     daysCharged:int, amountAccrued:string, amountSettled:string,
     *     amountOutstanding:string, dueDate:?string, asOf:string
     * }
     *
     * @throws RuntimeException when the group's penalty config cannot be honoured.
     */
    function compute_contribution_penalty(
        ?array $rules,
        ?string $dueDate,
        int $arrearsMinor,
        int $obligationMinor,
        ?string $paymentId = null,
        ?string $asOf = null
    ): array {
        $asOfDay = payment_day($asOf ?? 'now');

        $zero = [
            'penaltyType' => null,
            'rate' => null,
            'ratePeriod' => null,
            'penaltyPeriod' => null,
            'periodsCharged' => 0,
            'dailyAmount' => '0.00',
            'gracePeriodDays' => 0,
            'firstChargeableDay' => null,
            'daysCharged' => 0,
            'amountAccrued' => '0.00',
            'amountSettled' => '0.00',
            'amountOutstanding' => '0.00',
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

        if ($type !== 'fixed' && $type !== 'percentage') {
            throw new RuntimeException('Unknown contribution penalty type in this group\'s rules.');
        }

        // Grace + first chargeable day are identical for both modes.
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

        // WHOLE elapsed months only — a member is not charged a further month
        // until that month has actually passed. Computed unconditionally (not
        // just for percentage/month) so fixed/month and percentage/month share
        // the identical months-elapsed arithmetic.
        $monthsDiff = $firstChargeable->diff($asOfDay);
        $monthsElapsed = $firstChargeable < $asOfDay
            ? ($monthsDiff->y * 12) + $monthsDiff->m
            : 0;

        // THE EXPLICIT PERIOD SELECTOR. Which cadence applies is read straight
        // from the group's own contributionPenaltyPeriod choice — no more
        // inferring it from which rate/amount happens to be non-zero. Unset or
        // unrecognised values fall back to 'day', which is both the column's own
        // schema DEFAULT and the only cadence that existed before this column
        // was introduced, so a group that never touched this setting sees no
        // change in behaviour.
        $period = (string) ($rules['contributionPenaltyPeriod'] ?? 'day');
        if ($period !== 'day' && $period !== 'month') {
            $period = 'day';
        }
        $periodsCharged = $period === 'month' ? $monthsElapsed : $daysCharged;

        // Defaults for the fields that only one mode populates, so the return
        // contract below is identical in shape for both.
        $dailyMinor = 0;
        $rateUsed = null;
        $ratePeriod = null;

        if ($type === 'fixed') {
            if ($period === 'month') {
                // FIXED/MONTH. New sub-mode this slice — a flat MWK amount per
                // WHOLE elapsed month late, the month analogue of fixed/day.
                $monthlyRaw = $rules['contributionPenaltyMonthlyAmount'] ?? null;

                // Configured 'fixed' + period 'month' but with no monthly amount
                // set: the group intended to charge something and has not said
                // how much. Never quietly charge 0.
                if ($monthlyRaw === null || $monthlyRaw === '') {
                    throw new RuntimeException(
                        'This group charges a fixed monthly contribution penalty but '
                        . 'contributionPenaltyMonthlyAmount is not set.'
                    );
                }

                try {
                    $dailyMinor = money_to_minor((string) $monthlyRaw);
                } catch (InvalidArgumentException $e) {
                    throw new RuntimeException('contributionPenaltyMonthlyAmount is not a valid money value.');
                }

                $accruedMinor = $dailyMinor * $periodsCharged;
            } else {
                // FIXED/DAY. BYTE-IDENTICAL to this engine's behaviour before this
                // slice: a flat MWK amount per day late. Do not restructure.
                $dailyRaw = $rules['contributionPenaltyDailyAmount'] ?? null;

                // Configured 'fixed' but with no daily amount set: the group intended
                // to charge something and has not said how much. Never quietly
                // charge 0.
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

                $accruedMinor = $dailyMinor * $daysCharged;
            }
        } else {
            // PERCENTAGE MODE.
            //
            // DELIBERATE OWNER DECISION (BL-6(b)) — see the docblock above. The
            // basis is the obligation's FULL amount, not the member's remaining
            // arrears. Do not "simplify" this back to $arrearsMinor.
            //
            //     accrued = obligation x rate% x periodsCharged
            //
            // WHICH RATE: selected by the SAME explicit contributionPenaltyPeriod
            // choice used above — 'day' uses contributionPenaltyDailyRate,
            // 'month' uses contributionPenaltyMonthlyRate. They are never
            // combined — charging both would bill the same lateness twice.
            $rateColumn = $period === 'month' ? 'contributionPenaltyMonthlyRate' : 'contributionPenaltyDailyRate';
            $rateRaw = trim((string) ($rules[$rateColumn] ?? ''));

            // Configured 'percentage' with no usable rate for the configured
            // period: same reasoning as the fixed branch — the group meant to
            // charge and hasn't said how much, so refuse rather than silently
            // charge nothing.
            if ($rateRaw === '') {
                throw new RuntimeException(
                    "This group charges a percentage contribution penalty per {$period} but "
                    . "{$rateColumn} is not set."
                );
            }

            try {
                $rateHundredths = money_rate_to_hundredths($rateRaw);
            } catch (InvalidArgumentException $e) {
                throw new RuntimeException('The contribution penalty rate is not a valid percentage.');
            }

            if ($rateHundredths <= 0) {
                throw new RuntimeException(
                    "This group charges a percentage contribution penalty per {$period} but "
                    . "{$rateColumn} is not set."
                );
            }

            $rateUsed = $rateRaw;
            $ratePeriod = $period;

            // Integer-only, exactly the convention compute_loan_schedule() uses
            // for interest: rate carried in hundredths of a percent, so the
            // divisor is 100 (percent) x 100 (hundredths) = 10000, with one
            // half-up rounding at the very end. No float ever touches money.
            // BL-6(b): $obligationMinor, NOT $arrearsMinor, is the basis.
            $accruedMinor = money_div_round_half_up(
                $obligationMinor * $rateHundredths * $periodsCharged,
                10000
            );
        }

        // Penalties already settled against this payment — paid or waived — have
        // stopped accruing and are facts on the ledger. Netting them off is what
        // stops a member being charged twice for the same overdue days, and is
        // what makes a waiver actually stick on the next read.
        // Summed row-wise in integer minor units, same reasoning as
        // compute_loan_penalty(): an aggregate SQL SUM() comes back as a string of
        // uncertain scale, and coercing it would mean a float touching money.
        // There are only a handful of settlement rows per payment, so the
        // row-wise sum is exact and cheap. No settlement rows can exist without a
        // paymentId (the column doesn't exist until a claim is recorded), so a
        // null paymentId skips the query rather than running it for nothing.
        $settledMinor = 0;
        if ($paymentId !== null && $paymentId !== '') {
            $pdo = getDbConnection();
            $settledStmt = $pdo->prepare(
                'SELECT amountPaid, amountWaived FROM penalty_settlements WHERE paymentId = :paymentId'
            );
            $settledStmt->execute([':paymentId' => $paymentId]);
            foreach ($settledStmt->fetchAll() as $row) {
                $settledMinor += money_to_minor(trim((string) $row['amountPaid']));
                $settledMinor += money_to_minor(trim((string) $row['amountWaived']));
            }
        }

        $outstandingMinor = $accruedMinor - $settledMinor;
        if ($outstandingMinor < 0) {
            $outstandingMinor = 0;
        }

        return [
            // penaltyType/rate/ratePeriod/periodsCharged are ADDITIVE — every
            // pre-existing key keeps its meaning, so callers that only read the
            // fixed-mode fields continue to work unchanged.
            'penaltyType' => $type,
            'rate' => $rateUsed,
            // ratePeriod is the PERCENTAGE rate's period and stays null in
            // fixed mode — unchanged, existing consumers depend on it.
            'ratePeriod' => $ratePeriod,
            // penaltyPeriod is the cadence the engine ACTUALLY charged on, set
            // in BOTH modes. Added because `periodsCharged` is meaningless
            // without it: in fixed mode ratePeriod is null, so a reader had no
            // way to tell 3 days from 3 months and would caption a fixed/month
            // penalty as "3 days late". The loan engine already reports this;
            // the contribution engine did not. Matches compute_loan_penalty().
            'penaltyPeriod' => $period,
            'periodsCharged' => $periodsCharged,
            'dailyAmount' => money_from_minor($dailyMinor),
            'gracePeriodDays' => $graceDays,
            'firstChargeableDay' => $firstChargeable->format('Y-m-d'),
            'daysCharged' => $daysCharged,
            'amountAccrued' => money_from_minor($accruedMinor),
            'amountSettled' => money_from_minor($settledMinor),
            'amountOutstanding' => money_from_minor($outstandingMinor),
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
    function payment_penalty_or_501(
        ?array $rules,
        ?string $dueDate,
        int $arrearsMinor,
        int $obligationMinor,
        ?string $paymentId = null
    ): array {
        try {
            return compute_contribution_penalty($rules, $dueDate, $arrearsMinor, $obligationMinor, $paymentId);
        } catch (RuntimeException $e) {
            json_error($e->getMessage(), 501);
        }
    }
}

if (!function_exists('waive_contribution_penalty')) {
    /**
     * POST payments.waivePenalty — forgive the outstanding penalty on a
     * contribution obligation (seed money / monthly contribution / service fee).
     *
     * SENIOR ADMIN ONLY. Waiving is forgiving real debt, so it sits at the
     * highest privilege in the group — the same gate repayments.waive uses for
     * loan penalties.
     *
     * A penalty is never silently zeroed. A waiver is a recorded decision with an
     * author and a reason, written to penalty_settlements (paymentId-scoped,
     * mirroring the loanId-scoped loan-penalty settlement) — which is also what
     * stops the waived days from being charged again on the next read.
     *
     * Scoped to an EXISTING payments row: an obligation that has never had a
     * payment claim recorded has no paymentId to attach a settlement to (the
     * column doesn't exist until a claim is recorded). That mirrors how loan
     * waivers work — a loan always exists once originated; here, a payments row
     * exists once a claim, even a rejected one, has been recorded.
     */
    function waive_contribution_penalty(): void
    {
        $body = read_json_body();
        $paymentId = (string) ($body['paymentId'] ?? '');
        $reason = trim((string) ($body['waivedReason'] ?? ''));

        if ($paymentId === '') {
            json_error('paymentId is required.', 422);
        }
        if ($reason === '') {
            json_error('waivedReason is required.', 422);
        }

        $pdo = getDbConnection();

        $stmt = $pdo->prepare('SELECT * FROM payments WHERE paymentId = :paymentId LIMIT 1');
        $stmt->execute([':paymentId' => $paymentId]);
        $payment = $stmt->fetch();

        if ($payment === false) {
            json_error('Payment not found.', 404);
        }

        $caller = require_role((string) $payment['groupId'], ['senior_admin']);

        $rules = payment_fetch_rules($pdo, (string) $payment['groupId']);
        $arrearsMinor = money_to_minor(trim((string) $payment['arrears']));
        // BL-6(b): the percentage basis is this row's own FULL obligation
        // (totalAmount) — the same snapshot that produced $arrearsMinor above,
        // not a freshly re-read rule value that could have moved since this row
        // was recorded/updated.
        $obligationMinor = money_to_minor(trim((string) $payment['totalAmount']));
        $dueDate = $payment['dueDate'] === null ? null : (string) $payment['dueDate'];
        $penalty = payment_penalty_or_501($rules, $dueDate, $arrearsMinor, $obligationMinor, $paymentId);

        $outstandingMinor = money_to_minor($penalty['amountOutstanding']);
        if ($outstandingMinor <= 0) {
            json_error('There is no outstanding penalty on this payment to waive.', 409);
        }

        $pdo->beginTransaction();
        try {
            $settlement = $pdo->prepare(
                'INSERT INTO penalty_settlements '
                . '(groupId, uid, loanId, paymentId, accruedFrom, accruedTo, daysCharged, '
                . 'dailyAmount, amountAccrued, amountPaid, amountWaived, status, waivedReason, '
                . 'settledBy, settledAt, createdAt) '
                . 'VALUES (:groupId, :uid, NULL, :paymentId, :accruedFrom, :accruedTo, :daysCharged, '
                . ":dailyAmount, :amountAccrued, '0.00', :amountWaived, 'waived', :waivedReason, "
                . ':settledBy, NOW(), NOW())'
            );
            $settlement->execute([
                ':groupId' => $payment['groupId'],
                ':uid' => $payment['uid'],
                ':paymentId' => $paymentId,
                ':accruedFrom' => $penalty['firstChargeableDay'],
                ':accruedTo' => $penalty['asOf'],
                ':daysCharged' => $penalty['daysCharged'],
                ':dailyAmount' => $penalty['dailyAmount'],
                ':amountAccrued' => $penalty['amountAccrued'],
                ':amountWaived' => money_from_minor($outstandingMinor),
                ':waivedReason' => $reason,
                ':settledBy' => $caller['uid'],
            ]);

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        // Recomputed on read: the waiver has netted the outstanding penalty to zero.
        json_response([
            'paymentId' => $paymentId,
            'penalty' => payment_penalty_or_501($rules, $dueDate, $arrearsMinor, $obligationMinor, $paymentId),
        ]);
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

if (!function_exists('payment_cycle_months_to_date')) {
    /**
     * The months of $year the group's monthly contribution is ACTUALLY owed for,
     * up to today. THE OBLIGATION CLOCK — every "what is owed" figure hangs off
     * this list.
     *
     * Bounded at both ends, and both bounds invent or erase real debt:
     *
     *   - the CYCLE START. A group whose cycle began in July owes nothing for
     *     January-June: those months pre-date the group's own rules. Counting
     *     them fabricates arrears no rule ever created.
     *   - TODAY. A month that has not begun cannot be owed. The previous
     *     all-twelve-months loop charged members in July for the following
     *     December, which is how payments.groupArrears came to report 750,000
     *     against a group whose real position was 220,000.
     *   - the CYCLE END, when the group set one: obligations stop with the cycle.
     *
     * A group that has not set a cycle start date falls back to
     * January..current month — still bounded at today, never into the future.
     *
     * @return string[] month names from PAYMENT_MONTHS, in calendar order
     */
    function payment_cycle_months_to_date(?array $rules, int $year): array
    {
        $today = payment_day(date('Y-m-d'));

        // The cycle window, as first-of-month boundaries: [start, end).
        $windowStart = null;
        $windowEnd = null;

        $rawStart = $rules['cycleDurationStartDate'] ?? null;
        if ($rawStart !== null && trim((string) $rawStart) !== '') {
            try {
                $windowStart = payment_day((string) $rawStart)->modify('first day of this month');

                $rawEnd = $rules['cycleDurationEndDate'] ?? null;
                $lengthMonths = (int) ($rules['cycleDurationMonths'] ?? 0);
                if ($rawEnd !== null && trim((string) $rawEnd) !== '') {
                    // Inclusive end date -> exclusive first-of-next-month bound.
                    $windowEnd = payment_day((string) $rawEnd)->modify('first day of next month');
                } elseif ($lengthMonths > 0) {
                    $windowEnd = $windowStart->modify('+' . $lengthMonths . ' months');
                }
            } catch (InvalidArgumentException $e) {
                // An unparseable cycle date must not silently narrow the window
                // to nothing — fall back to the unbounded (year-only) reading.
                $windowStart = null;
                $windowEnd = null;
            }
        }

        $months = [];
        foreach (PAYMENT_MONTHS as $index => $name) {
            $monthStart = payment_day(sprintf('%04d-%02d-01', $year, $index + 1));

            if ($monthStart > $today) {
                break; // hasn't begun — and neither has any later month
            }
            if ($windowStart !== null && $monthStart < $windowStart) {
                continue; // before the cycle started
            }
            if ($windowEnd !== null && $monthStart >= $windowEnd) {
                break; // after the cycle ended
            }

            $months[] = $name;
        }

        return $months;
    }
}

if (!function_exists('payment_overdue_months')) {
    /**
     * The subset of payment_cycle_months_to_date() whose DUE DATE has passed —
     * i.e. genuinely late, not merely outstanding.
     *
     * The distinction is the whole point: on the 25th of a month whose
     * contribution falls due on the 31st, the money is owed but nobody is late.
     * Arrears means late. Calling a member "behind" for a month that has not
     * come due is an accusation the rules do not support.
     *
     * @return string[] month names, in calendar order
     */
    function payment_overdue_months(?array $rules, int $year): array
    {
        $today = payment_day(date('Y-m-d'));
        $overdue = [];

        foreach (payment_cycle_months_to_date($rules, $year) as $name) {
            $due = payment_due_date($rules, 'monthly_contribution', $name, $year);
            if ($due === null) {
                continue; // no deadline configured -> nothing can be late
            }
            try {
                if (payment_day($due) < $today) {
                    $overdue[] = $name;
                }
            } catch (InvalidArgumentException $e) {
                continue;
            }
        }

        return $overdue;
    }
}

if (!function_exists('payment_penalty_due_date')) {
    /**
     * The due date a PENALTY may be charged from for one obligation, or null when
     * no penalty can apply. The single source both record_payment() and
     * approve_payment() use, so the penalty an admin is quoted when recording is
     * the same penalty that gets settled when approving.
     *
     * Two ways it returns null, and both mean "nothing can be late":
     *
     *   - the group configured no due date for this type (seed money / service
     *     fee with a blank date). The engine already treats a null dueDate as
     *     unscheduled; this just makes that explicit at the call site.
     *   - the obligation is a monthly contribution for a month OUTSIDE the
     *     group's cycle (see payment_cycle_months_to_date). A month the cycle
     *     never raised was never owed, so it cannot be late — quoting a penalty
     *     on it would invent a charge no rule created.
     */
    function payment_penalty_due_date(
        ?array $rules,
        string $paymentType,
        ?string $month,
        int $year
    ): ?string {
        if ($paymentType === 'monthly_contribution') {
            if ($month === null || !in_array($month, payment_cycle_months_to_date($rules, $year), true)) {
                return null;
            }
        }

        return payment_due_date($rules, $paymentType, $month, $year);
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
        // J5: pending is disjoint from verifiedCollected's ['approved','completed']
        // status set below — a row is counted in exactly one of the two.
        $pendingMinor = 0;
        foreach ($stmt->fetchAll() as $row) {
            $arrearsMinor = money_to_minor(trim((string) $row['arrears']));
            // BL-6(b): this row's own FULL obligation (totalAmount) — the same
            // snapshot that produced this row's persisted arrears.
            $obligationMinor = money_to_minor(trim((string) $row['totalAmount']));

            // Computed on read — the charge grows every night and nothing stores it.
            $row['penalty'] = payment_penalty_or_501(
                $rules,
                $row['dueDate'] === null ? null : (string) $row['dueDate'],
                $arrearsMinor,
                $obligationMinor,
                (string) $row['paymentId']
            );

            if (in_array((string) $row['approvalStatus'], ['approved', 'completed'], true)) {
                $collectedVerifiedMinor += money_to_minor(trim((string) $row['amountPaid']));
            }
            if ((string) $row['approvalStatus'] === 'pending') {
                $pendingMinor += money_to_minor(trim((string) $row['amountPaid']));
            }
            $arrearsTotalMinor += $arrearsMinor;
            // amountOutstanding, not amountAccrued: a waived/paid penalty must not
            // keep inflating this summary once it has been settled — this is the
            // direct consequence of adding settlement netting above. The field
            // name (penaltyAccrued) is kept stable for existing API consumers;
            // only the VALUE now reflects what is actually still outstanding.
            $penaltyAccruedMinor += money_to_minor(trim((string) $row['penalty']['amountOutstanding']));

            $payments[] = $row;
        }

        json_response([
            'payments' => $payments,
            'summary' => [
                'verifiedCollected' => money_from_minor($collectedVerifiedMinor),
                'arrears' => money_from_minor($arrearsTotalMinor),
                'penaltyAccrued' => money_from_minor($penaltyAccruedMinor),
                'totalArrears' => money_from_minor($arrearsTotalMinor + $penaltyAccruedMinor),
                // J5: sum of this SAME loop's 'pending'-status rows only — lets the
                // member page read this total instead of summing pending amountPaid
                // client-side.
                'pending' => money_from_minor($pendingMinor),
            ],
        ]);
    }
}

if (!function_exists('payment_obligations_summary_minor')) {
    /**
     * Pure summation over already-computed obligation detail (seed money,
     * each month, service fee) into totals in integer minor units.
     *
     * Extracted out of my_obligations() so the same totals math can be reused
     * by member_arrears_penalties_minor() below (loans.php's eligibility
     * check needs the identical arrears/penalty totals a member sees on
     * payments.obligations) without duplicating the arithmetic in two places.
     *
     * Each detail row's 'amountPaid'/'arrears'/penalty 'amountOutstanding' is a
     * formatted decimal string (money_from_minor of an int already computed by
     * the caller); round-tripping it through money_to_minor here is an
     * identity operation, not new arithmetic.
     *
     * A month row may carry `counts => false` (see payment_cycle_months_to_date):
     * a month outside the group's cycle, or one that has not begun. MONEY PAID
     * ALWAYS COUNTS — it is real cash the member handed over, whatever month it
     * was labelled — but a month that was never owed contributes NO arrears and
     * NO penalty. Absent key means true, so callers passing only due months are
     * unaffected.
     */
    function payment_obligations_summary_minor(array $seed, array $months, ?array $serviceFee): array
    {
        $contributedMinor = money_to_minor(trim((string) $seed['amountPaid']));
        $penaltyAccruedMinor = money_to_minor(trim((string) $seed['penalty']['amountOutstanding']));
        $seedContributedMinor = money_to_minor(trim((string) $seed['amountPaid']));
        $monthlyContributedMinor = 0;
        $feeContributedMinor = 0;

        // Seed money is a cycle-entry obligation with no future due date, so
        // outstanding seed is always also overdue.
        $seedArrearsMinor = money_to_minor(trim((string) $seed['arrears']));
        $arrearsMinor = $seedArrearsMinor;
        $overdueMinor = $seedArrearsMinor;

        foreach ($months as $monthRow) {
            $paidMinor = money_to_minor(trim((string) $monthRow['amountPaid']));
            $contributedMinor += $paidMinor;
            $monthlyContributedMinor += $paidMinor;

            // A month the cycle never raised owes nothing and can penalise
            // nothing — but the cash paid against it above still counts.
            if (($monthRow['counts'] ?? true) !== true) {
                continue;
            }

            $rowArrearsMinor = money_to_minor(trim((string) $monthRow['arrears']));
            $arrearsMinor += $rowArrearsMinor;
            $penaltyAccruedMinor += money_to_minor(trim((string) $monthRow['penalty']['amountOutstanding']));

            // Outstanding vs LATE. A month that has not passed its due date is
            // owed but not overdue — absent key means overdue, so callers that
            // pass only past-due months are unaffected.
            if (($monthRow['overdue'] ?? true) === true) {
                $overdueMinor += $rowArrearsMinor;
            }
        }

        if ($serviceFee !== null) {
            $feeArrearsMinor = money_to_minor(trim((string) $serviceFee['arrears']));
            $contributedMinor += money_to_minor(trim((string) $serviceFee['amountPaid']));
            $arrearsMinor += $feeArrearsMinor;
            $overdueMinor += $feeArrearsMinor;
            $penaltyAccruedMinor += money_to_minor(trim((string) $serviceFee['penalty']['amountOutstanding']));
            $feeContributedMinor = money_to_minor(trim((string) $serviceFee['amountPaid']));
        }

        return [
            'contributedMinor' => $contributedMinor,
            // OUTSTANDING — everything owed, whether or not it is late yet.
            'arrearsMinor' => $arrearsMinor,
            // LATE — the subset past its due date. This is the figure that
            // reconciles with payments.groupArrears and the one that should
            // ever gate anything.
            'overdueMinor' => $overdueMinor,
            'penaltyAccruedMinor' => $penaltyAccruedMinor,
            'seedContributedMinor' => $seedContributedMinor,
            'monthlyContributedMinor' => $monthlyContributedMinor,
            'feeContributedMinor' => $feeContributedMinor,
        ];
    }
}

if (!function_exists('member_arrears_penalties_minor')) {
    /**
     * A member's outstanding contribution arrears + accrued penalties, in
     * integer minor units, for the CURRENT year — the same figures
     * my_obligations() shows that member under payments.obligations, computed
     * from the same primitives (payment_rule_amount_minor, payment_settled_minor,
     * payment_due_date, payment_penalty_or_501) so the two can never disagree.
     *
     * Used by loans.php's loan eligibility gate/preview — a member's loan
     * standing depends on whether they are current on contributions.
     *
     * @return array{arrearsMinor: int, penaltiesMinor: int}
     */
    function member_arrears_penalties_minor(string $groupId, string $uid): array
    {
        $pdo = getDbConnection();
        $rules = payment_fetch_rules($pdo, $groupId);
        $year = (int) date('Y');

        // --- Seed money. ---
        $seedDueMinor = payment_rule_amount_minor($rules, 'seed_money');
        $seedPaidMinor = payment_settled_minor($pdo, $groupId, $uid, 'seed_money');
        $seedArrearsMinor = $seedDueMinor === null ? 0 : max(0, $seedDueMinor - $seedPaidMinor);
        $seedDueDate = payment_due_date($rules, 'seed_money', null, $year);
        $seedRow = payment_fetch_row($pdo, $groupId, $uid, 'seed_money', $year, null);

        $seed = [
            'amountPaid' => money_from_minor($seedPaidMinor),
            'arrears' => money_from_minor($seedArrearsMinor),
            // BL-6(b): the percentage basis is the payment type's rule cost —
            // the same $seedDueMinor that produced $seedArrearsMinor above, so
            // arrears and obligation basis are always the same snapshot.
            'penalty' => payment_penalty_or_501(
                $rules,
                $seedDueDate,
                $seedArrearsMinor,
                $seedDueMinor ?? 0,
                $seedRow === null ? null : (string) $seedRow['paymentId']
            ),
        ];

        // --- Monthly contributions. ---
        $monthlyDueMinor = payment_rule_amount_minor($rules, 'monthly_contribution');
        $months = [];
        // Only the cycle's months so far are owed — see payment_cycle_months_to_date().
        $cycleMonths = payment_cycle_months_to_date($rules, $year);
        $overdueMonths = payment_overdue_months($rules, $year);

        foreach (PAYMENT_MONTHS as $month) {
            $paidMinor = payment_settled_minor($pdo, $groupId, $uid, 'monthly_contribution', $year, $month);
            $arrearsMinor = $monthlyDueMinor === null ? 0 : max(0, $monthlyDueMinor - $paidMinor);
            $dueDate = payment_due_date($rules, 'monthly_contribution', $month, $year);
            $row = payment_fetch_row($pdo, $groupId, $uid, 'monthly_contribution', $year, $month);

            $months[] = [
                'counts' => in_array($month, $cycleMonths, true),
                'overdue' => in_array($month, $overdueMonths, true),
                'amountPaid' => money_from_minor($paidMinor),
                'arrears' => money_from_minor($arrearsMinor),
                // BL-6(b): full obligation basis = $monthlyDueMinor, same source
                // as $arrearsMinor above.
                //
                // payment_penalty_due_date, NOT $dueDate: a month outside the
                // group's cycle was never owed, so it shows NO penalty here —
                // the same gate record_payment()/approve_payment() apply. Showing
                // a penalty the server would then refuse to collect is how the
                // admin modal ends up quoting a figure that cannot be paid.
                'penalty' => payment_penalty_or_501(
                    $rules,
                    payment_penalty_due_date($rules, 'monthly_contribution', $month, $year),
                    $arrearsMinor,
                    $monthlyDueMinor ?? 0,
                    $row === null ? null : (string) $row['paymentId']
                ),
            ];
        }

        // --- Service fee. ---
        $serviceFee = null;
        if ((int) ($rules['serviceFeeRequired'] ?? 0) === 1) {
            $feeDueMinor = payment_rule_amount_minor($rules, 'service_fee');
            $feePaidMinor = payment_settled_minor($pdo, $groupId, $uid, 'service_fee', $year);
            $feeArrearsMinor = $feeDueMinor === null ? 0 : max(0, $feeDueMinor - $feePaidMinor);
            $feeDueDate = payment_due_date($rules, 'service_fee', null, $year);
            $feeRow = payment_fetch_row($pdo, $groupId, $uid, 'service_fee', $year, null);

            $serviceFee = [
                'amountPaid' => money_from_minor($feePaidMinor),
                'arrears' => money_from_minor($feeArrearsMinor),
                // BL-6(b): full obligation basis = $feeDueMinor, same source as
                // $feeArrearsMinor above.
                'penalty' => payment_penalty_or_501(
                    $rules,
                    $feeDueDate,
                    $feeArrearsMinor,
                    $feeDueMinor ?? 0,
                    $feeRow === null ? null : (string) $feeRow['paymentId']
                ),
            ];
        }

        $summary = payment_obligations_summary_minor($seed, $months, $serviceFee);

        // OVERDUE, not outstanding. This feeds loans.php's eligibility gate, and
        // a contribution that has not reached its due date is not a default —
        // refusing someone a loan on the 25th for money due on the 31st would be
        // the app inventing a rule the group never wrote.
        return [
            'arrearsMinor' => $summary['overdueMinor'],
            'penaltiesMinor' => $summary['penaltyAccruedMinor'],
        ];
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
        $seedRow = payment_fetch_row($pdo, $groupId, $uid, 'seed_money', $year, null);

        $seed = [
            'required' => (int) ($rules['seedMoneyRequired'] ?? 0) === 1,
            'configured' => $seedDueMinor !== null,
            'totalAmount' => money_from_minor($seedDueMinor ?? 0),
            'amountPaid' => money_from_minor($seedPaidMinor),
            'arrears' => money_from_minor($seedArrearsMinor),
            'dueDate' => $seedDueDate,
            // BL-6(b): obligation basis = $seedDueMinor, same source as
            // $seedArrearsMinor above.
            'penalty' => payment_penalty_or_501(
                $rules,
                $seedDueDate,
                $seedArrearsMinor,
                $seedDueMinor ?? 0,
                $seedRow === null ? null : (string) $seedRow['paymentId']
            ),
        ];

        // --- Monthly contributions, month by month across the current year. ---
        // The full year is still RETURNED, so the member sees the whole
        // schedule, but only the cycle's months so far are OWED — each row
        // carries `counts` and the summary honours it.
        $monthlyDueMinor = payment_rule_amount_minor($rules, 'monthly_contribution');
        $months = [];
        $cycleMonths = payment_cycle_months_to_date($rules, $year);
        $overdueMonths = payment_overdue_months($rules, $year);

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
                // Whether this month is inside the group's cycle and has begun.
                // A false row is shown but owes nothing — see the summary.
                'counts' => in_array($month, $cycleMonths, true),
                // Whether it is also past its due date, i.e. genuinely late.
                'overdue' => in_array($month, $overdueMonths, true),
                'totalAmount' => money_from_minor($monthlyDueMinor ?? 0),
                'amountPaid' => money_from_minor($paidMinor),
                'arrears' => money_from_minor($arrearsMinor),
                'dueDate' => $dueDate,
                'approvalStatus' => $row === null ? 'unpaid' : (string) $row['approvalStatus'],
                // BL-6(b): obligation basis = $monthlyDueMinor, same source as
                // $arrearsMinor above.
                //
                // payment_penalty_due_date, NOT $dueDate: a month outside the
                // group's cycle was never owed, so it carries NO penalty — the
                // same gate record_payment()/approve_payment() apply. The record
                // modal reads this object to quote the penalty it will collect,
                // so a figure here that the server would refuse is a trap.
                'penalty' => payment_penalty_or_501(
                    $rules,
                    payment_penalty_due_date($rules, 'monthly_contribution', $month, $year),
                    $arrearsMinor,
                    $monthlyDueMinor ?? 0,
                    $row === null ? null : (string) $row['paymentId']
                ),
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
            $feeRow = payment_fetch_row($pdo, $groupId, $uid, 'service_fee', $year, null);

            $serviceFee = [
                'required' => true,
                'configured' => $feeDueMinor !== null,
                'totalAmount' => money_from_minor($feeDueMinor ?? 0),
                'amountPaid' => money_from_minor($feePaidMinor),
                'arrears' => money_from_minor($feeArrearsMinor),
                'dueDate' => $feeDueDate,
                // BL-6(b): obligation basis = $feeDueMinor, same source as
                // $feeArrearsMinor above.
                'penalty' => payment_penalty_or_501(
                    $rules,
                    $feeDueDate,
                    $feeArrearsMinor,
                    $feeDueMinor ?? 0,
                    $feeRow === null ? null : (string) $feeRow['paymentId']
                ),
            ];
        }

        $member = payment_fetch_member($pdo, $groupId, $uid);

        // Summary — sums of the SAME per-item figures already computed above
        // (seed money, every month, service fee). No re-fetch, no new query.
        // amountOutstanding, not amountAccrued: a waived/paid penalty must not
        // keep inflating this summary once it has been settled (same reasoning
        // as list_payments' summary, above). Extracted into
        // payment_obligations_summary_minor() so member_arrears_penalties_minor()
        // can reuse the identical totals math.
        $obligationsSummary = payment_obligations_summary_minor($seed, $months, $serviceFee);
        $contributedMinor = $obligationsSummary['contributedMinor'];
        $arrearsMinor = $obligationsSummary['arrearsMinor'];
        $penaltyAccruedMinor = $obligationsSummary['penaltyAccruedMinor'];

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
                // arrears = everything OUTSTANDING (what the member owes);
                // overdue = the LATE subset, which is what payments.groupArrears
                // totals and what any gate should ever look at.
                'arrears' => money_from_minor($arrearsMinor),
                'overdue' => money_from_minor($obligationsSummary['overdueMinor']),
                'notYetDue' => money_from_minor($arrearsMinor - $obligationsSummary['overdueMinor']),
                'penaltyAccrued' => money_from_minor($penaltyAccruedMinor),
                // J5: same arrears+penalty basis as group_arrears_summary's
                // 'totalArrears' tile, member-scoped here — lets the member page
                // read this total instead of summing arrears+penalty client-side.
                'totalOwed' => money_from_minor($arrearsMinor + $penaltyAccruedMinor),
            ],
            'contributionBreakdown' => [
                'seedMoney' => money_from_minor($obligationsSummary['seedContributedMinor']),
                'monthly' => money_from_minor($obligationsSummary['monthlyContributedMinor']),
                'serviceFee' => money_from_minor($obligationsSummary['feeContributedMinor']),
            ],
        ]);
    }
}

if (!function_exists('group_member_breakdown')) {
    /**
     * GET payments.memberBreakdown — WHO is behind a group money figure.
     *
     * The admin dashboard's Arrears and Collections stat cards each open a
     * per-member modal. Those per-member totals used to be added up in the
     * browser, which is the one thing A2 forbids: the group tile and the modal
     * rows were two independent additions of the same money and nothing forced
     * them to agree. This returns both the rows AND their total from one
     * server-side pass, so the modal can never contradict the card above it.
     *
     * Admin-gated: this exposes every member's position to the caller, which a
     * plain member must never see. Same gate as group_arrears_summary.
     *
     * figure=arrears     — what each member still owes (arrears + outstanding
     *                      penalty), using the SAME per-row penalty computation
     *                      list_payments performs, so the two always agree.
     * figure=collections — what each member has actually paid in (verified
     *                      approved/completed rows only).
     */
    function group_member_breakdown(): void
    {
        $groupId = (string) ($_GET['groupId'] ?? '');
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        require_role($groupId, PAYMENT_ADMIN_ROLES);

        $figure = (string) ($_GET['figure'] ?? '');
        if (!in_array($figure, ['arrears', 'collections'], true)) {
            json_error('figure must be one of: arrears, collections.', 422);
        }

        $pdo = getDbConnection();
        $rules = payment_fetch_rules($pdo, $groupId);

        $year = (int) date('Y');
        if (isset($_GET['year']) && $_GET['year'] !== '') {
            $year = (int) $_GET['year'];
            if ($year < 2000 || $year > 2100) {
                json_error('year is not a valid year.', 422);
            }
        }

        $byMember = [];
        $totalMinor = 0;

        $add = static function (array &$byMember, int &$totalMinor, string $uid, string $name, string $label, int $minor): void {
            if ($minor <= 0) {
                return;
            }
            if (!isset($byMember[$uid])) {
                $byMember[$uid] = ['uid' => $uid, 'memberName' => $name, 'minor' => 0, 'breakdown' => []];
            }
            $byMember[$uid]['minor'] += $minor;
            $byMember[$uid]['breakdown'][] = ['label' => $label, 'amount' => money_from_minor($minor)];
            $totalMinor += $minor;
        };

        if ($figure === 'collections') {
            // Money actually received: the persisted rows ARE the record of cash
            // handed over, so the ledger is the right source here.
            $stmt = $pdo->prepare(
                'SELECT p.uid, p.paymentType, p.month, p.amountPaid, p.approvalStatus, '
                . 'COALESCE(m.fullName, u.fullName) AS memberName '
                . 'FROM payments p '
                . 'LEFT JOIN members m ON m.groupId = p.groupId AND m.uid = p.uid '
                . 'LEFT JOIN users u ON u.uid = p.uid '
                . 'WHERE p.groupId = :groupId'
            );
            $stmt->execute([':groupId' => $groupId]);

            foreach ($stmt->fetchAll() as $row) {
                if (!in_array((string) $row['approvalStatus'], ['approved', 'completed'], true)) {
                    continue;
                }
                $name = trim((string) ($row['memberName'] ?? ''));
                $add(
                    $byMember,
                    $totalMinor,
                    (string) $row['uid'],
                    $name === '' ? 'Unknown Member' : $name,
                    payment_type_label((string) $row['paymentType'], $row['month']),
                    money_to_minor(trim((string) $row['amountPaid']))
                );
            }
        } else {
            // ARREARS IS NOT A LEDGER SUM. What a member owes is derived from
            // group_rules — an obligation with no payment row at all is still
            // owed, and is exactly the case the ledger cannot see. Reading
            // payments.arrears here returned 0.00 for a group whose live
            // position was 200,000.00, which is the same class of bug as the
            // arrears tile that once showed 0 against a true 1,379,000.
            //
            // This walks the SAME primitives, the same active-member set and the
            // same overdue-month rule as group_live_contribution_penalty_minor,
            // so these rows sum to the figure on the card above them.
            $memStmt = $pdo->prepare(
                "SELECT m.uid, COALESCE(m.fullName, u.fullName) AS memberName "
                . "FROM members m LEFT JOIN users u ON u.uid = m.uid "
                . "WHERE m.groupId = :groupId AND m.status = 'active'"
            );
            $memStmt->execute([':groupId' => $groupId]);

            $seedDueMinor = payment_rule_amount_minor($rules, 'seed_money');
            $monthlyDueMinor = payment_rule_amount_minor($rules, 'monthly_contribution');
            $feeRequired = (int) ($rules['serviceFeeRequired'] ?? 0) === 1;
            $feeDueMinor = $feeRequired ? payment_rule_amount_minor($rules, 'service_fee') : null;

            $seedDueDate = payment_due_date($rules, 'seed_money', null, $year);
            $feeDueDate = $feeRequired ? payment_due_date($rules, 'service_fee', null, $year) : null;
            $overdueMonths = payment_overdue_months($rules, $year);

            foreach ($memStmt->fetchAll() as $member) {
                $uid = (string) $member['uid'];
                $nameRaw = trim((string) ($member['memberName'] ?? ''));
                $name = $nameRaw === '' ? 'Unknown Member' : $nameRaw;

                if ($seedDueMinor !== null) {
                    $paid = payment_settled_minor($pdo, $groupId, $uid, 'seed_money');
                    $a = max(0, $seedDueMinor - $paid);
                    $row = payment_fetch_row($pdo, $groupId, $uid, 'seed_money', $year, null);
                    $pen = payment_penalty_or_501(
                        $rules,
                        $seedDueDate,
                        $a,
                        $seedDueMinor,
                        $row === null ? null : (string) $row['paymentId']
                    );
                    $add($byMember, $totalMinor, $uid, $name, 'Seed Money', $a);
                    $add($byMember, $totalMinor, $uid, $name, 'Seed Money penalty', money_to_minor($pen['amountOutstanding']));
                }

                if ($monthlyDueMinor !== null) {
                    foreach ($overdueMonths as $month) {
                        $paid = payment_settled_minor($pdo, $groupId, $uid, 'monthly_contribution', $year, $month);
                        $a = max(0, $monthlyDueMinor - $paid);
                        $row = payment_fetch_row($pdo, $groupId, $uid, 'monthly_contribution', $year, $month);
                        $pen = payment_penalty_or_501(
                            $rules,
                            payment_due_date($rules, 'monthly_contribution', $month, $year),
                            $a,
                            $monthlyDueMinor,
                            $row === null ? null : (string) $row['paymentId']
                        );
                        $add($byMember, $totalMinor, $uid, $name, 'Monthly - ' . $month, $a);
                        $add($byMember, $totalMinor, $uid, $name, 'Monthly - ' . $month . ' penalty', money_to_minor($pen['amountOutstanding']));
                    }
                }

                if ($feeRequired && $feeDueMinor !== null) {
                    $paid = payment_settled_minor($pdo, $groupId, $uid, 'service_fee', $year);
                    $a = max(0, $feeDueMinor - $paid);
                    $row = payment_fetch_row($pdo, $groupId, $uid, 'service_fee', $year, null);
                    $pen = payment_penalty_or_501(
                        $rules,
                        $feeDueDate,
                        $a,
                        $feeDueMinor,
                        $row === null ? null : (string) $row['paymentId']
                    );
                    $add($byMember, $totalMinor, $uid, $name, 'Service Fee', $a);
                    $add($byMember, $totalMinor, $uid, $name, 'Service Fee penalty', money_to_minor($pen['amountOutstanding']));
                }
            }
        }

        // Biggest position first — the member an admin most needs to act on.
        usort($byMember, static fn ($a, $b) => $b['minor'] <=> $a['minor']);

        $members = array_map(static fn ($m) => [
            'uid' => $m['uid'],
            'memberName' => $m['memberName'],
            'amount' => money_from_minor($m['minor']),
            'breakdown' => $m['breakdown'],
        ], array_values($byMember));

        json_response([
            'figure' => $figure,
            // The sum of exactly the rows above, computed in the same pass — the
            // modal renders this instead of re-adding the rows it was handed.
            'total' => money_from_minor($totalMinor),
            'memberCount' => count($members),
            'members' => $members,
        ]);
    }
}

if (!function_exists('payment_type_label')) {
    /**
     * Human label for a payment row, month-qualified for monthly contributions
     * so an admin can see WHICH month a figure came from.
     */
    function payment_type_label(string $type, $month = null): string
    {
        if ($type === 'monthly_contribution') {
            $m = trim((string) ($month ?? ''));
            return 'Monthly - ' . ($m === '' ? 'Unknown' : $m);
        }
        if ($type === 'seed_money') {
            return 'Seed Money';
        }
        if ($type === 'service_fee') {
            return 'Service Fee';
        }
        return ucwords(str_replace('_', ' ', $type));
    }
}

if (!function_exists('group_live_contribution_penalty_minor')) {
    /**
     * Shared live-contribution computation for ONE group's ACTIVE members,
     * scoped to $year: total ARREARS (unpaid seed money + OVERDUE monthly
     * contributions + service fee) and total outstanding penalty on those
     * obligations, both in integer minor units.
     *
     * "Arrears" here means LATE, not merely outstanding. The monthly leg walks
     * payment_overdue_months() — the cycle's months that have passed their due
     * date — not all twelve months of the calendar year. Seed money and the
     * service fee are cycle-entry obligations with no future due date, so they
     * count as owed from the moment the cycle opens (unchanged).
     *
     * This is the EXACT per-obligation loop group_arrears_summary()'s
     * "Arrears" tile has always used (payment_settled_minor / payment_due_date
     * / payment_penalty_or_501) — extracted here so group_accounting_summary()
     * can reuse the IDENTICAL computation for its penaltiesOutstanding figure
     * instead of re-deriving it. Both totals come out of the SAME loop (same
     * $paid / $a per obligation), so the two callers can never drift against
     * each other the way a second, independently-written loop could.
     *
     * @return array{arrearsMinor:int, penaltyMinor:int, memberCount:int}
     */
    function group_live_contribution_penalty_minor(PDO $pdo, string $groupId, ?array $rules, int $year): array
    {
        // Active members only — a suspended/inactive member's obligations are not
        // the group's live receivable.
        $memStmt = $pdo->prepare(
            "SELECT uid FROM members WHERE groupId = :groupId AND status = 'active'"
        );
        $memStmt->execute([':groupId' => $groupId]);
        $uids = array_column($memStmt->fetchAll(), 'uid');

        $seedDueMinor = payment_rule_amount_minor($rules, 'seed_money');
        $monthlyDueMinor = payment_rule_amount_minor($rules, 'monthly_contribution');
        $feeRequired = (int) ($rules['serviceFeeRequired'] ?? 0) === 1;
        $feeDueMinor = $feeRequired ? payment_rule_amount_minor($rules, 'service_fee') : null;

        $seedDueDate = payment_due_date($rules, 'seed_money', null, $year);
        $feeDueDate = $feeRequired ? payment_due_date($rules, 'service_fee', null, $year) : null;

        // Computed ONCE, outside the member loop — it depends only on the rules.
        $overdueMonths = payment_overdue_months($rules, $year);

        $arrearsMinor = 0;
        $penaltyMinor = 0;
        // How many members are ACTUALLY behind. Distinct from memberCount below,
        // which is every active member the loop considered — the admin arrears
        // card was labelling that total "members with an outstanding balance",
        // so a group where everyone was paid up still read "5 members behind".
        $membersInArrears = 0;

        foreach ($uids as $uid) {
            // Measured as a DELTA across this member's pass rather than by
            // touching the accumulation lines below — the arrears maths is the
            // figure the whole dashboard reconciles against and is left byte-identical.
            $memberStartArrearsMinor = $arrearsMinor;
            $memberStartPenaltyMinor = $penaltyMinor;

            // Seed money.
            if ($seedDueMinor !== null) {
                $paid = payment_settled_minor($pdo, $groupId, $uid, 'seed_money');
                $a = max(0, $seedDueMinor - $paid);
                $arrearsMinor += $a;
                $row = payment_fetch_row($pdo, $groupId, $uid, 'seed_money', $year, null);
                // BL-6(b): obligation basis = $seedDueMinor (guaranteed non-null
                // in this branch), same source as $a (arrears) above.
                $pen = payment_penalty_or_501(
                    $rules,
                    $seedDueDate,
                    $a,
                    $seedDueMinor,
                    $row === null ? null : (string) $row['paymentId']
                );
                $penaltyMinor += money_to_minor($pen['amountOutstanding']);
            }

            // Monthly contributions, month by month — over the months that are
            // genuinely LATE, not all twelve of the calendar year. See
            // payment_overdue_months(): a month before the cycle started was
            // never owed, and a month that has not reached its due date is
            // outstanding but not arrears. Summing all twelve was reporting
            // 750,000 against a group whose real overdue position was 170,000.
            if ($monthlyDueMinor !== null) {
                foreach ($overdueMonths as $month) {
                    $paid = payment_settled_minor(
                        $pdo,
                        $groupId,
                        $uid,
                        'monthly_contribution',
                        $year,
                        $month
                    );
                    $a = max(0, $monthlyDueMinor - $paid);
                    $arrearsMinor += $a;
                    $dueDate = payment_due_date($rules, 'monthly_contribution', $month, $year);
                    $row = payment_fetch_row($pdo, $groupId, $uid, 'monthly_contribution', $year, $month);
                    // BL-6(b): obligation basis = $monthlyDueMinor (guaranteed
                    // non-null in this branch), same source as $a (arrears).
                    $pen = payment_penalty_or_501(
                        $rules,
                        $dueDate,
                        $a,
                        $monthlyDueMinor,
                        $row === null ? null : (string) $row['paymentId']
                    );
                    $penaltyMinor += money_to_minor($pen['amountOutstanding']);
                }
            }

            // Service fee.
            if ($feeRequired && $feeDueMinor !== null) {
                $paid = payment_settled_minor($pdo, $groupId, $uid, 'service_fee', $year);
                $a = max(0, $feeDueMinor - $paid);
                $arrearsMinor += $a;
                $row = payment_fetch_row($pdo, $groupId, $uid, 'service_fee', $year, null);
                // BL-6(b): obligation basis = $feeDueMinor (guaranteed non-null
                // in this branch), same source as $a (arrears) above.
                $pen = payment_penalty_or_501(
                    $rules,
                    $feeDueDate,
                    $a,
                    $feeDueMinor,
                    $row === null ? null : (string) $row['paymentId']
                );
                $penaltyMinor += money_to_minor($pen['amountOutstanding']);
            }

            if (
                ($arrearsMinor - $memberStartArrearsMinor)
                + ($penaltyMinor - $memberStartPenaltyMinor) > 0
            ) {
                $membersInArrears++;
            }
        }

        return [
            'arrearsMinor' => $arrearsMinor,
            'penaltyMinor' => $penaltyMinor,
            // Every ACTIVE member considered — NOT the number who owe anything.
            // Kept unchanged because existing consumers read it.
            'memberCount' => count($uids),
            // The number who are actually behind. This is what an arrears
            // breakdown should report, and it matches the row count that
            // payments.memberBreakdown?figure=arrears returns.
            'membersInArrears' => $membersInArrears,
        ];
    }
}

if (!function_exists('group_arrears_summary')) {
    /**
     * GET payments.groupArrears — the WHOLE GROUP's outstanding obligations:
     * total contribution arrears (unpaid seed money + monthly contributions +
     * service fee) plus outstanding penalties, summed across every ACTIVE member.
     *
     * ADMIN-EQUIVALENT ONLY. Computed server-side in integer minor units, reusing
     * the exact same per-obligation math as my_obligations() (payment_rule_amount
     * / payment_settled / payment_due_date / payment_penalty_or_501), so the group
     * total reconciles with the sum of each member's own dashboard.
     *
     * WHY THIS EXISTS: the admin dashboard's "Arrears" tile previously summed only
     * the `arrears` column of RECORDED payment rows (payments.list summary). An
     * obligation a member simply never paid has no row, so it was invisible — the
     * tile wrongly showed ~0 while the group was genuinely owed large sums. This
     * derives arrears from the obligations (rules − verified paid), exactly like
     * the member view, so unrecorded unpaid months are counted.
     *
     * THE OTHER HALF OF THAT FIX: deriving from the rules over-corrected. The
     * monthly leg walked all twelve calendar months, so in July a group was
     * charged for the following December and for months before its own cycle
     * began — one live group read 750,000 against a real overdue position of
     * 170,000. It now walks payment_overdue_months() only: the cycle's months
     * that have actually passed their due date. Money that is outstanding but
     * not yet late belongs to payments.compliance's `toDate.notYetDue`, not to
     * an arrears tile.
     */
    function group_arrears_summary(): void
    {
        $groupId = (string) ($_GET['groupId'] ?? '');
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        require_role($groupId, PAYMENT_ADMIN_ROLES);

        $year = (int) date('Y');
        if (isset($_GET['year']) && $_GET['year'] !== '') {
            $year = (int) $_GET['year'];
            if ($year < 2000 || $year > 2100) {
                json_error('Invalid year.', 422);
            }
        }

        $pdo = getDbConnection();
        $rules = payment_fetch_rules($pdo, $groupId);

        // Extracted into a shared helper (also used by group_accounting_summary()'s
        // penaltiesOutstanding) so the two figures can never drift apart — same
        // loop, same $paid / $a per obligation, computed once.
        $live = group_live_contribution_penalty_minor($pdo, $groupId, $rules, $year);

        json_response([
            'arrears' => money_from_minor($live['arrearsMinor']),
            'penaltyAccrued' => money_from_minor($live['penaltyMinor']),
            'totalArrears' => money_from_minor($live['arrearsMinor'] + $live['penaltyMinor']),
            'memberCount' => $live['memberCount'],
            'membersInArrears' => $live['membersInArrears'],
        ]);
    }
}

if (!function_exists('group_compliance_summary')) {
    /**
     * GET payments.compliance — "who is keeping up, and who isn't".
     * ADMIN-EQUIVALENT ONLY.
     *
     * Answers the questions a treasurer actually asks:
     *   - what should THIS MONTH bring in, and has it?
     *   - what should the cycle have brought in SO FAR, and has it?
     *   - who specifically hasn't paid, which obligation are they missing, and
     *     is that money late or merely not yet due?
     *
     * TWO SCOPES, NEVER MIXED. The panel this feeds used to print a month-scoped
     * headline ("50,000 short this month") directly above a cycle-scoped
     * per-member list (60,000 each, summing to 220,000) as though they were one
     * statement. They answer different questions and could not reconcile, so
     * both are now returned explicitly and separately:
     *
     *   month.*   — the current month's contribution only. Carries its own due
     *               date and an isDue flag, because "0% collected" on the 25th
     *               of a month that falls due on the 31st is not a shortfall.
     *   toDate.*  — every obligation the cycle has actually raised so far: seed
     *               money plus the contributions for the cycle's months that
     *               have begun (payment_cycle_months_to_date). Months before the
     *               cycle started were never owed; months that have not begun
     *               cannot be.
     *
     * THE RECONCILIATION GUARANTEE: sum(behind[].owed) === toDate.outstanding,
     * and each member's `overdue` + `notYetDue` === their `owed`. The list under
     * a total must add up to that total.
     *
     * OUTSTANDING vs OVERDUE. Outstanding is money not yet received; overdue is
     * money that is also late. `membersOverdue` — not `membersOwing` — is the
     * follow-up count, and it matches group_arrears_summary()'s arrears basis
     * (unpaid seed + overdue months), so the two endpoints agree.
     *
     * Expected figures come from the group's configured rule amounts and the
     * ACTIVE member count — the same scope group_arrears_summary() uses. Every
     * figure is computed here in integer minor units and emitted as a money
     * string; the client renders, it never calculates.
     */
    function group_compliance_summary(): void
    {
        $groupId = (string) ($_GET['groupId'] ?? '');
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        require_role($groupId, PAYMENT_ADMIN_ROLES);

        $year = (int) date('Y');
        if (isset($_GET['year']) && $_GET['year'] !== '') {
            $year = (int) $_GET['year'];
            if ($year < 2000 || $year > 2100) {
                json_error('Invalid year.', 422);
            }
        }

        // Which month to assess. Defaults to the current calendar month.
        $monthIndex = (int) date('n') - 1;
        if (isset($_GET['month']) && $_GET['month'] !== '') {
            $wanted = (string) $_GET['month'];
            $found = array_search($wanted, PAYMENT_MONTHS, true);
            if ($found === false) {
                json_error('Invalid month.', 422);
            }
            $monthIndex = (int) $found;
        }
        $month = PAYMENT_MONTHS[$monthIndex];

        $pdo = getDbConnection();
        $rules = payment_fetch_rules($pdo, $groupId);

        // Active members only, with their names for the follow-up list.
        $memStmt = $pdo->prepare(
            "SELECT m.uid, u.fullName FROM members m "
            . "LEFT JOIN users u ON u.uid = m.uid "
            . "WHERE m.groupId = :groupId AND m.status = 'active'"
        );
        $memStmt->execute([':groupId' => $groupId]);
        $members = $memStmt->fetchAll();

        $seedDueMinor = payment_rule_amount_minor($rules, 'seed_money');
        $monthlyDueMinor = payment_rule_amount_minor($rules, 'monthly_contribution');
        $feeRequired = (int) ($rules['serviceFeeRequired'] ?? 0) === 1;
        $feeDueMinor = $feeRequired ? payment_rule_amount_minor($rules, 'service_fee') : null;

        // The obligation clock. Everything in the toDate scope is bounded by
        // these two lists, so a month outside the cycle can never become debt.
        $cycleMonths = payment_cycle_months_to_date($rules, $year);
        $overdueMonths = payment_overdue_months($rules, $year);
        $monthIsDue = in_array($month, $overdueMonths, true);
        $monthDueDate = payment_due_date($rules, 'monthly_contribution', $month, $year);

        // The selected month, on its own.
        $monthCollectedMinor = 0;
        // Cycle-to-date: every obligation raised so far, and what came in
        // against it. These are the figures the per-member list reconciles to.
        $seedCollectedMinor = 0;
        $feeCollectedMinor = 0;
        $cycleMonthlyCollectedMinor = 0;
        $behind = [];

        foreach ($members as $m) {
            $uid = (string) $m['uid'];
            $missing = [];
            $overdueLabels = [];
            $owedMinor = 0;          // outstanding, whether late or not
            $overdueMinor = 0;       // the late part of $owedMinor

            // Seed money — a once-per-cycle entry obligation, not per-month. It
            // has no future due date, so it is owed from the moment the cycle
            // opens: outstanding seed is always also overdue. Same basis as
            // group_arrears_summary()'s seed leg, so the totals agree.
            if ($seedDueMinor !== null) {
                $paid = payment_settled_minor($pdo, $groupId, $uid, 'seed_money');
                $seedCollectedMinor += $paid;
                $short = max(0, $seedDueMinor - $paid);
                if ($short > 0) {
                    $missing[] = 'Seed money';
                    $overdueLabels[] = 'Seed money';
                    $owedMinor += $short;
                    $overdueMinor += $short;
                }
            }

            // Monthly contributions across the cycle's months so far — NOT just
            // the selected month. A member who skipped May still owes for May in
            // July, and the old single-month loop could not see it.
            if ($monthlyDueMinor !== null) {
                foreach ($cycleMonths as $cycleMonth) {
                    $paid = payment_settled_minor(
                        $pdo,
                        $groupId,
                        $uid,
                        'monthly_contribution',
                        $year,
                        $cycleMonth
                    );
                    $cycleMonthlyCollectedMinor += $paid;

                    $short = max(0, $monthlyDueMinor - $paid);
                    if ($short > 0) {
                        $missing[] = $cycleMonth . ' contribution';
                        $owedMinor += $short;
                        if (in_array($cycleMonth, $overdueMonths, true)) {
                            $overdueLabels[] = $cycleMonth . ' contribution';
                            $overdueMinor += $short;
                        }
                    }
                }
            }

            // The selected month in isolation, for the month-scoped row. Read
            // separately because $month is not necessarily inside $cycleMonths
            // (an explicit ?month= may ask about any month of the year).
            if ($monthlyDueMinor !== null) {
                $monthCollectedMinor += payment_settled_minor(
                    $pdo,
                    $groupId,
                    $uid,
                    'monthly_contribution',
                    $year,
                    $month
                );
            }

            // Service fee — like seed money, a cycle-entry obligation.
            if ($feeRequired && $feeDueMinor !== null) {
                $paid = payment_settled_minor($pdo, $groupId, $uid, 'service_fee', $year);
                $feeCollectedMinor += $paid;
                $short = max(0, $feeDueMinor - $paid);
                if ($short > 0) {
                    $missing[] = 'Service fee';
                    $overdueLabels[] = 'Service fee';
                    $owedMinor += $short;
                    $overdueMinor += $short;
                }
            }

            if ($owedMinor > 0) {
                $behind[] = [
                    'uid' => $uid,
                    'name' => $m['fullName'] !== null ? (string) $m['fullName'] : 'Unknown',
                    'missing' => $missing,
                    'overdueMissing' => $overdueLabels,
                    'owed' => money_from_minor($owedMinor),
                    // owed === overdue + notYetDue, always.
                    'overdue' => money_from_minor($overdueMinor),
                    'notYetDue' => money_from_minor($owedMinor - $overdueMinor),
                    'isOverdue' => $overdueMinor > 0,
                    'owedMinor' => $owedMinor,
                    'overdueMinor' => $overdueMinor,
                ];
            }
        }

        // Most-owing first — the order a treasurer works the list in.
        usort($behind, static fn($a, $b) => $b['owedMinor'] <=> $a['owedMinor']);

        $memberCount = count($members);

        // Cycle-to-date expectation: the entry obligations once each, plus one
        // contribution per member per month the cycle has actually raised.
        $expectedToDateMinor = 0;
        if ($seedDueMinor !== null) {
            $expectedToDateMinor += $seedDueMinor * $memberCount;
        }
        if ($feeRequired && $feeDueMinor !== null) {
            $expectedToDateMinor += $feeDueMinor * $memberCount;
        }
        if ($monthlyDueMinor !== null) {
            $expectedToDateMinor += $monthlyDueMinor * $memberCount * count($cycleMonths);
        }

        $collectedToDateMinor = $seedCollectedMinor + $feeCollectedMinor + $cycleMonthlyCollectedMinor;

        // Derived from the per-member rows, not computed a second way — this is
        // what makes sum(behind[].owed) === toDate.outstanding a guarantee
        // rather than a coincidence.
        $outstandingToDateMinor = 0;
        $overdueToDateMinor = 0;
        $membersOverdue = 0;
        foreach ($behind as $row) {
            $outstandingToDateMinor += $row['owedMinor'];
            $overdueToDateMinor += $row['overdueMinor'];
            if ($row['overdueMinor'] > 0) {
                $membersOverdue++;
            }
        }

        foreach ($behind as &$row) {
            unset($row['owedMinor'], $row['overdueMinor']);
        }
        unset($row);

        $expectedMonthMinor = $monthlyDueMinor === null ? 0 : $monthlyDueMinor * $memberCount;
        $shortfallMinor = max(0, $expectedMonthMinor - $monthCollectedMinor);

        json_response([
            'month' => $month,
            'year' => $year,
            'memberCount' => $memberCount,
            'monthlyDuePerMember' => $monthlyDueMinor === null ? null : money_from_minor($monthlyDueMinor),

            // ── Scope 1: the selected month, on its own ──────────────────────
            'expectedThisMonth' => money_from_minor($expectedMonthMinor),
            'collectedThisMonth' => money_from_minor($monthCollectedMinor),
            'shortfallThisMonth' => money_from_minor($shortfallMinor),
            // Percent complete, integer 0-100, computed server-side so the
            // client never divides money.
            'percentCollected' => $expectedMonthMinor > 0
                ? (int) min(100, intdiv($monthCollectedMinor * 100, $expectedMonthMinor))
                : 100,
            // Whether this month's money is LATE or simply not collected yet.
            // Without this the UI cannot tell a genuine shortfall from a month
            // that has not reached its due date.
            'monthDueDate' => $monthDueDate,
            'monthIsOverdue' => $monthIsDue,

            // ── Scope 2: cycle-to-date — what the per-member list adds up to ──
            'toDate' => [
                'monthsCounted' => $cycleMonths,
                'overdueMonths' => $overdueMonths,
                'expected' => money_from_minor($expectedToDateMinor),
                'collected' => money_from_minor($collectedToDateMinor),
                'outstanding' => money_from_minor($outstandingToDateMinor),
                'overdue' => money_from_minor($overdueToDateMinor),
                'notYetDue' => money_from_minor($outstandingToDateMinor - $overdueToDateMinor),
                'percentCollected' => $expectedToDateMinor > 0
                    ? (int) min(100, intdiv($collectedToDateMinor * 100, $expectedToDateMinor))
                    : 100,
            ],

            'seedCollected' => money_from_minor($seedCollectedMinor),
            'serviceFeeCollected' => money_from_minor($feeCollectedMinor),
            'serviceFeeRequired' => $feeRequired,

            // membersBehind counts members who are LATE — the follow-up list.
            // membersOwing counts anyone with an outstanding balance, late or
            // not. Conflating the two is what produced "5 of 5 members behind"
            // for a month that had not yet fallen due.
            'membersBehind' => $membersOverdue,
            'membersOwing' => count($behind),
            'membersOnTrack' => $memberCount - count($behind),
            'behind' => $behind,
        ]);
    }
}

if (!function_exists('group_accounting_summary_period_drill')) {
    /**
     * Period drill-down behind payments.accountingSummary's opt-in `figure`
     * param (J3 slice 1). Called AFTER require_role() has already gated the
     * caller — no second auth check here, deliberately.
     *
     * For each figure this reuses the EXACT column + status filter the
     * cumulative block in group_accounting_summary() below sums, adding only
     * a date WHERE — so periodTotal is a subset of the cumulative figure by
     * construction and the two can never drift apart. Row-wise
     * money_to_minor(), never SQL SUM(), never a float.
     *
     * payments carries its own INT year + ENUM month, so those columns drive
     * the WHERE directly. loans and loan_payments have no such columns — only
     * approvedAt — so period scoping there uses YEAR(approvedAt) /
     * MONTH(approvedAt). A loan or loan_payments row whose approvedAt is NULL
     * (should not happen for anything in an approved/disbursed/completed
     * status, but the schema does not forbid it) is invisible to EVERY period
     * drill while still counting toward the cumulative total — a
     * reconciliation leak, not a bug in this function; report it if seen.
     *
     * loans.borrowerName and loan_payments.userName are already stored
     * verbatim on those rows (loans has no `uid` column at all — it is keyed
     * by `borrowerId`), so no JOIN to users is needed for those two figures.
     * Only totalContributed needs it, via payments.uid = users.uid.
     */
    function group_accounting_summary_period_drill(
        string $groupId,
        string $figure,
        int $year,
        ?string $month,
        ?int $monthNumber
    ): void {
        $pdo = getDbConnection();
        $totalMinor = 0;
        $rows = [];
        $unmonthed = null;

        switch ($figure) {
            case 'totalContributed':
                $sql = 'SELECT p.amountPaid AS amountPaid, p.paymentType AS type, '
                    . 'p.month AS month, p.approvedAt AS approvedAt, u.fullName AS memberName '
                    . 'FROM payments p LEFT JOIN users u ON u.uid = p.uid '
                    . "WHERE p.groupId = :groupId AND p.approvalStatus IN ('approved', 'completed') "
                    . 'AND p.year = :year';
                $params = [':groupId' => $groupId, ':year' => $year];
                if ($month !== null) {
                    $sql .= ' AND p.month = :month';
                    $params[':month'] = $month;
                }
                $stmt = $pdo->prepare($sql);
                $stmt->execute($params);
                foreach ($stmt->fetchAll() as $row) {
                    $amountMinor = money_to_minor(trim((string) $row['amountPaid']));
                    $totalMinor += $amountMinor;
                    $rows[] = [
                        'memberName' => $row['memberName'],
                        'type' => $row['type'],
                        'month' => $row['month'],
                        'amountPaid' => money_from_minor($amountMinor),
                        'approvedAt' => $row['approvedAt'],
                    ];
                }

                /* D4 — the one-time, no-month portion of the year (owner
                 * decision: show it as a separate labelled line, never hide it
                 * and never misattribute it to a month).
                 *
                 * Seed money is a cycle-entry joining stake, not a monthly
                 * obligation, so those rows carry `month = NULL`. A
                 * month-scoped drill therefore legitimately excludes them, and
                 * twelve months would not add up to the year without this
                 * line. Computed by its own query against the SAME year and
                 * status filter so it holds whether or not a month is
                 * selected: when no month is chosen it is a subset already
                 * inside periodTotal; when one is chosen it sits outside it.
                 * `includedInPeriodTotal` tells the client which, so the
                 * client never has to work it out — or add anything up.
                 *
                 * Broken down BY TYPE rather than labelled "seed money" here:
                 * seed money is the only no-month type today, but the label
                 * belongs to whatever the data actually says, not to an
                 * assumption this query cannot verify. */
                $unmonthedSql = 'SELECT p.paymentType AS type, p.amountPaid AS amountPaid '
                    . 'FROM payments p '
                    . "WHERE p.groupId = :groupId AND p.approvalStatus IN ('approved', 'completed') "
                    . 'AND p.year = :year AND p.month IS NULL';
                $unmonthedStmt = $pdo->prepare($unmonthedSql);
                $unmonthedStmt->execute([':groupId' => $groupId, ':year' => $year]);
                $unmonthedMinor = 0;
                $byTypeMinor = [];
                foreach ($unmonthedStmt->fetchAll() as $row) {
                    $amountMinor = money_to_minor(trim((string) $row['amountPaid']));
                    $unmonthedMinor += $amountMinor;
                    $type = (string) $row['type'];
                    $byTypeMinor[$type] = ($byTypeMinor[$type] ?? 0) + $amountMinor;
                }
                $byType = [];
                foreach ($byTypeMinor as $type => $minor) {
                    $byType[] = ['type' => $type, 'amount' => money_from_minor($minor)];
                }
                $unmonthed = [
                    'total' => money_from_minor($unmonthedMinor),
                    'includedInPeriodTotal' => $month === null,
                    'byType' => $byType,
                ];
                break;

            case 'totalDisbursed':
                $sql = 'SELECT borrowerName, principalAmount, status, approvedAt FROM loans '
                    . "WHERE groupId = :groupId AND status IN ('approved', 'disbursed', 'completed', 'defaulted') "
                    . 'AND YEAR(approvedAt) = :year';
                $params = [':groupId' => $groupId, ':year' => $year];
                if ($monthNumber !== null) {
                    $sql .= ' AND MONTH(approvedAt) = :month';
                    $params[':month'] = $monthNumber;
                }
                $stmt = $pdo->prepare($sql);
                $stmt->execute($params);
                foreach ($stmt->fetchAll() as $row) {
                    $amountMinor = money_to_minor(trim((string) $row['principalAmount']));
                    $totalMinor += $amountMinor;
                    $rows[] = [
                        'borrowerName' => $row['borrowerName'],
                        'principalAmount' => money_from_minor($amountMinor),
                        'status' => $row['status'],
                        'approvedAt' => $row['approvedAt'],
                    ];
                }
                break;

            case 'loanRepaymentsReceived':
                $sql = 'SELECT userName AS borrowerName, amount, approvedAt FROM loan_payments '
                    . "WHERE groupId = :groupId AND status = 'approved' AND YEAR(approvedAt) = :year";
                $params = [':groupId' => $groupId, ':year' => $year];
                if ($monthNumber !== null) {
                    $sql .= ' AND MONTH(approvedAt) = :month';
                    $params[':month'] = $monthNumber;
                }
                $stmt = $pdo->prepare($sql);
                $stmt->execute($params);
                foreach ($stmt->fetchAll() as $row) {
                    $amountMinor = money_to_minor(trim((string) $row['amount']));
                    $totalMinor += $amountMinor;
                    $rows[] = [
                        'borrowerName' => $row['borrowerName'],
                        'amount' => money_from_minor($amountMinor),
                        'approvedAt' => $row['approvedAt'],
                    ];
                }
                break;

            case 'interestEarned':
                $sql = 'SELECT userName AS borrowerName, interestPortion, amount, approvedAt FROM loan_payments '
                    . "WHERE groupId = :groupId AND status = 'approved' AND YEAR(approvedAt) = :year";
                $params = [':groupId' => $groupId, ':year' => $year];
                if ($monthNumber !== null) {
                    $sql .= ' AND MONTH(approvedAt) = :month';
                    $params[':month'] = $monthNumber;
                }
                $stmt = $pdo->prepare($sql);
                $stmt->execute($params);
                foreach ($stmt->fetchAll() as $row) {
                    $interestMinor = money_to_minor(trim((string) $row['interestPortion']));
                    $totalMinor += $interestMinor;
                    $rows[] = [
                        'borrowerName' => $row['borrowerName'],
                        'interestPortion' => money_from_minor($interestMinor),
                        'amount' => money_from_minor(money_to_minor(trim((string) $row['amount']))),
                        'approvedAt' => $row['approvedAt'],
                    ];
                }
                break;
        }

        $payload = [
            'figure' => $figure,
            'year' => $year,
            'month' => $month,
            'periodTotal' => money_from_minor($totalMinor),
            'rows' => $rows,
        ];
        // Additive and figure-specific: only totalContributed has a no-month
        // portion (loans and loan_payments are dated by approvedAt, so every
        // row belongs to a month). Absent for the other three figures.
        if ($unmonthed !== null) {
            $payload['unmonthed'] = $unmonthed;
        }
        json_response($payload);
    }
}

if (!function_exists('group_accounting_summary')) {
    /**
     * GET payments.accountingSummary — the group's FULL financial position,
     * server-side, in integer minor units. ADMIN-EQUIVALENT ONLY.
     *
     * Every money column is fetched raw and summed ROW-WISE via money_to_minor()
     * — never SQL SUM() on a DECIMAL column, never a float — same convention as
     * payment_settled_minor() above.
     *
     * cashPosition intentionally uses ONLY contributionPenaltiesCollected (the
     * paymentId-scoped half of penalty_settlements): loan-penalty collections are
     * already folded into loan_payments.amount, so adding penalty_settlements'
     * loanId-scoped rows on top would double-count them. cashPosition's inputs
     * are UNCHANGED by the live-penalty work below (real cash only).
     *
     * penaltiesCollected / penaltiesWaived are SETTLED facts from
     * penalty_settlements (unchanged). penaltiesOutstanding is the group's LIVE
     * outstanding penalty — contributions + loans, net of settlements — computed
     * by reusing the same live engines group_arrears_summary() and the
     * repayment schedule already use (group_live_contribution_penalty_minor(),
     * compute_loan_penalty()), never by summing penalty_settlements alone
     * (a settlement row only exists once a penalty has been paid or waived, so
     * that sum excludes every unsettled, still-accruing penalty). penaltiesCharged
     * is then the derived identity: collected + waived + outstanding.
     */
    function group_accounting_summary(): void
    {
        $groupId = (string) ($_GET['groupId'] ?? '');
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        require_role($groupId, PAYMENT_ADMIN_ROLES);

        // --- Opt-in period drill-down (J3 slice 1). Present ONLY when the
        // caller passes `figure` — the cumulative path below is completely
        // untouched otherwise. group_accounting_summary_period_drill() always
        // ends in json_response()/json_error(), both of which exit(), so this
        // branch can never fall through into the cumulative code below. ---
        $figureParam = isset($_GET['figure']) ? trim((string) $_GET['figure']) : '';
        if ($figureParam !== '') {
            if (!in_array($figureParam, PAYMENT_ACCOUNTING_DRILL_FIGURES, true)) {
                json_error('figure not available for period drill-down', 422);
            }

            $yearParam = $_GET['year'] ?? null;
            if ($yearParam === null || $yearParam === '' || !ctype_digit((string) $yearParam)) {
                json_error('year is required', 422);
            }
            $yearInt = (int) $yearParam;
            if ($yearInt < 2000 || $yearInt > 2100) {
                json_error('year is required', 422);
            }

            $monthParam = null;
            $monthNumber = null;
            if (isset($_GET['month']) && trim((string) $_GET['month']) !== '') {
                $monthParam = trim((string) $_GET['month']);
                $monthIndex = array_search($monthParam, PAYMENT_MONTHS, true);
                if ($monthIndex === false) {
                    json_error('Invalid month', 422);
                }
                // PAYMENT_MONTHS index is 0-based (January = 0); the calendar
                // month number MYSQL's MONTH() returns is 1-based.
                $monthNumber = $monthIndex + 1;
            }

            group_accounting_summary_period_drill($groupId, $figureParam, $yearInt, $monthParam, $monthNumber);
        }

        $pdo = getDbConnection();

        // --- Settled contributions (total + per-type breakdown). ---
        $stmt = $pdo->prepare(
            "SELECT amountPaid, paymentType FROM payments WHERE groupId = :groupId "
            . "AND approvalStatus IN ('approved', 'completed')"
        );
        $stmt->execute([':groupId' => $groupId]);
        $totalContributedMinor = 0;
        $seedMoneyContributedMinor = 0;
        $monthlyContributionContributedMinor = 0;
        $serviceFeeContributedMinor = 0;
        foreach ($stmt->fetchAll() as $row) {
            $minor = money_to_minor(trim((string) $row['amountPaid']));
            $totalContributedMinor += $minor;
            switch ($row['paymentType']) {
                case 'seed_money':
                    $seedMoneyContributedMinor += $minor;
                    break;
                case 'monthly_contribution':
                    $monthlyContributionContributedMinor += $minor;
                    break;
                case 'service_fee':
                    $serviceFeeContributedMinor += $minor;
                    break;
            }
        }

        // --- Disbursed loans. ---
        $stmt = $pdo->prepare(
            "SELECT principalAmount, remainingBalance FROM loans WHERE groupId = :groupId "
            . "AND status IN ('approved', 'disbursed', 'completed', 'defaulted')"
        );
        $stmt->execute([':groupId' => $groupId]);
        $totalDisbursedMinor = 0;
        $outstandingLoanPrincipalMinor = 0;
        foreach ($stmt->fetchAll() as $row) {
            $totalDisbursedMinor += money_to_minor(trim((string) $row['principalAmount']));
            $outstandingLoanPrincipalMinor += money_to_minor(trim((string) $row['remainingBalance']));
        }

        // --- Loan repayments. ---
        $stmt = $pdo->prepare(
            "SELECT amount, interestPortion FROM loan_payments WHERE groupId = :groupId "
            . "AND status = 'approved'"
        );
        $stmt->execute([':groupId' => $groupId]);
        $loanRepaymentsReceivedMinor = 0;
        $interestEarnedMinor = 0;
        foreach ($stmt->fetchAll() as $row) {
            $loanRepaymentsReceivedMinor += money_to_minor(trim((string) $row['amount']));
            $interestEarnedMinor += money_to_minor(trim((string) $row['interestPortion']));
        }

        // --- Penalty settlements: SETTLED facts only (collected / waived). ---
        $stmt = $pdo->prepare(
            'SELECT amountPaid, amountWaived, paymentId '
            . 'FROM penalty_settlements WHERE groupId = :groupId'
        );
        $stmt->execute([':groupId' => $groupId]);
        $penaltiesCollectedMinor = 0;
        $penaltiesWaivedMinor = 0;
        $contributionPenaltiesCollectedMinor = 0;
        foreach ($stmt->fetchAll() as $row) {
            $paid = money_to_minor(trim((string) $row['amountPaid']));
            $waived = money_to_minor(trim((string) $row['amountWaived']));

            $penaltiesCollectedMinor += $paid;
            $penaltiesWaivedMinor += $waived;

            if ($row['paymentId'] !== null) {
                $contributionPenaltiesCollectedMinor += $paid;
            }
        }

        // --- Live outstanding penalty (contributions + loans, NET of
        // settlements) — the group's TRUE current penalty receivable, not just
        // what has already been settled against penalty_settlements. Reuses
        // the exact same live engines the "Arrears" tile
        // (group_live_contribution_penalty_minor(), shared with
        // group_arrears_summary()) and the loan repayment schedule
        // (compute_loan_penalty(), which already nets its loan's own
        // settlements) already use, so this figure can never drift from those.
        //
        // Contribution penalty is CURRENT-YEAR-SCOPED (date('Y')) — same
        // scope as the year-scoped live engine and the arrears tile; this is
        // deliberately NOT an all-time summation.
        $contributionRules = payment_fetch_rules($pdo, $groupId);
        $loanPenaltyRules = penalty_fetch_rules($pdo, $groupId);
        $year = (int) date('Y');

        $liveContribution = group_live_contribution_penalty_minor($pdo, $groupId, $contributionRules, $year);
        $liveContributionPenaltyMinor = $liveContribution['penaltyMinor'];

        // Loans that can carry a live penalty: an approved-but-undisbursed loan
        // has no repayment schedule yet and a completed loan short-circuits to
        // zero inside compute_loan_penalty() itself, so including them here is
        // harmless — this is the same status set the disbursed-loans query
        // above uses, for consistency.
        $loanStmt = $pdo->prepare(
            "SELECT loanId, status FROM loans WHERE groupId = :groupId "
            . "AND status IN ('approved', 'disbursed', 'completed', 'defaulted')"
        );
        $loanStmt->execute([':groupId' => $groupId]);
        $liveLoanPenaltyMinor = 0;
        foreach ($loanStmt->fetchAll() as $loanRow) {
            // Mirrors repayments.php's repayment_penalty_or_501(): the engine
            // throws rather than guessing when a group's penalty config cannot
            // be honoured (e.g. a percentage mode with no rate configured) — a
            // silently dropped penalty is worse than a failed request.
            try {
                $loanPenalty = compute_loan_penalty($loanRow, $loanPenaltyRules);
            } catch (RuntimeException $e) {
                json_error($e->getMessage(), 501);
            }
            $liveLoanPenaltyMinor += money_to_minor($loanPenalty['amountOutstanding']);
        }

        $penaltiesOutstandingMinor = $liveContributionPenaltyMinor + $liveLoanPenaltyMinor;
        $penaltiesChargedMinor = $penaltiesCollectedMinor + $penaltiesWaivedMinor + $penaltiesOutstandingMinor;

        $cashPositionMinor = $totalContributedMinor
            + $loanRepaymentsReceivedMinor
            + $contributionPenaltiesCollectedMinor
            - $totalDisbursedMinor;

        json_response([
            'totalContributed' => money_from_minor($totalContributedMinor),
            'seedMoneyContributed' => money_from_minor($seedMoneyContributedMinor),
            'monthlyContributionContributed' => money_from_minor($monthlyContributionContributedMinor),
            'serviceFeeContributed' => money_from_minor($serviceFeeContributedMinor),
            'totalDisbursed' => money_from_minor($totalDisbursedMinor),
            'outstandingLoanPrincipal' => money_from_minor($outstandingLoanPrincipalMinor),
            'interestEarned' => money_from_minor($interestEarnedMinor),
            'loanRepaymentsReceived' => money_from_minor($loanRepaymentsReceivedMinor),
            'penaltiesCharged' => money_from_minor($penaltiesChargedMinor),
            'penaltiesCollected' => money_from_minor($penaltiesCollectedMinor),
            'penaltiesWaived' => money_from_minor($penaltiesWaivedMinor),
            'penaltiesOutstanding' => money_from_minor($penaltiesOutstandingMinor),
            'cashPosition' => money_from_minor($cashPositionMinor),
        ]);
    }
}

if (!function_exists('member_group_stats')) {
    /**
     * GET payments.groupStats — the small, member-safe transparency subset of
     * the group's financial position: memberCount, groupTotalContributed,
     * activeLoanCount. MEMBER-GATED (any role in the group may call this) —
     * unlike group_accounting_summary() above, this deliberately excludes
     * cashPosition, penalties, disbursement totals, and any per-member
     * breakdown. Scoped strictly to the caller's own group.
     */
    function member_group_stats(): void
    {
        $groupId = (string) ($_GET['groupId'] ?? '');
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        require_role($groupId, PAYMENT_ANY_MEMBER_ROLES);

        $pdo = getDbConnection();

        // --- Active member count. ---
        $stmt = $pdo->prepare(
            "SELECT COUNT(*) AS n FROM members WHERE groupId = :groupId AND status = 'active'"
        );
        $stmt->execute([':groupId' => $groupId]);
        $memberCount = (int) $stmt->fetch()['n'];

        // --- Settled contributions, summed ROW-WISE via money_to_minor()
        // — never SQL SUM() on a DECIMAL column, never a float. ---
        $stmt = $pdo->prepare(
            "SELECT amountPaid FROM payments WHERE groupId = :groupId "
            . "AND approvalStatus IN ('approved', 'completed')"
        );
        $stmt->execute([':groupId' => $groupId]);
        $totalContributedMinor = 0;
        foreach ($stmt->fetchAll() as $row) {
            $totalContributedMinor += money_to_minor(trim((string) $row['amountPaid']));
        }

        // --- Active loan count. ---
        $stmt = $pdo->prepare(
            // matches LOAN_ACTIVE_STATUSES in loans.php — the codebase's active-loan set
            "SELECT COUNT(*) AS n FROM loans WHERE groupId = :groupId "
            . "AND status IN ('pending', 'approved', 'disbursed')"
        );
        $stmt->execute([':groupId' => $groupId]);
        $activeLoanCount = (int) $stmt->fetch()['n'];

        json_response([
            'memberCount' => $memberCount,
            'groupTotalContributed' => money_from_minor($totalContributedMinor),
            'activeLoanCount' => $activeLoanCount,
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
        // ledger that no rule knows how to pay back.
        //
        // ADVANCE means EARLY, NOT EXTRA. An advance payment is a member settling a
        // month before its due date — a real thing members do, and the group's rules
        // allow it. It is NOT permission to put more money into a month than that
        // month costs. The flag previously skipped the ceiling entirely, so ticking
        // "advance payment" let any amount at all be recorded against an obligation
        // that was already fully settled. The ceiling now applies to every payment;
        // the flag only records that the money arrived early.
        $isAdvance = !empty($body['isAdvancedPayment']) && $paymentType === 'monthly_contribution';

        if ($priorPaidMinor >= $totalMinor) {
            json_error('This obligation is already fully paid.', 409);
        }
        if ($newPaidMinor > $totalMinor) {
            json_error(
                'Payment exceeds the amount due. Outstanding on this obligation: '
                . money_from_minor($totalMinor - $priorPaidMinor) . '.',
                422
            );
        }

        $arrearsMinor = max(0, $totalMinor - $newPaidMinor);

        // --- The penalty portion, if the admin chose to collect it. ---
        //
        // EXPLICIT SPLIT, NOT AN ALLOCATION ORDER. The caller states exactly how
        // much of the cash received is settling the late-payment penalty; the
        // `amount` above is the contribution portion only, so payments.amountPaid
        // keeps its existing meaning (money against THIS obligation) and every
        // figure derived from it is untouched. Deciding "penalty first" or
        // "contribution first" would be inventing an allocation rule the group
        // never wrote — this asks instead.
        //
        // The claim is recorded here but NOT settled: like the contribution, a
        // penalty payment is an assertion until an admin approves it. The
        // penalty_settlements row is written by approve_payment().
        $penaltyClaimMinor = 0;
        if (isset($body['penaltyAmount']) && $body['penaltyAmount'] !== '' && $body['penaltyAmount'] !== null) {
            try {
                $penaltyClaimMinor = money_to_minor(payment_money_input_to_string($body['penaltyAmount']));
            } catch (InvalidArgumentException $e) {
                json_error('penaltyAmount must be an amount with at most 2 decimals.', 422);
            }
            if ($penaltyClaimMinor < 0) {
                json_error('penaltyAmount cannot be negative.', 422);
            }
        }

        if ($penaltyClaimMinor > 0) {
            // What is owed in penalty comes from the ENGINE, never from the client
            // — the same rule as the contribution amount itself. Computed against
            // the position BEFORE this claim (the arrears the penalty accrued on),
            // and net of anything already paid or waived.
            $priorArrearsMinor = max(0, $totalMinor - $priorPaidMinor);
            $existingPaymentId = $existing === null ? null : (string) $existing['paymentId'];
            $livePenalty = payment_penalty_or_501(
                $rules,
                // payment_penalty_due_date, NOT the plain $dueDate above: a month
                // outside the cycle was never owed and so cannot be late. Same
                // helper approve_payment() uses, so the figure quoted here is the
                // figure settled there.
                payment_penalty_due_date($rules, $paymentType, $month, $year),
                $priorArrearsMinor,
                $totalMinor,
                $existingPaymentId
            );
            $penaltyOutstandingMinor = money_to_minor($livePenalty['amountOutstanding']);

            if ($penaltyOutstandingMinor <= 0) {
                json_error('There is no outstanding penalty on this obligation to collect.', 409);
            }
            if ($penaltyClaimMinor > $penaltyOutstandingMinor) {
                json_error(
                    'The penalty payment exceeds the outstanding penalty of '
                    . money_from_minor($penaltyOutstandingMinor) . '.',
                    422
                );
            }
        }

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
                    . 'arrears, penaltyAmountClaimed, approvalStatus, paymentStatus, proofOfPaymentImageUrl, '
                    . 'proofOfPaymentFileName, proofOfPaymentFileSize, proofOfPaymentUploadedBy, '
                    . 'proofOfPaymentUploadedAt, dueDate, paidAt, createdAt, updatedAt, paymentMethod, '
                    . 'notes, recordedManually, isAdvancedPayment) '
                    . 'VALUES (:paymentId, :groupId, :uid, :year, :paymentType, :month, :totalAmount, '
                    . ":amountPaid, :arrears, :penaltyClaim, 'pending', 'Pending', :proofUrl, :proofName, :proofSize, "
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
                    ':penaltyClaim' => money_from_minor($penaltyClaimMinor),
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
                    . 'arrears = :arrears, penaltyAmountClaimed = :penaltyClaim, '
                    . "approvalStatus = 'pending', paymentStatus = 'Pending', "
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
                    ':penaltyClaim' => money_from_minor($penaltyClaimMinor),
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
            // BL-6(b): obligation basis = $totalMinor, the same full-obligation
            // value (from payment_rule_amount_minor) that produced $arrearsMinor
            // above (line ~1749: max(0, $totalMinor - $newPaidMinor)).
            'penalty' => payment_penalty_or_501($rules, $rowDueDate, $arrearsMinor, $totalMinor, $paymentId),
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
     *
     * THE PENALTY HALF. When the claim carried a penalty portion
     * (payments.penaltyAmountClaimed, set by record_payment), this is also the
     * moment that penalty becomes settled: a penalty_settlements row is written
     * in the SAME transaction, status 'paid' or 'partial'. The engine nets
     * settlements off on every subsequent read, so the member stops being charged
     * for days they have now paid for — the exact mechanism
     * waive_contribution_penalty() already uses for forgiveness. Approving the
     * contribution but not its penalty would leave the member paying the same
     * late fee forever.
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

        // The penalty portion the claim carried, if any. Re-priced against the
        // engine below before anything is written — the claim was recorded at an
        // earlier date, and a penalty that has since been waived or paid by
        // another route must not be collected twice.
        $penaltyClaimMinor = money_to_minor(trim((string) ($payment['penaltyAmountClaimed'] ?? '0.00')));
        $penaltySettlement = null;

        if ($penaltyClaimMinor > 0) {
            // The arrears the penalty accrued against are the ones that existed
            // BEFORE this claim was applied to the row: amountPaid already
            // includes the pending claim, so add it back out.
            $paidMinor = money_to_minor(trim((string) $payment['amountPaid']));
            $totalMinor = money_to_minor(trim((string) $payment['totalAmount']));
            $settledNowMinor = payment_settled_minor(
                $pdo,
                $groupId,
                (string) $payment['uid'],
                (string) $payment['paymentType'],
                (int) $payment['year'],
                $payment['month'] === null ? null : (string) $payment['month']
            );
            $priorArrearsMinor = max(0, $totalMinor - $settledNowMinor);

            // The SAME due-date source record_payment() validated the claim
            // against. Using the row's stored dueDate here instead would let the
            // quoted penalty and the settled penalty disagree.
            $livePenalty = payment_penalty_or_501(
                $rules,
                payment_penalty_due_date(
                    $rules,
                    (string) $payment['paymentType'],
                    $payment['month'] === null ? null : (string) $payment['month'],
                    (int) $payment['year']
                ),
                $priorArrearsMinor,
                $totalMinor,
                $paymentId
            );
            $outstandingMinor = money_to_minor($livePenalty['amountOutstanding']);

            // Clamp rather than refuse: the contribution itself is good money that
            // the admin is approving, and failing the whole approval because the
            // penalty shrank between recording and approval would strand a real
            // payment. Collect at most what is actually still owed.
            $collectMinor = min($penaltyClaimMinor, $outstandingMinor);
            if ($collectMinor > 0) {
                $penaltySettlement = [
                    'penalty' => $livePenalty,
                    'collectMinor' => $collectMinor,
                    // 'paid' clears the outstanding penalty in full; 'partial'
                    // leaves a remainder still accruing against the member.
                    'status' => $collectMinor >= $outstandingMinor ? 'paid' : 'partial',
                ];
            }
            unset($paidMinor);
        }

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

            // The penalty becomes a settled fact in the SAME transaction as the
            // contribution it arrived with — same shape as the waiver row in
            // waive_contribution_penalty(), with amountPaid carrying the money and
            // amountWaived left at zero (nothing was forgiven here).
            if ($penaltySettlement !== null) {
                $settlement = $pdo->prepare(
                    'INSERT INTO penalty_settlements '
                    . '(groupId, uid, loanId, paymentId, accruedFrom, accruedTo, daysCharged, '
                    . 'dailyAmount, amountAccrued, amountPaid, amountWaived, status, waivedReason, '
                    . 'settledBy, settledAt, createdAt) '
                    . 'VALUES (:groupId, :uid, NULL, :paymentId, :accruedFrom, :accruedTo, :daysCharged, '
                    . ":dailyAmount, :amountAccrued, :amountPaid, '0.00', :status, NULL, "
                    . ':settledBy, NOW(), NOW())'
                );
                $settlement->execute([
                    ':groupId' => $groupId,
                    ':uid' => $payment['uid'],
                    ':paymentId' => $paymentId,
                    ':accruedFrom' => $penaltySettlement['penalty']['firstChargeableDay'],
                    ':accruedTo' => $penaltySettlement['penalty']['asOf'],
                    ':daysCharged' => $penaltySettlement['penalty']['daysCharged'],
                    ':dailyAmount' => $penaltySettlement['penalty']['dailyAmount'],
                    ':amountAccrued' => $penaltySettlement['penalty']['amountAccrued'],
                    ':amountPaid' => money_from_minor($penaltySettlement['collectMinor']),
                    ':status' => $penaltySettlement['status'],
                    ':settledBy' => $caller['uid'],
                ]);

                // The claim has been converted into a settlement. Zeroing it is
                // what stops a re-approval (or any later read of this column)
                // from banking the same penalty a second time.
                $clearClaim = $pdo->prepare(
                    "UPDATE payments SET penaltyAmountClaimed = '0.00' WHERE paymentId = :paymentId"
                );
                $clearClaim->execute([':paymentId' => $paymentId]);
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
            // What was actually banked against the penalty, so the UI can say so
            // rather than leaving the admin to guess.
            'penaltySettled' => $penaltySettlement === null
                ? '0.00'
                : money_from_minor($penaltySettlement['collectMinor']),
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
                // The penalty half of a refused claim is refused with it. No
                // settlement row was ever written (approve does that), so
                // clearing the column is the whole rollback — and leaving it set
                // would let a later re-approval bank a penalty the admin rejected.
                . "penaltyAmountClaimed = '0.00', "
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
