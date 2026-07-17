<?php
/**
 * Dashboard endpoints: the small aggregate counts shown as per-group badges
 * on the dashboard pages themselves, reached directly after login.
 *
 * AUTHORIZATION IS PER-GROUP AND RE-CHECKED SERVER-SIDE. dashboard.badges gates
 * on require_role($groupId, any-member) BEFORE any query runs — a caller who is
 * not a member of the group never learns a single count. The role the DB returns
 * (never a client-supplied one) then decides WHICH counts are visible:
 *
 *   admin / senior_admin / treasurer
 *       pendingPayments = payments in this group awaiting approval
 *       loanRequests    = loans in this group awaiting a decision
 *       broadcasts      = every broadcast posted to this group
 *
 *   plain member
 *       pendingPayments / loanRequests are ADMIN actions — always 0 for a member,
 *       never leaked. broadcasts = the member's OWN unread broadcast notifications
 *       for this group (their inbox, scoped by userId = the session uid).
 *
 * `groups` is a MySQL reserved word; it is not referenced here, but `read` is and
 * is backticked. Every query is prepared and bound.
 */

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/session.php';
require_once __DIR__ . '/../../config/database.php';

// Admin-equivalent roles: a treasurer approves cash in person, so they see the
// same pending queues an admin does.
if (!defined('DASHBOARD_ADMIN_ROLES')) {
    define('DASHBOARD_ADMIN_ROLES', ['admin', 'senior_admin', 'treasurer']);
}
if (!defined('DASHBOARD_ANY_MEMBER_ROLES')) {
    define('DASHBOARD_ANY_MEMBER_ROLES', ['member', 'admin', 'senior_admin', 'treasurer']);
}

if (!function_exists('dashboard_badges')) {
    /**
     * GET dashboard.badges?groupId=... — the three landing-page badge counts for
     * ONE group, from the caller's vantage point.
     *
     * require_role runs first and 403s a non-member before any count is computed.
     */
    function dashboard_badges(): void
    {
        $groupId = isset($_GET['groupId']) ? trim((string) $_GET['groupId']) : '';
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        // Authorization boundary FIRST. Emits 403 and exits for a non-member.
        $caller = require_role($groupId, DASHBOARD_ANY_MEMBER_ROLES);
        $isAdmin = in_array($caller['role'], DASHBOARD_ADMIN_ROLES, true);

        $pdo = getDbConnection();

        $pendingPayments = 0;
        $loanRequests = 0;
        $broadcasts = 0;

        if ($isAdmin) {
            $paymentsStmt = $pdo->prepare(
                'SELECT COUNT(*) AS n FROM payments '
                . 'WHERE groupId = :groupId AND approvalStatus = :status'
            );
            $paymentsStmt->execute([
                ':groupId' => $groupId,
                ':status' => 'pending',
            ]);
            $pendingPayments = (int) $paymentsStmt->fetch()['n'];

            $loansStmt = $pdo->prepare(
                'SELECT COUNT(*) AS n FROM loans '
                . 'WHERE groupId = :groupId AND status = :status'
            );
            $loansStmt->execute([
                ':groupId' => $groupId,
                ':status' => 'pending',
            ]);
            $loanRequests = (int) $loansStmt->fetch()['n'];

            $broadcastsStmt = $pdo->prepare(
                'SELECT COUNT(*) AS n FROM broadcasts WHERE groupId = :groupId'
            );
            $broadcastsStmt->execute([':groupId' => $groupId]);
            $broadcasts = (int) $broadcastsStmt->fetch()['n'];
        } else {
            // A plain member sees only their OWN unread broadcast notifications for
            // this group. userId = the session uid is the ownership boundary.
            $broadcastsStmt = $pdo->prepare(
                'SELECT COUNT(*) AS n FROM notifications '
                . 'WHERE userId = :uid AND groupId = :groupId AND type = :type '
                . 'AND `read` = 0 AND dismissed = 0 '
                . 'AND (expiresAt IS NULL OR expiresAt > NOW())'
            );
            $broadcastsStmt->execute([
                ':uid' => $caller['uid'],
                ':groupId' => $groupId,
                ':type' => 'broadcast',
            ]);
            $broadcasts = (int) $broadcastsStmt->fetch()['n'];
        }

        json_response([
            'groupId' => $groupId,
            'pendingPayments' => $pendingPayments,
            'loanRequests' => $loanRequests,
            'broadcasts' => $broadcasts,
        ]);
    }
}
