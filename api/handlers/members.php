<?php
/**
 * Member endpoints: list roster, add member, change role, change status.
 * Every group-scoped action re-checks the caller's role server-side via
 * require_role() against the members table — a client-supplied role is never
 * trusted. All queries are prepared statements.
 */

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/session.php';
require_once __DIR__ . '/../lib/membership.php';
require_once __DIR__ . '/../../config/database.php';

if (!function_exists('list_members')) {
    function list_members(): void
    {
        $groupId = (string) ($_GET['groupId'] ?? '');
        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }

        $caller = require_role($groupId, ['member', 'admin', 'senior_admin', 'treasurer']);
        $canViewKyc = in_array($caller['role'], ['admin', 'senior_admin', 'treasurer'], true);

        $pdo = getDbConnection();
        if ($canViewKyc) {
            // Try with KYC columns first; if migration 011 hasn't run, fall back.
            try {
                $stmt = $pdo->prepare(
                    'SELECT members.groupId, members.uid, members.fullName, members.email, members.phone, '
                    . 'members.whatsappNumber, members.profileImageUrl, members.role, members.status, '
                    . 'members.joinedAt, members.invitedBy, members.seedMoneyPaid, '
                    . 'members.monthlyContributionsCurrent, members.eligibleForLoan, members.createdAt, '
                    . 'members.updatedAt, users.guarantorName, users.guarantorPhone, '
                    . 'users.guarantorRelationship, users.guarantorAddress, users.collateralDescription, '
                    . 'users.idType, users.idNumber, users.nextOfKinName, users.nextOfKinPhone, '
                    . 'users.nextOfKinRelationship '
                    . 'FROM members JOIN users ON members.uid = users.uid '
                    . 'WHERE members.groupId = :groupId ORDER BY members.joinedAt ASC'
                );
                $stmt->execute([':groupId' => $groupId]);
                $members = $stmt->fetchAll();
            } catch (PDOException $e) {
                if (stripos($e->getMessage(), 'Unknown column') !== false) {
                    // KYC migration not applied — retry without KYC columns
                    $stmt = $pdo->prepare(
                        'SELECT members.groupId, members.uid, members.fullName, members.email, members.phone, '
                        . 'members.whatsappNumber, members.profileImageUrl, members.role, members.status, '
                        . 'members.joinedAt, members.invitedBy, members.seedMoneyPaid, '
                        . 'members.monthlyContributionsCurrent, members.eligibleForLoan, members.createdAt, '
                        . 'members.updatedAt '
                        . 'FROM members JOIN users ON members.uid = users.uid '
                        . 'WHERE members.groupId = :groupId ORDER BY members.joinedAt ASC'
                    );
                    $stmt->execute([':groupId' => $groupId]);
                    $members = $stmt->fetchAll();
                } else {
                    throw $e;
                }
            }
        } else {
            $stmt = $pdo->prepare(
                'SELECT groupId, uid, fullName, email, phone, whatsappNumber, profileImageUrl, '
                . 'role, status, joinedAt, invitedBy, seedMoneyPaid, monthlyContributionsCurrent, '
                . 'eligibleForLoan, createdAt, updatedAt '
                . 'FROM members WHERE groupId = :groupId ORDER BY joinedAt ASC'
            );
            $stmt->execute([':groupId' => $groupId]);
            $members = $stmt->fetchAll();
        }

        json_response(['members' => $members]);
    }
}

