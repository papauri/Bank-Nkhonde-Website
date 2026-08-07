<?php
/**
 * Loan penalty engine.
 *
 * THE ORIGINAL RULE (from the product owner, and still the only mode any live
 * group is configured with today): a loan that is still unpaid after its
 * grace period accrues a FIXED MWK AMOUNT PER DAY until the balance is
 * cleared.
 *
 *     daysCharged = whole days between (oldest overdue dueDate + graceDays) and asOf
 *     accrued     = dailyAmount * MAX(0, daysCharged)
 *
 *   * A fixed cash amount per day — NOT a percentage of arrears.
 *   * Zero while inside the grace period.
 *   * Charged ONCE PER LOAN per day for as long as the loan has any overdue
 *     balance — not once per overdue instalment. A loan three instalments behind
 *     accrues one daily charge, not three.
 *
 * J2 SLICE 1A (cycle 120) generalised this into type x period:
 *   - fixed   x day   = the rule above, UNCHANGED (byte-identical maths).
 *   - fixed   x month = loanPenaltyMonthlyAmount x whole ELAPSED months.
 *   - percentage x day/month = the OVERDUE AMOUNT (BL-6(a): the still-open,
 *     past-due instalments' balances, which SHRINKS as the member catches up
 *     — deliberately NOT the full obligation, which is the CONTRIBUTION
 *     penalty's basis instead; see BUILD_PLAN.md "Penalty basis" decision) x
 *     loanPenaltyRate% x periodsCharged (days or whole elapsed months).
 *   loanPenaltyPeriod ENUM('day','month') selects the period explicitly for
 *   both fixed and percentage; the DEAD loanPenaltyRate column is reused for
 *   the percentage rate rather than adding a parallel column.
 *
 * PENALTIES ARE NOT STORED AS A RUNNING TOTAL. They grow every night and there
 * is no cron in this system, so any persisted figure is stale by morning.
 * Penalties are therefore COMPUTED ON READ from the schedule. Only SETTLED
 * penalties — paid or waived — are persisted, because a settlement is a fact
 * that has stopped accruing.
 *
 * All date arithmetic is whole-day: both ends are normalised to midnight before
 * diffing, so a payment recorded at 09:00 and one at 23:00 charge the same day
 * count. No float days, no partial days.
 */

require_once __DIR__ . '/money.php';
require_once __DIR__ . '/../../config/database.php';

if (!function_exists('penalty_fetch_rules')) {
    /**
     * The group's penalty rules, or null when the group has no rules row at all.
     */
    function penalty_fetch_rules(PDO $pdo, string $groupId): ?array
    {
        $stmt = $pdo->prepare(
            'SELECT loanPenaltyType, loanPenaltyRate, loanPenaltyDailyAmount, '
            . 'loanPenaltyGracePeriodDays, loanPenaltyPeriod, loanPenaltyMonthlyAmount, '
            // Without this column in the SELECT the on/off switch would read as
            // absent and default to "on" — the toggle would silently do nothing.
            . 'loanPenaltyEnabled '
            . 'FROM group_rules WHERE groupId = :groupId LIMIT 1'
        );
        $stmt->execute([':groupId' => $groupId]);
        $rules = $stmt->fetch();

        return $rules === false ? null : $rules;
    }
}

if (!function_exists('penalty_day')) {
    /**
     * Normalise a datetime string to midnight of its calendar day.
     *
     * Whole-day arithmetic is the whole point: dueDate carries the time of day
     * the loan happened to be approved, and asOf carries the time of day the
     * member happened to pay. Neither should shift the number of days charged.
     *
     * @throws InvalidArgumentException on an unparseable date.
     */
    function penalty_day(string $value): DateTimeImmutable
    {
        try {
            $date = new DateTimeImmutable($value);
        } catch (Exception $e) {
            throw new InvalidArgumentException('Invalid date value.');
        }

        return $date->setTime(0, 0, 0);
    }
}

