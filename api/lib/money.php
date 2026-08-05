<?php
/**
 * Money arithmetic and the loan interest engine.
 *
 * THIS FILE MOVES REAL MONEY. Every value here is held as an integer count of
 * MINOR UNITS (tambala / cents). PHP floats are never used for currency: a
 * float cannot represent 0.07 exactly, and a single lost tambala in a repayment
 * schedule is a member being silently overcharged.
 *
 * The interest formula is a verbatim port of the live Firebase implementation
 * in scripts/manage_loans.js (reduced-balance method). It is deliberately NOT
 * "improved": the numbers it produces are the numbers members have already been
 * charged, so any deviation would be a regression, not a fix.
 */

// Rate defaults when a group has no group_rules row. Declining, in percent.
const LOAN_DEFAULT_RATE_MONTH1 = '10';
const LOAN_DEFAULT_RATE_MONTH2 = '7';
const LOAN_DEFAULT_RATE_MONTH3 = '5';

if (!function_exists('money_to_minor')) {
    /**
     * Parse a decimal money string into an integer number of minor units.
     *
     * Accepts only a plain non-negative decimal with at most 2 fractional
     * digits — the precision of the DECIMAL(15,2) columns. Anything else (a
     * float in disguise, scientific notation, a third decimal place) is a
     * programming or input error and throws rather than being silently rounded.
     *
     * @throws InvalidArgumentException
     */
    function money_to_minor(string $amount): int
    {
        $amount = trim($amount);

        if (!preg_match('/^(\d{1,13})(?:\.(\d{1,2}))?$/', $amount, $m)) {
            throw new InvalidArgumentException('Invalid money value.');
        }

        $units = (int) $m[1];
        $fraction = isset($m[2]) ? str_pad($m[2], 2, '0', STR_PAD_RIGHT) : '00';

        return $units * 100 + (int) $fraction;
    }
}

if (!function_exists('money_from_minor')) {
    /**
     * Render an integer minor-unit amount as a decimal string with exactly 2
     * decimals. Built by integer division, never by number_format() on a float.
     */
    function money_from_minor(int $minor): string
    {
        $sign = $minor < 0 ? '-' : '';
        $abs = abs($minor);

        return $sign . intdiv($abs, 100) . '.' . str_pad((string) ($abs % 100), 2, '0', STR_PAD_LEFT);
    }
}

if (!function_exists('money_rate_to_hundredths')) {
    /**
     * Parse a percentage rate — DECIMAL(5,2), e.g. "10.00" — into an integer
     * number of hundredths of a percent (10.00% => 1000). Keeps the rate out of
     * float space so the interest product stays exact.
     *
     * @throws InvalidArgumentException
     */
    function money_rate_to_hundredths(string $rate): int
    {
        $rate = trim($rate);

        if (!preg_match('/^(\d{1,3})(?:\.(\d{1,2}))?$/', $rate, $m)) {
            throw new InvalidArgumentException('Invalid interest rate value.');
        }

        $units = (int) $m[1];
        $fraction = isset($m[2]) ? str_pad($m[2], 2, '0', STR_PAD_RIGHT) : '00';

        return $units * 100 + (int) $fraction;
    }
}

if (!function_exists('money_div_round_half_up')) {
    /**
     * Exact half-up division of two positive integers: round($numerator /
     * $denominator) with no float ever materialising.
     *
     * This is what reproduces JS Math.round() semantics for the positive values
     * money always has here — .5 always rounds away from zero (upward).
     *
     * @throws InvalidArgumentException
     */
    function money_div_round_half_up(int $numerator, int $denominator): int
    {
        if ($denominator <= 0) {
            throw new InvalidArgumentException('Denominator must be positive.');
        }
        if ($numerator < 0) {
            throw new InvalidArgumentException('Negative amounts are not supported.');
        }

        return intdiv(2 * $numerator + $denominator, 2 * $denominator);
    }
}

