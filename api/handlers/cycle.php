<?php
/**
 * Cycle endpoints: equity view, payout preview, cycle settlement.
 *
 * THIS FILE DECIDES WHAT REAL MEMBERS ARE PAID AT CYCLE END.
 *
 * THE PAYOUT RULE (from the product owner, implemented verbatim):
 *   payout(member) = interestRefund(member) + penaltyShare(member)
 *
 *   interestRefund(member) = the total interest THAT MEMBER personally paid this
 *                            cycle. Interest goes back to whoever paid it.
 *   penaltyShare(member)   = an EQUAL 1/N slice of the group's whole penalty pool,
 *                            and ONLY when group_rules.shareOutPenalties = 1.
 *                            Otherwise it is zero for everyone and the group simply
 *                            keeps the pot (which is still reported to the admin).
 *
 * A PENALTY IS NEVER REFUNDED TO THE MEMBER WHO PAID IT. Handing a fine back to
 * the person fined would make the fine meaningless. The pot is split equally, so
 * the late payer really loses the money and receives only their 1/N share, the
 * same as every other member.
 *
 * The sum of all payouts is, by construction, exactly the interest pool plus the
 * penalties actually distributed — it always balances. That invariant is asserted
 * in integer minor units before any share-out is shown or written; a share-out
 * that does not reconcile is never produced.
 *
 * Because a member who borrows little pays little interest and would be refunded
 * little, the group compensates with FORCED LOANS (see force_loan() in
 * loans.php). cycle_equity() is the view an admin uses to decide who needs one:
 * it ranks members by how far they are BEHIND the per-cycle borrowing target
 * (group_rules.loanRulesMinCycleLoanAmount).
 *
 * MONEY: no PHP float arithmetic anywhere. Amounts are summed in SQL over DECIMAL
 * columns, returned by PDO as strings, and combined here as integer minor units
 * via api/lib/money.php. Every figure returned to the client is a 2dp string.
 *
 * AUTHORIZATION: every endpoint re-checks the caller's group role server-side with
 * require_role() before touching data. A role or uid in a request is never a claim.
 */

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/session.php';
require_once __DIR__ . '/../lib/money.php';
require_once __DIR__ . '/../../config/database.php';

// Loans whose principal counts as "borrowed" this cycle. A pending or rejected
// loan is not money the member has taken.
const CYCLE_BORROWED_STATUSES = ['approved', 'disbursed', 'completed'];

// Contributions that count as money actually in the pool.
const CYCLE_PAID_PAYMENT_STATUSES = ['approved', 'completed'];

if (!function_exists('cycle_minor')) {
    /**
     * A SQL SUM() over a DECIMAL column arrives as a decimal string, or NULL when
     * the member has no rows. Convert to integer minor units. Never cast to float.
     */
    function cycle_minor($value): int
    {
        if ($value === null || $value === '' || !is_scalar($value)) {
            return 0;
        }

        $text = trim((string) $value);

        // MySQL renders a negative DECIMAL sum with a leading '-'; money_to_minor()
        // accepts non-negative values only, so handle the sign here.
        $negative = strncmp($text, '-', 1) === 0;
        if ($negative) {
            $text = substr($text, 1);
        }

        try {
            $minor = money_to_minor($text);
        } catch (InvalidArgumentException $e) {
            throw new RuntimeException('Unreadable money value from the database.');
        }

        return $negative ? -$minor : $minor;
    }
}

if (!function_exists('cycle_require_group_id')) {
    function cycle_require_group_id(string $groupId): string
    {
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }
        return $groupId;
    }
}

