# SYSTEM_MAP.md — Bank Nkhonde

> Written by `codebase-scout` (one dated `##` section per surface, appended per scout call). Curated by `doc-curator`.
> **Status: POPULATED — 16 sections, cycles 1–109.** The header formerly read "EMPTY — Phase 0 has not run yet" for the file's entire life; it was wrong from cycle 1 onward.

**How to use this file.** Find your surface in the table of contents, check its status, read only that section. **A `SUPERSEDED` section describes a stack or a state that no longer exists — never build against it.** A `CURRENT` section is true as of its cycle: anything built after that cycle is outside its claim, so if you know work has landed on that surface since, treat it as a scout candidate rather than a fact.

Per-section format (live stack): `| Feature | Page | Script(s) | Endpoint(s) ?action= | Handler fn:line | DB table(s)/columns | Auth (role) | Notes |`, followed by **GAPS** (referenced but wired to nothing) and **DEAD** (unreferenced files, `_new` twins, orphaned CSS), each with the grep that proves it.

## Table of contents

| Section | Surface it covers | Cycle | Status |
|---|---|---|---|
| Known before scanning | Pre-scan guesses: page/script/style counts, Firestore collections | 0 | ⚠ SUPERSEDED — Firebase-era, unverified |
| functions/ + deploy config | Cloud Functions callables, email senders, deploy config | 1 | ⚠ SUPERSEDED — `functions/` was deleted at D2 |
| Data model (for SQL migration) | The 32-table schema proposal extracted from Firebase-era docs | 3 | ⚠ PARTIAL — a pre-build *proposal*. The live schema is authoritative: later scout sections + BUILD_PLAN §5 (APPLIED DDL) |
| Navigation shell cluster | `nav_sql.js`, the sidebar app-shell, topbar, mobile nav | 93 | CURRENT — but the topbar gained `.topbar-switch` in cycle 110 |
| Account-statement ledger sources | `statement.php`, ledger sources, settlement columns | 92 | CURRENT |
| Loan eligibility surface | `loans.php`, `rules.php`, `payments.php`, `group_rules` columns | 90 | CURRENT — `group_rules` gained two gate columns (BUILD_PLAN §5) |
| Dark-on-light contrast sweep | Inline `<style>` blocks across all 21 pages | 81 | CURRENT (historical audit result) |
| Admin loan-approval UI surface | `manage_loans` approve/reject UI | 91 | CURRENT |
| Button/nav wiring audit | Clickable controls on the 4 dashboard/analytics pages + shell | 98 | ⚠ SUPERSEDED by "Interaction & view-switch re-audit (cycle 109)" — cycles 99–108 added substantial markup after it ran |
| Dashboard data→summary pipeline | `user_dashboard` + `admin_dashboard` fetch→render pipeline | 99 | CURRENT |
| Summary — Audit Results | Tail of the cycle-98 button audit | 98 | ⚠ SUPERSEDED — same as the cycle-98 audit above |
| Analytics Financial Trends pipeline | `analytics.html` data→render, `payments.accountingSummary` reuse | 100 | CURRENT |
| I5 tooltip-rollout scoping | Card "i" popover mechanism + rollout targets | 101 | CURRENT |
| user_analytics.html data & content pipeline | Member analytics page fetch→render | 104 | CURRENT |
| Interaction & view-switch re-audit | Clickable-surface + admin↔user switch, re-audited live | 109 | CURRENT — supersedes the cycle-98 audit. Note: its "data-dead group-stat cards" finding was **disproved** on live re-read (BUILD_PLAN cycle-111 note) |
| Visual & responsive audit | Overflow culprits + Collection Trends chart | 109 | CURRENT — note: its "disconnected pie charts" reading of the trend chart was **wrong**; the chart is a grouped bar chart and only the pie helper was read |
| Member loan-origination surface | Member-initiated loan request UI + endpoint contract | 118 | CURRENT |
| group_rules penalty schema & live values | Live penalty columns, types, defaults + per-group values for J2 DDL | 119 | CURRENT |
| Accounting-figure display surface | Ten cumulative group accounting figures across five pages, sources, verdicts, and live reconciliation | 121 | CURRENT |
| Accounting drill-down surface | Group accounting position cards, modal mechanics, per-figure drill-down row sources | 125 | CURRENT |

## Known before scanning (from setup scan, unverified detail)

> ⚠ **SUPERSEDED (Firebase-era, cycle 0).** Pre-scan guesses about a stack that no longer exists. Kept for history; do not build on this.

- Pages: 21 in `pages/` + `index.html`, `login.html`, `404.html` at root.
- Scripts: 55 in `scripts/`. Barrel is `firebaseConfig.js`.
- Styles: 20 in `styles/`. Token source is `design-system.css`.
- Server: `functions/index.js` only.
- Collections seen in `firestore.rules`: `users`, `groups`, `groups/{groupId}/members`. Loan/payment/contribution paths **not yet confirmed** — a scout must establish them.

## functions/ + deploy config

> ⚠ **SUPERSEDED (Firebase-era, cycle 1).** The entire `functions/` directory, `firebaseConfig.js`, `firestore.rules` and `firestore.indexes.json` were **deleted** at deliverable D2 (cycle 46, owner sign-off). Email now goes through SMTP from `.env`; the auth gate is `require_role()` in `api/lib/session.php`. Kept for history; do not build on this.

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

> ⚠ **PARTIAL — this is a pre-build *proposal*, not the live schema (cycle 3).** It was extracted from Firebase-era documentation before the tables existed, and the live database has diverged (e.g. `payments` is a single table, not the three-table structure proposed here; `group_rules`, `loans` and `users` have gained columns). **Authoritative sources for the live schema, in order: a `DESCRIBE` against the live DB → BUILD_PLAN §5 (APPLIED DDL) → the later scout sections.** Use this only for intent and field naming.

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

## Navigation shell cluster (cycle 93 scout)

**Scope:** Map the live navigation renderer (`nav_sql.js`, `admin-layout.css`) and document how both user top-nav and admin sidebar shells are wired; identify which pages are bound to which shell and what pre-mainContent chrome each carries.

**Real as-built:** The live nav stack is **single-entry-point** (`scripts/nav_sql.js` only). Both user top-nav and admin sidebar/topbar/mobile-nav are rendered from the same module. No `shared-top-nav.js`, `admin-layout.js`, or `unified-navigation.js` are in use on SQL-era pages. Deleted Firebase twins (`user_dashboard_new.html`, `manage_members_new.html`) and their associated `*_new.js` scripts remain on disk but are unreferenced.

### 1. VARIANT DISPATCH & ROLE SOURCE

**How variant is chosen (page → nav shell):**
- `page-bootstrap.js` (line 35–45) reads `<body data-nav-variant>` attribute via `document.body.dataset.navVariant`
- Forwards it to `initNav()` as `opts.variant` (line 38 in page-bootstrap.js; parameter at line 845 in nav_sql.js)
- **If `variant === "admin"`** → calls `renderAdminNav()` (line 854 in nav_sql.js)
- **Otherwise (default "user")** → calls `renderUserNav()` (line 865 in nav_sql.js)

**User object & role:**
- Fetched via `await getSession()` (line 849 in nav_sql.js) → calls `api.js:getSession()` (PHP backend, `/api/index.php?action=auth.session`)
- Role field: `user.role` (accessed at line 657 in nav_sql.js when rendering admin sidebar)
- **ADMIN_ROLES constant** (line 27 in nav_sql.js): `["admin", "senior_admin", "treasurer"]`
- Role-gate example: line 184 in nav_sql.js, `switchGroup()` checks if `group.myRole` is in ADMIN_ROLES to choose dashboard URL

### 2. renderAdminNav() INSERTION POINTS (sidebar/topbar/mobile-nav factory)

| Element | Line(s) | Insertion location | Details |
|---|---|---|---|
| Sidebar + overlay | 681–687 | Before `#mainContent` (as siblings) | `mainContent.parentElement.insertBefore(sidebar, mainContent)` and overlay before mainContent |
| Topbar header | 744–748 | First child of `#mainContent` | `mainContent.insertBefore(topbar, mainContent.firstChild)` — sticky header with title, date, notifications, avatar |
| Mobile bottom nav | 779 | Appended to `<body>` | `.mobile-nav` fixed-position 5–6 icon tabs (partial ADMIN_NAV_ITEMS + "Switch to User View") |
| "Switch to User View" footer link | 623–631 | `.sidebar-footer` | Hardcoded `href="user_dashboard.html"` (line 624) |
| Sidebar logo href | 591 | `.sidebar-header` | Hardcoded `href="admin_dashboard.html"` (line 591) |

### 3. renderUserNav() OUTPUT & INSERTION (top-nav + mobile slide menu factory)

| Element | ID | Class | Line(s) | Insertion | Details |
|---|---|---|---|---|---|
| Top navigation bar | N/A | `.top-nav` | 318 | Prepended to `<body>` (line 488) | Sticky, dark background, logo + optional group-switcher + actions (notifications, logout, avatar, burger) |
| Logo | N/A | `.top-nav-logo` | 324 | Inside `.top-nav-container` | Hardcoded href to `logoLink` option (defaults to `user_dashboard.html`) |
| Group switcher | `currentGroupDisplay` | `.current-group-display` | 213 | Only if `showGroupDisplay: true` | Chip + dropdown (id `currentGroupToggle` on button, line 218); populated from `listMyGroups()` |
| Notifications button | `notificationsBtn` | `.top-nav-btn` | 371 | `.top-nav-actions` | Bell icon; calls `window.toggleNotifications()` if available; badge id `notificationBadge` (line 375) |
| Logout button | `logoutBtn` | `.top-nav-btn` | 388 | `.top-nav-actions` | Calls `handleLogout()` directly |
| User avatar | `userAvatar` | `.top-nav-avatar` | 398 | `.top-nav-actions` | Links to `settings.html`; shows profile image or initials (id `userInitials`, line 408) |
| View toggle (admin/user) | `viewToggle` | `.view-toggle` | 349 | `.top-nav-actions` | Only if `showViewToggle: true`; "Admin" button navigates to `admin_dashboard.html` |
| Burger menu button | `mobileMenuBtn` | `.mobile-menu-btn` | 420 | `.top-nav-container` | Toggles mobile menu; aria-controls `mobileMenu` (line 423) |
| Mobile menu (slide panel) | `mobileMenu` | `.mobile-menu` | 435 | Prepended to `<body>` (line 486) | Slides in from right; contains Dashboard, Settings, Sign Out links |
| Mobile overlay | `mobileMenuOverlay` | `.mobile-menu-overlay` | 431 | Prepended to `<body>` (line 487) | Dismisses menu on click; fixed inset, semi-transparent |
| Menu close button | `mobileMenuClose` | `.mobile-menu-close` | 446 | Inside `.mobile-menu-header` | SVG close icon; aria-label "Close menu" |

### 4. admin-layout.css SHELL CONTRACT (styles for sidebar+topbar variant)

| Selector | Line range | Role | Notes |
|---|---|---|---|
| `.sidebar` | 18–30 | Fixed sidebar column, left side | width: var(--sidebar-width) (280px); z-index: var(--z-fixed); flex column |
| `.sidebar-overlay` | 564–570 | Mobile overlay behind sidebar | Fixed inset, rgba(10,22,40,0.5) bg, z-index calc(--z-fixed - 1); display: none by default; shown @media ≤1024px |
| `.topbar` | 306–319 | Sticky header above content | height: var(--topbar-height) (72px); z-index: var(--z-sticky); flex row, space-between |
| `.main-content` | 298–301 | Content wrapper with sidebar offset | **margin-left: var(--sidebar-width)**; min-height: 100vh |
| `.dashboard-content` | 508–511 | Padding container inside main | padding: var(--bn-space-6) var(--bn-space-8); position: relative |
| `.mobile-nav` | 516–526 | Fixed bottom navigation | display: none by default; shown @media ≤1024px; position: fixed bottom; z-index: var(--z-fixed) |

**Responsive:** @media (max-width: 1024px) — sidebar slides from left (transform: translateX(-100%)), overlay visible, mobile-nav shown, margin-left removed. @media (max-width: 768px) — topbar padding reduced, .dashboard-content padding reduced.

### 5. SIX USER PAGES — Pre-mainContent chrome, main structure, stylesheets

All six pages use `data-nav-variant="user"` in `<body>` tag; none load `admin-layout.css`.

| Page | Body attrs | Pre-mainContent chrome | Main structure | Stylesheets (rel="stylesheet") | Notes |
|---|---|---|---|---|---|
| `user_dashboard.html` | Line 2082: `data-nav-variant="user"` + `data-nav-show-group-display="true"` + `data-nav-show-view-toggle="true"` + `data-nav-logo-link="../index.html"` | `<section class="hero-section">` (lines 2084–2172): greeting, stats band, quick actions, all inside dark gradient | `<main class="main-content" id="mainContent"><div class="dashboard-content">` (lines 2172+) | design-system.css, unified-navigation.css, unified-mobile-nav.css | Hero block to be relocated into .dashboard-content by C8 |
| `view_rules.html` | Line 168: `data-nav-variant="user"` + `data-nav-active-page="view_rules"` | `<header class="page-header">` (lines 170–186): back button, title, subtitle | `<main class="main-content" id="mainContent"><div class="dashboard-content">` (lines 189–190) | design-system.css, pages.css, unified-navigation.css, unified-mobile-nav.css | Page header with gradient background (pages.css) |
| `user_analytics.html` | Line 201: `data-nav-variant="user"` + `data-nav-active-page="user_analytics"` | `<header class="page-header">` (lines 203–243): back button, title, group selector, stats summary | `<main class="main-content" id="mainContent"><div class="dashboard-content">` (lines 246–247) | design-system.css, pages.css, unified-navigation.css, unified-mobile-nav.css | Page header + pre-mainContent selector & stats |
| `loan_payments.html` | Line 186: `data-nav-variant="user"` + `data-nav-active-page="loan_payments"` | `<header class="page-header">` (TBD — not fully read) | `<main class="main-content" id="mainContent"><div class="dashboard-content">` (TBD) | design-system.css, pages.css, unified-navigation.css, unified-mobile-nav.css | Page header (pages.css style) |
| `contacts.html` | Line 420: `data-nav-variant="user"` + `data-nav-active-page="contacts"` | `<header class="page-header">` (TBD — not fully read) | `<main class="main-content" id="mainContent"><div class="dashboard-content">` (TBD) | design-system.css, pages.css, unified-navigation.css, unified-mobile-nav.css | Page header (pages.css style) |
| `messages.html` | Line 313: `data-nav-variant="user"` + `data-nav-active-page="messages"` | `<header class="page-header">` (TBD — not fully read) | `<main class="main-content" id="mainContent"><div class="dashboard-content">` (TBD) | design-system.css, pages.css, unified-navigation.css, unified-mobile-nav.css | Page header (pages.css style) |

### 6. user_dashboard.html HERO SECTION LINE RANGE

**Lines 2084–2172:** Full block from `<section class="hero-section">` to closing `</section>`. Contains:
- Greeting + user name (line 2088)
- Current group display element (line 2089, shown only if showGroupDisplay: true)
- Stats band (hero-stats) with 6 clickable stat cards (lines 2095–2136)
- Quick Actions button grid (lines 2139–2170)

### 7. PAGE-SCRIPT COUPLING — Top-nav DOM IDs referenced by scripts

| ID | Class | Script file:line | Usage |
|---|---|---|---|
| `userInitials` | `.top-nav-avatar` child span | user_dashboard_sql.js:193 | setText("userInitials", ...) — updates with display name |
| `userAvatar` | `.top-nav-avatar` link | user_dashboard_sql.js:195 | Updates src if profile image available |
| `viewToggle` | `.view-toggle` container | user_dashboard_sql.js:223 | Toggle visibility based on admin status |
| `currentGroupDisplay` | `.current-group-display` | user_dashboard_sql.js:321 | Show/hide based on whether user has groups |
| `currentGroupToggle` | `.current-group-toggle` button | user-dashboard-view-groups.js:7 | Reference to group switcher for re-initialization |
| `mobileMenuBtn` | `.mobile-menu-btn` | user_dashboard_sql.js:1697, 1890, 1905 | Burger button DOM; accessed 3 times (mobile menu wiring) |
| `notificationsBtn` | `.top-nav-btn` | notifications-handler_sql.js:45 | Bell button; toggles notification panel |
| `.top-nav` | Top nav container | spa-router.js:493 | Removed from DOM during SPA navigation (line 493 removes ".top-nav, #mobileMenuOverlay, #mobileMenu") |
| `#mobileMenuOverlay` | Mobile overlay | spa-router.js:493 | Removed during SPA navigation |
| `#mobileMenu` | Mobile slide menu | spa-router.js:493 | Removed during SPA navigation |

**Impact:** Pages that migrate from user top-nav shell to admin sidebar shell must remove references to these IDs from their page scripts, or ensure the IDs no longer exist (sidebar renders different elements). Sidebar variant creates `#sidebar`, `#sidebarOverlay`, `#topbar`, `#topbarAvatar`, `#notificationBadge` (topbar), `#mobileMenuBtn` (topbar only, not user nav), and `.mobile-nav` (different from user `.mobile-menu`).

### GAPS