if (!function_exists('compute_loan_schedule')) {
    /**
     * Reduced-balance loan schedule: equal principal, interest charged on the
     * reducing balance. Verbatim port of scripts/manage_loans.js:1035-1072.
     *
     * The balance that interest is charged on is the EXACT reducing balance
     * (principal * (period - i + 1) / period), never a pre-rounded one — that is
     * what the live JS does, since it reduces an unrounded float balance. We
     * hold it as an exact rational (integer numerator / integer denominator) so
     * we match those numbers without touching a float.
     *
     * Interest is rounded to 2dp EACH MONTH and only then summed. Summing
     * unrounded and rounding once at the end produces different totals — do not
     * "optimise" that away.
     *
     * ROUNDING REMAINDER: monthlyPrincipal may not divide exactly (1000 / 3).
     * Months 1..n-1 each take round(principal / period); the FINAL instalment
     * takes whatever principal is left over. The schedule therefore always sums
     * exactly to the principal, and hence exactly to totalRepayment. A schedule
     * that does not sum to its total is a corrupt financial record.
     *
     * FLAT RATE ($method = 'flat_rate') is a genuinely different product, not a
     * variant of the above: interest is charged on the ORIGINAL principal for
     * every month of the term and never reduces as the borrower repays. It is
     * materially more expensive than reduced balance on the same headline rate
     * (10% over 3 months on 30,000 costs 9,000 flat vs 4,900 reducing), which is
     * exactly why a group must opt into it deliberately — see the flat branch.
     *
     * @param string $principal Decimal money string, e.g. "30000.00".
     * @param int    $period    Repayment period in months (>= 1).
     * @param array  $rates     ['month1' => '10', 'month2' => '7', 'month3' => '5'] as decimal strings.
     * @param string $method    'reduced_balance' (default) or 'flat_rate'.
     *
     * @return array{totalInterest:string,totalRepayment:string,monthlyPayment:string,schedule:array}
     *
     * @throws InvalidArgumentException
     * @throws RuntimeException on a schedule that fails its reconciliation self-check.
     */
    function compute_loan_schedule(
        string $principal,
        int $period,
        array $rates,
        string $method = 'reduced_balance'
    ): array {
        if ($period < 1) {
            throw new InvalidArgumentException('Repayment period must be at least 1 month.');
        }
        if (!in_array($method, ['reduced_balance', 'flat_rate'], true)) {
            throw new InvalidArgumentException('Unknown interest calculation method.');
        }

        $principalMinor = money_to_minor($principal);
        if ($principalMinor <= 0) {
            throw new InvalidArgumentException('Principal must be greater than zero.');
        }

        $rate1 = money_rate_to_hundredths((string) ($rates['month1'] ?? LOAN_DEFAULT_RATE_MONTH1));
        $rate2 = money_rate_to_hundredths((string) ($rates['month2'] ?? LOAN_DEFAULT_RATE_MONTH2));
        $rate3 = money_rate_to_hundredths((string) ($rates['month3'] ?? LOAN_DEFAULT_RATE_MONTH3));

        if ($method === 'flat_rate') {
            return compute_flat_rate_schedule($principalMinor, $period, $rate1);
        }

        // Equal-principal instalment, rounded to 2dp — as the JS does.
        $monthlyPrincipalMinor = money_div_round_half_up($principalMinor, $period);

        $schedule = [];
        $totalInterestMinor = 0;
        $principalAssignedMinor = 0;

        for ($i = 1; $i <= $period; $i++) {
            // Month 3 and beyond all carry the month-3 rate (mirrors the JS ternary).
            $rateHundredths = $i === 1 ? $rate1 : ($i === 2 ? $rate2 : $rate3);

            // Exact reducing balance as a rational:
            //   balance_i = principalMinor * (period - i + 1) / period
            // Interest, in minor units:
            //   round(balance_i * rate% / 100)
            //     = round( principalMinor * (period - i + 1) * rateHundredths
            //              / (period * 100 * 100) )
            $numerator = $principalMinor * ($period - $i + 1) * $rateHundredths;
            $denominator = $period * 10000;
            $interestMinor = money_div_round_half_up($numerator, $denominator);

            $totalInterestMinor += $interestMinor;

            // Final instalment absorbs the rounding remainder so the schedule
            // reconciles to the principal exactly.
            $principalDueMinor = $i === $period
                ? $principalMinor - $principalAssignedMinor
                : $monthlyPrincipalMinor;
            $principalAssignedMinor += $principalDueMinor;

            $schedule[] = [
                'month' => $i,
                // Hundredths-of-a-percent share the same 2dp scale as minor units.
                'interestRate' => money_from_minor($rateHundredths),
                'principalDue' => money_from_minor($principalDueMinor),
                'interestDue' => money_from_minor($interestMinor),
                'totalDue' => money_from_minor($principalDueMinor + $interestMinor),
            ];
        }

        $totalRepaymentMinor = $principalMinor + $totalInterestMinor;
        $monthlyPaymentMinor = money_div_round_half_up($totalRepaymentMinor, $period);

        // --- Reconciliation self-check. Never write an unbalanced schedule. ---
        $sumPrincipal = 0;
        $sumTotal = 0;
        foreach ($schedule as $row) {
            $sumPrincipal += money_to_minor($row['principalDue']);
            $sumTotal += money_to_minor($row['totalDue']);
        }

        if ($sumPrincipal !== $principalMinor || $sumTotal !== $totalRepaymentMinor) {
            throw new RuntimeException('Loan schedule failed reconciliation; refusing to produce it.');
        }

        return [
            'totalInterest' => money_from_minor($totalInterestMinor),
            'totalRepayment' => money_from_minor($totalRepaymentMinor),
            'monthlyPayment' => money_from_minor($monthlyPaymentMinor),
            'schedule' => $schedule,
        ];
    }
}