if (!function_exists('cycle_fetch_rules')) {
    /**
     * The group's cycle window and per-cycle borrowing target, or null.
     */
    /**
     * The [start, end) window of the group's CURRENT cycle, from group_rules.
     * Returns [null, null] when no cycle start is configured — meaning "all time",
     * which is only correct for a group that has never closed a cycle.
     *
     * @return array{0: ?string, 1: ?string}
     */
    function cycle_window(PDO $pdo, string $groupId): array
    {
        $rules = cycle_fetch_rules($pdo, $groupId);
        if ($rules === null || empty($rules['cycleDurationStartDate'])) {
            return [null, null];
        }
        $start = (string) $rules['cycleDurationStartDate'];
        $end = ($rules['cycleDurationEndDate'] !== null && $rules['cycleDurationEndDate'] !== '')
            ? (string) $rules['cycleDurationEndDate']
            : null;

        return [$start, $end];
    }

    function cycle_fetch_rules(PDO $pdo, string $groupId): ?array
    {
        $stmt = $pdo->prepare(
            'SELECT loanRulesMinCycleLoanAmount, cycleDurationStartDate, cycleDurationEndDate, '
            . 'cycleDurationMonths, shareOutPenalties, '
            . 'forcedLoansEnabled, forcedLoansMethod, forcedLoansPercentageOfHighest '
            . 'FROM group_rules WHERE groupId = :groupId LIMIT 1'
        );
        $stmt->execute([':groupId' => $groupId]);
        $rules = $stmt->fetch();

        return $rules === false ? null : $rules;
    }
}

if (!function_exists('cycle_collect_member_figures')) {
    /**
     * The single source of every per-member money figure used by all three cycle
     * endpoints. Each aggregate is one grouped SQL SUM() over DECIMAL columns;
     * the results are merged here as integer minor units.
     *
     * Returns a list of rows keyed by uid, each holding MINOR-UNIT integers:
     *   uid, fullName, role,
     *   contributedMinor, borrowedMinor, interestCommittedMinor,
     *   interestPaidMinor, penaltiesPaidMinor
     *
     * @return array<int, array>
     */
    function cycle_collect_member_figures(
        PDO $pdo,
        string $groupId,
        ?string $cycleStart = null,
        ?string $cycleEnd = null
    ): array {
        // CYCLE WINDOW — load-bearing. Without it every aggregate would sum the
        // group's ENTIRE history, so on the second cycle a member would be
        // refunded the interest they already received for the first one. Real
        // money, paid twice.
        //
        // Authoritative timestamps: paidAt for cash that actually moved
        // (payments, loan_payments) and approvedAt for borrowing committed
        // (loans). A NULL window means "all time" — correct only for a group
        // whose first cycle is still open.
        $window = '';
        $windowParams = [];
        if ($cycleStart !== null) {
            $window = ' AND %s >= ?';
            $windowParams[] = $cycleStart;
            if ($cycleEnd !== null) {
                $window .= ' AND %s < ?';
                $windowParams[] = $cycleEnd;
            }
        }
        $win = static function (string $col) use ($window): string {
            if ($window === '') {
                return '';
            }
            return str_replace('%s', $col, $window);
        };

        $memberStmt = $pdo->prepare(
            'SELECT uid, fullName, role FROM members '
            . "WHERE groupId = :groupId AND status = 'active' ORDER BY joinedAt ASC"
        );
        $memberStmt->execute([':groupId' => $groupId]);
        $members = $memberStmt->fetchAll();

        $figures = [];
        foreach ($members as $member) {
            $figures[(string) $member['uid']] = [
                'uid' => (string) $member['uid'],
                'fullName' => $member['fullName'],
                'role' => $member['role'],
                'contributedMinor' => 0,
                'borrowedMinor' => 0,
                'interestCommittedMinor' => 0,
                'interestPaidMinor' => 0,
                'penaltiesPaidMinor' => 0,
            ];
        }

        if ($figures === []) {
            return [];
        }

        // --- Contributions actually paid in ---
        $paidStatuses = CYCLE_PAID_PAYMENT_STATUSES;
        $paidPlaceholders = implode(', ', array_fill(0, count($paidStatuses), '?'));
        $contribStmt = $pdo->prepare(
            'SELECT uid, SUM(amountPaid) AS total FROM payments '
            . 'WHERE groupId = ? AND approvalStatus IN (' . $paidPlaceholders . ') '
            . $win('paidAt')
            . ' GROUP BY uid'
        );
        $contribStmt->execute(array_merge([$groupId], $paidStatuses, $windowParams));
        foreach ($contribStmt->fetchAll() as $row) {
            $uid = (string) $row['uid'];
            if (isset($figures[$uid])) {
                $figures[$uid]['contributedMinor'] = cycle_minor($row['total']);
            }
        }

        // --- Principal borrowed, and interest COMMITTED by those loans ---
        $loanStatuses = CYCLE_BORROWED_STATUSES;
        $loanPlaceholders = implode(', ', array_fill(0, count($loanStatuses), '?'));
        $loanStmt = $pdo->prepare(
            'SELECT borrowerId, SUM(principalAmount) AS borrowed, SUM(totalInterest) AS interest '
            . 'FROM loans WHERE groupId = ? AND status IN (' . $loanPlaceholders . ') '
            . $win('approvedAt')
            . ' GROUP BY borrowerId'
        );
        $loanStmt->execute(array_merge([$groupId], $loanStatuses, $windowParams));
        foreach ($loanStmt->fetchAll() as $row) {
            $uid = (string) $row['borrowerId'];
            if (isset($figures[$uid])) {
                $figures[$uid]['borrowedMinor'] = cycle_minor($row['borrowed']);
                $figures[$uid]['interestCommittedMinor'] = cycle_minor($row['interest']);
            }
        }

        // --- Interest and penalties ACTUALLY PAID. This is the payout basis. ---
        $repayStmt = $pdo->prepare(
            'SELECT uid, SUM(interestPortion) AS interestPaid, SUM(penaltyPortion) AS penaltiesPaid '
            . "FROM loan_payments WHERE groupId = ? AND status = 'approved' "
            . $win('paidAt')
            . ' GROUP BY uid'
        );
        $repayStmt->execute(array_merge([$groupId], $windowParams));
        foreach ($repayStmt->fetchAll() as $row) {
            $uid = (string) $row['uid'];
            if (isset($figures[$uid])) {
                $figures[$uid]['interestPaidMinor'] = cycle_minor($row['interestPaid']);
                $figures[$uid]['penaltiesPaidMinor'] = cycle_minor($row['penaltiesPaid']);
            }
        }

        return array_values($figures);
    }
}

