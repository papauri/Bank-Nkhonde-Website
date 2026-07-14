<?php
/**
 * Password reset: request a reset link by email, and consume the token to set a
 * new password. Both endpoints are UNAUTHENTICATED (a user who needs a reset
 * cannot log in), which makes them the highest-risk surface in the API.
 *
 * Two invariants defend them:
 *   1. NO ENUMERATION. request_password_reset() returns a byte-identical response
 *      for a known email, an unknown email, a rate-limited caller, and even an SMTP
 *      failure. Nothing the caller sees reveals whether an address is registered.
 *   2. SERVER-DERIVED RECIPIENT. The reset mail goes ONLY to the address stored on
 *      the users row, never to the address in the request body. The body address is
 *      a lookup key, nothing more. (This is the same fix that closed the open relay
 *      in functions/index.js.)
 *
 * The raw token is never stored and never logged — only its sha256 hash is kept,
 * and the raw value exists solely in the emailed link.
 */

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/password.php';
require_once __DIR__ . '/../lib/mailer.php';
require_once __DIR__ . '/../../config/database.php';

if (!function_exists('password_reset_generic_ok')) {
    /**
     * The single response request_password_reset() ever returns. Sending this in
     * every branch — hit, miss, rate-limited, mail failure — is what prevents
     * account enumeration. Do not add a branch that returns anything else.
     */
    function password_reset_generic_ok(): void
    {
        json_response([
            'success' => true,
            'message' => 'If that email is registered, a reset link has been sent.',
        ]);
    }
}

if (!function_exists('password_reset_base_url')) {
    /**
     * The public base URL used to build the reset link. Read from the environment
     * with NO fallback — a localhost link baked into a production email was one of
     * the original functions/index.js defects, so a missing value throws.
     *
     * @throws RuntimeException when APP_BASE_URL is unset.
     */
    function password_reset_base_url(): string
    {
        $base = getenv('APP_BASE_URL');
        if ($base === false || trim((string) $base) === '') {
            throw new RuntimeException('Missing required environment variable: APP_BASE_URL.');
        }
        return rtrim((string) $base, '/');
    }
}

if (!function_exists('request_password_reset')) {
    /**
     * POST ?action=password.reset.request  body {email}
     * Unauthenticated. Always returns password_reset_generic_ok().
     */
    function request_password_reset(): void
    {
        $body = read_json_body();
        $email = strtolower(trim((string) ($body['email'] ?? '')));

        // A malformed address can't belong to anyone — same generic response, no work.
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            password_reset_generic_ok();
        }

        $pdo = getDbConnection();

        $userStmt = $pdo->prepare('SELECT uid, email, fullName FROM users WHERE email = :email LIMIT 1');
        $userStmt->execute([':email' => $email]);
        $user = $userStmt->fetch();

        // Unknown email: return the identical success shape and send nothing.
        if ($user === false) {
            password_reset_generic_ok();
        }

        $uid = (string) $user['uid'];

        // Rate limit: at most 3 reset requests per user per 15 minutes. Without
        // this the endpoint is a mail bomb aimed at a member's inbox and at the
        // sending domain's reputation. A throttled caller gets the same 200.
        $recentStmt = $pdo->prepare(
            'SELECT COUNT(*) FROM password_resets '
            . 'WHERE uid = :uid AND createdAt > (NOW() - INTERVAL 15 MINUTE)'
        );
        $recentStmt->execute([':uid' => $uid]);
        if ((int) $recentStmt->fetchColumn() >= 3) {
            password_reset_generic_ok();
        }

        // random_bytes ONLY — a guessable reset token is an account takeover.
        $token = bin2hex(random_bytes(32));
        $tokenHash = hash('sha256', $token);
        $ip = isset($_SERVER['REMOTE_ADDR']) ? substr((string) $_SERVER['REMOTE_ADDR'], 0, 45) : null;

        $pdo->beginTransaction();
        try {
            // Only the newest link works: retire the user's older unused tokens.
            $pdo->prepare(
                'UPDATE password_resets SET usedAt = NOW() WHERE uid = :uid AND usedAt IS NULL'
            )->execute([':uid' => $uid]);

            $pdo->prepare(
                'INSERT INTO password_resets (uid, tokenHash, expiresAt, requestedIp, createdAt) '
                . 'VALUES (:uid, :tokenHash, (NOW() + INTERVAL 1 HOUR), :ip, NOW())'
            )->execute([
                ':uid' => $uid,
                ':tokenHash' => $tokenHash,
                ':ip' => $ip,
            ]);

            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            // A DB failure must not become an enumeration oracle: log and still
            // return the generic success.
            error_log('[password_reset] request failed: ' . $e->getMessage());
            password_reset_generic_ok();
        }

        // Recipient is the STORED address, never the request body.
        $link = password_reset_base_url() . '/reset_password.html?token=' . $token;
        $name = (string) $user['fullName'];
        $subject = 'Reset your Bank Nkhonde password';
        $text = "Hello {$name},\n\n"
            . "We received a request to reset your Bank Nkhonde password.\n"
            . "Open this link to choose a new password (it expires in 1 hour):\n\n"
            . "{$link}\n\n"
            . "If you did not request this, you can ignore this email — your password will not change.";
        $safeName = htmlspecialchars($name, ENT_QUOTES, 'UTF-8');
        $safeLink = htmlspecialchars($link, ENT_QUOTES, 'UTF-8');
        $html = "<p>Hello {$safeName},</p>"
            . '<p>We received a request to reset your Bank Nkhonde password. '
            . 'Click the link below to choose a new password (it expires in 1 hour):</p>'
            . "<p><a href=\"{$safeLink}\">Reset my password</a></p>"
            . '<p>If you did not request this, you can ignore this email — your password will not change.</p>';

        try {
            send_mail((string) $user['email'], $name, $subject, $text, $html);
        } catch (Throwable $e) {
            // An SMTP failure must not reveal that the address exists — log, return generic.
            error_log('[password_reset] send failed: ' . $e->getMessage());
        }

        password_reset_generic_ok();
    }
}

