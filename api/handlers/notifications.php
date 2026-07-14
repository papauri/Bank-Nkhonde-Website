<?php
/**
 * Notification inbox endpoints: list, mark read, mark all read, dismiss.
 *
 * THE AUTHORIZATION BOUNDARY OF THIS FILE IS OWNERSHIP, NOT ROLE.
 * -------------------------------------------------------------
 * A notification is addressed to ONE user. The inbox therefore spans every group
 * that user belongs to, which is why these endpoints gate on require_auth() and
 * NOT on require_role() — there is no single group to check a role against.
 *
 * In its place, EVERY statement in this file carries `userId = :uid` bound to the
 * session uid, in the SQL itself. There is deliberately NO admin override: an
 * admin does not get to read, clear, or dismiss another member's inbox. A
 * notification can carry a loan amount, a rejection reason, or a private message,
 * and "the admin can see everything" is precisely the leak that boundary exists
 * to prevent.
 *
 * `read` IS A MySQL RESERVED WORD and is backticked in every query below. So is
 * `groups` wherever it appears. Dropping a backtick here is a syntax error, not a
 * style nit.
 */

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/session.php';
require_once __DIR__ . '/../lib/money.php';
require_once __DIR__ . '/../../config/database.php';

if (!function_exists('notification_present_row')) {
    /**
     * Shape ONE notification row for the wire.
     *
     * `amount` is a nullable DECIMAL. It is normalised through the money helpers
     * (string -> minor units -> string) so the client always receives a canonical
     * 2dp string. No float touches it; a value the DB cannot round-trip as money
     * is passed through untouched rather than guessed at.
     */
    function notification_present_row(array $row): array
    {
        $row['read'] = (int) $row['read'] === 1;
        $row['dismissed'] = (int) $row['dismissed'] === 1;

        $amount = $row['amount'] ?? null;
        if ($amount !== null && trim((string) $amount) !== '') {
            try {
                $row['amount'] = money_from_minor(money_to_minor(trim((string) $amount)));
            } catch (InvalidArgumentException $e) {
                $row['amount'] = trim((string) $amount);
            }
        } else {
            $row['amount'] = null;
        }

        return $row;
    }
}

if (!function_exists('list_notifications')) {
    /**
     * GET notifications.list — the CALLER'S inbox, across every group they are in.
     *
     * `WHERE userId = :uid` is unconditional. Not a filter that a query parameter
     * can widen, and not one a role can bypass.
     *
     * Dismissed rows are excluded (the user has already swiped them away) and so
     * are expired ones — an expiresAt in the past means the notification is no
     * longer true, and showing a stale "your loan is due tomorrow" is worse than
     * showing nothing.
     */
    function list_notifications(): void
    {
        $caller = require_auth();

        $sql = 'SELECT notificationId, userId, type, title, message, groupId, groupName, '
            . 'senderId, paymentType, paymentId, loanId, amount, `read`, readAt, '
            . 'dismissed, dismissedAt, createdAt, expiresAt '
            . 'FROM notifications '
            . 'WHERE userId = :uid '
            . 'AND dismissed = 0 '
            . 'AND (expiresAt IS NULL OR expiresAt > NOW())';
        $params = [':uid' => $caller['uid']];

        $groupId = isset($_GET['groupId']) ? trim((string) $_GET['groupId']) : '';
        if ($groupId !== '') {
            $sql .= ' AND groupId = :groupId';
            $params[':groupId'] = $groupId;
        }

        $unreadOnly = isset($_GET['unreadOnly'])
            && in_array((string) $_GET['unreadOnly'], ['1', 'true', 'yes'], true);
        if ($unreadOnly) {
            $sql .= ' AND `read` = 0';
        }

        $sql .= ' ORDER BY createdAt DESC';

        $pdo = getDbConnection();
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        $notifications = [];
        foreach ($stmt->fetchAll() as $row) {
            $notifications[] = notification_present_row($row);
        }

        // The unread badge. Counted over the SAME ownership boundary and the same
        // visibility rules — a count that included rows the list cannot show would
        // leave the user hunting for a notification that is not there. It ignores
        // the unreadOnly flag by design: the badge is the inbox total, not the
        // total of whatever slice was just requested.
        $countSql = 'SELECT COUNT(*) AS n FROM notifications '
            . 'WHERE userId = :uid AND `read` = 0 AND dismissed = 0 '
            . 'AND (expiresAt IS NULL OR expiresAt > NOW())';
        $countParams = [':uid' => $caller['uid']];

        if ($groupId !== '') {
            $countSql .= ' AND groupId = :groupId';
            $countParams[':groupId'] = $groupId;
        }

        $countStmt = $pdo->prepare($countSql);
        $countStmt->execute($countParams);

        json_response([
            'notifications' => $notifications,
            'unreadCount' => (int) $countStmt->fetch()['n'],
        ]);
    }
}