if (!function_exists('cycle_compute_payout')) {
    /**
     * The share-out. Used by BOTH the preview and the settlement so the two can
     * never disagree — settlement re-derives every number here, server-side, and
     * trusts nothing from the client.
     *
     *   groupInterestPool     = SUM over members of interest actually paid
     *   interestRefund(member)= that member's own interest actually paid
     *
     *   groupPenaltyPool      = SUM over members of penalties actually paid
     *   penaltyShare(member)  = groupPenaltyPool / activeMemberCount, SPLIT EQUALLY,
     *                           and ONLY when group_rules.shareOutPenalties = 1.
     *
     *   payoutAmount(member)  = interestRefund(member) + penaltyShare(member)
     *
     * WHY PENALTIES ARE NOT REFUNDED TO WHOEVER PAID THEM: a fine refunded to the
     * person fined is not a fine. The pot is split equally across all active
     * members, so the late payer really loses the money and gets back only their
     * 1/N share, exactly like everyone else. This is the owner's rule — it is not
     * a pro-rata split and it is not a refund. Do not "improve" it.
     *
     * When shareOutPenalties = 0 (the default) the pool is still REPORTED, so an
     * admin can see what the group collected, but nothing is distributed and every
     * penaltyShare is zero — behaviour identical to before the toggle existed.
     *
     * REMAINDER: an equal split rarely divides exactly (1000 tambala over 3
     * members). Everyone takes intdiv(pool, n); the first `remainder` members in
     * joinedAt ASC order — the earliest joiners — take ONE extra minor unit each.
     * Deterministic, and the shares sum to the pool EXACTLY, with no stray tambala
     * created or lost.
     *
     * RECONCILIATION INVARIANT: SUM(payoutAmount) === groupInterestPool +
     * distributedPenalties, exactly, in integer minor units — no float, no epsilon.
     * A share-out that does not balance is never returned, previewed, or settled.
     *
     * @throws RuntimeException when the share-out does not balance.
     *
     * @return array{members:array,poolMinor:int,penaltyPoolMinor:int,shareOutPenalties:bool,
     *               distributedPenaltyMinor:int,payoutSumMinor:int}
     */
    function cycle_compute_payout(PDO $pdo, string $groupId): array
    {
        // Derive the cycle window here rather than taking it from the caller, so
        // preview and settle can never disagree about which cycle they are paying.
        [$cycleStart, $cycleEnd] = cycle_window($pdo, $groupId);
        $figures = cycle_collect_member_figures($pdo, $groupId, $cycleStart, $cycleEnd);

        $rules = cycle_fetch_rules($pdo, $groupId);
        // No rules row => the toggle is off. Never share out by default.
        $shareOut = $rules !== null && (int) ($rules['shareOutPenalties'] ?? 0) === 1;

        $poolMinor = 0;
        $penaltyPoolMinor = 0;
        foreach ($figures as $row) {
            $poolMinor += $row['interestPaidMinor'];
            $penaltyPoolMinor += $row['penaltiesPaidMinor'];
        }

        $activeMemberCount = count($figures);

        // A negative pool means corrupt penalty data. Splitting it would hand out
        // negative payouts; refuse rather than guess.
        if ($penaltyPoolMinor < 0) {
            throw new RuntimeException(
                'Cycle payout failed reconciliation; the penalty pool is negative.'
            );
        }

        $distribute = $shareOut && $activeMemberCount > 0;
        $baseShareMinor = 0;
        $remainderMinor = 0;
        if ($distribute) {
            $baseShareMinor = intdiv($penaltyPoolMinor, $activeMemberCount);
            $remainderMinor = $penaltyPoolMinor - ($baseShareMinor * $activeMemberCount);
        }

        // What actually leaves the group's hands. Zero when the toggle is off, even
        // though the pool itself is still reported.
        $distributedPenaltyMinor = $distribute ? $penaltyPoolMinor : 0;

        $members = [];
        $payoutSumMinor = 0;
        foreach ($figures as $i => $row) {
            // THE RULE, verbatim: a member is refunded the interest they paid...
            $interestRefundMinor = $row['interestPaidMinor'];

            // ...plus, optionally, an EQUAL slice of the penalty pot. The figures
            // arrive ordered by joinedAt ASC, so the earliest joiners absorb the
            // one-minor-unit remainder. Deterministic run to run.
            $penaltyShareMinor = 0;
            if ($distribute) {
                $penaltyShareMinor = $baseShareMinor + ($i < $remainderMinor ? 1 : 0);
            }

            $payoutMinor = $interestRefundMinor + $penaltyShareMinor;
            $payoutSumMinor += $payoutMinor;

            $row['interestRefundMinor'] = $interestRefundMinor;
            $row['penaltyShareMinor'] = $penaltyShareMinor;
            $row['payoutMinor'] = $payoutMinor;
            $members[] = $row;
        }

        // THE GATE. Integer comparison. Nothing unbalanced gets past this line.
        if ($payoutSumMinor !== $poolMinor + $distributedPenaltyMinor) {
            throw new RuntimeException(
                'Cycle payout failed reconciliation; refusing to produce a share-out that does not balance.'
            );
        }

        return [
            'members' => $members,
            'poolMinor' => $poolMinor,
            'penaltyPoolMinor' => $penaltyPoolMinor,
            'shareOutPenalties' => $shareOut,
            'distributedPenaltyMinor' => $distributedPenaltyMinor,
            'payoutSumMinor' => $payoutSumMinor,
        ];
    }
}