if (!function_exists('add_member')) {
    function add_member(): void
    {
        $body = read_json_body();
        $groupId = (string) ($body['groupId'] ?? '');
        $email = trim((string) ($body['email'] ?? ''));

        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }
        if ($email === '') {
            json_error('email is required.', 422);
        }

        $caller = require_role($groupId, ['admin', 'senior_admin', 'treasurer']);

        $pdo = getDbConnection();

        // Look up the invited user's profile — never trust client-supplied
        // fullName/email for the denormalised member fields.
        $userStmt = $pdo->prepare('SELECT uid, email, fullName FROM users WHERE email = :email LIMIT 1');
        $userStmt->execute([':email' => $email]);
        $userRow = $userStmt->fetch();

        if ($userRow === false) {
            json_error('No user with that email.', 404);
        }

        $existsStmt = $pdo->prepare(
            'SELECT 1 FROM members WHERE groupId = :groupId AND uid = :uid LIMIT 1'
        );
        $existsStmt->execute([':groupId' => $groupId, ':uid' => $userRow['uid']]);
        if ($existsStmt->fetch() !== false) {
            json_error('This user is already a member of the group.', 409);
        }

        // Money Masters rulebook: a group is capped at 30 members. Checked after
        // the duplicate guard so re-adding an existing member reports "already a
        // member", not "group full".
        assert_group_has_capacity($pdo, $groupId);

        try {
            $insertStmt = $pdo->prepare(
                'INSERT INTO members '
                . '(groupId, uid, fullName, email, role, status, joinedAt, invitedBy, '
                . 'seedMoneyPaid, monthlyContributionsCurrent, eligibleForLoan, createdAt, updatedAt) '
                . 'VALUES (:groupId, :uid, :fullName, :email, :role, :status, NOW(), :invitedBy, '
                . ':seedMoneyPaid, :monthlyContributionsCurrent, :eligibleForLoan, NOW(), NOW())'
            );
            $insertStmt->execute([
                ':groupId' => $groupId,
                ':uid' => $userRow['uid'],
                ':fullName' => $userRow['fullName'],
                ':email' => $userRow['email'],
                ':role' => 'member',
                ':status' => 'active',
                ':invitedBy' => $caller['uid'],
                ':seedMoneyPaid' => 0,
                ':monthlyContributionsCurrent' => 0,
                ':eligibleForLoan' => 0,
            ]);
        } catch (PDOException $e) {
            // 1062 = ER_DUP_ENTRY. The (groupId, uid) PK is the authority — the
            // earlier existence check is best-effort under concurrency.
            if ((int) $e->errorInfo[1] === 1062) {
                json_error('This user is already a member of the group.', 409);
            }
            throw $e;
        }

        $selectStmt = $pdo->prepare(
            'SELECT groupId, uid, fullName, email, phone, whatsappNumber, profileImageUrl, '
            . 'role, status, joinedAt, invitedBy, seedMoneyPaid, monthlyContributionsCurrent, '
            . 'eligibleForLoan, createdAt, updatedAt '
            . 'FROM members WHERE groupId = :groupId AND uid = :uid LIMIT 1'
        );
        $selectStmt->execute([':groupId' => $groupId, ':uid' => $userRow['uid']]);
        $member = $selectStmt->fetch();

        json_response($member, 201);
    }
}