if (!function_exists('mark_read')) {
    /**
     * POST notifications.read — mark ONE notification read.
     *
     * `AND userId = :uid` IS the authorization: a caller cannot mark another user's
     * notification read, because the UPDATE simply will not match their row.
     *
     * A miss is a 404 whether the row does not exist or belongs to someone else.
     * The two are deliberately NOT distinguished — a 403 for "exists but not
     * yours" would confirm the existence of another user's notification to anyone
     * who guessed an id.
     */
    function mark_read(): void
    {
        $caller = require_auth();
        $body = read_json_body();

        $notificationId = trim((string) ($body['notificationId'] ?? ''));
        if ($notificationId === '') {
            json_error('notificationId is required.', 422);
        }

        $pdo = getDbConnection();
        $stmt = $pdo->prepare(
            'UPDATE notifications SET `read` = 1, readAt = NOW() '
            . 'WHERE notificationId = :notificationId AND userId = :uid AND `read` = 0'
        );
        $stmt->execute([
            ':notificationId' => $notificationId,
            ':uid' => $caller['uid'],
        ]);

        // Already-read is not an error — re-reading is idempotent, and the row is
        // confirmed to be theirs before we say so.
        if ($stmt->rowCount() === 0) {
            $check = $pdo->prepare(
                'SELECT notificationId FROM notifications '
                . 'WHERE notificationId = :notificationId AND userId = :uid LIMIT 1'
            );
            $check->execute([
                ':notificationId' => $notificationId,
                ':uid' => $caller['uid'],
            ]);

            if ($check->fetch() === false) {
                json_error('Notification not found.', 404);
            }
        }

        json_response(['notificationId' => $notificationId, 'read' => true]);
    }
}

if (!function_exists('mark_all_read')) {
    /**
     * POST notifications.readAll — clear the caller's unread badge.
     *
     * Scoped to the caller's own rows in the SQL, exactly as mark_read is. An
     * optional groupId narrows it to one group's notifications; without it, the
     * whole inbox is cleared.
     *
     * Dismissed and expired rows are left alone: they are not visible anywhere, so
     * marking them read would be a write with no meaning.
     */
    function mark_all_read(): void
    {
        $caller = require_auth();
        $body = read_json_body();

        $sql = 'UPDATE notifications SET `read` = 1, readAt = NOW() '
            . 'WHERE userId = :uid AND `read` = 0 AND dismissed = 0 '
            . 'AND (expiresAt IS NULL OR expiresAt > NOW())';
        $params = [':uid' => $caller['uid']];

        $groupId = trim((string) ($body['groupId'] ?? ''));
        if ($groupId !== '') {
            $sql .= ' AND groupId = :groupId';
            $params[':groupId'] = $groupId;
        }

        $pdo = getDbConnection();
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        json_response(['updated' => $stmt->rowCount()]);
    }
}

if (!function_exists('dismiss_notification')) {
    /**
     * POST notifications.dismiss — the user swipes a notification away.
     *
     * Same ownership rule, same 404-on-miss reasoning as mark_read. This is a soft
     * hide, never a DELETE: the row stays on the ledger's audit trail and simply
     * stops being listed.
     */
    function dismiss_notification(): void
    {
        $caller = require_auth();
        $body = read_json_body();

        $notificationId = trim((string) ($body['notificationId'] ?? ''));
        if ($notificationId === '') {
            json_error('notificationId is required.', 422);
        }

        $pdo = getDbConnection();
        $stmt = $pdo->prepare(
            'UPDATE notifications SET dismissed = 1, dismissedAt = NOW() '
            . 'WHERE notificationId = :notificationId AND userId = :uid AND dismissed = 0'
        );
        $stmt->execute([
            ':notificationId' => $notificationId,
            ':uid' => $caller['uid'],
        ]);

        if ($stmt->rowCount() === 0) {
            $check = $pdo->prepare(
                'SELECT notificationId FROM notifications '
                . 'WHERE notificationId = :notificationId AND userId = :uid LIMIT 1'
            );
            $check->execute([
                ':notificationId' => $notificationId,
                ':uid' => $caller['uid'],
            ]);

            if ($check->fetch() === false) {
                json_error('Notification not found.', 404);
            }
        }

        json_response(['notificationId' => $notificationId, 'dismissed' => true]);
    }
}
