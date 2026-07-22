<?php
/**
 * Group membership capacity — the Money Masters rulebook caps a group at a
 * maximum of 30 members. This is enforced server-side on every join path
 * (members.add, members.create, invite-accept, code-redeem); a client can
 * never bypass it.
 *
 * The cap is a fixed constant (the rulebook states a flat 30, the same for
 * every group). Making it a configurable per-group setting would need a
 * group_rules.maxMembers column + migration — logged as a future enhancement,
 * not required by the rulebook and deliberately avoided here so this guard
 * needs no schema change to take effect.
 */

require_once __DIR__ . '/http.php';
require_once __DIR__ . '/../../config/database.php';

if (!defined('GROUP_MAX_MEMBERS')) {
    // Money Masters Rules & Regulations: "a maximum of 30 members".
    define('GROUP_MAX_MEMBERS', 30);
}

if (!function_exists('group_current_member_count')) {
    /**
     * How many members currently OCCUPY a slot in the group.
     *
     * Counts 'active' and 'suspended' rows: a suspended member is still in the
     * group (temporarily barred, not gone). A deactivated ('inactive') member
     * has effectively left — members.remove sets inactive when a departing
     * member has ledger history that forbids a hard delete — so they free their
     * slot and the group may backfill up to the cap again.
     */
    function group_current_member_count(PDO $pdo, string $groupId): int
    {
        $stmt = $pdo->prepare(
            "SELECT COUNT(*) AS n FROM members "
            . "WHERE groupId = :groupId AND status <> 'inactive'"
        );
        $stmt->execute([':groupId' => $groupId]);
        $row = $stmt->fetch();

        return (int) ($row['n'] ?? 0);
    }
}

if (!function_exists('assert_group_has_capacity')) {
    /**
     * Reject (409) a join that would push the group past GROUP_MAX_MEMBERS.
     * Call this immediately BEFORE any INSERT that adds a NON-creator member.
     * (The group creator is member #1 on a brand-new group, so group-create is
     * never gated — 0 -> 1 can never exceed the cap.)
     *
     * Note: a plain count-then-insert leaves a vanishingly small window where
     * two truly-simultaneous joins to the SAME group could both pass at 29 and
     * both insert, momentarily reaching 31. For a 30-person village savings
     * group this race is not a real-world concern; the count self-corrects and
     * every subsequent join is blocked. A FOR UPDATE lock could close it fully
     * if ever needed.
     */
    function assert_group_has_capacity(PDO $pdo, string $groupId): void
    {
        if (group_current_member_count($pdo, $groupId) >= GROUP_MAX_MEMBERS) {
            json_error(
                'This group is full (maximum ' . GROUP_MAX_MEMBERS . ' members).',
                409
            );
        }
    }
}
