<?php
/**
 * Loan endpoints: list, get, request, approve, reject.
 *
 * Authorization is re-checked server-side on every call via require_role()
 * against the members table — a borrowerId or role in a request body is never an
 * authorization claim. A plain member can only ever see their OWN loans (the
 * restriction lives in the SQL, not in a UI filter) and can never approve or
 * reject one.
 *
 * Interest is NOT computed at request time. It is computed at approval, by
 * api/lib/money.php, exactly as the live Firebase code does. Loan repayments and
 * penalties are out of scope here.
 */

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/session.php';
require_once __DIR__ . '/../lib/money.php';
require_once __DIR__ . '/../../config/database.php';
// member_arrears_penalties_minor() — the loan eligibility gate/preview needs
// a member's contribution arrears/penalty standing, computed the same way
// payments.obligations shows it to that member.
require_once __DIR__ . '/payments.php';

// Fallbacks used only when a group has no group_rules row at all.
const LOAN_FALLBACK_MIN_MONTHS = 1;
const LOAN_FALLBACK_MAX_MONTHS = 3;
const LOAN_FALLBACK_MAX_ACTIVE_LOANS = 1;

// Statuses that count against a member's active-loan allowance.
const LOAN_ACTIVE_STATUSES = ['pending', 'approved', 'disbursed'];

