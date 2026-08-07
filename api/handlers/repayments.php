<?php
/**
 * Loan repayment endpoints: balance, record, approve, waive.
 *
 * THIS FILE MOVES REAL MONEY. Every currency value is handled as an integer
 * count of minor units via api/lib/money.php. No float ever touches an amount.
 *
 * Authorization is re-checked server-side on every call via require_role()
 * against the members table. A loanId or borrowerId in a request body is never
 * an authorization claim: the groupId used for the gate always comes from the
 * loan ROW, never from the caller.
 *
 * The repayment flow mirrors the existing proof-of-payment approval flow:
 *   record  -> a 'pending' loan_payments row, with the split already computed.
 *              NOTHING in the ledger moves yet.
 *   approve -> an admin/treasurer confirms the cash landed; only THEN does the
 *              schedule, the loan and the penalty settlement move, in one
 *              transaction. A payment approved without the ledger moving is a
 *              corrupt record, so it is all-or-nothing.
 */

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/session.php';
require_once __DIR__ . '/../lib/money.php';
require_once __DIR__ . '/../lib/penalty.php';
require_once __DIR__ . '/../../config/database.php';

// A repayment may be recorded against a loan that is live. A pending loan has no
// schedule to pay into; a completed/rejected/defaulted one is closed.
const REPAYMENT_PAYABLE_STATUSES = ['approved', 'disbursed'];

const REPAYMENT_METHODS = ['cash', 'bank_transfer', 'mobile_money'];

// Admin-equivalent gate. A treasurer takes the cash in person, so they approve.
const REPAYMENT_ADMIN_ROLES = ['admin', 'senior_admin', 'treasurer'];
const REPAYMENT_ANY_MEMBER_ROLES = ['member', 'admin', 'senior_admin', 'treasurer'];