if (!function_exists('change_member_role')) {
    function change_member_role(): void
    {
        $body = read_json_body();
        $groupId = (string) ($body['groupId'] ?? '');
        $uid = (string) ($body['uid'] ?? '');
        $role = (string) ($body['role'] ?? '');

        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }
        if ($uid === '') {
            json_error('uid is required.', 422);
        }

        // The set of roles that may be ASSIGNED, not a caller gate. 'treasurer'
        // is assignable (otherwise no group could ever have one); the caller gate
        // below is unchanged.
        $allowedRoles = ['member', 'admin', 'senior_admin', 'treasurer'];
        if (!in_array($role, $allowedRoles, true)) {
            json_error('Invalid role value.', 422);
        }

        // Senior-admin ONLY — deliberately excludes admin AND treasurer. Changing
        // roles is how privilege is granted, so it stays at the top privilege.
        require_role($groupId, ['senior_admin']);

        $pdo = getDbConnection();

        $pdo->beginTransaction();
        try {
            $currentStmt = $pdo->prepare(
                'SELECT role FROM members WHERE groupId = :groupId AND uid = :uid LIMIT 1 FOR UPDATE'
            );
            $currentStmt->execute([':groupId' => $groupId, ':uid' => $uid]);
            $currentRow = $currentStmt->fetch();

            if ($currentRow === false) {
                $pdo->rollBack();
                json_error('Member not found.', 404);
            }

            if ($currentRow['role'] === 'senior_admin' && $role !== 'senior_admin') {
                $countStmt = $pdo->prepare(
                    "SELECT COUNT(*) AS n FROM members WHERE groupId = :groupId AND role = 'senior_admin'"
                );
                $countStmt->execute([':groupId' => $groupId]);
                $count = (int) $countStmt->fetch()['n'];

                if ($count <= 1) {
                    $pdo->rollBack();
                    json_error('A group must retain at least one senior admin.', 409);
                }
            }

            $updateStmt = $pdo->prepare(
                'UPDATE members SET role = :role, updatedAt = NOW() '
                . 'WHERE groupId = :groupId AND uid = :uid'
            );
            $updateStmt->execute([
                ':role' => $role,
                ':groupId' => $groupId,
                ':uid' => $uid,
            ]);

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        $selectStmt = $pdo->prepare(
            'SELECT groupId, uid, fullName, email, phone, whatsappNumber, profileImageUrl, '
            . 'role, status, joinedAt, invitedBy, seedMoneyPaid, monthlyContributionsCurrent, '
            . 'eligibleForLoan, createdAt, updatedAt '
            . 'FROM members WHERE groupId = :groupId AND uid = :uid LIMIT 1'
        );
        $selectStmt->execute([':groupId' => $groupId, ':uid' => $uid]);
        $member = $selectStmt->fetch();

        json_response($member);
    }
}

if (!function_exists('member_select_row')) {
    /**
     * The canonical member row shape, shared by every endpoint in this file
     * that returns a member.
     */
    function member_select_row(PDO $pdo, string $groupId, string $uid): ?array
    {
        $stmt = $pdo->prepare(
            'SELECT groupId, uid, fullName, email, phone, whatsappNumber, profileImageUrl, '
            . 'role, status, joinedAt, invitedBy, seedMoneyPaid, monthlyContributionsCurrent, '
            . 'eligibleForLoan, createdAt, updatedAt '
            . 'FROM members WHERE groupId = :groupId AND uid = :uid LIMIT 1'
        );
        $stmt->execute([':groupId' => $groupId, ':uid' => $uid]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }
}

if (!function_exists('update_member')) {
    /**
     * POST members.update — edit a member's own profile/contact fields.
     *
     * Explicit whitelist of literal column fragments — never build the SET
     * clause from raw client keys. role, status, groupId, uid and every
     * money/eligibility column are NEVER reachable through this endpoint; they
     * have their own dedicated, more tightly gated endpoints.
     */
    function update_member(): void
    {
        $body = read_json_body();
        $groupId = (string) ($body['groupId'] ?? '');
        $uid = (string) ($body['uid'] ?? '');

        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }
        if ($uid === '') {
            json_error('uid is required.', 422);
        }

        require_role($groupId, ['admin', 'senior_admin', 'treasurer']);

        $pdo = getDbConnection();

        $updates = [];
        $params = [':groupId' => $groupId, ':uid' => $uid];

        if (array_key_exists('phone', $body)) {
            $updates[] = 'phone = :phone';
            $params[':phone'] = member_optional_text($body['phone']);
        }
        if (array_key_exists('whatsappNumber', $body)) {
            $updates[] = 'whatsappNumber = :whatsappNumber';
            $params[':whatsappNumber'] = member_optional_text($body['whatsappNumber']);
        }
        if (array_key_exists('profileImageUrl', $body)) {
            $updates[] = 'profileImageUrl = :profileImageUrl';
            $params[':profileImageUrl'] = member_optional_text($body['profileImageUrl']);
        }
        if (array_key_exists('fullName', $body)) {
            $fullName = trim((string) $body['fullName']);
            if ($fullName === '') {
                json_error('fullName cannot be empty.', 422);
            }
            $updates[] = 'fullName = :fullName';
            $params[':fullName'] = $fullName;
        }

        if (empty($updates)) {
            json_error('No updatable fields provided.', 422);
        }

        $updates[] = 'updatedAt = NOW()';

        $exists = member_select_row($pdo, $groupId, $uid);
        if ($exists === null) {
            json_error('Member not found.', 404);
        }

        $sql = 'UPDATE members SET ' . implode(', ', $updates) . ' WHERE groupId = :groupId AND uid = :uid';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        // Optional KYC fields (guarantor, collateral, ID, next-of-kin) live on
        // `users`, not `members` — a per-person attribute, not per-membership.
        // Entirely optional: if the body has none of these keys, skip this
        // second update. $uid is already confirmed above to be a member of
        // this groupId; no additional auth check is added here.
        $kycFields = [
            'guarantorName', 'guarantorPhone', 'guarantorRelationship', 'guarantorAddress',
            'collateralDescription', 'idType', 'idNumber',
            'nextOfKinName', 'nextOfKinPhone', 'nextOfKinRelationship',
        ];

        $userUpdates = [];
        $userParams = [':uid' => $uid];
        foreach ($kycFields as $field) {
            if (array_key_exists($field, $body)) {
                // Literal fragments only — $field comes from THIS hardcoded
                // list, never from the client's key set.
                $userUpdates[] = "{$field} = :{$field}";
                $userParams[":{$field}"] = member_optional_text($body[$field]);
            }
        }

        if (!empty($userUpdates)) {
            $userUpdates[] = 'updatedAt = NOW()';
            $userSql = 'UPDATE users SET ' . implode(', ', $userUpdates) . ' WHERE uid = :uid';
            try {
                $pdo->prepare($userSql)->execute($userParams);
            } catch (PDOException $e) {
                // If KYC columns don't exist yet (migration 011 not applied),
                // silently skip the KYC update — the member row was still saved.
                if (stripos($e->getMessage(), 'Unknown column') === false) {
                    throw $e;
                }
            }
        }

        json_response(member_select_row($pdo, $groupId, $uid));
    }
}