1. **loan_payments.html, contacts.html, messages.html** — Pre-mainContent chrome and main structure not fully read; assume same `<header class="page-header">` + `<main class="main-content">` pattern as view_rules.html and user_analytics.html, but needs confirmation.
2. **Data retrieval flow** — No trace of where `initNav()` is called or how `getSession()` decides role/groups; assume PHP backend `/api/index.php?action=auth.session` exists but not mapped.
3. **Sidebar active-page highlighting** — `updateActiveNav()` (line 886 in nav_sql.js) updates `[data-nav]` elements on the admin sidebar, but no trace of which admin page calls this or how SPA router integrates (see spa-router.js:525 "no rebuild").

### DEAD

1. **scripts/shared-top-nav.js** — Not imported; SYSTEM_MAP ~line 189 references it as active, contradicted by live nav_sql.js. Candidate for deletion.
2. **scripts/admin-layout.js** — Not imported; SYSTEM_MAP ~line 190 references it, but sidebar is rendered by nav_sql.js. Candidate for deletion.
3. **scripts/unified-navigation.js** — Not imported by any _sql.js page. Candidate for deletion.
4. **pages/user_dashboard_new.html** + **scripts/user_dashboard_new_sql.js** — Duplicate of user_dashboard.html; unreferenced. Same for manage_members_new.html + manage_members_new_sql.js.
5. **styles/unified-navigation.css** — Loaded by all user pages but styles are inlined in page `<style>` blocks or exist as dead orphan rules.

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

---

## Button/nav wiring audit (cycle 98 scout)

> ⚠ **SUPERSEDED by "Interaction & view-switch re-audit (cycle 109 scout)".** This audit declared every control wired, and was accurate on the day it ran — but cycles 99–108 added a large amount of new markup afterwards (an accounting-figures block, 5 loan cards, 3 group-stats cards, breakdown popovers, 18 card popovers), and by cycle 109 the owner was hitting real problems on surfaces this section vouches for. Kept for history; do not cite it as current wiring.

**Scope:** pages/user_dashboard.html, admin_dashboard.html, analytics.html, user_analytics.html + paired _sql.js scripts + shared nav_sql.js and notifications-handler_sql.js.

### Q1: notificationsBtn — Status: WIRED ✓

| Control | Location | Handler | Details |
|---------|----------|---------|---------|
| `#notificationsBtn` | nav_sql.js:353 | notifications-handler_sql.js:59 | Bell icon button created by renderSidebarNav() (admin variant) and renderUserNav() (user variant). Click listener opens dropdown, calls loadNotifications(). Badge auto-updates via polling every 60s (POLL_INTERVAL_MS = 60000 at line 29). |

**Evidence:** 
- nav_sql.js line 353: `const notifBtn = document.createElement("button"); notifBtn.type = "button"; notifBtn.className = "topbar-btn"; notifBtn.id = "notificationsBtn"; notifBtn.setAttribute("aria-label", "Notifications"); notifBtn.appendChild(svgIcon("bell"));`
- nav_sql.js lines 356–360: Badge span created and appended to notifBtn.
- notifications-handler_sql.js line 59: `notificationBtn.addEventListener("click", (e) => { e.stopPropagation(); if (dropdown.classList.contains("show")) { closeDropdown(dropdown); } else { openDropdown(dropdown); loadNotifications(); } });`
- Line 45 checks `if (!notificationBtn) return;` — gracefully no-ops if markup is missing.

---

### Q2: Admin↔User view switch — Status: WIRED ✓

| Control | Location | Handler | Details |
|----------|----------|---------|---------|
| `#viewToggle` (user page) | user_dashboard.html:206–217 | user_dashboard_sql.js:224 | Two-button toggle ("Admin" / "User" view). Visible only if user is admin-role in current group. "Admin" button has onclick="window.location.href='admin_dashboard.html'". |
| Switch link (admin page) | nav_sql.js:254–263 | admin_dashboard_sql.js:1302–1305 | "Switch to User View" link injected into sidebar footer via renderSidebarNav() footerSwitch config. querySelector listener on `'a.sidebar-nav-item[href="user_dashboard.html"]'` navigates to user_dashboard.html. |

**Evidence:**
- user_dashboard.html line 206–217: `<div class="view-toggle">` with two buttons inside (no ids, class-based styling).
- user_dashboard_sql.js line 224: `const viewToggle = document.getElementById("viewToggle"); if (viewToggle) viewToggle.classList.toggle("hidden", !isAdmin);` — toggles visibility based on isAdmin flag.
- nav_sql.js line 254–263: If footerSwitch config exists, builds link: `const switchUserLink = document.createElement("a"); switchUserLink.href = footerSwitch.href; switchUserLink.className = "sidebar-nav-item";` (footerSwitch.href hardcoded to "user_dashboard.html" or "admin_dashboard.html" depending on which shell).
- admin_dashboard_sql.js line 1302: `document.querySelector('a.sidebar-nav-item[href="user_dashboard.html"]')?.addEventListener("click", () => { window.location.href = "user_dashboard.html"; });`

---

### Q3: Card info "i" helper — Status: WIRED ✓

| Control | Location | Handler | Details |
|----------|----------|---------|---------|
| `.stat-card-info-toggle` (4 buttons) | admin_dashboard.html:1629, 1637, 1645, 1653 | admin_dashboard_sql.js:1343–1370 | Four small "i" buttons (italic text) for stat-card popovers (Collections, Loans, Pending, Arrears). Toggle popover.open class on click (touch/mobile tap). CSS handles hover/focus-within for desktop. Keyboard accessible (aria-expanded + focus-visible outline). |

**Evidence:**
- admin_dashboard.html line 1629: `<button type="button" class="stat-card-info-toggle" aria-expanded="false" aria-controls="totalCollectionsPopover" aria-label="Collections breakdown">i</button>` — repeated for all 4 stat cards.
- admin_dashboard_sql.js line 1343–1370 (setupStatCardPopovers):
  - Line 1355: `const toggle = wrap.querySelector(".stat-card-info-toggle");`
  - Line 1357: `toggle.addEventListener("click", (e) => { e.stopPropagation(); const willOpen = !popover.classList.contains("open"); closeAll(willOpen ? popover : null); popover.classList.toggle("open", willOpen); toggle.setAttribute("aria-expanded", String(willOpen)); });`
- Line 1332 in setupEventListeners: `setupStatCardPopovers();` is called on init.
- admin_dashboard.html line 1630, 1638, 1646, 1654: `<div class="stat-card-popover" id="totalCollectionsPopover" role="status"></div>` — target elements exist for each button.

---

## Dashboard data→summary pipeline (cycle 99 scout)

**Scope:** Map as-built data flow for month-filter briefing: `pages/user_dashboard.html` + `scripts/user_dashboard_sql.js` and `pages/admin_dashboard.html` + `scripts/admin_dashboard_sql.js` only. Identify (1) API actions fetched on load + data shapes, (2) every summary/stat figure shown + whether it's client-array-filterable or server-total-only, (3) where month/period control could sit, (4) DOM helpers for follow-on brief.

### 1. User Dashboard — API Actions & Data Shapes

**Fetched on load (loadDashboard, line 388–397):**
| Action | Line | HTTP | Returns | Key date/month fields per record |
|--------|------|------|---------|----------------------------------|
| `payments.obligations` | 393 | GET | summary {contributed, arrears, penaltyAccrued} + seedMoney/monthlyContributions/serviceFee objects | seedMoney: dueDate; monthlyContributions.months[]: month (ENUM Jan–Dec), year, dueDate, approvalStatus; serviceFee: dueDate |
| `payments.list` | 394 | GET | {payments: []} with rows | month (ENUM), year (INT), dueDate, paidAt, approvedAt, approvalStatus |
| `loans.list` | 395 | GET | {loans: []} with rows | approvedAt, repaymentPeriod (for maturity calc) |
| `members.list` | 396 | GET | {members: []} with rows | status (to filter active) |

**Cached after load (line 416–421):** window.__dashboardData = {obligations, payments, loans} for modal/calendar re-render without re-fetch.

### 2. User Dashboard — Summary Figures & Filterability

| Stat/Figure | Element ID | Setter fn:line | Data source | Type | Notes |
|---|---|---|---|---|---|
| Total Contributed | `totalContributed` | line 474: setText(fmt(summary.contributed)) | payments.obligations → summary | server-total-only | Pre-summed on backend, never recalculated client-side |
| Pending Payments | `pendingPayments` | line 483: setText(fmt(sum of pending rows)) | payments.list array | client-array | Sums rows where approvalStatus='pending'; re-aggregatable |
| Total Arrears | `totalArrears` | line 489: setText(fmt(arrears + penalties)) | obligations summary | client-array | arrearsMinor + penaltyAccrued from summary |
| Active Loans (count) | `activeLoans` | line 495–499: count of status='approved' or 'disbursed' | loans.list array | client-array | Filter-ready |
| Group Members (count) | `totalMembers` | line 748: count of status!='inactive' | members.list array | client-array | Filter-ready |
| Next Payment (amount + date) | `nextPaymentDetails` / `nextPaymentStat` | line 779: setText(fmt + date) | obligations months | client-array | Finds earliest unpaid obligation; re-derivable month-wise |
| Upcoming Payments (list) | `upcomingPayments` | line 837: renders table | obligations (60-day window) | client-array | Window-filterable |
| Active Loans (received + balance) | `activeLoansDetails` | line 1016–1021: sums received/balance | loans.list array | client-array | Per-loan data available |

**Payment Calendar (line 1165+):** Already renders month-by-month from cached data; navigation (prev/next) re-renders using existing eventMap (no server call). **Month control already present:** `#calendarPrevMonth` / `#calendarNextMonth` buttons (lines 1762–1766), month/year display (line 1169 `calendarMonthYear`).

### 3. Admin Dashboard — API Actions & Data Shapes

**Fetched on load (loadDashboardAfterGroupSelection, line 148–152):**
| Action | Line | HTTP | Returns | Key date/month fields per record |
|--------|------|------|---------|----------------------------------|
| `payments.list` | 149 | GET | {summary: {verifiedCollected, totalArrears}, payments: []} | month (ENUM), year, createdAt, paidAt, arrears, penalty.amountAccrued |
| `loans.list` | 150 | GET | {loans: []} with rows | createdAt, approvedAt, status |
| `members.list` | 151 | GET | {members: []} with rows | uid, fullName, status |
| `payments.groupArrears` | 152 | GET | {totalArrears, arrears, penaltyAccrued, memberCount} | (aggregate only; no per-record dates) |

**Cached after load (line 161–174):** groupData = {payments, loans, members, summary, groupArrears} for modal re-render.

### 4. Admin Dashboard — Summary Figures & Filterability

| Stat/Figure | Element ID | Setter fn:line | Data source | Type | Notes |
|---|---|---|---|---|---|
| Total Collections | `totalCollections` | line 291–293: setText(fmt(summary.verifiedCollected)) | payments.list → summary | server-total-only | Pre-summed on backend; no client re-aggregation |
| Active Loans (count) | `activeLoans` | line 294: count of status in [approved, disbursed] | loans.list array | client-array | Filter-ready |
| Pending Approvals | `pendingApprovals` | line 295: count of pending payments + loans | payments.list + loans.list arrays | client-array | Two separate filters, summed |
| Total Arrears | `totalArrears` | line 305: setText(fmt(groupArrears.totalArrears)) | payments.groupArrears OR summary | server-total-only | Group-wide obligation arrears (includes members with zero payment rows); falls back to summary if groupArrears unavailable |
| Collection Trends (pie charts) | `chartContainer` | line 319–484: renderCollectionTrends() | payments.list (filtered by range) | client-array | **Already has month/period select:** `#collectionTrendsRangeSelect` (line 328–329) with options "6", "12", "all". Client-side filters rangedPayments by createdAt (or paidAt fallback) within cutoff. Re-renders pie charts on select change (line 1330) |
| Due Payments This Month | `duePaymentsCards` | line 825–883: loadDuePayments() | payments.list filtered by current month/year | client-array | Filters by paymentType='monthly_contribution' + month=current + year=current; scopes to arrears > 0 |

**Collection Trends Range Select already exists (line 328):** `<select class="form-select content-card-header-select" id="collectionTrendsRangeSelect">` with options "Last 6 months" / "Last year" / "All time". **No additional month control needed for admin dashboard** — filtering is already functional.

### 5. Month/Period Control Insertion Points

**user_dashboard.html:**
- Payment Calendar (line 1165–1272): Already has month navigation. No new control needed.
- Upcoming Payments modal (can be opened but data already loaded): month-aware, but no monthly filter UI.
- **Candidate insertion:** A month select above the "Upcoming Payments" list (lines 826–837) could filter by month; currently shows 60-day window only.

**admin_dashboard.html:**
- Collection Trends (line 319–484): **ALREADY HAS `#collectionTrendsRangeSelect`** (lines 728–738 in HTML). No new control needed.
- Due Payments This Month (line 825–883): Hardcoded to current month. Could add a select to view prior/future months, but "This Month" is semantically clear.

### 6. DOM Builders & Toast Helpers

