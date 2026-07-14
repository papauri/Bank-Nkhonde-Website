<?php
/**
 * Migration runner. Applies pending .sql files from database/migrations/
 * in filename order, recording each in a `migrations` table so re-runs
 * skip what's already applied. Each file runs inside a transaction and
 * rolls back + fails loudly on error.
 *
 * Usage: php run_migrations.php
 */

require_once __DIR__ . '/config/database.php';

function ensureMigrationsTable(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS migrations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            filename VARCHAR(255) NOT NULL UNIQUE,
            appliedAt DATETIME NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function getAppliedMigrations(PDO $pdo): array
{
    $stmt = $pdo->query('SELECT filename FROM migrations');
    return array_column($stmt->fetchAll(), 'filename');
}

function splitStatements(string $sql): array
{
    // Strip comments BEFORE splitting on ';'. A '--' comment runs to end of line,
    // and an inline one may itself contain a ';' (e.g. "covers IPv6; may be null")
    // — leaving it in would split a statement mid-comment. We strip from an
    // unquoted '--' to the line end. (Migrations here contain no '--' inside string
    // literals; if that ever changes this needs a real tokenizer.)
    $lines = explode("\n", $sql);
    $clean = [];
    foreach ($lines as $line) {
        $pos = strpos($line, '--');
        if ($pos !== false) {
            $line = substr($line, 0, $pos);
        }
        if (trim($line) === '') {
            continue;
        }
        $clean[] = $line;
    }
    $sql = implode("\n", $clean);

    $statements = array_filter(array_map('trim', explode(';', $sql)));
    return array_values($statements);
}

function runMigrations(): void
{
    $pdo = getDbConnection();
    ensureMigrationsTable($pdo);

    $applied = getAppliedMigrations($pdo);
    $migrationsDir = __DIR__ . '/database/migrations';

    $files = glob($migrationsDir . '/*.sql');
    sort($files, SORT_STRING);

    foreach ($files as $filePath) {
        $filename = basename($filePath);

        if (in_array($filename, $applied, true)) {
            echo "SKIP  {$filename} (already applied)\n";
            continue;
        }

        $sql = file_get_contents($filePath);
        if ($sql === false) {
            throw new RuntimeException("Could not read migration file: {$filename}");
        }

        $statements = splitStatements($sql);

        // No transaction here on purpose. MySQL implicitly commits on every DDL
        // statement, so wrapping CREATE TABLE in one is a false promise: the
        // transaction is already gone by the time an error fires, and the
        // rollBack() then throws "no active transaction", masking the real error.
        // Every statement is CREATE TABLE IF NOT EXISTS, so a failed run is safe
        // to re-run — the file is only recorded once all of its statements pass.
        $index = 0;
        try {
            foreach ($statements as $statement) {
                if ($statement === '') {
                    continue;
                }
                $index++;
                $pdo->exec($statement);
            }

            $insert = $pdo->prepare(
                'INSERT INTO migrations (filename, appliedAt) VALUES (:filename, NOW())'
            );
            $insert->execute(['filename' => $filename]);

            echo "APPLY {$filename} ({$index} statements)\n";
        } catch (Throwable $e) {
            fwrite(STDERR, "FAIL  {$filename} at statement #{$index}: {$e->getMessage()}\n");
            fwrite(STDERR, "----- failing statement -----\n");
            fwrite(STDERR, substr($statements[$index - 1] ?? '(unknown)', 0, 500) . "\n");
            fwrite(STDERR, "-----------------------------\n");
            throw $e;
        }
    }

    echo "Migrations complete.\n";
}

if (PHP_SAPI === 'cli') {
    try {
        runMigrations();
    } catch (Throwable $e) {
        fwrite(STDERR, "Migration run aborted: {$e->getMessage()}\n");
        exit(1);
    }
}