if (!function_exists('compute_loan_penalty')) {
    /**
     * Live penalty position for one loan.
     *
     * @param array       $loan  Loan row; needs loanId and status.
     * @param array|null  $rules group_rules row, or null when the group has none.
     * @param string|null $asOf  Settlement date; defaults to today.
     *
     * @return array{
     *     dailyAmount:string, gracePeriodDays:int, firstChargeableDay:?string,
     *     daysCharged:int, amountAccrued:string, amountSettled:string,
     *     amountOutstanding:string, oldestOverdueDueDate:?string, asOf:string,
     *     penaltyType:?string, penaltyPeriod:?string, periodsCharged:int,
     *     overdueAmount:string
     * }
     *
     * @throws RuntimeException when the group's penalty config cannot be honoured.
     */
    function compute_loan_penalty(array $loan, ?array $rules, ?string $asOf = null): array
    {
        $asOfDay = penalty_day($asOf ?? 'now');

        $zero = [
            'dailyAmount' => '0.00',
            'gracePeriodDays' => 0,
            'firstChargeableDay' => null,
            'daysCharged' => 0,
            'amountAccrued' => '0.00',
            'amountSettled' => '0.00',
            'amountOutstanding' => '0.00',
            'oldestOverdueDueDate' => null,
            'asOf' => $asOfDay->format('Y-m-d'),
            // Added for the percentage/month modes (J2 Slice 1A). Existing
            // callers key off the fields above only, so these are additive and
            // change nothing for them.
            'penaltyType' => null,
            'penaltyPeriod' => null,
            'periodsCharged' => 0,
            'overdueAmount' => '0.00',
        ];

        // A group with no rules row has no penalty policy, so there is nothing to
        // charge. This is the ONLY path that returns zero without consulting the
        // config — every other zero below is an explicitly configured zero.
        if ($rules === null) {
            return $zero;
        }

        /* THE GROUP'S EXPLICIT ON/OFF SWITCH.
           Penalties used to be switch-off-able only by accident — you had to
           leave every rate and amount at zero and hope nothing set them later.
           A group that does not fine its members can now say so outright.
           DEFAULT 1, so every existing group keeps charging exactly as before;
           a group already sitting on zero rates still computes zero either way. */
        if ((int) ($rules['loanPenaltyEnabled'] ?? 1) !== 1) {
            return $zero;
        }

        $type = (string) ($rules['loanPenaltyType'] ?? '');

        if ($type !== 'fixed' && $type !== 'percentage') {
            throw new RuntimeException('Unknown loan penalty type in this group\'s rules.');
        }

        // loanPenaltyPeriod is ENUM('day','month') NOT NULL DEFAULT 'day' at the
        // schema, so every row already has one of these two values. The
        // fallback below only guards a row read before the column existed /
        // fetched via a narrower SELECT that omitted it — never let an absent
        // value silently pick 'month' (the larger charge).
        $period = (string) ($rules['loanPenaltyPeriod'] ?? 'day');
        if ($period !== 'day' && $period !== 'month') {
            $period = 'day';
        }

        $zero['penaltyType'] = $type;
        $zero['penaltyPeriod'] = $period;

        $graceDays = (int) ($rules['loanPenaltyGracePeriodDays'] ?? 0);
        if ($graceDays < 0) {
            $graceDays = 0;
        }
        $zero['gracePeriodDays'] = $graceDays;

        // Per-type, per-period config validation, mirroring the original
        // fixed/day guard: a group that switched a mode ON but left its number
        // unset gets a loud refusal, never a quiet charge of zero.
        $dailyMinor = null;
        $monthlyMinor = null;
        $rateHundredths = null;

        if ($type === 'fixed' && $period === 'day') {
            // BYTE-IDENTICAL to the original single-mode engine — this is the
            // only branch every existing live group's config resolves to today.
            $dailyRaw = $rules['loanPenaltyDailyAmount'] ?? null;

            if ($dailyRaw === null || $dailyRaw === '') {
                throw new RuntimeException(
                    'This group charges a fixed daily loan penalty but loanPenaltyDailyAmount is not set.'
                );
            }

            try {
                $dailyMinor = money_to_minor((string) $dailyRaw);
            } catch (InvalidArgumentException $e) {
                throw new RuntimeException('loanPenaltyDailyAmount is not a valid money value.');
            }

            $zero['dailyAmount'] = money_from_minor($dailyMinor);
        } elseif ($type === 'fixed' && $period === 'month') {
            $monthlyRaw = $rules['loanPenaltyMonthlyAmount'] ?? null;

            if ($monthlyRaw === null || $monthlyRaw === '') {
                throw new RuntimeException(
                    'This group charges a fixed monthly loan penalty but loanPenaltyMonthlyAmount is not set.'
                );
            }

            try {
                $monthlyMinor = money_to_minor((string) $monthlyRaw);
            } catch (InvalidArgumentException $e) {
                throw new RuntimeException('loanPenaltyMonthlyAmount is not a valid money value.');
            }

            // 'dailyAmount' carries the configured amount-per-charging-period
            // regardless of which period is active: repayments.php persists it
            // verbatim into penalty_settlements.dailyAmount as an audit figure,
            // and a fixed monthly charge is exactly as much an "amount per
            // period" as a daily one.
            $zero['dailyAmount'] = money_from_minor($monthlyMinor);
        } else {
            // percentage, either period. The DEAD loanPenaltyRate column
            // (DECIMAL(5,2), same shape as the contribution rate columns) is
            // reused as the loan % rate — no new rate column.
            $rateRaw = trim((string) ($rules['loanPenaltyRate'] ?? ''));

            if ($rateRaw === '') {
                throw new RuntimeException(
                    'This group charges a percentage loan penalty but loanPenaltyRate is not set.'
                );
            }

            try {
                $rateHundredths = money_rate_to_hundredths($rateRaw);
            } catch (InvalidArgumentException $e) {
                throw new RuntimeException('loanPenaltyRate is not a valid percentage value.');
            }

            // Same "not set" reasoning, expressed as a rate rather than an
            // empty string — the schema default is 0.00, so a group that has
            // never touched this field is functionally unconfigured, not
            // "configured to charge nothing".
            if ($rateHundredths <= 0) {
                throw new RuntimeException(
                    'This group charges a percentage loan penalty but loanPenaltyRate is not set.'
                );
            }

            // A percentage penalty has no configured "amount per period" — the
            // audit figure is the overdue amount it was applied to (computed
            // below, once the overdue balance is known). 'dailyAmount' stays
            // the zero-default '0.00' here: never invented, never null, and
            // penalty_settlements.dailyAmount is NOT NULL.
        }

        $loanId = (string) ($loan['loanId'] ?? '');
        if ($loanId === '') {
            throw new RuntimeException('compute_loan_penalty requires a loan with a loanId.');
        }

        // A completed loan has been cleared, and the rule says the charge accrues
        // only "until it is cleared".
        if (($loan['status'] ?? '') === 'completed') {
            return $zero;
        }

        $pdo = getDbConnection();

        // The OLDEST still-unpaid instalment whose due date has passed anchors the
        // accrual. status is not trusted here — nothing in this system sweeps a
        // 'pending' row to 'overdue', so the due date is the only honest signal.
        $stmt = $pdo->prepare(
            'SELECT dueDate FROM loan_repayment_schedule '
            . "WHERE loanId = :loanId AND status <> 'paid' AND balance > 0 AND dueDate < :asOf "
            . 'ORDER BY dueDate ASC, month ASC LIMIT 1'
        );
        $stmt->execute([
            ':loanId' => $loanId,
            ':asOf' => $asOfDay->format('Y-m-d H:i:s'),
        ]);
        $oldest = $stmt->fetch();

        if ($oldest === false) {
            return $zero;
        }

        $oldestDay = penalty_day((string) $oldest['dueDate']);
        $firstChargeable = $oldestDay->modify('+' . $graceDays . ' day');

        // Clamped at zero: inside the grace period nothing is owed. The day the
        // grace expires is day 0 — the first FULL day past it is day 1.
        $daysCharged = $firstChargeable < $asOfDay
            ? (int) $firstChargeable->diff($asOfDay)->days
            : 0;

        $zero['firstChargeableDay'] = $firstChargeable->format('Y-m-d');
        $zero['oldestOverdueDueDate'] = $oldestDay->format('Y-m-d');
        $zero['daysCharged'] = $daysCharged;

        // periodsCharged is the multiplier actually used in the accrual maths
        // below: whole days for period='day' (same number as daysCharged), or
        // whole ELAPSED months for period='month' — a part-month charges
        // nothing, mirroring api/handlers/payments.php:298-303 exactly so the
        // two engines never drift on what "a completed period" means.
        if ($period === 'month') {
            $monthsDiff = $firstChargeable->diff($asOfDay);
            $periodsCharged = $firstChargeable < $asOfDay
                ? ($monthsDiff->y * 12) + $monthsDiff->m
                : 0;
        } else {
            $periodsCharged = $daysCharged;
        }
        $zero['periodsCharged'] = $periodsCharged;

        if ($type === 'fixed' && $period === 'day') {
            // BYTE-IDENTICAL formula to the original single-mode engine.
            $accruedMinor = $dailyMinor * $daysCharged;
        } elseif ($type === 'fixed' && $period === 'month') {
            $accruedMinor = $monthlyMinor * $periodsCharged;
        } else {
            // percentage: basis = the OVERDUE AMOUNT (BL-6(a) — the instalments
            // actually past due, which shrinks as the member catches up). Summed
            // row-wise in integer minor units over every still-open, past-due
            // instalment — never a SQL SUM() on the money column, same
            // reasoning as the settlement sum below: an aggregate comes back as
            // a string of uncertain scale, and coercing it would mean a float
            // touching money. Same WHERE predicate as the oldest-row query
            // above, minus the LIMIT — every qualifying row, not just the
            // oldest.
            $overdueStmt = $pdo->prepare(
                'SELECT balance FROM loan_repayment_schedule '
                . "WHERE loanId = :loanId AND status <> 'paid' AND balance > 0 AND dueDate < :asOf"
            );
            $overdueStmt->execute([
                ':loanId' => $loanId,
                ':asOf' => $asOfDay->format('Y-m-d H:i:s'),
            ]);

            $overdueMinor = 0;
            foreach ($overdueStmt->fetchAll() as $row) {
                $overdueMinor += money_to_minor(trim((string) $row['balance']));
            }

            $zero['overdueAmount'] = money_from_minor($overdueMinor);

            // Exactly the convention compute_loan_schedule() and
            // payments.php:307-319 use for interest/contribution percentages:
            // rate carried in hundredths of a percent, so the divisor is 100
            // (percent) x 100 (hundredths) = 10000, with one half-up rounding
            // at the very end. No float ever touches money.
            $accruedMinor = money_div_round_half_up(
                $overdueMinor * $rateHundredths * $periodsCharged,
                10000
            );
        }

        // Penalties already settled against this loan — paid or waived — have
        // stopped accruing and are facts on the ledger. Netting them off is what
        // stops a member being charged twice for the same overdue days.
        // The rows are summed in integer minor units rather than with SQL SUM():
        // an aggregate comes back as a string of uncertain scale, and coercing it
        // would mean a float touching money. There are only a handful of
        // settlement rows per loan, so the row-wise sum is exact and cheap.
        $settledStmt = $pdo->prepare(
            'SELECT amountPaid, amountWaived FROM penalty_settlements WHERE loanId = :loanId'
        );
        $settledStmt->execute([':loanId' => $loanId]);

        $settledMinor = 0;
        foreach ($settledStmt->fetchAll() as $row) {
            $settledMinor += money_to_minor(trim((string) $row['amountPaid']));
            $settledMinor += money_to_minor(trim((string) $row['amountWaived']));
        }

        $outstandingMinor = $accruedMinor - $settledMinor;
        if ($outstandingMinor < 0) {
            $outstandingMinor = 0;
        }

        $zero['amountAccrued'] = money_from_minor($accruedMinor);
        $zero['amountSettled'] = money_from_minor($settledMinor);
        $zero['amountOutstanding'] = money_from_minor($outstandingMinor);

        return $zero;
    }
}
