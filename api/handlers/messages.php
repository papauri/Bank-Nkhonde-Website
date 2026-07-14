<?php
/**
 * Support threads (messages + message_replies) and group broadcasts.
 *
 * TWO DIFFERENT VISIBILITY MODELS LIVE IN THIS FILE — do not conflate them.
 *
 *   messages   are SUPPORT TICKETS. They are PRIVATE between the member who
 *              opened one and the group's admins. A plain 'member' may see, open
 *              and reply to ONLY the threads they themselves created. That
 *              restriction is applied IN THE SQL (`AND createdBy = :uid`), not in
 *              the response shaping — a ticket a member may not read is never
 *              loaded, so it cannot leak through a response shape, an error
 *              message, or a later refactor. A ticket can say "I cannot pay this
 *              month"; that is nobody else's business.
 *
 *   broadcasts are the opposite: an announcement FROM an admin TO the whole
 *              group. Every member may read them; only an admin may write one.
 *
 * Only an ADMIN may change a ticket's status, priority or assignee — including on
 * a ticket the caller opened themselves. A member who could close their own ticket
 * (or mark it 'urgent', or assign it to someone) would be doing the admin's
 * triage for them.
 *
 * `groups` is a MySQL RESERVED WORD and is backticked in every query that names
 * it. So is `read` on the notifications table written by create_broadcast().
 */

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/session.php';
require_once __DIR__ . '/../../config/database.php';

const MESSAGE_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

const MESSAGE_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

// A status that puts a ticket to bed. Reaching either one stamps resolvedAt.
const MESSAGE_TERMINAL_STATUSES = ['resolved', 'closed'];

const MESSAGE_ADMIN_ROLES = ['admin', 'senior_admin', 'treasurer'];
const MESSAGE_ANY_MEMBER_ROLES = ['member', 'admin', 'senior_admin', 'treasurer'];

if (!function_exists('message_is_admin')) {
    /**
     * Is this caller admin-equivalent in the group? The role has already been
     * re-read from the members table by require_role() — this only classifies it.
     */
    function message_is_admin(array $caller): bool
    {
        return in_array((string) ($caller['role'] ?? ''), MESSAGE_ADMIN_ROLES, true);
    }
}

