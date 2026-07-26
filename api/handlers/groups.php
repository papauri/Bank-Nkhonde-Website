<?php
/**
 * Group endpoints: list my groups, get one group, create a group, update a group.
 * Every group-scoped action re-checks the caller's role server-side via
 * require_role() against the members table — a client-supplied role is never
 * trusted. All queries are prepared statements.
 */

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/session.php';
require_once __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/rules.php';

if (!function_exists('list_my_groups')) {
    function list_my_groups(): void
    {
        $user = require_auth();

        $pdo = getDbConnection();
        $stmt = $pdo->prepare(
            'SELECT g.groupId, g.groupName, g.description, g.status, g.createdBy, '
            . 'g.createdAt, g.updatedAt, m.role AS myRole, m.status AS myMemberStatus '
            . 'FROM `groups` g '
            . 'JOIN members m ON m.groupId = g.groupId '
            . 'WHERE m.uid = :uid '
            . 'ORDER BY g.createdAt DESC'
        );
        $stmt->execute([':uid' => $user['uid']]);
        $groups = $stmt->fetchAll();

        json_response(['groups' => $groups]);
    }
}

if (!function_exists('get_group')) {
    function get_group(): void
    {
        $groupId = (string) ($_GET['groupId'] ?? '');
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        $user = require_role($groupId, ['member', 'admin', 'senior_admin', 'treasurer']);

        $pdo = getDbConnection();
        $stmt = $pdo->prepare(
            'SELECT groupId, groupName, description, status, createdBy, createdAt, updatedAt, '
            // Governance docs (migration 010) — any member may READ the rules they
            // are bound by; only an admin may write them (update_group).
            . 'governanceRulesText, rulesDocumentUrl, rulesDocumentName '
            . 'FROM `groups` WHERE groupId = :groupId LIMIT 1'
        );
        $stmt->execute([':groupId' => $groupId]);
        $group = $stmt->fetch();

        if ($group === false) {
            json_error('Group not found.', 404);
        }

        $group['myRole'] = $user['role'];

        json_response($group);
    }
}