if (!function_exists('cycle_equity')) {
    /**
     * GET action=cycle.equity — the borrowing-equity view.
     *
     * This is what an admin reads to decide WHO NEEDS A FORCED LOAN, so members are
     * sorted by shortfall against the per-cycle borrowing target, largest shortfall
     * first: the people most behind are at the top, which is the entire point of
     * the view.
     */
    function cycle_equity(): void
    {
        $groupId = cycle_require_group_id((string) ($_GET['groupId'] ?? ''));

        require_role($groupId, ['admin', 'senior_admin', 'treasurer']);

        $pdo = getDbConnection();
        $rules = cycle_fetch_rules($pdo, $groupId);

        $rawTarget = $rules['loanRulesMinCycleLoanAmount'] ?? null;
        $targetMinor = cycle_minor($rawTarget);
        $hasTarget = $rawTarget !== null && $rawTarget !== '';

        [$cycleStart, $cycleEnd] = cycle_window($pdo, $groupId);
        $figures = cycle_collect_member_figures($pdo, $groupId, $cycleStart, $cycleEnd);

        $poolMinor = 0;
        $penaltyPoolMinor = 0;
        $borrowedTotalMinor = 0;
        $members = [];

        foreach ($figures as $row) {
            $poolMinor += $row['interestPaidMinor'];
            $penaltyPoolMinor += $row['penaltiesPaidMinor'];
            $borrowedTotalMinor += $row['borrowedMinor'];

            // Interest committed by the member's loans but not yet handed over.
            $owedMinor = $row['interestCommittedMinor'] - $row['interestPaidMinor'];

            // Shortfall against the group's per-cycle borrowing target. No target
            // configured => no shortfall; the group has not set one to measure against.
            $shortfallMinor = 0;
            if ($hasTarget) {
                $shortfallMinor = max(0, $targetMinor - $row['borrowedMinor']);
            }

            $members[] = [
                'uid' => $row['uid'],
                'fullName' => $row['fullName'],
                'role' => $row['role'],
                'totalContributed' => money_from_minor($row['contributedMinor']),
                'totalBorrowed' => money_from_minor($row['borrowedMinor']),
                'totalInterestPaid' => money_from_minor($row['interestPaidMinor']),
                'interestOwed' => money_from_minor($owedMinor),
                'shortfallVsTarget' => money_from_minor($shortfallMinor),
                'needsForcedLoan' => $shortfallMinor > 0,
                // Sort key only; not part of the money contract.
                '_shortfallMinor' => $shortfallMinor,
            ];
        }

        // Most-behind first — the whole purpose of this view.
        usort($members, static function (array $a, array $b): int {
            return $b['_shortfallMinor'] <=> $a['_shortfallMinor'];
        });

        foreach ($members as $i => $row) {
            unset($members[$i]['_shortfallMinor']);
        }

        $memberCount = count($members);
        $averageBorrowedMinor = $memberCount > 0
            ? money_div_round_half_up($borrowedTotalMinor, $memberCount)
            : 0;
        $averageInterestPaidMinor = $memberCount > 0
            ? money_div_round_half_up($poolMinor, $memberCount)
            : 0;

        json_response([
            'groupId' => $groupId,
            'members' => $members,
            'summary' => [
                'memberCount' => $memberCount,
                'groupInterestPool' => money_from_minor($poolMinor),
                // Reported here for visibility only; the equity view distributes nothing.
                'groupPenaltyPool' => money_from_minor($penaltyPoolMinor),
                'totalBorrowed' => money_from_minor($borrowedTotalMinor),
                'averageBorrowed' => money_from_minor($averageBorrowedMinor),
                'averageInterestPaid' => money_from_minor($averageInterestPaidMinor),
                'minCycleLoanAmount' => $hasTarget ? money_from_minor($targetMinor) : null,
            ],
        ]);
    }
}