if (!function_exists('member_optional_text')) {
    /**
     * An absent/blank optional field is stored as NULL, not as an empty string.
     */
    function member_optional_text($value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $value = trim($value);

        return $value === '' ? null : $value;
    }
}

if (!function_exists('remove_member')) {
    /**
     * POST members.remove — permanently delete a membership row.
     *
     * SENIOR ADMIN ONLY. A member with ANY financial history (a loan, a
     * contribution payment, or a loan repayment) in this group must be
     * DEACTIVATED via members.status, never deleted — deleting them would
     * either be blocked by the ledger's ON DELETE RESTRICT on members.uid, or
     * (worse) silently orphan the audit trail if it were not. This endpoint
     * therefore refuses outright rather than let that ever be attempted.
     */
    function remove_member(): void
    {
        $body = read_json_body();
        $groupId = (string) ($body['groupId'] ?? '');
        $uid = (string) ($body['uid'] ?? '');

        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }
        if ($uid === '') {
            json_error('uid is required.', 422);
        }

        $caller = require_role($groupId, ['senior_admin']);

        if ($uid === $caller['uid']) {
            json_error('You cannot remove yourself.', 409);
        }

        $pdo = getDbConnection();

        $pdo->beginTransaction();
        try {
            $currentStmt = $pdo->prepare(
                'SELECT role FROM members WHERE groupId = :groupId AND uid = :uid LIMIT 1 FOR UPDATE'
            );
            $currentStmt->execute([':groupId' => $groupId, ':uid' => $uid]);
            $currentRow = $currentStmt->fetch();

            if ($currentRow === false) {
                $pdo->rollBack();
                json_error('Member not found.', 404);
            }

            if ($currentRow['role'] === 'senior_admin') {
                $countStmt = $pdo->prepare(
                    "SELECT COUNT(*) AS n FROM members "
                    . "WHERE groupId = :groupId AND role = 'senior_admin' AND status = 'active'"
                );
                $countStmt->execute([':groupId' => $groupId]);
                $count = (int) $countStmt->fetch()['n'];

                if ($count <= 1) {
                    $pdo->rollBack();
                    json_error('A group must retain at least one senior admin.', 409);
                }
            }

            // A member with ANY financial history must be deactivated, never
            // deleted. Checked across every ledger table this member could
            // appear in for this group.
            $loanStmt = $pdo->prepare(
                'SELECT 1 FROM loans WHERE groupId = :groupId AND borrowerId = :uid LIMIT 1'
            );
            $loanStmt->execute([':groupId' => $groupId, ':uid' => $uid]);
            if ($loanStmt->fetch() !== false) {
                $pdo->rollBack();
                json_error(
                    'This member has loan history in this group; deactivate them instead of removing them.',
                    409
                );
            }

            $paymentStmt = $pdo->prepare(
                'SELECT 1 FROM payments WHERE groupId = :groupId AND uid = :uid LIMIT 1'
            );
            $paymentStmt->execute([':groupId' => $groupId, ':uid' => $uid]);
            if ($paymentStmt->fetch() !== false) {
                $pdo->rollBack();
                json_error(
                    'This member has payment history in this group; deactivate them instead of removing them.',
                    409
                );
            }

            $repaymentStmt = $pdo->prepare(
                'SELECT 1 FROM loan_payments WHERE groupId = :groupId AND uid = :uid LIMIT 1'
            );
            $repaymentStmt->execute([':groupId' => $groupId, ':uid' => $uid]);
            if ($repaymentStmt->fetch() !== false) {
                $pdo->rollBack();
                json_error(
                    'This member has loan repayment history in this group; '
                    . 'deactivate them instead of removing them.',
                    409
                );
            }

            $deleteStmt = $pdo->prepare(
                'DELETE FROM members WHERE groupId = :groupId AND uid = :uid'
            );
            $deleteStmt->execute([':groupId' => $groupId, ':uid' => $uid]);

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        json_response(['removed' => true]);
    }
}