if (!function_exists('repayment_money_input_to_string')) {
    /**
     * Normalise a JSON-decoded money input into a decimal string for
     * money_to_minor(). A JSON float is formatted to 2dp here — that is a parse
     * of a value we were handed, not arithmetic. No float is used to COMPUTE money.
     */
    function repayment_money_input_to_string($value): string
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

if (!function_exists('repayment_fetch_loan')) {
    /**
     * Load a loan row by id, or 404. The groupId on the ROW is the authority for
     * the role check that follows.
     */
    function repayment_fetch_loan(PDO $pdo, string $loanId): array
    {
        $stmt = $pdo->prepare(
            'SELECT loanId, groupId, loanNumber, borrowerId, borrowerName, status, '
            . 'principalAmount, approvedAmount, repaymentPeriod, totalInterest, totalRepayment, '
            . 'monthlyPayment, amountRepaid, remainingBalance, penaltiesCharged, completedAt '
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

if (!function_exists('repayment_fetch_schedule')) {
    /**
     * The loan's instalments, oldest first. This ordering IS the allocation order.
     */
    function repayment_fetch_schedule(PDO $pdo, string $loanId): array
    {
        $stmt = $pdo->prepare(
            'SELECT scheduleId, loanId, month, dueDate, principalDue, interestDue, totalDue, '
            . 'amountPaid, balance, status, paidAt '
            . 'FROM loan_repayment_schedule WHERE loanId = :loanId ORDER BY month ASC'
        );
        $stmt->execute([':loanId' => $loanId]);

        return $stmt->fetchAll();
    }
}

if (!function_exists('repayment_penalty_or_501')) {
    /**
     * Run the penalty engine, mapping its refusal to a 501. The engine throws
     * rather than guessing when a group's penalty config cannot be honoured
     * (percentage penalties, or 'fixed' with no daily amount) — a wrong charge
     * against a real member is worse than a failed request.
     */
    function repayment_penalty_or_501(array $loan, ?array $rules, ?string $asOf = null): array
    {
        try {
            return compute_loan_penalty($loan, $rules, $asOf);
        } catch (RuntimeException $e) {
            json_error($e->getMessage(), 501);
        }
    }
}

if (!function_exists('repayment_split_instalment')) {
    /**
     * Split an instalment's settled amountPaid back into its interest and
     * principal parts.
     *
     * The schedule stores only an aggregate amountPaid, so the split has to be
     * re-derived. It is derived under the SAME order the allocator applies
     * (interest before principal), which is what keeps the two consistent: money
     * already paid into an instalment is treated as having cleared its interest
     * first.
     *
     * @return array{interestOutstanding:int, principalOutstanding:int}
     */
    function repayment_split_instalment(array $row): array
    {
        $interestDue = money_to_minor(trim((string) $row['interestDue']));
        $principalDue = money_to_minor(trim((string) $row['principalDue']));
        $paid = money_to_minor(trim((string) $row['amountPaid']));

        $interestPaid = min($paid, $interestDue);
        $principalPaid = $paid - $interestPaid;

        return [
            'interestOutstanding' => max(0, $interestDue - $interestPaid),
            'principalOutstanding' => max(0, $principalDue - $principalPaid),
        ];
    }
}

if (!function_exists('repayment_allocate')) {
    /**
     * Split a payment across penalty, interest and principal.
     *
     * ALLOCATION ORDER — 1) PENALTY  2) INTEREST  3) PRINCIPAL.
     *
     * Rationale: penalties and interest are the COST of the debt; principal is
     * the debt itself. If principal were cleared first, the penalty would keep
     * accruing on a loan the member is actively paying down — they would pay and
     * pay and still fall further behind. Cost first, then the debt.
     *
     * Interest and principal are filled instalment by instalment, oldest first:
     * the oldest instalment's interest, then its principal, then the next one's.
     * Paying the oldest instalment down is what eventually clears the overdue
     * balance and stops the daily penalty.
     *
     * @return array{penalty:int, interest:int, principal:int, scheduledMonth:?int}
     *
     * @throws RuntimeException if the portions do not reconcile to the payment.
     */
    function repayment_allocate(int $amountMinor, int $penaltyOutstandingMinor, array $schedule): array
    {
        $remaining = $amountMinor;

        // 1) PENALTY — the cost of being late, settled before anything else.
        $penaltyMinor = min($remaining, max(0, $penaltyOutstandingMinor));
        $remaining -= $penaltyMinor;

        $interestMinor = 0;
        $principalMinor = 0;
        $scheduledMonth = null;

        foreach ($schedule as $row) {
            if ($remaining <= 0) {
                break;
            }

            $outstanding = repayment_split_instalment($row);
            if ($outstanding['interestOutstanding'] === 0 && $outstanding['principalOutstanding'] === 0) {
                continue;
            }

            if ($scheduledMonth === null) {
                $scheduledMonth = (int) $row['month'];
            }

            // 2) INTEREST on this instalment.
            $payInterest = min($remaining, $outstanding['interestOutstanding']);
            $interestMinor += $payInterest;
            $remaining -= $payInterest;

            if ($remaining <= 0) {
                break;
            }

            // 3) PRINCIPAL on this instalment.
            $payPrincipal = min($remaining, $outstanding['principalOutstanding']);
            $principalMinor += $payPrincipal;
            $remaining -= $payPrincipal;
        }

        // The caller has already rejected any payment larger than the outstanding
        // total, so the allocator must always consume the payment in full. A
        // leftover here means the cap and the schedule disagree — that is a
        // corrupt ledger, not something to paper over with a credit balance.
        if ($remaining !== 0) {
            throw new RuntimeException('Repayment allocation did not consume the payment in full.');
        }

        // THE RECONCILIATION ASSERT: the three portions must sum EXACTLY to the
        // amount paid. A payment whose parts do not add up to the whole is a
        // corrupt financial record; refuse to produce it.
        if ($penaltyMinor + $interestMinor + $principalMinor !== $amountMinor) {
            throw new RuntimeException('Repayment portions do not sum to the amount paid.');
        }

        return [
            'penalty' => $penaltyMinor,
            'interest' => $interestMinor,
            'principal' => $principalMinor,
            'scheduledMonth' => $scheduledMonth,
        ];
    }
}

if (!function_exists('repayment_quick_amounts')) {
    /**
     * The preset amounts a borrower can pay, computed SERVER-SIDE.
     *
     * These exist so nobody has to work out what to type. The browser must never
     * derive them: "the next instalment" is penalty + that instalment's
     * outstanding, and getting it wrong hands someone a figure that under- or
     * over-pays what they think they are settling.
     *
     * PENALTY IS INCLUDED IN EVERY OPTION, and that is deliberate.
     * repayment_allocate() applies a payment to penalty FIRST, then interest,
     * then principal. So an option worth exactly one instalment would have its
     * penalty skimmed off the top and would NOT actually clear that instalment.
     * Each preset is therefore what must be paid for the described outcome to
     * genuinely happen.
     *
     * Every figure is capped by the same $totalOutstandingMinor that
     * record_repayment() enforces, so a preset can never be rejected as an
     * overpayment by the very endpoint it was built for.
     *
     * @param array $schedule loan_repayment_schedule rows, month ASC
     * @param int   $penaltyOutstandingMinor live penalty still owed
     * @return array<int, array{key:string,label:string,description:string,amount:string}>
     */
    function repayment_quick_amounts(array $schedule, int $penaltyOutstandingMinor): array
    {
        $today = new DateTimeImmutable('today');

        $scheduleOutstandingMinor = 0;
        $overdueOutstandingMinor = 0;
        $nextInstalmentMinor = 0;
        $nextInstalmentFound = false;
        $nextDueDate = null;
        $lastDueDate = null;
        $overdueCount = 0;

        foreach ($schedule as $row) {
            $split = repayment_split_instalment($row);
            $rowOutstanding = $split['interestOutstanding'] + $split['principalOutstanding'];
            if ($rowOutstanding <= 0) {
                continue;
            }

            $scheduleOutstandingMinor += $rowOutstanding;
            $lastDueDate = $row['dueDate'] ?? $lastDueDate;

            // The earliest unsettled instalment is the "next" one to pay.
            if (!$nextInstalmentFound) {
                $nextInstalmentMinor = $rowOutstanding;
                $nextInstalmentFound = true;
                $nextDueDate = $row['dueDate'] ?? null;
            }

            $due = $row['dueDate'] === null ? null : (string) $row['dueDate'];
            if ($due !== null && $due !== '') {
                try {
                    if (new DateTimeImmutable($due) < $today) {
                        $overdueOutstandingMinor += $rowOutstanding;
                        $overdueCount++;
                    }
                } catch (Exception $e) {
                    // An unparseable due date is not treated as overdue — never
                    // demand money early on the strength of a bad date.
                }
            }
        }

        $totalOutstandingMinor = $penaltyOutstandingMinor + $scheduleOutstandingMinor;
        if ($totalOutstandingMinor <= 0) {
            return [];
        }

        $options = [];
        $seen = [];

        $add = static function (
            string $key,
            string $label,
            string $description,
            int $minor,
            ?string $dueDate = null,
            int $penaltyPartMinor = 0
        ) use (&$options, &$seen, $totalOutstandingMinor): void {
            if ($minor <= 0) {
                return;
            }
            $minor = min($minor, $totalOutstandingMinor);
            // Two presets worth the same money are one preset — offering "next
            // instalment" and "pay off in full" as separate buttons for an
            // identical figure just makes the choice look meaningful when it is not.
            if (isset($seen[$minor])) {
                return;
            }
            $seen[$minor] = true;
            /* WHAT THE MONEY IS ACTUALLY FOR.
               A preset labelled "Next instalment — MWK 237,000.01" reads as a
               237,000 instalment. It is really a 0.01 instalment plus 237,000 of
               accrued penalty. The figure was right and the label hid it, which
               is worse than either alone. Sent as components so the UI can
               itemise instead of presenting one opaque total.
               `penalty` is capped at the (possibly clamped) preset so the two
               parts always sum to `amount` exactly. */
            $penaltyShown = min($penaltyPartMinor, $minor);
            $options[] = [
                'key' => $key,
                'label' => $label,
                'description' => $description,
                'amount' => money_from_minor($minor),
                'breakdown' => [
                    'loan' => money_from_minor($minor - $penaltyShown),
                    'penalty' => money_from_minor($penaltyShown),
                ],
                // When this preset is due. Null where the concept does not apply
                // (a penalty is owed now; a full settlement has no single date).
                'dueDate' => $dueDate,
            ];
        };

        if ($penaltyOutstandingMinor > 0) {
            $add(
                'penalty_only',
                'Penalty only',
                'Clears the penalty that has built up, leaving the loan itself unchanged.',
                $penaltyOutstandingMinor,
                null,
                $penaltyOutstandingMinor
            );
        }

        $add(
            'next_instalment',
            'Next instalment',
            $penaltyOutstandingMinor > 0
                ? 'The next instalment plus the outstanding penalty, which is what it takes to actually clear it.'
                : 'The next instalment due on this loan.',
            $penaltyOutstandingMinor + $nextInstalmentMinor,
            $nextDueDate,
            $penaltyOutstandingMinor
        );

        $add(
            'overdue',
            'Everything overdue',
            $overdueCount === 1
                ? 'The one instalment already past its due date, plus the penalty.'
                : $overdueCount . ' instalments already past their due date, plus the penalty.',
            $penaltyOutstandingMinor + $overdueOutstandingMinor,
            null,
            $penaltyOutstandingMinor
        );

        $add(
            'settle_full',
            'Pay off in full',
            'Settles the loan completely — nothing further would be owed on it. Last instalment would otherwise fall due '
                . ($lastDueDate === null ? 'later' : substr((string) $lastDueDate, 0, 10)) . '.',
            $totalOutstandingMinor,
            null,
            $penaltyOutstandingMinor
        );

        return $options;
    }
}

if (!function_exists('repayment_upcoming_instalments')) {
    /**
     * The instalments still to pay, each with its date and whether it is late.
     *
     * "What do I owe next, and what comes after it" is a question a borrower
     * asks constantly and the app could not previously answer — the form showed
     * one figure and no dates at all.
     *
     * @param array $schedule loan_repayment_schedule rows, month ASC
     * @return array<int, array{month:int,dueDate:?string,amount:string,overdue:bool}>
     */
    function repayment_upcoming_instalments(array $schedule): array
    {
        $today = new DateTimeImmutable('today');
        $out = [];

        foreach ($schedule as $row) {
            $split = repayment_split_instalment($row);
            $outstanding = $split['interestOutstanding'] + $split['principalOutstanding'];
            if ($outstanding <= 0) {
                continue;
            }

            $due = $row['dueDate'] ?? null;
            $overdue = false;
            if ($due !== null && $due !== '') {
                try {
                    $overdue = new DateTimeImmutable((string) $due) < $today;
                } catch (Exception $e) {
                    $overdue = false;
                }
            }

            $out[] = [
                'month' => (int) $row['month'],
                'dueDate' => $due,
                'amount' => money_from_minor($outstanding),
                'overdue' => $overdue,
            ];
        }

        return $out;
    }
}

if (!function_exists('loan_balance')) {
    /**
     * GET repayments.balance — the loan, its schedule, and its LIVE penalty
     * position. The penalty is computed on read, never read from a stored total:
     * it grows every night and there is no cron to grow it with.
     */
    function loan_balance(): void
    {
        $loanId = (string) ($_GET['loanId'] ?? '');
        if ($loanId === '') {
            json_error('loanId is required.', 422);
        }

        $pdo = getDbConnection();
        $loan = repayment_fetch_loan($pdo, $loanId);

        $caller = require_role((string) $loan['groupId'], REPAYMENT_ANY_MEMBER_ROLES);

        // Authorization boundary: a plain member sees only their OWN loan.
        if ($caller['role'] === 'member' && $loan['borrowerId'] !== $caller['uid']) {
            json_error('You do not have permission to perform this action.', 403);
        }

        $rules = penalty_fetch_rules($pdo, (string) $loan['groupId']);
        $penalty = repayment_penalty_or_501($loan, $rules);

        $schedule = repayment_fetch_schedule($pdo, $loanId);

        /* WHAT HAS ACTUALLY BEEN PAID, AND WHEN.
           The record-payment form previously showed only what was still owed —
           an admin taking cash could not see whether the borrower paid last
           month or a year ago, or whether a repayment was already sitting
           unapproved. Every row carries its date so the money has a trace.
           PENDING rows are included and labelled: they are not yet money in the
           box, but hiding them invites a second payment being taken for one
           that is merely awaiting approval. */
        $historyStmt = $pdo->prepare(
            'SELECT paymentId, amount, principalPortion, interestPortion, penaltyPortion, '
            . 'status, paidAt, approvedAt, scheduledMonth, paymentMethod, proofOfPaymentImageUrl '
            . 'FROM loan_payments WHERE loanId = :loanId '
            . "AND status IN ('approved','pending') "
            . 'ORDER BY paidAt DESC, paymentId DESC'
        );
        $historyStmt->execute([':loanId' => $loanId]);
        $history = [];
        foreach ($historyStmt->fetchAll() as $h) {
            $history[] = [
                'paymentId' => $h['paymentId'],
                'amount' => money_from_minor(money_to_minor((string) $h['amount'])),
                'principalPortion' => money_from_minor(money_to_minor((string) ($h['principalPortion'] ?? '0.00'))),
                'interestPortion' => money_from_minor(money_to_minor((string) ($h['interestPortion'] ?? '0.00'))),
                'penaltyPortion' => money_from_minor(money_to_minor((string) ($h['penaltyPortion'] ?? '0.00'))),
                'status' => $h['status'],
                'paidAt' => $h['paidAt'],
                'approvedAt' => $h['approvedAt'],
                'scheduledMonth' => $h['scheduledMonth'] !== null ? (int) $h['scheduledMonth'] : null,
                'paymentMethod' => $h['paymentMethod'],
                'hasProof' => !empty($h['proofOfPaymentImageUrl']),
            ];
        }

        json_response([
            'loan' => $loan,
            'schedule' => $schedule,
            'penalty' => $penalty,
            'history' => $history,
            // Server-computed preset amounts for the record-payment form, so the
            // borrower picks an outcome ("pay it off") rather than typing a figure.
            'quickAmounts' => repayment_quick_amounts(
                $schedule,
                money_to_minor($penalty['amountOutstanding'])
            ),
            // Every instalment still to pay, with its date — so a borrower can see
            // not just what is due next but what follows it and when.
            'upcoming' => repayment_upcoming_instalments($schedule),
        ]);
    }
}

if (!function_exists('record_repayment')) {
    /**
     * POST repayments.record — log a repayment as PENDING with its split already
     * computed. Nothing in the ledger moves until an admin approves it.
     */
    function record_repayment(): void
    {
        $body = read_json_body();
        $loanId = (string) ($body['loanId'] ?? '');
        if ($loanId === '') {
            json_error('loanId is required.', 422);
        }

        $method = (string) ($body['paymentMethod'] ?? '');
        if (!in_array($method, REPAYMENT_METHODS, true)) {
            json_error('paymentMethod must be one of: cash, bank_transfer, mobile_money.', 422);
        }

        $pdo = getDbConnection();
        $loan = repayment_fetch_loan($pdo, $loanId);

        $caller = require_role((string) $loan['groupId'], REPAYMENT_ANY_MEMBER_ROLES);

        // A member may only pay THEIR OWN loan. An admin/treasurer may record one
        // against any member's loan — they are the ones taking the cash in person.
        if ($caller['role'] === 'member' && $loan['borrowerId'] !== $caller['uid']) {
            json_error('You do not have permission to perform this action.', 403);
        }

        if (!in_array((string) $loan['status'], REPAYMENT_PAYABLE_STATUSES, true)) {
            json_error('This loan is not open for repayment.', 409);
        }

        try {
            $amountMinor = money_to_minor(repayment_money_input_to_string($body['amount'] ?? ''));
        } catch (InvalidArgumentException $e) {
            json_error('amount must be an amount with at most 2 decimals.', 422);
        }

        if ($amountMinor <= 0) {
            json_error('amount must be greater than zero.', 422);
        }

        // Only ONE pending repayment at a time per loan. The split stored on a
        // pending payment is computed against the CURRENT schedule; a second
        // pending payment would be split against a schedule the first one is
        // about to change, and the two would double-allocate the same interest.
        $pendingStmt = $pdo->prepare(
            "SELECT COUNT(*) AS n FROM loan_payments WHERE loanId = :loanId AND status = 'pending'"
        );
        $pendingStmt->execute([':loanId' => $loanId]);
        if ((int) $pendingStmt->fetch()['n'] > 0) {
            json_error(
                'A repayment on this loan is already awaiting approval; it must be approved first.',
                409
            );
        }

        $rules = penalty_fetch_rules($pdo, (string) $loan['groupId']);
        $penalty = repayment_penalty_or_501($loan, $rules);
        $penaltyOutstandingMinor = money_to_minor($penalty['amountOutstanding']);

        $schedule = repayment_fetch_schedule($pdo, $loanId);

        // The cap is derived from the very rows the payment is allocated against,
        // so the allocator can never be handed more than it can place.
        $scheduleOutstandingMinor = 0;
        foreach ($schedule as $row) {
            $split = repayment_split_instalment($row);
            $scheduleOutstandingMinor += $split['interestOutstanding'] + $split['principalOutstanding'];
        }

        $totalOutstandingMinor = $penaltyOutstandingMinor + $scheduleOutstandingMinor;

        if ($totalOutstandingMinor <= 0) {
            json_error('This loan has nothing outstanding to repay.', 409);
        }

        // An overpayment is REJECTED, never silently credited: this system has no
        // concept of a credit balance, and inventing one here would put money on
        // the ledger that no rule knows how to pay back.
        if ($amountMinor > $totalOutstandingMinor) {
            json_error('Payment exceeds the outstanding balance.', 422);
        }

        $split = repayment_allocate($amountMinor, $penaltyOutstandingMinor, $schedule);

        $paymentId = bin2hex(random_bytes(16));
        $proofUrl = $body['proofOfPaymentImageUrl'] ?? null;
        $proofUrl = is_string($proofUrl) && trim($proofUrl) !== '' ? trim($proofUrl) : null;
        $notes = $body['notes'] ?? null;
        $notes = is_string($notes) && trim($notes) !== '' ? trim($notes) : null;

        // Denormalised payer identity comes from the loan row, not the body.
        $insert = $pdo->prepare(
            'INSERT INTO loan_payments '
            . '(paymentId, loanId, groupId, uid, userName, amount, principalPortion, '
            . 'interestPortion, penaltyPortion, scheduledAmount, scheduledMonth, status, '
            . 'proofOfPaymentImageUrl, proofOfPaymentUploadedAt, paidAt, createdAt, '
            . 'paymentMethod, notes) '
            . 'VALUES (:paymentId, :loanId, :groupId, :uid, :userName, :amount, :principalPortion, '
            . ":interestPortion, :penaltyPortion, :scheduledAmount, :scheduledMonth, 'pending', "
            . ':proofUrl, :proofUploadedAt, NOW(), NOW(), :paymentMethod, :notes)'
        );
        $insert->execute([
            ':paymentId' => $paymentId,
            ':loanId' => $loanId,
            ':groupId' => $loan['groupId'],
            ':uid' => $loan['borrowerId'],
            ':userName' => $loan['borrowerName'],
            ':amount' => money_from_minor($amountMinor),
            ':principalPortion' => money_from_minor($split['principal']),
            ':interestPortion' => money_from_minor($split['interest']),
            ':penaltyPortion' => money_from_minor($split['penalty']),
            ':scheduledAmount' => (string) $loan['monthlyPayment'],
            ':scheduledMonth' => $split['scheduledMonth'] ?? 0,
            ':proofUrl' => $proofUrl,
            ':proofUploadedAt' => $proofUrl === null ? null : date('Y-m-d H:i:s'),
            ':paymentMethod' => $method,
            ':notes' => $notes,
        ]);

        $paymentStmt = $pdo->prepare('SELECT * FROM loan_payments WHERE paymentId = :paymentId LIMIT 1');
        $paymentStmt->execute([':paymentId' => $paymentId]);

        json_response([
            'payment' => $paymentStmt->fetch(),
            'allocation' => [
                'penaltyPortion' => money_from_minor($split['penalty']),
                'interestPortion' => money_from_minor($split['interest']),
                'principalPortion' => money_from_minor($split['principal']),
                'amount' => money_from_minor($amountMinor),
            ],
            'penalty' => $penalty,
        ], 201);
    }
}

if (!function_exists('approve_repayment')) {
    /**
     * POST repayments.approve — an admin/treasurer confirms the cash landed.
     *
     * This is where the ledger actually moves: the schedule, the loan totals and
     * the penalty settlement all update inside ONE transaction. Any failure rolls
     * the whole thing back — an approved payment whose ledger did not move is a
     * corrupt record, and a member would have paid for nothing.
     */
    function approve_repayment(): void
    {
        $body = read_json_body();
        $paymentId = (string) ($body['paymentId'] ?? '');
        if ($paymentId === '') {
            json_error('paymentId is required.', 422);
        }

        $pdo = getDbConnection();

        $paymentStmt = $pdo->prepare(
            'SELECT paymentId, loanId, groupId, uid, amount, principalPortion, interestPortion, '
            . 'penaltyPortion, status FROM loan_payments WHERE paymentId = :paymentId LIMIT 1'
        );
        $paymentStmt->execute([':paymentId' => $paymentId]);
        $payment = $paymentStmt->fetch();

        if ($payment === false) {
            json_error('Payment not found.', 404);
        }

        $loan = repayment_fetch_loan($pdo, (string) $payment['loanId']);

        // groupId comes from the loan row. A member can never reach this.
        $caller = require_role((string) $loan['groupId'], REPAYMENT_ADMIN_ROLES);

        if ((string) $payment['status'] !== 'pending') {
            json_error('Only a pending payment can be approved.', 409);
        }

        $amountMinor = money_to_minor(trim((string) $payment['amount']));
        $penaltyMinor = money_to_minor(trim((string) $payment['penaltyPortion']));
        $interestMinor = money_to_minor(trim((string) $payment['interestPortion']));
        $principalMinor = money_to_minor(trim((string) $payment['principalPortion']));

        // Re-assert the reconciliation at the point the money actually moves. A
        // stored payment whose parts do not sum to its whole never gets applied.
        if ($penaltyMinor + $interestMinor + $principalMinor !== $amountMinor) {
            throw new RuntimeException('Stored payment portions do not sum to the amount paid.');
        }

        $rules = penalty_fetch_rules($pdo, (string) $loan['groupId']);
        $penalty = $penaltyMinor > 0 ? repayment_penalty_or_501($loan, $rules) : null;

        // Only interest and principal repay the LOAN. The penalty is a separate
        // charge that was never part of totalRepayment, so it must not reduce the
        // outstanding balance — it is recorded against penaltiesCharged instead.
        $ledgerMinor = $interestMinor + $principalMinor;

        $pdo->beginTransaction();
        try {
            $claim = $pdo->prepare(
                "UPDATE loan_payments SET status = 'approved', approvedBy = :approvedBy, "
                . 'approvedAt = NOW() '
                . "WHERE paymentId = :paymentId AND status = 'pending'"
            );
            $claim->execute([
                ':approvedBy' => $caller['uid'],
                ':paymentId' => $paymentId,
            ]);

            // Guards a concurrent double-approval: only one caller can win the
            // row, and the loser applies nothing.
            if ($claim->rowCount() !== 1) {
                $pdo->rollBack();
                json_error('Only a pending payment can be approved.', 409);
            }

            // Apply interest + principal across the schedule, oldest first — the
            // same order the split was computed in.
            $remaining = $ledgerMinor;
            $updateRow = $pdo->prepare(
                'UPDATE loan_repayment_schedule '
                . 'SET amountPaid = :amountPaid, balance = :balance, status = :status, paidAt = :paidAt '
                . 'WHERE scheduleId = :scheduleId'
            );

            $now = new DateTimeImmutable('now');

            foreach (repayment_fetch_schedule($pdo, (string) $loan['loanId']) as $row) {
                if ($remaining <= 0) {
                    break;
                }

                $totalDue = money_to_minor(trim((string) $row['totalDue']));
                $paid = money_to_minor(trim((string) $row['amountPaid']));
                $balance = $totalDue - $paid;

                if ($balance <= 0) {
                    continue;
                }

                $apply = min($remaining, $balance);
                $remaining -= $apply;

                $newPaid = $paid + $apply;
                $newBalance = $totalDue - $newPaid;

                // Cleared, else overdue once its due date has passed, else pending.
                if ($newBalance <= 0) {
                    $status = 'paid';
                } else {
                    $due = new DateTimeImmutable((string) $row['dueDate']);
                    $status = $due < $now ? 'overdue' : 'pending';
                }

                $updateRow->execute([
                    ':amountPaid' => money_from_minor($newPaid),
                    ':balance' => money_from_minor($newBalance),
                    ':status' => $status,
                    ':paidAt' => $newBalance <= 0 ? $now->format('Y-m-d H:i:s') : $row['paidAt'],
                    ':scheduleId' => $row['scheduleId'],
                ]);
            }

            if ($remaining !== 0) {
                throw new RuntimeException('Approved payment could not be applied to the schedule in full.');
            }

            // The loan totals. amountRepaid tracks money repaid AGAINST THE LOAN
            // (interest + principal); the penalty is tracked separately in
            // penaltiesCharged. This keeps the invariant
            //   remainingBalance == SUM(schedule.balance)
            // true — crediting the penalty against amountRepaid would forgive
            // principal equal to the penalty paid, and undercharge the borrower.
            $totalRepaymentMinor = money_to_minor(trim((string) $loan['totalRepayment']));
            $amountRepaidMinor = money_to_minor(trim((string) $loan['amountRepaid'])) + $ledgerMinor;
            $penaltiesChargedMinor = money_to_minor(trim((string) $loan['penaltiesCharged'])) + $penaltyMinor;

            $remainingBalanceMinor = $totalRepaymentMinor - $amountRepaidMinor;
            if ($remainingBalanceMinor < 0) {
                throw new RuntimeException('Approving this payment would overpay the loan.');
            }

            $completed = $remainingBalanceMinor === 0;

            // Fully bound — the completion state is passed as a parameter, never
            // spliced into the SQL text.
            $loanUpdate = $pdo->prepare(
                'UPDATE loans SET amountRepaid = :amountRepaid, remainingBalance = :remainingBalance, '
                . 'penaltiesCharged = :penaltiesCharged, status = :status, '
                . 'completedAt = :completedAt, updatedAt = NOW() '
                . 'WHERE loanId = :loanId'
            );
            $loanUpdate->execute([
                ':amountRepaid' => money_from_minor($amountRepaidMinor),
                ':remainingBalance' => money_from_minor($remainingBalanceMinor),
                ':penaltiesCharged' => money_from_minor($penaltiesChargedMinor),
                ':status' => $completed ? 'completed' : (string) $loan['status'],
                ':completedAt' => $completed
                    ? $now->format('Y-m-d H:i:s')
                    : $loan['completedAt'],
                ':loanId' => $loan['loanId'],
            ]);

            // A settled penalty is a FACT — it has stopped accruing, so it is the
            // one part of the penalty that gets persisted. The engine's own
            // figures are recorded so the charge can be audited later.
            if ($penaltyMinor > 0 && $penalty !== null) {
                $accruedMinor = money_to_minor($penalty['amountAccrued']);
                $outstandingMinor = money_to_minor($penalty['amountOutstanding']);

                $settlement = $pdo->prepare(
                    'INSERT INTO penalty_settlements '
                    . '(groupId, uid, loanId, paymentId, accruedFrom, accruedTo, daysCharged, '
                    . 'dailyAmount, amountAccrued, amountPaid, amountWaived, status, settledBy, '
                    . 'settledAt, createdAt) '
                    . 'VALUES (:groupId, :uid, :loanId, :paymentId, :accruedFrom, :accruedTo, '
                    . ':daysCharged, :dailyAmount, :amountAccrued, :amountPaid, :amountWaived, '
                    . ':status, :settledBy, NOW(), NOW())'
                );
                $settlement->execute([
                    ':groupId' => $loan['groupId'],
                    ':uid' => $loan['borrowerId'],
                    ':loanId' => $loan['loanId'],
                    ':paymentId' => $paymentId,
                    ':accruedFrom' => $penalty['firstChargeableDay'],
                    ':accruedTo' => $penalty['asOf'],
                    ':daysCharged' => $penalty['daysCharged'],
                    ':dailyAmount' => $penalty['dailyAmount'],
                    ':amountAccrued' => $penalty['amountAccrued'],
                    ':amountPaid' => money_from_minor($penaltyMinor),
                    ':amountWaived' => '0.00',
                    // 'partial' when the payment clears only part of what is
                    // outstanding — the remainder keeps accruing and is not lost.
                    ':status' => $penaltyMinor >= $outstandingMinor ? 'paid' : 'partial',
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

        $updatedLoan = repayment_fetch_loan($pdo, (string) $loan['loanId']);

        json_response([
            'loan' => $updatedLoan,
            'schedule' => repayment_fetch_schedule($pdo, (string) $loan['loanId']),
        ]);
    }
}

if (!function_exists('reject_repayment')) {
    /**
     * POST repayments.reject — an admin/treasurer declines a pending repayment
     * claim (e.g. the receipt didn't match). Enabled by migration 008, which
     * added the 'rejected' status value + the rejectedBy/rejectedAt/rejectionReason
     * audit trio to loan_payments (the payments and loans tables already had them).
     *
     * NO LEDGER MOVEMENT: a pending payment was never applied to the schedule or
     * the loan totals, so rejecting it only latches the row. The groupId is taken
     * from the loan, never from the body, and the caller's role is re-checked
     * there — a member can never reach this.
     */
    function reject_repayment(): void
    {
        $body = read_json_body();
        $paymentId = (string) ($body['paymentId'] ?? '');
        $reason = trim((string) ($body['rejectionReason'] ?? ''));

        if ($paymentId === '') {
            json_error('paymentId is required.', 422);
        }

        $pdo = getDbConnection();

        $paymentStmt = $pdo->prepare(
            'SELECT paymentId, loanId, status FROM loan_payments WHERE paymentId = :paymentId LIMIT 1'
        );
        $paymentStmt->execute([':paymentId' => $paymentId]);
        $payment = $paymentStmt->fetch();

        if ($payment === false) {
            json_error('Payment not found.', 404);
        }

        $loan = repayment_fetch_loan($pdo, (string) $payment['loanId']);
        $caller = require_role((string) $loan['groupId'], REPAYMENT_ADMIN_ROLES);

        if ((string) $payment['status'] !== 'pending') {
            json_error('Only a pending payment can be rejected.', 409);
        }

        // Latch to rejected, guarded so a concurrent approve/reject can't both
        // win the row — the loser gets the 409 and changes nothing.
        $claim = $pdo->prepare(
            "UPDATE loan_payments SET status = 'rejected', rejectedBy = :rejectedBy, "
            . 'rejectedAt = NOW(), rejectionReason = :reason '
            . "WHERE paymentId = :paymentId AND status = 'pending'"
        );
        $claim->execute([
            ':rejectedBy' => $caller['uid'],
            ':reason' => $reason === '' ? null : $reason,
            ':paymentId' => $paymentId,
        ]);

        if ($claim->rowCount() !== 1) {
            json_error('Only a pending payment can be rejected.', 409);
        }

        $selectStmt = $pdo->prepare(
            'SELECT paymentId, loanId, groupId, uid, userName, amount, status, '
            . 'rejectedBy, rejectedAt, rejectionReason FROM loan_payments WHERE paymentId = :paymentId LIMIT 1'
        );
        $selectStmt->execute([':paymentId' => $paymentId]);

        json_response($selectStmt->fetch());
    }
}

if (!function_exists('pending_repayments')) {
    /**
     * GET repayments.pending — every PENDING repayment across the group's
     * loans, for the admin review queue. Ordered newest first.
     */
    function pending_repayments(): void
    {
        $groupId = (string) ($_GET['groupId'] ?? '');
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        require_role($groupId, REPAYMENT_ADMIN_ROLES);

        $pdo = getDbConnection();
        $stmt = $pdo->prepare(
            'SELECT lp.paymentId, lp.loanId, lp.groupId, lp.uid, lp.userName, lp.amount, '
            . 'lp.principalPortion, lp.interestPortion, lp.penaltyPortion, lp.scheduledMonth, '
            . 'lp.scheduledAmount, lp.status, lp.proofOfPaymentImageUrl, lp.proofOfPaymentUploadedAt, '
            . 'lp.paidAt, lp.createdAt, lp.paymentMethod, lp.notes, l.loanNumber '
            . 'FROM loan_payments lp '
            . 'JOIN loans l ON l.loanId = lp.loanId '
            . "WHERE l.groupId = :groupId AND lp.status = 'pending' "
            . 'ORDER BY lp.createdAt DESC'
        );
        $stmt->execute([':groupId' => $groupId]);

        json_response(['payments' => $stmt->fetchAll()]);
    }
}

if (!function_exists('my_repayments')) {
    /**
     * GET repayments.mine — the CALLER's OWN loan repayments across all their
     * loans in a group, every status, for the member loan-payments page to
     * render both the pending queue and the history from one call.
     *
     * The uid filter is the SERVER-resolved caller uid from require_role() —
     * never from the query string — so a member can only ever see their own
     * rows.
     */
    function my_repayments(): void
    {
        $groupId = (string) ($_GET['groupId'] ?? '');
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        $caller = require_role($groupId, REPAYMENT_ANY_MEMBER_ROLES);

        $pdo = getDbConnection();
        $stmt = $pdo->prepare(
            'SELECT lp.paymentId, lp.loanId, lp.groupId, lp.uid, lp.userName, lp.amount, '
            . 'lp.principalPortion, lp.interestPortion, lp.penaltyPortion, lp.scheduledMonth, '
            . 'lp.scheduledAmount, lp.status, lp.proofOfPaymentImageUrl, lp.proofOfPaymentUploadedAt, '
            . 'lp.paidAt, lp.createdAt, lp.paymentMethod, lp.notes, lp.approvedAt, lp.rejectedAt, '
            . 'lp.rejectionReason, l.loanNumber '
            . 'FROM loan_payments lp '
            . 'JOIN loans l ON l.loanId = lp.loanId '
            . 'WHERE l.groupId = :groupId AND lp.uid = :uid '
            . 'ORDER BY lp.createdAt DESC'
        );
        $stmt->execute([':groupId' => $groupId, ':uid' => $caller['uid']]);

        json_response(['payments' => $stmt->fetchAll()]);
    }
}

if (!function_exists('waive_penalty')) {
    /**
     * POST repayments.waive — forgive the outstanding penalty on a loan.
     *
     * SENIOR ADMIN ONLY. Waiving is forgiving real debt, so it sits at the
     * highest privilege in the group, alongside cycle settlement.
     *
     * A penalty is never silently zeroed. A waiver is a recorded decision with an
     * author and a reason, written to penalty_settlements — which is also what
     * stops the waived days from being charged again on the next read.
     */
    function waive_penalty(): void
    {
        $body = read_json_body();
        $loanId = (string) ($body['loanId'] ?? '');
        $reason = trim((string) ($body['waivedReason'] ?? ''));

        if ($loanId === '') {
            json_error('loanId is required.', 422);
        }
        if ($reason === '') {
            json_error('waivedReason is required.', 422);
        }

        $pdo = getDbConnection();
        $loan = repayment_fetch_loan($pdo, $loanId);

        $caller = require_role((string) $loan['groupId'], ['senior_admin']);

        $rules = penalty_fetch_rules($pdo, (string) $loan['groupId']);
        $penalty = repayment_penalty_or_501($loan, $rules);

        $outstandingMinor = money_to_minor($penalty['amountOutstanding']);
        if ($outstandingMinor <= 0) {
            json_error('There is no outstanding penalty on this loan to waive.', 409);
        }

        $pdo->beginTransaction();
        try {
            $settlement = $pdo->prepare(
                'INSERT INTO penalty_settlements '
                . '(groupId, uid, loanId, paymentId, accruedFrom, accruedTo, daysCharged, '
                . 'dailyAmount, amountAccrued, amountPaid, amountWaived, status, waivedReason, '
                . 'settledBy, settledAt, createdAt) '
                . 'VALUES (:groupId, :uid, :loanId, NULL, :accruedFrom, :accruedTo, :daysCharged, '
                . ":dailyAmount, :amountAccrued, '0.00', :amountWaived, 'waived', :waivedReason, "
                . ':settledBy, NOW(), NOW())'
            );
            $settlement->execute([
                ':groupId' => $loan['groupId'],
                ':uid' => $loan['borrowerId'],
                ':loanId' => $loanId,
                ':accruedFrom' => $penalty['firstChargeableDay'],
                ':accruedTo' => $penalty['asOf'],
                ':daysCharged' => $penalty['daysCharged'],
                ':dailyAmount' => $penalty['dailyAmount'],
                ':amountAccrued' => $penalty['amountAccrued'],
                ':amountWaived' => money_from_minor($outstandingMinor),
                ':waivedReason' => $reason,
                ':settledBy' => $caller['uid'],
            ]);

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        // Recomputed on read: the waiver has netted the outstanding penalty to zero.
        json_response([
            'loan' => repayment_fetch_loan($pdo, $loanId),
            'penalty' => repayment_penalty_or_501($loan, $rules),
        ]);
    }
}