if (!function_exists('forced_loans_preview')) {
    /**
     * GET action=cycle.forced.preview — the tentative compulsory-loan list.
     *
     * THIS IS A PREVIEW ONLY. It computes who is behind the group's forced-loan
     * target and by how much; it originates NOTHING. An admin who wants to act
     * on this list still goes through the existing loans.force endpoint by hand.
     *
     * forcedLoansEnabled is a per-group opt-in (migration 009). When it is off,
     * the feature does not exist for this group and no target is computed at
     * all — this mirrors cycle_equity()'s "no target => no shortfall" posture,
     * just gated one level higher by the toggle.
     *
     * TARGET, by method:
     *   fixed_amount           -> group_rules.loanRulesMinCycleLoanAmount
     *   percentage_of_highest  -> the highest single active member's cycle
     *                             borrowing * forcedLoansPercentageOfHighest / 100,
     *                             rounded half-up in integer minor units.
     *
     * Either method can have no target configured (null column) — the response
     * then reports enabled:true with target:null and an empty member list, same
     * shape cycle_equity() uses when loanRulesMinCycleLoanAmount is unset.
     */
    function forced_loans_preview(): void
    {
        $groupId = cycle_require_group_id((string) ($_GET['groupId'] ?? ''));

        require_role($groupId, ['admin', 'senior_admin', 'treasurer']);

        $pdo = getDbConnection();
        $rules = cycle_fetch_rules($pdo, $groupId);

        $enabled = $rules !== null && (int) ($rules['forcedLoansEnabled'] ?? 0) === 1;
        if (!$enabled) {
            json_response([
                'groupId' => $groupId,
                'enabled' => false,
                'members' => [],
            ]);
            return;
        }

        $method = (string) ($rules['forcedLoansMethod'] ?? 'fixed_amount');

        [$cycleStart, $cycleEnd] = cycle_window($pdo, $groupId);
        $figures = cycle_collect_member_figures($pdo, $groupId, $cycleStart, $cycleEnd);

        $targetMinor = null;

        if ($method === 'fixed_amount') {
            $rawTarget = $rules['loanRulesMinCycleLoanAmount'] ?? null;
            if ($rawTarget !== null && $rawTarget !== '') {
                $targetMinor = cycle_minor($rawTarget);
            }
        } else {
            // percentage_of_highest
            $rawPercentage = $rules['forcedLoansPercentageOfHighest'] ?? null;
            if ($rawPercentage !== null && $rawPercentage !== '') {
                $maxBorrowedMinor = 0;
                foreach ($figures as $row) {
                    $maxBorrowedMinor = max($maxBorrowedMinor, $row['borrowedMinor']);
                }

                $percentageHundredths = money_rate_to_hundredths((string) $rawPercentage);
                $targetMinor = money_div_round_half_up(
                    $maxBorrowedMinor * $percentageHundredths,
                    10000
                );
            }
        }

        if ($targetMinor === null) {
            json_response([
                'groupId' => $groupId,
                'enabled' => true,
                'method' => $method,
                'target' => null,
                'note' => 'No forced-loan target is configured for this method; nothing to preview.',
                'members' => [],
            ]);
            return;
        }

        $members = [];
        foreach ($figures as $row) {
            $shortfallMinor = max(0, $targetMinor - $row['borrowedMinor']);
            $members[] = [
                'uid' => $row['uid'],
                'fullName' => $row['fullName'],
                'borrowed' => money_from_minor($row['borrowedMinor']),
                'shortfall' => money_from_minor($shortfallMinor),
                // Sort key only; not part of the money contract.
                '_shortfallMinor' => $shortfallMinor,
            ];
        }

        usort($members, static function (array $a, array $b): int {
            return $b['_shortfallMinor'] <=> $a['_shortfallMinor'];
        });

        foreach ($members as $i => $row) {
            unset($members[$i]['_shortfallMinor']);
        }

        json_response([
            'groupId' => $groupId,
            'enabled' => true,
            'method' => $method,
            'target' => money_from_minor($targetMinor),
            'members' => $members,
        ]);
    }
}

