<?php
/**
 * The signed-in user's OWN account: read the profile, update it, change password.
 *
 * Every function here operates on the SESSION user and nothing else. There is no
 * uid parameter anywhere in this file — not as a body key, not as a query param —
 * so there is structurally no way to read or modify another person's account
 * through it. (Admin edits of a MEMBER's group row live in members.php and are
 * role-gated there; this file is "my account", full stop.)
 *
 * The password hash is never returned, and a password change requires the CURRENT
 * password: a hijacked session must not be able to lock the real owner out.
 */

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/session.php';
require_once __DIR__ . '/../lib/password.php';
require_once __DIR__ . '/../../config/database.php';

// Base columns that always exist (pre-KYC migration).
const PROFILE_BASE_COLUMNS = 'uid, email, fullName, phone, whatsappNumber, '
    . 'profileImageUrl, dateOfBirth, address, nationality, occupation, '
    . 'emailVerified, createdAt, updatedAt';

// KYC columns added by migration 011. If the migration hasn't run yet,
// we fall back to base columns only — the profile still works, just without
// the optional KYC fields.
const PROFILE_KYC_COLUMNS = 'guarantorName, guarantorPhone, guarantorRelationship, guarantorAddress, '
    . 'collateralDescription, idType, idNumber, nextOfKinName, nextOfKinPhone, '
    . 'nextOfKinRelationship';

if (!function_exists('profile_select_row')) {
    function profile_select_row(PDO $pdo, string $uid): ?array
    {
        // Try with full columns first (including KYC). If the KYC migration
        // hasn't been applied, fall back to base columns only.
        try {
            $stmt = $pdo->prepare(
                'SELECT ' . PROFILE_BASE_COLUMNS . ', ' . PROFILE_KYC_COLUMNS
                . ' FROM users WHERE uid = :uid LIMIT 1'
            );
            $stmt->execute([':uid' => $uid]);
            $row = $stmt->fetch();
            return $row === false ? null : $row;
        } catch (PDOException $e) {
            // If the error is about unknown KYC columns, retry without them.
            // Any other error is re-thrown to be caught by the top-level handler.
            if (stripos($e->getMessage(), 'Unknown column') !== false) {
                $stmt = $pdo->prepare(
                    'SELECT ' . PROFILE_BASE_COLUMNS . ' FROM users WHERE uid = :uid LIMIT 1'
                );
                $stmt->execute([':uid' => $uid]);
                $row = $stmt->fetch();
                return $row === false ? null : $row;
            }
            throw $e;
        }
    }
}

if (!function_exists('profile_optional_text')) {
    /** An empty optional field is stored as NULL, not as an empty string. */
    function profile_optional_text($value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $value = trim($value);

        return $value === '' ? null : $value;
    }
}

if (!function_exists('profile_has_kyc_columns')) {
    /**
     * Check whether migration 011 (KYC columns) has been applied.
     * Result is cached per-request to avoid repeated information_schema queries.
     */
    function profile_has_kyc_columns(PDO $pdo): bool
    {
        static $checked = null;
        if ($checked !== null) {
            return $checked;
        }
        try {
            $stmt = $pdo->prepare(
                "SELECT COUNT(*) AS n FROM information_schema.COLUMNS "
                . "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' "
                . "AND COLUMN_NAME = 'guarantorName'"
            );
            $stmt->execute();
            $checked = (int) $stmt->fetch()['n'] > 0;
        } catch (PDOException $e) {
            $checked = false;
        }
        return $checked;
    }
}

if (!function_exists('get_profile')) {
    /**
     * GET profile.get — the caller's own account. Any signed-in user.
     */
    function get_profile(): void
    {
        $user = require_auth();

        $pdo = getDbConnection();
        $profile = profile_select_row($pdo, (string) $user['uid']);

        if ($profile === null) {
            json_error('Profile not found.', 404);
        }

        json_response($profile);
    }
}

