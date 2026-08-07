# BUILD_PLAN.md — Bank Nkhonde (LIVE PLAN)

> Owned by `build-planner`. **One objective per cycle.** Specialists read their dispatch brief, never this file.
>
> **HARD SIZE RULE: this file stays under 400 lines / 60 KB.** It was allowed to reach 3,033 lines / 781 KB — past the Read tool's 256 KB limit — which meant the planner that owns it could no longer open it. `doc-curator` rotates history out to `archive/` whenever it exceeds the cap. **Never append a full cycle narrative here.** A closed cycle earns at most one line.
>
> **Full history (cycles 1–113, verbatim, nothing lost): `.claude/archive/BUILD_PLAN_history_cycles-1-113_2026-07-25.md`.** Grep it when you need the reasoning behind a closed decision; never load it whole.

---

⇥ **HANDOVER 2026-08-05** — rotated to archive 2026-08-07; see `archive/BUILD_PLAN_history_2026-08-06_run.md` SUPERSEDED HANDOVER BLOCK.

---

**This section is your sole source of truth. Do not scan the repo. Do not read sections 1–9 unless a task explicitly sends you there. Every task below is self-contained with exact file paths, line ranges, and acceptance criteria.**

**Work through the checklist in order. Tick each `[ ]` as you complete it. If blocked, mark it `BLOCKED: <reason>` and move to the next.**

### SETUP (do once)
- The local dev server is ALREADY RUNNING at `http://localhost:8000`. Pages at `http://localhost:8000/pages/<page>.html`. Do NOT start another server.
- Read `.claude/CLAUDE.md` for safety rails, with these overrides: you MAY commit and push. You MAY apply DDL directly to the live MySQL database (no offline .sql migration files — record the DDL in BUILD_PLAN.md section 5). Remaining rails: never destructive SQL (no DROP/TRUNCATE, no unscoped DELETE/UPDATE), never weaken `require_role`, never delete a file without sign-off, never use `innerHTML` with user strings, money is always server-side integer minor units.
- JS syntax check: `node --input-type=module --check < scripts/x_sql.js` (NOT plain `node --check`).
- Test widths: 320, 390, 768, 1024, 1025, 1440. The 1024↔1025 boundary is critical.
- Use Playwright MCP for browser testing at `http://localhost:8000`. For API testing use curl or PHP test scripts. For DB verification use PHP scripts via `getDbConnection()`.

**J13: Dashboard overhaul (both user and admin halves) — original specification rotated to archive 2026-08-07.** See `archive/BUILD_PLAN_history_2026-08-06_run.md` "J13 ORIGINAL SPECIFICATION".

---

- [~] **J11: Profile picture — PARTLY BUILT. Rotated to archive 2026-08-07.** Settings page fixed; sidebar avatar now links to settings (needs owner review whether to revert).

### AUTONOMOUS THINKING RULE · HOW TO REPORT
Both blocks lived here verbatim and are **unchanged, just not duplicated** — they are the same text as `CLAUDE.md`'s autonomy rules and the build-loop skill's STATUS/SESSION SUMMARY formats. Full wording: `archive/BUILD_PLAN_history_2026-08-06_run.md`. The short version: decide product/wording/defaults yourself from real village-banking flow, show the full financial picture at any money moment, make every figure traceable to its source, default new money features to the safe setting, ask ONE precise question only for a CRITICAL change, record each autonomous decision, and report per task in plain product language — no code or file paths in the summary.

---

### CHECKLIST — tick each `[ ]` as you go

- [x] **CYCLE-127-VERIFY: Browser pass — DONE (Cline, 2026-08-05).** Checks 1–4 proven with Playwright. Check 5 (layout polish) deferred to owner. One bug found: burger unreachable while drawer open (z-order). See section 8 for details.

- [x] **J3-SLICE-1: Backend period drill-down — DONE + LIVE-VERIFIED.** Four flow figures drill correctly. Seed-money NULL-month gap is owner-decided D4 behaviour. See section 8.

- [x] **J2-SLICE-2: Admin penalty-rules UI — BUILT (frontend only).** Not browser-tested. Penalty settings added to Governance tab on manage_rules.html. See section 8.

- [x] **J9: Financial Trends chart CSS — FIXED (Cline, 2026-08-05).** The `renderMonthlyTrendChart()` in `analytics_sql.js` built a grouped bar chart using classes `fin-kpis`, `fin-plot`, `fin-bar`, `fin-month`, `fin-legend`, `fin-yaxis`, `fin-gridline`, `fin-scroll` — but zero CSS rules existed for any of them. Added ~130 lines to `styles/design-system.css` covering KPI cards, legend, y-axis, gridlines, grouped bars with gradient fills, month labels, and responsive breakpoints at 768px/480px. Verified with Playwright screenshot.

---

- [x] **J5: Fix three client-side money-math defects — DONE + BROWSER-PROVEN (2026-08-05).** All three footers now read server fields. Only one new server field was needed (`loans.list summary.activeBalance`); the other two already existed as `activePrincipal` / `verifiedCollected`. Arrears modal row-selection realigned to the server's overdue rule — see section 8 for the two autonomous decisions.


---

- [x] **J4: Admin-selectable loan interest method (flat_rate) — DONE + END-TO-END PROVEN (2026-08-05).** Both ENUM values now implemented and admin-selectable; the 501 guard is retired. Same loan repriced 4,900.00 → 9,000.00 through the live API when the group switched method. **The brief named the wrong UI file** — see section 8.


---

- [x] **J6: Borrower financial context at loan approval — DONE + BROWSER-PROVEN (2026-08-05).** Approving a loan now opens a review modal showing what the borrower already owes, has contributed, owes in arrears/penalties, and their debt-to-contribution ratio, with advisory warnings. **Approval was previously a single unconfirmed click.** Built by extending `loans.eligibility` (which already had the admin uid-override) rather than adding an endpoint. See section 8.


---

- [x] **J8: Broken info-toggle ("i") buttons — ROOT-CAUSED, FIXED, BROWSER-PROVEN (2026-08-05, real login).** Exactly ONE toggle in the app was dead: "Contributed" on the member dashboard. Fixed, plus the silent-failure mode that hid it. All 14 toggles across the three pages now open with content. Per-member breakdown modals split out as J8-SLICE-2 below (needs a new server aggregation). See section 8.


---

- [x] **J8-SLICE-2: Per-member breakdown behind the admin stat cards — DONE + BROWSER-PROVEN (2026-08-05).** New admin-gated `payments.memberBreakdown` returns rows AND their total from one server pass; the Arrears and Collections modals now render it instead of adding money up in the browser. Two client-side money aggregations deleted. **My own framing of this slice was wrong and a real accuracy bug was found — see section 8.**

---

- [x] **J7: Member borrowing-power card — DONE + BOTH PATHS BROWSER-PROVEN (2026-08-05).** A "Borrowing Power" hero card now tells a member what they qualify for before they apply, fed by the same eligibility check the server enforces. One deliberate divergence from the brief (Request Loan button left clickable) — see section 8.

---

- [x] **J2-SLICE-2 VERIFY: penalty UI browser-tested (2026-08-06) — PASSES.** All 13 penalty fields render on `manage_rules.html` and load from `rules.get` (loan daily 500.00, contribution daily 200.00, grace 5 both sides — matching the server byte-for-byte). Show/hide logic correct in all three directions: `type=percentage` reveals the rate group and hides both amount groups; `type=fixed` reverses it; `period=month` swaps the daily amount group for the monthly one. *(A first probe reported all 13 fields MISSING — that probe used the wrong ids; the markup uses an `Input` suffix. The tooling was wrong, not the page.)*

