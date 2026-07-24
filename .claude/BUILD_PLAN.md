# BUILD_PLAN.md — Bank Nkhonde (LIVE PLAN)

> Owned by `build-planner`. **One objective per cycle.** Specialists read their dispatch brief, never this file.
>
> **HARD SIZE RULE: this file stays under 400 lines / 60 KB.** It was allowed to reach 3,033 lines / 781 KB — past the Read tool's 256 KB limit — which meant the planner that owns it could no longer open it. `doc-curator` rotates history out to `archive/` whenever it exceeds the cap. **Never append a full cycle narrative here.** A closed cycle earns at most one line.
>
> **Full history (cycles 1–113, verbatim, nothing lost): `.claude/archive/BUILD_PLAN_history_cycles-1-113_2026-07-25.md`.** Grep it when you need the reasoning behind a closed decision; never load it whole.

---

## 0. HOW THIS FILE WORKS

| Section | What goes in it | Who writes it |
|---|---|---|
| 1. CURRENT STATE | The one-paragraph verdict: complete, mid-directive, or blocked | build-planner |
| 2. PROJECT COMPLETE WHEN | The fixed A–F scope. **The definition of done.** Never edited except to tick a box | build-planner |
| 3. OWNER-PROMOTED GROUPS | G/H/I… enrichment groups, one line each | build-planner |
| 4. OPEN ITEMS | The **only** actionable backlog. Blocked items + parked follow-ups | build-planner |
| 5. APPLIED DDL | Every schema change applied to the live DB, verbatim SQL | backend-specialist |
| 6. ASSUMPTIONS LOG | Standing product decisions taken autonomously — the owner's override list | build-planner |
| 7. FUTURE IDEAS | Out of scope until the owner promotes it | build-planner |
| 8. ACTIVE CYCLE | Rolling scratch for the cycle in flight only. Overwritten each cycle | build-planner |
| 9. ARCHIVE INDEX | Where closed history lives | doc-curator |