if (!function_exists('loan_money_input_to_string')) {
    /**
     * Normalise a JSON-decoded money input into a decimal string for
     * money_to_minor(). Strings and ints pass through untouched. A JSON float is
     * formatted to 2dp here — that is a parse of a value we were handed, not
     * arithmetic; no float is ever used to compute money.
     */
    function loan_money_input_to_string($value): string
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

if (!function_exists('loan_fetch_row')) {
    /**
     * Load a loan row by id, or 404. The groupId on the ROW is the authority for
     * the role check that follows — never a groupId from the request body.
     */
    function loan_fetch_row(PDO $pdo, string $loanId): array
    {
        $stmt = $pdo->prepare(
            'SELECT loanId, groupId, loanNumber, borrowerId, borrowerName, borrowerEmail, '
            . 'principalAmount, approvedAmount, status, repaymentPeriod, '
            . 'interestRateMonth1, interestRateMonth2, interestRateMonth3, '
            . 'totalInterest, totalRepayment, monthlyPayment, disbursedAmount, disbursedAt, '
            . 'disbursedBy, disbursementMethod, requestedAt, approvedBy, approvedAt, rejectedBy, '
            . 'rejectedAt, rejectionReason, purpose, collateral, guarantorName, guarantorPhone, '
            . 'guarantorRelationship, amountRepaid, remainingBalance, penaltiesCharged, '
            . 'createdAt, updatedAt, completedAt '
            . 'FROM loans WHERE loanId = :loanId LIMIT 1'
        );
        $stmt->execute([':loanId' => $loanId]);
        $loan = $stmt->fetch();

        if ($loan === false) {
            json_error('Loan not found.', 404);
        }

        return $loan;
    }
}

if (!function_exists('loan_fetch_group_rules')) {
    /**
     * The group's loan rules, or null when the group has no rules row.
     */
    function loan_fetch_group_rules(PDO $pdo, string $groupId): ?array
    {
        $stmt = $pdo->prepare(
            'SELECT loanInterestRateMonth1, loanInterestRateMonth2, loanInterestRateMonth3, '
            . 'loanInterestCalculationMethod, loanRulesMaxLoanAmount, '
            . 'loanRulesMaxActiveLoansByMember, loanRulesMinRepaymentMonths, '
            . 'loanRulesMaxRepaymentMonths, requireArrearsClearedBeforeLoan, '
            . 'requirePenaltiesClearedBeforeLoan '
            . 'FROM group_rules WHERE groupId = :groupId LIMIT 1'
        );
        $stmt->execute([':groupId' => $groupId]);
        $rules = $stmt->fetch();

        return $rules === false ? null : $rules;
    }
}

if (!function_exists('loan_guard_calculation_method')) {
    /**
     * Only reduced_balance exists. flat_rate is in the ENUM but is implemented
     * NOWHERE in this codebase — guessing at it would invent interest charges,
     * so it is refused outright.
     */
    function loan_guard_calculation_method(?array $rules): void
    {
        $method = $rules['loanInterestCalculationMethod'] ?? 'reduced_balance';
        if ($method !== 'reduced_balance') {
            json_error(
                'flat_rate interest is not implemented; group rules must use reduced_balance.',
                501
            );
        }
    }
}

if (!function_exists('loan_resolve_rates')) {
    /**
     * Interest rates for a loan: the rates snapshotted on the loan row win (they
     * are the terms the borrower was quoted), then the group's current rules,
     * then the 10/7/5 declining defaults.
     */
    function loan_resolve_rates(array $loan, ?array $rules): array
    {
        $pick = static function (string $loanKey, string $ruleKey, string $default) use ($loan, $rules): string {
            if (isset($loan[$loanKey]) && $loan[$loanKey] !== null && $loan[$loanKey] !== '') {
                return (string) $loan[$loanKey];
            }
            if ($rules !== null && isset($rules[$ruleKey]) && $rules[$ruleKey] !== null && $rules[$ruleKey] !== '') {
                return (string) $rules[$ruleKey];
            }
            return $default;
        };

        return [
            'month1' => $pick('interestRateMonth1', 'loanInterestRateMonth1', LOAN_DEFAULT_RATE_MONTH1),
            'month2' => $pick('interestRateMonth2', 'loanInterestRateMonth2', LOAN_DEFAULT_RATE_MONTH2),
            'month3' => $pick('interestRateMonth3', 'loanInterestRateMonth3', LOAN_DEFAULT_RATE_MONTH3),
        ];
    }
}

if (!function_exists('list_loans')) {
    function list_loans(): void
    {
        $groupId = (string) ($_GET['groupId'] ?? '');
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        $caller = require_role($groupId, ['member', 'admin', 'senior_admin', 'treasurer']);

        $pdo = getDbConnection();

        $sql = 'SELECT loanId, groupId, loanNumber, borrowerId, borrowerName, borrowerEmail, '
            . 'principalAmount, approvedAmount, status, repaymentPeriod, '
            . 'interestRateMonth1, interestRateMonth2, interestRateMonth3, '
            . 'totalInterest, totalRepayment, monthlyPayment, disbursedAmount, disbursedAt, '
            . 'requestedAt, approvedAt, rejectedAt, rejectionReason, purpose, '
            . 'amountRepaid, remainingBalance, penaltiesCharged, createdAt, updatedAt, completedAt '
            . 'FROM loans WHERE groupId = :groupId';
        $params = [':groupId' => $groupId];

        // Authorization boundary, not a UI filter: a plain member's query can
        // only ever return their own rows.
        if ($caller['role'] === 'member') {
            $sql .= ' AND borrowerId = :uid';
            $params[':uid'] = $caller['uid'];
        }

        $sql .= ' ORDER BY requestedAt DESC';

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        $totalPrincipalMinor = 0;
        $totalOutstandingMinor = 0;
        $totalInterestMinor = 0;
        $activePrincipalMinor = 0;
        foreach ($rows as $row) {
            $principalMinor = money_to_minor(
                trim((string) ($row['approvedAmount'] ?? $row['principalAmount']))
            );
            $totalPrincipalMinor += $principalMinor;
            $totalOutstandingMinor += money_to_minor(trim((string) $row['remainingBalance']));
            $totalInterestMinor += money_to_minor(trim((string) $row['totalInterest']));
            if (in_array((string) $row['status'], ['approved', 'disbursed'], true)) {
                $activePrincipalMinor += $principalMinor;
            }
        }

        json_response([
            'loans' => $rows,
            'summary' => [
                'totalPrincipal' => money_from_minor($totalPrincipalMinor),
                'totalOutstanding' => money_from_minor($totalOutstandingMinor),
                'totalInterest' => money_from_minor($totalInterestMinor),
                'activePrincipal' => money_from_minor($activePrincipalMinor),
            ],
        ]);
    }
}

if (!function_exists('get_loan')) {
    function get_loan(): void
    {
        $loanId = (string) ($_GET['loanId'] ?? '');
        if ($loanId === '') {
            json_error('loanId is required.', 422);
        }

        $pdo = getDbConnection();
        $loan = loan_fetch_row($pdo, $loanId);

        $caller = require_role((string) $loan['groupId'], ['member', 'admin', 'senior_admin', 'treasurer']);

        if ($caller['role'] === 'member' && $loan['borrowerId'] !== $caller['uid']) {
            json_error('You do not have permission to perform this action.', 403);
        }

        $scheduleStmt = $pdo->prepare(
            'SELECT scheduleId, loanId, month, dueDate, principalDue, interestDue, totalDue, '
            . 'amountPaid, balance, status, paidAt '
            . 'FROM loan_repayment_schedule WHERE loanId = :loanId ORDER BY month ASC'
        );
        $scheduleStmt->execute([':loanId' => $loanId]);

        json_response([
            'loan' => $loan,
            'schedule' => $scheduleStmt->fetchAll(),
        ]);
    }
}

if (!function_exists('request_loan')) {
    function request_loan(): void
    {
        $body = read_json_body();
        $groupId = (string) ($body['groupId'] ?? '');

        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        $caller = require_role($groupId, ['member', 'admin', 'senior_admin', 'treasurer']);

        $principal = loan_money_input_to_string($body['principalAmount'] ?? '');
        $period = (int) ($body['repaymentPeriod'] ?? 0);
        $purpose = trim((string) ($body['purpose'] ?? ''));

        try {
            $principalMinor = money_to_minor($principal);
        } catch (InvalidArgumentException $e) {
            json_error('principalAmount must be an amount with at most 2 decimals.', 422);
        }

        if ($principalMinor <= 0) {
            json_error('principalAmount must be greater than zero.', 422);
        }
        if ($purpose === '') {
            json_error('purpose is required.', 422);
        }

        $pdo = getDbConnection();
        $rules = loan_fetch_group_rules($pdo, $groupId);

        // Fail fast: refuse the request rather than accept a loan we could never
        // price at approval.
        loan_guard_calculation_method($rules);

        $maxAmount = $rules['loanRulesMaxLoanAmount'] ?? null;
        if ($maxAmount !== null && $maxAmount !== '' && $principalMinor > money_to_minor((string) $maxAmount)) {
            json_error('principalAmount exceeds the maximum loan amount for this group.', 422);
        }

        $minMonths = (int) ($rules['loanRulesMinRepaymentMonths'] ?? LOAN_FALLBACK_MIN_MONTHS);
        $maxMonths = (int) ($rules['loanRulesMaxRepaymentMonths'] ?? LOAN_FALLBACK_MAX_MONTHS);
        if ($period < $minMonths || $period > $maxMonths) {
            json_error(
                'repaymentPeriod must be between ' . $minMonths . ' and ' . $maxMonths . ' months.',
                422
            );
        }

        // Single source of truth shared with loans.eligibility (loan_eligibility_endpoint)
        // — the modal preview and this server-side gate can never disagree.
        $standing = loan_member_standing($pdo, $groupId, (string) $caller['uid']);
        $eligibility = loan_eligibility_check($rules, $standing);
        if (!$eligibility['eligible']) {
            json_error(implode(' ', $eligibility['reasons']), 409);
        }

        // Denormalised borrower identity comes from the users table, never from
        // the request body.
        $userStmt = $pdo->prepare('SELECT uid, fullName, email FROM users WHERE uid = :uid LIMIT 1');
        $userStmt->execute([':uid' => $caller['uid']]);
        $user = $userStmt->fetch();
        if ($user === false) {
            json_error('Borrower profile not found.', 404);
        }

        $rates = loan_resolve_rates([], $rules);

        $loanId = bin2hex(random_bytes(16));

        // Human-facing sequence number, per group (LN-0001 restarts in each
        // group). Unique PER GROUP via the uq_loans_group_loanNumber(groupId,
        // loanNumber) index applied to the DB (2026-07-22; the original schema
        // had a GLOBAL unique on loanNumber alone, which collided across groups
        // and 500'd the second group's first loan). A concurrent double-request
        // within one group could still collide on the display number; the
        // loanId PK stays unique regardless.
        $seqStmt = $pdo->prepare('SELECT COUNT(*) AS n FROM loans WHERE groupId = :groupId');
        $seqStmt->execute([':groupId' => $groupId]);
        $loanNumber = 'LN-' . str_pad((string) ((int) $seqStmt->fetch()['n'] + 1), 4, '0', STR_PAD_LEFT);

        $insertStmt = $pdo->prepare(
            'INSERT INTO loans '
            . '(loanId, groupId, loanNumber, borrowerId, borrowerName, borrowerEmail, '
            . 'principalAmount, status, repaymentPeriod, '
            . 'interestRateMonth1, interestRateMonth2, interestRateMonth3, '
            . 'totalInterest, totalRepayment, monthlyPayment, requestedAt, purpose, '
            . 'collateral, guarantorName, guarantorPhone, guarantorRelationship, '
            . 'amountRepaid, remainingBalance, penaltiesCharged, createdAt, updatedAt) '
            . 'VALUES (:loanId, :groupId, :loanNumber, :borrowerId, :borrowerName, :borrowerEmail, '
            . ":principalAmount, 'pending', :repaymentPeriod, "
            . ':rate1, :rate2, :rate3, '
            . ":totalInterest, :totalRepayment, :monthlyPayment, NOW(), :purpose, "
            . ':collateral, :guarantorName, :guarantorPhone, :guarantorRelationship, '
            . ":amountRepaid, :remainingBalance, :penaltiesCharged, NOW(), NOW())"
        );

        // Interest is NOT priced at request time — that happens at approval, as
        // in the live implementation. Zeroed, not guessed.
        $insertStmt->execute([
            ':loanId' => $loanId,
            ':groupId' => $groupId,
            ':loanNumber' => $loanNumber,
            ':borrowerId' => $user['uid'],
            ':borrowerName' => $user['fullName'],
            ':borrowerEmail' => $user['email'],
            ':principalAmount' => money_from_minor($principalMinor),
            ':repaymentPeriod' => $period,
            ':rate1' => $rates['month1'],
            ':rate2' => $rates['month2'],
            ':rate3' => $rates['month3'],
            ':totalInterest' => '0.00',
            ':totalRepayment' => '0.00',
            ':monthlyPayment' => '0.00',
            ':purpose' => $purpose,
            ':collateral' => loan_optional_text($body['collateral'] ?? null),
            ':guarantorName' => loan_optional_text($body['guarantorName'] ?? null),
            ':guarantorPhone' => loan_optional_text($body['guarantorPhone'] ?? null),
            ':guarantorRelationship' => loan_optional_text($body['guarantorRelationship'] ?? null),
            ':amountRepaid' => '0.00',
            ':remainingBalance' => '0.00',
            ':penaltiesCharged' => '0.00',
        ]);

        json_response(['loan' => loan_fetch_row($pdo, $loanId)], 201);
    }
}

if (!function_exists('loan_member_standing')) {
    /**
     * A member's current loan standing within a group: active loans, how much
     * of them remains outstanding, and outstanding contribution
     * arrears/penalties (via member_arrears_penalties_minor(), the same figures
     * payments.obligations shows that member).
     *
     * Used by both request_loan() (the server-side gate) and
     * loan_eligibility_endpoint() (loans.eligibility, the read-only preview) so
     * the two can never disagree.
     */
    function loan_member_standing(PDO $pdo, string $groupId, string $uid): array
    {
        $stmt = $pdo->prepare(
            'SELECT loanNumber, status, remainingBalance FROM loans '
            . 'WHERE groupId = :groupId AND borrowerId = :uid '
            . "AND status IN ('" . implode("', '", LOAN_ACTIVE_STATUSES) . "') "
            . 'ORDER BY requestedAt DESC'
        );
        $stmt->execute([':groupId' => $groupId, ':uid' => $uid]);
        $activeLoans = $stmt->fetchAll();

        $totalRemainingMinor = 0;
        foreach ($activeLoans as $loan) {
            $totalRemainingMinor += money_to_minor(trim((string) $loan['remainingBalance']));
        }

        $arrearsPenalties = member_arrears_penalties_minor($groupId, $uid);

        return [
            'activeLoans' => $activeLoans,
            'activeLoanCount' => count($activeLoans),
            'totalRemainingMinor' => $totalRemainingMinor,
            'arrearsMinor' => $arrearsPenalties['arrearsMinor'],
            'penaltiesMinor' => $arrearsPenalties['penaltiesMinor'],
        ];
    }
}

if (!function_exists('loan_eligibility_check')) {
    /**
     * The eligibility verdict for a NEW loan request — the single source of
     * truth enforced server-side by request_loan() AND surfaced read-only by
     * loan_eligibility_endpoint() (loans.eligibility), so a member's preview can
     * never promise something the gate then refuses.
     *
     * NOT applied to force_loan(): a forced loan is an admin override by
     * design (see force_loan()'s docblock) and intentionally bypasses these
     * member-standing gates.
     *
     * @param array|null $rules   group_rules row (or null — group_rules absent
     *                            falls back to LOAN_FALLBACK_MAX_ACTIVE_LOANS
     *                            and no arrears/penalty requirement).
     * @param array      $standing loan_member_standing() output.
     * @return array{eligible: bool, reasons: string[]}
     */
    function loan_eligibility_check(?array $rules, array $standing): array
    {
        $reasons = [];

        $maxActive = (int) ($rules['loanRulesMaxActiveLoansByMember'] ?? LOAN_FALLBACK_MAX_ACTIVE_LOANS);
        if ((int) $standing['activeLoanCount'] >= $maxActive) {
            $reasons[] = 'You already have the maximum number of active loans allowed.';
        }

        $requireArrearsCleared = (int) ($rules['requireArrearsClearedBeforeLoan'] ?? 0) === 1;
        if ($requireArrearsCleared && (int) $standing['arrearsMinor'] > 0) {
            $reasons[] = 'Outstanding arrears of '
                . money_from_minor((int) $standing['arrearsMinor']) . ' must be cleared before requesting a loan.';
        }

        $requirePenaltiesCleared = (int) ($rules['requirePenaltiesClearedBeforeLoan'] ?? 0) === 1;
        if ($requirePenaltiesCleared && (int) $standing['penaltiesMinor'] > 0) {
            $reasons[] = 'Outstanding penalties of '
                . money_from_minor((int) $standing['penaltiesMinor']) . ' must be cleared before requesting a loan.';
        }

        return [
            'eligible' => empty($reasons),
            'reasons' => $reasons,
        ];
    }
}

if (!function_exists('loan_eligibility_endpoint')) {
    /**
     * GET loans.eligibility — a member's own loan standing and eligibility
     * verdict, computed via the SAME loan_eligibility_check() request_loan()
     * enforces, so this preview can never promise a loan the gate then refuses.
     *
     * Member-scoped: a caller only ever sees their OWN standing — mirrors how
     * request_loan() derives the requester from the session, never the body.
     */
    function loan_eligibility_endpoint(): void
    {
        $groupId = (string) ($_GET['groupId'] ?? '');
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        $caller = require_role($groupId, ['member', 'admin', 'senior_admin', 'treasurer']);

        $pdo = getDbConnection();
        $rules = loan_fetch_group_rules($pdo, $groupId);

        $standing = loan_member_standing($pdo, $groupId, (string) $caller['uid']);
        $eligibility = loan_eligibility_check($rules, $standing);

        $activeLoans = [];
        foreach ($standing['activeLoans'] as $loan) {
            $activeLoans[] = [
                'loanNumber' => $loan['loanNumber'],
                'status' => $loan['status'],
                'remainingBalance' => money_from_minor(money_to_minor(trim((string) $loan['remainingBalance']))),
            ];
        }

        $response = [
            'activeLoans' => $activeLoans,
            'activeLoanCount' => $standing['activeLoanCount'],
            'totalRemaining' => money_from_minor((int) $standing['totalRemainingMinor']),
            'arrears' => money_from_minor((int) $standing['arrearsMinor']),
            'penalties' => money_from_minor((int) $standing['penaltiesMinor']),
            'maxActiveLoans' => (int) ($rules['loanRulesMaxActiveLoansByMember'] ?? LOAN_FALLBACK_MAX_ACTIVE_LOANS),
            'requireArrearsCleared' => (int) ($rules['requireArrearsClearedBeforeLoan'] ?? 0) === 1,
            'requirePenaltiesCleared' => (int) ($rules['requirePenaltiesClearedBeforeLoan'] ?? 0) === 1,
            'eligible' => $eligibility['eligible'],
            'reasons' => $eligibility['reasons'],
        ];

        // Optional schedule preview: never let a bad/absent principal or
        // repaymentPeriod 500 — validated the same way request_loan() validates
        // them, just tolerant of absence since this is a read-only preview.
        $principalRaw = $_GET['principal'] ?? null;
        $periodRaw = $_GET['repaymentPeriod'] ?? null;
        if ($principalRaw !== null && $principalRaw !== '' && $periodRaw !== null && $periodRaw !== '') {
            try {
                $previewPrincipalMinor = money_to_minor(trim((string) $principalRaw));
                $previewPeriod = (int) $periodRaw;

                // Same bounds request_loan() enforces (loans.php ~283-290):
                // clamp the preview into range rather than let an
                // out-of-range repaymentPeriod reach compute_loan_schedule(),
                // which loops 1..$period with no internal cap
                // (money.php:159) — an unbounded period is an unbounded
                // loop/payload.
                $previewMinMonths = (int) ($rules['loanRulesMinRepaymentMonths'] ?? LOAN_FALLBACK_MIN_MONTHS);
                $previewMaxMonths = (int) ($rules['loanRulesMaxRepaymentMonths'] ?? LOAN_FALLBACK_MAX_MONTHS);
                if ($previewPeriod > $previewMaxMonths) {
                    $previewPeriod = $previewMaxMonths;
                } elseif ($previewPeriod > 0 && $previewPeriod < $previewMinMonths) {
                    $previewPeriod = $previewMinMonths;
                }

                // Same principal cap request_loan() enforces (loans.php
                // ~278-281) — a preview principal can't exceed the group
                // max either.
                $previewMaxAmount = $rules['loanRulesMaxLoanAmount'] ?? null;
                if ($previewMaxAmount !== null && $previewMaxAmount !== ''
                    && $previewPrincipalMinor > money_to_minor((string) $previewMaxAmount)
                ) {
                    $previewPrincipalMinor = money_to_minor((string) $previewMaxAmount);
                }

                if ($previewPrincipalMinor > 0 && $previewPeriod > 0) {
                    loan_guard_calculation_method($rules);
                    $rates = loan_resolve_rates([], $rules);
                    $computed = compute_loan_schedule(money_from_minor($previewPrincipalMinor), $previewPeriod, $rates);

                    $response['preview'] = [
                        'totalInterest' => $computed['totalInterest'],
                        'totalRepayment' => $computed['totalRepayment'],
                        'monthlyPayment' => $computed['monthlyPayment'],
                        'schedule' => $computed['schedule'],
                    ];
                }
            } catch (InvalidArgumentException $e) {
                // Bad preview input — omit the preview rather than fail the
                // whole eligibility read.
            }
        }

        json_response($response);
    }
}

if (!function_exists('loan_optional_text')) {
    /**
     * An absent/blank optional field is stored as NULL, not as an empty string.
     */
    function loan_optional_text($value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $value = trim($value);

        return $value === '' ? null : $value;
    }
}

if (!function_exists('approve_loan')) {
    function approve_loan(): void
    {
        $body = read_json_body();
        $loanId = (string) ($body['loanId'] ?? '');
        if ($loanId === '') {
            json_error('loanId is required.', 422);
        }

        $pdo = getDbConnection();
        $loan = loan_fetch_row($pdo, $loanId);

        // groupId comes from the loan row; a member can never reach this.
        $caller = require_role((string) $loan['groupId'], ['admin', 'senior_admin', 'treasurer']);

        if ($loan['status'] !== 'pending') {
            json_error('Only a pending loan can be approved.', 409);
        }

        $approvedRaw = $body['approvedAmount'] ?? null;
        $approved = $approvedRaw === null || $approvedRaw === ''
            ? (string) $loan['principalAmount']
            : loan_money_input_to_string($approvedRaw);

        try {
            $approvedMinor = money_to_minor($approved);
        } catch (InvalidArgumentException $e) {
            json_error('approvedAmount must be an amount with at most 2 decimals.', 422);
        }

        if ($approvedMinor <= 0) {
            json_error('approvedAmount must be greater than zero.', 422);
        }
        if ($approvedMinor > money_to_minor((string) $loan['principalAmount'])) {
            json_error('approvedAmount cannot exceed the requested principal.', 422);
        }

        $rules = loan_fetch_group_rules($pdo, (string) $loan['groupId']);
        loan_guard_calculation_method($rules);

        $period = (int) $loan['repaymentPeriod'];
        $rates = loan_resolve_rates($loan, $rules);

        try {
            $computed = compute_loan_schedule(money_from_minor($approvedMinor), $period, $rates);
        } catch (InvalidArgumentException $e) {
            json_error('This loan cannot be priced: ' . $e->getMessage(), 422);
        }

        // Due dates run from approval; disbursement has not happened yet.
        // PHP's '+N month' overflows a short month the same way JS setMonth()
        // does (31 Jan + 1 month => 3 Mar), which keeps us bug-compatible with
        // the live implementation.
        $anchor = new DateTimeImmutable('now');

        // The loan row and its schedule are one financial record. An approved
        // loan with no schedule is corrupt — both writes land, or neither does.
        $pdo->beginTransaction();
        try {
            $updateStmt = $pdo->prepare(
                "UPDATE loans SET status = 'approved', approvedAmount = :approvedAmount, "
                . 'approvedBy = :approvedBy, approvedAt = NOW(), totalInterest = :totalInterest, '
                . 'totalRepayment = :totalRepayment, monthlyPayment = :monthlyPayment, '
                . 'remainingBalance = :remainingBalance, updatedAt = NOW() '
                . "WHERE loanId = :loanId AND status = 'pending'"
            );
            $updateStmt->execute([
                ':approvedAmount' => money_from_minor($approvedMinor),
                ':approvedBy' => $caller['uid'],
                ':totalInterest' => $computed['totalInterest'],
                ':totalRepayment' => $computed['totalRepayment'],
                ':monthlyPayment' => $computed['monthlyPayment'],
                ':remainingBalance' => $computed['totalRepayment'],
                ':loanId' => $loanId,
            ]);

            // Guards against a concurrent approval that won the race.
            if ($updateStmt->rowCount() !== 1) {
                $pdo->rollBack();
                json_error('Only a pending loan can be approved.', 409);
            }

            $scheduleStmt = $pdo->prepare(
                'INSERT INTO loan_repayment_schedule '
                . '(loanId, month, dueDate, principalDue, interestDue, totalDue, '
                . 'amountPaid, balance, status) '
                . "VALUES (:loanId, :month, :dueDate, :principalDue, :interestDue, :totalDue, "
                . ":amountPaid, :balance, 'pending')"
            );

            foreach ($computed['schedule'] as $row) {
                $dueDate = $anchor->modify('+' . (int) $row['month'] . ' month');
                $scheduleStmt->execute([
                    ':loanId' => $loanId,
                    ':month' => (int) $row['month'],
                    ':dueDate' => $dueDate->format('Y-m-d H:i:s'),
                    ':principalDue' => $row['principalDue'],
                    ':interestDue' => $row['interestDue'],
                    ':totalDue' => $row['totalDue'],
                    ':amountPaid' => '0.00',
                    ':balance' => $row['totalDue'],
                ]);
            }

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        $scheduleSelect = $pdo->prepare(
            'SELECT scheduleId, loanId, month, dueDate, principalDue, interestDue, totalDue, '
            . 'amountPaid, balance, status, paidAt '
            . 'FROM loan_repayment_schedule WHERE loanId = :loanId ORDER BY month ASC'
        );
        $scheduleSelect->execute([':loanId' => $loanId]);

        json_response([
            'loan' => loan_fetch_row($pdo, $loanId),
            'schedule' => $scheduleSelect->fetchAll(),
        ]);
    }
}

if (!function_exists('reject_loan')) {
    function reject_loan(): void
    {
        $body = read_json_body();
        $loanId = (string) ($body['loanId'] ?? '');
        $reason = trim((string) ($body['rejectionReason'] ?? ''));

        if ($loanId === '') {
            json_error('loanId is required.', 422);
        }
        if ($reason === '') {
            json_error('rejectionReason is required.', 422);
        }

        $pdo = getDbConnection();
        $loan = loan_fetch_row($pdo, $loanId);

        $caller = require_role((string) $loan['groupId'], ['admin', 'senior_admin', 'treasurer']);

        if ($loan['status'] !== 'pending') {
            json_error('Only a pending loan can be rejected.', 409);
        }

        $stmt = $pdo->prepare(
            "UPDATE loans SET status = 'rejected', rejectedBy = :rejectedBy, rejectedAt = NOW(), "
            . 'rejectionReason = :rejectionReason, updatedAt = NOW() '
            . "WHERE loanId = :loanId AND status = 'pending'"
        );
        $stmt->execute([
            ':rejectedBy' => $caller['uid'],
            ':rejectionReason' => $reason,
            ':loanId' => $loanId,
        ]);

        if ($stmt->rowCount() !== 1) {
            json_error('Only a pending loan can be rejected.', 409);
        }

        json_response(['loan' => loan_fetch_row($pdo, $loanId)]);
    }
}

if (!function_exists('force_loan')) {
    /**
     * Forced loan — an admin/senior_admin/treasurer originates a loan ON BEHALF OF
     * a member who is behind the group's per-cycle borrowing target
     * (group_rules.loanRulesMinCycleLoanAmount).
     *
     * WHY THIS EXISTS: at cycle end each member is refunded the interest THEY
     * personally paid. A member who never borrows pays no interest and so takes
     * almost nothing out of the share-out. The group therefore pushes loans onto
     * under-borrowers so that everyone borrows, pays, and is refunded roughly
     * equally.
     *
     * A forced loan is an ORDINARY loan: same interest engine, same schedule, same
     * repayment obligation. The only difference is who originated it — hence it is
     * created already 'approved', with isForced/forcedBy/forcedReason recorded as
     * the audit trail for a decision the borrower did not make.
     */
    function force_loan(): void
    {
        $body = read_json_body();
        $groupId = (string) ($body['groupId'] ?? '');
        $borrowerId = (string) ($body['borrowerId'] ?? '');
        $forcedReason = trim((string) ($body['forcedReason'] ?? ''));

        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }
        if ($borrowerId === '') {
            json_error('borrowerId is required.', 422);
        }
        if ($forcedReason === '') {
            json_error('forcedReason is required.', 422);
        }

        $caller = require_role($groupId, ['admin', 'senior_admin', 'treasurer']);

        // Self-dealing guard. Forcing a loan creates an interest obligation that
        // converts into a cycle-end payout, so no one may originate one against
        // their own account unilaterally.
        if ($borrowerId === $caller['uid']) {
            json_error('An admin cannot force a loan onto themselves.', 403);
        }

        $principal = loan_money_input_to_string($body['principalAmount'] ?? '');
        $period = (int) ($body['repaymentPeriod'] ?? 0);

        try {
            $principalMinor = money_to_minor($principal);
        } catch (InvalidArgumentException $e) {
            json_error('principalAmount must be an amount with at most 2 decimals.', 422);
        }

        if ($principalMinor <= 0) {
            json_error('principalAmount must be greater than zero.', 422);
        }

        $pdo = getDbConnection();

        // The borrower must be a member of THIS group, and active.
        $memberStmt = $pdo->prepare(
            'SELECT uid, status FROM members WHERE groupId = :groupId AND uid = :uid LIMIT 1'
        );
        $memberStmt->execute([':groupId' => $groupId, ':uid' => $borrowerId]);
        $member = $memberStmt->fetch();

        if ($member === false) {
            json_error('Borrower is not a member of this group.', 404);
        }
        if ($member['status'] !== 'active') {
            json_error('Borrower is not an active member of this group.', 409);
        }

        $rules = loan_fetch_group_rules($pdo, $groupId);
        loan_guard_calculation_method($rules);

        $maxAmount = $rules['loanRulesMaxLoanAmount'] ?? null;
        if ($maxAmount !== null && $maxAmount !== '' && $principalMinor > money_to_minor((string) $maxAmount)) {
            json_error('principalAmount exceeds the maximum loan amount for this group.', 422);
        }

        $minMonths = (int) ($rules['loanRulesMinRepaymentMonths'] ?? LOAN_FALLBACK_MIN_MONTHS);
        $maxMonths = (int) ($rules['loanRulesMaxRepaymentMonths'] ?? LOAN_FALLBACK_MAX_MONTHS);
        if ($period < $minMonths || $period > $maxMonths) {
            json_error(
                'repaymentPeriod must be between ' . $minMonths . ' and ' . $maxMonths . ' months.',
                422
            );
        }

        // loanRulesMaxActiveLoansByMember is deliberately NOT enforced here. That
        // cap governs how much a member may borrow of their own volition; a forced
        // loan is precisely the case where the group overrides the member's own
        // borrowing behaviour, so the cap does not apply.

        // Denormalised borrower identity comes from the users table, never the body.
        $userStmt = $pdo->prepare('SELECT uid, fullName, email FROM users WHERE uid = :uid LIMIT 1');
        $userStmt->execute([':uid' => $borrowerId]);
        $user = $userStmt->fetch();
        if ($user === false) {
            json_error('Borrower profile not found.', 404);
        }

        $rates = loan_resolve_rates([], $rules);

        try {
            $computed = compute_loan_schedule(money_from_minor($principalMinor), $period, $rates);
        } catch (InvalidArgumentException $e) {
            json_error('This loan cannot be priced: ' . $e->getMessage(), 422);
        }

        $loanId = bin2hex(random_bytes(16));

        $seqStmt = $pdo->prepare('SELECT COUNT(*) AS n FROM loans WHERE groupId = :groupId');
        $seqStmt->execute([':groupId' => $groupId]);
        $loanNumber = 'LN-' . str_pad((string) ((int) $seqStmt->fetch()['n'] + 1), 4, '0', STR_PAD_LEFT);

        // Due dates run from origination, exactly as approve_loan() anchors them.
        $anchor = new DateTimeImmutable('now');

        // The loan row and its schedule are ONE financial record. A forced loan
        // with no schedule is a corrupt record: both land, or neither does.
        $pdo->beginTransaction();
        try {
            $insertStmt = $pdo->prepare(
                'INSERT INTO loans '
                . '(loanId, groupId, loanNumber, borrowerId, borrowerName, borrowerEmail, '
                . 'principalAmount, approvedAmount, status, repaymentPeriod, '
                . 'interestRateMonth1, interestRateMonth2, interestRateMonth3, '
                . 'totalInterest, totalRepayment, monthlyPayment, '
                . 'isForced, forcedBy, forcedReason, '
                . 'requestedAt, approvedBy, approvedAt, purpose, '
                . 'amountRepaid, remainingBalance, penaltiesCharged, createdAt, updatedAt) '
                . 'VALUES (:loanId, :groupId, :loanNumber, :borrowerId, :borrowerName, :borrowerEmail, '
                . ":principalAmount, :approvedAmount, 'approved', :repaymentPeriod, "
                . ':rate1, :rate2, :rate3, '
                . ':totalInterest, :totalRepayment, :monthlyPayment, '
                . '1, :forcedBy, :forcedReason, '
                . 'NOW(), :approvedBy, NOW(), :purpose, '
                . ":amountRepaid, :remainingBalance, :penaltiesCharged, NOW(), NOW())"
            );
            $insertStmt->execute([
                ':loanId' => $loanId,
                ':groupId' => $groupId,
                ':loanNumber' => $loanNumber,
                ':borrowerId' => $user['uid'],
                ':borrowerName' => $user['fullName'],
                ':borrowerEmail' => $user['email'],
                ':principalAmount' => money_from_minor($principalMinor),
                ':approvedAmount' => money_from_minor($principalMinor),
                ':repaymentPeriod' => $period,
                ':rate1' => $rates['month1'],
                ':rate2' => $rates['month2'],
                ':rate3' => $rates['month3'],
                ':totalInterest' => $computed['totalInterest'],
                ':totalRepayment' => $computed['totalRepayment'],
                ':monthlyPayment' => $computed['monthlyPayment'],
                ':forcedBy' => $caller['uid'],
                ':forcedReason' => $forcedReason,
                ':approvedBy' => $caller['uid'],
                ':purpose' => 'Forced loan: ' . $forcedReason,
                ':amountRepaid' => '0.00',
                ':remainingBalance' => $computed['totalRepayment'],
                ':penaltiesCharged' => '0.00',
            ]);

            $scheduleStmt = $pdo->prepare(
                'INSERT INTO loan_repayment_schedule '
                . '(loanId, month, dueDate, principalDue, interestDue, totalDue, '
                . 'amountPaid, balance, status) '
                . 'VALUES (:loanId, :month, :dueDate, :principalDue, :interestDue, :totalDue, '
                . ":amountPaid, :balance, 'pending')"
            );

            foreach ($computed['schedule'] as $row) {
                $dueDate = $anchor->modify('+' . (int) $row['month'] . ' month');
                $scheduleStmt->execute([
                    ':loanId' => $loanId,
                    ':month' => (int) $row['month'],
                    ':dueDate' => $dueDate->format('Y-m-d H:i:s'),
                    ':principalDue' => $row['principalDue'],
                    ':interestDue' => $row['interestDue'],
                    ':totalDue' => $row['totalDue'],
                    ':amountPaid' => '0.00',
                    ':balance' => $row['totalDue'],
                ]);
            }

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        $scheduleSelect = $pdo->prepare(
            'SELECT scheduleId, loanId, month, dueDate, principalDue, interestDue, totalDue, '
            . 'amountPaid, balance, status, paidAt '
            . 'FROM loan_repayment_schedule WHERE loanId = :loanId ORDER BY month ASC'
        );
        $scheduleSelect->execute([':loanId' => $loanId]);

        json_response([
            'loan' => loan_fetch_row($pdo, $loanId),
            'schedule' => $scheduleSelect->fetchAll(),
        ], 201);
    }
}