- [x] **J3-SLICE-2: Accounting drill-down modal — DONE + BROWSER-PROVEN (2026-08-06).** The four FLOW cards on `analytics.html` are now clickable and open a period breakdown; the backend for this shipped as J3-SLICE-1.
  - **Only the 4 flow figures are drillable — proven by inspection of all 13 cards.** Total Contributed, Total Disbursed, Interest Earned and Loan Repayments Received carry `is-drillable`; the nine balance/derived cards (Outstanding Loan Principal, all four penalty figures, Cash Position, and the three contribution sub-totals) deliberately do NOT. That is decision **D1**: a flow is money that moved in a period and has rows behind it; "March's outstanding principal" would be a fabricated number.
  - **The modal never sums anything.** It renders the server's `periodTotal` and the server's `rows` from one call, so the modal total and the card above it cannot drift. Year picker (required by the server) + optional month; keyboard accessible (Enter/Space open, Escape closes, overlay click closes); the card's own "i" toggle still works and does not trigger the drill.
  - **Proven live:** Total Contributed → **"MWK 260,000.00 in 2026", 26 rows**, columns Member/Type/Month/Amount; switching to March → **"MWK 40,000.00 in March 2026", 4 rows**. `node --input-type=module --check` clean. No `innerHTML`.
  - **D4 — DONE + LIVE-VERIFIED 2026-08-06 (computation level, through the real `group_accounting_summary_period_drill()`, not a copy of its SQL).** The Contributed drill now returns an additive `unmonthed {total, includedInPeriodTotal, byType[]}` block, and the modal renders it as a labelled reconciliation note beneath the period total.
    - **The gap has MOVED since it was written up, and the plan's example is stale.** Live today: **2025** carries the seed money (105,000.00 across 4 `month = NULL` rows) against 140,000.00 spread over its months; **2026 has no seed rows at all** (260,000.00, all monthed). So the honest test case is 2025, not the 2026 figure recorded above. Cumulative across both years = 505,000.00.
    - **Identity proven both ways:** 2025 → months 140,000.00 + unmonthed 105,000.00 == year 245,000.00 **PASS**; 2026 → 260,000.00 + 0.00 == 260,000.00 **PASS**. Selecting March correctly reports the seed money with `includedInPeriodTotal: false` so the note reads "not included in the March total above". **Zero NULL-year rows** in the group — no reconciliation leak hiding behind the drill.
    - **AUTONOMOUS DECISION — broken down BY TYPE, not labelled "seed money" in the server.** Seed money is the only no-month payment type today, but the label has to follow what the data says; a `service_fee` row with no month would otherwise be captioned "Seed money". The client maps the type to the same vocabulary the payments pages already use.
    - **AUTONOMOUS DECISION — the note renders BEFORE the empty-state return.** A month with no rows of its own still needs the context, otherwise a quiet month reads as "nothing happened all year". Client does no arithmetic: it renders the server's amount and the server's `includedInPeriodTotal` flag, and decides whether to show the line from `byType.length` (a row count, not money).
    - **Boundary:** the note has NOT been rendered in a browser.
  - **SUPERSEDED — original D4 text:** the Contributed drill should also show a clearly-labelled **"Seed money (one-time, not tied to a month)"** line so twelve months + seed visibly reconciles to the year total. Seed rows carry `month = NULL`, so a month-scoped drill legitimately excludes them — which is why the 2026 drill (260,000.00) is smaller than the cumulative card (505,000.00, which also spans 2025). The server does not yet return that NULL-month portion; that is the owner-decided D4 follow-up.

- [x] **QUICK-ACTIONS CARRY-OVER: RESOLVED — NO BUG. My flag was wrong, twice.** Confirmed against real data across the boundary: `.hero-quick-actions` sits in `.hero-container` at 1440 and 1025, moves to `#sidebarQuickActions` at 1024 and 390, and returns to the hero at 1440 — **1 block, 9 buttons, exactly 1 `#requestLoanBtn` throughout**, so it is moved and never cloned. My original observation was wrong first because it ran on stubbed data, then a second time because it measured `.quick-actions` (the inner list, whose parent is always `.hero-quick-actions`) instead of the wrapper that actually moves. **Cline's original "proven" was correct.** Recorded because a false bug report costs as much as a missed one.


---

### WHEN ALL TASKS ARE DONE (or blocked)
Rewrite this HANDOVER section with:
- Which tasks completed `[x]` and what was proven
- Which tasks are `BLOCKED` and why
- Any new files created or DDL applied
- Any autonomous product decisions you made and why
- A clear statement: **"Handing back to Cline for re-planning"**
- Any new instructions Cline should add to the next dispatch

### FOR CLINE (super-advisor)
When you receive the handover back, review the completed/blocked items, add new `- [ ]` checklist items below as needed, and hand back to the coding agent. The checklist format means you can append new tasks without restructuring the whole section.

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

## 1. CURRENT STATE

**A–F ticked. G/H/I closed. J1–J4 closed 2026-08-06. The §4 browser pass is CLOSED 2026-08-07** — run for real against a live login, which also surfaced and fixed **five defects no static gate had caught** (a wrong arrears figure on the admin dashboard, a mis-scoped pie label, content clipped at ≤1280px, "Arrears" naming two different numbers in one modal, and analytics showing the cash position under the label "Net Profit"). Evidence in section 8.

**J13 is CLOSED** (both halves built and browser-proven 2026-08-07). **J11 profile picture: acceptance MET and browser-confirmed** — only its sidebar-avatar divergence remains an owner call.

**IN FLIGHT: deliverable K — end-of-cycle share-out / dividend.** Owner-fixed objective, dispatched 2026-08-07 as two parallel briefs (section 8): K1 a settled-share-out read endpoint, K2 the new `cycle_shareout.html` page. **The share-out BACKEND has been live since 2026-07-21 and the plan wrongly called it "not covered" — corrected in section 8 (fourth block) and recorded as the sixth false-premise entry on this project.**

⚠ **CAP BREACH — this file is ~600 lines / ~90 KB against a 400-line / 60 KB cap.** The planner has collapsed what it may (the superseded J13 in-flight narrative) but **rotating history to `archive/` is `doc-curator`'s job and is now overdue.** Dispatch `doc-curator` at the close of cycle K: rotate the four 2026-08-07 narrative blocks in section 8 and the whole HANDOVER block (lines ~11-217) into `archive/BUILD_PLAN_history_2026-08-06_run.md`, leaving one line each. History: `archive/BUILD_PLAN_history_2026-08-06_run.md`.

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

### G, H, I — **ALL CLOSED** *(cycles 90, 91, 98)*
- **G** (Loan eligibility, 3 items) — Server-computed standing, gated enforcement, admin-configurable rules. LIVE-VERIFIED.
- **H** (Money-moment info & accounting, 5 items) — Borrower context, statement ledger, payment context, `payments.accountingSummary` (10 figures). LIVE-VERIFIED.
- **I** (Dashboards & analytics, 5 items) — Broken-button audit, month filter, Financial Trends chart, interactive analytics, card tooltips. LIVE-VERIFIED.

### J. Owner-directed work *(promoted cycle 118)* — **OPEN**

