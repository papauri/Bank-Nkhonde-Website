<?php
/**
 * Proof-of-payment file upload endpoint.
 *
 * Single-purpose: it STORES an uploaded receipt file and returns its URL. It does
 * NOT attach the file to any payment or repayment row — the client passes the
 * returned url into payments.record / repayments.record as proofOfPaymentImageUrl,
 * and those handlers persist it. Keeping storage and ledger writes separate means
 * this endpoint touches no money and no database.
 *
 * The request is multipart/form-data (field 'file' + form field 'groupId'), so
 * read_json_body() does NOT apply here — $_POST and $_FILES are read directly. The
 * response is still JSON via the shared helpers.
 */

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/session.php';
require_once __DIR__ . '/../lib/uploads.php';

// Any member of the group may attach a proof. Admin-equivalent roles included.
const FILE_ANY_MEMBER_ROLES = ['member', 'admin', 'senior_admin', 'treasurer'];

if (!function_exists('upload_proof')) {
    /**
     * POST action=files.upload (multipart/form-data).
     * Fields: file (the upload), groupId (the group the proof belongs to).
     */
    function upload_proof(): void
    {
        // Cheap early rejection before touching the body: refuse a request whose
        // declared length already blows the cap (plus a small multipart overhead
        // allowance). Real per-file validation happens in store_proof_upload().
        $declaredLength = isset($_SERVER['CONTENT_LENGTH'])
            ? (int) $_SERVER['CONTENT_LENGTH'] : 0;
        if ($declaredLength > UPLOAD_MAX_BYTES + (1024 * 1024)) {
            json_error('The file is too large. Maximum size is 5 MB.', 413);
        }

        require_auth();

        $groupId = isset($_POST['groupId']) ? trim((string) $_POST['groupId']) : '';
        if ($groupId === '') {
            json_error('A group is required.', 422);
        }

        // Server-side gate: the caller must belong to the group they are attaching
        // a proof to. A client-supplied role is never trusted here.
        require_role($groupId, FILE_ANY_MEMBER_ROLES);

        if (!isset($_FILES['file']) || !is_array($_FILES['file'])) {
            json_error('No file was provided.', 422);
        }

        try {
            $stored = store_proof_upload($_FILES['file']);
        } catch (RuntimeException $e) {
            json_error($e->getMessage(), 422);
        }

        json_response([
            'url' => $stored['url'],
            'fileName' => $stored['fileName'],
            'fileSize' => $stored['fileSize'],
            'mime' => $stored['mime'],
        ]);
    }
}
