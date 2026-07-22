# SYSTEM_MAP.md — Bank Nkhonde

> Owned by `codebase-scout`. One `##` section per directory tree, appended per scout call.
> **Status: EMPTY — Phase 0 has not run yet.** The planner must dispatch scouts before dispatching any specialist.

Format per section:

| Feature | Page | Script(s) | Firestore collections | Callable fn | Auth gate | Notes |
|---|---|---|---|---|---|---|

Followed by **GAPS** (referenced but missing / wired to nothing) and **DEAD** (unreferenced files, `_new` twins, orphaned CSS).

## Known before scanning (from setup scan, unverified detail)

- Pages: 21 in `pages/` + `index.html`, `login.html`, `404.html` at root.
- Scripts: 55 in `scripts/`. Barrel is `firebaseConfig.js`.
- Styles: 20 in `styles/`. Token source is `design-system.css`.
- Server: `functions/index.js` only.
- Collections seen in `firestore.rules`: `users`, `groups`, `groups/{groupId}/members`. Loan/payment/contribution paths **not yet confirmed** — a scout must establish them.

## functions/ + deploy config

### Cloud Functions Surface

| Function name | Type | Line | Checks context.auth? | Re-checks role server-side? | Firestore paths touched | Sends email? |
|---|---|---|---|---|---|---|
| sendPasswordResetEmail | onCall | 252 | no | no | none | yes — to caller-supplied email |
| sendEmailVerification | onCall | 285 | no | no | none | yes — to caller-supplied email |
| sendRegistrationWelcome | onCall | 318 | no | no | none | yes — to caller-supplied email |
| sendInvitationEmail | Firestore trigger | 348 | N/A | N/A | invitations/{inviteId} (read + write) | yes — to invitation.email from Firestore doc |

**Key findings:**
- All three onCall functions **do NOT check `context.auth`** — unauthenticated callers can invoke them. This is a Phase 1 blocker per the briefing.
- All three onCall functions receive email/user details from `data` (client-supplied) — no server-side role re-check.
- sendInvitationEmail is a Firestore `onCreate` trigger on `invitations/{inviteId}` collection; updates the invitation doc with `status: 'sent'` and serverTimestamp after sending.

### Credential literals

- **Line 18:** `functions.config().smtp?.host || 'mail.promanaged-it.com'`
- **Line 19:** `functions.config().smtp?.port || '465'`
- **Line 22:** `functions.config().smtp?.user || '_mainaccount@promanaged-it.com'`
- **Line 23:** `functions.config().smtp?.pass || [REDACTED]` — literal SMTP password fallback when functions.config().smtp.pass is unset
- **Line 32:** `functions.config().smtp?.user || '_mainaccount@promanaged-it.com'`
- **Line 35:** `functions.config().app?.base_url || 'http://localhost:8000'`
- **Line 37:** `functions.config().smtp?.user || '_mainaccount@promanaged-it.com'`

### Deploy config

From `firebase.json` lines 12–18:

```json
"hosting": {
  "public": "frontend",
  "ignore": [
    "firebase.json",
    "**/.*",
    "**/node_modules/**"
  ]
}
```

**Status:** `public: "frontend"` — **directory does not exist**. The app lives at the repo root (`pages/`, `scripts/`, `styles/`, `index.html`, `login.html` at root level). Redeployment requires either repointing `public` to `"."` or restructuring the repo into a `frontend/` subdirectory.

### GAPS

None found. All exported functions (`sendPasswordResetEmail`, `sendEmailVerification`, `sendRegistrationWelcome`, `sendInvitationEmail`) are complete and ready to deploy.

### DEAD

None found in `functions/`.

---

## Data model (for SQL migration)

Source: `DATABASE_DOCUMENTATION.md` (1395 lines) + `firestore.rules`. Extracted cycle 3.
**32 tables · ~280 fields · 47 MONEY fields (all DECIMAL(15,2), never FLOAT) · 14 enums · 13 unknowns.**

### users
`uid` VARCHAR(128) PK (Firebase Auth UID — becomes local PK post-migration) · `email` VARCHAR(255) UNIQUE NOT NULL · `fullName` VARCHAR(255) NOT NULL · `phone` VARCHAR(20) NULL · `whatsappNumber` VARCHAR(20) NULL · `profileImageUrl` TEXT NULL · `dateOfBirth` DATETIME NULL · `address` TEXT NULL · `nationality` VARCHAR(100) NULL · `occupation` VARCHAR(255) NULL · `emailVerified` TINYINT(1) NOT NULL · `createdAt` / `updatedAt` DATETIME NOT NULL
**Migration note:** needs a `passwordHash` VARCHAR(255) column that Firestore never had — Firebase Auth held credentials. See Unknowns.

### groups
`groupId` VARCHAR(128) PK · `groupName` VARCHAR(255) NOT NULL · `description` TEXT NULL · `status` ENUM('active','inactive','completed') NOT NULL · `createdBy` VARCHAR(128) FK→users(uid) · `createdAt` / `updatedAt` DATETIME

### group_rules  (one row per group — UNIQUE(groupId))
`groupRuleId` INT UNSIGNED PK AUTO · `groupId` FK→groups
**Seed money:** `seedMoneyAmount` MONEY · `seedMoneyDueDate` DATETIME NULL · `seedMoneyRequired` · `seedMoneyAllowPartialPayment` · `seedMoneyMaxPaymentMonths` INT NULL · `seedMoneyMustBeFullyPaid`
**Monthly contribution:** `monthlyContributionAmount` MONEY · `monthlyContributionRequired` · `monthlyContributionDayOfMonth` INT NULL · `monthlyContributionAllowPartialPayment`
**Service fee:** `serviceFeeAmount` MONEY NULL · `serviceFeeRequired` · `serviceFeeDueDate` NULL · `serviceFeePerCycle` NULL · `serviceFeeNonRefundable` NULL · `serviceFeeDescription` TEXT NULL
**Loan interest:** `loanInterestRateMonth1/2/3` DECIMAL(5,2) (percentage rates) · `loanInterestCalculationMethod` ENUM('reduced_balance','flat_rate') · `loanInterestMaxRepaymentMonths` INT
**Penalties:** `loanPenaltyRate` DECIMAL(5,2) · `loanPenaltyType` ENUM('percentage','fixed') · `loanPenaltyGracePeriodDays` INT · `contributionPenaltyDailyRate` DECIMAL(5,2) · `contributionPenaltyMonthlyRate` DECIMAL(5,2) · `contributionPenaltyType` ENUM('percentage') · `contributionPenaltyGracePeriodDays` INT
**Cycle:** `cycleDurationStartDate` · `cycleDurationEndDate` NULL · `cycleDurationMonths` INT · `cycleDurationAutoRenew`
**Loan limits:** `loanRulesMaxLoanAmount` MONEY · `loanRulesMinCycleLoanAmount` MONEY NULL · `loanRulesMaxActiveLoansByMember` INT · `loanRulesRequireCollateral` · `loanRulesMinRepaymentMonths` INT · `loanRulesMaxRepaymentMonths` INT

### group_admins  (normalised from groups.admins[])
`groupAdminId` INT PK AUTO · `groupId` FK · `uid` FK→users · `email` VARCHAR(255) · `name` VARCHAR(255) · `role` ENUM('admin','senior_admin') · `addedAt` DATETIME

