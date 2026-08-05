# BUILD_PLAN.md — Bank Nkhonde (LIVE PLAN)

> Owned by `build-planner`. **One objective per cycle.** Specialists read their dispatch brief, never this file.
>
> **HARD SIZE RULE: this file stays under 400 lines / 60 KB.** It was allowed to reach 3,033 lines / 781 KB — past the Read tool's 256 KB limit — which meant the planner that owns it could no longer open it. `doc-curator` rotates history out to `archive/` whenever it exceeds the cap. **Never append a full cycle narrative here.** A closed cycle earns at most one line.
>
> **Full history (cycles 1–113, verbatim, nothing lost): `.claude/archive/BUILD_PLAN_history_cycles-1-113_2026-07-25.md`.** Grep it when you need the reasoning behind a closed decision; never load it whole.

---

## ⇥ HANDOVER — CODING AGENT DISPATCH (2026-08-05, updated)

> ## ⇦ HANDING BACK TO CLINE FOR RE-PLANNING (2026-08-05)
>
> **Every checklist item below is `[x]`. Nothing is BLOCKED.** Full reasoning for each is in section 8; this is the summary.
>
> **Completed this run:** J5 (three client money-math defects), J8 (dead "i" toggles), J8-SLICE-2 (per-member breakdown), J4 (flat-rate interest), J6 (borrower context at approval), J7 (member borrowing power). J3-SLICE-1, J2-SLICE-2, J9 and CYCLE-127-VERIFY were already closed by Cline.
>
> **Owner-reported follow-up closed (J10, §8):** the "i" toggles are now one shared shape across all 15 of them, borrower names resolve live instead of reading a denormalised `loans.borrowerName` that said "Member", and a client-side money re-summation that had reappeared in two admin popovers was removed again. Also fixed: `groupArrears.memberCount` was being labelled "members behind" when it counts every active member.
>
> **New API surface:** `payments.memberBreakdown` (GET, admin-gated, `figure=arrears|collections`). Additive fields: `loans.list summary.activeBalance`; `loans.eligibility` gained `contributed`, `exposure{debtToContributionPercent,flagged,warnings}` and `maxLoanAmount`; `update_rules()` now whitelists `loanInterestCalculationMethod`. **NO DDL was applied — section 5 is unchanged.** New file: none. Functions deleted: `buildArrearsItems()` / `buildCollectionsItems()` (client money math, replaced by the server endpoint).
>
> **Three real accuracy bugs were found by BUILDING, not by reading** (detail in the archive): the admin Arrears modal showed nothing against a true 200,000.00 because it summed the persisted `payments.arrears` column when arrears is derived from `group_rules`; the member "Contributed" info button was dead on three field names the server never sent; and loan approval had **no confirmation step at all** — one click committed the group's cash. **The 2026-08-06 run repeated the pattern twice more** (member penalties invisible behind a tile that included them; a fixed/month penalty captioned in "days"), which is the standing argument for ending every cycle at a runtime pass.
>
> **Briefs whose premise was false (evidence, not excuses) — four now, across two runs:** J4 named the wrong UI file, J8-SLICE-2's premise was the planner's own and wrong, J5 asked for three server fields of which two already existed, and J11 asked for a click-to-change label on avatars that have no file input. Detail in the archive. **Check the premise before building to it.**
>
> **Decisions Cline should review (all recorded in §8):** flat rate uses the **Month 1 rate** as the single monthly rate (owner may prefer a dedicated field); the Request Loan button is left **clickable when ineligible** (a disabled button hides its own tooltip on touch) — divergence from J7's brief; the arrears modal's row filter now follows the server's overdue rule, so a non-cycle month with a past due date no longer shows as arrears.
>
> **Two standing cautions:**
> - **Live QA data moved mid-session** (group verified collections 140,000.00 → 505,000.00, loan balances changed, a fifth member gained payments). Every reconciliation was correct *when it ran*; the figures recorded in §8 are historical. Re-verify against live data.
> - **Playwright MCP never connected.** Verification ran through a Node+Playwright harness in the session scratchpad that logs in for real with the owner's QA credentials. It is NOT in the repo and no credential was written to a tracked file. A future agent must re-create it or be given a browser.
>
> **Suggested next dispatch — ALL FOUR CLOSED 2026-08-06; superseded by §4.** (a) hero grid rebalanced to 4/3 (owner-approved); (b) Quick Actions carry-over resolved, no bug; (c) J2 Slice 3 shipped; (d) J2-SLICE-2 penalty UI browser-tested.

---

**This section is your sole source of truth. Do not scan the repo. Do not read sections 1–9 unless a task explicitly sends you there. Every task below is self-contained with exact file paths, line ranges, and acceptance criteria.**

**Work through the checklist in order. Tick each `[ ]` as you complete it. If blocked, mark it `BLOCKED: <reason>` and move to the next.**

### SETUP (do once)
- The local dev server is ALREADY RUNNING at `http://localhost:8000`. Pages at `http://localhost:8000/pages/<page>.html`. Do NOT start another server.
- Read `.claude/CLAUDE.md` for safety rails, with these overrides: you MAY commit and push. You MAY apply DDL directly to the live MySQL database (no offline .sql migration files — record the DDL in BUILD_PLAN.md section 5). Remaining rails: never destructive SQL (no DROP/TRUNCATE, no unscoped DELETE/UPDATE), never weaken `require_role`, never delete a file without sign-off, never use `innerHTML` with user strings, money is always server-side integer minor units.
- JS syntax check: `node --input-type=module --check < scripts/x_sql.js` (NOT plain `node --check`).
- Test widths: 320, 390, 768, 1024, 1025, 1440. The 1024↔1025 boundary is critical.
- Use Playwright MCP for browser testing at `http://localhost:8000`. For API testing use curl or PHP test scripts. For DB verification use PHP scripts via `getDbConnection()`.

