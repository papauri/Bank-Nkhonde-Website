<?php
/**
 * Shared JSON response / error envelope for the API tier.
 * Every endpoint returns JSON through these helpers so the shape is uniform
 * and no internal detail (exception text, SQL, PDO state) ever reaches the wire.
 */

if (!function_exists('json_response')) {
    /**
     * Emit a JSON success/data envelope and stop.
     */
    function json_response(array $data, int $code = 200): void
    {
        if (!headers_sent()) {
            http_response_code($code);
            header('Content-Type: application/json; charset=utf-8');
        }
        echo json_encode(['ok' => true, 'data' => $data]);
        exit;
    }
}

if (!function_exists('json_error')) {
    /**
     * Emit a JSON error envelope and stop. Only the public message is exposed;
     * callers must never pass raw exception or PDO detail here.
     */
    function json_error(string $publicMessage, int $code): void
    {
        if (!headers_sent()) {
            http_response_code($code);
            header('Content-Type: application/json; charset=utf-8');
        }
        echo json_encode(['ok' => false, 'error' => $publicMessage]);
        exit;
    }
}

if (!function_exists('read_json_body')) {
    /**
     * Decode the request body as a JSON object. Returns an empty array when the
     * body is absent or not a JSON object, so handlers can validate fields.
     */
    function read_json_body(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') {
            return [];
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            return [];
        }
        return $decoded;
    }
}
