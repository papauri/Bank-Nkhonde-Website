<?php
/**
 * Member account-statement endpoint: contributions, loan account, penalties.
 *
 * THIS FILE MOVES REAL MONEY (in the sense that it reports it). Every currency
 * value is handled as an integer count of minor units via api/lib/money.php
 * and only formatted to a decimal string for output. No float ever touches an
 * amount.
 *
 * Read-only: this file never writes to payments, loan_payments, loans, or
 * penalty_settlements. It aggregates settled rows already written by
 * payments.php / repayments.php into three chronological, running-balance
 * ledgers for ONE member of ONE group.
 *
 * Authorization mirrors payments.php my_obligations(): a plain member may only
 * ever see their own statement; an admin/senior_admin/treasurer may pass an
 * explicit ?uid= to view another member's statement, but only for a real
 * member of the same group (404 otherwise).
 */

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/session.php';
require_once __DIR__ . '/../lib/money.php';
require_once __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/payments.php';

// Same admin-equivalent gate as payments.php's my_obligations()/record_payment().
const STATEMENT_ANY_MEMBER_ROLES = ['member', 'admin', 'senior_admin', 'treasurer'];
const STATEMENT_ADMIN_ROLES = ['admin', 'senior_admin', 'treasurer'];

// Human labels for payments.paymentType, reused for the contributions ledger.
const STATEMENT_PAYMENT_TYPE_LABELS = [
    'seed_money' => 'Seed money',
    'monthly_contribution' => 'Monthly contribution',
    'service_fee' => 'Service fee',
];

if (!function_exists('statement_member_fullname')) {
    /**
     * Fetch the target member's display name from the members table, scoped
     * to this group. Returns null if the row is somehow missing (should not
     * happen once the admin-uid guard has already validated membership).
     */
    function statement_member_fullname(PDO $pdo, string $groupId, string $uid): ?string
    {
        $member = payment_fetch_member($pdo, $groupId, $uid);
        return $member === null ? null : (string) $member['fullName'];
    }
}

if (!function_exists('statement_build_contributions')) {
    /**
     * Every SETTLED payment row for the member, chronological ascending, with
     * a running savings-position balance. Settled = approvalStatus IN
     * PAYMENT_SETTLED_STATUSES (payments.php:48), settlement date = approvedAt
     * (payments.php:223 per the scout map).
     */
    function statement_build_contributions(PDO $pdo, string $groupId, string $uid, ?int $year): array
    {
        /* paidAt AS WELL AS approvedAt. A statement line showed "N/A" for its
           date on every legacy row: approvedAt is NULL on payments recorded
           before the approval path stamped it, while paidAt — the date the money
           actually changed hands — was populated all along. Reading only
           approvedAt threw away a real date and printed nothing.
           COALESCE order is deliberate: when the money moved is what a statement
           is about; when an admin ticked it off is the fallback. */
        $sql = 'SELECT paymentId, paymentType, year, month, amountPaid, '
            . 'COALESCE(paidAt, approvedAt) AS statementDate, approvedAt '
            . 'FROM payments '
            . 'WHERE groupId = :groupId AND uid = :uid '
            . "AND approvalStatus IN ('approved', 'completed') ";
        $params = [':groupId' => $groupId, ':uid' => $uid];
        if ($year !== null) {
            $sql .= 'AND year = :year ';
            $params[':year'] = $year;
        }
        $sql .= 'ORDER BY COALESCE(paidAt, approvedAt) ASC';

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        $lines = [];
        $runningMinor = 0;
        $totalMinor = 0;

        while (($row = $stmt->fetch()) !== false) {
            $amountMinor = money_to_minor(trim((string) $row['amountPaid']));
            $runningMinor += $amountMinor;
            $totalMinor += $amountMinor;

            $label = STATEMENT_PAYMENT_TYPE_LABELS[$row['paymentType']] ?? (string) $row['paymentType'];
            $description = $label;
            if ($row['month'] !== null) {
                $description .= ' (' . $row['month'] . ' ' . $row['year'] . ')';
            } elseif ($row['year'] !== null) {
                $description .= ' (' . $row['year'] . ')';
            }

            $lines[] = [
                'date' => $row['statementDate'],
                'type' => $row['paymentType'],
                'description' => $description,
                'amountMinor' => $amountMinor,
                'amount' => money_from_minor($amountMinor),
                'runningBalanceMinor' => $runningMinor,
                'runningBalance' => money_from_minor($runningMinor),
            ];
        }

        return [
            'lines' => $lines,
            'totalMinor' => $totalMinor,
            'total' => money_from_minor($totalMinor),
        ];
    }
}

