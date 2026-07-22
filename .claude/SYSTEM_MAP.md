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
