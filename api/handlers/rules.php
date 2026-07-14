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
    . 'contributionPenaltyDailyRate, contributionPenaltyMonthlyRate, contributionPenaltyType, '
    . 'contributionPenaltyGracePeriodDays, contributionPenaltyDailyAmount, shareOutPenalties, '
    . 'cycleDurationStartDate, cycleDurationEndDate, cycleDurationMonths, cycleDurationAutoRenew, '
    . 'loanRulesMaxLoanAmount, loanRulesMinCycleLoanAmount, loanRulesMaxActiveLoansByMember, '
    . 'loanRulesRequireCollateral, loanRulesMinRepaymentMonths, loanRulesMaxRepaymentMonths, '
    . 'forcedLoansEnabled, forcedLoansMethod, forcedLoansPercentageOfHighest';

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

        require_role($groupId, ['member', 'admin', 'senior_admin', 'treasurer']);

        $pdo = getDbConnection();
        $rules = rules_select_row($pdo, $groupId);

        if ($rules === null) {
            json_error('This group has no rules configured yet.', 404);
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
            json_error('This group has no rules configured yet.', 404);
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

        if (array_key_exists('loanPenaltyDailyAmount', $body)) {
            $updates[] = 'loanPenaltyDailyAmount = :loanPenaltyDailyAmount';
            $params[':loanPenaltyDailyAmount'] = rules_money_string(
                $body['loanPenaltyDailyAmount'],
                'loanPenaltyDailyAmount'
            );
        }

        if (array_key_exists('contributionPenaltyDailyAmount', $body)) {
            $updates[] = 'contributionPenaltyDailyAmount = :contributionPenaltyDailyAmount';
            $params[':contributionPenaltyDailyAmount'] = rules_money_string(
                $body['contributionPenaltyDailyAmount'],
                'contributionPenaltyDailyAmount'
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

        if (array_key_exists('shareOutPenalties', $body)) {
            $value = $body['shareOutPenalties'];
            $bool = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($bool === null) {
                json_error('shareOutPenalties must be a boolean value.', 422);
            }
            $updates[] = 'shareOutPenalties = :shareOutPenalties';
            $params[':shareOutPenalties'] = $bool ? 1 : 0;
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

        if (empty($updates)) {
            json_error('No updatable fields provided.', 422);
        }

        $sql = 'UPDATE group_rules SET ' . implode(', ', $updates) . ' WHERE groupId = :groupId';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        json_response(rules_select_row($pdo, $groupId));
    }
}
