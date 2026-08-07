<?php
/**
 * Group rules endpoint: update the group's money/policy configuration.
 *
 * SENIOR ADMIN ONLY. This row is the ONLY source of truth for what a member
 * owes and how interest/penalties are computed elsewhere in the app (see
 * api/handlers/payments.php, api/handlers/repayments.php, api/handlers/loans.php).
 * A client-supplied key never reaches SQL: the SET clause is assembled from a
 * hardcoded literal-fragment whitelist, exactly like update_group() in
 * api/handlers/groups.php.
 */

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/session.php';
require_once __DIR__ . '/../lib/money.php';
require_once __DIR__ . '/../../config/database.php';

const RULES_SELECT_COLUMNS = 'groupId, '
    . 'seedMoneyAmount, seedMoneyDueDate, seedMoneyRequired, seedMoneyAllowPartialPayment, '
    . 'seedMoneyMaxPaymentMonths, seedMoneyMustBeFullyPaid, '
    . 'monthlyContributionAmount, monthlyContributionRequired, monthlyContributionDayOfMonth, '
    . 'monthlyContributionAllowPartialPayment, '
    . 'serviceFeeAmount, serviceFeeRequired, serviceFeeDueDate, serviceFeePerCycle, '
    . 'serviceFeeNonRefundable, serviceFeeDescription, '
    . 'loanInterestRateMonth1, loanInterestRateMonth2, loanInterestRateMonth3, '
    . 'loanInterestCalculationMethod, loanInterestMaxRepaymentMonths, '
    . 'loanPenaltyRate, loanPenaltyType, loanPenaltyGracePeriodDays, loanPenaltyDailyAmount, '
    . 'loanPenaltyPeriod, loanPenaltyMonthlyAmount, '
    . 'contributionPenaltyDailyRate, contributionPenaltyMonthlyRate, contributionPenaltyType, '
    . 'contributionPenaltyGracePeriodDays, contributionPenaltyDailyAmount, shareOutPenalties, '
    . 'shareOutInterestMethod, shareOutReturnsCapital, loanPenaltyEnabled, contributionPenaltyEnabled, '
    . 'contributionPenaltyPeriod, contributionPenaltyMonthlyAmount, '
    . 'cycleDurationStartDate, cycleDurationEndDate, cycleDurationMonths, cycleDurationAutoRenew, '
    . 'loanRulesMaxLoanAmount, loanRulesMinCycleLoanAmount, loanRulesMaxActiveLoansByMember, '
    . 'loanRulesRequireCollateral, loanRulesMinRepaymentMonths, loanRulesMaxRepaymentMonths, '
    . 'requireArrearsClearedBeforeLoan, requirePenaltiesClearedBeforeLoan, '
    . 'forcedLoansEnabled, forcedLoansMethod, forcedLoansPercentageOfHighest, '
    // Loan booking deadlines (migration 011)
    . 'loanBookingDay, lastLoanMonth, minMembershipMonths, '
    // Amount-banded max repayment term (owner constitution, 2026-08-07) —
    // see loan_term_bounds_for_principal() in api/handlers/loans.php, the
    // single reader shared by both loan-request enforcement sites and the
    // loans.eligibility preview. Disabled by default (loanTermBandEnabled =
    // 0), so a group that has never configured this behaves exactly as
    // before these columns existed.
    . 'loanTermBandEnabled, loanTermBandThreshold, '
    . 'loanTermBandLowerMaxMonths, loanTermBandUpperMaxMonths';