if (!function_exists('cycle_payout_preview')) {
    /**
     * GET action=cycle.payout.preview — computes the share-out and WRITES NOTHING.
     *
     * The response carries both totals and a `balances` flag so the admin can see
     * with their own eyes that the payouts reconcile to the interest pool before
     * anyone signs off on settling.
     */
    function cycle_payout_preview(): void
    {
        $groupId = cycle_require_group_id((string) ($_GET['groupId'] ?? ''));

        require_role($groupId, ['admin', 'senior_admin', 'treasurer']);

        $pdo = getDbConnection();

        // Throws (and is masked as a 500 by the front controller) if it does not
        // balance. An unbalanced share-out is never shown to anyone.
        $computed = cycle_compute_payout($pdo, $groupId);

        $members = [];
        foreach ($computed['members'] as $row) {
            $members[] = [
                'uid' => $row['uid'],
                'fullName' => $row['fullName'],
                'totalContributed' => money_from_minor($row['contributedMinor']),
                'totalBorrowed' => money_from_minor($row['borrowedMinor']),
                'totalInterestPaid' => money_from_minor($row['interestPaidMinor']),
                'totalPenaltiesPaid' => money_from_minor($row['penaltiesPaidMinor']),
                // The two components of the payout, shown separately so a member can
                // see exactly why they are owed what they are owed.
                'interestRefund' => money_from_minor($row['interestRefundMinor']),
                'penaltyShare' => money_from_minor($row['penaltyShareMinor']),
                'payoutAmount' => money_from_minor($row['payoutMinor']),
            ];
        }

        $expectedMinor = $computed['poolMinor'] + $computed['distributedPenaltyMinor'];

        json_response([
            'groupId' => $groupId,
            'members' => $members,
            'summary' => [
                'memberCount' => count($members),
                'groupInterestPool' => money_from_minor($computed['poolMinor']),
                // Always reported, even when it is not distributed.
                'groupPenaltyPool' => money_from_minor($computed['penaltyPoolMinor']),
                'shareOutPenalties' => $computed['shareOutPenalties'],
                'distributedPenalties' => money_from_minor($computed['distributedPenaltyMinor']),
                'totalPayout' => money_from_minor($computed['payoutSumMinor']),
                'balances' => $computed['payoutSumMinor'] === $expectedMinor,
            ],
        ]);
    }
}