if (!function_exists('create_member')) {
    /**
     * POST members.create — create a brand new user account AND its
     * membership in ONE transaction. A user with no membership, or a
     * membership with no user, must be impossible.
     *
     * The caller's requested role is a REQUEST, not a grant: assigning
     * admin/senior_admin requires the CALLER to already be senior_admin,
     * mirroring change_member_role's privilege rule exactly.
     */
    function create_member(): void
    {
        $body = read_json_body();
        $groupId = (string) ($body['groupId'] ?? '');
        $email = trim((string) ($body['email'] ?? ''));
        $fullName = trim((string) ($body['fullName'] ?? ''));
        $phone = member_optional_text($body['phone'] ?? null);
        $role = (string) ($body['role'] ?? 'member');

        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            json_error('A valid email is required.', 422);
        }
        if ($fullName === '') {
            json_error('fullName is required.', 422);
        }

        $allowedRoles = ['member', 'admin', 'senior_admin', 'treasurer'];
        if (!in_array($role, $allowedRoles, true)) {
            json_error('Invalid role value.', 422);
        }

        $caller = require_role($groupId, ['admin', 'senior_admin', 'treasurer']);

        // Granting admin/senior_admin requires the caller to already be
        // senior_admin — same privilege rule as change_member_role.
        if (in_array($role, ['admin', 'senior_admin'], true) && $caller['role'] !== 'senior_admin') {
            json_error('Only a senior admin may assign that role.', 403);
        }

        $uid = bin2hex(random_bytes(16));
        $temporaryPassword = bin2hex(random_bytes(8));
        $passwordHash = hash_password($temporaryPassword);

        $pdo = getDbConnection();

        // Money Masters rulebook: a group is capped at 30 members. Checked before
        // the transaction so a full group never even creates the new user row.
        assert_group_has_capacity($pdo, $groupId);

        $pdo->beginTransaction();
        try {
            $insertUser = $pdo->prepare(
                'INSERT INTO users (uid, email, fullName, phone, passwordHash, emailVerified, createdAt, updatedAt) '
                . 'VALUES (:uid, :email, :fullName, :phone, :passwordHash, 0, NOW(), NOW())'
            );
            $insertUser->execute([
                ':uid' => $uid,
                ':email' => $email,
                ':fullName' => $fullName,
                ':phone' => $phone,
                ':passwordHash' => $passwordHash,
            ]);

            $insertMember = $pdo->prepare(
                'INSERT INTO members '
                . '(groupId, uid, fullName, email, phone, role, status, joinedAt, invitedBy, '
                . 'seedMoneyPaid, monthlyContributionsCurrent, eligibleForLoan, createdAt, updatedAt) '
                . 'VALUES (:groupId, :uid, :fullName, :email, :phone, :role, :status, NOW(), :invitedBy, '
                . '0, 0, 0, NOW(), NOW())'
            );
            $insertMember->execute([
                ':groupId' => $groupId,
                ':uid' => $uid,
                ':fullName' => $fullName,
                ':email' => $email,
                ':phone' => $phone,
                ':role' => $role,
                ':status' => 'active',
                ':invitedBy' => $caller['uid'],
            ]);

            $pdo->commit();
        } catch (PDOException $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            // 1062 = ER_DUP_ENTRY, on users.email (the only unique key this
            // insert can collide on).
            if ((int) $e->errorInfo[1] === 1062) {
                json_error('A user with that email already exists.', 409);
            }
            throw $e;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        $member = member_select_row($pdo, $groupId, $uid);
        $member['temporaryPassword'] = $temporaryPassword;

        json_response($member, 201);
    }
}