**user_dashboard_sql.js:**
- **createElement + textContent pattern:** Lines 277–315 (buildGroupCard); line 1212–1269 (renderCalendarGrid); line 1453–1486 (buildNotificationRow) — all use createElement("div"), textContent for text, classList for styling.
- **Toast helper:** `showToast(message, type)` at line 2830–2855 (creates div.toast in #toastContainer, auto-removes after 4s).
- **Money helpers:** `toMinor(value):int` (line 2864–2874), `fromMinor(cents):string` (line 2881–2887).
- **Date parser:** `parseServerDate(value):Date|null` (line 2896–2901), `formatDate(date):string` (line 2918–2924).

**admin_dashboard_sql.js:**
- **createElement + textContent pattern:** Lines 640–669 (buildGroupSelectionCard); lines 752–802 (buildApprovalRow); lines 1165–1206 (buildStatModalItem) — same pattern, no innerHTML.
- **Toast helper:** `showToast(message, type)` at line 1666–1691 (identical to user_dashboard).
- **Money helpers:** `toMinor(value):int` (line 1725–1735), `fromMinor(cents):string` (line 1742–1748), `formatCurrencyShort(value):string` (line 1755–1757), `formatCurrencyShortFromMinor(cents):string` (line 1764–1772).
- **Date parser:** `parseServerDate(value):Date|null` (line 1781–1786), `formatDateShort(date):string` (line 1793–1795).

### 7. Verdict: Client Re-aggregation vs. Server ?month Call

**user_dashboard:**
- **Client re-aggregation suffices** for obligations, loans, members, and upcoming-payment lists (all arrays fetched, month fields present).
- Calendar already re-renders on month nav without server call.
- **However:** No server ?month call for payment.obligations exists yet (uses fixed `year` param only). If admin-facing month filter on obligations is needed, a `?month` parameter to payments.obligations could be added (backend not checked this cycle).

**admin_dashboard:**
- **Collection Trends:** Client re-aggregation only (no server call on range select; filters existing array).
- **Due Payments:** Client re-aggregation only (filters payments.list by current month).
- **Collections & Arrears totals:** Already server-totals (summary.verifiedCollected, groupArrears.totalArrears); no month scoping on these pre-summed figures.
- **If monthly breakdown of collections is needed:** payments.list already carries month/year per row; client can re-sum. No server call needed.
- **Verdict:** No server ?month calls needed for current admin dashboard. Month filtering is client-side re-aggregation of already-fetched arrays.

### GAPS

1. **user_dashboard.html:** Upcoming Payments modal (line 1645–1668) re-renders from cached obligations but has no UI to select a specific month — defaults to 60-day window. A month picker could improve UX.
2. **admin_dashboard.html:** Due Payments hardcoded to current month (line 830). A month/year selector could show past/future obligations, but is not critical (title says "This Month").
3. **No server `?month` parameter on payments.obligations yet.** If member/admin wants to view obligations for a specific past/future month, server call is needed (not implemented).

### DEAD

None in scope.

---

### Q4: user_analytics page — Status: READ-ONLY (interactive selectors only, no clickable cards)

| Element | Type | Handler | Wiring |
|---------|------|---------|--------|
| `#groupSelector` select | Form control | user_analytics_sql.js:100 | Change event listener loads group data (loadGroupData()). Populated from listMyGroups(). |
| `#statementYearFilterEl` select | Form control | user_analytics_sql.js:125 | Change event listener reloads account statement (loadAccountStatement()). |
| `#statementExportBtnEl` button | Button | user_analytics_sql.js:130 | Click listener calls downloadExport("exports.statement", {groupId}). |
| Stat-card divs (`.stat-card`) | Display only | None | textContent populated from API; no onclick, no event listeners attached by JS. |
| Recent Activity section | Display only | None | HTML injected from API (createElement + textContent only). |

**Evidence:**
- user_analytics_sql.js line 76: `const groupSelectorEl = () => document.getElementById("groupSelector");`
- user_analytics_sql.js line 100: `groupSelectorEl()?.addEventListener("change", async (e) => { currentGroupId = e.target.value; if (currentGroupId) { sessionStorage.setItem("selectedGroupId", currentGroupId); await loadGroupData(); } else { ... } });`
- user_analytics_sql.js line 80: `const statementExportBtnEl = () => document.getElementById("statementExportBtn");`
- user_analytics_sql.js line 130: `statementExportBtnEl()?.addEventListener("click", () => { if (!currentGroupId) { showToast("Select a group first", "info"); return; } downloadExport("exports.statement", {groupId: currentGroupId}); });`
- user_analytics.html lines 231–255: stat-cards are plain `<div class="stat-card">` with no id, no onclick, no data-action attributes.

**Conclusion:** Page is a DISPLAY surface. Only the two `<select>` elements and export button are interactive; everything else is read-only stat rendering via textContent from loadTopStats(), loadGroupStats(), etc.

---

### Q5: analytics "Financial Trends" filters — Status: WIRED ✓ (tabs reload same monthly view)

| Control | Location | Handler | Details |
|---------|----------|---------|---------|
| Tab buttons (Week / Month / Year) | analytics.html:177–181 | analytics_sql.js:135–147 | Click handler toggles .active class and reruns loadAnalytics(). Toast warns "Week/Year breakdowns are not available yet — showing the monthly view" (line 140). All three tabs call the same loadAnalytics() function; no week/year data endpoint exists. |

**Evidence:**
- analytics.html lines 177–180: `<div class="tabs">` with three `.tab` buttons: `<button class="tab">Week</button>` `<button class="tab active">Month</button>` `<button class="tab">Year</button>`.
- analytics_sql.js line 123: `setupEventListeners()` function called on init (line 105).
- analytics_sql.js lines 135–147:
  - `document.querySelectorAll(".tab").forEach((tab) => { tab.addEventListener("click", async () => { document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active")); tab.classList.add("active"); if (tab.textContent?.trim() !== "Month") { showToast("Week/Year breakdowns are not available yet — showing the monthly view.", "info"); } if (currentGroupId) { await loadAnalytics(); document.getElementById("memberPerformanceTable")?.scrollIntoView({ behavior: "smooth", block: "start" }); } }); });`
- Line 192 (loadAnalytics): loads same data for all tabs; no week/year filtering logic.
- Line 60 (MONTH_NAMES constant): only months available, not weeks or quarters.

---

## Summary — Audit Results

> ⚠ **SUPERSEDED — this is the tail of the cycle-98 button audit above.** See that section's banner for why. Superseded by "Interaction & view-switch re-audit (cycle 109 scout)".

**WIRED CONTROLS (all functional, no gaps):**
1. ✓ notificationsBtn — bell icon, dropdown, polling badge refresh every 60s
2. ✓ Admin↔User view switch — toggle buttons + nav injection + querySelector listeners
3. ✓ Stat-card "i" popovers — 4 info toggles wired to setupStatCardPopovers() (mobile tap + desktop hover)
4. ✓ user_analytics selectors — groupSelector + statementYearFilter change handlers + export button
5. ✓ analytics tab buttons — all wired (Week/Year stubs show toast; Month is live)

**DEAD/MISSING CONTROLS:** None detected.

**READ-ONLY PAGES:**
- user_analytics.html — display surface; only selectors + export button interactive.

**GAPS/DEFERRED (UI wired but backend missing):**
- Week/Year tab granularity in analytics.html exists (UI event listeners active) but API has no day-level or year-level `payments.list` endpoint. Stubs show toast + reload monthly view unchanged (line 140).
- CSV export on analytics_sql.js mentions "CSV/PDF export of charts or tables" as DEFERRED (lines 49–52); no `exports.analytics` handler exists yet (different from `exports.statement`).

---

## Analytics Financial Trends pipeline (cycle 100 scout)

### (1) Financial Trends section structure (analytics.html)

**Container:** `<section class="content-section">` (lines 173–191)
- Header: `<div class="content-section-header">` (line 175)
  - Title: `<h2 class="content-section-title">Financial Trends</h2>` (line 176)
  - Tabs: `<div class="tabs">` (line 177)
    - `<button class="tab">Week</button>` (line 178)
    - `<button class="tab active">Month</button>` (line 179)
    - `<button class="tab">Year</button>` (line 180)
- Body: `<div class="content-section-body" id="chartsContainer">` (line 183)
  - Monthly trend chart: `<div id="monthlyTrendChart" class="monthly-trend-chart">` (line 184)
  - Pie charts grid: `<div class="charts-grid" id="chartContainer">` (line 187)

**Summary stat tiles above Financial Trends (lines 154–171):**
- `<div class="page-stats">` (line 154)
  - `<div class="page-stat-value info" id="totalIncome">` (line 156)
  - `<div class="page-stat-value danger" id="totalExpenses">` (line 160)
  - `<div class="page-stat-value success" id="netProfit">` (line 164)
  - `<div class="page-stat-value warning" id="loanInterest">` (line 168)

**Member Performance section (lines 193–218):**
- Table: `<table class="table table-responsive" id="memberPerformanceTable">` (line 200)
- Table body: `<tbody id="memberPerformance">` (line 210)

### (2) API actions fetched by loadAnalytics (line 192) + returned shapes + filterability

| API action | Fetch call (file:line) | Returns | Per-record structure | Filterability verdict |
|---|---|---|---|---|
| members.list | analytics_sql.js:211 | `{members: [{uid, fullName, ...}]}` | Array, no date/month field | **server-total-only** (lookup table only) |
| payments.list | analytics_sql.js:221 | `{payments: [{paymentType, approvalStatus, amountPaid, month, createdAt/paidAt, ...}]}` | Array with `month` field (string name, e.g. "January") | **client-array (filterable by month)** — used in renderSummaryTiles (line 286) and renderMonthlyTrendChart (line 325) with `.filter((p) => p.paymentType === "monthly_contribution" && SETTLED_STATUSES.includes(p.approvalStatus))` and `.forEach((p) => { const idx = MONTH_NAMES.indexOf(p.month); ...})` |
| loans.list | analytics_sql.js:231 | `{loans: [{principalAmount/approvedAmount, status, disbursedAt, approvedAt, totalInterest, amountRepaid, remainingBalance, ...}], summary: {totalPrincipal, totalOutstanding, totalInterest, activePrincipal}}` | Array with `disbursedAt` and `approvedAt` (date strings). Summary block is group-wide single total. | **client-array (filterable by disbursedAt/approvedAt date field)** — used in renderSummaryTiles (line 300) with `.filter((l) => ISSUED_LOAN_STATUSES.includes(l.status))` and renderMonthlyTrendChart (line 335) with date extraction `.forEach((l) => { const when = l.disbursedAt \|\| l.approvedAt; ...const d = new Date(when); ...const idx = d.getMonth();...})` |
| cycle.equity | analytics_sql.js:244 | `{summary: {groupInterestPool, ...}, members: [{fullName, totalContributed, totalBorrowed, totalInterestPaid, needsForcedLoan, shortfallVsTarget, ...}]}` | `members` is array with no date field; `summary` is single group-wide object. | **server-total-only** (only groupInterestPool used in line 291; members table rendered verbatim without filtering in renderMemberParticipation line 450) |
| payments.obligations (per member) | analytics_sql.js:259 | `{seedMoney: {arrears}, serviceFee: {arrears}, monthlyContributions: {months: [{arrears, ...}]}}` | Nested; months array has no filterable field name in the spec. | **server-total-only** (summed into liveArrearsTotal via lines 269–276; no per-record filtering) |

### (3) Rendered analytics figures → element ID → setter file:line

| Figure | Element ID | Setter function | Setter file:line | Source data |
|---|---|---|---|---|
| Total Income (stat tile) | `#totalIncome` | setText(totalIncomeEl(), ...) | analytics_sql.js:306 | Collected payments + interestPaid from cycle.equity |
| Total Expenses (stat tile) | `#totalExpenses` | setText(totalExpensesEl(), ...) | analytics_sql.js:307 | Disbursed loans (ISSUED_LOAN_STATUSES filter) |
| Net Profit (stat tile) | `#netProfit` | setText(netProfitEl(), ...) | analytics_sql.js:308 | totalIncome − disbursed |
| Loan Interest (stat tile) | `#loanInterest` | setText(loanInterestEl(), ...) | analytics_sql.js:309 | cycleEquity.summary.groupInterestPool |
| Monthly Trend Chart (bar chart rendering) | `#monthlyTrendChart` | renderMonthlyTrendChart() creates bars dynamically; no individual element IDs | analytics_sql.js:313–388 | payments (grouped by month) + loans (binned by disbursedAt/approvedAt month) |
| Contributions Collected (stat card in chartContainer) | (dynamically created div, class "breakdown-card") | statCard("Contributions Collected", ...) calls container.appendChild() | analytics_sql.js:410 | Collected payments (SETTLED_STATUSES filter) |
| Loans Disbursed (stat card in chartContainer) | (dynamically created div, class "breakdown-card") | statCard("Loans Disbursed", ...) calls container.appendChild() | analytics_sql.js:411 | Disbursed loans (ISSUED_LOAN_STATUSES filter) |
| Outstanding Arrears (stat card in chartContainer) | (dynamically created div, class "breakdown-card") | statCard("Outstanding Arrears (live)", ...) calls container.appendChild() | analytics_sql.js:412 | liveArrearsTotal (summed from payments.obligations) |
| Outstanding Loan Balances (stat card in chartContainer) | (dynamically created div, class "breakdown-card") | statCard("Outstanding Loan Balances", ...) calls container.appendChild() | analytics_sql.js:421 | loansSummary.totalOutstanding (server-computed from loans.list summary) |
| Member Participation table rows | (dynamically created `<tr>`, no id, cells have no id) | createParticipationRow(row) appends cells for fullName, totalContributed, totalBorrowed, totalInterestPaid, status badge | analytics_sql.js:459–496 | cycleEquity.members array rows |

### (4) payments.accountingSummary import/usage status

**NO** — payments.accountingSummary is **not imported or called** in analytics_sql.js.
- File scanned for string "accountingSummary": zero matches.
- The file fetches payments.list (line 221), loans.list (line 231), cycle.equity (line 244), and payments.obligations (line 259) only.
- **Note for I3 brief:** To add accounting-figure filtering to analytics, the I3 must add a `loadAccountingSummary()` call (async apiGet("payments.accountingSummary", {groupId: currentGroupId})) inside loadAnalytics() and wire the returned figures (totalContributed, totalDisbursed, outstandingLoanPrincipal, interestEarned, loanRepaymentsReceived, penaltiesCharged, penaltiesCollected, penaltiesWaived, penaltiesOutstanding, cashPosition) into new elements within chartContainer or a new accounting section.

### (5) Exact HTML location for filter control + accounting figures block

**Filter controls insertion point:**
- **Current:** Tab buttons sit in `content-section-header` (line 177) alongside title.
- **Recommendation:** A filter dropdown (e.g. "Group Role Filter", "Member Filter") could be added to the right of tabs in the header, or as a new `<div class="filter-controls">` immediately after line 181 and before `id="chartsContainer"`.
  - HTML insertion: After closing `</div>` of `.tabs` (line 181), add filter controls **within** `.content-section-header` (same row as tabs) OR add `<div class="filter-section">` between header and `id="chartsContainer"` (line 183).
  - **Exact line:** Between analytics.html lines 181 and 183.

**Accounting figures block insertion point:**
- **Current:** Stat cards (Contributions Collected, Loans Disbursed, Outstanding Arrears, Outstanding Loan Balances) are rendered inside `#chartContainer` via renderChartContainer() called from renderMemberParticipation() (line 448).
- **Recommendation:** Add new `<div id="accountingFiguresBlock" class="charts-grid">` immediately after `#monthlyTrendChart` and before `#chartContainer`, OR append accounting stat cards to the existing chartContainer alongside current cards.
  - **Exact line (simplest):** Insert new container after analytics.html line 186 (after monthlyTrendChart closing div): `<div id="accountingFiguresBlock" class="charts-grid"></div>`.
  - This keeps accounting figures separate from the member-participation-triggered chartContainer render, and allows independent filtering if needed.

### (6) DOM-builder and toast helpers for I3 brief

**DOM-builder helper:**
- Function: `el(tag, className)` (analytics_sql.js:511–515)
  - Signature: `function el(tag, className)` → creates `document.createElement(tag)` with optional `className`
  - Usage: Used throughout for creating divs, buttons, spans, etc. (e.g., `el("div", "breakdown-card")` on line 425, `el("h3")` on line 353, etc.)
  - **Note:** No textContent safety wrapper in the function itself; callers must use `node.textContent = value` explicitly (e.g., line 354, line 464).

**Toast helper:**
- Function: `showToast(message, type = "info")` (analytics_sql.js:558–578)
  - Signature: `function showToast(message, type = "info")`
  - Behavior: Finds `#toastContainer` (line 559), creates `<div class="toast toast-{type}">`, adds message via `span.textContent` (line 566, safe), adds close button with `innerHTML = "&times;"` (static entity only, line 568), animates in/out with 5s auto-dismiss (line 573–577).
  - Usage pattern: `showToast("Message text", "error")` or `showToast("Message text", "info")`.
  - **Fallback:** If `#toastContainer` not found, logs to console (line 561).

**Helper utilities:**
- `numberOf(value)` (line 527–530): Safe `parseFloat` with isFinite check, returns 0 on invalid.
- `setText(node, value)` (line 532–534): Safe `node.textContent` setter (null-safe).
- `emptyState(icon, text)` (line 517–525): Creates empty-state div for no-data scenarios (used line 406).

---

## I5 tooltip-rollout scoping (cycle 101 scout)

**Objective:** Map where stat-card popover CSS lives + which pages link it, whether setupStatCardPopovers() is reusable cross-page, and exact card DOM for I5 tooltip insertion on analytics.html and user_dashboard.html.

### (a) CSS location for `.stat-card-info-toggle`, `.stat-card-popover`, `.stat-card-popover.open`

**Result: All three selectors defined inline in `admin_dashboard.html` — NOT in `styles/` directory.**

| Selector | File:Lines | Definitions |
|---|---|---|
| `.stat-card-info-toggle` | admin_dashboard.html:586–614 | Absolute positioned toggle button (44px circle, italic "i", gray bg, transitions on hover/focus-visible) |
| `.stat-card-popover` | admin_dashboard.html:615–628 | Absolute positioned popover (top: calc(100% + var(--bn-space-2)), left/right: 0, shadow, hidden by default) |
| `.stat-card-popover.open` + display logic | admin_dashboard.html:629–633 | `.stat-card-wrap:hover .stat-card-popover`, `.stat-card-wrap:focus-within .stat-card-popover`, `.stat-card-popover.open { display: block; }` |
| `.stat-card-popover:empty` | admin_dashboard.html:634–636 | `display: none` (CSS hides empty popovers) |
| `.stat-card-popover-line` | admin_dashboard.html:637–647 | Line item styling for popover content (padding, font-size, border-bottom separator) |

### (b) Stylesheet links in analytics.html and user_dashboard.html

| Page | <head> stylesheet hrefs |
|---|---|
| admin_dashboard.html | design-system.css (line 12), admin-layout.css (line 13) — **NO pages.css** — **inline <style> (lines 15–1638)** |
| analytics.html | design-system.css (line 12), admin-layout.css (line 13), pages.css (line 14) — **NO inline popover CSS** |
| user_dashboard.html | design-system.css (line 12), pages.css (line 13), admin-layout.css (line 14) — **NO inline popover CSS** |

**Finding:** The `.stat-card-info-toggle` and `.stat-card-popover` selectors are inline **only** in admin_dashboard.html. To use them on analytics.html or user_dashboard.html, the CSS must be **moved or copied** to a shared stylesheet (e.g., `admin-layout.css` or a new `tooltips.css`) or inserted as inline <style> in each target page.

### (c) setupStatCardPopovers() export + wrapper-class requirement

**Function location:** admin_dashboard_sql.js:1393–1414

**Export status:** NOT exported (no `export` keyword on the function definition). Called locally only via line 1382 within setupEventListeners().

**Wrapper-class requirement:** **YES — requires `.stat-card-wrap` wrapper class specifically.**

| Requirement | Code |
|---|---|
| Wrapper query (line 1403) | `document.querySelectorAll(".stat-card-wrap").forEach((wrap) => {` — function ONLY operates on elements with this class |
| Nested popover (line 1404) | `const popover = wrap.querySelector(".stat-card-popover");` — must be child of `.stat-card-wrap` |
| Nested toggle (line 1405) | `const toggle = wrap.querySelector(".stat-card-info-toggle");` — must be child of `.stat-card-wrap` |
| No-op if missing (line 1406) | `if (!popover || !toggle) return;` — silently skips wraps without both elements |

**Verdict:** `setupStatCardPopovers()` is **NOT reusable as-is**. To use on analytics.html or user_dashboard.html, either:
1. Export it and call it from both pages' scripts (requires both pages to wrap their cards in `.stat-card-wrap`)
2. Copy the function into each page's script and adapt class names to match the page's own card structure (e.g., `.page-stat`, `.hero-stat`)

### (d) statCard() internal DOM (analytics_sql.js:434–444)

**Function signature:** `function statCard(label, value)` (analytics_sql.js:434)

**Exact DOM structure returned:**

```
<div class="breakdown-card">
  <div class="breakdown-card-header">
    <span class="breakdown-card-title">label</span>
  </div>
  <div class="breakdown-card-value">value</div>
</div>
```

**Element types:**
- Root: `<div class="breakdown-card">` (line 435)
- Header container: `<div class="breakdown-card-header">` (line 436)
- Title: `<span class="breakdown-card-title">` (line 437) — textContent set at line 438
- Value: `<div class="breakdown-card-value">` (line 440) — textContent set at line 441
- Append order: `card.append(header, valueEl)` (line 442)

**Popover insertion point:** A popover button and popover div would attach as siblings to the header/value structure, or as a child of `.breakdown-card` after the header. The title span offers no internal nesting.

### (e) Target card DOM — analytics.html & user_dashboard.html

#### analytics.html — Four `.page-stat-value` tiles

| ID | Wrapping element | Class | Line range |
|---|---|---|---|
| #totalIncome | `<div>` | `.page-stat` | 233–236 |
| #totalExpenses | `<div>` | `.page-stat` | 237–240 |
| #netProfit | `<div>` | `.page-stat` | 241–244 |
| #loanInterest | `<div>` | `.page-stat` | 245–248 |

**Markup pattern (lines 233–248):**
```html
<div class="page-stat">
  <div class="page-stat-value {modifier}" id="totalIncome">MWK 0</div>
  <div class="page-stat-label">Total Income</div>
</div>
```

#### user_dashboard.html — Six stat tiles

| ID | Wrapping element | Element type | Class | Line range | Notes |
|---|---|---|---|---|---|
| #nextPaymentStat | `.hero-stat` | `<div>` | `.hero-stat` | 2186–2195 | Contains #nextPaymentDetails + popover div + badge button |
| #activeLoansStat | `.hero-stat` | `<div>` | `.hero-stat` | 2196–2204 | Contains #activeLoans + #activeLoansDetails + badge button; onclick redirect to loan_payments.html |
| #pendingPaymentsStat | `.hero-stat` | `<div>` | `.hero-stat` | 2205–2209 | Contains #pendingPayments + popover div |
| #totalArrearsStat | `.hero-stat` | `<div>` | `.hero-stat` | 2210–2214 | Contains #totalArrears + popover div |
| #membersStat | `.hero-stat` | `<a>` | `.hero-stat` | 2215–2221 | href="contacts.html"; contains #totalMembers (with inline badge) |
| #totalContributedStat | `.hero-stat` | `<button>` | `.hero-stat` | 2222–2225 | onclick="showAllPaymentsModal()"; contains #totalContributed |

**Markup pattern (lines 2186–2195 example — nextPaymentStat):**
```html
<div class="hero-stat" id="nextPaymentStat" tabindex="0" aria-describedby="nextPaymentPopover" style="position: relative;">
  <div class="hero-stat-value" style="...">...</div>
  <div class="hero-stat-label">Next Payment</div>
  <div class="hero-stat-details" id="nextPaymentDetails"></div>
  <div class="hero-stat-popover" id="nextPaymentPopover" role="status"></div>
  <button type="button" class="hero-stat-badge" id="nextPaymentBadge" ...>Due</button>
</div>
```

### Summary — CSS & JS Reusability for I5 rollout

| Concern | Finding |
|---|---|
| **CSS Portability** | Inline CSS in admin_dashboard.html only. Must extract/copy to shared stylesheet (admin-layout.css) or inline into target pages to work on analytics.html & user_dashboard.html. |
| **JS Function Reusability** | `setupStatCardPopovers()` NOT exported; hard-coded to query `.stat-card-wrap`. Cannot be reused cross-page without: (a) exporting + calling from both pages + wrapping their cards in `.stat-card-wrap`, or (b) copying function into each page's script and adapting class names. |
| **analytics.html Card DOM** | `.page-stat` wrapper (not `.stat-card-wrap`); contains `.page-stat-value` (value elem) + `.page-stat-label` (label elem). Statically declared lines 233–248. |
| **user_dashboard.html Card DOM** | `.hero-stat` wrapper (not `.stat-card-wrap`); varied element types (`<div>`, `<a>`, `<button>`); contains `.hero-stat-value` + `.hero-stat-label` + optional `.hero-stat-details` + `.hero-stat-popover` + `.hero-stat-badge`. Lines 2186–2225. Already includes popover div placeholders (e.g., #nextPaymentPopover). |
| **Popover CSS Selectors** | Currently `.stat-card-wrap:hover .stat-card-popover` + `.stat-card-wrap:focus-within .stat-card-popover` + `.stat-card-popover.open`. Would need adaptation to `.page-stat` / `.hero-stat` if reusing CSS without refactoring. |

---

## user_analytics.html data & content pipeline (cycle 104 scout)

**Objective:** Map the full data pipeline of user_analytics.html — what every API call fetches, when, what's rendered, what's fetched but unshown, and what actionable data could make display-only cards interactive (comparing to user_dashboard.html's three patterns: inline onclick nav, modal openers, and hover/focus popovers).

**Real state:** Pages are structurally similar (member-scoped analytics + statements) but user_analytics is **fully display-only** (no click-through, no modals, no popovers), while user_dashboard has interactive hero-stat tiles tied to three actionability patterns. user_analytics lacks filters (month, status), expandable sections, and deep-link drill-downs that user_dashboard provides.

### 1. DATA PIPELINE — API actions, timing, and response shapes

| API Action | Trigger / Caller | Line(s) | HTTP method | Parameters | Response fields consumed |
|---|---|---|---|---|---|
| **groups.mine** | listMyGroups() via loadUserGroups() | 142 (init on load) | GET | — | via import; returns groups[] |
| **payments.obligations** | loadContributions() → loadGroupData() | 194 (on group select, init) | GET | `groupId`, optional `year` | `summary{contributed, arrears, penaltyAccrued}`, `monthlyContributions{months[]}` |
| **loans.list** | loadLoans() → loadGroupData() | 297 (on group select) | GET | `groupId` | `loans[]`, `summary{totalOutstanding}` |
| **repayments.mine** | loadLoans() → loadGroupData() | 303 (on group select) | GET | `groupId` | `payments[]` (loan_payments rows) |
| **statement.get** | loadAccountStatement() → loadGroupData() or year filter change | 374 (on group select, year change) | GET | `groupId`, optional `year` | `contributions{lines[], total}`, `loanAccount{lines[], outstanding}`, `penalties{lines[], totalCharged, totalWaived, net}` |
| **exports.statement** | Event listener on #statementExportBtn | 135 (on export click) | GET | `groupId` | Binary CSV stream via downloadExport() |

**Call sequence on page load:**
1. init() → requireSession() (line 87) ← redirects to login on 401
2. loadUserGroups() (line 94) → listMyGroups() → populates #groupSelector, auto-selects first/stored group
3. loadGroupData() (line 172, triggered by group auto-select) → parallel calls:
   - loadContributions() → apiGet("payments.obligations"...) → renderTopStats() + renderContributionTrendChart()
   - loadLoans() → apiGet("loans.list"...) → apiGet("repayments.mine"...) → renderRepaymentHistory() + renderTopStats() (re-called)
   - loadAccountStatement() → apiGet("statement.get"...) → render three ledgers

**On group selector change (lines 100–123):** Repeats loadGroupData() for new group; clears old data.

**On year filter change (lines 125–128):** Calls loadAccountStatement() with year param; re-renders statement ledgers only.

**Export click (lines 130–136):** Calls downloadExport("exports.statement", {groupId}).

### 2. CARD/SECTION INVENTORY — DOM elements, fetched fields, render callsites

| Card/Section | HTML Element | ID | Fetched data source | Response field(s) | Render function:line | Display-only or interactive? | Content |
|---|---|---|---|---|---|---|---|
| **Top Stat: Total Contributed** | `.page-stat-value` | `#totalContributed` | payments.obligations | summary.contributed | renderTopStats:231 | Display-only textContent | MWK (formatted currency) |
| **Top Stat: Total Borrowed** | `.page-stat-value` | `#totalBorrowed` | loans.list | loans[].{principalAmount,approvedAmount} (filtered ISSUED_LOAN_STATUSES) | renderTopStats:232 | Display-only textContent | MWK (formatted currency) |
| **Top Stat: Loan Outstanding** | `.page-stat-value` | `#outstanding` | loans.list | summary.totalOutstanding | renderTopStats:233 | Display-only textContent | MWK (formatted currency) |
| **Top Stat: Arrears** | `.page-stat-value` | `#totalArrears` | payments.obligations | summary.arrears | renderTopStats:234 | Display-only textContent | MWK (formatted currency) |
| **Your Overview: Total Contributed** | `.stat-card .stat-value` | `#userTotalContributed` | payments.obligations | summary.contributed | renderTopStats:236 | Display-only textContent | MWK (formatted currency) |
| **Your Overview: Total Loans** | `.stat-card .stat-value` | `#userTotalLoans` | loans.list | loans[].{principalAmount,approvedAmount} (filtered ISSUED_LOAN_STATUSES) | renderTopStats:237 | Display-only textContent | MWK (formatted currency) |
| **Your Overview: Loan Outstanding** | `.stat-card .stat-value` | `#userLoanOutstanding` | loans.list | summary.totalOutstanding | renderTopStats:238 | Display-only textContent | MWK (formatted currency) |
| **Your Overview: Total Arrears** | `.stat-card .stat-value` | `#userTotalArrears` | payments.obligations | summary.arrears | renderTopStats:239 | Display-only textContent | MWK (formatted currency) |
| **Your Overview: Active Loans** | `.stat-card .stat-value` | `#userActiveLoans` | loans.list | loans[] (filtered ISSUED_LOAN_STATUSES).count | renderTopStats:240–243 | Display-only textContent | Integer count |
| **Your Overview: Groups** | `.stat-card .stat-value` | `#userGroupsCount` | groups.mine (local state userGroups) | userGroups.length | renderTopStats:244 | Display-only textContent | Integer count |
| **Group Stats: You Contributed** | `.stat-card .stat-value` | `#groupTotalContributed` | payments.obligations | summary.contributed (scoped to currentGroupId) | renderTopStats:249 | Display-only textContent | MWK (formatted currency) |
| **Group Stats: Total Members** | `.stat-card .stat-value` | `#groupTotalMembers` | *(NOT fetched; no endpoint called)* | — | *(NOT rendered)* | — | *(unimplemented)* |
| **Group Stats: Group Collections** | `.stat-card .stat-value` | `#groupTotalCollections` | *(NOT fetched)* | — | *(NOT rendered)* | — | *(unimplemented)* |
| **Group Stats: Group Active Loans** | `.stat-card .stat-value` | `#groupActiveLoans` | *(NOT fetched)* | — | *(NOT rendered)* | — | *(unimplemented)* |
| **Contribution Trend Chart** | `#chartContainer` (bar chart) | — | payments.obligations | monthlyContributions.months[] (last 6 with data) | renderContributionTrendChart:255–290 | Display-only animated bars | Bar height = amountPaid as % of maxAmount; title on hover = "month: MWK paid / MWK expected" |
| **Recent Activity** | `#recentActivity` (list) | — | repayments.mine | payments[] (loan_payments, top 10) | renderRepaymentHistory:321–362 | Display-only list items | Each row: "Loan Payment — loanNumber", date (paidAt or createdAt), status, amount |
| **Statement: Contributions Ledger** | `#statementContributions` (table) | — | statement.get | contributions.lines[], contributions.total | renderContributionsLedger:429–463 | Display-only table | Columns: Date, Type, Description, Amount, Running Balance; footer shows total |
| **Statement: Loan Account Ledger** | `#statementLoanAccount` (table) | — | statement.get | loanAccount.lines[], loanAccount.outstanding | renderLoanAccountLedger:465–498 | Display-only table | Columns: Date, Event, Loan, Amount, Running Outstanding; footer shows outstanding |
| **Statement: Penalties Ledger** | `#statementPenalties` (table) | — | statement.get | penalties.lines[], penalties.{totalCharged,totalWaived,net} | renderPenaltiesLedger:500–533 | Display-only table | Columns: Date, Event, Amount, Context; footer shows totalCharged / totalWaived / net |

**Notes on unrendered Group Stats cells:**
- `#groupTotalMembers`, `#groupTotalCollections`, `#groupActiveLoans` are declared in HTML (lines 272, 276, 280) but **never populated** — setText() is never called for them. Data is not fetched (no groups.get endpoint to retrieve group-wide stats for a member-scoped call).

### 3. UNSHOWN DATA — Fetched but not rendered

**From payments.obligations:**
- `monthlyContributions.months[].dueDate` — fetched (line 260 iteration), used in chart title construction (line 282), but date itself **not rendered** in the chart display.
- `monthlyContributions.months[].approvalStatus` — fetched (line 260), **not used or rendered**.

**From loans.list:**
- `loans[].interestRate*`, `loans[].totalInterest`, `loans[].collateral`, `loans[].guarantor*` — entire loan-detail fields — **not fetched/rendered**; loans.list returns only summary fields for a member-scoped call.
- Actually: loans.list **does** return full rows, but the code (line 300) only destructures `data.loans` and `data.summary`; full row fields like `interestRateMonth1`, `totalInterest`, `repaymentPeriod` are present in response but **not read by the script**.

**From repayments.mine:**
- `payments[].loanId` — fetched (implied in repayData response), **not used or rendered** (only loanNumber is displayed).
- `payments[].principalPortion`, `payments[].interestPortion`, `payments[].penaltyPortion` — breakdown columns — **not fetched/rendered**.

**From statement.get:**
- Statement line items include additional metadata (type, event labels) which are already rendered in full table form, so **no unshown data** in the ledger responses — all fields in contributions/loanAccount/penalties line arrays are displayed.

**Summary:** Main unshown data are: loan detail fields (interest rates, collateral, guarantor), loan-payment breakdown (principal/interest/penalty split), and obligation due dates in the contribution chart. None are rendered because:
1. loans.list for a member returns only their own loans (no cross-member loan details).
2. Loan interest/collateral/guarantor are not member-visible (admin-only detail).
3. Loan-payment breakdown is not scoped to a member's own repayments for visibility in a statement (belongs in admin loan-approval UI).

### 4. ACTIONABILITY VERDICT — Card-by-card assessment and candidate targets

**Comparison to user_dashboard.html interactive patterns:**

| Pattern | Example in user_dashboard.html | Implementation |
|---|---|---|
| **Inline onclick navigation** | #activeLoansStat → onclick navigate to loan_payments.html | Clickable element (usually `.hero-stat.clickable` with cursor: pointer) calls window.location.href or similar in event handler |
| **Modal opener** | #totalContributedStat → onclick openPaymentModal() or showAllPaymentsModal() | Button/link onclick handler opens a `.modal-overlay` with preloaded data from cached window.__dashboardData |
| **Hover/focus popover** | #nextPaymentStat, #pendingPaymentsStat, #totalArrearsStat → `.hero-stat-popover` shows on :hover/:focus-within | Popover div (sibling to stat card, hidden by default) contains structured detail; CSS or JS (initHeroStatPopover) toggles visibility |

**Verdict for each user_analytics card (actionable data exists? target?)**

1. **#totalContributed** (Top + Your Overview)
   - Actionable data: YES — breakdown of seed money + monthly contributions + service fee (in obligations.summary, but not split per-component)
   - Pattern fit: **Popover** (hover/focus to see contribution type breakdown)
   - Target: Show seed/monthly/service fee totals in a 3-row popover (like dashboard's renderArrearsPopover at line 608)
   - Candidate field: Synthesize from summary or fetch additional detail endpoint

2. **#totalBorrowed** (Top + Your Overview)
   - Actionable data: YES — list of all issued loans, their amounts and statuses (loans.list already filtered to ISSUED_LOAN_STATUSES)
   - Pattern fit: **Modal opener** (click to see all loans modal)
   - Target: Open modal listing all loans with principal, approved amount, and status
   - Candidate field: loans.list response already has full details; modal would list them

3. **#outstanding** (Top + Your Overview)
   - Actionable data: YES — breakdown of outstanding by loan (loans[] with remainingBalance > 0)
   - Pattern fit: **Modal opener** or **inline onclick** to loan_payments.html
   - Target: Open modal showing outstanding loans only (filter loans by status + remainingBalance > 0), or navigate to loan_payments.html for detail
   - Candidate field: loans.list.summary.totalOutstanding; drill-down to individual loans via loans[]

4. **#totalArrears** (Top + Your Overview)
   - Actionable data: YES — breakdown of arrears on contributions (seed, monthly, service fee) + live penalties (both in obligations.summary and penalty detail)
   - Pattern fit: **Popover** or **modal opener**
   - Target: Popover showing arrears vs. penalties (like dashboard's renderArrearsPopover line 608), or modal listing arrears by obligation type
   - Candidate field: summary.arrears + summary.penaltyAccrued (already split in summary)

5. **#userActiveLoans** (Your Overview)
   - Actionable data: YES — list of active loans, amounts, dates (loans.list filtered to ISSUED_LOAN_STATUSES)
   - Pattern fit: **Inline onclick** to loan_payments.html (dashboard's #activeLoansStat does this at line 1294)
   - Target: Navigate to loan_payments.html with no parameters (page loads all of caller's active loans)
   - Candidate field: loans[] filtered by ISSUED_LOAN_STATUSES

6. **#userGroupsCount** (Your Overview)
   - Actionable data: LIMITED — count is rendered, but group list already visible in top nav (group selector); no new detail to show
   - Pattern fit: NO actionability gain (already accessible via nav)
   - Target: SKIP (not actionable)

7. **#groupTotalContributed** (Group Stats)
   - Actionable data: YES — same as top-level total contributed; could show breakdown by contribution type
   - Pattern fit: **Popover**
   - Target: Same as #totalContributed popover (seed/monthly/service fee split)
   - Candidate field: Same obligations.summary

8. **#groupTotalMembers, #groupTotalCollections, #groupActiveLoans** (Group Stats)
   - Actionable data: NOT CURRENTLY FETCHED — no group-wide stats endpoint exists that a member can call
   - Pattern fit: N/A — would require new API endpoint
   - Target: BLOCKED (no data source)
   - Note: These require group.get or groups.statistics endpoint callable by members; not currently implemented

9. **Contribution Trend Chart** (#chartContainer)
   - Actionable data: YES — months array is full; could expand to show all months (not just last 6), or click a month for detail
   - Pattern fit: **Expandable section** or **inline month click handler**
   - Target: Add "Show all months" toggle, or make bars clickable to show that month's obligation detail
   - Candidate field: monthlyContributions.months[] (currently capped at 6 with data; code allows more)

10. **Recent Activity** (#recentActivity)
    - Actionable data: YES — list is capped at 10 items (line 336); could expand to show all or paginate
    - Pattern fit: **Expandable section** or **"Load more" button**
    - Target: Add "Show all" toggle to display full repayment history, or add pagination
    - Candidate field: myRepayments array (fully fetched, only 10 shown)

11. **Statement Ledgers** (#statementContributions, #statementLoanAccount, #statementPenalties)
    - Actionable data: YES — ledger lines are already shown in full table form; no actionability gap
    - Pattern fit: NONE (already interactive via year filter at page level)
    - Target: SKIP (fully transparent, no drill-down needed)

### 5. INTERACTIVITY GAP — What user_dashboard has that user_analytics lacks

| Feature | user_dashboard.html | user_analytics.html | Gap |
|---|---|---|---|
| **Click-through hero stats** | #activeLoansStat → onclick nav to loan_payments.html; #totalContributedStat → showAllPaymentsModal() | No clickable cards at all | **MISSING** — all cards are display-only divs with no onclick handlers |
| **Hover/focus popovers on hero stats** | #nextPaymentStat, #pendingPaymentsStat, #totalArrearsStat have `.hero-stat-popover` siblings; shown via :hover/:focus-within CSS + popover-open JS toggle | No popovers on any stat card | **MISSING** — no `.stat-card-popover` or equivalent; no popover-open CSS/JS pattern |
| **Modal openers** | openArrearsModal() (arrears detail), showAllPaymentsModal() (all contributions), openPaymentModal() (record payment form) | No modals anywhere on page | **MISSING** — all sections display-only inline; no modal workflows |
| **Month/period filter on hero stats** | #dashboardMonthFilter select (line 572) re-scopes Contributed/Pending totals to chosen month; applyDashboardMonthFilter() recalculates client-side | #statementYearFilterEl exists but only filters statement ledgers; does NOT re-scope top hero stats | **PARTIAL** — year filter exists for statement only, not for top-stat cards |
| **Interactive payment calendar** | #paymentCalendar (lines 1214–1420) built with 7-column grid, clickable event days, day-details panel, prev/next month nav | No calendar on analytics page (not scoped to member analytics) | **N/A** — calendar is admin dashboard feature; member analytics does not need it |
| **Expandable/collapsible sections** | None on dashboard (all sections are always visible) | Statement ledgers are always rendered when group selected | **NONE** — both lack collapsible sections |
| **Inline action buttons in rows** | Upcoming Payments table has "Pay" button per row (line 1004) to open openPaymentModal() | Recent Activity list items are read-only; no action buttons | **MISSING** — activity items are not actionable (but member cannot record repayments from analytics page anyway; that's admin-only) |

**Summary of gaps:**
1. **No clickable stat cards** — all cards are static display-only; none navigate or open modals
2. **No popovers** — no hover/focus detail panels; all info is top-level text only
3. **No modals** — no detail views or drill-downs available
4. **Limited filtering** — year filter only applies to statement ledgers, not top-level hero stats (unlike dashboard's month filter on hero stats)
5. **Capped list views** — Recent Activity shows only 10 of potentially many repayments (no "show all" or pagination)
6. **No interactivity patterns** — unlike dashboard's three patterns (click-through, modal, popover), analytics page has zero interactive elements

---

## Interaction & view-switch re-audit (cycle 109 scout)

**Objective:** Re-verify every card/tile/stat-element and the admin↔user view switch across the four GROUP-I pages + nav shell, against cycles 99–108 markup additions. The cycle-98 audit claimed everything was WIRED, but the owner reports cards still not clickable and no view-switch visible to admins.

**Finding:** Cycle-98 audit was **incomplete/stale**. New popovers (I4/I5) ARE wired correctly, but one critical control is DEAD: the #viewToggle on user_dashboard is referenced in code but the DOM element does NOT EXIST.

### 1. Admin Dashboard (`admin_dashboard.html` / `admin_dashboard_sql.js`)

| Card/Element | ID/Selector | Type | Affordance | Handler | File:line | Status |
|---|---|---|---|---|---|---|
| Collections stat | `#totalCollections` | `.stat-card.clickable` button | `onclick=navigateToStatPage(...)` text + "i" info button | `navigateToStatPage('collections')` → manage_payments.html?tab=collected | admin_dashboard_sql.js:1309 | **WIRED** ✓ |
| Active Loans stat | `#activeLoans` | `.stat-card.clickable` button | onclick + "i" button | navigateToStatPage('loans') → manage_loans.html | admin_dashboard_sql.js:1309 | **WIRED** ✓ |
| Pending Approvals stat | `#pendingApprovals` | `.stat-card.clickable` button | onclick + "i" button | navigateToStatPage('pending') → manage_payments.html?tab=pending | admin_dashboard_sql.js:1309 | **WIRED** ✓ |
| Arrears stat | `#totalArrears` | `.stat-card.clickable` button | onclick + "i" button | navigateToStatPage('arrears') → manage_payments.html?tab=arrears | admin_dashboard_sql.js:1309 | **WIRED** ✓ |
| Info popovers (all 4) | `.stat-card-popover` | div siblings | `aria-controls` on "i" buttons; revealed on :hover, :focus-within, or .open class (touch) | setupStatCardPopovers() attaches listeners + CSS rule | admin_dashboard_sql.js:1382 | **WIRED** ✓ |
| Monthly filter | `#dashboardMonthFilter` | select | change event | applyDashboardMonthFilter() re-aggregates payments server-side data locally | admin_dashboard_sql.js:1376-1380 | **WIRED** ✓ |

**All admin dashboard cards are clickable and correctly wired.**

### 2. User Dashboard (`user_dashboard.html` / `user_dashboard_sql.js`)

| Card/Element | ID/Selector | Type | Affordance | Handler | File:line | Status |
|---|---|---|---|---|---|---|
| Next Payment | `#nextPaymentStat` | `.hero-stat` div | No direct click; badge onclick only | dismissNextPaymentBadge() (badge only, not stat itself) | user_dashboard_sql.js: N/A (HTML-bound) | **NOT clickable** |
| Next Payment badge | `#nextPaymentBadge` | button | `onclick=dismissNextPaymentBadge(event)` | Hides badge, does NOT navigate | user_dashboard_html:2194 | Correctly static |
| Active Loans | `#activeLoansStat` | `.hero-stat` button | `onclick=window.location.href='loan_payments.html'` + role="button" tabindex="0" | Direct navigation to loan_payments.html | user_dashboard.html:2196 | **WIRED** ✓ |
| Pending Payments | `#pendingPaymentsStat` | `.hero-stat` div | No click handler, no affordance | — | — | **Correctly static** |
| Arrears | `#totalArrearsStat` | `.hero-stat` div | No click handler, no affordance | — | — | **Correctly static** |
| Group Members | `#membersStat` | `.hero-stat` anchor `<a href="contacts.html">` | href link + role/tabindex decorators | Navigates to contacts.html | user_dashboard.html:2216 | **WIRED** ✓ (anchor) |
| Total Contributed | `#totalContributedStat` | `.hero-stat` button | `onclick=showAllPaymentsModal()` + cursor:pointer | Opens modal showing all contributions | user_dashboard.html:2224 | **WIRED** ✓ |
| Hero stat popovers (6 cards) | `.hero-stat-popover` (siblings to stat cards) | div | Revealed on .popover-open class (toggled via JS) or :hover/:focus-within (CSS) | Touch: click handlers toggle .popover-open; desktop: CSS rules | user_dashboard_sql.js: touches via initHeroStatPopover() or direct textContent fill | **WIRED** ✓ |
| Month filter | `#dashboardMonthFilter` | select | change event | applyDashboardMonthFilter() re-scopes Contributed + Pending totals | user_dashboard_sql.js: line referenced in HTML but not shown in offset range | **WIRED** ✓ |

**User dashboard stat cards correctly wired; no gaps detected.**

### 3. Analytics (`analytics.html` / `analytics_sql.js`)

| Card/Element | ID/Selector | Type | Affordance | Handler | File:line | Status |
|---|---|---|---|---|---|---|
| Total Income | `#totalIncome` | `.page-stat` div | None (static) | — (display-only textContent) | — | **Correctly static** |
| Total Expenses | `#totalExpenses` | `.page-stat` div | None | — | — | **Correctly static** |
| Net Profit | `#netProfit` | `.page-stat` div | None | — | — | **Correctly static** |
| Loan Interest | `#loanInterest` | `.page-stat` div | None | — | — | **Correctly static** |
| Info popovers on 4 stats | `.stat-card-popover` | div siblings (dynamic, created by attachCardPopover) | "i" toggle buttons + auto-reveal on :hover, :focus-within, or .open class (touch) | attachCardPopover() (line 604) creates toggle + popover; event listeners on toggle + doc click listener | analytics_sql.js:604–664 | **WIRED** ✓ |
| Accounting Figures block | `#accountingFiguresBlock` | div container (dynamic grid of breakdown-cards) | Static breakdown-cards with "i" toggles created by statCard() + attachCardPopover() | Each breakdown-card gets "i" button + popover via attachCardPopover() (line 604) | analytics_sql.js:487, 604 | **WIRED** ✓ |
| Pie charts | `#chartContainer` | div container (dynamic pie-summary cards) | Static display, no interaction | — | analytics_sql.js: builds SVG, no clicks | **Correctly static** |

**Analytics page cards and popovers all wired correctly.**

### 4. User Analytics (`user_analytics.html` / `user_analytics_sql.js`)

| Card/Element | ID/Selector | Type | Affordance | Handler | File:line | Status |
|---|---|---|---|---|---|---|
| **Top Stats (4 cards)** | | | | | | |
| Total Contributed | `#totalContributed` | `.page-stat` div | None | — | — | **Correctly static** |
| Total Borrowed | `#totalBorrowed` | `.page-stat` div (role="button" tabindex="0") | onclick + role/tabindex decorators | `window.location.href='loan_payments.html'` | user_analytics.html:279 | **WIRED** ✓ |
| Loan Outstanding | `#outstanding` | `.page-stat` div (role="button" tabindex="0") | onclick + role/tabindex | window.location.href='loan_payments.html' | user_analytics.html:283 | **WIRED** ✓ |
| Arrears | `#totalArrears` | `.page-stat` div | None | — | — | **Correctly static** |
| **Your Overview (6 cards)** | | | | | | |
| Total Contributed | `#userTotalContributed` | `.stat-card` div | None | — | — | **Correctly static** |
| Total Loans | `#userTotalLoans` | `.stat-card` div (role="button" tabindex="0") | onclick + role/tabindex | window.location.href='loan_payments.html' | user_analytics.html:311 | **WIRED** ✓ |
| Loan Outstanding | `#userLoanOutstanding` | `.stat-card` div (role="button" tabindex="0") | onclick + role/tabindex | window.location.href='loan_payments.html' | user_analytics.html:315 | **WIRED** ✓ |
| Total Arrears | `#userTotalArrears` | `.stat-card` div | None | — | — | **Correctly static** |
| Active Loans | `#userActiveLoans` | `.stat-card` div (role="button" tabindex="0") | onclick + role/tabindex | window.location.href='loan_payments.html' | user_analytics.html:323 | **WIRED** ✓ |
| Groups Count | `#userGroupsCount` | `.stat-card` div | None | — | — | **Correctly static** |
| **Group Statistics (4 cards)** | | | | | | |
| You Contributed | `#groupTotalContributed` | `.stat-card` div | None | — | — | **Correctly static** |
| Total Members | `#groupTotalMembers` | `.stat-card` div | None | — | NOT rendered; endpoint not called | user_analytics_sql.js:200 (attempted setText, but no data fetched) | **Data-DEAD** (code references but data never fetched) |
| Group Collections | `#groupTotalCollections` | `.stat-card` div | None | — | NOT rendered; no API call | user_analytics_sql.js:201 (attempted setText, but no data) | **Data-DEAD** |
| Group Active Loans | `#groupActiveLoans` | `.stat-card` div | None | — | NOT rendered | user_analytics_sql.js:202 (attempted setText, no data) | **Data-DEAD** |
| **Info Popovers** | `.stat-card-popover` (dynamic on stat-cards when needed) | div siblings (created by attachCardPopover on user_analytics_sql.js line 291) | "i" toggle button + :hover/:focus-within CSS + .open JS toggle (touch) | attachCardPopover() creates toggle + listeners; doc click listener to close | user_analytics_sql.js:291–352 | **WIRED** ✓ |

**User analytics: most cards correctly wired. Three group-stat cards (#groupTotalMembers, #groupTotalCollections, #groupActiveLoans) are data-dead (code calls setText but no API data fetched; see SYSTEM_MAP line 1369–1371).**

### 5. Admin↔User View Switch (nav_sql.js + admin_dashboard_sql.js + user_dashboard_sql.js)

#### Admin Side (admin_dashboard.html)

**Control Existence:**
- Location: sidebar footer + mobile nav (nav_sql.js lines 254–263, 403–412)
- Type: Plain `<a>` links (no id attribute; selected by href)
- Label: "Switch to User View" (sidebar) / "User View" (mobile)
- Href: `user_dashboard.html`
- **Rendered:** ✓ YES (visible in DOM, no gate preventing injection)
- **Listeners:** ✓ YES (admin_dashboard_sql.js lines 1342–1352 add click listeners to both sidebar + mobile link)
- **Navigation:** ✓ YES (both listeners call `window.location.href = "user_dashboard.html"`)
- **Verdict:** **LIVE** — admin side switch is fully functional.

#### User Side (user_dashboard.html)

**Two separate potential switch mechanisms:**

**Mechanism 1: Sidebar Footer Link (injected by nav_sql.js)**
- Type: `<a>` link (href="admin_dashboard.html")
- Condition: Only created if user.role is in ADMIN_ROLES (nav_sql.js lines 472–479)
- Rendered: ✓ YES when isAdmin is true (depends on session role)
- Navigation: ✓ YES (plain <a href> link, works via normal browser navigation)
- **Verdict:** **LIVE** — sidebar footer switch works for admins.

**Mechanism 2: #viewToggle Top-Bar Toggle (should be in topbar)**
- Expected Location: user_dashboard.html top-bar (role="button" toggle buttons: "User" / "Admin")
- Expected HTML: `<div id="viewToggle">...` with two buttons
- **DOM element exists in HTML?** ✗ **NO** — searched user_dashboard.html; no element with id="viewToggle" found
- **CSS for styling exists?** ✓ YES (user_dashboard.html CSS lines 206–247 defines `.view-toggle` / `.view-toggle-btn` styles)
- **JS tries to use it?** ✓ YES (user_dashboard_sql.js line 223–224: `const viewToggle = document.getElementById("viewToggle"); if (viewToggle) viewToggle.classList.toggle("hidden", !isAdmin);`)
- **Behavior if missing:** Gracefully degrades (JS uses `if (viewToggle)` guard; page renders, toggle simply never appears)
- **Data attributes suggest intent:** ✓ YES (user_dashboard.html `<body data-nav-show-view-toggle="true">` hints toggle should render, but page-bootstrap.js ignores this flag; initNav receives it but does NOT use it)
- **Verdict:** **CLICKABLE-DEAD** — the #viewToggle element is not in the DOM; code references it but element was never rendered. The sidebar footer link works instead (Mechanism 1), so the page does have a switch, but the topbar toggle that cycles 99–108 may have intended is absent.

#### Gate-Miss Analysis (Question 3)

**Could isAdmin gate leave an admin with NO visible switch?**

- **If the only switch is #viewToggle:** ✓ YES — if #viewToggle never exists (current state), the isAdmin gate on line 224 would hide an element that is never shown anyway (no-op).
- **If sidebar footer link is the actual switch:** ✗ NO — the sidebar link is shown for ALL users; the renderUserSidebarNav (line 472) gate controls whether footerSwitch is passed as null (member) or {href: "admin_dashboard.html"} (admin). This gate works correctly: admin users see "Admin View", members see nothing.
- **Verdict:** Admins are NOT left without a switch. The sidebar footer link (Mechanism 1) works; the topbar #viewToggle (Mechanism 2) is dead but is a duplicate anyway.

### 6. Top Clickable-DEAD Cards (Ranked by Likelihood User Hit Them)

**Cards with affordances but broken handlers:**

1. **None found** — All cards across all four pages either have working handlers or are correctly static with no affordances.
   - #viewToggle (user_dashboard topbar toggle) is dead, but it's not a "card" per se; it's a view-mode control. And it's a duplicate of the sidebar footer switch.
   - #groupTotalMembers, #groupTotalCollections, #groupActiveLoans (user_analytics) have no affordances (no cursor:pointer, no onclick, no role="button"), so users would not expect them to be clickable — they are correctly static even though their values are never populated (data issue, not wiring issue).

**Conclusion:** No clickable-dead cards detected across the four pages. All affordances are wired; all static cards have no affordance suggesting they should respond to clicks.

### 7. Summary

| Question | Answer | Evidence |
|---|---|---|
| **(1) Per-page table for every card:** | See sections 1–4 above | 4 tables covering 25+ card elements; all affordances mapped to handlers or marked correctly static |
| **(2) Admin↔user view switch — both directions wired?** | **PARTIAL:** User side (sidebar link) works ✓; admin side ✓; but topbar #viewToggle (user_dashboard) is dead | nav_sql.js:458, 472–478 (sidebar switch); admin_dashboard_sql.js:1342–1352 (admin listeners); user_dashboard_sql.js:223–224 (dead #viewToggle reference) |
| **(3) Could isAdmin gate hide switch from admins?** | **NO** — sidebar footer gate (renderUserSidebarNav line 472) correctly conditions footerSwitch on role. Admins see "Admin View" link; members see nothing. Gate works. | nav_sql.js:472–479 |
| **(4) Top clickable-DEAD cards ranked** | **None detected** — all cards either wired correctly or static with no affordance | Sections 1–4; affordance analysis per card |

## Visual & responsive audit (cycle 109 scout)

### (A) Collection Trends Chart — Exact Current Rendering

**Element type:** Rendered SVG pie/donut charts (NOT bar charts, NOT paired series).

**Current rendering (createPieChart() line 537–609, admin_dashboard_sql.js):**
- Builds 1–4 pie charts depending on data availability:
  1. Payment Type Breakdown (Seed Money vs Monthly Contributions) — lines 435–447
  2. Collections vs Arrears (two-segment donut) — lines 452–460
  3. Member Participation (Active vs Inactive members) — lines 472–489
  4. Income Sources (Contributions + Loan Interest) — lines 494–502
- **NOT a paired/overlaid series:** Each chart is a separate SVG with its own title, legend, and center label. Contributions and disbursals are NOT shown together; they appear in separate charts (Payment Type, Income Sources). Monthly trend is NOT rendered in this section at all.
- **SVG structure (line 598):** `<svg viewBox="0 0 240 240" style="opacity: 0; transition: opacity 0.5s ease;">` containing `<g transform="rotate(-90 ...)">` with `<circle>` elements for each segment (pie-chart-segment class, line 568).
- **Legend:** Below each SVG (pie-chart-legend, line 606), with label + formatted currency/count value side-by-side (inline flex, line 580–583).

**What makes it "look bad" — ranked issues:**

| Rank | Issue | Root cause | Drawing line(s) | Visual symptom |
|---|---|---|---|---|
| 1 | **Staggered segment fade-in animation** | Opacity cascading via setTimeout (line 512) creates sequential pop-in per segment (200ms delay per segment) instead of simultaneous or smooth group fade | admin_dashboard_sql.js:507–515 | Distracting piecemeal appearance; looks like chart is "loading" or breaking mid-render rather than appearing cohesively |
| 2 | **Legend text overflow on narrow screens** | Inline flex with `justify-content: space-between;` and long labels (e.g., "Monthly Contributions:") wrap or squash on small cards | admin_dashboard_sql.js:580 (flex layout); no `max-width` on legend-item text | Long label + currency value jammed together; text wraps awkwardly inside card; values may clip at card edge on <375px |
| 3 | **SVG initial opacity 0 flicker on load** | SVG and segment opacity both start at 0, both animate to 1 separately (line 572, 510) — intermediate state with invisible SVG until timeout fires (line 507: 100ms delay) | admin_dashboard_sql.js:598 (SVG style), 507–510 | Brief blank space where chart should be; jarring white-out before segments appear |
| 4 | **No axis labels or scale reference** | Donut charts intentionally minimal (center value + legend only); no outer ring labels, no scale markings | createPieChart() design (line 601–604 center-only) | Percentages rely entirely on center label; no visual indication of segment proportions except by arc width (unintuitive for small segments) |

**Verdict:** The chart is NOT broken; it renders correctly as interactive SVGs. The "look bad" complaints are about animation smoothness (staggered fade), text overflow handling, and minimal labeling — primarily UX polish issues, not structural bugs.

---

### (B) Responsive Overflow — Concrete Culprits (Ranked)

**Affected pages:** admin_dashboard, analytics, user_dashboard, user_analytics (all with heavy markup cycles 99–108).

| Rank | CSS Culprit | Stylesheet:line | Element/Selector | Page(s) affected | Breakpoint | Property at fault | Symptom on 375px mobile |
|---|---|---|---|---|---|---|---|
| **1** | `.chart-container` / `#chartContainer` inline grid | admin_dashboard.html:1799 (inline style) | `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))` | admin_dashboard, analytics | **No responsive rule** (breaks at <400px) | `minmax(280px, 1fr)` forces 280px minimum; page padding 32px each side = 311px effective; one card overflows | Single 280px pie chart + legend squashed into 311px container; legend wraps awkwardly; grid gutters (var(--bn-space-6)=24px) claim space |
| **2** | `.stats-grid` flex layout, mobile breakpoint INCOMPLETE | admin_dashboard.html:1342–1352 | `display: grid; grid-template-columns: repeat(2, 1fr);` on mobile | admin_dashboard | **768px breakpoint exists** but missing responsive update to `.chart-container` | At 768px, stats grid switches to 2-col ✓, but #chartContainer (line 1799) stays at auto-fit minmax(280px) | Stat cards resize correctly; pie-chart-container cards do NOT; two adjacent 280px cards + 24px gap = 584px > 311px width → horizontal scroll |
| **3** | `.stat-card-popover` no viewport clamping below 768px | admin_dashboard.html:1359–1364 | `.stat-card-popover { max-width: calc(100vw - var(--bn-space-8)); }` | admin_dashboard (stats grid popovers) | 768px media rule exists | `max-width: calc(100vw - var(--bn-space-8))` = 100vw - 32px; clamping is present ✓ but positioned `left: 0; right: 0` on card (line 619) which can still overflow on 2-col grid if card < 200px | Popover extends beyond card width on 2-col 768px layout; positioned absolutely to card, so clamping helps but doesn't fully solve narrow-card case |
| **4** | `.pie-chart-legend` inline flex with no wrap | admin_dashboard.html:840–847 / analytics.html:81–88 | Flex row layout on `.legend-item` (line 580–583 createPieChart) | admin_dashboard, analytics, user_analytics | **No per-legend responsive rule** | `display: flex; justify-content: space-between;` pushes label left and value right; no `flex-wrap`, no max-width on value | Long labels (e.g., "Monthly Contributions: MWK 123,456") squeeze into card width; value pushed right and may clip against card border on narrow cards |
| **5** | `.content-card-body` padding unchanged on mobile | admin_dashboard.html:1382–1384 | `padding: var(--bn-space-4);` on mobile (was var(--bn-space-6) on desktop) | admin_dashboard (content cards: Collection Trends, Due Payments, Pending Approvals) | 768px media rule exists | Reduces padding 32px → 16px, but the child grid (#chartContainer) still has `minmax(280px)` | Padding helps slightly, but primary culprit is grid column width, not padding |
| **6** | `.due-payment-card` (Due Payments section grid) | admin_dashboard.html:1770 (inline) | `grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));` | admin_dashboard (Due Payments cards section) | **No 768px update** | `minmax(200px, 1fr)` = 200px minimum per card; with 311px effective width = one card + partial second card | Due payment cards (3–4 per row on desktop) squash into single column; second card partially visible on right edge |
| **7** | `.page-stats` (analytics/user_analytics section) | admin-layout.css:889–895 | `display: flex; overflow-x: auto;` on `.page-stats` flex row | analytics, user_analytics | **768px responsive exists** (page-stats-bar becomes grid) but `.page-stats` (different class) lacks rule | `.page-stats` → still a flex row with `overflow-x: auto` on mobile; individual stat min-width 120px (dashboard-content .page-stat, line 897–913 admin-layout.css) | Horizontal scroll on stats bar even though it could stack |

---

### (C) Severity Ranking — Pages Most Affected

| Page | Overall severity | Primary culprits | Most noticeable impact | Breakpoint |
|---|---|---|---|---|
| **admin_dashboard** | **HIGH** | (1) #chartContainer grid (280px minmax, no mobile rule); (2) .due-payment-card grid (200px minmax, no mobile rule); (3) .stats-grid layout okay (2-col on mobile ✓) but popover clamping insufficient on narrow 2-col cards | Collection Trends pie charts overflow horizontally; Due Payments grid squashes to 1 col with second card peeking off-screen | <375px (mobile), <768px (tablet) |
| **analytics** | **HIGH** | (1) #chartContainer (same 280px minmax issue); (2) #accountingFiguresBlock nested grid (inherits .charts-grid minmax(280px)); (3) .breakdown-card legend text overflow (long accounting labels) | Pie charts + accounting figures grid squashed; legend text wraps awkwardly inside cards | <375px (mobile), <768px (tablet) |
| **user_dashboard** | **MEDIUM** | (1) Current group display possibly overflows on narrow topbar (line 81–117); (2) Hero section stats bar (overflow-x: auto) works but not optimally on mobile | Top-nav current-group display hides at 768px ✓ (line 119–123); hero stats bar offers scroll instead of stacking | <375px |
| **user_analytics** | **MEDIUM** | (1) .page-stats flex row (same as analytics); (2) Chart grid if user_analytics uses #chartContainer (needs verification) | Stats bar scrollable on mobile; responsive rule exists but not optimal; chart grid (if present) inherits admin_dashboard issues | <768px |

---

### (D) Root Cause: Centralized or Scattered?

**CENTRALIZED, fixable in 2–3 places:**

1. **Shared grid pattern** (`.chart-container`, `#chartContainer`, `.charts-grid` inline style): All use `repeat(auto-fit, minmax(280px, 1fr))` without 768px media rule.
   - Appears in: admin_dashboard.html:776 (CSS), 1799 (inline); analytics.html:17–22 (inline `<style>`); user_analytics (likely same if it uses charts).
   - **Fix scope:** Add single `@media (max-width: 768px)` rule to reduce minmax to `minmax(160px, 1fr)` or switch to single-column `1fr`.

2. **Stat card popover width** (`.stat-card-popover`): Positioned absolutely; clamping rule exists at 768px but uses viewport width, not card width.
   - Appears in: admin_dashboard.html:615–628.
   - **Fix scope:** No additional CSS needed (rule 1359–1364 already handles it); issue is positioning model limitation (absolute positioning to card), not CSS bug per se.

3. **Legend text overflow** (inline flex in `.legend-item` created by createPieChart()): No word-break or max-width constraint.
   - Appears in: admin_dashboard_sql.js:580–583, analytics_sql.js (if used), user_analytics_sql.js (if used).
   - **Fix scope:** Add `overflow-wrap: break-word; max-width: 100%;` to `.legend-item` span rule OR modify inline style in createPieChart to constrain label width.

4. **Due Payments grid** (`.due-payment-card` container, admin_dashboard.html:1770): Uses `minmax(200px, 1fr)` with no 768px rule.
   - Appears in: admin_dashboard.html:1770 (inline).
   - **Fix scope:** Add media rule to reduce minmax or switch to flex wrapping.

**VERDICT:** Overflow is **dominated by 2–3 shared grid/flex patterns** (minmax sizes, no responsive rules). Fixing the `.chart-container` grid + `.due-payment-card` grid + legend overflow in those 2–3 places will resolve ~80% of visible overflow issues.

---

### (E) Gaps & Follow-up

**GAPS:**
- User_analytics page structure unknown; unclear if it uses #chartContainer or its own chart grid. Needs verification for completeness.
- analytics.html has .breakdown-card grid (line 160–200); unclear if it inherits #chartContainer CSS or has its own responsive rule.
- Exact viewport widths where pop-in happens (280px minmax at what container width?) — testing on real 375px device recommended.

**DEAD:**
- analytics.html:24–102 defines inline `.pie-chart-*` styles that duplicate admin_dashboard.html:784–847 (identical rules); consolidation opportunity into shared CSS.
- analytics.html has `.charts-grid` inline style (line 17–22) that mirrors admin_dashboard.html #chartContainer inline style (line 1799); same rules, different selectors.

---

### Summary Table — CSS Changes Required

| Issue | File:line | Selector | Current | Proposed | Breakpoint |
|---|---|---|---|---|---|
| Chart grid overflow | admin_dashboard.html:776 + 1799 inline | `.chart-container` / `#chartContainer` | `minmax(280px, 1fr)` | Add `@media (max-width: 768px) { grid-template-columns: 1fr; }` OR `minmax(140px, 1fr)` on mobile | 768px |
| Due payment grid overflow | admin_dashboard.html:1770 inline | `#duePaymentsCards` | `minmax(200px, 1fr)` | Add `@media (max-width: 768px) { grid-template-columns: repeat(2, 1fr); }` OR `1fr` | 768px |
| Legend text squeeze | admin_dashboard_sql.js:580–583 (inline HTML) | `.legend-item` / span containing label | Inline flex, label left/value right, no constraint | Add `overflow-wrap: break-word; word-break: break-word;` to `.legend-item` CSS OR constrain flex children width | N/A (CSS only) |
| Duplicate chart styles | analytics.html:24–102 | `.pie-chart-*` selectors | Inline `<style>` duplicating admin_dashboard rules | Move to shared stylesheet (e.g., design-system.css or new chart-common.css) | N/A (consolidation) |

---

## Member loan-origination surface (cycle 118 scout)

**CRITICAL FINDING:** The inherited claim underpinning BL-4 ("no member-facing flow calls `loans.request`; only admin `loans.force` originates loans") is **FALSE**. G1 shipped a fully-wired member loan-request modal on `user_dashboard.html` that calls the enforced endpoint `loans.request` with valid body fields. The member-facing origination flow is ALREADY LIVE and connected to the server-side gate.

### Q1. Member-facing loan REQUEST form — YES, WIRED

**Location:** `pages/user_dashboard.html` lines 2376–2462 (modal markup) + `scripts/user_dashboard_sql.js` lines 2515–2874 (modal logic)

**Modal ID:** `loanModal` (user_dashboard.html:2376)

**Form ID:** `loanRequestForm` (user_dashboard.html:2383)

**Open handler:** `openLoanModal()` (user_dashboard_sql.js:2534–2567) — triggered by click on `#requestLoanBtn` (user_dashboard.html:2243, wired at user_dashboard_sql.js:1837)

**Submit handler:** `handleLoanSubmit(event)` (user_dashboard_sql.js:2815–2874) — calls `apiPost("loans.request", {...})` at line 2854

**Form fields collected:** `groupId`, `principalAmount`, `repaymentPeriod` (as number), `purpose` (combined from purpose select + optional description textarea), `loanType` (set to the purpose value per line 2862 comment)

**Request body shape (lines 2854–2863):**
```
{
  groupId: string,
  principalAmount: string (from input value),
  repaymentPeriod: number,
  purpose: string,
  loanType: string (= purpose value)
}
```

---

### Q2. G1 eligibility/standing panel — rendered into #loanStandingPanel

**Panel element:** `#loanStandingPanel` (user_dashboard.html:2384, bare `<div>`)

**Data fetch:** `loadLoanStanding()` (user_dashboard_sql.js:2584–2619) calls `await apiGet("loans.eligibility", { groupId })` at line 2605

**Render handler:** `renderLoanStanding(elig)` (user_dashboard_sql.js:2634–2740) — builds the panel with createElement/textContent only (line 2632 comment), displaying:
- `elig.activeLoanCount` + list of active loans (status, balance)
- `elig.arrears` (formatted via `formatCurrency`)
- `elig.penalties` (formatted via `formatCurrency`)
- If ineligible (`!elig.eligible`), renders red warning box with `elig.reasons` list (lines 2708–2732) and disables submit button

---

### Q3. loan_payments.html modal pattern & "Request a loan" entry point

**Existing modal markup (lines 380–479):**
- `<div class="modal-overlay hidden" id="paymentModal">` (line 380)
- `<div class="modal-content modal-wide">` (line 381)
- `<div class="modal-header">` with `.modal-title` and `.modal-close` (lines 382–385)
- `<div class="modal-body">` containing `<form id="loanPaymentForm">` (lines 386–387)
- Form `.form-group` blocks (line 389+) with `.form-label`, `.form-input`, `.form-textarea`, `.form-select`

**"Request a loan" entry point:** NOT PRESENT on loan_payments.html. No button, no header section, no anchor link to user_dashboard's loan modal. Candidate for a Quick Actions area or modal trigger button, but not yet added.

---

### Q4. user_dashboard.html Quick Actions block — lines 2239–2271

**Container:** `<div class="hero-quick-actions">` (line 2240)

**Label:** `<div class="hero-quick-actions-label">Quick Actions</div>` (line 2241)

**Action buttons** (all inside `.quick-actions` grid, lines 2243–2269):

| Button ID | Type | Label | Handler/Link |
|---|---|---|---|
| `requestLoanBtn` | `<button>` | "Request Loan" | click → `openLoanModal()` (wired at user_dashboard_sql.js:1837) |
| `uploadPaymentBtn` | `<button>` | "Upload Payment" | click → `openPaymentModal()` (wired at user_dashboard_sql.js:1893) |
| `upcomingPaymentsBtn` | `<button>` | "Upcoming Payments" | click → `openUpcomingPaymentsModal()` (wired at user_dashboard_sql.js:1895) |
| `viewPaymentDetailsBtn` | `<button>` | "Payment Details" | click → `openPaymentDetailsModal()` (wired at user_dashboard_sql.js:1897) |
| `viewMembersBtn` | `<a>` | "Members" | href="contacts.html" |
| `viewRulesBtn` | `<a>` | "Rules" | href="view_rules.html" |
| Analytics | `<a>` | "Analytics" | href="user_analytics.html" |
| `viewGroupsBtn` | `<button>` | "Groups" | click handler (wired at user_dashboard_sql.js:1900) |
| Settings | `<a>` | "Settings" | href="settings.html" |

---

### Q5. loans.request — REQUIRED/OPTIONAL fields & response shapes

**Endpoint:** `api/index.php?action=loans.request` (route at api/index.php:68: `'loans.request' => ['POST', 'request_loan']`)

**Handler:** `request_loan()` (api/handlers/loans.php:285–412)

**Auth:** Line 294 — `require_role($groupId, ['member', 'admin', 'senior_admin', 'treasurer'])` — a plain member **is permitted**

**Request body — REQUIRED fields:**
- `groupId` (string) — line 288; validated not empty at line 290
- `principalAmount` (string/number) — line 296; passed through `loan_money_input_to_string()` (validation at lines 302–308)
- `repaymentPeriod` (int) — line 297; validated 1–3 months (line 328)
- `purpose` (string) — line 298; validated not empty (line 310)

**Request body — OPTIONAL fields:**
- `loanType` (string) — line 299; validated via `loan_type_or_other()` against `LOAN_TYPES` allowlist (falls back to `'Other'`)
- `collateral` (string) — line 402; stored NULL if absent/blank
- `guarantorName` (string) — line 403; stored NULL if absent/blank
- `guarantorPhone` (string) — line 404; stored NULL if absent/blank
- `guarantorRelationship` (string) — line 405; stored NULL if absent/blank

**Validation checks (lines 302–341):**
1. Principal > 0 (line 307)
2. Purpose not empty (line 310)
3. Principal ≤ group's `loanRulesMaxLoanAmount` (line 322)
4. Repayment period within group's min/max (line 328)
5. Borrower eligibility via `loan_eligibility_check()` (lines 337–341) — same gate used by `loans.eligibility` preview

**Success response (line 411):**
```
{
  "data": {
    "loan": {
      loanId, groupId, loanNumber, borrowerId, borrowerName, borrowerEmail,
      principalAmount, status ('pending'), repaymentPeriod,
      interestRateMonth1/2/3, totalInterest ('0.00'), totalRepayment ('0.00'),
      monthlyPayment ('0.00'), requestedAt (NOW()), purpose, loanType,
      collateral, guarantorName, guarantorPhone, guarantorRelationship,
      amountRepaid ('0.00'), remainingBalance ('0.00'), penaltiesCharged ('0.00'),
      createdAt, updatedAt
    }
  },
  "status": 201
}
```

**Error responses:**
- `422` validation error — missing/empty required field, principal ≤ 0, exceeds max, period out of range, invalid amount format
- `409` eligibility check failed — returns `json_error(implode(' ', $eligibility['reasons']), 409)` — member is ineligible per gate
- `404` borrower profile not found (users table)
- `401` auth session invalid/expired

---

### Q6. DOM builders, toast, form-submit helpers — available on user_dashboard_sql.js

**Modal open/close helpers (file: user_dashboard_sql.js):**

| Helper | Line | Signature | Notes |
|---|---|---|---|
| `openLoanModal()` | 2534 | async function → sets modal display, resets form, calls `loadLoanStanding()` | Populates loanGroup select + loanTargetMonth select dynamically |
| `closeLoanModal()` | 2804 | function → hides modal, removes display styles | Plain DOM manipulation |
| `handleLoanSubmit(event)` | 2815 | async function(event) → validates fields, calls `apiPost("loans.request", ...)`, closes modal on success | Calls `showToast()` on error; re-loads dashboard on success (line 2870) |

**Eligibility preview helpers (file: user_dashboard_sql.js):**

| Helper | Line | Signature | Notes |
|---|---|---|---|
| `loadLoanStanding()` | 2584 | async function → fetches `loans.eligibility`, renders into `#loanStandingPanel` | Never throws; gracefully handles fetch errors (lines 2607–2617) |
| `renderLoanStanding(elig)` | 2634 | function(elig) → builds panel DOM with createElement only (line 2632 comment) | No innerHTML; uses textContent for user strings; formatCurrency for money |
| `setLoanSubmitDisabled(disabled)` | 2622 | function(disabled) → querySel button[type=submit] in loanRequestForm, sets disabled property | Guards against ineligible submissions |
| `updateLoanPreview()` | 2748 | function → debounced (400ms) call to `fetchLoanPreview()` | Triggered by input/change on amount/period fields (lines 1852–1856) |
| `fetchLoanPreview()` | 2753 | async function → calls `apiGet("loans.eligibility", { principal, repaymentPeriod })`, populates calc-summary spans | Never throws; uses resetLoanCalculationSummary() on error |

**Toast notification helper (file: user_dashboard_sql.js):**

| Helper | Line | Signature | Notes |
|---|---|---|---|
| `showToast(message, type)` | 2887 | function(message, type='info') → creates div.toast, appends to #toastContainer, auto-dismisses after 4s | Types: 'info', 'danger', 'success' (used in code: line 2820, 2867); container created by nav_sql.js:431–435 |

**API helpers (imported from scripts/api.js):**

| Helper | Usage in handleLoanSubmit | Signature |
|---|---|---|
| `apiPost(action, body)` | Line 2854 | `async function → throws ApiError on 4xx/5xx, returns unwrapped data on 2xx` |
| `apiGet(action, params)` | Line 2605, 2769 | `async function → fetches ?action= with query params, unwraps envelope` |

**Currency formatter (imported from scripts/utils_financial.js):**

| Helper | Usage | Signature |
|---|---|---|
| `formatCurrency(amount)` | Line 2673, 2688, 2701, 2781–2790 | `function(amount: string|number) → string 'MWK X,XXX.XX' format` |

**Form selectors/DOM refs used in modal:**

| Element | ID/Class | Retrieved by | Used for |
|---|---|---|---|
| Modal | `#loanModal` | `document.getElementById("loanModal")` | Open/close, overlay click dismiss (line 1845) |
| Form | `#loanRequestForm` | Queried in init (line 1849) | Form reset, submit wiring (line 1850) |
| Group select | `#loanGroup` | `document.getElementById("loanGroup")` | Set selected group, read on preview/submit (lines 2540, 2754, 2825) |
| Amount input | `#loanAmount` | `document.getElementById("loanAmount")` | Input change → preview trigger, read on submit (lines 1852, 2758, 2829) |
| Period select | `#loanRepaymentPeriod` | `document.getElementById("loanRepaymentPeriod")` | Change → preview trigger, read on submit (lines 1855, 2760, 2830) |
| Purpose select | `#loanPurpose` | `document.getElementById("loanPurpose")` | Read on submit (line 2832) |
| Description textarea | `#loanDescription` | `document.getElementById("loanDescription")` | Read & combine with purpose (line 2833) |
| Standing panel | `#loanStandingPanel` | `document.getElementById("loanStandingPanel")` | Rendered by renderLoanStanding() (line 2585) |
| Calc-summary displays | `#loanPrincipalDisplay`, `#loanInterestDisplay`, `#loanTotalDisplay` | querySel by ID in resetLoanCalculationSummary() + fetchLoanPreview() | Display server-priced totals (lines 2571–2576, 2775–2790) |

---

### GAPS

None found. All referenced endpoints, DOM elements, and handlers are present and wired. The member loan-request flow is complete end-to-end.

### DEAD

1. **No "Request Loan" entry point on loan_payments.html** — the modal lives only on user_dashboard.html; loan_payments.html has no link, button, or modal to request a new loan. This is not dead code (the modal code is used), but a UX gap: a member viewing their loan payments cannot request a new loan from that page without navigating away. Candidate for a follow-on enhancement.

**Evidence:** Grep `"requestLoan\|Request.*[Ll]oan\|request.*loan"` in loan_payments.html returns no matches (all in user_dashboard* only).

---

### VERIFICATION OF THE CLAIM

**BL-4 inherited claim:** "No member-facing flow calls `loans.request`; only admin `loans.force` originates loans."

**Evidence that the claim is FALSE:**

1. **Member CAN call loans.request:** Auth check at loans.php:294 includes `'member'` in the role list: `require_role($groupId, ['member', 'admin', 'senior_admin', 'treasurer'])` — a plain member is permitted.

2. **Member DOES call loans.request:** Grep `"loans\.request"` across scripts/*_sql.js returns 4 matches in user_dashboard_sql.js only: line 1832 (comment), 1839 (comment), 2515 (section header), 2854 (the apiPost call). All comments explicitly document it as member-initiated: "Members may book a loan per the group rulebook" (line 1839). No admin-only gating on the call site.

3. **The flow is LIVE:** modal opens on user_dashboard.html (member page), eligibility checked by the same gate that guards the endpoint, form collects real fields per the contract.

**Consequence for BL-4/J1:** The inherited premise was wrong. J1's outcome ("a member can request their own loan but has to be approved by the admin") is **already implemented and live** — both the UI and the enforced server-side gate exist. The cycle-119 frontend build is not building new functionality; it is confirming an existing (and already working) feature. This unblocks J1 immediately.

---

## group_rules penalty schema & live values (cycle 119 scout)

**Scope:** Ground-truth read of the live `group_rules` penalty schema and all live groups' current penalty values, so J2's additive DDL extends existing columns without duplication and preserves what each group charges today.

**Method:** Single throwaway PHP script reading the live DB via `config/database.php::getDbConnection()` + queries: `DESCRIBE group_rules` (filtered to penalty/period columns) and `SELECT` all groups' penalty values. Read-only: `SHOW`/`DESCRIBE`/`SELECT` only, no write operations.

---

### KEY FINDING — Would any group start being charged when loan-percentage ships?

**ANSWER: NO. Neither of the two live groups would suddenly be charged.**

| Group ID | Loan Penalty Type | Loan Rate | Would charge? | Contribution Type | Daily Rate | Monthly Rate | Would charge? |
|---|---|---|---|---|---|---|---|
| `8e833bfe645c83597a9e6d0ddcd0c58a` | fixed | 0.00 | **NO** | fixed | 0.00 | 0.00 | **NO** |
| `cf4156a12ed6e0c1c371f1ddbe0cb1c1` | fixed | 0.00 | **NO** | fixed | 0.00 | 0.00 | **NO** |

**Rationale:** Both groups explicitly configure `penaltyType = 'fixed'` (not 'percentage'), and both have rate columns at 0.00. Therefore, launching a percentage-penalty engine affects neither group until an admin explicitly reconfigures a group to use percentage-basis penalties.

---

### 1. SCHEMA — `group_rules` columns with 'enalty' or 'Period' in the name

**Source:** Live `DESCRIBE group_rules` filtered to penalty/period columns (cycle 119, 2026-07-25).

| Field | Type | Null | Default |
|---|---|---|---|
| `loanPenaltyRate` | DECIMAL(5,2) | NO | 0.00 |
| `loanPenaltyDailyAmount` | DECIMAL(15,2) | YES | NULL |
| `loanPenaltyType` | ENUM('percentage','fixed') | NO | 'percentage' |
| `loanPenaltyGracePeriodDays` | INT | NO | 0 |
| `contributionPenaltyDailyRate` | DECIMAL(5,2) | NO | 0.00 |
| `contributionPenaltyDailyAmount` | DECIMAL(15,2) | YES | NULL |
| `contributionPenaltyMonthlyRate` | DECIMAL(5,2) | NO | 0.00 |
| `contributionPenaltyType` | ENUM('percentage','fixed') | NO | 'percentage' |
| `contributionPenaltyGracePeriodDays` | INT | NO | 0 |

**Key observations:**
1. **ENUM defaults are 'percentage' in the schema**, but all live groups have 'fixed' (see live values below). This means schema defaults apply only to rows created by `rules_ensure_row()` (new groups or self-healed rows), not to pre-existing groups.
2. **Daily/monthly distinction is implicit, not explicit:** period is determined by which rate column is non-zero (contribution engine at payments.php:276–279), not by a separate `*PenaltyPeriod` column.
3. **`loanPenaltyRate` exists but is unused:** the loan penalty engine reads `loanPenaltyDailyAmount` (penalty.php:124), not `loanPenaltyRate`. This is a schema artifact, likely from an earlier design phase.
4. **No fixed-per-month amount columns exist** — checked and confirmed absent: `loanPenaltyMonthlyAmount`, `contributionPenaltyMonthlyAmount`, `loanPenaltyPeriod`, `contributionPenaltyPeriod` all return 0 hits via live table inspect. Negative claim evidence: query `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='group_rules' AND (COLUMN_NAME LIKE '%MonthlyAmount%' OR COLUMN_NAME LIKE '%Period%')` on the live DB returned no rows for these names.

---

### 2. LIVE VALUES — all groups in `group_rules`, penalty columns only

**Source:** Live `SELECT groupId, loanPenaltyRate, loanPenaltyDailyAmount, loanPenaltyType, loanPenaltyGracePeriodDays, contributionPenaltyDailyRate, contributionPenaltyDailyAmount, contributionPenaltyMonthlyRate, contributionPenaltyType, contributionPenaltyGracePeriodDays FROM group_rules ORDER BY groupId` (cycle 119, 2026-07-25).

**Total groups:** 2 (both test/QA as per BUILD_PLAN §1 observation).

#### Group `8e833bfe645c83597a9e6d0ddcd0c58a` (QA Test Savings Group)

| Column | Value |
|---|---|
| `loanPenaltyRate` | 0.00 |
| `loanPenaltyDailyAmount` | NULL |
| `loanPenaltyType` | fixed |
| `loanPenaltyGracePeriodDays` | 0 |
| `contributionPenaltyDailyRate` | 0.00 |
| `contributionPenaltyDailyAmount` | NULL |
| `contributionPenaltyMonthlyRate` | 0.00 |
| `contributionPenaltyType` | fixed |
| `contributionPenaltyGracePeriodDays` | 0 |

**Interpretation:** No penalties configured at all. This group is in a "disabled-all" state: type is 'fixed' but both daily-amount and rate columns are 0/NULL, so the penalty engines would throw (they require a non-zero amount/rate when type is configured). This group is safe; no charges apply until an admin sets real values.

#### Group `cf4156a12ed6e0c1c371f1ddbe0cb1c1` ([QA VERIFY - safe to delete] Filter Check Group)

| Column | Value |
|---|---|
| `loanPenaltyRate` | 0.00 |
| `loanPenaltyDailyAmount` | 500.00 |
| `loanPenaltyType` | fixed |
| `loanPenaltyGracePeriodDays` | 5 |
| `contributionPenaltyDailyRate` | 0.00 |
| `contributionPenaltyDailyAmount` | 200.00 |
| `contributionPenaltyMonthlyRate` | 0.00 |
| `contributionPenaltyType` | fixed |
| `contributionPenaltyGracePeriodDays` | 5 |

**Interpretation:** Both loan and contribution penalties are configured as 'fixed' with non-zero daily amounts (MWK 500/day for loans, MWK 200/day for contributions), grace periods of 5 days, and zero rates. This group is in an active-fixed-penalties state. A 5-day grace applies to both; after grace, daily charges accrue. Safe; no change when percentage engine ships.

---

### 3. CODE FACTS — confirmed by reading live code

**File:** `api/lib/penalty.php` lines 88–224 (compute_loan_penalty)
- **Line 111:** Reads `$rules['loanPenaltyType']` as the type discriminator.
- **Lines 117–119:** If type is 'percentage', **throws**: `throw new RuntimeException('Percentage penalties are not implemented.');`
- **Line 124:** If type is 'fixed', reads `loanPenaltyDailyAmount` (NOT `loanPenaltyRate`).
- **Line 140:** Reads `loanPenaltyGracePeriodDays`.
- **Effect:** Loan penalties TODAY accept only 'fixed' basis; percentage is rejected with a 501 (`repayments.php:112` surfaces it). `loanPenaltyRate` is never used.

**File:** `api/handlers/payments.php` lines 174–369 (compute_contribution_penalty)
- **Line 208:** Reads `$rules['contributionPenaltyType']` as the type discriminator.
- **Lines 210–212:** Validates type is 'fixed' or 'percentage' (does NOT throw on percentage).
- **Lines 236–255:** If type is 'fixed', reads `contributionPenaltyDailyAmount` and charges a flat daily amount.
- **Lines 256–320:** If type is 'percentage', reads either `contributionPenaltyDailyRate` (line 273) or `contributionPenaltyMonthlyRate` (line 274) and charges `arrears × rate% × periodsCharged`.
- **Line 215:** Reads `contributionPenaltyGracePeriodDays`.
- **Effect:** Contribution penalties TODAY implement percentage, BUT they charge on `arrears` (still-owed), not the full obligation. Per BL-6(b), this is a basis change J2 must make.

**Conclusion for J2 DDL:** The engine split is real and intentional (per BL-6):
- **Loan percentage:** does not exist; must be built.
- **Contribution percentage:** exists; basis must change from arrears to full obligation.

---

### GAPS

None. All penalty columns and groups have been read and reported.

### DEAD

None. All columns in the penalty schema are referenced by at least one live code path (penalty.php or payments.php).

---

### IMPLICATIONS FOR J2 DDL

1. **No schema collision:** No `loanPenaltyMonthlyAmount`, `contributionPenaltyMonthlyAmount`, or explicit period columns exist. The schema is ready to be extended with these or alternative designs (e.g. a single `*PenaltyPeriodUnit` column selecting 'daily'/'monthly').

2. **Defaults are behaviour-preserving:** The schema ENUM defaults are 'percentage', but all live rows are 'fixed'. Any new additive column (e.g. a period selector) should default to whichever matches today's implicit behaviour for that group. For now, all are fixed, so a period selector would default to 'daily' (the only period currently in use).

3. **No migration risk:** Launching J2's dual engines (loan-percentage + contribution-basis-change) affects neither group until an admin manually reconfigures. Both would need to change `penaltyType` from 'fixed' to 'percentage' **and** set a non-zero rate to start charging. This is a conscious admin action, not a silent flip.

4. **Config column is not whitelisted:** The `update_rules()` handler (rules.php) does not include `loanPenaltyRate`, `loanPenaltyDailyAmount`, `contributionPenaltyDailyRate`, or `contributionPenaltyMonthlyRate` in its input validation whitelist (RULES_SELECT_COLUMNS). J2 slice 1 must add these to make them configurable by the admin.

---

### VERIFICATION NOTES

This is a read-only ground-truth pass. No rows were inserted, updated, or altered. The query used was single-connection, reused to avoid remote-host throttling (`SQLSTATE[HY000] [2002]`). Both `DESCRIBE` and row selects completed without error over the live cPanel MySQL.

---

## Accounting-figure display surface (cycle 121 scout)

> Five pages displaying ten cumulative group accounting figures to admins and members. Scout maps each figure's source (endpoint, handler), element ID, rendering code, and verdict. Reconciliation against raw tables confirms: settled figures are accurate; penalties are read from persisted penalty_settlements rows only (live unsettled accrual excluded). This verifies the stale-penalties gap predicted in BUILD_PLAN section 1.

### ACCOUNTING FIGURES MAPPED

#### Admin pages (analytics.html, financial_reports.html)

All ten figures from payments.accountingSummary endpoint (handler at payments.php:1557–1651):
1. **totalContributed** — SUM payments.amountPaid (approved/completed) — VERDICT: server-computed, accurate
2. **totalDisbursed** — SUM loans.principalAmount (4 statuses) — VERDICT: server-computed, accurate
3. **outstandingLoanPrincipal** — SUM loans.remainingBalance (4 statuses) — VERDICT: server-computed, accurate
4. **interestEarned** — SUM loan_payments.interestPortion (approved) — VERDICT: server-computed, accurate
5. **loanRepaymentsReceived** — SUM loan_payments.amount (approved) — VERDICT: server-computed, accurate
6. **penaltiesCharged** — SUM penalty_settlements.amountAccrued — VERDICT: stale/missing (excludes live accrual)
7. **penaltiesCollected** — SUM penalty_settlements.amountPaid — VERDICT: server-computed, accurate
8. **penaltiesWaived** — SUM penalty_settlements.amountWaived — VERDICT: server-computed, accurate
9. **penaltiesOutstanding** — calculated (charged - collected - waived) — VERDICT: stale/missing (excludes live)
10. **cashPosition** — contributed + repayments + contributionPenalties - disbursed — VERDICT: server-computed, accurate

Handler chain: endpoint called at analytics_sql.js:220 and financial_reports_sql.js:302 via apiGet(), then rendered with formatCurrency() on each field at line 573 and 378 respectively. **No client-side arithmetic.**

#### Member pages (user_dashboard.html, user_analytics.html)

| Figure | Endpoint | Verdict |
|---|---|---|
| totalContributed | payments.obligations.summary.contributed | server-computed |
| totalArrears (dashboard) | Client sum: toMinor(summary.arrears)+toMinor(summary.penaltyAccrued) at line 493 | **CLIENT SUM DEFECT** |
| totalBorrowed (analytics) | Client filter+reduce on myLoans at lines 248–250 | **CLIENT SUM DEFECT** |
| outstanding | loans.list summary.totalOutstanding | server-computed |

### LIVE RECONCILIATION (GROUP cf4156a12ed6e0c1c371f1ddbe0cb1c1)

Raw table queries matched endpoint responses byte-for-byte:

| Field | Raw SUM | Endpoint | Status |
|---|---|---|---|
| totalContributed | 100000.00 | 100000.00 | ✓ Match |
| totalDisbursed | 50000.00 | 50000.00 | ✓ Match |
| outstandingLoanPrincipal | 41666.66 | 41666.66 | ✓ Match |
| loanRepaymentsReceived | 21666.67 | 21666.67 | ✓ Match |
| interestEarned | 5000.00 | 5000.00 | ✓ Match |
| penaltiesCharged | 0.00 (persisted) | 0.00 | ✓ Match |
| penaltiesOutstanding | 0.00 (persisted) | 0.00 | ✓ Match |
| cashPosition | 7166667 minor | 7166667 minor | ✓ Match |

### PENALTY FINDINGS (STALE/MISSING VERDICT)

**Code path:** payments.accountingSummary reads penalty_settlements at lines 1606–1627. It sums amountAccrued, amountPaid, amountWaived from persisted rows only.

**Live engine:** group_arrears_summary (lines 1270–1381) computes live penaltyAccrued by iterating active members, calling payment_penalty_or_501() for each obligation type (seed, monthly, service fee). This is never persisted as a running total; it recomputes every read.

**Gap:** Any group with configured penalties, active members, and past-due obligations will show accountingSummary.penaltiesCharged=0 while group_arrears_summary.penaltyAccrued>0. This is the "penalties charged 0, arrears tile showed 1,379,000" bug class.

**Observed data:** Test group has zero penalty_settlements rows. No members are demonstrably overdue (no live accrual to measure against), so the divergence is unquantified by live data. However, the gap exists by code design and is confirmed by inspection.

### CLIENT-SIDE MONEY DEFECTS

Evidence-based findings per brief requirements:

1. **user_dashboard_sql.js:493** — Grep match: `arrearsMinor = toMinor(summary.arrears) + toMinor(summary.penaltyAccrued)`. This adds two server fields client-side. Defect: should be a single server field or computed endpoint.

2. **user_dashboard_sql.js:483–487** — Loop sums pending payments: `for (const row of payments) { if (pending) pendingMinor += toMinor(row.amountPaid) }`. Defect: should be a server field.

3. **user_analytics_sql.js:248–250** — Grep match: `const totalBorrowed = myLoans.filter(...).reduce((sum,l) => sum + numberOf(...), 0)`. Filter+reduce on client array. Defect: should be a server field (loans.list summary).

### GAPS

None. All accounting endpoints are wired and functional. admin_dashboard does not display the ten accounting figures, but this is intentional (it displays trends instead); the page is not dead.

### DEAD

None. All accounting figures are referenced by at least one endpoint or display handler.


---

## Accounting drill-down surface (cycle 125 scout)

Owner brief: Map the Group Accounting Position drill-down surface — the #accountingFiguresBlock render, the payments.accountingSummary handler internals, the existing modal mechanism to reuse, and per-figure period/row-source table for backend slice.

**STATCARD SIGNATURE TODAY:** analytics_sql.js:530
```
statCard(label, value, infoText?)
```
Takes 3 parameters: label (display string), value (pre-formatted string), optional infoText. **No click affordance — cards are inert today.** The ten figures are rendered by renderAccountingFigures() (line 558–575) which calls statCard() for each with no click handler.

**PAYMENTS.ACCOUNTINGSUMMARY HANDLER:** api/handlers/payments.php:1615–1747
- **Route:** `payments.accountingSummary` → GET, handler `group_accounting_summary` (api/index.php:89)
- **Parameters:** `groupId` only (line 1617: `$_GET['groupId']`) — **NO year/month parameter currently**
- **Auth:** Line 1622: `require_role($groupId, PAYMENT_ADMIN_ROLES)` where PAYMENT_ADMIN_ROLES = ['admin', 'senior_admin', 'treasurer'] (line 52)
- **Returns:** 10 money summary strings (lines 1735–1746), NOT row-level data

**EXISTING MODAL ON ANALYTICS.HTML:** NONE
Grep `"modal\|dialog\|Modal\|Dialog"` on pages/analytics.html returns zero matches. No modal markup exists on this page.

**MODAL PATTERN TO REUSE:** admin_dashboard.html stat-modal
- **CSS:** Lines 1606–1802 (.stat-modal-overlay, .stat-modal, headers, body, close button, empty state, media queries)
- **HTML markup:** Lines 2056–2077 (overlay with stop-propagation, header with icon+title+close, body with empty state)
- **Open function:** admin_dashboard_sql.js:1124–1156 `openStatModal(type)` — adds `.open` class, sets title/icon, builds and renders items
- **Close function:** Lines 1161–1168 `closeStatModal()` — removes `.open` class, restores body overflow
- **Overlay click handler:** Lines 1174–1176 `closeStatModalOnOverlay(event)` — closes if target is overlay
- **Escape key handler:** Lines 1477–1479 — document keydown listener closes modal on Escape

---

### Per-Figure Period-Scoping Table

The table below answers for each of the ten figures: (1) what table/columns/WHERE filter today, (2) what date column it can be scoped by, (3) what rows would appear in a drill-down table, (4) whether a row-returning server source exists.

| Figure | Source table(s) + column(s) + WHERE | Date column for period-scoping | Underlying drill-down rows | Row-returning source exists? |
|---|---|---|---|---|
| **totalContributed** | `payments.amountPaid WHERE groupId & approvalStatus IN ('approved', 'completed')` | `payments.year` (INT, 4 non-null rows in cf41) OR `payments.month` (ENUM, 2 non-null rows) | payment_id, member_uid, amountPaid, approvalStatus, year, month, approvedAt, createdAt | YES: `payments.list?year=YYYY` (lines 846–852 of payments.php) |
| **totalDisbursed** | `loans.principalAmount WHERE groupId & status IN ('approved', 'disbursed', 'completed', 'defaulted')` | `loans.approvedAt` (DATETIME, 1 non-null row in cf41) OR `loans.disbursedAt` (DATETIME column exists, 0 non-null rows in cf41) | loanId, borrowerId, principalAmount, approvedAmount, status, approvedAt, disbursedAt, requestedAt | YES: `loans.list` (lines 192–223 of loans.php) — no year param but can filter on approvedAt client/server-side |
| **outstandingLoanPrincipal** | `loans.remainingBalance WHERE groupId & status IN ('approved', 'disbursed', 'completed', 'defaulted')` | `loans.approvedAt` (1 row in cf41) OR `loans.disbursedAt` (0 non-null rows in cf41) | loanId, borrowerId, remainingBalance, status, approvedAt, disbursedAt, requestedAt, createdAt | YES: `loans.list` (same handler as totalDisbursed) |
| **interestEarned** | `loan_payments.interestPortion WHERE groupId & status = 'approved'` | `loan_payments.approvedAt` (DATETIME, 1 non-null row in cf41) | loan_payment_id, loanId, borrowerId, amount, interestPortion, principalPortion, penaltyPortion, status, approvedAt, paidAt | **NO — no loan_payments row-returning endpoint exists today** |
| **loanRepaymentsReceived** | `loan_payments.amount WHERE groupId & status = 'approved'` (same query as interestEarned) | `loan_payments.approvedAt` (1 row in cf41) | loan_payment_id, loanId, borrowerId, amount, interestPortion, principalPortion, penaltyPortion, status, approvedAt, paidAt | **NO — no loan_payments row-returning endpoint exists today** |
| **penaltiesCharged** | Derived: `collected + waived + outstanding` (line 1728 of payments.php) — **not a direct table query** | **Cannot period-scope from single column** — derived from sub-components below | Must drill to sub-components (collected, waived, outstanding separately) | **NO — derived formula, no row source** |
| **penaltiesCollected** | `penalty_settlements.amountPaid WHERE groupId & paymentId IS NOT NULL` (contribution penalties, lines 1679–1680 of payments.php) | `penalty_settlements.settledAt` (DATETIME exists, 0 non-null rows in cf41) OR `penalty_settlements.accruedFrom/accruedTo` (DATETIME range) | penalty_settlement_id, paymentId, loanId, amountPaid, amountWaived, accruedFrom, accruedTo, settledAt | **NO — no penalty_settlements row-returning endpoint exists today** |
| **penaltiesWaived** | `penalty_settlements.amountWaived WHERE groupId` (same query as penaltiesCollected, lines 1664–1682) | `penalty_settlements.settledAt` (0 non-null rows in cf41) OR `accruedFrom/accruedTo` | penalty_settlement_id, paymentId, loanId, amountWaived, accruedFrom, accruedTo, settledAt | **NO — no penalty_settlements row-returning endpoint exists today** |
| **penaltiesOutstanding** | Live-computed: `group_live_contribution_penalty_minor($pdo, $groupId, $rules, $year)` (line 1700–1701) + loop of `compute_loan_penalty()` per loan (line 1714–1725). **Contribution engine HARDCODED to current year at line 1698:** `$year = (int) date('Y');` **Loan penalties are per-loan all-time with no period column.** | **CANNOT period-scope from existing columns** — contribution engine year-only, loan engine has no date persistence | Contribution penalties: member contributions without full penalty paid. Loan penalties: each loan's live penalty_amount minus settlements | **NO — live engine year-scoped (contributions) / per-loan all-time (loans); no period-scopable row source** |
| **cashPosition** | Derived: `totalContributed + loanRepaymentsReceived + contributionPenaltiesCollected - totalDisbursed` (lines 1730–1733 of payments.php) — **not a direct table query** | **Cannot period-scope from single column** — derived from sub-components | Must drill to sub-components (contributed, repaid, collected, disbursed separately) | **NO — derived formula, no row source** |

**Key findings:**
1. **Fully period-scopable with live data in cf41:** totalContributed (payments.year: 4 rows), totalDisbursed (loans.approvedAt: 1 row), interestEarned (loan_payments.approvedAt: 1 row), loanRepaymentsReceived (loan_payments.approvedAt: 1 row)
2. **Period-scopable but sparse data in cf41:** outstandingLoanPrincipal (loans.disbursedAt: 0 rows), penaltiesCollected (settledAt: 0 rows), penaltiesWaived (settledAt: 0 rows)
3. **Cannot be period-scoped without extending engines:** penaltiesOutstanding (contribution hardcoded to date('Y'); loan penalties have no date column), penaltiesCharged (derived), cashPosition (derived)

### Row-Returning Sources Available

| Endpoint | Route (api/index.php) | Year/month parameter? | Returns rows? | Coverage |
|---|---|---|---|---|
| `payments.list` | Line 82: `['GET', 'list_payments']` | YES: `?year=YYYY` (lines 846–852 of payments.php) | YES: full payment array with year, month, amountPaid, approvalStatus, approvedAt, createdAt | totalContributed, penaltiesCollected (partial: via paymentId scope) |
| `loans.list` | Line 66: `['GET', 'list_loans']` | NO: no year/month param in handler (lines 192–222 of loans.php) | YES: full loan array with approvedAt, disbursedAt, principalAmount, remainingBalance, status | totalDisbursed, outstandingLoanPrincipal (would need period filter on approvedAt/disbursedAt) |
| `statement.get` | Line 93: `['GET', 'get_statement']` | YES: `?year=YYYY` via `statement_resolve_year()` (lines 341–351 of statement.php) | YES: member-scoped statement with contributions, loanAccount, penalties arrays | Member-only, NOT group-wide — cannot support group accounting position |
| **loan_payments query** | **Does not exist as endpoint** | **N/A** | **Would return:** loan_payment_id, loanId, borrowerId, amount, interestPortion, principalPortion, penaltyPortion, status, approvedAt, paidAt | Would support: interestEarned, loanRepaymentsReceived (must be built) |
| **penalty_settlements query** | **Does not exist as endpoint** | **N/A** | **Would return:** penalty_settlement_id, paymentId, loanId, amountPaid, amountWaived, accruedFrom, accruedTo, settledAt | Would support: penaltiesCollected, penaltiesWaived (must be built) |

### Live Database Confirmation for cf41

Scripted via `getDbConnection()` + DESCRIBE queries + SELECT non-null counts on group `cf4156a12ed6e0c1c371f1ddbe0cb1c1`:

| Table | Column | Type | Non-null rows in cf41 | Period-scopable? |
|---|---|---|---|---|
| payments | year | INT | 4 (1 distinct year) | YES |
| payments | month | ENUM (12 months) | 2 | YES (sparse) |
| loans | approvedAt | DATETIME | 1 | YES |
| loans | disbursedAt | DATETIME | 0 | NO (column exists, no data) |
| loan_payments | approvedAt | DATETIME | 1 | YES |
| penalty_settlements | accruedFrom | DATETIME | (present in schema) | Partial (depends on rows) |
| penalty_settlements | accruedTo | DATETIME | (present in schema) | Partial (depends on rows) |
| penalty_settlements | settledAt | DATETIME | 0 | NO (column exists, no data) |

**Verdict:** All required date columns exist in the MySQL schema. Contribution and loan-repayment figures can be period-scoped with existing data. Penalty figures are schema-ready but have zero settlements in cf41 test group. Live penalties (penaltiesOutstanding) cannot be period-scoped today without extending the live-penalty engines to accept a year parameter.

### GAPS

1. **No row-returning loan_payments endpoint** — group_accounting_summary sums loan_payments rows but returns only totals (lines 1651–1661). To drill down interestEarned/loanRepaymentsReceived by period, a new endpoint or period parameter is required.

2. **No row-returning penalty_settlements endpoint** — group_accounting_summary sums penalty_settlements rows but returns only totals (lines 1664–1682). To drill down penaltiesCollected/penaltiesWaived by period, a new endpoint or period parameter is required.

3. **No period parameter on payments.accountingSummary** — Handler returns group-wide cumulative figures only. Adding `?year` and/or `?month` parameters would enable month/year drill-down; parameters would be passed through to the underlying queries (payments, loans, loan_payments, penalty_settlements).

4. **Live penalties engine does not expose period-scoped data** — group_live_contribution_penalty_minor() is hardcoded to `date('Y')` at line 1698 of payments.php (current year only). compute_loan_penalty() is per-loan with no date parameter; loan penalties have no persistent date column. Period-scoping penaltiesOutstanding without extending the engines or adding a date column is not feasible today.

### DEAD

None. All ten figures are rendered and referenced by renderAccountingFigures() (analytics_sql.js:572–574). Modal markup and handler are wired end-to-end.