### NEW CHECKLIST ITEMS (added by Cline 2026-08-06)

- [~] **J11: Profile picture — PARTLY BUILT 2026-08-06, NOT BROWSER-PROVEN. One deliberate divergence, one part not attempted.**
  - **DONE — `complete_profile.html` now uses the settings click-to-change pattern.** The one page that genuinely matched the brief: it had a real file input behind a separate "Upload Photo" button with an inline `onclick`. Avatar now wrapped in a label, button gone, input hidden by class, hint added. Its existing `change` handler is untouched and still fires (same input id).
  - **DIVERGED — sidebar avatar became a LINK TO SETTINGS, not a file picker. BRIEF'S PREMISE FALSE; needs owner review.** J11 said to copy click-to-change onto the sidebar/topbar avatars. Those are **display-only** `nav_sql.js` elements with **no file input to attach a label to**. The literal reading means putting an upload control + crop/refresh wiring into every page's global nav, duplicating the flow settings already owns, and letting a phone mis-tap open a file browser from the nav. A nav avatar's conventional affordance is "go to my profile", so it is now an `<a href="settings.html">` routing to the working flow. **One line to revert.**
  - **NOT ATTEMPTED — dark mode + font verification.** Acceptance is "renders correctly / no unreadable contrast / Manrope applies" — unestablishable without a browser, and none was available. `--bn-font-sans` is set on the new elements. **Do not tick J11 until someone views `settings.html` in dark mode.**

  **Status:** `pages/settings.html` profile picture section ALREADY FIXED by Cline. The pattern to replicate:
  - The whole avatar is wrapped in a `<label for="profilePictureInput">` so clicking anywhere on the avatar opens the file picker — no separate "Choose file" button.
  - The edit icon is a `<div class="profile-picture-edit" aria-hidden="true">` (pointer-events: none) so clicks pass through to the label.
  - The file input uses `class="profile-picture-input"` (CSS `display: none`).
  - A "Click to change photo" hint appears on hover (`.profile-picture-hint`).
  - Font family explicitly set to `var(--bn-font-sans)` on `.profile-name`, `.profile-email`, `.profile-picture`, `.profile-picture-hint`.
  - Dark mode: the section uses `var(--bn-gradient-primary)` background with white text, gold accent border, and a subtle radial gold glow behind the avatar.

  **What to do:**
  1. **Apply the same click-to-change pattern to the ADMIN view and USER view profile pictures.** Search for `profile-picture` in `pages/` — the admin dashboard sidebar avatar, the user dashboard topbar avatar, and any other profile picture display should also be click-to-change (wrap in a label, hide the file input, show a hover hint).
  2. **Fix dark mode on the settings page.** The `.profile-picture-section` uses `var(--bn-gradient-primary)` (dark navy) — verify the text is readable (white on dark) and the form fields below use the light theme correctly. If the page has a dark-mode toggle, ensure the profile section adapts.
  3. **Fix font issues.** Ensure `font-family: var(--bn-font-sans)` is applied consistently across the profile section and all settings form labels/inputs. The Manrope font should load from Google Fonts (already in `<head>`).
  4. **Verify in browser** with Playwright MCP at `http://localhost:8000/pages/settings.html` — click the avatar, confirm the file picker opens, and the hover hint appears.

  **Acceptance:**
  - Clicking the avatar (not a separate button) opens the file picker on settings, admin, and user views.
  - Dark mode renders correctly (white text on dark gradient, no unreadable contrast).
  - Manrope font applies throughout the profile section.
  - `node --input-type=module --check` clean on any JS touched.

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

**A–F ticked. G/H/I closed. J1–J4 closed 2026-08-06.** One browser pass is the only open job (§4); one owner-directed item, J11 profile picture, is open in the HANDOVER checklist. History: `archive/BUILD_PLAN_history_2026-08-06_run.md`.

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

### THE ONLY OPEN JOB: ONE BROWSER PASS

**No browser was connected for the whole 2026-08-06 run (checked four times).** Everything below is `php -l` / module-parse clean, and the money is reconciled against the live DB through the real handler code — but **nothing has been rendered**. Widths to test: 320 · 390 · 768 · 1024 · 1025 · 1440.

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

No cycle in flight. All closed tasks, Cycle 127's UI pass, Cycle 126's brief and cycles 114–125 are in `archive/BUILD_PLAN_history_2026-08-06_run.md` (`grep CYCLE` / `grep DECISION`).

⚠ **TAG COLLISION: "J11" names TWO different tasks.** The closed one is *quick-fill amounts + proof of payment* (2026-08-05); the open one is *profile picture* (Cline, 2026-08-06, in the HANDOVER checklist). Re-tag before either is cited again.

---

## 9. ARCHIVE INDEX

| File | Covers | Size |
|---|---|---|
| `BUILD_PLAN_history_cycles-1-113_2026-07-25.md` | Cycles 1–113 complete: every brief, verdict, finding, decision. | 781 KB |
| `BUILD_PLAN_history_2026-08-06_run.md` | Cycles 114–127 + CYCLE-127-VERIFY + Cycle 127 UI (9 items) + 13 closed tasks. Grep `CYCLE`, `DECISION`, `VERIFIED`. | 28 KB |