if (!function_exists('statement_build_loan_account')) {
    /**
     * Chronological loan events for the member: a disbursement line per loan
     * that reached 'approved'/'disbursed'/'completed' status, and a repayment
     * line per settled loan_payments row. Outstanding balance moves by the
     * PRINCIPAL portion only (loan_payments splits principal/interest/penalty
     * into separate columns per repayments.php:360-366 — interest is recorded
     * on the line but does not reduce outstanding, matching how remainingBalance
     * is derived elsewhere in repayments.php).
     *
     * disbursedAt is not populated by any current write path (confirmed in the
     * scout map), so the disbursement date falls back to approvedAt; the
     * disbursed amount falls back through disbursedAmount -> approvedAmount ->
     * principalAmount, matching loans.php's own fallback at line 189.
     */
    function statement_build_loan_account(PDO $pdo, string $groupId, string $uid, ?int $year): array
    {
        $loanStmt = $pdo->prepare(
            'SELECT loanId, loanNumber, principalAmount, approvedAmount, disbursedAmount, '
            . 'disbursedAt, approvedAt, requestedAt '
            . 'FROM loans '
            . "WHERE groupId = :groupId AND borrowerId = :uid AND status IN ('approved', 'disbursed', 'completed')"
        );
        $loanStmt->execute([':groupId' => $groupId, ':uid' => $uid]);
        $loans = $loanStmt->fetchAll();

        $events = [];
        $loanNumbersById = [];

        foreach ($loans as $loan) {
            $date = $loan['disbursedAt'] ?? $loan['approvedAt'];
            if ($date === null) {
                continue; // not actually approved/disbursed yet despite the status filter
            }
            if ($year !== null && (int) substr((string) $date, 0, 4) !== $year) {
                continue;
            }

            $amountRaw = $loan['disbursedAmount'] ?? $loan['approvedAmount'] ?? $loan['principalAmount'];
            $amountMinor = money_to_minor(trim((string) $amountRaw));
            $loanNumbersById[$loan['loanId']] = (string) $loan['loanNumber'];

            $events[] = [
                'sortKey' => $date,
                'date' => $date,
                'event' => 'disbursement',
                'loanNumber' => (string) $loan['loanNumber'],
                'amountMinor' => $amountMinor,
                'amount' => money_from_minor($amountMinor),
                'principalMinor' => $amountMinor,
            ];
        }

        // Need loanNumber for repayments even on loans not in the disbursed set
        // above (defensive — should not happen, but a repayment implies the
        // loan was approved). Fetch any missing loanNumbers by loanId.
        $repayStmt = $pdo->prepare(
            'SELECT lp.paymentId, lp.loanId, lp.amount, lp.principalPortion, lp.interestPortion, '
            . 'lp.penaltyPortion, lp.approvedAt, l.loanNumber '
            . 'FROM loan_payments lp '
            . 'JOIN loans l ON l.loanId = lp.loanId '
            . "WHERE lp.groupId = :groupId AND lp.uid = :uid AND lp.status = 'approved'"
        );
        $repayStmt->execute([':groupId' => $groupId, ':uid' => $uid]);
        $repayments = $repayStmt->fetchAll();

        foreach ($repayments as $rp) {
            $date = $rp['approvedAt'];
            if ($date === null) {
                continue;
            }
            if ($year !== null && (int) substr((string) $date, 0, 4) !== $year) {
                continue;
            }

            $totalMinor = money_to_minor(trim((string) $rp['amount']));
            $principalMinor = money_to_minor(trim((string) $rp['principalPortion']));
            $interestMinor = money_to_minor(trim((string) $rp['interestPortion']));
            $penaltyMinor = money_to_minor(trim((string) $rp['penaltyPortion']));

            $events[] = [
                'sortKey' => $date,
                'date' => $date,
                'event' => 'repayment',
                'loanNumber' => (string) $rp['loanNumber'],
                'amountMinor' => $totalMinor,
                'amount' => money_from_minor($totalMinor),
                'principalMinor' => $principalMinor,
                'principal' => money_from_minor($principalMinor),
                'interestMinor' => $interestMinor,
                'interest' => money_from_minor($interestMinor),
                'penaltyMinor' => $penaltyMinor,
                'penalty' => money_from_minor($penaltyMinor),
            ];
        }

        usort($events, function (array $a, array $b): int {
            return strcmp((string) $a['sortKey'], (string) $b['sortKey']);
        });

        $lines = [];
        $runningMinor = 0;
        $totalDisbursedMinor = 0;
        $totalRepaidMinor = 0;

        foreach ($events as $event) {
            if ($event['event'] === 'disbursement') {
                $runningMinor += $event['principalMinor'];
                $totalDisbursedMinor += $event['amountMinor'];
            } else {
                $runningMinor -= $event['principalMinor'];
                $totalRepaidMinor += $event['amountMinor'];
            }

            $line = [
                'date' => $event['date'],
                'event' => $event['event'],
                'loanNumber' => $event['loanNumber'],
                'amountMinor' => $event['amountMinor'],
                'amount' => $event['amount'],
                'runningOutstandingMinor' => $runningMinor,
                'runningOutstanding' => money_from_minor($runningMinor),
            ];
            if ($event['event'] === 'repayment') {
                $line['principalMinor'] = $event['principalMinor'];
                $line['principal'] = $event['principal'];
                $line['interestMinor'] = $event['interestMinor'];
                $line['interest'] = $event['interest'];
                $line['penaltyMinor'] = $event['penaltyMinor'];
                $line['penalty'] = $event['penalty'];
            }
            $lines[] = $line;
        }

        return [
            'lines' => $lines,
            'totalDisbursedMinor' => $totalDisbursedMinor,
            'totalDisbursed' => money_from_minor($totalDisbursedMinor),
            'totalRepaidMinor' => $totalRepaidMinor,
            'totalRepaid' => money_from_minor($totalRepaidMinor),
            'outstandingMinor' => $runningMinor,
            'outstanding' => money_from_minor($runningMinor),
        ];
    }
}