if (!function_exists('perform_password_reset')) {
    /**
     * POST ?action=password.reset.perform  body {token, password}
     * Unauthenticated. Consumes a token and sets a new password.
     */
    function perform_password_reset(): void
    {
        $body = read_json_body();
        $token = (string) ($body['token'] ?? '');
        $password = (string) ($body['password'] ?? '');

        if (strlen($password) < 8) {
            json_error('Password must be at least 8 characters.', 422);
        }

        // One generic error for every failure mode below — each distinction would
        // be an oracle (does this token exist? is it expired? already used?).
        $genericInvalid = 'This reset link is invalid or has expired.';

        if ($token === '') {
            json_error($genericInvalid, 400);
        }

        $tokenHash = hash('sha256', $token);
        $pdo = getDbConnection();

        $stmt = $pdo->prepare(
            'SELECT resetId, uid FROM password_resets '
            . 'WHERE tokenHash = :tokenHash AND usedAt IS NULL AND expiresAt > NOW() LIMIT 1'
        );
        $stmt->execute([':tokenHash' => $tokenHash]);
        $row = $stmt->fetch();

        if ($row === false) {
            json_error($genericInvalid, 400);
        }

        $resetId = (int) $row['resetId'];
        $uid = (string) $row['uid'];

        $pdo->beginTransaction();
        try {
            // Spend THIS token first, guarded so a concurrent double-redeem loses.
            $spend = $pdo->prepare(
                'UPDATE password_resets SET usedAt = NOW() WHERE resetId = :resetId AND usedAt IS NULL'
            );
            $spend->execute([':resetId' => $resetId]);
            if ($spend->rowCount() !== 1) {
                $pdo->rollBack();
                json_error($genericInvalid, 400);
            }

            // Argon2id via the existing helper — never reimplement hashing.
            $pdo->prepare(
                'UPDATE users SET passwordHash = :hash, updatedAt = NOW() WHERE uid = :uid'
            )->execute([
                ':hash' => hash_password($password),
                ':uid' => $uid,
            ]);

            // Retire every other outstanding token for this user.
            $pdo->prepare(
                'UPDATE password_resets SET usedAt = NOW() '
                . 'WHERE uid = :uid AND usedAt IS NULL AND resetId <> :resetId'
            )->execute([':uid' => $uid, ':resetId' => $resetId]);

            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            error_log('[password_reset] perform failed: ' . $e->getMessage());
            json_error('An unexpected error occurred.', 500);
        }

        // Deliberately do NOT open a session — a link that may have been forwarded
        // or sat in an inbox should not grant one. The user signs in normally.
        json_response(['success' => true]);
    }
}