- [ ] **J1** — **Member loan requests.** Backend live (`request_loan` via `loans.request`, gate enforced, eligibility checked). UI gap: no "Request a Loan" entry on `loan_payments.html`. Highest value-per-risk.
- [ ] **J2** — **Admin-configurable penalty engine.** Period (day/month) + basis (fixed/%). Gated on BL-6 (percentage basis clarification). Cycle 119 scout found: contribution % already built on wrong basis (arrears, not full obligation per BL-6(b)); loan % still 501'd; DDL needed for period selector and fixed-per-month amounts. See archive for full premise analysis.
- [ ] **J3** — **Group Accounting Position cards → period-scoped drill-down modals.** Period-scoped drill on four FLOW figures (flows-vs-balances decision D1): totalContributed, totalDisbursed, loanRepaymentsReceived, interestEarned. Requires backend slice returning period-scoped rows via `payments.accountingSummary` (year + optional month). Slice 2 adds modal UI + card wiring. Seed-money reconciliation (D4 — owner-decided): include year's NULL-month rows as separate line so months + seed = year total. See archived cycle 121-125 scout and decision details (archive/BUILD_PLAN_history_2026-08-06_run.md). Slice 1 ready for dispatch.
- [ ] **J4** — **Loan interest method (flat_rate).** Add `loanInterestCalculationMethod` to `update_rules()` whitelist + implement flat-rate branch in `compute_loan_schedule()`. Lowest priority.
- [ ] **J5** — **Member-facing accounting shown accurately & completely.** Fix three A2 violations (client-side money math on user pages): (1) arrears+penalty sum, (2) pending payments sum, (3) total borrowed sum. Backend slice adds `summary.totalOwed`, `summary.pending`, `summary.issuedPrincipal`. Frontend read-swap replaces client math with server fields. Closed cycle 123 (backend) + 124 (frontend). See archive for full defect list and cycle history.

**Directive scope decision (2026-07-25):** the admin drill-down is **J3** (unchanged); the member-accounting-accuracy work is **J5** (new), NOT an extension of the closed I4/H2. Cycle 121's scout maps BOTH sides in one ground-truth pass so both J3 and J5 build briefs land exact-line.

**Sequence: J1 → J2 (moment BL-6 lands) → J3 → J4.** J1 ready now (backend live-verified); J2 waits for BL-6 answer; J3/J4 deferred. See archive for closed cycle 109-125 details.

### K. End-of-cycle SHARE-OUT / DIVIDEND *(promoted 2026-08-07, owner-directed)* — **OPEN**

Promoted as a new lettered group rather than folded into B1/J: it is a distinct money event (the cycle closing and paying members out), not a read surface or a settings gap. G/H/I/J were taken; K is next.

- [x] **K1** — **Settled-share-out read endpoint. DONE + LIVE-PROVEN 2026-08-07.** `cycle.payouts.list` (GET, admin|senior_admin|treasurer) appended to `cycle.php`, one ROUTES line. No DDL. Live: 200 `settled:false` on the real group; auth boundary probed four ways (no session 401 · missing groupId 422 · POST to GET-only 405 · foreign group 403); `cycle_payouts` COUNT(*) = 0 before and after every probe — a read endpoint that never writes.
- [x] **K2** — **Share-out UI. DONE + BROWSER-PROVEN 2026-08-07.** `pages/cycle_shareout.html` + `scripts/cycle_shareout_sql.js`, new dedicated page per owner decision. Preview + settle shipped together, settle behind a two-step confirm gate. Preview state proven end-to-end in a real authenticated browser; settled state proven by stubbing the endpoint response (no DB write); confirm gate proven to open, restate 5 members / MWK 10,050.00, gate on the checkbox both directions, and cancel. **The live cycle was NOT settled — `cycle_payouts` is still 0 rows.**
- [x] **K3** — **SPA-router registration (defect found by the browser pass, not in any brief).** `pages/cycle_shareout.html` was missing from `PAGE_CONFIG` in `scripts/spa-router.js`. Because `window.__bnSpa === true` on every authenticated page, the module's own `if (!window.__bnSpa)` DOMContentLoaded fallback correctly stands down and waits for the router to call `init()` — and the router had no entry, so **nothing ever called `init()`**. The page rendered its static shell and then did nothing, with **zero console errors**. Fixed with one registry entry. **Standing lesson: a new page in this app needs THREE registrations — `ADMIN_NAV_ITEMS` (nav_sql.js), `PAGE_CONFIG` (spa-router.js), and the `data-nav-*` body attributes. Miss the router entry and the page is silently dead.** Add this to any future new-page brief.
- **Backend already live (do not rebuild):** `cycle.equity`, `cycle.payout.preview`, `cycle.settle`, `cycle.forced.preview` — `api/index.php:113-116`. The payout rule is owner-specified and **not the loop's to change**: `payout = interestRefund + penaltyShare`, where `interestRefund` is the interest that member personally paid and `penaltyShare` is an equal 1/N slice of the group penalty pool **only when `group_rules.shareOutPenalties = 1`**. **Contributed capital is NOT part of the payout, and a penalty is never refunded to whoever paid it** (`api/handlers/cycle.php:7-20`).
- [x] **K4** — **`cycle_settle`'s own 201 response now carries member names.** Its read-back SELECT queried `cycle_payouts` alone with no `members` JOIN, so every row came back without `fullName`. Inert as shipped (the page always re-reads `cycle.payouts.list`), but a live trap for any future caller rendering that 201 directly. Now `LEFT JOIN members` matching `cycle_payouts_list()` exactly — LEFT, so a member removed after settling still appears in the record they are owed by. Statement validated against the live schema with a no-match query; **no cycle settled, `cycle_payouts` still 0 rows.**

### L. Money Masters constitution — rules with no home in the app *(owner-prioritised 2026-08-07)*

- [x] **L1** — **Loan term banded by amount. DONE + LIVE-PROVEN 2026-08-07.** Owner's constitution: under 500,000 → 2 months; 500,000 and above → 3 months. **The plan's own note about this was FALSE** and was corrected: it claimed "the app has one `loanInterestMaxRepaymentMonths`", but the enforced fields are `loanRulesMinRepaymentMonths`/`loanRulesMaxRepaymentMonths` (a range), and `loanInterestMaxRepaymentMonths` is read-only decoration used by nothing. **Seventh false premise on this project.** Shipped as a single shared helper `loan_term_bounds_for_principal()` read by *both* enforcement sites and the `loans.eligibility` preview, so the client preview and the server gate cannot drift — the failure mode this project has shipped repeatedly. Four additive columns, `loanTermBandEnabled` DEFAULT 0 so every existing group is untouched until an admin opts in. **Boundary decision (mine, recorded): `principal < threshold` → lower band, `>= threshold` → upper.** The owner's phrasing left exactly 500,000 undefined; the longer term at the boundary is the standard reading and the more forgiving for the borrower. Proven live at threshold 50,000 (chosen inside the group's 100,000 principal cap so the cap could not mask the band): 49,999.99 → 2 months, 50,000.00 → 3, 50,000.01 → 3; the real gate refuses with `"repaymentPeriod must be between 1 and 2 months for a loan under 50000.00."`, naming the band rather than an unexplained number. Config restored to defaults; **no loan created.**
- [ ] **L2** — **Termination after 3 months of non-payment.** NOT STARTED. Needs owner decisions before any build: what happens to the terminated member's contributed capital, their outstanding loan balance, and whether they are paid out at cycle end or forfeit.
- [ ] **L3** — **Death rules.** NOT STARTED. Forfeit the loan balance; pay principal + interest to next of kin. Moves real money to someone outside the group and is irreversible once recorded — the most consequential item left.
- [ ] **L4** — **Guarantor cap of 2 members.** NOT STARTED. The guarantor fields exist; nothing enforces the limit. Smallest of the four.

