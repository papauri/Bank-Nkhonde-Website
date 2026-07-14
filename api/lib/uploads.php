<?php
/**
 * Proof-of-payment file storage and validation.
 *
 * These are untrusted files uploaded by members as receipt evidence. They land
 * in a PUBLIC directory (uploads/proofs/) served directly by the web server, so
 * this layer is the ONLY line of defence and treats every input as hostile:
 *
 *   - The stored filename is ALWAYS server-generated random hex plus a whitelisted
 *     extension derived from the SNIFFED mime. No byte of the client-supplied name
 *     ever reaches the filesystem path — path traversal, overwrite, and
 *     double-extension attacks all die at that point.
 *   - The real mime is sniffed with finfo; $_FILES['type'] and the client
 *     extension are advisory only and are never trusted for validation.
 *   - is_uploaded_file + move_uploaded_file only — never fopen/rename/copy on the
 *     tmp path, so a caller cannot smuggle an arbitrary server path through.
 *
 * Privacy of the URL rests on the filename being unguessable (128 bits of
 * randomness); the directory itself is hardened against execution and listing by
 * uploads/proofs/.htaccess.
 */

if (!defined('UPLOAD_MAX_BYTES')) {
    define('UPLOAD_MAX_BYTES', 5 * 1024 * 1024); // 5 MB
}

if (!function_exists('upload_allowed_types')) {
    /**
     * Whitelist: sniffed mime => stored extension. The authority for what may be
     * stored and what extension it gets. Anything not a key here is rejected.
     */
    function upload_allowed_types(): array
    {
        return [
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
            'application/pdf' => 'pdf',
        ];
    }
}

if (!function_exists('upload_proofs_dir')) {
    /**
     * Absolute filesystem path to uploads/proofs/, resolved from this file's
     * location (api/lib/ -> repo root -> uploads/proofs). Created 0755 if absent.
     */
    function upload_proofs_dir(): string
    {
        $dir = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'uploads'
            . DIRECTORY_SEPARATOR . 'proofs';

        if (!is_dir($dir)) {
            if (!mkdir($dir, 0755, true) && !is_dir($dir)) {
                throw new RuntimeException('Upload storage is unavailable.');
            }
        }

        return $dir;
    }
}