if (!function_exists('rules_select_row')) {
    function rules_select_row(PDO $pdo, string $groupId): ?array
    {
        $stmt = $pdo->prepare(
            'SELECT ' . RULES_SELECT_COLUMNS . ' FROM group_rules WHERE groupId = :groupId LIMIT 1'
        );
        $stmt->execute([':groupId' => $groupId]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }
}

if (!function_exists('rules_ensure_row')) {
    /**
     * Ensure a group_rules row exists for $groupId — idempotent upsert via the
     * table's uq_group_rules_groupId UNIQUE key, so calling this against a
     * group that already has a rules row is a no-op.
     *
     * Used by create_group() to give every group a rules row from birth, and
     * by get_rules()/update_rules() to self-heal a group created before that
     * insert existed. Only groupId and cycleDurationStartDate lack a schema
     * default; every other money/rate/grace column falls back to the DEFAULT
     * already declared in database/migrations/001, so this does not invent
     * any money figure — 0.00/disabled until an admin explicitly configures
     * it via rules.update.
     *
     * Exception: loanPenaltyType / contributionPenaltyType. Their schema
     * DEFAULT is 'percentage' (migrations/001, widened by /005), but
     * api/lib/penalty.php and api/handlers/payments.php implement ONLY the
     * 'fixed' daily-amount mode — 'percentage' throws and the penalty
     * endpoints 501. Leaving the schema default in place would mean every
     * new group is born with a penalty policy the app cannot compute.
     * Overriding it here to 'fixed' is deliberately targeted at just these
     * two columns, the same way migration 005 changed only the columns it
     * needed to rather than rewriting the schema DEFAULT — an admin can
     * still switch a group to 'percentage' later via rules.update once/if
     * that mode is implemented.
     *
     * Takes the caller's PDO and never opens its own transaction/commit/
     * rollback, so it is safe to call both inside create_group()'s existing
     * transaction and standalone from get_rules()/update_rules().
     */
    function rules_ensure_row(PDO $pdo, string $groupId): void
    {
        $stmt = $pdo->prepare(
            'INSERT INTO group_rules (groupId, cycleDurationStartDate, loanPenaltyType, contributionPenaltyType) '
            . "VALUES (:groupId, NOW(), 'fixed', 'fixed') "
            . 'ON DUPLICATE KEY UPDATE groupId = groupId'
        );
        $stmt->execute([':groupId' => $groupId]);
    }
}

if (!function_exists('rules_money_string')) {
    /**
     * Validate a client-supplied value as a non-negative money amount and
     * return its normalised decimal string. Rejects a negative outright —
     * money/rate columns must never go below zero.
     */
    function rules_money_string($value, string $field): string
    {
        if (is_int($value)) {
            $str = (string) $value;
        } elseif (is_float($value)) {
            $str = sprintf('%.2f', $value);
        } elseif (is_string($value)) {
            $str = trim($value);
        } else {
            json_error($field . ' must be a numeric amount.', 422);
        }

        try {
            $minor = money_to_minor($str);
        } catch (InvalidArgumentException $e) {
            json_error($field . ' must be an amount with at most 2 decimals.', 422);
        }

        if ($minor < 0) {
            json_error($field . ' cannot be negative.', 422);
        }

        return money_from_minor($minor);
    }
}

if (!function_exists('rules_rate_string')) {
    /**
     * Validate a client-supplied interest rate (DECIMAL(5,2), non-negative)
     * and return its normalised decimal string.
     */
    function rules_rate_string($value, string $field): string
    {
        if (is_int($value)) {
            $str = (string) $value;
        } elseif (is_float($value)) {
            $str = sprintf('%.2f', $value);
        } elseif (is_string($value)) {
            $str = trim($value);
        } else {
            json_error($field . ' must be a numeric rate.', 422);
        }

        try {
            $hundredths = money_rate_to_hundredths($str);
        } catch (InvalidArgumentException $e) {
            json_error($field . ' must be a rate with at most 2 decimals.', 422);
        }

        if ($hundredths < 0) {
            json_error($field . ' cannot be negative.', 422);
        }

        return money_from_minor($hundredths);
    }
}

if (!function_exists('rules_penalty_rate_string')) {
    /**
     * Validate a client-supplied PENALTY rate (DECIMAL(5,2)) and return its
     * normalised decimal string. Unlike rules_rate_string() (used for interest
     * and forced-loan percentages, which the schema allows up to 999.99),
     * penalty rates are additionally capped at 100 — an owner decision (see
     * BUILD_PLAN.md "Penalty rate bound (J2)"): a per-period penalty rate
     * above 100% is almost certainly an input error, and the cap can be
     * raised later if a group genuinely wants one. Rejects at 422, never
     * silently truncates or clamps.
     */
    function rules_penalty_rate_string($value, string $field): string
    {
        $str = rules_rate_string($value, $field);

        if (money_to_minor($str) > 10000) {
            json_error($field . ' cannot exceed 100 percent.', 422);
        }

        return $str;
    }
}

if (!function_exists('rules_nonneg_int')) {
    /**
     * Validate a client-supplied value as a non-negative integer (grace
     * periods, day-of-month, repayment month counts).
     */
    function rules_nonneg_int($value, string $field): int
    {
        if (!is_numeric($value)) {
            json_error($field . ' must be a whole number.', 422);
        }

        $intVal = (int) $value;
        if ($intVal < 0 || (string) $intVal !== (string) (int) (float) $value) {
            json_error($field . ' must be a non-negative whole number.', 422);
        }

        return $intVal;
    }
}

if (!function_exists('get_rules')) {
    /**
     * GET rules.get — fetch the group's current group_rules row. Used both by
     * the admin loan-page settings modal (to prefill before rules.update) AND by
     * ordinary members viewing the rules (view_rules page): every member must be
     * able to see the terms they are bound by — the seed/contribution/interest/
     * penalty amounts are not sensitive. Writing them stays senior_admin-only
     * (update_rules); reading them is open to any member of the group.
     * Reuses RULES_SELECT_COLUMNS / rules_select_row() so the column list is
     * never duplicated.
     */
    function get_rules(): void
    {
        $groupId = trim((string) ($_GET['groupId'] ?? ''));
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        $caller = require_role($groupId, ['member', 'admin', 'senior_admin', 'treasurer']);

        $pdo = getDbConnection();
        $rules = rules_select_row($pdo, $groupId);

        if ($rules === null) {
            // Self-heal only for senior_admin — this is the same privilege
            // level that can write rules via update_rules(). A plain
            // member/admin/treasurer read must never trigger a write, so
            // they keep the original 404 verbatim.
            if ($caller['role'] === 'senior_admin') {
                rules_ensure_row($pdo, $groupId);
                $rules = rules_select_row($pdo, $groupId);
            }

            if ($rules === null) {
                json_error('This group has no rules configured yet.', 404);
            }
        }

        json_response($rules);
    }
}

if (!function_exists('update_rules')) {
    /**
     * POST rules.update — SENIOR ADMIN ONLY. Money rules are the top
     * privilege alongside role changes and deletion, because they decide what
     * every member in the group owes and how they are charged.
     */
    function update_rules(): void
    {
        $body = read_json_body();
        $groupId = (string) ($body['groupId'] ?? '');

        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        require_role($groupId, ['senior_admin']);

        $pdo = getDbConnection();

        $existing = rules_select_row($pdo, $groupId);
        if ($existing === null) {
            // Caller is already senior_admin-gated above, so self-healing a
            // missing row here (a group created before create_group() wrote
            // one) needs no additional check.
            rules_ensure_row($pdo, $groupId);
            $existing = rules_select_row($pdo, $groupId);
        }

        // Explicit whitelist of literal column fragments — never build the SET
        // clause from raw client keys. Only money/policy columns that actually
        // exist per database/migrations/001,005,006 are reachable here.
        $updates = [];
        $params = [':groupId' => $groupId];

        if (array_key_exists('seedMoneyAmount', $body)) {
            $updates[] = 'seedMoneyAmount = :seedMoneyAmount';
            $params[':seedMoneyAmount'] = rules_money_string($body['seedMoneyAmount'], 'seedMoneyAmount');
        }

        /* WHETHER an obligation applies at all — not just how much it is.
           These three columns exist and get_rules() already returns them, but
           update_rules() had no writer, so they were permanently stuck at their
           schema defaults (seed money and monthly contributions REQUIRED, service
           fee not). A group that does not use seed money therefore still carried
           a required seed obligation of 0.00, which is the shape that bars
           borrowing on "unpaid seed" and puts a meaningless line in every
           member's what-I-owe. Now settable, so "we don't run this obligation"
           is a real stored answer.
           Additive and opt-in: a caller that omits the key changes nothing. */
        foreach (
            [
                'seedMoneyRequired',
                'monthlyContributionRequired',
                'serviceFeeRequired',
            ] as $flag
        ) {
            if (!array_key_exists($flag, $body)) {
                continue;
            }
            $bool = filter_var($body[$flag], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($bool === null) {
                json_error($flag . ' must be a boolean value.', 422);
            }
            $updates[] = $flag . ' = :' . $flag;
            $params[':' . $flag] = $bool ? 1 : 0;
        }

        /* CYCLE LENGTH. Also read-only until now, so every group was pinned to
           the schema default of 12 months with no way to change it — and this
           column is not cosmetic: payment_cycle_months_to_date() uses it to
           decide which months a group is actually owed for. A constitution
           running an 11-month cycle (the common shape — share out in December)
           could not be expressed at all. */
        if (array_key_exists('cycleDurationMonths', $body)) {
            $months = filter_var($body['cycleDurationMonths'], FILTER_VALIDATE_INT);
            if ($months === false || $months < 1 || $months > 60) {
                json_error('cycleDurationMonths must be a whole number between 1 and 60.', 422);
            }
            $updates[] = 'cycleDurationMonths = :cycleDurationMonths';
            $params[':cycleDurationMonths'] = $months;
        }

        /* Whether a loan needs declared collateral. Constitutions differ on
           this; the column existed and defaulted to off, with no way to opt in. */
        if (array_key_exists('loanRulesRequireCollateral', $body)) {
            $bool = filter_var(
                $body['loanRulesRequireCollateral'],
                FILTER_VALIDATE_BOOLEAN,
                FILTER_NULL_ON_FAILURE
            );
            if ($bool === null) {
                json_error('loanRulesRequireCollateral must be a boolean value.', 422);
            }
            $updates[] = 'loanRulesRequireCollateral = :loanRulesRequireCollateral';
            $params[':loanRulesRequireCollateral'] = $bool ? 1 : 0;
        }

        if (array_key_exists('monthlyContributionAmount', $body)) {
            $updates[] = 'monthlyContributionAmount = :monthlyContributionAmount';
            $params[':monthlyContributionAmount'] = rules_money_string(
                $body['monthlyContributionAmount'],
                'monthlyContributionAmount'
            );
        }

        if (array_key_exists('monthlyContributionDayOfMonth', $body)) {
            $day = rules_nonneg_int($body['monthlyContributionDayOfMonth'], 'monthlyContributionDayOfMonth');
            if ($day < 1 || $day > 31) {
                json_error('monthlyContributionDayOfMonth must be between 1 and 31.', 422);
            }
            $updates[] = 'monthlyContributionDayOfMonth = :monthlyContributionDayOfMonth';
            $params[':monthlyContributionDayOfMonth'] = $day;
        }

        if (array_key_exists('serviceFeeAmount', $body)) {
            $updates[] = 'serviceFeeAmount = :serviceFeeAmount';
            $params[':serviceFeeAmount'] = rules_money_string($body['serviceFeeAmount'], 'serviceFeeAmount');
        }

        if (array_key_exists('loanInterestRateMonth1', $body)) {
            $updates[] = 'loanInterestRateMonth1 = :loanInterestRateMonth1';
            $params[':loanInterestRateMonth1'] = rules_rate_string(
                $body['loanInterestRateMonth1'],
                'loanInterestRateMonth1'
            );
        }

        if (array_key_exists('loanInterestRateMonth2', $body)) {
            $updates[] = 'loanInterestRateMonth2 = :loanInterestRateMonth2';
            $params[':loanInterestRateMonth2'] = rules_rate_string(
                $body['loanInterestRateMonth2'],
                'loanInterestRateMonth2'
            );
        }

        if (array_key_exists('loanInterestRateMonth3', $body)) {
            $updates[] = 'loanInterestRateMonth3 = :loanInterestRateMonth3';
            $params[':loanInterestRateMonth3'] = rules_rate_string(
                $body['loanInterestRateMonth3'],
                'loanInterestRateMonth3'
            );
        }

        // loanInterestCalculationMethod: ENUM('reduced_balance','flat_rate').
        // Both are implemented as of J4 — reduced_balance charges interest on the
        // reducing balance, flat_rate on the original principal for the full
        // term. Validated against the ENUM here so a typo can never reach
        // compute_loan_schedule(), which would then throw mid-approval.
        //
        // This changes the PRICE of every future loan in the group, so it is a
        // senior_admin decision like every other rule on this endpoint, and it is
        // never applied retroactively: an existing loan keeps the rates and
        // schedule it was approved on (loan_resolve_rates prefers the loan row's
        // own snapshot).
        if (array_key_exists('loanInterestCalculationMethod', $body)) {
            $method = $body['loanInterestCalculationMethod'];
            if ($method !== 'reduced_balance' && $method !== 'flat_rate') {
                json_error(
                    "loanInterestCalculationMethod must be exactly 'reduced_balance' or 'flat_rate'.",
                    422
                );
            }
            $updates[] = 'loanInterestCalculationMethod = :loanInterestCalculationMethod';
            $params[':loanInterestCalculationMethod'] = $method;
        }

        // loanPenaltyType / contributionPenaltyType: ENUM('percentage','fixed')
        // per database/migrations/001 (loanPenaltyType) and /005 (widened
        // contributionPenaltyType).
        //
        // As of J2 Slice 1A (cycle 120), api/lib/penalty.php implements BOTH
        // modes for LOANS (fixed and percentage, each in day or month period —
        // see loanPenaltyPeriod below). The CONTRIBUTION engine
        // (api/handlers/payments.php) still implements only 'fixed';
        // 'percentage' there still throws a RuntimeException the handler
        // surfaces as a 501 — that engine change is J2 Slice 1B, dispatched
        // separately. Both values are accepted here regardless: rejecting
        // 'percentage' at the whitelist would make it impossible for an admin
        // to even SEE the value their group is misconfigured with (rules.get
        // returns whatever is in the column), and the config landing once here
        // means 1B needs no further whitelist change. The actual guard against
        // an unimplemented mode lives at the point of use, which is the
        // correct place to block real money computation — not here, where it
        // would only block visibility.
        if (array_key_exists('loanPenaltyType', $body)) {
            $type = $body['loanPenaltyType'];
            if ($type !== 'percentage' && $type !== 'fixed') {
                json_error("loanPenaltyType must be exactly 'percentage' or 'fixed'.", 422);
            }
            $updates[] = 'loanPenaltyType = :loanPenaltyType';
            $params[':loanPenaltyType'] = $type;
        }

        if (array_key_exists('contributionPenaltyType', $body)) {
            $type = $body['contributionPenaltyType'];
            if ($type !== 'percentage' && $type !== 'fixed') {
                json_error("contributionPenaltyType must be exactly 'percentage' or 'fixed'.", 422);
            }
            $updates[] = 'contributionPenaltyType = :contributionPenaltyType';
            $params[':contributionPenaltyType'] = $type;
        }

        // loanPenaltyPeriod / contributionPenaltyPeriod: ENUM('day','month')
        // NOT NULL DEFAULT 'day' (J2 Slice 1A DDL). Selects which charging
        // period a group's penalty (fixed OR percentage) accrues against —
        // validated exactly like the type ENUM blocks above.
        if (array_key_exists('loanPenaltyPeriod', $body)) {
            $period = $body['loanPenaltyPeriod'];
            if ($period !== 'day' && $period !== 'month') {
                json_error("loanPenaltyPeriod must be exactly 'day' or 'month'.", 422);
            }
            $updates[] = 'loanPenaltyPeriod = :loanPenaltyPeriod';
            $params[':loanPenaltyPeriod'] = $period;
        }

        if (array_key_exists('contributionPenaltyPeriod', $body)) {
            $period = $body['contributionPenaltyPeriod'];
            if ($period !== 'day' && $period !== 'month') {
                json_error("contributionPenaltyPeriod must be exactly 'day' or 'month'.", 422);
            }
            $updates[] = 'contributionPenaltyPeriod = :contributionPenaltyPeriod';
            $params[':contributionPenaltyPeriod'] = $period;
        }

        if (array_key_exists('loanPenaltyDailyAmount', $body)) {
            $updates[] = 'loanPenaltyDailyAmount = :loanPenaltyDailyAmount';
            $params[':loanPenaltyDailyAmount'] = rules_money_string(
                $body['loanPenaltyDailyAmount'],
                'loanPenaltyDailyAmount'
            );
        }

        if (array_key_exists('loanPenaltyMonthlyAmount', $body)) {
            if ($body['loanPenaltyMonthlyAmount'] === null) {
                $updates[] = 'loanPenaltyMonthlyAmount = NULL';
            } else {
                $updates[] = 'loanPenaltyMonthlyAmount = :loanPenaltyMonthlyAmount';
                $params[':loanPenaltyMonthlyAmount'] = rules_money_string(
                    $body['loanPenaltyMonthlyAmount'],
                    'loanPenaltyMonthlyAmount'
                );
            }
        }

        // loanPenaltyRate: the DEAD DECIMAL(5,2) column, reused as the loan
        // percentage penalty rate (J2 — no new loanPenaltyDailyRate column).
        // Capped at 100% by rules_penalty_rate_string(), unlike the interest
        // rate columns above.
        if (array_key_exists('loanPenaltyRate', $body)) {
            $updates[] = 'loanPenaltyRate = :loanPenaltyRate';
            $params[':loanPenaltyRate'] = rules_penalty_rate_string(
                $body['loanPenaltyRate'],
                'loanPenaltyRate'
            );
        }

        if (array_key_exists('contributionPenaltyDailyAmount', $body)) {
            $updates[] = 'contributionPenaltyDailyAmount = :contributionPenaltyDailyAmount';
            $params[':contributionPenaltyDailyAmount'] = rules_money_string(
                $body['contributionPenaltyDailyAmount'],
                'contributionPenaltyDailyAmount'
            );
        }

        if (array_key_exists('contributionPenaltyMonthlyAmount', $body)) {
            if ($body['contributionPenaltyMonthlyAmount'] === null) {
                $updates[] = 'contributionPenaltyMonthlyAmount = NULL';
            } else {
                $updates[] = 'contributionPenaltyMonthlyAmount = :contributionPenaltyMonthlyAmount';
                $params[':contributionPenaltyMonthlyAmount'] = rules_money_string(
                    $body['contributionPenaltyMonthlyAmount'],
                    'contributionPenaltyMonthlyAmount'
                );
            }
        }

        if (array_key_exists('contributionPenaltyDailyRate', $body)) {
            $updates[] = 'contributionPenaltyDailyRate = :contributionPenaltyDailyRate';
            $params[':contributionPenaltyDailyRate'] = rules_penalty_rate_string(
                $body['contributionPenaltyDailyRate'],
                'contributionPenaltyDailyRate'
            );
        }

        if (array_key_exists('contributionPenaltyMonthlyRate', $body)) {
            $updates[] = 'contributionPenaltyMonthlyRate = :contributionPenaltyMonthlyRate';
            $params[':contributionPenaltyMonthlyRate'] = rules_penalty_rate_string(
                $body['contributionPenaltyMonthlyRate'],
                'contributionPenaltyMonthlyRate'
            );
        }

        if (array_key_exists('loanPenaltyGracePeriodDays', $body)) {
            $updates[] = 'loanPenaltyGracePeriodDays = :loanPenaltyGracePeriodDays';
            $params[':loanPenaltyGracePeriodDays'] = rules_nonneg_int(
                $body['loanPenaltyGracePeriodDays'],
                'loanPenaltyGracePeriodDays'
            );
        }

        if (array_key_exists('contributionPenaltyGracePeriodDays', $body)) {
            $updates[] = 'contributionPenaltyGracePeriodDays = :contributionPenaltyGracePeriodDays';
            $params[':contributionPenaltyGracePeriodDays'] = rules_nonneg_int(
                $body['contributionPenaltyGracePeriodDays'],
                'contributionPenaltyGracePeriodDays'
            );
        }

        if (array_key_exists('loanRulesMaxLoanAmount', $body)) {
            $updates[] = 'loanRulesMaxLoanAmount = :loanRulesMaxLoanAmount';
            $params[':loanRulesMaxLoanAmount'] = rules_money_string(
                $body['loanRulesMaxLoanAmount'],
                'loanRulesMaxLoanAmount'
            );
        }

        if (array_key_exists('loanRulesMinCycleLoanAmount', $body)) {
            if ($body['loanRulesMinCycleLoanAmount'] === null) {
                $updates[] = 'loanRulesMinCycleLoanAmount = NULL';
            } else {
                $updates[] = 'loanRulesMinCycleLoanAmount = :loanRulesMinCycleLoanAmount';
                $params[':loanRulesMinCycleLoanAmount'] = rules_money_string(
                    $body['loanRulesMinCycleLoanAmount'],
                    'loanRulesMinCycleLoanAmount'
                );
            }
        }

        if (array_key_exists('loanRulesMaxActiveLoansByMember', $body)) {
            $maxActive = rules_nonneg_int(
                $body['loanRulesMaxActiveLoansByMember'],
                'loanRulesMaxActiveLoansByMember'
            );
            if ($maxActive < 1) {
                json_error('loanRulesMaxActiveLoansByMember must be at least 1.', 422);
            }
            $updates[] = 'loanRulesMaxActiveLoansByMember = :loanRulesMaxActiveLoansByMember';
            $params[':loanRulesMaxActiveLoansByMember'] = $maxActive;
        }

        if (array_key_exists('requireArrearsClearedBeforeLoan', $body)) {
            $value = $body['requireArrearsClearedBeforeLoan'];
            $bool = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($bool === null) {
                json_error('requireArrearsClearedBeforeLoan must be a boolean value.', 422);
            }
            $updates[] = 'requireArrearsClearedBeforeLoan = :requireArrearsClearedBeforeLoan';
            $params[':requireArrearsClearedBeforeLoan'] = $bool ? 1 : 0;
        }

        if (array_key_exists('requirePenaltiesClearedBeforeLoan', $body)) {
            $value = $body['requirePenaltiesClearedBeforeLoan'];
            $bool = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($bool === null) {
                json_error('requirePenaltiesClearedBeforeLoan must be a boolean value.', 422);
            }
            $updates[] = 'requirePenaltiesClearedBeforeLoan = :requirePenaltiesClearedBeforeLoan';
            $params[':requirePenaltiesClearedBeforeLoan'] = $bool ? 1 : 0;
        }

        if (array_key_exists('shareOutPenalties', $body)) {
            $value = $body['shareOutPenalties'];
            $bool = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($bool === null) {
                json_error('shareOutPenalties must be a boolean value.', 422);
            }
            $updates[] = 'shareOutPenalties = :shareOutPenalties';
            $params[':shareOutPenalties'] = $bool ? 1 : 0;
        }

        /* Plain boolean group switches, each validated identically.
           - loanPenaltyEnabled / contributionPenaltyEnabled: whether the group
             fines late payers at all (separate, because a group may chase an
             overdue loan instalment while being relaxed about a contribution).
           - shareOutReturnsCapital: whether the cycle-end payout hands members
             their own savings back alongside the dividend. */
        foreach (['loanPenaltyEnabled', 'contributionPenaltyEnabled', 'shareOutReturnsCapital'] as $boolFlag) {
            if (array_key_exists($boolFlag, $body)) {
                $bool = filter_var($body[$boolFlag], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
                if ($bool === null) {
                    json_error($boolFlag . ' must be a boolean value.', 422);
                }
                $updates[] = $boolFlag . ' = :' . $boolFlag;
                $params[':' . $boolFlag] = $bool ? 1 : 0;
            }
        }

        // How the interest pool is divided at cycle end. Decides who receives the
        // group's earnings, so only the three known rules are accepted.
        if (array_key_exists('shareOutInterestMethod', $body)) {
            $allowed = ['refund_to_payer', 'split_equally', 'split_by_contribution'];
            $value = is_string($body['shareOutInterestMethod'])
                ? trim($body['shareOutInterestMethod'])
                : '';
            if (!in_array($value, $allowed, true)) {
                json_error(
                    'shareOutInterestMethod must be one of: ' . implode(', ', $allowed) . '.',
                    422
                );
            }
            $updates[] = 'shareOutInterestMethod = :shareOutInterestMethod';
            $params[':shareOutInterestMethod'] = $value;
        }

        if (array_key_exists('forcedLoansEnabled', $body)) {
            $value = $body['forcedLoansEnabled'];
            $bool = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($bool === null) {
                json_error('forcedLoansEnabled must be a boolean value.', 422);
            }
            $updates[] = 'forcedLoansEnabled = :forcedLoansEnabled';
            $params[':forcedLoansEnabled'] = $bool ? 1 : 0;
        }

        if (array_key_exists('forcedLoansMethod', $body)) {
            $method = $body['forcedLoansMethod'];
            if ($method !== 'fixed_amount' && $method !== 'percentage_of_highest') {
                json_error(
                    "forcedLoansMethod must be exactly 'fixed_amount' or 'percentage_of_highest'.",
                    422
                );
            }
            $updates[] = 'forcedLoansMethod = :forcedLoansMethod';
            $params[':forcedLoansMethod'] = $method;
        }

        if (array_key_exists('forcedLoansPercentageOfHighest', $body)) {
            if ($body['forcedLoansPercentageOfHighest'] === null) {
                $updates[] = 'forcedLoansPercentageOfHighest = NULL';
            } else {
                $updates[] = 'forcedLoansPercentageOfHighest = :forcedLoansPercentageOfHighest';
                $params[':forcedLoansPercentageOfHighest'] = rules_rate_string(
                    $body['forcedLoansPercentageOfHighest'],
                    'forcedLoansPercentageOfHighest'
                );
            }
        }

        // Loan booking deadlines (migration 011)
        if (array_key_exists('loanBookingDay', $body)) {
            $day = $body['loanBookingDay'];
            if ($day !== null) {
                $day = (int) $day;
                if ($day < 1 || $day > 31) {
                    json_error('loanBookingDay must be between 1 and 31.', 422);
                }
            }
            $updates[] = 'loanBookingDay = :loanBookingDay';
            $params[':loanBookingDay'] = $day;
        }

        if (array_key_exists('lastLoanMonth', $body)) {
            $month = $body['lastLoanMonth'];
            if ($month !== null) {
                $month = (int) $month;
                if ($month < 1 || $month > 12) {
                    json_error('lastLoanMonth must be between 1 and 12.', 422);
                }
            }
            $updates[] = 'lastLoanMonth = :lastLoanMonth';
            $params[':lastLoanMonth'] = $month;
        }

        if (array_key_exists('minMembershipMonths', $body)) {
            $months = rules_nonneg_int($body['minMembershipMonths'], 'minMembershipMonths');
            $updates[] = 'minMembershipMonths = :minMembershipMonths';
            $params[':minMembershipMonths'] = $months;
        }

        // Amount-banded max repayment term (owner constitution, 2026-08-07).
        // Off by default; an admin opts a group in explicitly. Read together
        // by api/handlers/loans.php::loan_term_bounds_for_principal() — see
        // that function's docblock for the exact under/at-or-above rule.
        if (array_key_exists('loanTermBandEnabled', $body)) {
            $bool = filter_var($body['loanTermBandEnabled'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($bool === null) {
                json_error('loanTermBandEnabled must be a boolean value.', 422);
            }
            $updates[] = 'loanTermBandEnabled = :loanTermBandEnabled';
            $params[':loanTermBandEnabled'] = $bool ? 1 : 0;
        }

        if (array_key_exists('loanTermBandThreshold', $body)) {
            if ($body['loanTermBandThreshold'] === null) {
                $updates[] = 'loanTermBandThreshold = NULL';
            } else {
                $updates[] = 'loanTermBandThreshold = :loanTermBandThreshold';
                $params[':loanTermBandThreshold'] = rules_money_string(
                    $body['loanTermBandThreshold'],
                    'loanTermBandThreshold'
                );
            }
        }

        if (array_key_exists('loanTermBandLowerMaxMonths', $body)) {
            if ($body['loanTermBandLowerMaxMonths'] === null) {
                $updates[] = 'loanTermBandLowerMaxMonths = NULL';
            } else {
                $months = rules_nonneg_int($body['loanTermBandLowerMaxMonths'], 'loanTermBandLowerMaxMonths');
                if ($months < 1 || $months > 60) {
                    json_error('loanTermBandLowerMaxMonths must be a whole number between 1 and 60.', 422);
                }
                $updates[] = 'loanTermBandLowerMaxMonths = :loanTermBandLowerMaxMonths';
                $params[':loanTermBandLowerMaxMonths'] = $months;
            }
        }

        if (array_key_exists('loanTermBandUpperMaxMonths', $body)) {
            if ($body['loanTermBandUpperMaxMonths'] === null) {
                $updates[] = 'loanTermBandUpperMaxMonths = NULL';
            } else {
                $months = rules_nonneg_int($body['loanTermBandUpperMaxMonths'], 'loanTermBandUpperMaxMonths');
                if ($months < 1 || $months > 60) {
                    json_error('loanTermBandUpperMaxMonths must be a whole number between 1 and 60.', 422);
                }
                $updates[] = 'loanTermBandUpperMaxMonths = :loanTermBandUpperMaxMonths';
                $params[':loanTermBandUpperMaxMonths'] = $months;
            }
        }

        if (empty($updates)) {
            json_error('No updatable fields provided.', 422);
        }

        $sql = 'UPDATE group_rules SET ' . implode(', ', $updates) . ' WHERE groupId = :groupId';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        json_response(rules_select_row($pdo, $groupId));
    }
}
