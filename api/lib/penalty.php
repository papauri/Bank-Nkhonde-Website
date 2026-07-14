<?php
/**
 * Loan penalty engine.
 *
 * THE RULE (from the product owner, not from the old code):
 *   A loan that is still unpaid after its grace period accrues a FIXED MWK
 *   AMOUNT PER DAY until the balance is cleared.
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
            . 'loanPenaltyGracePeriodDays '
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
     *     amountOutstanding:string, oldestOverdueDueDate:?string, asOf:string
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
        ];

        // A group with no rules row has no penalty policy, so there is nothing to
        // charge. This is the ONLY path that returns zero without consulting the
        // config — every other zero below is an explicitly configured zero.
        if ($rules === null) {
            return $zero;
        }

        $type = (string) ($rules['loanPenaltyType'] ?? '');

        // Percentage penalties are implemented NOWHERE in this codebase. Guessing
        // at the maths would invent charges against real members, so the engine
        // refuses outright and the handler surfaces it as a 501. It does not fall
        // back to zero: silently charging nothing is as wrong as charging wrongly.
        if ($type === 'percentage') {
            throw new RuntimeException('Percentage penalties are not implemented.');
        }
        if ($type !== 'fixed') {
            throw new RuntimeException('Unknown loan penalty type in this group\'s rules.');
        }

        $dailyRaw = $rules['loanPenaltyDailyAmount'] ?? null;

        // Configured 'fixed' but with no daily amount set: the group intended to
        // charge something and has not said how much. Never quietly charge 0.
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

        $graceDays = (int) ($rules['loanPenaltyGracePeriodDays'] ?? 0);
        if ($graceDays < 0) {
            $graceDays = 0;
        }

        $zero['dailyAmount'] = money_from_minor($dailyMinor);
        $zero['gracePeriodDays'] = $graceDays;

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

        $accruedMinor = $dailyMinor * $daysCharged;

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

        return [
            'dailyAmount' => money_from_minor($dailyMinor),
            'gracePeriodDays' => $graceDays,
            'firstChargeableDay' => $firstChargeable->format('Y-m-d'),
            'daysCharged' => $daysCharged,
            'amountAccrued' => money_from_minor($accruedMinor),
            'amountSettled' => money_from_minor($settledMinor),
            'amountOutstanding' => money_from_minor($outstandingMinor),
            'oldestOverdueDueDate' => $oldestDay->format('Y-m-d'),
            'asOf' => $asOfDay->format('Y-m-d'),
        ];
    }
}