if (!function_exists('store_proof_upload')) {
    /**
     * Validate and store one $_FILES entry. Returns
     * ['url', 'path', 'fileName', 'fileSize', 'mime'] on success, or throws a
     * RuntimeException with a client-safe message on any failure.
     *
     * @param array $file One entry from $_FILES (e.g. $_FILES['file']).
     */
    function store_proof_upload(array $file): array
    {
        $allowed = upload_allowed_types();

        // 1. A genuine, error-free HTTP upload. is_uploaded_file() defeats any
        //    attempt to pass an arbitrary server path as tmp_name.
        if (!isset($file['error']) || $file['error'] !== UPLOAD_ERR_OK) {
            throw new RuntimeException('File upload failed. Please try again.');
        }
        if (empty($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
            throw new RuntimeException('Invalid upload.');
        }

        // 2. Size bounds. Zero-byte files and oversize files are both rejected.
        $size = isset($file['size']) ? (int) $file['size'] : 0;
        if ($size <= 0) {
            throw new RuntimeException('The file is empty.');
        }
        if ($size > UPLOAD_MAX_BYTES) {
            throw new RuntimeException('The file is too large. Maximum size is 5 MB.');
        }
        // Guard against a spoofed $_FILES['size'] by measuring the real file too.
        $realSize = filesize($file['tmp_name']);
        if ($realSize === false || $realSize <= 0 || $realSize > UPLOAD_MAX_BYTES) {
            throw new RuntimeException('The file is too large. Maximum size is 5 MB.');
        }

        // 3. Sniff the REAL mime. The client's declared type and filename
        //    extension are ignored — a .php renamed to .jpg is caught right here,
        //    because finfo reports its true type (e.g. text/x-php), which is not a
        //    whitelist key.
        // Fail CLOSED if the fileinfo extension is missing: without a real mime
        // sniff we cannot safely accept an upload, so we reject rather than fall
        // back to the (spoofable) client-declared type. (cPanel has fileinfo on
        // by default; this guard turns a fatal into a clean, logged rejection.)
        if (!function_exists('finfo_open')) {
            throw new RuntimeException('File verification is unavailable on the server.');
        }
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        if ($finfo === false) {
            throw new RuntimeException('Could not verify the file.');
        }
        $mime = finfo_file($finfo, $file['tmp_name']);
        finfo_close($finfo);

        if (!is_string($mime) || !isset($allowed[$mime])) {
            throw new RuntimeException('Unsupported file type. Upload a JPG, PNG, WebP, or PDF.');
        }

        // 4. For images, the bytes must actually parse as that image and the
        //    detected image type must agree with the sniffed mime. A text file
        //    that somehow reads as image/png but cannot be decoded is not an image.
        if ($mime !== 'application/pdf') {
            $info = @getimagesize($file['tmp_name']);
            if ($info === false || empty($info['mime']) || $info['mime'] !== $mime) {
                throw new RuntimeException('The image could not be read.');
            }
        }

        // 5. WE generate the name: 128 bits of randomness + a whitelist-derived
        //    extension. No part of the client filename is ever used on disk.
        $ext = $allowed[$mime];
        $storedName = bin2hex(random_bytes(16)) . '.' . $ext;

        // 6. Move into uploads/proofs/ with move_uploaded_file() only.
        $dir = upload_proofs_dir();
        $destination = $dir . DIRECTORY_SEPARATOR . $storedName;

        if (!move_uploaded_file($file['tmp_name'], $destination)) {
            throw new RuntimeException('Could not save the file. Please try again.');
        }

        // Defence in depth: the final realpath MUST be inside the proofs dir.
        $realDir = realpath($dir);
        $realDest = realpath($destination);
        if ($realDir === false || $realDest === false
            || strpos($realDest, $realDir . DIRECTORY_SEPARATOR) !== 0) {
            @unlink($destination);
            throw new RuntimeException('Could not save the file. Please try again.');
        }

        return [
            // 7. Web path is served directly; fs path is for later deletion.
            'url' => '/uploads/proofs/' . $storedName,
            'path' => $realDest,
            // Display-only echo of the original name: basename() strips any path,
            // control chars are removed. Never used on disk.
            'fileName' => upload_safe_display_name($file['name'] ?? $storedName),
            'fileSize' => (int) $realSize,
            'mime' => $mime,
        ];
    }
}

if (!function_exists('upload_safe_display_name')) {
    /**
     * Sanitise a client-supplied filename for DISPLAY only: strip any directory
     * component and control characters. The result is never used as a filesystem
     * path — it exists so a member sees "receipt.jpg" rather than random hex.
     */
    function upload_safe_display_name(string $name): string
    {
        $name = basename($name);
        $name = preg_replace('/[\x00-\x1F\x7F]/u', '', $name);
        $name = trim((string) $name);
        if ($name === '') {
            return 'upload';
        }
        if (strlen($name) > 120) {
            $name = substr($name, 0, 120);
        }
        return $name;
    }
}

if (!function_exists('delete_proof_upload')) {
    /**
     * Unlink a previously stored proof file, but ONLY if its realpath resolves
     * inside uploads/proofs/. Nothing outside that directory can ever be deleted
     * through this function. No-op when the file is already gone.
     */
    function delete_proof_upload(string $storedPath): void
    {
        if ($storedPath === '') {
            return;
        }

        $real = realpath($storedPath);
        if ($real === false) {
            return; // Already absent — nothing to do.
        }

        $realDir = realpath(dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'uploads'
            . DIRECTORY_SEPARATOR . 'proofs');
        if ($realDir === false) {
            return;
        }

        // Must be strictly inside the proofs directory.
        if (strpos($real, $realDir . DIRECTORY_SEPARATOR) !== 0) {
            return;
        }

        if (is_file($real)) {
            @unlink($real);
        }
    }
}
