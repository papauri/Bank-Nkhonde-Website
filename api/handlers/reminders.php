<?php
/**
 * POST reminders.send — an admin/senior_admin/treasurer nudges one member or
 * the whole group, on BOTH channels: an in-app notification row and an email.
 *
 * THE FAN-OUT SHAPE IS COPIED FROM create_broadcast() in messages.php: all
 * in-app notification rows are written in ONE transaction (they all land or
 * none do). Email is a SEPARATE, best-effort step that runs AFTER commit — an
 * SMTP failure for one recipient must never roll back notifications that have
 * already been written, and must never abort the loop for the remaining
 * recipients.
 *
 * The RECIPIENT'S email/name is always resolved server-side from the members
 * table. subject/message are the only free text the caller supplies; neither
 * a recipient email nor a link may come from the request body.
 *
 * `groups` and `read` are both MySQL reserved words and are backticked below,
 * exactly as in messages.php / notifications.php.
 */

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/session.php';
require_once __DIR__ . '/../lib/mailer.php';
require_once __DIR__ . '/../../config/database.php';

const REMINDER_ADMIN_ROLES = ['admin', 'senior_admin', 'treasurer'];

if (!function_exists('reminders_group_name')) {
    function reminders_group_name(PDO $pdo, string $groupId): string
    {
        $stmt = $pdo->prepare('SELECT groupName FROM `groups` WHERE groupId = :groupId LIMIT 1');
        $stmt->execute([':groupId' => $groupId]);
        $group = $stmt->fetch();

        if ($group === false) {
            json_error('Group not found.', 404);
        }

        return (string) $group['groupName'];
    }
}

if (!function_exists('reminders_active_members')) {
    /**
     * Every ACTIVE member of the group, with the fields needed to notify and
     * email them. Bounded by group membership — never unbounded.
     */
    function reminders_active_members(PDO $pdo, string $groupId): array
    {
        $stmt = $pdo->prepare(
            "SELECT uid, fullName, email FROM members "
            . "WHERE groupId = :groupId AND status = 'active'"
        );
        $stmt->execute([':groupId' => $groupId]);

        return $stmt->fetchAll();
    }
}

if (!function_exists('reminders_one_active_member')) {
    /**
     * One specific ACTIVE member of the group, or null. Used for
     * recipient='specific' — the uid is only ever trusted after this lookup
     * proves it names a real, active member of THIS group.
     */
    function reminders_one_active_member(PDO $pdo, string $groupId, string $uid): ?array
    {
        $stmt = $pdo->prepare(
            "SELECT uid, fullName, email FROM members "
            . "WHERE groupId = :groupId AND uid = :uid AND status = 'active' LIMIT 1"
        );
        $stmt->execute([':groupId' => $groupId, ':uid' => $uid]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }
}

if (!function_exists('send_reminders')) {
    /**
     * POST reminders.send — see file header for the full contract.
     */
    function send_reminders(): void
    {
        $body = read_json_body();

        $groupId = trim((string) ($body['groupId'] ?? ''));
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        $caller = require_role($groupId, REMINDER_ADMIN_ROLES);

        $recipientMode = trim((string) ($body['recipient'] ?? ''));
        if (!in_array($recipientMode, ['all', 'specific'], true)) {
            json_error("recipient must be 'all' or 'specific'.", 422);
        }

        $targetUid = trim((string) ($body['uid'] ?? ''));
        if ($recipientMode === 'specific' && $targetUid === '') {
            json_error('uid is required when recipient is "specific".', 422);
        }

        $subject = trim((string) ($body['subject'] ?? ''));
        if ($subject === '') {
            json_error('subject is required.', 422);
        }

        $message = trim((string) ($body['message'] ?? ''));
        if ($message === '') {
            json_error('message is required.', 422);
        }

        $pdo = getDbConnection();
        $groupName = reminders_group_name($pdo, $groupId);

        if ($recipientMode === 'specific') {
            $member = reminders_one_active_member($pdo, $groupId, $targetUid);
            if ($member === null) {
                json_error('That member is not an active member of this group.', 404);
            }
            $recipients = [$member];
        } else {
            $recipients = reminders_active_members($pdo, $groupId);
        }

        // --- Phase 1: ALL in-app notification rows, in ONE transaction. ---
        $notified = 0;
        $pdo->beginTransaction();
        try {
            $notify = $pdo->prepare(
                'INSERT INTO notifications '
                . '(notificationId, userId, type, title, message, groupId, groupName, senderId, '
                . '`read`, dismissed, createdAt) '
                . "VALUES (:notificationId, :userId, 'reminder', :title, :message, :groupId, "
                . ':groupName, :senderId, 0, 0, NOW())'
            );

            foreach ($recipients as $recipient) {
                $notify->execute([
                    ':notificationId' => bin2hex(random_bytes(16)),
                    ':userId' => $recipient['uid'],
                    ':title' => $subject,
                    ':message' => $message,
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

        // --- Phase 2: email, best-effort, AFTER commit. A single SMTP failure
        //     must not roll back the notifications already written and must not
        //     stop the remaining sends. Up to ~30 members, sent synchronously. ---
        $emailed = 0;
        $emailFailed = 0;

        $safeSubject = htmlspecialchars($subject, ENT_QUOTES, 'UTF-8');
        $safeMessage = htmlspecialchars($message, ENT_QUOTES, 'UTF-8');

        foreach ($recipients as $recipient) {
            $toEmail = trim((string) ($recipient['email'] ?? ''));
            if ($toEmail === '') {
                $emailFailed++;
                continue;
            }

            $toName = trim((string) ($recipient['fullName'] ?? ''));
            $safeName = htmlspecialchars($toName !== '' ? $toName : $toEmail, ENT_QUOTES, 'UTF-8');

            $text = ($toName !== '' ? "Hello {$toName},\n\n" : '') . $message;
            $html = '<p>' . ($toName !== '' ? "Hello {$safeName}," : '') . '</p>'
                . '<p>' . nl2br($safeMessage) . '</p>';

            try {
                send_mail($toEmail, $toName, $subject, $text, $html);
                $emailed++;
            } catch (Throwable $e) {
                error_log('[reminders] send to ' . $recipient['uid'] . ' failed: ' . $e->getMessage());
                $emailFailed++;
            }
        }

        json_response([
            'notified' => $notified,
            'emailed' => $emailed,
            'emailFailed' => $emailFailed,
        ]);
    }
}
