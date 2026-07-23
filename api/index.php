<?php
/**
 * API front controller.
 *
 * Routes JSON requests to a handler and guarantees that no uncaught Throwable
 * ever reaches the client as raw text: everything is masked as a generic 500.
 *
 * Runs alongside the live Firebase stack — no client calls it yet.
 */

declare(strict_types=1);

require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/session.php';
require_once __DIR__ . '/lib/password.php';
require_once __DIR__ . '/handlers/auth.php';
require_once __DIR__ . '/handlers/groups.php';
require_once __DIR__ . '/handlers/members.php';
require_once __DIR__ . '/handlers/loans.php';
require_once __DIR__ . '/handlers/repayments.php';
require_once __DIR__ . '/handlers/payments.php';
require_once __DIR__ . '/handlers/rules.php';
require_once __DIR__ . '/handlers/profile.php';
require_once __DIR__ . '/handlers/reminders.php';
require_once __DIR__ . '/handlers/cycle.php';
require_once __DIR__ . '/handlers/notifications.php';
require_once __DIR__ . '/handlers/messages.php';
require_once __DIR__ . '/handlers/password_reset.php';
require_once __DIR__ . '/handlers/dashboard.php';
require_once __DIR__ . '/handlers/files.php';
require_once __DIR__ . '/handlers/invitations.php';
require_once __DIR__ . '/handlers/exports.php';
require_once __DIR__ . '/handlers/statement.php';

header('Content-Type: application/json; charset=utf-8');

// Errors are logged, never displayed — a stack trace in a response body is a leak.
ini_set('display_errors', '0');
error_reporting(E_ALL);

/**
 * action => [http method, handler]
 */
const ROUTES = [
    'register' => ['POST', 'register'],
    'login'    => ['POST', 'login'],
    'logout'   => ['POST', 'logout'],
    'session'  => ['GET', 'session_status_handler'],

    'password.reset.request' => ['POST', 'request_password_reset'],
    'password.reset.perform' => ['POST', 'perform_password_reset'],

    'groups.mine'   => ['GET', 'list_my_groups'],
    'groups.get'    => ['GET', 'get_group'],
    'groups.create' => ['POST', 'create_group'],
    'groups.update' => ['POST', 'update_group'],

    'members.list'   => ['GET', 'list_members'],
    'members.add'    => ['POST', 'add_member'],
    'members.role'   => ['POST', 'change_member_role'],
    'members.status' => ['POST', 'update_member_status'],
    'members.update' => ['POST', 'update_member'],
    'members.remove' => ['POST', 'remove_member'],
    'members.create' => ['POST', 'create_member'],

    'loans.list'    => ['GET', 'list_loans'],
    'loans.get'     => ['GET', 'get_loan'],
    'loans.request' => ['POST', 'request_loan'],
    'loans.approve' => ['POST', 'approve_loan'],
    'loans.reject'  => ['POST', 'reject_loan'],
    'loans.force'   => ['POST', 'force_loan'],
    'loans.eligibility' => ['GET', 'loan_eligibility_endpoint'],

    'repayments.balance' => ['GET', 'loan_balance'],
    'repayments.record'  => ['POST', 'record_repayment'],
    'repayments.approve' => ['POST', 'approve_repayment'],
    'repayments.waive'   => ['POST', 'waive_penalty'],
    'repayments.pending' => ['GET', 'pending_repayments'],
    'repayments.reject'  => ['POST', 'reject_repayment'],
    'repayments.mine'    => ['GET', 'my_repayments'],

    'payments.list'        => ['GET', 'list_payments'],
    'payments.obligations' => ['GET', 'my_obligations'],
    'payments.record'      => ['POST', 'record_payment'],
    'payments.approve'     => ['POST', 'approve_payment'],
    'payments.reject'      => ['POST', 'reject_payment'],
    'payments.waivePenalty' => ['POST', 'waive_contribution_penalty'],
    'payments.groupArrears' => ['GET', 'group_arrears_summary'],
    'payments.accountingSummary' => ['GET', 'group_accounting_summary'],
    'payments.groupStats'  => ['GET', 'member_group_stats'],

    'statement.get' => ['GET', 'get_statement'],

    'rules.get'    => ['GET', 'get_rules'],
    'rules.update' => ['POST', 'update_rules'],

    // "My account" — always the session user; no uid parameter exists.
    'profile.get'      => ['GET', 'get_profile'],
    'profile.update'   => ['POST', 'update_profile'],
    'profile.password' => ['POST', 'change_password'],

    'reminders.send' => ['POST', 'send_reminders'],

    'cycle.equity'         => ['GET', 'cycle_equity'],
    'cycle.payout.preview' => ['GET', 'cycle_payout_preview'],
    'cycle.settle'         => ['POST', 'cycle_settle'],
    'cycle.forced.preview' => ['GET', 'forced_loans_preview'],

    'notifications.list'    => ['GET', 'list_notifications'],
    'notifications.read'    => ['POST', 'mark_read'],
    'notifications.readAll' => ['POST', 'mark_all_read'],
    'notifications.dismiss' => ['POST', 'dismiss_notification'],

    'messages.list'   => ['GET', 'list_messages'],
    'messages.get'    => ['GET', 'get_message'],
    'messages.create' => ['POST', 'create_message'],
    'messages.reply'  => ['POST', 'reply_message'],
    'messages.update' => ['POST', 'update_message'],

    'broadcasts.list'   => ['GET', 'list_broadcasts'],
    'broadcasts.create' => ['POST', 'create_broadcast'],

    'dashboard.badges' => ['GET', 'dashboard_badges'],

    'files.upload' => ['POST', 'upload_proof'],

    'invitations.create'  => ['POST', 'create_invitation'],
    'invitations.list'    => ['GET', 'list_invitations'],
    'invitations.respond' => ['POST', 'respond_invitation'],

    'codes.create' => ['POST', 'create_invitation_code'],
    'codes.list'   => ['GET', 'list_invitation_codes'],
    'codes.revoke' => ['POST', 'revoke_invitation_code'],
    'codes.redeem' => ['POST', 'redeem_invitation_code'],

    'exports.payments' => ['GET', 'export_payments'],
    'exports.loans'    => ['GET', 'export_loans'],
    'exports.members'  => ['GET', 'export_members'],
    'exports.report'   => ['GET', 'export_report'],
    'exports.statement' => ['GET', 'export_statement'],
];

try {
    start_secure_session();

    $action = (string) ($_GET['action'] ?? '');

    if ($action === '' || !isset(ROUTES[$action])) {
        json_error('Unknown action.', 404);
    }

    [$expectedMethod, $handler] = ROUTES[$action];
    $method = $_SERVER['REQUEST_METHOD'] ?? '';

    if ($method !== $expectedMethod) {
        header('Allow: ' . $expectedMethod);
        json_error('Method not allowed.', 405);
    }

    $handler();
} catch (Throwable $e) {
    error_log('[api] ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    json_error('An unexpected error occurred.', 500);
}