if (!function_exists('update_member_status')) {
    function update_member_status(): void
    {
        $body = read_json_body();
        $groupId = (string) ($body['groupId'] ?? '');
        $uid = (string) ($body['uid'] ?? '');
        $status = (string) ($body['status'] ?? '');

        if ($groupId === '') {
            json_error('groupId is required.', 422);
        }
        if ($uid === '') {
            json_error('uid is required.', 422);
        }

        $allowedStatuses = ['active', 'inactive', 'suspended'];
        if (!in_array($status, $allowedStatuses, true)) {
            json_error('Invalid status value.', 422);
        }

        require_role($groupId, ['admin', 'senior_admin', 'treasurer']);

        $pdo = getDbConnection();

        $pdo->beginTransaction();
        try {
            $currentStmt = $pdo->prepare(
                'SELECT role, status FROM members WHERE groupId = :groupId AND uid = :uid LIMIT 1 FOR UPDATE'
            );
            $currentStmt->execute([':groupId' => $groupId, ':uid' => $uid]);
            $currentRow = $currentStmt->fetch();

            if ($currentRow === false) {
                $pdo->rollBack();
                json_error('Member not found.', 404);
            }

            if ($currentRow['role'] === 'senior_admin' && $status !== 'active') {
                $countStmt = $pdo->prepare(
                    "SELECT COUNT(*) AS n FROM members "
                    . "WHERE groupId = :groupId AND role = 'senior_admin' AND status = 'active'"
                );
                $countStmt->execute([':groupId' => $groupId]);
                $count = (int) $countStmt->fetch()['n'];

                if ($count <= 1) {
                    $pdo->rollBack();
                    json_error('A group must retain at least one senior admin.', 409);
                }
            }

            $updateStmt = $pdo->prepare(
                'UPDATE members SET status = :status, updatedAt = NOW() '
                . 'WHERE groupId = :groupId AND uid = :uid'
            );
            $updateStmt->execute([
                ':status' => $status,
                ':groupId' => $groupId,
                ':uid' => $uid,
            ]);

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        $selectStmt = $pdo->prepare(
            'SELECT groupId, uid, fullName, email, phone, whatsappNumber, profileImageUrl, '
            . 'role, status, joinedAt, invitedBy, seedMoneyPaid, monthlyContributionsCurrent, '
            . 'eligibleForLoan, createdAt, updatedAt '
            . 'FROM members WHERE groupId = :groupId AND uid = :uid LIMIT 1'
        );
        $selectStmt->execute([':groupId' => $groupId, ':uid' => $uid]);
        $member = $selectStmt->fetch();

        json_response($member);
    }
}
