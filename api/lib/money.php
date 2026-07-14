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
     * @param string $principal Decimal money string, e.g. "30000.00".
     * @param int    $period    Repayment period in months (>= 1).
     * @param array  $rates     ['month1' => '10', 'month2' => '7', 'month3' => '5'] as decimal strings.
     *
     * @return array{totalInterest:string,totalRepayment:string,monthlyPayment:string,schedule:array}
     *
     * @throws InvalidArgumentException
     * @throws RuntimeException on a schedule that fails its reconciliation self-check.
     */
    function compute_loan_schedule(string $principal, int $period, array $rates): array
    {
        if ($period < 1) {
            throw new InvalidArgumentException('Repayment period must be at least 1 month.');
        }

        $principalMinor = money_to_minor($principal);
        if ($principalMinor <= 0) {
            throw new InvalidArgumentException('Principal must be greater than zero.');
        }

        $rate1 = money_rate_to_hundredths((string) ($rates['month1'] ?? LOAN_DEFAULT_RATE_MONTH1));
        $rate2 = money_rate_to_hundredths((string) ($rates['month2'] ?? LOAN_DEFAULT_RATE_MONTH2));
        $rate3 = money_rate_to_hundredths((string) ($rates['month3'] ?? LOAN_DEFAULT_RATE_MONTH3));

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