if (!function_exists('statement_build_penalties')) {
    /**
     * Charged (paid/partial) vs waived penalty_settlements rows for the
     * member, chronological ascending, with charged/waived/net totals.
     */
    function statement_build_penalties(PDO $pdo, string $groupId, string $uid, ?int $year): array
    {
        $sql = 'SELECT ps.status, ps.amountPaid, ps.amountWaived, ps.settledAt, ps.loanId, '
            . 'ps.paymentId, l.loanNumber '
            . 'FROM penalty_settlements ps '
            . 'LEFT JOIN loans l ON l.loanId = ps.loanId '
            . 'WHERE ps.groupId = :groupId AND ps.uid = :uid ';
        $params = [':groupId' => $groupId, ':uid' => $uid];
        if ($year !== null) {
            $sql .= 'AND YEAR(ps.settledAt) = :year ';
            $params[':year'] = $year;
        }
        $sql .= 'ORDER BY ps.settledAt ASC';

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        $lines = [];
        $totalChargedMinor = 0;
        $totalWaivedMinor = 0;

        while (($row = $stmt->fetch()) !== false) {
            $waived = $row['status'] === 'waived';
            $amountMinor = money_to_minor(trim((string) ($waived ? $row['amountWaived'] : $row['amountPaid'])));
            $context = $row['loanNumber'] !== null
                ? (string) $row['loanNumber']
                : ($row['paymentId'] !== null ? (string) $row['paymentId'] : null);

            if ($waived) {
                $totalWaivedMinor += $amountMinor;
            } else {
                $totalChargedMinor += $amountMinor;
            }

            $lines[] = [
                'date' => $row['settledAt'],
                'event' => $waived ? 'waived' : 'charged',
                'amountMinor' => $amountMinor,
                'amount' => money_from_minor($amountMinor),
                'context' => $context,
            ];
        }

        return [
            'lines' => $lines,
            'totalChargedMinor' => $totalChargedMinor,
            'totalCharged' => money_from_minor($totalChargedMinor),
            'totalWaivedMinor' => $totalWaivedMinor,
            'totalWaived' => money_from_minor($totalWaivedMinor),
            'netMinor' => $totalChargedMinor - $totalWaivedMinor,
            'net' => money_from_minor($totalChargedMinor - $totalWaivedMinor),
        ];
    }
}

if (!function_exists('statement_resolve_uid')) {
    /**
     * Admin-uid override — copied verbatim from payments.php my_obligations()
     * (lines 920-932): a plain member's foreign uid is refused, never
     * silently ignored; an admin-equivalent role may target any real
     * member of THIS group, 404 otherwise.
     */
    function statement_resolve_uid(PDO $pdo, string $groupId, array $caller): string
    {
        $uid = (string) $caller['uid'];
        $requested = $_GET['uid'] ?? null;
        if (is_string($requested) && trim($requested) !== '' && trim($requested) !== (string) $caller['uid']) {
            if (!in_array((string) $caller['role'], STATEMENT_ADMIN_ROLES, true)) {
                json_error('You may only view your own statement.', 403);
            }
            $uid = trim($requested);
            if (payment_fetch_member($pdo, $groupId, $uid) === null) {
                json_error('That member is not in this group.', 404);
            }
        }
        return $uid;
    }
}

