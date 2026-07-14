<?php
/**
 * Minimal .env parser. No composer, no dependencies.
 * Reads KEY=VALUE lines from the project-root .env file into getenv()/$_ENV.
 * Lines starting with # are comments; blank lines are skipped.
 * Values may be wrapped in single or double quotes.
 */

if (!function_exists('loadEnv')) {
    function loadEnv(string $path): void
    {
        if (!is_file($path)) {
            return;
        }

        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || strpos($line, '#') === 0) {
                continue;
            }
            if (strpos($line, '=') === false) {
                continue;
            }

            [$key, $value] = explode('=', $line, 2);
            $key = trim($key);
            $value = trim($value);

            $len = strlen($value);
            if ($len >= 2 && (
                ($value[0] === '"' && $value[$len - 1] === '"') ||
                ($value[0] === "'" && $value[$len - 1] === "'")
            )) {
                $value = substr($value, 1, -1);
            }

            if ($key === '') {
                continue;
            }

            putenv("{$key}={$value}");
            $_ENV[$key] = $value;
        }
    }
}

loadEnv(__DIR__ . '/../.env');
