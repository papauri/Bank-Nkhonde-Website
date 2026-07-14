<?php
/**
 * PDO connection factory for the MySQL data layer.
 * PDO::ERRMODE_EXCEPTION, emulated prepares OFF, utf8mb4 charset.
 * Throws a clear error if any required .env key is missing — no silent
 * defaults for connection credentials.
 */

require_once __DIR__ . '/env.php';

if (!function_exists('getDbConnection')) {
    function getDbConnection(): PDO
    {
        static $pdo = null;

        if ($pdo instanceof PDO) {
            return $pdo;
        }

        $required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
        $config = [];

        foreach ($required as $key) {
            $value = getenv($key);
            if ($value === false || $value === '') {
                throw new RuntimeException(
                    "Missing required environment variable: {$key}. Check your .env file."
                );
            }
            $config[$key] = $value;
        }

        $dsn = sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
            $config['DB_HOST'],
            $config['DB_PORT'],
            $config['DB_NAME']
        );

        $pdo = new PDO($dsn, $config['DB_USER'], $config['DB_PASSWORD'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);

        return $pdo;
    }
}