if (!function_exists('message_fetch_thread')) {
    /**
     * One ticket by id, or null. Returns the row WITHOUT any authorization applied
     * — the caller must gate on the groupId it carries before showing it to
     * anyone. It is fetched first precisely so the gate can use the row's OWN
     * groupId rather than a groupId supplied by the client.
     */
    function message_fetch_thread(PDO $pdo, string $messageId): ?array
    {
        $stmt = $pdo->prepare(
            'SELECT messageId, groupId, subject, body, createdBy, createdByName, '
            . 'assignedTo, status, priority, createdAt, updatedAt, resolvedAt '
            . 'FROM messages WHERE messageId = :messageId LIMIT 1'
        );
        $stmt->execute([':messageId' => $messageId]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }
}

if (!function_exists('message_member_display_name')) {
    /**
     * The caller's display name, READ FROM THE members ROW.
     *
     * NEVER from the request body. A name in a body is a string the client chose,
     * and a reply that can be signed with someone else's name is an impersonation
     * bug on a ticket that decides whether a member gets money.
     */
    function message_member_display_name(PDO $pdo, string $groupId, string $uid): string
    {
        $stmt = $pdo->prepare(
            'SELECT fullName, email FROM members '
            . 'WHERE groupId = :groupId AND uid = :uid LIMIT 1'
        );
        $stmt->execute([
            ':groupId' => $groupId,
            ':uid' => $uid,
        ]);
        $row = $stmt->fetch();

        if ($row === false) {
            // require_role() has already proven the membership row exists, so this
            // is unreachable in practice. Never invent a name if it happens.
            json_error('You are not a member of this group.', 403);
        }

        $name = trim((string) ($row['fullName'] ?? ''));
        if ($name !== '') {
            return $name;
        }

        $email = trim((string) ($row['email'] ?? ''));
        return $email !== '' ? $email : $uid;
    }
}

if (!function_exists('message_guard_thread_access')) {
    /**
     * THE MEMBER-SEES-OWN-TICKET GATE, for the single-thread endpoints.
     *
     * list_messages applies the same rule inside its WHERE clause (a member's
     * ticket list is filtered in SQL, never trimmed afterwards); the by-id
     * endpoints have already loaded one specific row, so the rule is enforced here
     * instead. Same rule, both spellings.
     */
    function message_guard_thread_access(array $caller, array $thread): void
    {
        if (message_is_admin($caller)) {
            return;
        }

        if ((string) $thread['createdBy'] !== (string) $caller['uid']) {
            json_error('You do not have permission to view this message.', 403);
        }
    }
}

if (!function_exists('list_messages')) {
    /**
     * GET messages.list — the group's support tickets.
     *
     * A plain member gets ONLY their own, enforced with `AND createdBy = :uid` in
     * the SQL. An admin/senior_admin/treasurer gets the whole group's queue.
     */
    function list_messages(): void
    {
        $groupId = trim((string) ($_GET['groupId'] ?? ''));
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        $caller = require_role($groupId, MESSAGE_ANY_MEMBER_ROLES);

        $sql = 'SELECT m.messageId, m.groupId, m.subject, m.body, m.createdBy, m.createdByName, '
            . 'm.assignedTo, m.status, m.priority, m.createdAt, m.updatedAt, m.resolvedAt, '
            . '(SELECT COUNT(*) FROM message_replies r WHERE r.messageId = m.messageId) AS replyCount '
            . 'FROM messages m WHERE m.groupId = :groupId';
        $params = [':groupId' => $groupId];

        $status = trim((string) ($_GET['status'] ?? ''));
        if ($status !== '') {
            if (!in_array($status, MESSAGE_STATUSES, true)) {
                json_error('status must be one of: open, in_progress, resolved, closed.', 422);
            }
            $sql .= ' AND m.status = :status';
            $params[':status'] = $status;
        }

        // THE AUTHORIZATION BOUNDARY. Not a UI filter.
        if (!message_is_admin($caller)) {
            $sql .= ' AND m.createdBy = :uid';
            $params[':uid'] = $caller['uid'];
        }

        $sql .= ' ORDER BY m.updatedAt DESC';

        $pdo = getDbConnection();
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        $messages = [];
        foreach ($stmt->fetchAll() as $row) {
            $row['replyCount'] = (int) $row['replyCount'];
            $messages[] = $row;
        }

        json_response(['messages' => $messages]);
    }
}

if (!function_exists('get_message')) {
    /**
     * GET messages.get — one ticket and its full reply chain.
     *
     * The groupId for the gate is taken from the ROW, never from the caller: a
     * client that could name the group being checked could name a group it happens
     * to be an admin of, and read a ticket from a group it is not in at all.
     */
    function get_message(): void
    {
        $messageId = trim((string) ($_GET['messageId'] ?? ''));
        if ($messageId === '') {
            json_error('messageId is required.', 422);
        }

        $pdo = getDbConnection();

        $thread = message_fetch_thread($pdo, $messageId);
        if ($thread === null) {
            json_error('Message not found.', 404);
        }

        $caller = require_role((string) $thread['groupId'], MESSAGE_ANY_MEMBER_ROLES);
        message_guard_thread_access($caller, $thread);

        $stmt = $pdo->prepare(
            'SELECT replyId, messageId, groupId, uid, userName, message, createdAt, attachmentsJson '
            . 'FROM message_replies WHERE messageId = :messageId ORDER BY createdAt ASC, replyId ASC'
        );
        $stmt->execute([':messageId' => $messageId]);

        json_response([
            'message' => $thread,
            'replies' => $stmt->fetchAll(),
        ]);
    }
}

if (!function_exists('create_message')) {
    /**
     * POST messages.create — any member may open a ticket.
     *
     * status is always 'open' and createdBy is always the session uid: neither is
     * taken from the body. createdByName is read from the members table for the
     * same reason.
     */
    function create_message(): void
    {
        $body = read_json_body();

        $groupId = trim((string) ($body['groupId'] ?? ''));
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        $caller = require_role($groupId, MESSAGE_ANY_MEMBER_ROLES);

        $subject = trim((string) ($body['subject'] ?? ''));
        if ($subject === '') {
            json_error('subject is required.', 422);
        }

        $text = trim((string) ($body['body'] ?? ''));
        if ($text === '') {
            json_error('body is required.', 422);
        }

        $priority = trim((string) ($body['priority'] ?? 'medium'));
        if ($priority === '') {
            $priority = 'medium';
        }
        if (!in_array($priority, MESSAGE_PRIORITIES, true)) {
            json_error('priority must be one of: low, medium, high, urgent.', 422);
        }

        $pdo = getDbConnection();
        $createdByName = message_member_display_name($pdo, $groupId, (string) $caller['uid']);

        $messageId = bin2hex(random_bytes(16));

        $stmt = $pdo->prepare(
            'INSERT INTO messages '
            . '(messageId, groupId, subject, body, createdBy, createdByName, assignedTo, '
            . 'status, priority, createdAt, updatedAt) '
            . "VALUES (:messageId, :groupId, :subject, :body, :createdBy, :createdByName, NULL, "
            . "'open', :priority, NOW(), NOW())"
        );
        $stmt->execute([
            ':messageId' => $messageId,
            ':groupId' => $groupId,
            ':subject' => $subject,
            ':body' => $text,
            ':createdBy' => $caller['uid'],
            ':createdByName' => $createdByName,
            ':priority' => $priority,
        ]);

        json_response(['message' => message_fetch_thread($pdo, $messageId)], 201);
    }
}

if (!function_exists('reply_message')) {
    /**
     * POST messages.reply — add a reply to a ticket.
     *
     * A member may reply only to their OWN thread; an admin may reply to any. A
     * CLOSED thread takes no more replies (409) — reopening is a status change,
     * and that is an admin's call, not a side effect of typing.
     *
     * The insert and the updatedAt bump are ONE transaction: a reply that did not
     * move the thread to the top of the queue would sit unseen, which for a member
     * asking about money is the same as not having written it.
     */
    function reply_message(): void
    {
        $body = read_json_body();

        $messageId = trim((string) ($body['messageId'] ?? ''));
        if ($messageId === '') {
            json_error('messageId is required.', 422);
        }

        $text = trim((string) ($body['message'] ?? ''));
        if ($text === '') {
            json_error('message is required.', 422);
        }

        $pdo = getDbConnection();

        $thread = message_fetch_thread($pdo, $messageId);
        if ($thread === null) {
            json_error('Message not found.', 404);
        }

        $groupId = (string) $thread['groupId'];
        $caller = require_role($groupId, MESSAGE_ANY_MEMBER_ROLES);
        message_guard_thread_access($caller, $thread);

        if ((string) $thread['status'] === 'closed') {
            json_error('This message is closed and cannot take further replies.', 409);
        }

        // From the DB, never the body. A reply signed with a name the client chose
        // is an impersonation.
        $userName = message_member_display_name($pdo, $groupId, (string) $caller['uid']);

        $pdo->beginTransaction();
        try {
            $insert = $pdo->prepare(
                'INSERT INTO message_replies (messageId, groupId, uid, userName, message, createdAt) '
                . 'VALUES (:messageId, :groupId, :uid, :userName, :message, NOW())'
            );
            $insert->execute([
                ':messageId' => $messageId,
                ':groupId' => $groupId,
                ':uid' => $caller['uid'],
                ':userName' => $userName,
                ':message' => $text,
            ]);

            $replyId = (int) $pdo->lastInsertId();

            $bump = $pdo->prepare('UPDATE messages SET updatedAt = NOW() WHERE messageId = :messageId');
            $bump->execute([':messageId' => $messageId]);

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        $stmt = $pdo->prepare(
            'SELECT replyId, messageId, groupId, uid, userName, message, createdAt, attachmentsJson '
            . 'FROM message_replies WHERE replyId = :replyId LIMIT 1'
        );
        $stmt->execute([':replyId' => $replyId]);

        json_response(['reply' => $stmt->fetch()], 201);
    }
}

if (!function_exists('update_message')) {
    /**
     * POST messages.update — triage a ticket. ADMIN-LEVEL ONLY.
     *
     * A member may NOT change the status, priority or assignee of their own
     * ticket. Triage is the admin's job, and a member who could close their own
     * ticket could bury a complaint the group needs to see.
     *
     * The SET clause is assembled from a HARDCODED WHITELIST of three columns.
     * Client keys never reach the SQL — an update built from array_keys($body) is
     * an injection of column names, and on this schema the columns next door are
     * createdBy and groupId.
     */
    function update_message(): void
    {
        $body = read_json_body();

        $messageId = trim((string) ($body['messageId'] ?? ''));
        if ($messageId === '') {
            json_error('messageId is required.', 422);
        }

        $pdo = getDbConnection();

        $thread = message_fetch_thread($pdo, $messageId);
        if ($thread === null) {
            json_error('Message not found.', 404);
        }

        // The gate's groupId comes from the ROW, never from the caller.
        $groupId = (string) $thread['groupId'];
        require_role($groupId, MESSAGE_ADMIN_ROLES);

        $sets = [];
        $params = [':messageId' => $messageId];

        // --- status (whitelisted column, ENUM-validated value) ---
        if (array_key_exists('status', $body)) {
            $status = trim((string) $body['status']);
            if (!in_array($status, MESSAGE_STATUSES, true)) {
                json_error('status must be one of: open, in_progress, resolved, closed.', 422);
            }

            $sets[] = 'status = :status';
            $params[':status'] = $status;

            if (in_array($status, MESSAGE_TERMINAL_STATUSES, true)) {
                $sets[] = 'resolvedAt = NOW()';
            } else {
                // Reopened. The old resolvedAt would be a lie about a live ticket.
                $sets[] = 'resolvedAt = NULL';
            }
        }

        // --- priority (whitelisted column, ENUM-validated value) ---
        if (array_key_exists('priority', $body)) {
            $priority = trim((string) $body['priority']);
            if (!in_array($priority, MESSAGE_PRIORITIES, true)) {
                json_error('priority must be one of: low, medium, high, urgent.', 422);
            }

            $sets[] = 'priority = :priority';
            $params[':priority'] = $priority;
        }

        // --- assignedTo (whitelisted column; the value must be a real, ACTIVE
        //     member of THIS group, checked against the members table) ---
        if (array_key_exists('assignedTo', $body)) {
            $assignedTo = $body['assignedTo'];

            if ($assignedTo === null || trim((string) $assignedTo) === '') {
                // Unassign. A literal NULL rather than a bound one: no placeholder
                // is added, so none can be left unbound.
                $sets[] = 'assignedTo = NULL';
            } else {
                $assignedTo = trim((string) $assignedTo);

                $check = $pdo->prepare(
                    'SELECT uid FROM members '
                    . "WHERE groupId = :groupId AND uid = :uid AND status = 'active' LIMIT 1"
                );
                $check->execute([
                    ':groupId' => $groupId,
                    ':uid' => $assignedTo,
                ]);

                if ($check->fetch() === false) {
                    json_error('assignedTo must be an active member of this group.', 422);
                }

                $sets[] = 'assignedTo = :assignedTo';
                $params[':assignedTo'] = $assignedTo;
            }
        }

        if ($sets === []) {
            json_error('Nothing to update. Provide status, priority or assignedTo.', 422);
        }

        $sets[] = 'updatedAt = NOW()';

        $stmt = $pdo->prepare(
            'UPDATE messages SET ' . implode(', ', $sets) . ' WHERE messageId = :messageId'
        );
        $stmt->execute($params);

        json_response(['message' => message_fetch_thread($pdo, $messageId)]);
    }
}

if (!function_exists('list_broadcasts')) {
    /**
     * GET broadcasts.list — the group's announcements. Every member may read them;
     * that is what a broadcast is for.
     */
    function list_broadcasts(): void
    {
        $groupId = trim((string) ($_GET['groupId'] ?? ''));
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        require_role($groupId, MESSAGE_ANY_MEMBER_ROLES);

        $pdo = getDbConnection();
        $stmt = $pdo->prepare(
            'SELECT broadcastId, groupId, title, message, createdBy, createdAt, updatedAt '
            . 'FROM broadcasts WHERE groupId = :groupId ORDER BY createdAt DESC'
        );
        $stmt->execute([':groupId' => $groupId]);

        json_response(['broadcasts' => $stmt->fetchAll()]);
    }
}

if (!function_exists('create_broadcast')) {
    /**
     * POST broadcasts.create — an admin announces something to the whole group.
     *
     * THE FAN-OUT IS THE POINT. A broadcast row on its own is a message in a
     * drawer: nobody is told it exists. So the broadcast AND one notification row
     * per ACTIVE member are written in ONE transaction. If the fan-out fails, the
     * broadcast is rolled back with it — a broadcast that half-notified the group
     * is worse than one that failed loudly, because the admin would believe
     * everyone had been told.
     *
     * ACTIVE members only. An inactive or suspended member is not in the
     * conversation and does not get the group's announcements.
     *
     * `read` and `groups` are both reserved words and both backticked below.
     */
    function create_broadcast(): void
    {
        $body = read_json_body();

        $groupId = trim((string) ($body['groupId'] ?? ''));
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        $caller = require_role($groupId, MESSAGE_ADMIN_ROLES);

        $title = trim((string) ($body['title'] ?? ''));
        if ($title === '') {
            json_error('title is required.', 422);
        }

        $text = trim((string) ($body['message'] ?? ''));
        if ($text === '') {
            json_error('message is required.', 422);
        }

        $pdo = getDbConnection();

        // groupName is denormalised onto each notification so the inbox can label
        // it without a join. It comes from the `groups` row, never from the body.
        $groupStmt = $pdo->prepare(
            'SELECT groupName FROM `groups` WHERE groupId = :groupId LIMIT 1'
        );
        $groupStmt->execute([':groupId' => $groupId]);
        $group = $groupStmt->fetch();

        if ($group === false) {
            json_error('Group not found.', 404);
        }

        $groupName = (string) $group['groupName'];

        // The recipient list. ACTIVE members only, and bounded by the group's
        // membership — there is no unbounded write here.
        $memberStmt = $pdo->prepare(
            "SELECT uid FROM members WHERE groupId = :groupId AND status = 'active'"
        );
        $memberStmt->execute([':groupId' => $groupId]);
        $recipients = $memberStmt->fetchAll();

        $broadcastId = bin2hex(random_bytes(16));

        $pdo->beginTransaction();
        try {
            $insert = $pdo->prepare(
                'INSERT INTO broadcasts (broadcastId, groupId, title, message, createdBy, '
                . 'createdAt, updatedAt) '
                . 'VALUES (:broadcastId, :groupId, :title, :message, :createdBy, NOW(), NOW())'
            );
            $insert->execute([
                ':broadcastId' => $broadcastId,
                ':groupId' => $groupId,
                ':title' => $title,
                ':message' => $text,
                ':createdBy' => $caller['uid'],
            ]);

            // One notification per active member. `read` is backticked — it is a
            // reserved word, and an unquoted one is a syntax error.
            $notify = $pdo->prepare(
                'INSERT INTO notifications '
                . '(notificationId, userId, type, title, message, groupId, groupName, senderId, '
                . '`read`, dismissed, createdAt) '
                . "VALUES (:notificationId, :userId, 'broadcast', :title, :message, :groupId, "
                . ':groupName, :senderId, 0, 0, NOW())'
            );

            $notified = 0;
            foreach ($recipients as $recipient) {
                $notify->execute([
                    ':notificationId' => bin2hex(random_bytes(16)),
                    ':userId' => $recipient['uid'],
                    ':title' => $title,
                    ':message' => $text,
                    ':groupId' => $groupId,
                    ':groupName' => $groupName,
                    ':senderId' => $caller['uid'],
                ]);
                $notified++;
            }

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        $stmt = $pdo->prepare(
            'SELECT broadcastId, groupId, title, message, createdBy, createdAt, updatedAt '
            . 'FROM broadcasts WHERE broadcastId = :broadcastId LIMIT 1'
        );
        $stmt->execute([':broadcastId' => $broadcastId]);

        json_response([
            'broadcast' => $stmt->fetch(),
            'membersNotified' => $notified,
        ], 201);
    }
}