if (!function_exists('create_group')) {
    function create_group(): void
    {
        $user = require_auth();

        $body = read_json_body();
        $groupName = trim((string) ($body['groupName'] ?? ''));
        $description = array_key_exists('description', $body)
            ? trim((string) $body['description'])
            : null;

        if ($groupName === '') {
            json_error('groupName is required.', 422);
        }

        $pdo = getDbConnection();

        // Look up the caller's profile for the denormalised member fields —
        // never trust client-supplied fullName/email for this insert.
        $userStmt = $pdo->prepare('SELECT email, fullName FROM users WHERE uid = :uid LIMIT 1');
        $userStmt->execute([':uid' => $user['uid']]);
        $userRow = $userStmt->fetch();

        if ($userRow === false) {
            json_error('User profile not found.', 404);
        }

        $groupId = bin2hex(random_bytes(16));

        $pdo->beginTransaction();
        try {
            $insertGroup = $pdo->prepare(
                'INSERT INTO `groups` (groupId, groupName, description, status, createdBy, createdAt, updatedAt) '
                . 'VALUES (:groupId, :groupName, :description, :status, :createdBy, NOW(), NOW())'
            );
            $insertGroup->execute([
                ':groupId' => $groupId,
                ':groupName' => $groupName,
                ':description' => $description,
                ':status' => 'active',
                ':createdBy' => $user['uid'],
            ]);

            $insertMember = $pdo->prepare(
                'INSERT INTO members '
                . '(groupId, uid, fullName, email, role, status, joinedAt, createdAt, updatedAt) '
                . 'VALUES (:groupId, :uid, :fullName, :email, :role, :status, NOW(), NOW(), NOW())'
            );
            $insertMember->execute([
                ':groupId' => $groupId,
                ':uid' => $user['uid'],
                ':fullName' => $userRow['fullName'],
                ':email' => $userRow['email'],
                ':role' => 'senior_admin',
                ':status' => 'active',
            ]);

            // Every group needs its group_rules row from birth — rules.update
            // only UPDATEs an existing row, it never creates one. Without this
            // call a new group could never have its money rules set at all.
            // Shared with get_rules()/update_rules() (api/handlers/rules.php)
            // so a group created before this existed can self-heal the same
            // way — see rules_ensure_row() for the full rationale on the
            // column defaults and the 'fixed'/'fixed' override.
            rules_ensure_row($pdo, $groupId);

            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        json_response([
            'groupId' => $groupId,
            'groupName' => $groupName,
            'description' => $description,
            'status' => 'active',
            'createdBy' => $user['uid'],
            'myRole' => 'senior_admin',
        ], 201);
    }
}

if (!function_exists('update_group')) {
    function update_group(): void
    {
        $body = read_json_body();
        $groupId = (string) ($body['groupId'] ?? '');

        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        require_role($groupId, ['admin', 'senior_admin', 'treasurer']);

        // Explicit whitelist of updatable columns — never build the SET clause
        // from raw client keys.
        $allowedStatuses = ['active', 'inactive', 'completed'];
        $updates = [];
        $params = [':groupId' => $groupId];

        if (array_key_exists('groupName', $body)) {
            $groupName = trim((string) $body['groupName']);
            if ($groupName === '') {
                json_error('groupName cannot be empty.', 422);
            }
            $updates[] = 'groupName = :groupName';
            $params[':groupName'] = $groupName;
        }

        if (array_key_exists('description', $body)) {
            $updates[] = 'description = :description';
            $params[':description'] = trim((string) $body['description']);
        }

        if (array_key_exists('status', $body)) {
            $status = (string) $body['status'];
            if (!in_array($status, $allowedStatuses, true)) {
                json_error('Invalid status value.', 422);
            }
            $updates[] = 'status = :status';
            $params[':status'] = $status;
        }

        // Governance documents (migration 010): the group's written rules, as free
        // text and/or an uploaded PDF. An empty string clears the field to NULL —
        // "no rules document" is a real state, distinct from "unchanged" (a key
        // that is absent is simply not touched).
        if (array_key_exists('governanceRulesText', $body)) {
            $text = trim((string) $body['governanceRulesText']);
            $updates[] = 'governanceRulesText = :governanceRulesText';
            $params[':governanceRulesText'] = $text === '' ? null : $text;
        }

        if (array_key_exists('rulesDocumentUrl', $body)) {
            $url = trim((string) $body['rulesDocumentUrl']);
            // Only a path this server itself minted (files.upload returns
            // /uploads/proofs/<random>.pdf). Refuse an arbitrary absolute URL so a
            // group's "rules document" cannot be pointed at an attacker's site.
            if ($url !== '' && strpos($url, upload_web_url()) !== 0) {
                json_error('A rules document must be a file uploaded to this site.', 422);
            }
            $updates[] = 'rulesDocumentUrl = :rulesDocumentUrl';
            $params[':rulesDocumentUrl'] = $url === '' ? null : $url;
        }

        if (array_key_exists('rulesDocumentName', $body)) {
            $name = trim((string) $body['rulesDocumentName']);
            $updates[] = 'rulesDocumentName = :rulesDocumentName';
            $params[':rulesDocumentName'] = $name === '' ? null : $name;
        }

        if (empty($updates)) {
            json_error('No updatable fields provided.', 422);
        }

        $updates[] = 'updatedAt = NOW()';

        $pdo = getDbConnection();
        $sql = 'UPDATE `groups` SET ' . implode(', ', $updates) . ' WHERE groupId = :groupId';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        $selectStmt = $pdo->prepare(
            'SELECT groupId, groupName, description, status, createdBy, createdAt, updatedAt, '
            . 'governanceRulesText, rulesDocumentUrl, rulesDocumentName '
            . 'FROM `groups` WHERE groupId = :groupId LIMIT 1'
        );
        $selectStmt->execute([':groupId' => $groupId]);
        $group = $selectStmt->fetch();

        if ($group === false) {
            json_error('Group not found.', 404);
        }

        json_response($group);
    }
}