if (!function_exists('compute_flat_rate_schedule')) {
    /**
     * Flat-rate schedule: interest on the ORIGINAL principal for the whole term.
     *
     *   totalInterest = principal * rate% * months
     *   monthlyPayment = (principal + totalInterest) / months
     *
     * WHICH RATE. The group configures three declining rates (month1/2/3). Those
     * exist because under REDUCING balance the early months carry a bigger
     * balance. A flat-rate loan has no reducing balance, so there is nothing for
     * a declining tier to describe — this uses the **month-1 rate as the single
     * flat monthly rate**, which is the group's headline rate and the one an
     * admin thinks of as "the interest rate". Months 2 and 3 are deliberately
     * IGNORED here; applying them would silently invent a fourth product that is
     * neither flat nor reducing.
     *
     * ROUNDING. Interest is computed ONCE on the whole term and then split, the
     * opposite order from the reducing branch — that is inherent to the product,
     * not an inconsistency: there is only one interest charge to round. Months
     * 1..n-1 take the rounded per-month share of BOTH principal and interest and
     * the FINAL instalment absorbs both remainders, so the schedule sums exactly
     * to principal and to totalRepayment.
     *
     * @param int $principalMinor  Principal in integer minor units (> 0).
     * @param int $period          Months (>= 1).
     * @param int $rateHundredths  Monthly rate in hundredths of a percent.
     *
     * @return array{totalInterest:string,totalRepayment:string,monthlyPayment:string,schedule:array}
     *
     * @throws RuntimeException on a schedule that fails its reconciliation self-check.
     */
    function compute_flat_rate_schedule(int $principalMinor, int $period, int $rateHundredths): array
    {
        // totalInterest = principal * rate * months, rate in hundredths of a
        // percent so the divisor is 100 (percent) * 100 (hundredths) = 10000.
        $totalInterestMinor = money_div_round_half_up(
            $principalMinor * $rateHundredths * $period,
            10000
        );

        $monthlyPrincipalMinor = money_div_round_half_up($principalMinor, $period);
        $monthlyInterestMinor = money_div_round_half_up($totalInterestMinor, $period);

        $schedule = [];
        $principalAssignedMinor = 0;
        $interestAssignedMinor = 0;

        for ($i = 1; $i <= $period; $i++) {
            $isFinal = $i === $period;

            $principalDueMinor = $isFinal
                ? $principalMinor - $principalAssignedMinor
                : $monthlyPrincipalMinor;
            $interestDueMinor = $isFinal
                ? $totalInterestMinor - $interestAssignedMinor
                : $monthlyInterestMinor;

            $principalAssignedMinor += $principalDueMinor;
            $interestAssignedMinor += $interestDueMinor;

            $schedule[] = [
                'month' => $i,
                // The SAME rate every month — that is what "flat" means.
                'interestRate' => money_from_minor($rateHundredths),
                'principalDue' => money_from_minor($principalDueMinor),
                'interestDue' => money_from_minor($interestDueMinor),
                'totalDue' => money_from_minor($principalDueMinor + $interestDueMinor),
            ];
        }

        $totalRepaymentMinor = $principalMinor + $totalInterestMinor;
        $monthlyPaymentMinor = money_div_round_half_up($totalRepaymentMinor, $period);

        // --- Reconciliation self-check. Never write an unbalanced schedule. ---
        $sumPrincipal = 0;
        $sumInterest = 0;
        $sumTotal = 0;
        foreach ($schedule as $row) {
            $sumPrincipal += money_to_minor($row['principalDue']);
            $sumInterest += money_to_minor($row['interestDue']);
            $sumTotal += money_to_minor($row['totalDue']);
        }

        if (
            $sumPrincipal !== $principalMinor
            || $sumInterest !== $totalInterestMinor
            || $sumTotal !== $totalRepaymentMinor
        ) {
            throw new RuntimeException('Loan schedule failed reconciliation; refusing to produce it.');
        }

        return [
            'totalInterest' => money_from_minor($totalInterestMinor),
            'totalRepayment' => money_from_minor($totalRepaymentMinor),
            'monthlyPayment' => money_from_minor($monthlyPaymentMinor),
            'schedule' => $schedule,
        ];
    }
}