### group_statistics  (normalised from groups.statistics cache — one row per group)
`groupStatisticId` INT PK AUTO · `groupId` FK UNIQUE · `totalMembers` INT · `activeLoans` INT · `totalCollected` MONEY · `totalDisbursed` MONEY · `lastUpdated` DATETIME
**Derived data — recompute from source tables; do not trust as authoritative.**

### members  (PK: groupId + uid)
`groupId` FK · `uid` FK→users · `fullName` · `email` · `phone` NULL · `whatsappNumber` NULL · `profileImageUrl` NULL *(all denormalised from users)* · `role` ENUM('member','admin','senior_admin') · `status` ENUM('active','inactive','suspended') · `joinedAt` · `invitedBy` FK→users NULL · `seedMoneyPaid` · `monthlyContributionsCurrent` · `eligibleForLoan` · `createdAt` / `updatedAt`
**Drop `userId`** — redundant copy of `uid`.

### member_financial_summary  (normalised from members.financialSummary — derived)
`memberFinancialSummaryId` INT PK AUTO · `groupId` FK · `uid` FK · `totalPaid` MONEY · `totalArrears` MONEY · `totalPending` MONEY · `totalLoans` MONEY · `totalLoansPaid` MONEY · `totalPenalties` MONEY · `lastPaymentDate` DATETIME NULL · `lastUpdated` DATETIME

### payments_seed_money / payments_monthly_contribution / payments_service_fee
Three near-identical tables. **Consider ONE `payments` table with a `paymentType` discriminator** — see Firestore-isms #11.
Common: `paymentId` PK · `groupId` FK · `year` INT · `uid` FK→users · `totalAmount` MONEY · `amountPaid` MONEY · `arrears` MONEY · `approvalStatus` ENUM('unpaid','pending','approved','rejected','completed') · `paymentStatus` ENUM('Pending','Completed') · `dueDate` · `paidAt` NULL · `paymentMethod` ENUM('cash','bank_transfer','mobile_money') · `notes` TEXT NULL · `recordedManually` · `isAdvancedPayment` · `createdAt` / `updatedAt`
Proof-of-payment (flattened from nested object): `proofOfPaymentImageUrl` TEXT NULL · `proofOfPaymentFileName` NULL · `proofOfPaymentFileSize` INT NULL · `proofOfPaymentUploadedBy` FK NULL · `proofOfPaymentUploadedAt` NULL · `proofOfPaymentVerifiedBy` FK NULL · `proofOfPaymentVerifiedAt` NULL
Approval audit: `approvedBy` FK NULL · `approvedAt` NULL · `rejectedBy` FK NULL · `rejectedAt` NULL · `rejectionReason` TEXT NULL
Type-specific: monthly adds `month` ENUM(January…December); service_fee adds `perCycle`, `nonRefundable`, `description`.

### loans
`loanId` VARCHAR(128) PK · `groupId` FK · `loanNumber` VARCHAR(50) (e.g. 'L-2026-001') · `borrowerId` FK→users · `borrowerName` / `borrowerEmail` (denormalised) · `principalAmount` MONEY · `approvedAmount` MONEY NULL · `status` ENUM('pending','approved','rejected','disbursed','completed','defaulted') · `repaymentPeriod` INT (1–3 months) · `interestRateMonth1/2/3` DECIMAL(5,2) · `totalInterest` MONEY · `totalRepayment` MONEY · `monthlyPayment` MONEY · `disbursedAmount` MONEY · `disbursedAt` NULL · `disbursedBy` FK NULL · `disbursementMethod` ENUM(cash,bank_transfer,mobile_money) NULL · `requestedAt` · `approvedBy`/`approvedAt`/`rejectedBy`/`rejectedAt`/`rejectionReason` NULL · `purpose` TEXT · `collateral` TEXT NULL · `guarantorName`/`guarantorPhone`/`guarantorRelationship` NULL · `amountRepaid` MONEY · `remainingBalance` MONEY · `penaltiesCharged` MONEY · `createdAt`/`updatedAt`/`completedAt` NULL

### loan_payments
`paymentId` VARCHAR(128) PK · `loanId` FK→loans · `groupId` FK · `uid` FK→users · `userName` · `amount` MONEY · `principalPortion` MONEY · `interestPortion` MONEY · `penaltyPortion` MONEY · `scheduledMonth` INT (1–3) · `scheduledAmount` MONEY · `status` ENUM('pending','approved') · `approvedBy` FK NULL · `approvedAt` NULL · `proofOfPaymentImageUrl` TEXT NULL · `proofOfPaymentUploadedAt` NULL · `paidAt` · `createdAt` · `paymentMethod` ENUM(...) · `notes` TEXT NULL

### loan_repayment_schedule
`scheduleId` INT PK AUTO · `loanId` FK→loans · `month` INT (1–3) · `dueDate` · `principalDue` MONEY · `interestDue` MONEY · `totalDue` MONEY · `amountPaid` MONEY · `balance` MONEY · `status` ENUM('pending','paid','overdue') · `paidAt` NULL

### notifications / group_notifications
`notificationId` PK · `userId` FK→users (recipient) · `type` VARCHAR(100) · `title` · `message` TEXT · `groupId` FK NULL · `groupName` NULL · `senderId` FK NULL · `paymentType` NULL · `paymentId` NULL · `loanId` FK NULL · `amount` MONEY NULL · `read` · `readAt` NULL · `dismissed` · `dismissedAt` NULL · `createdAt` · `expiresAt` NULL
**Drop `recipientId`** — duplicate of `userId`. **Consider merging the two tables** — group_notifications is identical plus a non-null groupId.

### messages / message_replies
messages: `messageId` PK · `groupId` FK · `subject` · `body` TEXT · `createdBy` FK · `createdByName` · `assignedTo` FK NULL · `status` ENUM('open','in_progress','resolved','closed') · `priority` ENUM('low','medium','high','urgent') · `createdAt`/`updatedAt`/`resolvedAt` NULL
message_replies (normalised from messages.replies[]): `replyId` PK · `messageId` FK · `groupId` FK · `uid` FK · `userName` · `message` TEXT · `createdAt` · `attachmentsJson` JSON NULL

### broadcasts
`broadcastId` PK · `groupId` FK · `title` · `message` TEXT · `createdBy` FK · `createdAt`/`updatedAt`

