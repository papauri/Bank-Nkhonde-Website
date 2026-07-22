<?php
/**
 * Invitation endpoints: email invitations (invitations.*) and shareable join
 * codes (codes.*). Every group-scoped action re-checks the caller's role
 * server-side via require_role() against the members table — a
 * client-supplied role is never trusted. Identity (uid/email) always comes
 * from the session, never from the request body. All queries are prepared
 * statements.
 */

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/session.php';
require_once __DIR__ . '/../lib/membership.php';
require_once __DIR__ . '/../../config/database.php';

if (!function_exists('invitation_select_row')) {
    function invitation_select_row(PDO $pdo, string $invitationId): ?array
    {
        $stmt = $pdo->prepare(
            'SELECT invitationId, invitedEmail, invitedBy, groupId, status, createdAt, respondedAt '
            . 'FROM invitations WHERE invitationId = :invitationId LIMIT 1'
        );
        $stmt->execute([':invitationId' => $invitationId]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }
}

if (!function_exists('code_select_row')) {
    function code_select_row(PDO $pdo, string $codeId): ?array
    {
        $stmt = $pdo->prepare(
            'SELECT codeId, code, groupId, groupName, createdBy, createdAt, expiresAt, maxUses, usedCount, status '
            . 'FROM invitation_codes WHERE codeId = :codeId LIMIT 1'
        );
        $stmt->execute([':codeId' => $codeId]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }
}

if (!function_exists('insert_member_from_user')) {
    /**
     * Shared "join a group" insert — mirrors add_member's shape in
     * members.php exactly (fullName/email copied server-side from users,
     * role fixed to 'member', money/eligibility columns default to 0). A
     * PDOException with SQLSTATE 1062 (already a member) is treated as
     * success by the caller, so it is left to bubble up here.
     */
    function insert_member_from_user(PDO $pdo, string $groupId, array $userRow, ?string $invitedBy): void
    {
        // Money Masters rulebook: a group is capped at 30 members. Enforced on
        // every join path — here it covers both invite-accept and code-redeem.
        assert_group_has_capacity($pdo, $groupId);

        $insertStmt = $pdo->prepare(
            'INSERT INTO members '
            . '(groupId, uid, fullName, email, role, status, joinedAt, invitedBy, '
            . 'seedMoneyPaid, monthlyContributionsCurrent, eligibleForLoan, createdAt, updatedAt) '
            . 'VALUES (:groupId, :uid, :fullName, :email, :role, :status, NOW(), :invitedBy, '
            . ':seedMoneyPaid, :monthlyContributionsCurrent, :eligibleForLoan, NOW(), NOW())'
        );
        $insertStmt->execute([
            ':groupId' => $groupId,
            ':uid' => $userRow['uid'],
            ':fullName' => $userRow['fullName'],
            ':email' => $userRow['email'],
            ':role' => 'member',
            ':status' => 'active',
            ':invitedBy' => $invitedBy,
            ':seedMoneyPaid' => 0,
            ':monthlyContributionsCurrent' => 0,
            ':eligibleForLoan' => 0,
        ]);
    }
}

if (!function_exists('create_invitation')) {
    function create_invitation(): void
    {
        $body = read_json_body();
        $groupId = (string) ($body['groupId'] ?? '');
        $invitedEmail = trim((string) ($body['invitedEmail'] ?? ''));

        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }
        if ($invitedEmail === '' || !filter_var($invitedEmail, FILTER_VALIDATE_EMAIL)) {
            json_error('A valid invitedEmail is required.', 422);
        }

        $caller = require_role($groupId, ['admin', 'senior_admin', 'treasurer']);

        $pdo = getDbConnection();
        $invitationId = bin2hex(random_bytes(16));

        $insertStmt = $pdo->prepare(
            'INSERT INTO invitations (invitationId, invitedEmail, invitedBy, groupId, status, createdAt) '
            . 'VALUES (:invitationId, :invitedEmail, :invitedBy, :groupId, :status, NOW())'
        );
        $insertStmt->execute([
            ':invitationId' => $invitationId,
            ':invitedEmail' => $invitedEmail,
            ':invitedBy' => $caller['uid'],
            ':groupId' => $groupId,
            ':status' => 'pending',
        ]);

        json_response(invitation_select_row($pdo, $invitationId), 201);
    }
}

if (!function_exists('list_invitations')) {
    function list_invitations(): void
    {
        $groupId = (string) ($_GET['groupId'] ?? '');
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        require_role($groupId, ['admin', 'senior_admin', 'treasurer']);

        $pdo = getDbConnection();
        $stmt = $pdo->prepare(
            'SELECT invitationId, invitedEmail, invitedBy, groupId, status, createdAt, respondedAt '
            . 'FROM invitations WHERE groupId = :groupId ORDER BY createdAt DESC'
        );
        $stmt->execute([':groupId' => $groupId]);
        $invitations = $stmt->fetchAll();

        json_response(['invitations' => $invitations]);
    }
}

if (!function_exists('respond_invitation')) {
    function respond_invitation(): void
    {
        $user = require_auth();

        $body = read_json_body();
        $invitationId = (string) ($body['invitationId'] ?? '');
        $action = (string) ($body['action'] ?? '');

        if ($invitationId === '') {
            json_error('invitationId is required.', 422);
        }
        if (!in_array($action, ['accept', 'reject'], true)) {
            json_error('action must be accept or reject.', 422);
        }

        $pdo = getDbConnection();

        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare(
                'SELECT invitationId, invitedEmail, invitedBy, groupId, status '
                . 'FROM invitations WHERE invitationId = :invitationId LIMIT 1 FOR UPDATE'
            );
            $stmt->execute([':invitationId' => $invitationId]);
            $invitation = $stmt->fetch();

            if ($invitation === false) {
                $pdo->rollBack();
                json_error('Invitation not found.', 404);
            }

            // Identity comes from the session, never the body — the caller may
            // only respond to an invitation addressed to their own email.
            if (strcasecmp((string) $invitation['invitedEmail'], (string) $user['email']) !== 0) {
                $pdo->rollBack();
                json_error('You do not have permission to perform this action.', 403);
            }

            if ($invitation['status'] !== 'pending') {
                $pdo->rollBack();
                json_error('This invitation has already been responded to.', 409);
            }

            $newStatus = $action === 'accept' ? 'accepted' : 'rejected';

            $updateStmt = $pdo->prepare(
                'UPDATE invitations SET status = :status, respondedAt = NOW() '
                . 'WHERE invitationId = :invitationId'
            );
            $updateStmt->execute([
                ':status' => $newStatus,
                ':invitationId' => $invitationId,
            ]);

            if ($action === 'accept') {
                $userStmt = $pdo->prepare('SELECT uid, email, fullName FROM users WHERE uid = :uid LIMIT 1');
                $userStmt->execute([':uid' => $user['uid']]);
                $userRow = $userStmt->fetch();

                if ($userRow === false) {
                    $pdo->rollBack();
                    json_error('User profile not found.', 404);
                }

                try {
                    insert_member_from_user($pdo, $invitation['groupId'], $userRow, $invitation['invitedBy']);
                } catch (PDOException $e) {
                    if ((int) $e->errorInfo[1] !== 1062) {
                        throw $e;
                    }
                    // Already a member — the invitation is still marked accepted.
                }
            }

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        json_response(invitation_select_row($pdo, $invitationId));
    }
}

if (!function_exists('create_invitation_code')) {
    function create_invitation_code(): void
    {
        $body = read_json_body();
        $groupId = (string) ($body['groupId'] ?? '');

        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        $caller = require_role($groupId, ['admin', 'senior_admin', 'treasurer']);

        $expiresAt = null;
        if (array_key_exists('expiresAt', $body) && $body['expiresAt'] !== null && $body['expiresAt'] !== '') {
            $expiresAt = (string) $body['expiresAt'];
            $timestamp = strtotime($expiresAt);
            if ($timestamp === false) {
                json_error('expiresAt must be a valid date.', 422);
            }
            $expiresAt = date('Y-m-d H:i:s', $timestamp);
        }

        $maxUses = null;
        if (array_key_exists('maxUses', $body) && $body['maxUses'] !== null && $body['maxUses'] !== '') {
            if (!is_numeric($body['maxUses']) || (int) $body['maxUses'] <= 0) {
                json_error('maxUses must be a positive integer.', 422);
            }
            $maxUses = (int) $body['maxUses'];
        }

        $pdo = getDbConnection();

        $groupStmt = $pdo->prepare('SELECT groupName FROM `groups` WHERE groupId = :groupId LIMIT 1');
        $groupStmt->execute([':groupId' => $groupId]);
        $groupRow = $groupStmt->fetch();

        if ($groupRow === false) {
            json_error('Group not found.', 404);
        }

        $codeId = bin2hex(random_bytes(16));
        $code = strtoupper(bin2hex(random_bytes(4)));

        $insertStmt = $pdo->prepare(
            'INSERT INTO invitation_codes '
            . '(codeId, code, groupId, groupName, createdBy, createdAt, expiresAt, maxUses, usedCount, status) '
            . 'VALUES (:codeId, :code, :groupId, :groupName, :createdBy, NOW(), :expiresAt, :maxUses, 0, :status)'
        );

        try {
            $insertStmt->execute([
                ':codeId' => $codeId,
                ':code' => $code,
                ':groupId' => $groupId,
                ':groupName' => $groupRow['groupName'],
                ':createdBy' => $caller['uid'],
                ':expiresAt' => $expiresAt,
                ':maxUses' => $maxUses,
                ':status' => 'active',
            ]);
        } catch (PDOException $e) {
            if ((int) $e->errorInfo[1] !== 1062) {
                throw $e;
            }
            // Code collision — regenerate once.
            $code = strtoupper(bin2hex(random_bytes(4)));
            try {
                $insertStmt->execute([
                    ':codeId' => $codeId,
                    ':code' => $code,
                    ':groupId' => $groupId,
                    ':groupName' => $groupRow['groupName'],
                    ':createdBy' => $caller['uid'],
                    ':expiresAt' => $expiresAt,
                    ':maxUses' => $maxUses,
                    ':status' => 'active',
                ]);
            } catch (PDOException $e2) {
                if ((int) $e2->errorInfo[1] === 1062) {
                    json_error('Could not generate a unique code, please try again.', 409);
                }
                throw $e2;
            }
        }

        json_response(code_select_row($pdo, $codeId), 201);
    }
}

if (!function_exists('list_invitation_codes')) {
    function list_invitation_codes(): void
    {
        $groupId = (string) ($_GET['groupId'] ?? '');
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        require_role($groupId, ['admin', 'senior_admin', 'treasurer']);

        $pdo = getDbConnection();
        $stmt = $pdo->prepare(
            'SELECT codeId, code, groupId, groupName, createdBy, createdAt, expiresAt, maxUses, usedCount, status '
            . 'FROM invitation_codes WHERE groupId = :groupId ORDER BY createdAt DESC'
        );
        $stmt->execute([':groupId' => $groupId]);
        $codes = $stmt->fetchAll();

        json_response(['codes' => $codes]);
    }
}

if (!function_exists('revoke_invitation_code')) {
    function revoke_invitation_code(): void
    {
        $body = read_json_body();
        $codeId = (string) ($body['codeId'] ?? '');

        if ($codeId === '') {
            json_error('codeId is required.', 422);
        }

        $pdo = getDbConnection();

        // groupId for the role check is derived from the code row, never the
        // body — the caller does not get to assert which group they administer.
        $codeRow = code_select_row($pdo, $codeId);
        if ($codeRow === null) {
            json_error('Code not found.', 404);
        }

        require_role($codeRow['groupId'], ['admin', 'senior_admin', 'treasurer']);

        $updateStmt = $pdo->prepare(
            "UPDATE invitation_codes SET status = 'revoked' WHERE codeId = :codeId"
        );
        $updateStmt->execute([':codeId' => $codeId]);

        json_response(code_select_row($pdo, $codeId));
    }
}

if (!function_exists('redeem_invitation_code')) {
    function redeem_invitation_code(): void
    {
        $user = require_auth();

        $body = read_json_body();
        $code = trim((string) ($body['code'] ?? ''));

        if ($code === '') {
            json_error('code is required.', 422);
        }

        $pdo = getDbConnection();
        $genericError = 'This code is invalid or expired.';

        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare(
                'SELECT codeId, code, groupId, groupName, expiresAt, maxUses, usedCount, status '
                . 'FROM invitation_codes WHERE code = :code LIMIT 1 FOR UPDATE'
            );
            $stmt->execute([':code' => $code]);
            $codeRow = $stmt->fetch();

            // No enumeration oracle — every rejection reason returns the same
            // generic message and status.
            if ($codeRow === false || $codeRow['status'] !== 'active') {
                $pdo->rollBack();
                json_error($genericError, 404);
            }

            if ($codeRow['expiresAt'] !== null && strtotime($codeRow['expiresAt']) < time()) {
                $pdo->rollBack();
                json_error($genericError, 409);
            }

            if ($codeRow['maxUses'] !== null && (int) $codeRow['usedCount'] >= (int) $codeRow['maxUses']) {
                $pdo->rollBack();
                json_error($genericError, 409);
            }

            try {
                $useStmt = $pdo->prepare(
                    'INSERT INTO invitation_code_uses (codeId, uid, usedAt) VALUES (:codeId, :uid, NOW())'
                );
                $useStmt->execute([
                    ':codeId' => $codeRow['codeId'],
                    ':uid' => $user['uid'],
                ]);
            } catch (PDOException $e) {
                if ((int) $e->errorInfo[1] === 1062) {
                    $pdo->rollBack();
                    json_error('You have already used this code.', 409);
                }
                throw $e;
            }

            $incrementStmt = $pdo->prepare(
                'UPDATE invitation_codes SET usedCount = usedCount + 1 WHERE codeId = :codeId'
            );
            $incrementStmt->execute([':codeId' => $codeRow['codeId']]);

            $userStmt = $pdo->prepare('SELECT uid, email, fullName FROM users WHERE uid = :uid LIMIT 1');
            $userStmt->execute([':uid' => $user['uid']]);
            $userRow = $userStmt->fetch();

            if ($userRow === false) {
                $pdo->rollBack();
                json_error('User profile not found.', 404);
            }

            try {
                insert_member_from_user($pdo, $codeRow['groupId'], $userRow, null);
            } catch (PDOException $e) {
                if ((int) $e->errorInfo[1] !== 1062) {
                    throw $e;
                }
                // Already a member — the code redemption still succeeds.
            }

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        json_response([
            'groupId' => $codeRow['groupId'],
            'groupName' => $codeRow['groupName'],
        ]);
    }
}
