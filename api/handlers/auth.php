<?php
/**
 * Authentication endpoints: register, login, logout, session.
 * All queries are prepared statements. Passwords are stored only as Argon2id
 * hashes and are never returned in any response.
 */

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/session.php';
require_once __DIR__ . '/../lib/password.php';
require_once __DIR__ . '/../../config/database.php';

if (!function_exists('register')) {
    function register(): void
    {
        $body = read_json_body();
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        $fullName = trim((string) ($body['fullName'] ?? ''));
        $password = (string) ($body['password'] ?? '');

        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            json_error('A valid email is required.', 422);
        }
        if ($fullName === '') {
            json_error('Full name is required.', 422);
        }
        if (strlen($password) < 8) {
            json_error('Password must be at least 8 characters.', 422);
        }

        $pdo = getDbConnection();

        $uid = bin2hex(random_bytes(16));
        $passwordHash = hash_password($password);

        $insert = $pdo->prepare(
            'INSERT INTO users (uid, email, fullName, passwordHash, emailVerified, createdAt, updatedAt) '
            . 'VALUES (:uid, :email, :fullName, :passwordHash, 0, NOW(), NOW())'
        );

        // The UNIQUE index on users.email is the authority, not a prior SELECT —
        // a check-then-insert races under concurrent signups.
        try {
            $insert->execute([
                ':uid' => $uid,
                ':email' => $email,
                ':fullName' => $fullName,
                ':passwordHash' => $passwordHash,
            ]);
        } catch (PDOException $e) {
            if ($e->errorInfo[1] === 1062) { // MySQL ER_DUP_ENTRY
                json_error('An account with that email already exists.', 409);
            }
            throw $e;
        }

        json_response([
            'uid' => $uid,
            'email' => $email,
            'fullName' => $fullName,
            'emailVerified' => 0,
        ], 201);
    }
}

if (!function_exists('login')) {
    function login(): void
    {
        $body = read_json_body();
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        $password = (string) ($body['password'] ?? '');

        // Single generic failure for every reason — no user enumeration.
        $genericFail = 'Invalid email or password.';

        if ($email === '' || $password === '') {
            json_error($genericFail, 401);
        }

        $pdo = getDbConnection();
        $stmt = $pdo->prepare(
            'SELECT uid, email, fullName, passwordHash, emailVerified FROM users WHERE email = :email LIMIT 1'
        );
        $stmt->execute([':email' => $email]);
        $user = $stmt->fetch();

        if ($user === false || !verify_password($password, (string) $user['passwordHash'])) {
            json_error($genericFail, 401);
        }

        start_secure_session();
        session_regenerate_id(true);
        $_SESSION['uid'] = $user['uid'];
        $_SESSION['email'] = $user['email'];

        json_response([
            'uid' => $user['uid'],
            'email' => $user['email'],
            'fullName' => $user['fullName'],
            'emailVerified' => (int) $user['emailVerified'],
        ]);
    }
}

if (!function_exists('logout')) {
    function logout(): void
    {
        start_secure_session();
        $_SESSION = [];

        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(
                session_name(),
                '',
                [
                    'expires' => time() - 42000,
                    'path' => $params['path'],
                    'domain' => $params['domain'],
                    'secure' => true,
                    'httponly' => true,
                    'samesite' => 'Lax',
                ]
            );
        }

        session_destroy();

        json_response(['loggedOut' => true]);
    }
}

if (!function_exists('session_status_handler')) {
    /**
     * Return the current session identity or 401. Named to avoid colliding with
     * PHP's built-in session_status().
     */
    function session_status_handler(): void
    {
        $user = current_user();
        if ($user === null) {
            json_error('No active session.', 401);
        }

        $pdo = getDbConnection();
        $stmt = $pdo->prepare(
            'SELECT fullName, profileImageUrl FROM users WHERE uid = :uid LIMIT 1'
        );
        $stmt->execute([':uid' => $user['uid']]);
        $profile = $stmt->fetch();

        $user['fullName'] = $profile !== false ? $profile['fullName'] : null;
        $user['profileImageUrl'] = $profile !== false ? $profile['profileImageUrl'] : null;

        json_response($user);
    }
}