### invitations
`invitationId` PK · `invitedEmail` VARCHAR(255) · `invitedBy` FK→users · `groupId` FK · `status` ENUM('pending','accepted','rejected') · `createdAt` · `respondedAt` NULL
*(Fields partly INFERRED — the docs do not specify this collection. See Unknowns #4.)*

### invitation_codes / invitation_code_uses
codes: `codeId` PK · `code` VARCHAR(100) UNIQUE · `groupId` FK · `groupName` · `createdBy` FK · `createdAt` · `expiresAt` NULL · `maxUses` INT NULL · `usedCount` INT · `status` ENUM('active','expired','revoked')
uses (normalised from usedBy[]): `codeUseId` INT PK AUTO · `codeId` FK · `uid` FK · `usedAt`

### audit_logs
`logId` PK · `action` VARCHAR(100) · `entityType` VARCHAR(100) · `entityId` VARCHAR(128) · `performedBy` FK · `performedByName` · `performedByRole` · `groupId` FK · `groupName` · `changesBeforeJson` JSON NULL · `changesAfterJson` JSON NULL · `ipAddress` VARCHAR(45) NULL · `userAgent` TEXT NULL · `timestamp` DATETIME
**Immutable — insert only.**

### transactions · badges · meetings · monthly_reports · system_settings
Defined in `firestore.rules` but **NOT documented**. Schemas are inferred/minimal. See Unknowns #1, #2, #3, #5.

### Enums (14)
roles `member|admin|senior_admin` · member status `active|inactive|suspended` · group status `active|inactive|completed` · payment approvalStatus `unpaid|pending|approved|rejected|completed` · payment paymentStatus `Pending|Completed` *(note the capitalisation differs — preserve it)* · payment method `cash|bank_transfer|mobile_money` · loan status `pending|approved|rejected|disbursed|completed|defaulted` · loan payment status `pending|approved` · schedule status `pending|paid|overdue` · message status `open|in_progress|resolved|closed` · message priority `low|medium|high|urgent` · interest method `reduced_balance|flat_rate` · loan penalty type `percentage|fixed` · invitation code status `active|expired|revoked` · month names `January…December`

### Firestore-isms that do not map
1. `users.groupMemberships[]` → redundant with `members`; drop, query members by uid.
2. `groups.admins[]` → `group_admins` table.
3. `groups.statistics{}` → `group_statistics` (derived cache; recompute).
4. `members.financialSummary{}` → `member_financial_summary` (derived; recompute).
5. `payments.proofOfPayment{}` → flattened into the payment row.
6. `messages.replies[]` → `message_replies` table.
7. `invitation_codes.usedBy[]` → `invitation_code_uses` table.
8. `audit_logs.changes{}` → JSON columns (arbitrary nested shape; cannot normalise).
9. `message_replies.attachments[]` → JSON column.
10. Redundant ID fields duplicating the doc ID (`userId` in members, etc.) → drop; use the PK.
11. **Three payment tables are ~90% identical.** Strong candidate for a single `payments` table with a `paymentType` ENUM discriminator. Recommend consolidating — decide before writing DDL.

### Unknowns — do NOT guess these into the schema
1. **`transactions`** — in rules, undocumented. Ledger entry? Payment duplicate? Valid `type` values unknown.
2. **`badges`** — in rules, undocumented. Status values, award mechanism, `targetAudience` values all unknown.
3. **`meetings`** — in rules, undocumented. Location/attendees/agenda unknown.
4. **`invitations`** — in rules and used by a Cloud Function trigger, but not in the docs. Expiry? Resend?
5. **`system_settings`** — key names and value types unknown.
6. **Loan interest formula NOT documented.** Rates and `calculationMethod` are stored, but how `totalInterest` and `monthlyPayment` are actually computed is not written down anywhere. **This is the single most important unknown — it is the money maths.**
7. **`isAdvancedPayment`** — semantics undocumented; only true for monthly contributions. Why?
8. **Cycle auto-renew** — what happens to old loans/payments on renewal?
9. **Notification `expiresAt`** — TTL enforced how?
10. **Guarantor requirement** — when is it mandatory?
11. **Payment proof `fileName`/`fileSize`** — Storage metadata or app-supplied?
12. **Password storage** — Firebase Auth held all credentials. MySQL needs a `passwordHash` column and a hashing scheme; **existing users' passwords cannot be migrated out of Firebase** and will all need reset.
13. **Message assignment history** — tracked or only final assignee?

---

## Navigation cluster (scripts/ + styles/)

### Overview
Five navigation-related scripts and two stylesheets handle DOM injection, mobile/desktop menu management, SPA routing (admin), and auth-gated navigation. Two scripts are DEAD (referenced only in documentation). Three are active:
1. **User pages (loan_payments, contacts, group_page, messages, user_analytics, view_rules, user_dashboard)** use `shared-top-nav.js` + `unified-navigation.js`
2. **Admin pages (13 dashboard/management pages)** use `admin-layout.js` (SPA implementation)

| Feature | Pages | Script(s) | Firebase? | Auth gate | Notes |
|---|---|---|---|---|---|
| User top nav (desktop) + mobile menu (injected) | loan_payments, contacts, group_page, messages, user_analytics, view_rules | `shared-top-nav.js` | NO (relies on `window.auth` set externally) | Checked by page script | Exports `window.initTopNav(options)`. Creates `.top-nav`, `.mobile-menu-overlay`, `.mobile-menu`. Configurable: showGroupDisplay, showViewToggle, logoLink. Exposes `window.closeMobileMenu()`, `window.handleMobileLogout()`. |
| User nav state + mobile menu toggle + modal scroll lock | loan_payments, contacts, group_page, messages, user_analytics, view_rules | `unified-navigation.js` | YES (dynamic import of `auth`, `signOut`) | Checked by page script | Auto-initializes on DOMContentLoaded. Exports `initializeUnifiedNavigation()`. Handles mobile menu open/close, modal `.active` state, logout button handlers. Exposes `window.handleMobileNavLogout`, `window.handleSwitchToAdmin`, `window.closeMobileMenu`. |

---

## Account-statement ledger sources (cycle 92 scout)

**Scope:** Map the exact as-built data sources for a member account-statement endpoint (payments, repayments, loans, penalties, exports pattern).

**Real schema corrections:**
The Firestore-era model at lines 110–124 (payments_seed_money/monthly/service_fee, loan_payments, penalty_settlements) reflects the as-built SQL exactly. Tables confirmed to exist:
- **Single `payments` table** with `paymentType` ENUM discriminator (NOT three separate tables).
- **`loan_payments` table** (repayments ledger, distinct from contributions).
- **`penalty_settlements` table** (audit trail for waived/paid penalties on either payments or loans).

### 1. PAYMENTS table — Settlement date & Status

| Column | Type | Notes |
|---|---|---|
| paymentId | VARCHAR(128) PK | Unique per payment claim |
| groupId | FK | required |
| uid | FK→users | the member who owes |
| paymentType | ENUM | 'seed_money', 'monthly_contribution', 'service_fee' (const PAYMENT_TYPES, line 35) |
| year | INT | fiscal year |
| month | ENUM NULL | January…December; NULL for seed_money & service_fee |
| totalAmount | MONEY | the obligation (from group_rules, never client-supplied) |
| amountPaid | MONEY | verified cash received |
| arrears | MONEY | outstanding balance |
| approvalStatus | ENUM | **'pending', 'approved', 'rejected', 'completed'** → settled values: `['approved', 'completed']` (PAYMENT_SETTLED_STATUSES, line 48) |
| **approvedAt** | DATETIME | **THE settlement date** — set by approve_payment when status moves to approved/completed (line 1482) |
| paidAt | DATETIME | set to NOW() when payment first recorded (line 1356); does NOT indicate approval |
| createdAt/updatedAt | DATETIME | audit |
| proofOfPaymentImageUrl / ...UploadedAt / ...VerifiedBy / ...VerifiedAt | TEXT/DATETIME | proof metadata |
| approvedBy / rejectedBy / rejectedAt / rejectionReason | FK/DATETIME/TEXT | audit |
| paymentMethod | ENUM | 'cash', 'bank_transfer', 'mobile_money' |
| notes / recordedManually / isAdvancedPayment | TEXT/TINYINT | optional claims data |

**For a statement, query:** `SELECT * FROM payments WHERE groupId = ? AND uid = ? AND approvalStatus IN ('approved', 'completed') ORDER BY approvedAt DESC`

### 2. REPAYMENTS (loan_payments table)

| Column | Type | Notes |
|---|---|---|
| paymentId | VARCHAR(128) PK | Unique per repayment |
| loanId | FK→loans | the loan being repaid |
| groupId / uid / userName | FK/TEXT | denormalised borrower identity |
| amount / principalPortion / interestPortion / penaltyPortion | MONEY | split as computed at record_repayment (line 350) |
| scheduledMonth / scheduledAmount | INT/MONEY | which monthly instalment is being paid against |
| status | ENUM | **'pending', 'approved', 'rejected'** → settled: 'approved' (implied; only approved payments move the ledger, line 412) |
| approvedAt | DATETIME | set when approve_repayment succeeds (line 464) |
| paidAt | DATETIME | set to NOW() at record time (line 367) |
| createdAt | DATETIME | insertion timestamp |
| proofOfPaymentImageUrl / proofOfPaymentUploadedAt | TEXT/DATETIME | proof metadata |
| rejectedBy / rejectedAt / rejectionReason | FK/DATETIME/TEXT | audit for rejected repayments |
| paymentMethod / notes | ENUM/TEXT | optional details |

**Table confirmed to exist:** line 360 (INSERT INTO loan_payments). Handlers: `record_repayment` (270), `approve_repayment` (412), `reject_repayment` (631), `my_repayments` (728), `waive_penalty` (766), `loan_balance` (237), `pending_repayments` (692).

**For a statement, query:** `SELECT * FROM loan_payments WHERE groupId = ? AND uid = ? AND status = 'approved' ORDER BY approvedAt DESC` (matching the settled-payment pattern in payments).

### 3. PENALTY_SETTLEMENTS table

| Column | Type | Notes |
|---|---|---|
| groupId / uid | FK | member charged |
| loanId | FK→loans NULL | one or the other (loan penalty XOR payment penalty) |
| paymentId | FK→payments NULL | payment obligation charged |
| accruedFrom / accruedTo | DATE | date range penalty accrued over |
| daysCharged | INT | whole-day count |
| dailyAmount / amountAccrued | MONEY | what was charged per day, total accrued |
| amountPaid / amountWaived | MONEY | settlement split (one or both > 0) |
| **status** | ENUM | **'paid'**, **'waived'**, **'partial'** (partial = payment cleared only part of outstanding; line 597 repayments.php) |
| waivedReason | TEXT NULL | reason for waiver (senior_admin only, line 758) |
| settledBy / settledAt | FK/DATETIME | who and when |
| createdAt | DATETIME | row insertion |

**Charged vs waived distinction:**
- `status = 'waived'` + `amountWaived > 0` → forgiven (senior_admin only, lines 758–823 in repayments.php).
- `status = 'paid'` + `amountPaid > 0` → paid off.
- `status = 'partial'` → paid but still outstanding (line 597).

**Reads:** payment penalty computation at payments.php:255; loan penalty computation at repayments.php:254.
**Writes:** payment penalty waiver (payments.php:362–382); loan penalty settlement (repayments.php:575–600); loan penalty waiver (repayments.php:795–815).

### 4. LOANS table — Date columns available

**For statement:** `requestedAt`, `approvedAt`, `disbursedAt`.

| Column | Notes |
|---|---|
| requestedAt | DATETIME — when member/admin originated the loan (NOW() at line 335) |
| approvedAt | DATETIME — set when approve_loan succeeds (line 651 via NOW()) |
| disbursedAt | DATETIME NULL — NOT set by current code; disbursement is a future feature |
| principalAmount / approvedAmount / disbursedAmount | MONEY — requested, approved, actually disbursed |
| amountRepaid / remainingBalance | MONEY — ledger state after repayment approval |
| penaltiesCharged | MONEY — sum of settled penalties on this loan (from penalty_settlements where loanId = ?) |

**Returned by loan_fetch_row** (line 62–72 loans.php): includes requestedAt, approvedAt, approvedBy, disbursedAt, disbursedBy, completedAt, plus amount/penalty totals.

### 5. ADMIN UID OVERRIDE guard (payments.php my_obligations ~920–932)

**Exact code:**
```php
$uid = (string) $caller['uid'];
$requested = $_GET['uid'] ?? null;
if (is_string($requested) && trim($requested) !== '' && trim($requested) !== (string) $caller['uid']) {
    if (!in_array((string) $caller['role'], PAYMENT_ADMIN_ROLES, true)) {
        json_error('You may only view your own obligations.', 403);
    }
    $uid = trim($requested);
    if (payment_fetch_member($pdo, $groupId, $uid) === null) {
        json_error('That member is not in this group.', 404);
    }
}
```

**Admin roles:** `PAYMENT_ADMIN_ROLES = ['admin', 'senior_admin', 'treasurer']` (line 51).

### 6. EXPORTS helper pattern (exports.php) + routing (index.php)

**Helpers for a statement CSV endpoint:**

| Function | Line | Purpose |
|---|---|---|
| `export_require_group_id()` | 44–53 | Extract & validate groupId from query string |
| `require_role($groupId, EXPORT_ADMIN_ROLES)` | 137 etc. | Gate: admin/senior_admin/treasurer only |
| `export_csv_headers(string $name, string $groupId)` | 72–85 | Override JSON header; set Content-Type & filename |
| `export_csv_cell($value)` | 87–117 | Formula-injection guard (prefix `=+-@` with `'`) |
| `export_csv_row($out, array $row)` | 119–125 | fputcsv with export_csv_cell on every cell |
| Constant: `EXPORT_ADMIN_ROLES` | 34 | `['admin', 'senior_admin', 'treasurer']` |

**Pattern for `exports.statement`:**
```php
function export_statement(): void {
    $groupId = export_require_group_id();
    $year = export_optional_year();  // line 55–70: bounded validation
    require_role($groupId, EXPORT_ADMIN_ROLES);
    $pdo = getDbConnection();
    // Build SQL: SELECT from payments/loan_payments/loans with WHERE groupId/year filters
    export_csv_headers('statement', $groupId);  // sets filename + headers
    $out = fopen('php://output', 'w');
    export_csv_row($out, ['uid', 'fullName', 'paymentType', 'amount', 'status', 'settledAt', ...]);
    while (($row = $stmt->fetch()) !== false) {
        export_csv_row($out, [$row['uid'], $row['fullName'], ...]);  // all cells guarded vs formula injection
    }
    fclose($out);
    exit;
}
```

**Route table location (api/index.php):** lines 43–135 (ROUTES constant).
Add route: `'exports.statement' => ['GET', 'export_statement']` (after line 134).

### 7. money.php minor-unit helpers

| Function | Line | Signature |
|---|---|---|
| `money_to_minor` | 32 | `function money_to_minor(string $amount): int` — parse "1000.00" → 100000 |
| `money_from_minor` | 52 | `function money_from_minor(int $minor): string` — render 100000 → "1000.00" |

**Never use floats:** all currency arithmetic stays in minor units (tambala/cents).

### Summary for statement endpoint

| Data source | Table | Settlement column | Status filter | Query scope |
|---|---|---|---|---|
| Contributions | payments | approvedAt | WHERE approvalStatus IN ('approved', 'completed') | Same group + member |
| Loan repayments | loan_payments | approvedAt | WHERE status = 'approved' | Same group + borrower |
| Penalties paid/waived | penalty_settlements | settledAt | (all — status tells story) | Scoped by loanId OR paymentId |
| Loan lifecycle dates | loans | approvedAt (or requestedAt/disbursedAt) | (all — status tells story) | Same group + borrower |

**Authorization:** Caller must have admin/senior_admin/treasurer role in the group; statement view is admin-only. A member sees only their own statement; admins may export any member's (via optional `?uid=` parameter, guarded like payments.obligations lines 920–932).

---

## Loan eligibility surface (cycle 90 scout)

### 1. `request_loan()` flow: inputs → validation → INSERT status

**Signature:** `request_loan(): void` at api/handlers/loans.php:238–369

**Inputs read:**
- `body['groupId']` (required)
- `body['principalAmount']` (required; normalised to decimal string via `loan_money_input_to_string()` → `money_to_minor()`)
- `body['repaymentPeriod']` (required; int months)
- `body['purpose']` (required; trimmed string)
- Optional: `body['collateral']`, `body['guarantorName']`, `body['guarantorPhone']`, `body['guarantorRelationship']`

**Authorization:**
- Line 247: `require_role($groupId, ['member', 'admin', 'senior_admin', 'treasurer'])` — a plain member may request their own loan

**Current validation/eligibility checks:**
1. Line 254–260: principal > 0, purpose not empty
2. Line 273–275: principal does not exceed group's `loanRulesMaxLoanAmount` (if set)
3. Line 278–285: repaymentPeriod is between `loanRulesMinRepaymentMonths` and `loanRulesMaxRepaymentMonths` (fallback: 1–3 months)
4. Line 287–298: active loan count check — member's existing loans in statuses `['pending', 'approved', 'disbursed']` must be < `loanRulesMaxActiveLoansByMember`
5. Line 302–307: borrower profile (users table) must exist

**No eligibility check for:**
- Seed money status (`seedMoneyPaid`)
- Monthly contributions current (`monthlyContributionsCurrent`)
- Existing arrears or penalties

**INSERT statement:** Lines 324–365
- **Status on creation:** `'pending'` (line 333)
- **Initial financial fields:** `totalInterest='0.00'`, `totalRepayment='0.00'`, `monthlyPayment='0.00'`, `amountRepaid='0.00'`, `remainingBalance='0.00'`, `penaltiesCharged='0.00'` (lines 354–364)
- Interest is NOT computed at request time; priced only at approval

---

### 2. Loan interest/schedule math: function and active-loan constants

**Function signature:** `compute_loan_schedule(string $principal, int $period, array $rates): array` in api/lib/money.php:107–214

**Entry points:**
- Called by `approve_loan()` at line 430 (loans.php)
- Called by `force_loan()` at line 659 (loans.php)

**Returns:** `['totalInterest' => string, 'totalRepayment' => string, 'monthlyPayment' => string, 'schedule' => array<{month:int, interestRate:string, principalDue:string, interestDue:string, totalDue:string}>]`

**Method:** Reduced-balance, verbatim port of Firebase implementation. Equal principal, interest charged on exact reducing balance per month. Interest rounded to 2dp each month, final instalment absorbs rounding remainder.

**Rate defaults** (money.php:16–19):
- `LOAN_DEFAULT_RATE_MONTH1 = '10'`
- `LOAN_DEFAULT_RATE_MONTH2 = '7'`
- `LOAN_DEFAULT_RATE_MONTH3 = '5'`

**Active-loan statuses constant** (loans.php:27):
- `const LOAN_ACTIVE_STATUSES = ['pending', 'approved', 'disbursed'];`
- Used to count active loans against the per-member cap (line 291)
- Used in `list_loans()` summary (line 189) to tally active principal

---

### 3. Arrears/penalty helpers: signatures and return shapes

**`my_obligations(): void`** (payments.php:760–942)
- Returns member's obligations (seed, monthly, service fee) with per-item penalty computed on read
- Query params: `groupId`, optional `uid` (admin-only override), optional `year`
- Response: seed/monthly/service fee objects + member standing flags (`seedMoneyPaid`, `monthlyContributionsCurrent`, `eligibleForLoan`) + summary (`contributed`, `arrears`, `penaltyAccrued`)

**`group_arrears_summary(): void`** (payments.php:944–1065)
- ADMIN-ONLY. Computes total group obligation (all active members) from rules − verified paid, across all contribution types + penalties
- Query params: `groupId`, optional `year`
- Response: `['arrears' => string (money), 'penaltyAccrued' => string, 'totalArrears' => string, 'memberCount' => int]`

**`payment_rule_amount_minor(?array $rules, string $paymentType): ?int`** (payments.php:400–434)
- Returns what ONE payment TYPE costs (e.g. seed_money, monthly_contribution, service_fee) in minor units, from group_rules
- Returns `null` if unconfigured
- Maps paymentType → column: `'seed_money'` → `seedMoneyAmount`, `'monthly_contribution'` → `monthlyContributionAmount`, `'service_fee'` → `serviceFeeAmount`

**`payment_settled_minor(PDO, groupId, uid, paymentType, ?year, ?month): int`** (payments.php:485–532)
- Sum of VERIFIED (approved/completed) payments on ONE obligation, in minor units
- Returns 0 if no rows or no verified rows
- Summed row-wise in minor units (never SQL SUM) to avoid float coercion

**`payment_penalty_or_501(?array $rules, ?string $dueDate, int $arrearsMinor, ?string $paymentId = null): array`** (payments.php:283–302)
- Wrapper around `compute_contribution_penalty()` that maps RuntimeException to 501 (unimplemented penalty type)
- Returns: `['dailyAmount' => string, 'gracePeriodDays' => int, 'firstChargeableDay' => ?string, 'daysCharged' => int, 'amountAccrued' => string, 'amountSettled' => string, 'amountOutstanding' => string, 'dueDate' => ?string, 'asOf' => string]`

**`compute_contribution_penalty(?array $rules, ?string $dueDate, int $arrearsMinor, ?string $paymentId = null, ?string $asOf = null): array`** (payments.php:164–281)
- Computes live (growing) penalty on a contribution obligation; throws RuntimeException if percentage penalties (unimplemented) or config broken
- Zero when: no rules, no arrears, no dueDate, or inside grace period
- Penalty accrues fixed MWK/day after grace period while arrears > 0
- Already-settled amounts (paid/waived) netted from `penalty_settlements` table, paymentId-scoped
- **Never persisted as running total; re-derived on every read**

**All penalty helpers use minor units (int) internally; conversion to/from money happens at boundaries only**

---

### 4. Money helpers: exact signatures

**`money_to_minor(string $amount): int`** (money.php:21–44)
- Parse decimal money string into integer minor units (100 = 1.00)
- Accepts only: non-negative decimal with at most 2 fractional digits, 1–13 integer digits
- Throws InvalidArgumentException on any other format (scientific notation, third decimal, floats-in-disguise, negatives)

**`money_from_minor(int $minor): string`** (money.php:47–59)
- Render minor units as decimal string with exactly 2 decimals (e.g. `123` → `"1.23"`)
- Computed via integer division, never `number_format()` on a float

**`money_rate_to_hundredths(string $rate): int`** (money.php:61–82)
- Parse percentage rate (e.g. `"10.00"`) into integer hundredths (10.00% → 1000)
- Same validation as money_to_minor: at most 2 decimals, 1–3 integer digits

---

### 5. Live `group_rules` columns: from DESCRIBE

**All columns (sorted by functional area):**

**Identity:**
- `groupId` (PK or FK; unique per group)

**Seed money:**
- `seedMoneyAmount` DECIMAL(15,2)
- `seedMoneyDueDate` DATETIME NULL
- `seedMoneyRequired` TINYINT(1)
- `seedMoneyAllowPartialPayment` TINYINT(1)
- `seedMoneyMaxPaymentMonths` INT NULL
- `seedMoneyMustBeFullyPaid` TINYINT(1)

**Monthly contribution:**
- `monthlyContributionAmount` DECIMAL(15,2)
- `monthlyContributionRequired` TINYINT(1)
- `monthlyContributionDayOfMonth` INT NULL
- `monthlyContributionAllowPartialPayment` TINYINT(1)

**Service fee:**
- `serviceFeeAmount` DECIMAL(15,2) NULL
- `serviceFeeRequired` TINYINT(1)
- `serviceFeeDueDate` DATETIME NULL
- `serviceFeePerCycle` TINYINT(1) NULL
- `serviceFeeNonRefundable` TINYINT(1) NULL
- `serviceFeeDescription` TEXT NULL

**Loan interest (rates):**
- `loanInterestRateMonth1` DECIMAL(5,2)
- `loanInterestRateMonth2` DECIMAL(5,2)
- `loanInterestRateMonth3` DECIMAL(5,2)
- `loanInterestCalculationMethod` ENUM('reduced_balance', 'flat_rate')
- `loanInterestMaxRepaymentMonths` INT

**Loan penalties:**
- `loanPenaltyRate` DECIMAL(5,2)
- `loanPenaltyType` ENUM('percentage', 'fixed')
- `loanPenaltyGracePeriodDays` INT
- `loanPenaltyDailyAmount` DECIMAL(15,2)

**Contribution penalties:**
- `contributionPenaltyDailyRate` DECIMAL(5,2)
- `contributionPenaltyMonthlyRate` DECIMAL(5,2)
- `contributionPenaltyType` ENUM('percentage', 'fixed')
- `contributionPenaltyGracePeriodDays` INT
- `contributionPenaltyDailyAmount` DECIMAL(15,2)
- `shareOutPenalties` TINYINT(1)

**Cycle:**
- `cycleDurationStartDate` DATETIME
- `cycleDurationEndDate` DATETIME NULL
- `cycleDurationMonths` INT
- `cycleDurationAutoRenew` TINYINT(1)

**Loan limits (the "loanRules" prefix):**
- `loanRulesMaxLoanAmount` DECIMAL(15,2)
- `loanRulesMinCycleLoanAmount` DECIMAL(15,2) NULL
- `loanRulesMaxActiveLoansByMember` INT ← **already enforced in request_loan() at line 287**
- `loanRulesRequireCollateral` TINYINT(1)
- `loanRulesMinRepaymentMonths` INT
- `loanRulesMaxRepaymentMonths` INT

**Forced loans:**
- `forcedLoansEnabled` TINYINT(1)
- `forcedLoansMethod` ENUM('fixed_amount', 'percentage_of_highest')
- `forcedLoansPercentageOfHighest` DECIMAL(5,2) NULL

### Writable whitelist in `update_rules()`: lines 192–368

**Literal column fragments that `update_rules()` accepts:**
- `seedMoneyAmount` (line 192)
- `monthlyContributionAmount` (line 197)
- `monthlyContributionDayOfMonth` (line 205)
- `serviceFeeAmount` (line 214)
- `loanInterestRateMonth1` (line 219)
- `loanInterestRateMonth2` (line 227)
- `loanInterestRateMonth3` (line 235)
- `loanPenaltyType` (line 256)
- `contributionPenaltyType` (line 265)
- `loanPenaltyDailyAmount` (line 274)
- `contributionPenaltyDailyAmount` (line 282)
- `loanPenaltyGracePeriodDays` (line 290)
- `contributionPenaltyGracePeriodDays` (line 298)
- `loanRulesMaxLoanAmount` (line 306)
- `loanRulesMinCycleLoanAmount` (line 314)
- `shareOutPenalties` (line 326)
- `forcedLoansEnabled` (line 336)
- `forcedLoansMethod` (line 346)
- `forcedLoansPercentageOfHighest` (line 358)

**NOT writable via API (absent from whitelist):**
- Any seed-money columns except amount
- Service fee `perCycle`, `nonRefundable`, `description`
- Loan interest `calculationMethod`, `maxRepaymentMonths`
- Any loan penalty grace period or daily amount (rates only writable)
- Contribution penalty rates
- Cycle columns
- `loanRulesMaxActiveLoansByMember` (read-only; controlled by admin settings elsewhere, if at all)
- `loanRulesRequireCollateral` (read-only)

### `get_rules()` returns all RULES_SELECT_COLUMNS to any group member (line 142–159)

---

### 6. Live `loans` table columns: from SYSTEM_MAP + code attestation

**Confirmed present (from loans.php queries and inserts):**
- `loanId` VARCHAR(128) PK
- `groupId` FK
- `loanNumber` VARCHAR(50) (e.g. 'LN-0001', per-group sequence)
- `borrowerId` FK→users
- `borrowerName` VARCHAR(255) (denormalised from users.fullName)
- `borrowerEmail` VARCHAR(255) (denormalised from users.email)
- `principalAmount` DECIMAL(15,2)
- `approvedAmount` DECIMAL(15,2) NULL
- `status` ENUM('pending', 'approved', 'rejected', 'disbursed', 'completed', 'defaulted')
- `repaymentPeriod` INT (1–3 months typically)
- `interestRateMonth1`, `interestRateMonth2`, `interestRateMonth3` DECIMAL(5,2) (snapshotted rates)
- `totalInterest` DECIMAL(15,2)
- `totalRepayment` DECIMAL(15,2)
- `monthlyPayment` DECIMAL(15,2)
- `disbursedAmount` DECIMAL(15,2)
- `disbursedAt` DATETIME NULL
- `disbursedBy` FK NULL
- `disbursementMethod` ENUM (cash, bank_transfer, mobile_money) NULL
- `requestedAt` DATETIME
- `approvedBy` FK NULL
- `approvedAt` DATETIME NULL
- `rejectedBy` FK NULL
- `rejectedAt` DATETIME NULL
- `rejectionReason` TEXT NULL
- `purpose` TEXT
- `collateral` TEXT NULL
- `guarantorName` VARCHAR(255) NULL
- `guarantorPhone` VARCHAR(20) NULL
- `guarantorRelationship` VARCHAR(100) NULL
- `isForced` TINYINT(1) (0 = normal request, 1 = forced by admin; see force_loan() lines 683, 690)
- `forcedBy` FK NULL (uid of the admin who forced it)
- `forcedReason` TEXT NULL (why forced)
- `amountRepaid` DECIMAL(15,2)
- `remainingBalance` DECIMAL(15,2)
- `penaltiesCharged` DECIMAL(15,2)
- `createdAt` DATETIME
- `updatedAt` DATETIME
- `completedAt` DATETIME NULL

---

### 7. Do the four proposed eligibility toggle columns already exist?

**Answer: NO — none of the four proposed toggles exist in group_rules.**

**What DOES exist:**
- **`loanRulesMaxActiveLoansByMember` INT** (already enforced in request_loan:287)
- **Member-level flags in members table** (re-derived on payment approval): `seedMoneyPaid` (TINYINT), `monthlyContributionsCurrent` (TINYINT), `eligibleForLoan` (TINYINT) — re-derived by `payment_recompute_member_flags()` at payments.php:615–673

**Proposed columns (none yet exist):**
1. `allowMultipleActiveLoans` — to relax the per-member cap
2. `maxActiveLoansPerMember` — alternative to above; rename or clarify `loanRulesMaxActiveLoansByMember`
3. `requireArrearsClearedBeforeLoan` — NOT YET ENFORCED; payments.php has no gate for this
4. `requirePenaltiesClearedBeforeLoan` — NOT YET ENFORCED; payments.php has no gate for this

---

### 8. api/index.php routes: loans.* and rules.*

**Loan routes** (lines 65–70):
- Line 65: `'loans.list' => ['GET', 'list_loans']`
- Line 66: `'loans.get' => ['GET', 'get_loan']`
- Line 67: `'loans.request' => ['POST', 'request_loan']`
- Line 68: `'loans.approve' => ['POST', 'approve_loan']`
- Line 69: `'loans.reject' => ['POST', 'reject_loan']`
- Line 70: `'loans.force' => ['POST', 'force_loan']`

**Rules routes** (lines 88–89):
- Line 88: `'rules.get' => ['GET', 'get_rules']`
- Line 89: `'rules.update' => ['POST', 'update_rules']`

---

### GAPS

- **No eligibility check for arrears/penalties before loan request.** The feature G2 (enforce arrears gate) and G3 (enforce penalties gate) require new handlers or gates in request_loan().
- **No toggle to allow/disallow multiple active loans.** The per-member cap is fixed; no admin override exists yet.
- **No 'isForced' / 'forcedBy' audit in list_loans().** Force status not returned to clients (not in SELECT at line 156).

### DEAD

None. All four handlers (loans, rules, payments, money) are in active use.
| User dashboard nav (with group display + admin toggle) | user_dashboard | `shared-top-nav.js` (only) | NO | Checked by user_dashboard.js | Same as above, initialized with `showGroupDisplay: true, showViewToggle: true`. No `unified-navigation.js` loaded. |
| Admin sidebar + topbar + mobile bottom nav + SPA navigation | admin_dashboard, analytics, manage_loans, manage_payments, manage_members, contributions_overview, interest_penalties, financial_reports, broadcast_notifications, manage_rules, seed_money_overview, approve_registrations, settings | `admin-layout.js` | YES (onAuthStateChanged, getDoc, signOut) | `onAuthStateChanged` in layout (redirects to login if no user) | Full SPA router: intercepts nav clicks, fetches pages, swaps only `.dashboard-content`, keeps sidebar/topbar persistent. Exports `initAdminLayout(options)`, `showToast()`. Manages user profile, group name, currency selector. Injects sidebar, topbar, mobile nav into DOM. |
| Persistent sidebar (planned, not deployed) | — | `shared-sidebar.js` | YES (onAuthStateChanged, getDoc, signOut) | `onAuthStateChanged` | DEAD: not imported by any .html page. Exports `initializeSharedSidebar(isAdmin)`. Creates sidebar, loads user data, sets up event listeners. Injects mobile menu button on mobile. Styles in inline `<style>` (not in separate CSS file). |
| Mobile menu toggle (legacy, not deployed) | — | `hamburger.js` | NO | — | DEAD: not imported by any .html page. 6 lines of code. Toggles `.nav-links` active class on `.hamburger` click. Superseded by `unified-navigation.js`. |

### Stylesheets

| Sheet | Pages | Source | Coverage |
|---|---|---|---|
| `unified-navigation.css` (308 lines) | loan_payments, contacts, group_page, messages, user_analytics, view_rules | Linked directly in 6 pages (not in design-system.css) | Styles top-nav, mobile menu, group display, view toggle, desktop buttons, avatar |
| `unified-mobile-nav.css` (imported into design-system.css) | All pages (indirectly via design-system.css) + explicitly re-linked by the 6 user pages | Imported in design-system.css; also explicitly linked in 6 user pages | Styles `.mobile-nav`, `.mobile-nav-item`, `.mobile-nav-icon` (bottom nav bar for admin SPA) |
| (no separate sidebar.css) | — | Sidebar styles are inline in `shared-sidebar.js` + built into `admin-layout.js` | Sidebar built via buildSidebarHTML() in admin-layout.js, no external CSS |

### Auth pattern comparison

**User pages (Firebase):**
- `shared-top-nav.js`: no Firebase import; relies on `window.auth` or fallback redirect
- `unified-navigation.js`: imports `auth`, `signOut` dynamically only for logout
- Page scripts (loan_payments.js, contacts.js, etc.): check `onAuthStateChanged` themselves
- **Logout path:** button → unified-navigation.js → firebaseConfig.js → redirect to login

**Admin pages (Firebase):**
- `admin-layout.js`: calls `onAuthStateChanged(auth, ...)` immediately in `setupAuth()` — redirects to login if no user
- Page-specific scripts (admin_dashboard.js, manage_loans.js, etc.): assume layout has already gated auth
- **Logout path:** sidebar button → handleLogout() in admin-layout.js → signOut(auth) → redirect to login

### Overlaps & redundancy

1. **Mobile menu creation + management:**
   - `shared-top-nav.js` injects HTML and initializes `initMobileMenuHandlers()` (sets up click listeners, exposes `window.closeMobileMenu`)
   - `unified-navigation.js` ALSO initializes mobile menu with `initializeUnifiedNavigation()` (adds listeners, exposes `window.closeMobileMenu`)
   - **Risk:** both call addEventListener on the same elements; handlers may fire twice
   - **Resolution:** unified-navigation.js runs *after* shared-top-nav.js in script order, may override handlers

2. **Sidebar creation:**
   - `admin-layout.js` creates sidebar via `buildSidebarHTML()`, injects as `<aside>` with full SPA nav
   - `shared-sidebar.js` creates sidebar via `createSidebar()`, injects as `<aside>` with separate DOM structure
   - **Status:** shared-sidebar.js is DEAD; admin-layout.js is the active implementation

3. **Hamburger menu:**
   - `hamburger.js` simple toggle (DEAD)
   - `unified-navigation.js` modern toggle with state management (ACTIVE)
   - **Resolution:** hamburger.js can be deleted

### SQL migration implications (Firebase → PHP + MySQL)

| Script | Reusable post-cutover? | Changes needed |
|---|---|---|
| `shared-top-nav.js` | YES (as-is) | No Firebase code; pure DOM injection. |
| `unified-navigation.js` | PARTIAL | Must replace `signOut(auth)` call with API POST to `/api/logout` (PHP session end). Dynamic import of firebaseConfig.js must go. |
| `admin-layout.js` | NO (major rewrite) | `onAuthStateChanged(auth, ...)` must be replaced with `fetch('/api/check-session')` polling or page-load check. User profile loads via PHP API instead of Firestore getDoc. Group name load via API. Auth redirect logic stays the same. SPA navigation intercept can stay. |
| `shared-sidebar.js` | NOT APPLICABLE | Dead code; can be deleted. |
| `hamburger.js` | NO | Dead code; can be deleted. |

### GAPS

- **No third stylesheet.** Only two nav CSS files exist (unified-navigation.css, unified-mobile-nav.css). SHARED_NAV_GUIDE.md references "`.top-nav`, `.top-nav-container`, ...", ".`mobile-menu-btn`, `.mobile-menu`, `.mobile-menu-overlay`" — all defined in unified-navigation.css; no gaps.
- **`window.auth` in shared-top-nav.js.** The logout handler at line 201–213 checks `if (window.auth && typeof window.auth.signOut === 'function')` — but `window.auth` is never set by this script or design-system.css. Fallback behavior redirects to login anyway, so functional but fragile.
- **No initTopNav() call in user_dashboard.html.** The page loads `shared-top-nav.js` but does NOT call `initTopNav()` in a script tag. Expected pattern from SHARED_NAV_GUIDE.md is missing. **Nav should be injected but apparently is not.** Inspect user_dashboard.html to confirm.

### DEAD

- **`shared-sidebar.js`** (550 lines) — not imported by any .html file. Documented in SHARED_NAV_GUIDE.md under "Shared Sidebar Component" but that guide refers to `shared-top-nav.js`, not shared-sidebar. Referenced only in BUILD_PLAN.md phase 2 ("collapse navigation cluster"). Can be deleted.
- **`hamburger.js`** (6 lines) — not imported by any .html file. Simple toggle function, superseded by unified-navigation.js. Can be deleted.
- **Duplicate CSS in user pages.** The 6 user pages load BOTH `unified-mobile-nav.css` directly *and* `design-system.css` (which imports unified-mobile-nav.css). This is a CSS include duplication, not a missing file. No harm (cascade deduplicates), but unnecessary. Recommendation: remove explicit link to unified-mobile-nav.css from the 6 pages.

## Dark-on-light contrast sweep (cycle 81)

Read-only sweep of all 21 pages' inline `<style>` blocks for white text / translucent-white borders/backgrounds rendered on a LIGHT surface (the bug class fixed in cycles 76/77/80). Run by the coordinator directly (the scout dispatch hit a session limit). Method: `grep` for `bn-white`/`rgba(255,255,255,…)`/`#fff` across all inline style blocks, then read each `color:`/`border:` hit's selector + its parent surface.

### HIT — real bug (FIXED this cycle)
- **`pages/manage_members.html`** — `.member-avatar` (:17-31), `.member-name` (:44-49), `.member-role.member` (:67-70). All three render inside `<td>` table cells (created by `createMemberRow`, `manage_members_new_sql.js:285-309`) after the cycle-71 card→table conversion. The table row background is `var(--bn-white)` (`design-system.css:771`), but these rules kept the DARK-card-era colors: `.member-name { color: var(--bn-white) }` = invisible member names on white rows; `.member-avatar { background: rgba(255,255,255,0.15); color: var(--bn-white) }` = near-invisible initials-avatar; `.member-role.member { background: rgba(255,255,255,0.2); color: var(--bn-white) }` = invisible "MEMBER" badge. Only admins (gold badge, dark text) and members with an uploaded photo showed correctly. **Fixed:** avatar → `var(--bn-gradient-primary)` navy bg + `border:none` (matching the other tables' avatars, see OK list below); name → `color: var(--bn-dark)`; member badge → `background: var(--bn-gray-100); color: var(--bn-gray-700)`.

### OK — genuinely dark surface (white-on-dark is correct, NOT a bug)
- `admin_dashboard.html` / `user_dashboard.html` — all `.sidebar-*`, `.top-nav-*`, `.mobile-menu-*`, `.hero-*`, `.topbar-avatar`, `.*-avatar`, `[data-payment-filter].active` white text sits on the navy sidebar, navy top-nav, the navy hero section, gradient/accent-filled avatar circles, or a navy-filled active tab.
- `accept_invitation.html` / `complete_profile.html` / `admin_registration.html` / `settings.html` — `.invitation-header`/`.profile-header`/`.registration-*`/`.profile-picture-section` white text sits on a `--bn-gradient-primary` navy hero. (`settings.html`'s `.profile-picture-section` confirmed `background: var(--bn-gradient-primary)`.)
- `manage_loans.html` `.loan-borrower-avatar`/`.table-borrower-avatar`, `manage_payments.html` `.payment-avatar` — `background: var(--bn-gradient-primary)` navy circles, white initials correct. **These are the consistency reference the manage_members fix now matches.**
- `manage_rules.html` `.rules-tab.active`, `manage_members.html` `.member-role.admin` (gold bg, dark text — correct), `.toast` (dark bg) — all correct-context.
- All `background: var(--bn-white)` hits (the large majority) are white CARD surfaces, not white-on-white text — not in scope for this pattern.

### Note (out of scope, not a contrast bug)
- `manage_members.html` `.member-avatar` is 64px — large for a table row (the cycle-71 note had manage_loans use a ~26px table avatar). A size-down would be consistency polish, not a correctness fix; left alone this cycle.

---

## Admin loan-approval UI surface (cycle 91 scout)

**Scope:** `pages/manage_loans.html` + `scripts/manage_loans_sql.js` only. Established exact rendering function, DOM container, apiPost target, field names, and createElement pattern for a follow-on brief to inject borrower standing panel into approval flow.

### Current approval flow

| Element | Value | Notes |
|---|---|---|
| **Render function** | `createLoanRow(loan)` at line 577 | Creates one `<tr>` for loans table. Borrower uid available as `loan.borrowerId` (line 578); borrower name as `loan.borrowerName` or resolved from `members` array. |
| **Borrower identity available at** | Lines 578–579 | `const borrower = members.find((m) => m.uid === loan.borrowerId) \|\| {}; const borrowerName = borrower.fullName \|\| loan.borrowerName \|\| "Unknown";` |
| **Pending loan approval action** | Inline row button, NOT modal | Line 689–696: `if (loan.status === "pending") { approveBtn.addEventListener("click", () => approveLoan(loan.loanId)); }` Approval is triggered by inline button in the table row, not via a modal dialog. |
| **Actions cell container** | `#loansContainer` `<tbody id="loansContainer">` (HTML line 555) | Each loan rendered as `<tr>` appended to this container. |
| **API endpoint for approval** | `loans.approve` POST at line 739 | `await apiPost("loans.approve", {loanId});` — no standing panel is fetched before approval in current code. |
| **Loans list endpoint** | `loans.list` GET at line 310 | `await apiGet("loans.list", {groupId: selectedGroupId});` Returns array of loans; each loan carries `borrowerId` field (used to filter at line 554: `filtered.filter((l) => l.borrowerId === borrowerFilter)`) |
| **How loans carry borrower uid** | Field: `loan.borrowerId` | Example: line 554 borrower filter uses `l.borrowerId`. |
| **createElement + textContent example** | Line 1519–1530 (`borrowerIdentity()` helper) | `const wrap = el("div", "table-borrower"); const avatar = el("span", "table-borrower-avatar"); avatar.textContent = initials; const nameEl = el("span", "table-borrower-name"); nameEl.textContent = safeName; wrap.append(avatar, nameEl);` All data is set via `.textContent` or DOM builders, never innerHTML. |
| **Second example: pending payment row** | Line 367–428 (`createPendingPaymentRow()`) | Line 372: `borrowerCell.appendChild(borrowerIdentity(payment.userName \|\| "Unknown"));` — same pattern. Line 382: `amountCell.textContent = formatCurrency(payment.amount);` showing currency usage. |

### Summary for next brief

**To add borrower standing panel to the approve button:**
1. When admin clicks "Approve" button for a pending loan (line 692), fetch the borrower's standing via `loans.eligibility` GET with `?uid=<borrowerId>` (admin override, being added this cycle).
2. Render a standing panel into the modal using createElement/textContent only (never innerHTML with loan data).
3. The standing panel should show: `activeLoans`, `activeLoanCount`, `totalRemaining`, `arrears`, `penalties`, `maxActiveLoans`, `eligible`, `reasons` (response fields per context brief).
4. Inject this panel into a modal OR prepend it to the existing approve-button interaction (clarify in next dispatch).
5. Both `manage_loans.html` (line 540–561 loans table) and `manage_loans_sql.js` (line 577 render function) are the only files to touch for UI wiring; API changes are backend-only.

### GAPS

None. All rendering, field names, API endpoints, and createElement patterns are documented in live code.

### DEAD

None in scope.