if (!function_exists('update_profile')) {
    /**
     * POST profile.update — edit the caller's own account.
     *
     * The SET clause is assembled from a hardcoded whitelist of literal column
     * fragments; no client key ever reaches the SQL. Deliberately NOT updatable
     * here: `email` (it is the login identity and the password-reset recipient —
     * changing it needs a verification flow that does not exist yet), `uid`,
     * `emailVerified`, and `passwordHash` (see change_password).
     */
    function update_profile(): void
    {
        $user = require_auth();
        $body = read_json_body();

        $updates = [];
        $params = [':uid' => (string) $user['uid']];

        if (array_key_exists('fullName', $body)) {
            $fullName = trim((string) $body['fullName']);
            if ($fullName === '') {
                json_error('Full name cannot be empty.', 422);
            }
            $updates[] = 'fullName = :fullName';
            $params[':fullName'] = $fullName;
        }

        // Base contact fields (always exist in the schema).
        $baseFields = ['phone', 'whatsappNumber', 'address', 'nationality', 'occupation'];

        foreach ($baseFields as $field) {
            if (array_key_exists($field, $body)) {
                $updates[] = "{$field} = :{$field}";
                $params[":{$field}"] = profile_optional_text($body[$field]);
            }
        }

        // Optional KYC fields (guarantor, collateral, ID, next-of-kin): never
        // required, blank/absent is stored as NULL — see profile_optional_text().
        // These require migration 011; if it hasn't been applied, we skip them.
        $kycFields = [
            'guarantorName', 'guarantorPhone', 'guarantorRelationship', 'guarantorAddress',
            'collateralDescription', 'idType', 'idNumber',
            'nextOfKinName', 'nextOfKinPhone', 'nextOfKinRelationship',
        ];

        $pdo = getDbConnection();
        $hasKycColumns = profile_has_kyc_columns($pdo);
        foreach ($kycFields as $field) {
            if ($hasKycColumns && array_key_exists($field, $body)) {
                $updates[] = "{$field} = :{$field}";
                $params[":{$field}"] = profile_optional_text($body[$field]);
            }
        }

        if (array_key_exists('dateOfBirth', $body)) {
            $dob = profile_optional_text($body['dateOfBirth']);
            if ($dob !== null) {
                $parsed = DateTimeImmutable::createFromFormat('Y-m-d', $dob);
                if ($parsed === false) {
                    json_error('Date of birth must be a valid date (YYYY-MM-DD).', 422);
                }
                $dob = $parsed->format('Y-m-d H:i:s');
            }
            $updates[] = 'dateOfBirth = :dateOfBirth';
            $params[':dateOfBirth'] = $dob;
        }

        if (array_key_exists('profileImageUrl', $body)) {
            $url = trim((string) $body['profileImageUrl']);
            // Only a path this server minted (files.upload returns /uploads/...).
            // An arbitrary absolute URL would let a profile image beacon out to,
            // or be swapped by, a third-party host.
            if ($url !== '' && strpos($url, '/uploads/') !== 0) {
                json_error('A profile image must be a file uploaded to this site.', 422);
            }
            $updates[] = 'profileImageUrl = :profileImageUrl';
            $params[':profileImageUrl'] = $url === '' ? null : $url;
        }

        if (empty($updates)) {
            json_error('No updatable fields provided.', 422);
        }

        $updates[] = 'updatedAt = NOW()';

        // The `members` table denormalises fullName/phone/whatsappNumber/
        // profileImageUrl per group membership row (database/migrations/001).
        // Only the columns actually present in this request are propagated —
        // mirrors the same array_key_exists gating used for `users` above, so a
        // field the caller didn't touch is never blasted with a stale value.
        // `email` is deliberately excluded: it is not updatable via this
        // endpoint at all (see the function docblock).
        $memberUpdates = [];
        $memberParams = [':uid' => (string) $user['uid']];

        if (array_key_exists('fullName', $body)) {
            $memberUpdates[] = 'fullName = :fullName';
            $memberParams[':fullName'] = $params[':fullName'];
        }
        if (array_key_exists('phone', $body)) {
            $memberUpdates[] = 'phone = :phone';
            $memberParams[':phone'] = $params[':phone'];
        }
        if (array_key_exists('whatsappNumber', $body)) {
            $memberUpdates[] = 'whatsappNumber = :whatsappNumber';
            $memberParams[':whatsappNumber'] = $params[':whatsappNumber'];
        }
        if (array_key_exists('profileImageUrl', $body)) {
            $memberUpdates[] = 'profileImageUrl = :profileImageUrl';
            $memberParams[':profileImageUrl'] = $params[':profileImageUrl'];
        }

        $pdo->beginTransaction();
        try {
            $sql = 'UPDATE users SET ' . implode(', ', $updates) . ' WHERE uid = :uid';
            $pdo->prepare($sql)->execute($params);

            if (!empty($memberUpdates)) {
                $memberSql = 'UPDATE members SET ' . implode(', ', $memberUpdates) . ' WHERE uid = :uid';
                $pdo->prepare($memberSql)->execute($memberParams);
            }

            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        json_response(profile_select_row($pdo, (string) $user['uid']));
    }
}

if (!function_exists('change_password')) {
    /**
     * POST profile.password — change the caller's own password.
     *
     * The CURRENT password is required. This is the equivalent of Firebase's
     * reauthenticateWithCredential(): possession of a live session is not enough
     * to change the credential, otherwise anyone who walked up to an unlocked
     * phone (or stole a session cookie) could lock the real owner out of their
     * money. A wrong current password is a 403, and it is the same generic 403
     * whether or not the account has a hash set — no probing.
     */
    function change_password(): void
    {
        $user = require_auth();
        $body = read_json_body();

        $currentPassword = (string) ($body['currentPassword'] ?? '');
        $newPassword = (string) ($body['newPassword'] ?? '');

        if ($currentPassword === '') {
            json_error('Your current password is required.', 422);
        }
        if (strlen($newPassword) < 8) {
            json_error('The new password must be at least 8 characters.', 422);
        }
        if ($newPassword === $currentPassword) {
            json_error('The new password must be different from the current one.', 422);
        }

        $pdo = getDbConnection();

        $stmt = $pdo->prepare('SELECT passwordHash FROM users WHERE uid = :uid LIMIT 1');
        $stmt->execute([':uid' => (string) $user['uid']]);
        $row = $stmt->fetch();

        if ($row === false || !is_string($row['passwordHash']) || $row['passwordHash'] === '') {
            json_error('Your current password is incorrect.', 403);
        }

        if (!verify_password($currentPassword, (string) $row['passwordHash'])) {
            json_error('Your current password is incorrect.', 403);
        }

        $pdo->prepare('UPDATE users SET passwordHash = :hash, updatedAt = NOW() WHERE uid = :uid')
            ->execute([
                ':hash' => hash_password($newPassword),
                ':uid' => (string) $user['uid'],
            ]);

        json_response(['success' => true]);
    }
}