**Writing rules.** A closed cycle collapses to one line under the deliverable it traced to. A dispatch brief lives in section 8 while the cycle runs and is **deleted** when it closes (the brief's value expires with the cycle; the outcome is what persists). Anything longer than ~5 lines that must survive goes to the archive with a pointer here.

---

## 1. CURRENT STATE (as of 2026-07-25, after cycle 117 — **LOOP REOPENED**)

**A–F COMPLETE; G/H/I CLOSED; group J promoted and in flight.** Every box in section 2 (A–F) is `[x]` and has been since cycle 47. G (loan eligibility), H (money-moment info & accounting) and I (dashboards/nav/analytics usability) are closed. The E3 undefined-token bug class is closed by measurement (cycles 113–115: 4,541 `var(--bn-*)` uses across 76 served files, **0 undefined**, reproduced independently over HTTP).

**The loop is no longer halted.** The owner answered four of the five standing blockers, signed off the dead-file deletion, reported a live bug, and directed a new feature. Group **J** is promoted (section 3); **J1 is unblocked and dispatched**. One new blocker, **BL-6**, gates J2 alone and stalls nothing else.

**Cycle 117 — hotfix shipped directly, no dispatch (the owner was looking at a dead page).** `pages/manage_payments` was blank in the browser: `Uncaught SyntaxError: Identifier 'emptyState' has already been declared`. `scripts/manage_payments_sql.js` imported `emptyState` from `./ui.js` **and** declared its own `function emptyState(icon, text)` — a duplicate module-scope binding, so the whole module failed to parse. A half-finished migration: one call site already used the shared helper's object form, another still used the old two-arg form. Two edits: local function deleted, remaining call site converted. Filed under **E4**.

**The systemic finding matters more than the bug.** The project's JS syntax gate was `node --check <file>`, which parses as **CommonJS** and returns **exit 0** on this exact file — it is structurally incapable of catching an import/local duplicate-identifier collision, and every script here loads as `<script type="module">`. The gate is now **`node --input-type=module --check < scripts/x_sql.js`**, corrected in `frontend-specialist`, `qa-auditor` (header + LINT mode), `live-verifier`, `build-planner` and the build-loop skill, and recorded as a standing rule in section 6. A sweep of all 46 modules in module mode now shows **0 failing**.

**One caveat on "complete":** completeness here means *built + diff-reviewed + (where marked) LIVE-VERIFIED over HTTP/DB* — **not visually rendered in a browser**. Cycle 117 is the counter-example that proves the caveat: every affected surface was built, QA-passed and HTTP-verified, and the page was still dead on arrival in a real browser.

**A standing correction from cycle 116:** a parked item asserted for eleven days that the owner's "Test" group had 0 `group_rules` rows. A verifier on the live DB found that group does not exist and no group is missing its rules row. Recorded under B1; generalised into section 6 ("a parked item describing live data is a claim with a shelf life").

---

## 2. PROJECT COMPLETE WHEN *(fixed scope — owner-approved cycle 28, 2026-07-13)*

**This is the definition of done.** No task enters the backlog unless it traces to a tag below. Anything else goes to section 7.

### A. Data & API foundation
- [x] **A1** — SQL schema migrated and live: all tables, FKs, money DECIMAL, zero FLOAT.
- [x] **A2** — Every money computation server-side in integer minor units; no client does money math.
- [x] **A3** — Session auth + server-side `require_role()` on every group-scoped endpoint.
- [x] **A4** — One consistent JSON envelope; no stack trace or internal error reaches the client.

### B. Feature endpoints (backend)
- [x] **B1** — Every ported page's backend action exists and is role-gated (auth, groups, members, loans, repayments, payments, cycle, rules, reminders, notifications, messages, password reset, files, profile, invitations, codes).
  - *Cycle 116 (defensive hardening + de-duplication, QA PASS sonnet + LIVE-VERIFIED 2026-07-25) — **NOT the repair of a live broken group**:* `rules_ensure_row(PDO, string): void` added in `api/handlers/rules.php` — an idempotent `INSERT … ON DUPLICATE KEY UPDATE groupId = groupId` against the real `uq_group_rules_groupId` UNIQUE key. `get_rules()` self-heals **only** for `senior_admin` (non-senior_admin 404 string byte-identical); `update_rules()` self-heals behind its existing `senior_admin` gate; `create_group()` (`groups.php`) now calls the same helper instead of its own inline INSERT, so **exactly one `INSERT INTO group_rules` exists in the codebase**. Auth boundary sound (`$caller` from `require_role()`'s server-verified return, never client input); no money figure invented; helper opens no transaction, correct both inside `create_group()`'s transaction and standalone. Live proof: transactional dry-run — scratch group → 0 rows → 1st call → exactly 1 → 2nd call → still exactly 1 (**idempotency proven, which is what makes it safe to call from a GET**) → read-back `loanPenaltyType='fixed'`, `contributionPenaltyType='fixed'`, `cycleDurationStartDate` populated, amounts `0.00`; rolled back with 0 residue in both tables. `php -l` clean.
  - **PREMISE CORRECTION (cycle 116) — the urgency that justified this cycle did not exist.** My dispatch justified 116 partly on "the owner's Test group (id starts `65a4e2e1…`) has 0 `group_rules` rows and is permanently unconfigurable." The verifier queried the live DB: **groups missing a `group_rules` row = ZERO** (`LEFT JOIN group_rules … WHERE gr.groupRuleId IS NULL` returns nothing; 2 groups, 2 rules rows), and **no group whose id starts with or contains `65a4e2e1` exists** — searched by prefix and by substring, zero matches either way. That parked item dated from the 2026-07-14/15 session and was carried forward unchecked, by me included. It has been deleted from section 4. What cycle 116 actually fixed is a **real code defect with no live victim**: no path anywhere created the row for an existing group, so any such group *would have been* permanently unconfigurable — plus the INSERT consolidated to a single source of truth. Correct work, correctly built; the stated urgency was false. Recorded rather than quietly dropped.
  - **Live-DB observation (2026-07-25, no speculation on cause):** production currently contains exactly **two** groups, both test/QA — `cf4156a12ed6e0c1c371f1ddbe0cb1c1` "QA Test Savings Group" and `8e833bfe645c83597a9e6d0ddcd0c58a` "[QA VERIFY - safe to delete] Filter Check Group". No group matching the owner's previously-referenced id is present.
- [x] **B2** — `api/handlers/exports.php` + 4 admin-gated CSV routes, streamed via `fputcsv`, with the `export_csv_cell()` formula-injection guard.

### C. Client ports (every Firebase page → its `_sql.js` twin)
- [x] **C1** — Auth + landing. · [x] **C2** — Money pages. · [x] **C3** — Admin pages.
- [x] **C4** — Member/account + notifications (60s polling; owner accepted).
- [x] **C5** — All remaining live client scripts ported (cycle 35).
- [x] **C6** — `scripts/nav_sql.js`: the one collapsed nav module replacing three legacy nav scripts.

### D. Cutover
- [x] **D1** — Every live page loads its `_sql.js` twin; nothing reachable imports `firebaseConfig.js`.
- [x] **D2** — Firebase code deleted (owner sign-off, cycle 46): `functions/`, `firebaseConfig.js`, `firestore.rules`, `firestore.indexes.json`.
- [x] **D3** — Dead twins deleted (owner sign-off, cycle 46). Residual orphans listed in section 4.

### E. Quality bars
- [x] **E1** — Zero unsafe `innerHTML` across all `*_sql.js` (63 assignments swept, 0 unsafe).
- [x] **E2** — No secret in any tracked file (`.env` gitignored).
- [x] **E3** — Responsive/touch/contrast bars: 15 touch targets raised to 44×44, 8 contrast pairs fixed (1 documented placeholder exception), horizontal scroll fixed.
  - *Cycle 114 (E3 hardening, QA PASS + LIVE-VERIFIED 2026-07-25):* four missing rungs defined in `styles/design-system.css` `:root` — `--bn-gray-200:#E2E8F0`, `-300:#CBD5E1`, `-500:#64748B`, `-600:#475569` (4 added / 0 removed / 0 modified, 1 file; 101 tokens, 0 duplicates, brace depth 0). All four confirmed present in the HTTP-served body; `styles/mobile-modals.css` returned 200 and is confirmed LIVE via the `@import` at `design-system.css:11` — the parked item's "may be dead" caveat is definitively disproved.
  - *Cycle 115 (E3 hardening, QA PASS + LIVE-VERIFIED 2026-07-25) — **bug class CLOSED at zero**:* 5 edits / 4 files. `--bn-gray-50:#F8FAFC` defined (last missing rung, 11 zero-fallback consumers); three wrong-name call sites renamed to existing tokens — `interest_penalties.html:27` `--bn-shadow-2xl`→`-xl`, `loan_payments.html:164` `--bn-text-md`→`-base`, `manage_rules.html:117` `--bn-error`→`--bn-danger`. Verified over HTTP against served bodies: 76/76 files 200, 102 tokens, 4,499 zero-fallback `var()` uses, **0 undefined**; the three old token strings appear nowhere; brace depth ends 0. Two independent sweeps agree. **Not browser-rendered** — see the open visual-confirmation item in section 4.
  - *Cycle 115 side-effect (process, not code):* the `ui-designer` agent definition still asserted `--bn-gray-200/300/500/600` do not exist — true when written, falsified by cycle 114. The agent **flagged the contradiction instead of acting on it** (correct behaviour). Definition corrected, and section 6's discriminator rule (missing rung → define the token; wrong name → fix the call site) is now a standing rule inside it.
- [x] **E4** — Empty-state + user-facing error-state handling on every script's primary data-load path.
  - *Cycle 117 (hotfix, direct — page was dead in the browser):* `scripts/manage_payments_sql.js` both imported `emptyState` from `./ui.js` and declared a local `function emptyState(icon, text)` — duplicate module-scope binding, module failed to parse, page blank. Local function deleted; the one remaining two-arg call site converted to the shared helper's object form `emptyState({ icon, title })`. All 46 modules re-checked **in module mode**: 0 failing. `el()` still used 40× — nothing else disturbed. **The shared-`emptyState` migration is the bug's source: any script still mixing the two call forms is the same defect waiting to happen.**

### F. Optional (owner decision cycle 46 — in scope, non-mandatory)
- [x] **B20** — 10 nullable KYC columns on `users`, optional in both self-service and admin edit. Role-branched `list_members()` so KYC never leaks laterally between members.

---

## 3. OWNER-PROMOTED GROUPS (enrichment on the complete A–F checklist — no box reopened)

### G. Loan eligibility & standing *(promoted cycle 90)* — **CLOSED**
- [x] **G1** — Server-computed standing/eligibility via `loans.eligibility` + member loan-modal panel. LIVE-VERIFIED 2026-07-23.
- [x] **G2** — Server-side enforcement inside `request_loan` via shared `loan_eligibility_check()` (single source of truth with G1). All three gates LIVE-VERIFIED 2026-07-23.
- [x] **G3** — Admin-configurable conditions in the Loan Settings modal, persisted to `group_rules`, read by G2.

### H. Contextual money-moment info & accounting *(promoted cycle 91)* — **CLOSED**
- [x] **H1** — Admin loan-approval borrower-standing context (admin-only `uid` override, auth boundary QA-verified).
- [x] **H2** — Member account statement/ledger: `statement.get` + `exports.statement` CSV via shared `statement_assemble()`.
- [x] **H3** — Richer member payment context (`#paymentDueInfo`, reuses already-loaded obligations).
- [x] **H4** — Richer admin payment-recording context (`#paymentOwedInfo`, read-only, no auto-fill).
- [x] **H5** — `payments.accountingSummary`: ten whole-group money figures in minor units (contributed, disbursed, outstanding principal, interest, repayments, penalties charged/collected/waived/outstanding, cash position).

### I. Dashboards, navigation & analytics usability *(promoted cycle 98)* — **CLOSED**
- [x] **I1** — Broken-button audit: every reported control confirmed already wired.
- [x] **I2** — Month filter + per-month summaries on both dashboards (client re-aggregation, no new calls, no client money math).
- [x] **I3** — Analytics Financial Trends: `#accountingFiguresBlock` renders H5's ten figures, display-only.
- [x] **I4** — `user_analytics.html` made interactive: clickable loan cards, member-safe `payments.groupStats`, expandable activity/trend, server-computed contribution/arrears breakdown popovers.
- [x] **I5** — Card "i" tooltip rollout (18 analytics cards + user-dashboard hero tiles).

### J. Owner-directed: member loan origination, configurable penalties, accounting drill-down *(promoted cycle 118, 2026-07-25)* — **OPEN**

**Why a new letter and not an existing tag.** G, H and I are closed groups and the A–F boxes are ticked; the scope rule forbids silently expanding an old box. Each J item is a new theme, not an extension: **J1** adds a member-facing *origination path* (G only ever *checked* eligibility); **J2** introduces admin-configurable penalty *behaviour* plus DDL (H5 merely *displayed* penalty totals, and A2 governs *how* money is computed — server-side, minor units — not *which* rules exist, so tracing J2 to A2 would reopen a ticked box); **J3** needs a new period-scoped server aggregation (H5 is cumulative by deliberate decision, section 6; I3 was display-only). **J2 is filed here, not under A2/H5, for exactly that reason.**

- [ ] **J1** — **Member-initiated loan requests, admin-approved.** Owner (BL-4): *"A member can request their own loan but has to be approved by the admin."* Backend already exists and is already enforced — `loans.request` → `request_loan()` (`api/handlers/loans.php:238–369`, role-gated to `member` and up) with G2's `loan_eligibility_check()` as the standing gate. This is the member-facing UI onto an enforced endpoint, plus confirming member-originated loans surface in the admin approval queue. **Highest value-per-risk: the money path is already built, gated and live-verified — nothing new touches money.**
- [ ] **J2** — **Admin-configurable penalty engine.** Owner (BL-1/BL-3): penalty configured **per group by the admin** on two axes — **period** (per day | per month) and **basis** (fixed amount | percentage) — applied **group-wide**, **changeable at any time**. **GATED ON BL-6** (percentage basis). Highest build value, highest risk.
  - **PREMISE CORRECTION (cycle 119, re-read of live code — the plan's J2 line-refs and "retire the throw" framing were both wrong):** (1) `compute_contribution_penalty()` (`payments.php:174–369`) **already implements percentage in full** — it does NOT throw. It charges `arrears × rate% × periods` on `$arrearsMinor` (still-owed), which **contradicts BL-6(b)** (full obligation regardless of part-payment). J2's contribution work is therefore a **basis change (arrears→full obligation)**, not "implement percentage". (2) The only engine still refusing percentage is the **loan** engine `compute_loan_penalty()` (`penalty.php:117`), 501'd at `repayments.php:112` — and it charges a flat daily amount, computing **no overdue amount**, which BL-6(a) requires. (3) There is **no 501 in `rules.php`**; the 501s are at `payments.php:388` and `repayments.php:112`. (4) `loanPenaltyRate` / `contributionPenaltyDailyRate` / `contributionPenaltyMonthlyRate` exist but are **absent from the `update_rules()` whitelist** → percentage is unconfigurable today (half-built). (5) Neither side has a *fixed-per-month* amount column or an explicit *period* selector — period is only implied by which rate column is non-zero. **DDL + slices are gated on a live `DESCRIBE` first (cycle 119 scout).**
- [ ] **J3** — **Group Accounting Position cards → period-scoped drill-down modals.** Owner: *"Group Accounting Position cards should also open a modal based on the month or year showing tables of the stats."* `#accountingFiguresBlock` on `analytics.html` (I3) renders H5's ten figures from `payments.accountingSummary`. H5 is cumulative with **no period scoping**, so this needs a backend slice returning period-scoped breakdown **rows** — the client must not re-aggregate money. Largest UI slice.
- [ ] **J4** — **Admin-selectable loan interest method.** BL-3 answered by implication (*"same as all accounting formulas"*) ⇒ `flat_rate` is a real product option, not a dead ENUM value. Needs `loanInterestCalculationMethod` added to the `update_rules()` whitelist (currently absent) and a flat-rate branch in `compute_loan_schedule()` (`api/lib/money.php:107–214`, reduced-balance only today). Lowest priority.

**Sequence: J1 → J2 (the moment BL-6 lands) → J3 → J4.** J1 first because it is the only workstream whose money-critical backend is *already* built and enforced, so backend-first is satisfied before the cycle starts; J2 cannot be first while its formula is one unanswered question; J3 and J4 are new server maths behind new UI and neither is blocking anything.

**Cycle 109–113 owner hardening (all four live-testing complaints, QA PASS):** admin↔user view switch promoted to an always-visible topbar control (`nav_sql.js`); responsive overflow fixed (inline grid tracks moved into overridable rules + mobile breakpoints); "cards not clickable" disproved on live re-read (was the overflow); Collection Trends chart given a labelled y-axis and its root cause fixed — `.trend-gridline` referenced `--bn-gray-200`, **a token that does not exist**, so `var()` fell back to `currentcolor`.

---

## 4. OPEN ITEMS — the only actionable backlog

### BLOCKED — genuinely the owner's call (never auto-decided)
*None open. Every standing blocker (BL-1…BL-6) is answered or owner-declined — see RESOLVED below.*

### RESOLVED — owner answers received 2026-07-25 (kept as the audit trail; do not re-raise)
- **BL-1 + BL-3 — ANSWERED.** Verbatim: *"Percentage is set by group admin as to whether per day/month and can be a fixed amount or % of the loan at admins discrepancy applied to the whole group and can be changed at any time same as all accounting formulas like monthly contributions."* Reading: penalties are configured **per group by the admin** on two axes — **period** (per day | per month) and **basis** (fixed amount | percentage) — applied **group-wide** and **changeable at any time**. Actioned as **J2**. The `flat_rate` half ⇒ a real product option → **J4**. Residual detail → **BL-6**.
- **BL-2 — SIGNED OFF ("Delete"), NOT YET DONE.** All ten files re-verified genuinely unreferenced (the only hits for `shared-top-nav.js` / `unified-navigation.js` / `admin-layout.js` are a single descriptive comment at `scripts/nav_sql.js:6`). **The deletion itself was refused by the sandbox permission classifier — the second time this has happened on this repo.** Status: *owner-approved, pending the owner running the `rm` themselves.* Not done, and **not** blocked on a decision. See PARKED for the file list.
- **BL-4 — YES.** Verbatim: *"A member can request their own loan but has to be approved by the admin."* Actioned as **J1**.
- **BL-5 — OWNER-DECLINED ("ignore"). CLOSED.** Do not re-raise it, do not re-rank it. Recorded only so a future cycle does not rediscover it and re-open it: the owner has been told the DB/SMTP passwords are recoverable from git history and has accepted that risk.
- **BL-6 — ANSWERED, and the owner SPLIT the rule (rejected the symmetric recommendation). This is deliberate; implement it exactly, never normalise the two bases back together.** Owner's two selections:
  - **(a) LOAN penalty basis = the OVERDUE amount** (option a-①) — the instalment(s) actually past due. The penalty shrinks as the member catches up and never charges on money not yet due.
  - **(b) CONTRIBUTION penalty basis = the FULL contribution/obligation amount** (option b-②) — the whole month's obligation **regardless of any part-payment**. A member who paid MWK 4,999 of a MWK 5,000 obligation is penalised on the full 5,000, identically to one who paid nothing.
  **The engine therefore needs TWO bases, not one shared formula** (the recommendation had assumed one). Loans price off the *overdue* amount; contributions off the *full obligation*. Make the difference explicit and commented in the code so a later reader cannot "simplify" the two into one and silently change what members are charged. Real-world justification the owner is acting on: full-obligation contribution penalties remove the incentive to dribble in partial payments, while loan penalties stay proportionate to what is genuinely late. Gates **J2 only** — now unblocked.

### UNBLOCKED — the live backlog
- **J1 — member-initiated loan requests: ALREADY BUILT AND LIVE (cycle 118 scout, grep-proven).** The BL-4 premise ("no member-facing flow calls `loans.request`") was a **stale inherited claim** — the flow exists: request modal `#loanModal`/`#loanRequestForm` at `pages/user_dashboard.html:2376–2462`, logic at `scripts/user_dashboard_sql.js:2515–2874`, triggered by `#requestLoanBtn`, submitting `apiPost("loans.request", …)` at :2854; G1's eligibility panel renders into `#loanStandingPanel`; server permits `member` role and enforces `loan_eligibility_check()`. **Code-complete — NOT browser-verified** (no Chrome extension this session); awaiting a click-through. One genuine **UX gap** (small J1 follow-up): `loan_payments.html`, the member's own loans page, has **no "Request a loan" entry point** — the only route in is the dashboard Quick Actions button.
- **J2 — admin-configurable penalty engine: UNBLOCKED (BL-6 answered), premise corrected cycle 119 (see J2 in §3).** `COMPLEXITY: high`. The DDL pass found the plan's premise false: contribution percentage is already built (on the wrong basis), loan percentage is not, and the config columns aren't whitelisted. Additive DDL can't be finalised without the live schema (exact types, ENUM defaults) + current per-group penalty values (behaviour-preservation depends on whether any group is already on `percentage` with a non-zero rate). **Cycle 119 dispatches a codebase-scout for that live DESCRIBE + values; Slice 1 backend brief follows once it returns.** See section 8.
- **J3 — accounting-position drill-down modals.** Ready to sequence after J2; needs a backend period-scoped slice first (money-critical work backend-first).
- **J4 — admin-selectable loan interest method.** Ready to sequence; lowest priority.

### PARKED — needs owner sign-off or is deliberate
- **Visual confirmation outstanding (E3, cycles 114–115).** No Chrome extension was connected in this session, so **no browser pass was possible and nothing was visually rendered.** The CSS-spec outcome is not in doubt (0 undefined tokens, proven twice over HTTP) and delivery is proven, but *"does the light-slate `--bn-gray-50` panel actually look right on `user_dashboard.html`, `admin_dashboard.html`, contributions overview, manage loans, manage payments"* is **unconfirmed**. Open, not done. Clears in one pass whenever a browser is available.
- **BL-2 deletion — DONE (owner sign-off given in chat 2026-07-25).** The "10 files" list was itself stale: 9 were already gone (untracked / removed in an earlier commit). Only `scripts/mobile-nav-active.js` actually remained (tracked, verified zero live references) — deleted, now shows ` D` in git, staged for the owner's commit. Nothing further outstanding here.
- Smoke-test data deliberately left live at the owner's instruction: two `[SMOKE TEST - safe to delete]` groups + one test admin user.
- **For the owner's eyes, stated as observation only (cycle 116, live DB, 2026-07-25):** the production database contains exactly two groups, **both test/QA** — "QA Test Savings Group" and "[QA VERIFY - safe to delete] Filter Check Group" — and **no group matching the id previously referenced as the owner's "Test" group**. The loop does not speculate on why and has taken no action on it. Flagged because a plan item was resting on the opposite belief; if the owner expected real group data here, that is theirs to check.

---

## 5. APPLIED DDL — live-DB change log

Owner rule: **schema changes are applied DIRECTLY to the live DB and recorded here. No offline `.sql` migration files.** Every change must be additive, idempotent, and behaviour-preserving by default.

| Date | Table | DDL | Note |
|---|---|---|---|
| 2026-07-23 | `group_rules` | `ALTER TABLE group_rules ADD COLUMN requireArrearsClearedBeforeLoan TINYINT(1) NOT NULL DEFAULT 0;` | G3 gate. Default 0 ⇒ no behaviour change until an admin opts in. Verified present. |
| 2026-07-23 | `group_rules` | `ALTER TABLE group_rules ADD COLUMN requirePenaltiesClearedBeforeLoan TINYINT(1) NOT NULL DEFAULT 0;` | G3 gate. Default 0. Verified present. |
| 2026-07-24 | `loans` | `ALTER TABLE loans ADD COLUMN loanType VARCHAR(40) NOT NULL DEFAULT 'Other';` | Guarded by `SHOW COLUMNS … LIKE 'loanType'`. 2 existing rows took the default; **no row was updated**. Server allowlist `LOAN_TYPES` in `loans.php`; client `loanTypeOf()` falls back to parsing `purpose` for pre-column loans. |
| 2026-07-25 | `group_rules` | `ALTER TABLE group_rules ADD COLUMN loanPenaltyPeriod ENUM('day','month') NOT NULL DEFAULT 'day';` | J2 Slice 1A. Guarded by `INFORMATION_SCHEMA.COLUMNS` COUNT. Explicit loan period selector. Default `'day'` = today's only mode; both live groups verified still `'day'` after apply. Verified present via `SHOW COLUMNS`. |
| 2026-07-25 | `group_rules` | `ALTER TABLE group_rules ADD COLUMN loanPenaltyMonthlyAmount DECIMAL(15,2) NULL DEFAULT NULL;` | J2 Slice 1A. Fixed-per-month loan amount. NULL = unset, same shape as `loanPenaltyDailyAmount`. Verified present. |
| 2026-07-25 | `group_rules` | `ALTER TABLE group_rules ADD COLUMN contributionPenaltyPeriod ENUM('day','month') NOT NULL DEFAULT 'day';` | J2 Slice 1A. Explicit contribution period selector. Default `'day'`. Verified present. |
| 2026-07-25 | `group_rules` | `ALTER TABLE group_rules ADD COLUMN contributionPenaltyMonthlyAmount DECIMAL(15,2) NULL DEFAULT NULL;` | J2 Slice 1A. Fixed-per-month contribution amount. Verified present. |

Earlier migrations (001–011) predate this log and live in `database/migrations/` — historical only; the live-DB-direct rule supersedes them.

No loan percentage-rate column was added: the existing DEAD `loanPenaltyRate DECIMAL(5,2)` is reused as the loan % rate (type matches the contribution rate columns). Existing `contributionPenaltyDailyRate`/`MonthlyRate` are reused for contribution %.

---

## 6. ASSUMPTIONS LOG — standing autonomous decisions (owner may override any line)

| Area | Decision taken | Rationale |
|---|---|---|
| Loan limits | One active loan at a time by default (`loanRulesMaxActiveLoansByMember` = 1) | Standard village-banking practice; admin-retunable rather than hard-coded. |
| Loan gates | Arrears and penalties do **not** block a new loan by default (both gates default 0) | Behaviour-preserving default; the admin opts in per group. |
| Month filter | Dashboards default to the current calendar month; the picker offers each month of the current year plus "Whole year" | Contributions are monthly and admins reconcile per month; the annual view is never lost. |
| Accounting block | `payments.accountingSummary` is cumulative and is **not** re-scoped by the Week/Month/Year tabs | It is a whole-group position figure, not a per-record series. |
| Statement ledgers | Savings and loan-account running balances are kept **separate**, not merged into one number | A single merged "balance" is ambiguous; two clearly-labelled ledgers are defensible. |
| Admin payment panel | The what's-owed panel is read-only — it never auto-fills or caps the amount | Admins legitimately record partial and advance payments. |
| Loan types | Vocabulary: Business · Education · Medical · Emergency · Agriculture · Home Improvement · Other; anything unrecognised falls back to `Other` | Never trust an unrecognised client string into a money-adjacent column. |
| Design tokens | The missing `--bn-gray` rungs are **defined** (200/300/500/600 = `#E2E8F0`/`#CBD5E1`/`#64748B`/`#475569`) rather than rewriting each call site to an existing token | The ramp is verbatim Tailwind slate, so the values are canonical, not invented. Fixes the whole bug class in one additive place. Side effect accepted: a `var(--bn-gray-300, #ddd)`-style use with a *fallback* would now resolve to the token instead of its fallback — a convergence onto the palette the rest of the app already uses, not a regression. |
| Design tokens | The `--bn-gray-600` == `--bn-gray-700` == `#475569` value collision is **accepted, not corrected** | The pre-existing ramp names its dark rungs one step lighter than canonical Tailwind slate; cycle 114 merely exposed it. Renaming would touch every consumer of `--bn-gray-700/800/900` — large, risky, zero user value. QA reviewed and passed it on the same reasoning. |
| Group rules row | A missing `group_rules` row **self-heals on a privileged path only** (shipped cycle 116 as `rules_ensure_row()`): `update_rules()` (senior_admin, POST) repairs; `get_rules()` repairs **only** when the caller is `senior_admin` and still 404s for an ordinary member; `create_group()` calls the same helper, so one INSERT statement exists repo-wide. Idempotent via `uq_group_rules_groupId` — no money figure is invented | A read request must never trigger a write on behalf of an unprivileged caller. Repairing on the admin's own first visit means the loop never writes money config into a production group; the owner's action does. Every amount/rate/grace column lands on its schema DEFAULT (0.00/disabled), identical to a brand-new group, so nothing is owed or charged until the admin saves real values. Idempotency is what licenses calling it from a GET at all — proven live, second call yields no second row. |
| Plan hygiene | **A parked item that describes live data expires.** Any backlog line asserting a DB fact ("group X has 0 rows", "N records are orphaned") must be re-verified against the live DB before it is allowed to justify a cycle — not carried forward on trust | Cycle 116's stated urgency was an eleven-day-old unchecked claim that the live DB flatly contradicted. The work was still correct, but the justification was not. Cheap to re-check, expensive to be wrong about. |
| **JS syntax gate (STANDING RULE, cycle 117)** | **Every JS check is `node --input-type=module --check < scripts/x_sql.js`. Plain `node --check <file>` is banned from every brief and every agent definition.** | `node --check` parses as **CommonJS** and exits **0** on an `import`/local **duplicate-identifier collision** — the exact defect that shipped a completely dead `manage_payments` page (module fails to parse ⇒ blank screen). Every script here loads as `<script type="module">`, so the gate must parse it as one. Corrected in `frontend-specialist`, `qa-auditor` (header + LINT), `live-verifier`, `build-planner` and the build-loop skill. A green CommonJS check on a module is not evidence of anything. |
| **Penalty basis — OWNER DECISION, cycle-118 (BL-6), the two bases are DELIBERATELY DIFFERENT** | **Loan** penalty % applies to the **overdue amount** (instalments actually past due; shrinks as the member catches up). **Contribution** penalty % applies to the **full obligation amount regardless of part-payment** (MWK 4,999 paid of 5,000 is still penalised on the full 5,000). Two bases, not one shared formula — code them explicitly and comment why, so neither is ever "simplified" into the other | The owner was shown both and **chose asymmetry**, rejecting the symmetric recommendation. Real-world basis: full-obligation contribution penalties kill the incentive to dribble in partial payments, while loan penalties stay proportionate to what is genuinely late. This is the owner's money rule — not the loop's to normalise. |
| Penalty accrual (J2) | Penalties are **simple, never compounding** — the rate applies to each period's base (per the two bases above), never to already-accrued penalty | Near-universal village-banking practice and the strictly lower-charge reading of an ambiguous instruction. Compounding on a late member is a materially harsher rule than the owner's answer implies; if they want it, it is a one-line override. |
| Penalty periods (J2) | Only **completed** periods charge, counted after the grace period: per-day = each whole day elapsed; per-month = each whole calendar month elapsed. A part-period charges nothing | The existing engine already counts whole days (`daysCharged` INT) — extending the same "completed period" logic to months keeps one mental model, and never charges for a period the member is still inside. |
| Penalty rule changes (J2) | *"Changeable at any time"* means: the engine re-derives live penalties on every read (it already does — never persisted as a running total), so a rate change **immediately re-prices unsettled accrual group-wide**. Rows already `paid`/`waived` in `penalty_settlements` are **immutable and never retro-recomputed** | Matches the as-built engine rather than inventing a parallel one. Re-pricing settled history would mean re-opening money the group has already banked or forgiven — irreversible and indefensible. |
| Loan interest (J4) | `flat_rate` = interest charged on the **original principal** for the full term (`principal × rate × months`), as opposed to `reduced_balance` which charges the reducing balance | "Flat rate" has exactly one canonical meaning in lending, and it is the definition that distinguishes it from the reduced-balance method already implemented. No owner question needed. |
| Penalty period selector (J2) | An **explicit** `loanPenaltyPeriod`/`contributionPenaltyPeriod ENUM('day','month') DEFAULT 'day'` is added, rather than continuing to infer period from which rate column is non-zero | Matches the owner's literal "per day/month" choice and gives Slice 2's UI a 1:1 dropdown→column mapping. It does not fight the engines: the contribution percentage branch's implicit "daily rate wins" inference is cleanly replaced by the selector, and no live group is on percentage so nothing is re-priced. Loan has only one rate column, so a period selector is required there regardless. |
| Loan % rate column (J2) | The existing **DEAD** `loanPenaltyRate DECIMAL(5,2)` is **reused** as the loan percentage rate; no `loanPenaltyDailyRate` is added | Its DECIMAL(5,2) type matches the contribution rate columns exactly; with the explicit period selector a single loan rate column covers both day and month. Adding a parallel column would strand `loanPenaltyRate` dead forever. |
| Penalty rate bound (J2) | `update_rules()` validates each penalty rate as non-negative and **≤ 100** (percent) | DECIMAL(5,2) physically allows 999.99, but a per-period penalty rate above 100% is almost certainly an input error; the owner can raise the cap if a group genuinely wants it. Rejects at 422, never silently truncates. |
| Contribution obligation basis (J2) | The full obligation is threaded into `compute_contribution_penalty()`/`payment_penalty_or_501()` as a **required** `$obligationMinor` parameter (not optional-with-fallback), updated at every one of the ~13 call sites | A required param makes an un-updated call site a loud fatal error caught immediately in live-verify, rather than a silent regression that keeps charging on arrears (the exact BL-6(b) bug being fixed). The gate for *whether* a penalty applies stays `$arrearsMinor > 0`; the % basis becomes `$obligationMinor`. |
| Design tokens | **Split rule for undefined tokens: a missing *rung* is defined; a *wrong name* is fixed at the call site.** A rung has a canonical value and multiple consumers (define it). A wrong name is a typo for a token that already exists — `--bn-text-md`→`--bn-text-base`, `--bn-error`→`--bn-danger`, `--bn-shadow-2xl`→`--bn-shadow-xl` (fix the call site) | Defining a synonym would enshrine **two vocabularies for the same concept** in the design system permanently, for every future author. Cycle 114's define-don't-patch inversion was right for rungs and is wrong for synonyms; the discriminator is "does an equivalent token already exist?". |

---

## 7. FUTURE IDEAS (not in scope)

Logged, never auto-queued. Requires the owner's explicit promotion.

- Live push notifications (SSE/websockets) replacing the 60s polling (B18).
- Emailing / scheduling / automating reports beyond on-demand export (B19).
- Changing a user's login email (needs a verification flow) — deliberately excluded from `profile.update`.
- Quarterly / annual report granularity beyond the `year` filter; a cross-year month picker on both dashboards.
- `payments.delete` / editing an already-adjudicated payment; bulk "apply penalty".
- Forced-loan bulk auto-origination (preview lists candidates; origination stays manual).
- **B21** — member↔member direct messaging (needs a `messages.direct` endpoint + recipient inbox).
- **B22** — `invitations.mine`, letting an invitee list their own pending invitations by session email. Code-redeem already works, so this is alternative UX, not a functional gap.
- Maintainability debt with no user-visible value: redundant per-page `.tab` CSS, the dead `.user-menu-dropdown` block, orphaned `#applyPenaltyModal` markup, `contributions_overview_sql.js` table unification, `user_dashboard.html`'s ~80 inline styles.

---

## 8. ACTIVE CYCLE

**No cycle in flight — paused at a checkpoint for the owner.** The penalty engine (J2 Slice 1, loan + contribution) is complete and fully verified; a natural stop-and-commit point. The loop did not auto-advance into Slice 2 because the owner was asked whether to pause here and has not answered — the safe default at a clean, money-critical checkpoint is to hold. To resume: dispatch **J2 Slice 2** (admin rules-modal UI onto the new columns — period dropdown 1:1 with the selector, basis toggle, matching amount/rate field), then Slice 3 (display of configured basis+period), then **J3** (accounting drill-down modals) and **J4** (interest method). All four are unblocked; none needs an owner decision.

**Real engine signatures (for Slice 2/3 and future work):**
- `compute_loan_penalty(array $loan, ?array $rules, ?string $asOf = null): array` — no $pdo arg (self-connecting), $asOf is a nullable date string. Return adds `penaltyType`/`penaltyPeriod`/`periodsCharged`/`overdueAmount`.
- `compute_contribution_penalty(?array $rules, ?string $dueDate, int $arrearsMinor, int $obligationMinor, ?string $paymentId = null, ?string $asOf = null): array` — `$obligationMinor` (full obligation, BL-6(b)) is REQUIRED, before `$paymentId`.
- Configurable columns now whitelisted in `update_rules()`: loan/contribution x {Rate, DailyAmount, MonthlyAmount, MonthlyRate, Period, Type, GracePeriodDays}. Rate validator `rules_penalty_rate_string` rejects <0 and >100.

**Known follow-up (logged, not blocking):** percentage-mode settlements write `penalty_settlements.dailyAmount = 0.00` (there is no per-period amount to record); the real basis lives in `amountAccrued`/`overdueAmount`, which `repayments.php` does not persist. A later slice touching settlement persistence should carry the basis into the audit row. Cosmetic to the audit trail, not to any charge.

**Closed this session (one line each):**
- **120 (J2 Slice 1)** — admin-configurable penalty engine, loan + contribution, fixed|percentage x day|month. 4 additive columns applied live (both live groups still `period='day'`, no behaviour change); loan % on the overdue amount (BL-6(a)), contribution % on the full obligation (BL-6(b), a deliberate basis change threaded through 13 call sites). QA PASS both slices; LIVE-VERIFIED both — every reconciliation exact (loan 600/400/2000/shrinking-360; contribution headline 300 not 0.06, end-to-end partial-payment 2400 not 1440; cf41 fixed/day byte-identical both engines), zero residue, live groups untouched. Remaining J2: Slice 2 admin UI, Slice 3 display. -> J2.
- **119** — scout returned the live `group_rules` penalty schema + both groups' values: both `type='fixed'` so percentage ships behaviour-preserving; `loanPenaltyRate` was DEAD (now reused). -> J2.
- **118** — scout proved J1 (member loan requests) is **already built and live**; BL-4 premise was stale. J1 code-complete, awaiting a browser click-through; UX-gap follow-up: no request entry point on `loan_payments.html`. -> J1.
- **117** — hotfix: `manage_payments` was a blank page (duplicate `emptyState` — imported + locally declared). All 46 modules now parse in **module mode**. Systemic fix: JS gate is now `node --input-type=module --check` everywhere. -> E4 + standing rule in §6.
- **116** — `group_rules` row self-heals on a senior_admin path. QA PASS; live dry-run VERIFIED, zero residue. Premise correction: no live group was actually broken. -> B1.
- **115** — defined `--bn-gray-50` + fixed 3 wrong-name token call sites. Undefined-token bug class now **zero** across 76 files, proven twice over HTTP. -> E3.
- **114** — defined 4 missing `--bn-gray` rungs. QA PASS, HTTP-VERIFIED. -> E3.

---

## 9. ARCHIVE INDEX

| File | Covers |
|---|---|
| `archive/BUILD_PLAN_history_cycles-1-113_2026-07-25.md` | Cycles 1–113 verbatim: every dispatch brief, QA verdict, scout finding, and superseded decision. 781 KB — **grep it, never read it whole.** |

Useful greps into the archive: `## CYCLE <n>` for one cycle · `DISPATCH` for a past brief's wording · `QA PASS`/`FAIL` for verdicts · `LIVE-VERIFIED` for what was actually run against the real app.
