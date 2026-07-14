<?php
/**
 * Minimal SMTP client over a raw socket. No composer, no vendor/, no dependencies.
 *
 * Implicit TLS only (ssl:// stream, port 465) — not STARTTLS. Certificate
 * verification stays ON: an unverified peer means anyone who can MITM the
 * connection collects the SMTP password on the AUTH LOGIN line.
 *
 * Every SMTP_* value comes from .env via config/env.php. There is deliberately
 * NO default and NO fallback literal for any of them: a hardcoded credential is
 * exactly what had to be ripped out of functions/index.js. Missing config throws.
 */

require_once __DIR__ . '/../../config/env.php';

if (!function_exists('smtp_config')) {
    /**
     * Read the SMTP settings from the environment.
     *
     * @return array<string,string>
     * @throws RuntimeException when any required key is absent or empty.
     */
    function smtp_config(): array
    {
        $required = [
            'SMTP_HOST',
            'SMTP_PORT',
            'SMTP_SECURE',
            'SMTP_USER',
            'SMTP_PASSWORD',
            'SMTP_FROM',
            'SMTP_FROM_NAME',
        ];

        $config = [];
        foreach ($required as $key) {
            $value = getenv($key);
            if ($value === false || $value === '') {
                // Name the key so the operator can fix it — but never echo a value.
                throw new RuntimeException(
                    "Missing required environment variable: {$key}. Check your .env file."
                );
            }
            $config[$key] = (string) $value;
        }

        return $config;
    }
}

if (!function_exists('smtp_strip_header_breaks')) {
    /**
     * HEADER INJECTION GUARD.
     *
     * Strip CR and LF (and NUL) from any value that is about to be interpolated
     * into a mail header. An unsanitised newline in To/Name/Subject lets an
     * attacker append their own headers — "Bcc: everyone@..." — and turn this
     * function into an open spam relay. Mandatory on every header value.
     */
    function smtp_strip_header_breaks(string $value): string
    {
        return trim(str_replace(["\r", "\n", "\0"], '', $value));
    }
}

if (!function_exists('smtp_expect')) {
    /**
     * Read a (possibly multi-line) SMTP reply and assert the code is 2xx or 3xx.
     *
     * @throws RuntimeException on a timeout, a closed socket, or a 4xx/5xx reply.
     */
    function smtp_expect($socket, string $stage): string
    {
        $reply = '';

        while (($line = fgets($socket, 1024)) !== false) {
            $reply .= $line;
            // Multi-line replies look like "250-XXX"; the final one is "250 XXX".
            if (strlen($line) < 4 || $line[3] !== '-') {
                break;
            }
        }

        if ($reply === '') {
            throw new RuntimeException("SMTP {$stage}: no reply from server.");
        }

        $code = (int) substr($reply, 0, 3);
        if ($code < 200 || $code >= 400) {
            throw new RuntimeException("SMTP {$stage}: server replied " . trim($reply));
        }

        return $reply;
    }
}

if (!function_exists('smtp_send_line')) {
    function smtp_send_line($socket, string $line): void
    {
        if (fwrite($socket, $line . "\r\n") === false) {
            throw new RuntimeException('SMTP: failed to write to socket.');
        }
    }
}

if (!function_exists('send_mail')) {
    /**
     * Send one multipart/alternative message.
     *
     * The caller is responsible for deriving $toEmail server-side. Never pass a
     * recipient straight from a request body — that is an open relay.
     *
     * @throws RuntimeException on any config, socket or SMTP-protocol failure.
     */
    function send_mail(
        string $toEmail,
        string $toName,
        string $subject,
        string $textBody,
        string $htmlBody
    ): void {
        $config = smtp_config();

        // Sanitise everything that lands in a header, before it lands in a header.
        $toEmail = smtp_strip_header_breaks($toEmail);
        $toName = smtp_strip_header_breaks($toName);
        $subject = smtp_strip_header_breaks($subject);
        $fromEmail = smtp_strip_header_breaks($config['SMTP_FROM']);
        $fromName = smtp_strip_header_breaks($config['SMTP_FROM_NAME']);

        if ($toEmail === '' || !filter_var($toEmail, FILTER_VALIDATE_EMAIL)) {
            throw new RuntimeException('send_mail: recipient is not a valid email address.');
        }

        $scheme = strtolower($config['SMTP_SECURE']) === 'ssl' ? 'ssl' : 'tcp';
        $endpoint = sprintf('%s://%s:%d', $scheme, $config['SMTP_HOST'], (int) $config['SMTP_PORT']);

        // verify_peer stays TRUE. Disabling it would hand the SMTP password to any MITM.
        $context = stream_context_create([
            'ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
                'allow_self_signed' => false,
            ],
        ]);

        $errno = 0;
        $errstr = '';
        $socket = @stream_socket_client(
            $endpoint,
            $errno,
            $errstr,
            30,
            STREAM_CLIENT_CONNECT,
            $context
        );

        if ($socket === false) {
            throw new RuntimeException("SMTP connect failed ({$errno}): {$errstr}");
        }

        stream_set_timeout($socket, 30);

        try {
            smtp_expect($socket, 'greeting');

            $helo = $config['SMTP_HOST'];
            smtp_send_line($socket, 'EHLO ' . $helo);
            smtp_expect($socket, 'EHLO');

            // AUTH LOGIN: username then password, each base64, each its own line.
            smtp_send_line($socket, 'AUTH LOGIN');
            smtp_expect($socket, 'AUTH LOGIN');

            smtp_send_line($socket, base64_encode($config['SMTP_USER']));
            smtp_expect($socket, 'AUTH username');

            smtp_send_line($socket, base64_encode($config['SMTP_PASSWORD']));
            // Never log, echo or include the password in any message — only the code.
            smtp_expect($socket, 'AUTH password');

            smtp_send_line($socket, 'MAIL FROM:<' . $fromEmail . '>');
            smtp_expect($socket, 'MAIL FROM');

            smtp_send_line($socket, 'RCPT TO:<' . $toEmail . '>');
            smtp_expect($socket, 'RCPT TO');

            smtp_send_line($socket, 'DATA');
            smtp_expect($socket, 'DATA');

            $boundary = 'bn_' . bin2hex(random_bytes(16));
            $to = $toName === '' ? $toEmail : sprintf('%s <%s>', $toName, $toEmail);
            $from = sprintf('%s <%s>', $fromName, $fromEmail);

            $headers = [
                'Date: ' . date('r'),
                'From: ' . $from,
                'To: ' . $to,
                'Subject: ' . $subject,
                'MIME-Version: 1.0',
                'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
            ];

            $body = implode("\r\n", $headers) . "\r\n\r\n"
                . '--' . $boundary . "\r\n"
                . "Content-Type: text/plain; charset=utf-8\r\n"
                . "Content-Transfer-Encoding: 8bit\r\n\r\n"
                . $textBody . "\r\n\r\n"
                . '--' . $boundary . "\r\n"
                . "Content-Type: text/html; charset=utf-8\r\n"
                . "Content-Transfer-Encoding: 8bit\r\n\r\n"
                . $htmlBody . "\r\n\r\n"
                . '--' . $boundary . "--\r\n";

            // Dot-stuffing: a line that is just "." would otherwise end DATA early.
            $body = preg_replace('/^\./m', '..', str_replace("\n", "\r\n", str_replace("\r\n", "\n", $body)));

            smtp_send_line($socket, $body . "\r\n.");
            smtp_expect($socket, 'end of DATA');

            smtp_send_line($socket, 'QUIT');
        } finally {
            // Close the socket even when the protocol exchange threw.
            @fclose($socket);
        }
    }
}
