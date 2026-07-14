<?php
/**
 * Password hashing helpers. Argon2id where the runtime supports it, otherwise
 * the platform default. Plaintext passwords are never stored anywhere.
 */

if (!function_exists('hash_password')) {
    function hash_password(string $plain): string
    {
        $algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
        return password_hash($plain, $algo);
    }
}

if (!function_exists('verify_password')) {
    function verify_password(string $plain, string $hash): bool
    {
        return password_verify($plain, $hash);
    }
}