- [x] **L5** — **Interest sharing method, chosen per group. DONE + PROVEN 2026-08-08.** One column `shareOutInterestMethod` DEFAULT `refund_to_payer` (so every existing group is unchanged), one branch in `cycle_split_interest()` (`cycle.php`), one dropdown on the creation form. Three methods: `refund_to_payer` (today's rule), `split_equally`, `split_by_contribution`. All three sum to the pool EXACTLY in integer minor units — equal split uses the penalty pot's existing earliest-joiner remainder convention; proportional uses largest-remainder, ties to earliest joiner. Zero total contributions falls back to equal split (never divide by zero); an unrecognised method falls back to `refund_to_payer` (never zero, never unbalanced). Proven against the live QA group inside a transaction that was ROLLED BACK: pool 10,050.00 → refund `0/4,050/0/2,000/4,000`, equal `2,010 × 5`, proportional `2,752.67/2,202.14/1,238.70/1,654.35/2,202.14`; all three BALANCE. Setting restored, **no cycle settled, `cycle_payouts` still 0 rows.**
  - **Found while building: the creation form's "Surplus/Profit Distribution" dropdown was DEAD.** A group creator picked equal / proportional / rollover / reserve and it was silently discarded — never sent, so every group ran on the schema default regardless of what was chosen. Replaced with the three real, stored options. The two unimplemented ones (rollover, reserve) are gone rather than left lying; if they are wanted they are new features.
  - Share-out page now labels the column "Interest Refund" only under `refund_to_payer`, "Interest Share" otherwise — and always the neutral wording on a SETTLED record, since the settled response deliberately does not carry the method.

- [x] **L6** — **SEVEN working admin pages had NO nav entry. Fixed 2026-08-08, browser-proven.** Manage Rules, Financial Reports, Contributions Overview, Seed Money Overview, Interest & Penalties, Approve Registrations and Broadcast were all built, routed in `PAGE_CONFIG`, and functioning — reachable **only by typing the URL**. The owner hit this immediately ("how come I can't see the rules tab"). Sidebar regrouped into Dashboard/Analytics/Share-Out + **Money** + **Admin** sections (owner chose grouping over a flat 14). A `{section:"..."}` entry renders a heading, not a link; the mobile bottom bar filters markers out before taking its first four, or a heading would render as a dead tab.
  - **Caught by an automated cross-check, not by eye:** `seed_money_overview.html` uses `data-nav-active-page="seed-money"`, not `seedmoney` — the item would have rendered but never highlighted as active. A script now compares every nav item against the router registry AND the page's own nav attribute; run it whenever a nav item is added.
  - **Pre-existing, NOT introduced and NOT fixed:** `financial_reports.html`'s `.tabs` strip overflows the page body horizontally at 320px (body scrollWidth 332 vs viewport 303). Unrelated to the sidebar (`inSidebar: false`) and on a page this cycle did not touch. Reported for a later pass.

- [x] **L7 — DEEP LINKS WENT NOWHERE. One bug class, four instances. Fixed + browser-proven 2026-08-08.** Owner: *"when I click manage it just sends me to the general manage loans instead of the individual… this is happening in several places."* Every link had always carried the right id; **nothing at the receiving end consumed it.**
  - `manage_loans_sql.js` **read no URL parameters at all**, so `?loanId=` was discarded on arrival. The page already had `showLoanDetails(loanId)`; no link ever reached it. Now deep-links, validates the id against the loans already loaded for the group (so a hand-edited URL can't surface another group's loan), strips the param so a refresh doesn't re-open, and warns on a stale id instead of failing silently. A URL `groupId` now also outranks the stored one, or a deep link could land on a different group's loans.
  - `manage_payments_sql.js` read `tab` into a variable and **never used it** — `?tab=arrears` did nothing even when a member was supplied. Applied via the existing `activateTab()`.
  - Same handler bailed out unless **both** `groupId` and `memberId` were present, killing every stat-card/info-panel link that names only a tab.
  - Two Quick Action cards in `admin_dashboard.html` link with **no groupId at all** (`?tab=pending`, `?tab=arrears`). Both params are now independently optional; a tab-only link means "this tab, whichever group I'm on".
  - **Standing check:** a script now cross-references every `*.html?param=` link in `scripts/` against the `params.get()` calls in the target page. All three surviving params (`loanId`, `memberId`, `tab`) resolve. Run it whenever a parameterised link is added — this class is invisible to lint, to diff review, and to the API.
- [x] **L8 — Loan info surfaces showed the wrong number. Fixed + browser-proven 2026-08-08.** The Active Loans modal led with the **original principal**, so a loan repaid to almost nothing still read as its full amount — the one figure an admin chasing repayment needs was the one absent. Now leads with **outstanding** (explicitly captioned, since an unlabelled figure beside a loan is ambiguous), plus repaid-of-total, last payment date + amount, and penalties when non-zero. The Loan Details panel had the same gap and gained **Outstanding** and **Last Paid**. Balance data was already being returned and thrown away; only last-payment needed adding — one correlated subquery on `list_loans()` and `loan_fetch_row()`, **`status='approved'` only**, because a pending repayment is a claim, not money in the box. Live: QA Admin `outstanding 10,700.00 · repaid 12,000.00 of 22,700.00 · last paid 20/07/2026 · 12,000.00`.
  - Lint caught a duplicate `formatDateShort` — the existing one takes a Date and **omits the year**, and this data spans 2025 *and* 2026, so a bare "20 Jun" would have been ambiguous about which year a loan was last serviced. Added `formatServerDate()` alongside it rather than colliding or silently losing the year.

- [x] **L9 — DATE / MONEY-TRACE AUDIT + the 0.02 mystery. Fixed + browser-proven 2026-08-08. Live DB repaired (owner-authorised).**
  - **ROOT CAUSE of the long-standing "MWK 0.02 overdue" banner, and of two owner reports at once.** Two loans carried schedules that **under-totalled the loan itself**: QA Member Two's instalments summed to 58,166.64 against a loan total of 58,166.66 (Member Three: 46,533.33 vs .34). The stored loan totals were CORRECT — recomputing with the live `compute_loan_schedule()` reproduced them exactly. The **schedule rows** had dropped the rounding residue (m1 21,666.66 should be .67; m2 18,999.99 should be 19,000.00). Legacy rows: the current generator has a reconciliation self-check that *throws* rather than write an unbalanced schedule, so this cannot recur.
  - **Consequence chain:** schedule said "all 3 months paid, balance 0.00" → `repayments.balance` returned no instalments → **the record-payment form had nothing to autofill** (owner report 2); and `repaid/total` = 99.99997% → `.toFixed(0)` → **"100% repaid" with 0.02 outstanding** (owner report 3). One data defect, three symptoms.
  - **Live DB repaired in a transaction:** schedules rewritten to the correct instalments; every loan now reconciles to its schedule exactly (4/4). The 0.02 is now *traceable to specific instalments* — 0.01 on month 1, 0.01 on month 2, both overdue — instead of floating unattributed.
  - **Dates backfilled from real evidence only:** 5 `loan_repayment_schedule.paidAt` from the matching approved repayment; 4 `loans.disbursedAt` from `approvedAt`. **44 `payments.approvedAt` were deliberately NOT fabricated** — `updatedAt == createdAt` on every one, so no evidence of the approval moment exists, and inventing it would manufacture an audit trail. Confirmed the live approval path writes `approvedAt = NOW()`, so these are legacy seed rows only.
  - **Progress bar now caps at 99% while any balance remains** — 100% is reachable only when the remaining balance is genuinely zero. A settled-looking loan that isn't settled is how a balance goes unchased.
  - **Payment history added to `repayments.balance`** and rendered in the record-payment form: every prior repayment with its date, month, amount, and an explicit `AWAITING APPROVAL` tag on pending rows — a pending repayment is not money in the box, and hiding it invites taking the same payment twice. Proven live: 3 rows dated 20/04, 20/05, 20/06/2025.
- [x] **L10 — PENALTIES ARE NOW EXPLICITLY OPTIONAL, and combined payment presets say what the money is for. 2026-08-08, browser-proven. Owner-directed.**
  - **Owner's ruling on BL-7 (below): NO minimum-shortfall threshold.** Penalties apply whenever the group is set to charge them — the engine is behaving correctly and stays as it is. What was missing was the ability to say "this group does not fine people" at all.
  - **Before this, penalties could only be switched off by accident** — you had to leave every rate and amount at zero and trust nothing set one later. There was no stored answer to "does this group charge penalties?". Added `loanPenaltyEnabled` / `contributionPenaltyEnabled` (TINYINT(1) NOT NULL **DEFAULT 1**, so every existing group keeps charging exactly as before; a group already on zero rates still computes zero either way). Both engines short-circuit to a zero penalty when their flag is off — loans in `compute_loan_penalty()`, contributions in `payments.php`. **Both fetch queries were widened to SELECT the new column**: without that the flag reads as absent, defaults to on, and the toggle silently does nothing.
  - Exposed on the **group creation form** (the owner's ask — penalties optional at creation, sent unconditionally so "yes we charge" is a recorded decision rather than an inherited default) and on **Manage Rules → Governance** so it can be changed later. Proven live: penalty 237,000.00 → **switch off → 0.00** → switch on → 237,000.00; non-boolean rejected 422; group restored.
  - **The misleading preset labels are fixed.** "Next instalment — MWK 237,000.01" read as a 237,000 instalment when it was really 0.01 of instalment plus 237,000 of accrued penalty. The figure was right and the label hid it, which is worse than either alone. `repayment_quick_amounts()` now returns a `breakdown {loan, penalty}` that always sums to the headline, and the chip renders **"MWK 0.01 loan + MWK 237,000.00 penalty"** beneath it — only when both parts are non-zero. Shared renderer, so the member's own form gained it too.
- [x] **L11 — Loan Details now carries the full money trail, both directions. 2026-08-08, browser-proven.** The panel could show a balance but not *when* anything happened. Added two dated logs beneath the figures:
  - **Payments made** — every repayment newest-first with its date, instalment month and method; a `pending` row is tagged **awaiting approval**, because a claimed payment is not money in the box and hiding it invites recording the same cash twice.
  - **Repayment schedule** — every instalment with its due date, tagged `settled` / `due` / `overdue`, and either the date it was paid or how much of it is still owed. **`settled` is driven by the row's actual balance, not its stored status flag** — a row can be marked `paid` while still carrying a rounding remainder, which is exactly how the 0.02 hid for months (L9).
  - `loans.get` gained a `history` block using the same query and ordering as `repayments.balance`, so the detail panel and the record-payment form can never disagree. Proven live on QA Member Two: 3 payments dated 20/04, 20/05, 20/06/2025, and a schedule showing months 1 and 2 **overdue with MWK 0.01 still owed each** against month 3 settled.
- [x] **L12 — The member side now gets the same money trail. 2026-08-08, browser-proven.** Owner: *"now do the same for the user side loan payments and other payment types."*
  - **Member loan history modal (`loan_payments.html`)** — gained the **repayment schedule**: every instalment with its due date, tagged `settled` / `due` / `overdue`, showing either the date it was paid or how much is still to pay. A member could previously see only what they had paid, never what was next. `settled` is driven by the row's real balance, not its stored status flag (same reasoning as L11).
  - **Killed a client-side money total there.** "Total repaid" was `relevant.reduce(...)` — summing amounts in the browser and subtracting penalty portions as it went. That is the defect class this project has shipped repeatedly: a second, independently-derived total free to drift from every other surface. Now reads the server's `amountRepaid`, and states "Still owed" beside it.
  - **Fixed a contradiction the modal was showing:** it listed payments from `repayments.mine` (the *caller's* repayments) against a schedule for the *loan*. For an admin using the member page — where `loans.list` returns the whole group but `repayments.mine` returns only their own — it printed "No repayments recorded" directly above a schedule reading "Paid". Now uses the loan's own history, so the two halves always describe the same loan.
  - **Member "My Payments" (user dashboard)** — was approved-only and titled as such, so a member could see what had cleared but never what was pending, rejected, or still to come, and **no due date appeared anywhere**. Now every obligation across seed money, monthly contributions and service fee, each with **Due** and **Paid** dates and a plain-language state: Paid · Awaiting approval · Due · Overdue · Rejected.
  - **Two defects found by looking at the rendered table, not the code:** (1) an admin opening their own dashboard saw *every member's* obligations — four identical "Monthly Contribution — August" rows — because `payments.list` scopes to the caller only for a plain member; now filtered to the signed-in uid (presentation only; the server-side scoping is what actually protects a member's data). (2) a **rejected** payment rendered as "Due" with the submission date beside it, telling a member their money was merely outstanding when their payment had been turned down — `rejected` is now its own labelled outcome.
  - The footer total is labelled **"Total approved"**: the table now carries due and pending rows, so an unqualified "Total" would read as the sum of every row. Proven live: 12 rows, 10 Paid · 1 Due · 1 Rejected, zero console errors.
- [x] **BL-7 — ANSWERED by the owner 2026-08-08: no threshold; penalties apply if the group is set to apply them; make penalties optional at group creation.** Actioned as L10. Kept as the audit trail — do not re-raise. *(Original finding: MWK 237,000.00 accrued on a MWK 0.02 shortfall, at a flat 500/day since Apr 2025, surfaced by the L9 repair and not caused by it.)*

### J11 — sidebar avatar *(owner-decided 2026-08-07)*
- [x] **RESOLVED — reverted to a click-to-change file picker, per the owner.** The previous specialist had diverged to an `<a href="settings.html">`; that divergence was put to the owner with a recommendation to keep it and **the owner chose the revert**. Sidebar avatar is now a `<label>` + hidden `#navProfilePictureInput` (deliberately a different id from settings' `#profilePictureInput` — the nav renders on settings.html too, and a collision would have broken that page's own uploader; verified in-browser that both coexist and each label resolves to its own input). Topbar avatar deliberately untouched.

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

**2026-08-06 run: all five backlog items BUILT; J1/J2/J3/J4 are now closed.** Cycle detail is in `.claude/archive/BUILD_PLAN_history_2026-08-06_run.md`.

> ⚠ **A curation pass on 2026-08-06 replaced this block with a line reading "all now done or archived" and deleted every BUILT-NOT-PROVEN marker, while leaving stale text that still described J1's entry point and J2/J3/J4 as outstanding. All four had shipped.** Restored below. **"Built" and "archived" are not "proven" — do not collapse that distinction again.**

### ~~THE ONLY OPEN JOB: ONE BROWSER PASS~~ — **DONE 2026-08-07. All five items closed; see section 8.**

> ✅ **Items 1–5 below are all PROVEN as of 2026-08-07**, in the first authenticated browser session this project has had. Item 2 (hero band) passed unchanged at wide/≤768/≤480. Item 4's money reconciled but its *labelling* was defective and was fixed. **Three further defects were found that were not on this list at all** — a wrong arrears figure on the admin dashboard, content clipped at ≤1280px, and "Net Profit" on the analytics page actually showing the cash position. Detail and evidence in section 8. Kept below for the audit trail.

**Historical note (2026-08-06):** no browser was connected for that whole run (checked four times). Everything was `php -l` / module-parse clean and reconciled against the live DB through the real handler code — but **nothing had been rendered**. Widths tested on 08-07: 480 · 768 · 1300 · 1600 (the browser applies a ~1.11× zoom, so requested sizes were compensated to land on real CSS breakpoints).

1. **Drawer close control — BUILT, NOT PROVEN.** A 44×44 "Close menu" button in the drawer header (≤1024px only) wired to the existing close path; focus moves to it on open; `body.bn-drawer-open` scroll lock scoped inside the ≤1024px query. *Prove:* the drawer opens, the button closes it, Escape and overlay still close it, the page behind does not scroll, and `aria-expanded` flips both ways.
2. **Hero 4/3 band — BUILT, NOT PROVEN. Highest-risk item of the run.** 12-column track; wide = 4 then 3, ≤768 = 3 per row with the 7th centred, ≤480 = 2 per row with the 7th centred. **QA caught a real cascade defect here and it was fixed on the one permitted retry** — the exactly-7 rules are (0,6,0) and media queries add no specificity, so unscoped they leaked into the narrow breakpoints and left cards 5–6 at the wrong span (row filling 8 of 12 columns). Now guarded by `@media (min-width: 769px)`. Reproduced with the guard disabled and re-resolved with it on, via a cascade resolver over the real stylesheet — **but a resolver is not a renderer.** *Prove:* card widths are uniform in every row, and the 7th card is centred at ≤768 and ≤480.
3. **"Request a Loan" on `loan_payments.html` — BUILT, NOT PROVEN.** Links to `user_dashboard.html?open=loan-request`; the dashboard opens the existing modal and strips the param via `replaceState`. *Prove:* the round trip opens the modal, and a refresh afterwards does NOT reopen it.
4. **Penalty display + D4 seed-money line — money PROVEN, render NOT.** *Prove:* the arrears modal's Late-penalty column and its Arrears/Late-penalties/Total-owed block agree with the Arrears tile, and the Contributed drill's seed-money line appears for **2025** (105,000.00) and is absent for 2026.
5. **Cycle 127 check 5** — hero centring and 2-up grid wrapping, never visually inspected. Folds into item 2.

- **UI-127-VERIFY — checks 1–4 PROVEN 2026-08-05; check 5 still open** (now item 5 above). Full brief in the HANDOVER section.
- **J1 / J2 / J3 / J4 — CLOSED 2026-08-06.** J1's last UX gap (no request entry point on the member's own loans page) is item 3 above. J2 Slice 3 shipped with three defects fixed, one of them a wrong money label. J3's D4 seed-money reconciliation shipped. J4 shipped 2026-08-05. Detail in the archive.

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
| 2026-08-07 | `group_rules` | `ALTER TABLE group_rules ADD COLUMN loanTermBandEnabled TINYINT(1) NOT NULL DEFAULT 0;` | Amount-banded max repayment term (owner constitution: <500,000 → 2 months, ≥500,000 → 3 months). Guarded by `INFORMATION_SCHEMA.COLUMNS` COUNT (idempotent, re-run confirmed as SKIP). Default `0` ⇒ every existing group behaves exactly as before until an admin opts in via `rules.update`. 2 live rows, both verified still `0`/`NULL` after apply — zero rows updated. |
| 2026-08-07 | `group_rules` | `ALTER TABLE group_rules ADD COLUMN loanTermBandThreshold DECIMAL(15,2) NULL;` | Companion column — the principal boundary between the two bands. NULL until configured. Verified present. |
| 2026-08-07 | `group_rules` | `ALTER TABLE group_rules ADD COLUMN loanTermBandLowerMaxMonths INT NULL;` | Companion column — max repayment months for principal `< loanTermBandThreshold`. Verified present. |
| 2026-08-07 | `group_rules` | `ALTER TABLE group_rules ADD COLUMN loanTermBandUpperMaxMonths INT NULL;` | Companion column — max repayment months for principal `>= loanTermBandThreshold` (boundary is inclusive of the upper band — the more forgiving reading for the borrower). Verified present. Shared helper `loan_term_bounds_for_principal()` in `api/handlers/loans.php` is the single reader for both loan-request enforcement sites (`request_loan()`, `force_loan()`) and the `loans.eligibility` preview; writer whitelist added to `update_rules()` in `api/handlers/rules.php`. |

Earlier migrations (001–011) predate this log and live in `database/migrations/` — historical only; the live-DB-direct rule supersedes them.

No loan percentage-rate column was added: the existing DEAD `loanPenaltyRate DECIMAL(5,2)` is reused as the loan % rate (type matches the contribution rate columns). Existing `contributionPenaltyDailyRate`/`MonthlyRate` are reused for contribution %.

---

## 6. ASSUMPTIONS LOG — standing autonomous decisions (owner may override any line)

> ### ⚑ THE BASICS — village-banking order of operations (owner-stated 2026-08-06, do not re-derive)
> **A cycle runs in this order, and the UI must never present it otherwise:**
> 1. **Seed money first.** It is the joining stake that capitalises the box. It is due at the START of the cycle, before monthly contributions run and **before the group lends anything out**. Unpaid seed money is already a bar to borrowing (`payment_recompute_member_flags` → `seedMoneyPaid` → `eligibleForLoan`).
> 2. **Monthly contributions** then run for the cycle's months (`payment_cycle_months_to_date` — a month before the cycle started was never owed).
> 3. **Loans** are disbursed from the pooled money, and repaid on a schedule of instalments with dates.
> 4. **Penalties** accrue on whatever is late, and a repayment clears **penalty → interest → principal** in that order (`repayment_allocate`).
>
> **Consequences already built in:** a preset worth "one instalment" must include the outstanding penalty or it will not clear that instalment; the contribution form prompts when seed money is still short (a PROMPT, never a block — the server accepts out-of-order payment and the UI must not invent a rule the ledger does not enforce); every "next payment" figure is shown **with its due date**, and subsequent instalments with theirs.

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
| **Accounting-summary penalty figures = LIVE, not settled-only (cycle 121 finding → cycle 122 fix)** | `payments.accountingSummary` penalty figures reflect **live accrual**, not just persisted `penalty_settlements`. Definition: `penaltiesCollected` = SUM settled `amountPaid` (unchanged, real cash); `penaltiesWaived` = SUM settled `amountWaived` (unchanged, real forgiveness); `penaltiesOutstanding` = the group's **live outstanding penalty across BOTH contributions AND loans, net of settlements** = `group_arrears_summary`'s live contribution `penaltyAccrued` (current year) **+** SUM over the group's loans of `compute_loan_penalty()['amountOutstanding']`; `penaltiesCharged` = collected + waived + outstanding (identity holds, now includes live accrual). `cashPosition` is UNCHANGED — it already uses only `contributionPenaltiesCollected` (real cash). Contribution penalties are **current-year-scoped** because the live engine (`group_arrears_summary`) and the arrears tile are year-scoped — reusing that exact engine (one source of truth) beats a parallel all-time re-derivation; loan penalties are inherently per-loan/all-time. | Scout confirmed the structural gap: today the four penalty figures SUM `penalty_settlements` only, so a group with configured penalties + overdue obligations shows `penaltiesCharged=0` while `groupArrears.penaltyAccrued>0` — the "arrears tile showed 0 against 1,379,000" bug class. This is *"show the accurate number"*, NOT a new money rule the owner must set (bases were already decided in BL-6). Reuse the existing engines so the figures provably reconcile and cannot drift. `groupArrears` is contributions-only, so equality with it holds only when loan penalties are zero — the complete figure adds the loan engine. |
| **THE OBLIGATION CLOCK — owner decision 2026-07-25 (both options put to the owner, both chosen)** | **What a group is owed is bounded by its CYCLE, not the calendar year, and bounded at TODAY.** New shared helpers in `api/handlers/payments.php`: `payment_cycle_months_to_date()` (months of the year inside `[cycleDurationStartDate, +cycleDurationMonths / cycleDurationEndDate)` that have already begun; falls back to Jan..current month when no cycle start is set) and `payment_overdue_months()` (that subset whose due date has passed). `payment_fetch_rules()` now also SELECTs `cycleDurationStartDate/EndDate/Months` — **omitting them does not fail loudly, it silently bills the whole calendar year.** Consumers: `group_live_contribution_penalty_minor()` (→ `payments.groupArrears`, `payments.accountingSummary` penaltiesOutstanding, admin-dashboard arrears tile) walks `payment_overdue_months()` instead of all twelve `PAYMENT_MONTHS`; `group_compliance_summary()` walks `payment_cycle_months_to_date()`. Seed money and service fee are **cycle-entry** obligations with no future due date — outstanding seed is always also overdue (unchanged). | The all-twelve-months loop billed a group in July for the following December **and** for months before its own cycle existed. Live proof on group `cf4156a1…` (cycle opened 2026-07-17): `payments.groupArrears` reported **750,000 arrears + 506,000 phantom penalties** against a real overdue position of **170,000 / 0**. Those penalties fed loan eligibility and the accounting summary. Outstanding-but-not-yet-due money is not arrears; it now lives in `payments.compliance`'s `toDate.notYetDue`. |
| **Compliance panel = TWO SCOPES, never mixed — owner decision 2026-07-25 ("Both, stacked")** | `payments.compliance` returns the month scope (`expectedThisMonth`/`collectedThisMonth`/`shortfallThisMonth`/`percentCollected` + new `monthDueDate`/`monthIsOverdue`) **and** a separate `toDate` block (`monthsCounted`, `overdueMonths`, `expected`, `collected`, `outstanding`, `overdue`, `notYetDue`, `percentCollected`). `behind[]` gains `overdue`/`notYetDue`/`isOverdue`/`overdueMissing`, and `membersBehind` now means **late**, with new `membersOwing` for "has a balance". **RECONCILIATION GUARANTEE: `sum(behind[].owed) === toDate.outstanding` and `owed === overdue + notYetDue` per row** — the totals are derived FROM the rows, not computed a second way. `manage_payments.html` renders the two as separate `.compliance-row` blocks. | The panel printed a month-scoped headline ("0% collected · 50,000 short this month") directly above a cycle-scoped member list showing 60,000 each and summing to 220,000 — three scopes in one sentence, nothing reconciling. Owner reported it as "makes no sense", and it did not. A list under a total must add up to that total. |
| Design tokens | **Split rule for undefined tokens: a missing *rung* is defined; a *wrong name* is fixed at the call site.** A rung has a canonical value and multiple consumers (define it). A wrong name is a typo for a token that already exists — `--bn-text-md`→`--bn-text-base`, `--bn-error`→`--bn-danger`, `--bn-shadow-2xl`→`--bn-shadow-xl` (fix the call site) | Defining a synonym would enshrine **two vocabularies for the same concept** in the design system permanently, for every future author. Cycle 114's define-don't-patch inversion was right for rungs and is wrong for synonyms; the discriminator is "does an equivalent token already exist?". |
| **Share-out settled-state read (K1)** | A settled cycle is read back through a **new `cycle.payouts.list`**, never by re-running `cycle.payout.preview`. When the group has no cycle configured or has not settled, the endpoint returns **`settled: false` with an empty `payouts[]` and a 200 — it does NOT error**, so the page can still show the live preview. `distributedPenalties` is reported as `SUM(penaltyShare)` over the stored rows (a fact about the settlement); `shareOutPenalties` is deliberately **NOT** echoed from `group_rules`, because that is today's rule, not the rule in force when the cycle was settled | `cycle.payout.preview` recomputes live from current data, so after settling it silently shows a *fresh* preview with no indication the cycle is closed, and pressing settle returns 409. The settled rows would otherwise be write-only and invisible forever. A read that 404s/409s on "not settled yet" would force the client to treat a normal state as an error. |
| **Share-out confirm gate (K2)** | Settle is a **two-step, in-page** gate: a "Settle this cycle" button reveals a confirmation panel restating member count + total payout, with a checkbox that must be ticked before "Confirm settlement" enables. No `window.confirm`. The button is additionally **disabled whenever `summary.balances` is false** | Settling is irreversible through this API and pays out real money. `window.confirm` cannot restate the figures being committed, and the owner's rule is that a money moment shows the full financial picture. Blocking on `balances === false` means the UI refuses before the server has to (the server refuses too — 500 — but a user should never reach it). |
| **Share-out visibility (K2)** | The settle control renders **only** when the caller's group role is `senior_admin` (`myRole` from `groups.mine`, the `interest_penalties_sql.js:144-149` pattern). Preview is visible to admin/senior_admin/treasurer. **The client check is UX only — `cycle.settle`'s server-side `require_role($groupId, ['senior_admin'])` is the gate** and must never be relaxed to make the page work | Same posture as every other role-branched surface here: hiding a control an admin cannot use avoids a pointless 403, but the server stays the authority. Treasurer/admin still need the preview — they run the numbers; only the senior admin closes the cycle. |
| **Share-out entry point (K2)** | `cycle_shareout.html` is added to `ADMIN_NAV_ITEMS` (`scripts/nav_sql.js:53-60`) as a 7th item, label **"Share-Out"**, `nav: "shareout"`, reusing `ICONS.analytics` | A page reachable only by typing its URL is a dead page — this project has already shipped one (`manage_payments`, cycle 117). `financial_reports.html`'s precedent of being nav-less is a defect to avoid, not to copy. The 7th item does tighten the shared mobile bottom-nav, so "7 items fit at 320px with zero horizontal overflow" is an explicit acceptance criterion; if it fails it comes back to the planner as a nav-density decision, not a silent squeeze. |
| **Accounting drill-down = flows scope, balances don't (J3 decision, cycle 125)** | Only **flow** figures — money that MOVED in a period (contributions in, disbursements out, repayments in, interest in, penalties collected/waived) — get a period-scoped month/year drill-down with underlying rows. **Balance/derived** figures (`outstandingLoanPrincipal`, `penaltiesOutstanding`, `penaltiesCharged`, `cashPosition`) are point-in-time or formula-derived; their card modal shows the **cumulative** value with an explicit "running position, not a period total" label + a current-breakdown/derivation table (from fields the summary already returns), **never** synthetic period rows. `outstandingLoanPrincipal` is reclassified from the scout's scopable list to a balance. Period = **year required + month optional**; payments scoped by `year`+`month` ENUM, loans/loan_payments by `YEAR(approvedAt)`/`MONTH(approvedAt)`. The cumulative cards stay cumulative (unchanged from the standing "accountingSummary is not re-scoped by tabs" assumption); only the modal is period-scoped, via an additive opt-in `figure`+`year`(+`month`) drill on the same endpoint. | Accountant principle: never present a cumulative or point-in-time number as a month's activity. A period drill-down is only honest for a flow; forcing "outstanding principal for March" or "cash position for March" onto a snapshot invents a figure. Keeping the drill additive (opt-in param) leaves the no-param cumulative response byte-identical, so nothing existing regresses. |

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

### ✅ CLOSED 2026-08-07 (fifth) — **K1 + K2 + K3: end-of-cycle SHARE-OUT / DIVIDEND. SHIPPED, BROWSER-PROVEN.**

Dispatch briefs deleted per section 1 writing rules (a brief expires with its cycle; the outcome persists). Outcome recorded at K1/K2/K3 in section 3.

**What shipped:** a dedicated Share-Out page showing every member's payout at cycle end, the pool summary, an explicit reconciliation line, and a senior-admin-only two-step settle gate; plus `cycle.payouts.list` so a settled cycle stays readable as a permanent record instead of silently becoming a recomputed preview.

**Proven live (real authenticated browser, QA Test Savings Group `cf4156a1…`):** preview renders 5 members reconciling to MWK 10,050.00 — every rendered cell byte-identical to the server string, zero client-side money math; the reconciliation line is green and driven by the server's own `balances` flag; the settled state proven via a stubbed endpoint response (banner flips green, settle section disappears, absent `shareOutPenalties` renders `—` not `undefined`); the confirm gate opens, restates 5 members / MWK 10,050.00, gates on the checkbox in both directions, and cancels clean. Auth boundary probed four ways: 401 · 422 · 405 · 403. **`cycle_payouts` COUNT(*) = 0 before and after every probe — the live cycle was never settled.** No page-body horizontal overflow at CSS 320 · 1024 · 1025 · 1440; the 8-column table scrolls inside its own container and collapses to per-member cards at ≤768.

**Three defects caught that the static gates had all passed:**
1. **The page was silently dead on arrival** — `pages/cycle_shareout.html` was missing from `PAGE_CONFIG` in `scripts/spa-router.js`. Because `window.__bnSpa === true`, the module's own `if (!window.__bnSpa)` DOMContentLoaded fallback correctly stood down and waited for the router, and the router had no entry — so **nothing ever called `init()`**. Zero console errors. `php -l`, module-parse, the QA diff review and the API itself all passed it. Only opening the page in a browser found it. (See K3 for the three-registration rule this produced.)
2. **A dead optimistic-render branch** (caught by QA REVIEW) — gated on `result.summary`, a key `cycle.settle` never returns. Inert today, but it would have shipped blank member names the moment someone "fixed" the shape mismatch without also fixing `cycle_settle`'s missing `members` JOIN. Removed.
3. **A cascade trap caught pre-ship by `ui-designer`** — a bare `.cell-payout` selector (0,1,0) would have lost to the existing `.table th` rule (0,1,1), silently dropping the payout-column tint regardless of source order. Rescoped to (0,2,1).

**Known-and-accepted (recorded, not fixed):** `cycle_settle`'s own 201 response builds `payouts[]` from `cycle_payouts` alone with no `members` JOIN, so those rows carry no `fullName`. Harmless as shipped — the page always re-reads `cycle.payouts.list`, which does join. Left untouched deliberately: this cycle's acceptance criteria forbade editing `cycle_settle`. **Fix that JOIN before anyone renders the 201 directly.**


---

- **2026-08-07 (fourth) — accounting audit, Money Masters rule coverage, uploads + exports.** Rotated to archive 2026-08-07.

- **2026-08-07 (third) — "I cannot see the i button", and the Accounting Summary made decisive.** Rotated to archive 2026-08-07.

- **2026-08-07 (later) — INFO-PANEL AUDIT: every "i" panel made uniform, and given a second level.** Rotated to archive 2026-08-07.

- **2026-08-07 — FIRST AUTHENTICATED BROWSER RUN.** Rotated to archive 2026-08-07.

**VERIFIED, NO CHANGE NEEDED (the deferred §4 browser pass, now closed):**
- **Hero 4/3 band (was flagged "highest-risk item of the run") — PASSES at all three widths.** Wide: 4 × 220px then 3 × 299px. ≤768: 3/3/1, all 213px, 7th card centre 375 == band centre 375. ≤480: 2/2/2/1, all 183px, centre 231 == 231, zero overflow. The `@media (min-width: 769px)` cascade guard holds — no leak.
- **"Request a Loan" round trip** — opens `#loanModal` ("Book a Loan"), strips `?open=loan-request` via replaceState, and a refresh does **not** reopen it.
- **D4 seed-money line** — 2025: "MWK 245,000.00 in 2025" + "Seed money (one-time, not tied to a month): MWK 105,000.00 · included in the total above"; 140,000 + 105,000 == 245,000. 2026: correctly absent.
- **Drawer close control** — 44×44, present and visible at mobile width. Fixed bottom nav is 73px against `body{padding-bottom:80px}`, so content clears it.
- **J11 profile picture — dark mode + font ACCEPTANCE MET (was unestablishable without a browser).** Label wraps the avatar, input `display:none`, edit badge `pointer-events:none`, hint present. Contrast on the navy gradient: name 18.13:1, hint 7.49:1. Manrope resolves on every element checked. Visually confirmed.

- **J13 (admin half) — CLOSED 2026-08-07.** Rotated to archive 2026-08-07.

- **J13 (user half) — CLOSED 2026-08-07.** Rotated to archive 2026-08-07.

---

All closed tasks, Cycle 127's UI pass, Cycle 126's brief and cycles 114–125 are in `archive/BUILD_PLAN_history_2026-08-06_run.md` (`grep CYCLE` / `grep DECISION`).

⚠ **TAG COLLISION: "J11" names TWO different tasks.** The closed one is *quick-fill amounts + proof of payment* (2026-08-05); the open one is *profile picture* (Cline, 2026-08-06, in the HANDOVER checklist). Re-tag before either is cited again.

---

## 9. ARCHIVE INDEX

| File | Covers | Size |
|---|---|---|
| `BUILD_PLAN_history_cycles-1-113_2026-07-25.md` | Cycles 1–113 complete: every brief, verdict, finding, decision. | 781 KB |
| `BUILD_PLAN_history_2026-08-06_run.md` | Cycles 114–127 + CYCLE-127-VERIFY + Cycle 127 UI (9 items) + 13 closed tasks. Grep `CYCLE`, `DECISION`, `VERIFIED`. | 28 KB |