if (!function_exists('cycle_settle')) {
    /**
     * POST action=cycle.settle — records the final share-out.
     *
     * SENIOR ADMIN ONLY. Not admin, not treasurer. Settling pays out real money and
     * is not reversible through this API, so it sits at the highest privilege and
     * additionally demands an explicit confirm:true acknowledgement.
     *
     * WHAT THIS DOES AND DOES NOT DO: it records WHAT IS OWED to each member. The
     * treasurer hands over the cash physically. The app never moves money.
     */
    function cycle_settle(): void
    {
        $body = read_json_body();
        $groupId = cycle_require_group_id((string) ($body['groupId'] ?? ''));
        $confirm = $body['confirm'] ?? null;

        // Deliberately strict: a truthy string or 1 is not an acknowledgement.
        if ($confirm !== true) {
            json_error('confirm must be true to settle a cycle.', 422);
        }

        $caller = require_role($groupId, ['senior_admin']);

        $pdo = getDbConnection();

        $rules = cycle_fetch_rules($pdo, $groupId);
        if ($rules === null || empty($rules['cycleDurationStartDate'])) {
            json_error('This group has no cycle configured; a cycle cannot be settled.', 409);
        }

        $cycleStartDate = (string) $rules['cycleDurationStartDate'];
        $cycleEndDate = $rules['cycleDurationEndDate'] !== null && $rules['cycleDurationEndDate'] !== ''
            ? (string) $rules['cycleDurationEndDate']
            : null;

        // A cycle must never be settled twice — the second settlement would pay the
        // interest pool out a second time.
        $existingStmt = $pdo->prepare(
            'SELECT COUNT(*) AS n FROM cycle_payouts '
            . "WHERE groupId = :groupId AND cycleStartDate = :cycleStartDate AND status = 'settled'"
        );
        $existingStmt->execute([':groupId' => $groupId, ':cycleStartDate' => $cycleStartDate]);
        if ((int) $existingStmt->fetch()['n'] > 0) {
            json_error('This cycle has already been settled.', 409);
        }

        // Every figure is re-derived server-side. Nothing the client sent about
        // money is read, and the preview's numbers are not trusted either.
        try {
            $computed = cycle_compute_payout($pdo, $groupId);
        } catch (RuntimeException $e) {
            json_error('The share-out does not balance; the cycle cannot be settled.', 500);
        }

        if ($computed['members'] === []) {
            json_error('This group has no active members to settle.', 409);
        }

        // Belt and braces: refuse rather than write an unbalanced settlement. The
        // total handed out must equal the interest pool plus whatever share of the
        // penalty pot the group actually chose to distribute — nothing conjured,
        // nothing left stranded.
        $expectedMinor = $computed['poolMinor'] + $computed['distributedPenaltyMinor'];
        if ($computed['payoutSumMinor'] !== $expectedMinor) {
            json_error('The share-out does not balance; the cycle cannot be settled.', 500);
        }

        $poolAmount = money_from_minor($computed['poolMinor']);
        $penaltyPoolAmount = money_from_minor($computed['penaltyPoolMinor']);

        // One member's payout row missing would leave a member unpaid on a cycle
        // that reads as settled. All rows land, or none do.
        $pdo->beginTransaction();
        try {
            $insertStmt = $pdo->prepare(
                'INSERT INTO cycle_payouts '
                . '(groupId, uid, cycleStartDate, cycleEndDate, totalContributed, totalBorrowed, '
                . 'totalInterestPaid, totalPenaltiesPaid, groupInterestPool, groupPenaltyPool, '
                . 'interestRefund, penaltyShare, payoutAmount, '
                . 'status, settledBy, settledAt, createdAt, updatedAt) '
                . 'VALUES (:groupId, :uid, :cycleStartDate, :cycleEndDate, :totalContributed, '
                . ':totalBorrowed, :totalInterestPaid, :totalPenaltiesPaid, :groupInterestPool, '
                . ':groupPenaltyPool, :interestRefund, :penaltyShare, '
                . ":payoutAmount, 'settled', :settledBy, NOW(), NOW(), NOW())"
            );

            foreach ($computed['members'] as $row) {
                $insertStmt->execute([
                    ':groupId' => $groupId,
                    ':uid' => $row['uid'],
                    ':cycleStartDate' => $cycleStartDate,
                    ':cycleEndDate' => $cycleEndDate,
                    ':totalContributed' => money_from_minor($row['contributedMinor']),
                    ':totalBorrowed' => money_from_minor($row['borrowedMinor']),
                    ':totalInterestPaid' => money_from_minor($row['interestPaidMinor']),
                    ':totalPenaltiesPaid' => money_from_minor($row['penaltiesPaidMinor']),
                    ':groupInterestPool' => $poolAmount,
                    ':groupPenaltyPool' => $penaltyPoolAmount,
                    ':interestRefund' => money_from_minor($row['interestRefundMinor']),
                    ':penaltyShare' => money_from_minor($row['penaltyShareMinor']),
                    ':payoutAmount' => money_from_minor($row['payoutMinor']),
                    ':settledBy' => $caller['uid'],
                ]);
            }

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        $rowsStmt = $pdo->prepare(
            'SELECT payoutId, groupId, uid, cycleStartDate, cycleEndDate, totalContributed, '
            . 'totalBorrowed, totalInterestPaid, totalPenaltiesPaid, groupInterestPool, '
            . 'groupPenaltyPool, interestRefund, penaltyShare, '
            . 'payoutAmount, status, settledBy, settledAt, createdAt, updatedAt '
            . 'FROM cycle_payouts '
            . 'WHERE groupId = :groupId AND cycleStartDate = :cycleStartDate '
            . 'ORDER BY payoutAmount DESC'
        );
        $rowsStmt->execute([':groupId' => $groupId, ':cycleStartDate' => $cycleStartDate]);

        json_response([
            'groupId' => $groupId,
            'cycleStartDate' => $cycleStartDate,
            'cycleEndDate' => $cycleEndDate,
            'groupInterestPool' => $poolAmount,
            'groupPenaltyPool' => $penaltyPoolAmount,
            'shareOutPenalties' => $computed['shareOutPenalties'],
            'distributedPenalties' => money_from_minor($computed['distributedPenaltyMinor']),
            'totalPayout' => money_from_minor($computed['payoutSumMinor']),
            'balances' => true,
            'payouts' => $rowsStmt->fetchAll(),
        ], 201);
    }
}
