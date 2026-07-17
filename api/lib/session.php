<?php
/**
 * Session lifecycle and server-side authorization gates.
 * Sessions are the source of identity; group roles are re-checked against the
 * members table on every privileged call — a client-supplied role is never trusted.
 */

require_once __DIR__ . '/http.php';
require_once __DIR__ . '/../../config/database.php';

if (!function_exists('start_secure_session')) {
    function start_secure_session(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }

        // Auto-detect HTTPS: check server vars and common proxy headers
        $isSecure = false;
        if (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== '' && $_SERVER['HTTPS'] !== 'off') {
            $isSecure = true;
        } elseif (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') {
            $isSecure = true;
        } elseif (isset($_SERVER['HTTP_X_FORWARDED_SSL']) && $_SERVER['HTTP_X_FORWARDED_SSL'] === 'on') {
            $isSecure = true;
        } elseif (isset($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443) {
            $isSecure = true;
        }

        session_name('BNKSESSID');
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => $isSecure,
        ]);

        session_start();
    }
}

if (!function_exists('current_user')) {
    /**
     * The authenticated identity from the session, or null.
     */
    function current_user(): ?array
    {
        if (empty($_SESSION['uid'])) {
            return null;
        }

        $pdo = getDbConnection();
        $stmt = $pdo->prepare('SELECT uid FROM users WHERE uid = :uid LIMIT 1');
        $stmt->execute([':uid' => $_SESSION['uid']]);
        $row = $stmt->fetch();

        if ($row === false) {
            session_unset();
            session_destroy();
            return null;
        }

        return [
            'uid' => $_SESSION['uid'],
            'email' => $_SESSION['email'] ?? null,
        ];
    }
}

if (!function_exists('require_auth')) {
    /**
     * Ensure a session exists; emit 401 JSON and exit otherwise.
     */
    function require_auth(): array
    {
        $user = current_user();
        if ($user === null) {
            json_error('Authentication required.', 401);
        }
        return $user;
    }
}

if (!function_exists('require_role')) {
    /**
     * Re-check the caller's role for a group SERVER-SIDE against the members
     * table. Emits 403 JSON and exits when the caller has no membership row or
     * a role that is not in $allowedRoles.
     *
     * Roles are 'member', 'admin', 'senior_admin' and 'treasurer'. A treasurer is
     * admin-equivalent (plus custody of the group's physical cash), so every gate
     * that admits 'admin' must also admit 'treasurer' — EXCEPT role changes and
     * cycle settlement, which are 'senior_admin' only. This function is
     * role-agnostic: it matches whatever the caller passes, so the gate lists at
     * the call sites are the authority.
     */
    function require_role(string $groupId, array $allowedRoles): array
    {
        $user = require_auth();

        $pdo = getDbConnection();
        $stmt = $pdo->prepare(
            'SELECT role FROM members WHERE groupId = :groupId AND uid = :uid LIMIT 1'
        );
        $stmt->execute([
            ':groupId' => $groupId,
            ':uid' => $user['uid'],
        ]);
        $row = $stmt->fetch();

        if ($row === false || !in_array($row['role'], $allowedRoles, true)) {
            json_error('You do not have permission to perform this action.', 403);
        }

        $user['role'] = $row['role'];
        $user['groupId'] = $groupId;
        return $user;
    }
}