if (!function_exists('statement_resolve_year')) {
    function statement_resolve_year(): ?int
    {
        if (!isset($_GET['year']) || $_GET['year'] === '') {
            return null;
        }
        $year = (int) $_GET['year'];
        if ($year < 2000 || $year > 2100) {
            json_error('Invalid year.', 422);
        }
        return $year;
    }
}

if (!function_exists('statement_assemble')) {
    /**
     * Single source of truth for the statement payload: resolves the target
     * member (self or admin-uid-override) and builds the same three ledgers
     * used by both statement.get (JSON) and exports.statement (CSV), so the
     * numbers can never drift between the two endpoints.
     */
    function statement_assemble(): array
    {
        $groupId = (string) ($_GET['groupId'] ?? '');
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        $caller = require_role($groupId, STATEMENT_ANY_MEMBER_ROLES);

        $pdo = getDbConnection();

        $uid = statement_resolve_uid($pdo, $groupId, $caller);
        $year = statement_resolve_year();

        $fullName = statement_member_fullname($pdo, $groupId, $uid);

        return [
            'groupId' => $groupId,
            'uid' => $uid,
            'year' => $year,
            'member' => [
                'uid' => $uid,
                'fullName' => $fullName,
            ],
            'contributions' => statement_build_contributions($pdo, $groupId, $uid, $year),
            'loanAccount' => statement_build_loan_account($pdo, $groupId, $uid, $year),
            'penalties' => statement_build_penalties($pdo, $groupId, $uid, $year),
        ];
    }
}

if (!function_exists('get_statement')) {
    /**
     * GET statement.get — a member's own account statement, or (for an
     * admin/senior_admin/treasurer) any member's statement via ?uid=.
     *
     * Query params: groupId (required), uid (optional, admin-only override),
     * year (optional, bounds-checked like list_payments' year filter).
     */
    function get_statement(): void
    {
        $data = statement_assemble();

        json_response([
            'member' => $data['member'],
            'year' => $data['year'],
            'contributions' => $data['contributions'],
            'loanAccount' => $data['loanAccount'],
            'penalties' => $data['penalties'],
            'generatedAt' => gmdate('Y-m-d\TH:i:s\Z'),
        ]);
    }
}

if (!function_exists('export_statement')) {
    /**
     * GET exports.statement — the same statement_assemble() payload as
     * statement.get, flattened into a single CSV covering all three
     * ledgers plus their totals. Member-scoped exactly like statement.get
     * (NOT admin-only like the other exports.* endpoints): a plain member
     * exports their own statement; an admin/senior_admin/treasurer may
     * export any member's via ?uid=.
     *
     * All Amount/Running Balance cells reuse the already-formatted
     * money_from_minor() strings the builders return — no re-derived math.
     */
    function export_statement(): void
    {
        $data = statement_assemble();
        $groupId = $data['groupId'];

        export_csv_headers('statement', $groupId);

        $out = fopen('php://output', 'w');
        export_csv_row($out, ['Section', 'Date', 'Type/Event', 'Description', 'Amount', 'Running Balance']);

        foreach ($data['contributions']['lines'] as $line) {
            export_csv_row($out, [
                'Contributions',
                $line['date'],
                $line['type'],
                $line['description'],
                $line['amount'],
                $line['runningBalance'],
            ]);
        }
        export_csv_row($out, ['Contributions', '', '', 'Contributions Total', $data['contributions']['total'], '']);

        foreach ($data['loanAccount']['lines'] as $line) {
            $description = $line['loanNumber'];
            if ($line['event'] === 'repayment') {
                $description .= ' (interest ' . $line['interest'] . ', penalty ' . $line['penalty'] . ')';
            }
            export_csv_row($out, [
                'Loan Account',
                $line['date'],
                $line['event'],
                $description,
                $line['amount'],
                $line['runningOutstanding'],
            ]);
        }
        export_csv_row($out, [
            'Loan Account', '', '', 'Loan Outstanding', '', $data['loanAccount']['outstanding'],
        ]);

        foreach ($data['penalties']['lines'] as $line) {
            export_csv_row($out, [
                'Penalties',
                $line['date'],
                $line['event'],
                (string) ($line['context'] ?? ''),
                $line['amount'],
                '',
            ]);
        }
        export_csv_row($out, ['Penalties', '', '', 'Penalties Charged Total', $data['penalties']['totalCharged'], '']);
        export_csv_row($out, ['Penalties', '', '', 'Penalties Waived Total', $data['penalties']['totalWaived'], '']);
        export_csv_row($out, ['Penalties', '', '', 'Penalties Net Total', $data['penalties']['net'], '']);

        fclose($out);
        exit;
    }
}
