# BUILD_PLAN_history — Cycles 114–127 (2026-08-06 rotation)

This archive covers closed cycles 114–127 from the live BUILD_PLAN.md file, rotated for hygiene on 2026-08-06. Ranges: cycles 114–125 + CYCLE-127-VERIFY + J-series tasks from cycle 126+ run. **Grep it, never read it whole.**

---

## HANDOVER TASK STATUS (super-advisor dispatch, run started 2026-08-05)

- [x] **CYCLE-127-VERIFY: Browser pass — PROVEN with Playwright 2026-08-05 (Cline as verifier).** Logged in as qa.admin@banknkhonde.test, QA Test Savings Group.
  - **Check 1 (Burger + drawer @390px):** Burger "Open menu" visible and clickable ✓. Sidebar opens with all 9 Quick Actions inside ✓. **Z-order issue found:** sidebar (`z-index: calc(var(--z-fixed) + 20)`) paints OVER the burger button, so clicking the burger while sidebar is open hits the sidebar SVG, not the button. Escape key closes it ✓. Overlay click not testable via Playwright click (same interception issue). This is the same z-order tie described in the check brief — the sidebar at `+20` beats the bar at `var(--z-fixed)`, which is working as designed for the drawer→bar relationship, but the burger lives on the bar and is now unreachable while the drawer is open.
  - **Check 2 (Quick Actions relocation):** At 390px/1024px, Quick Actions in sidebar ✓. At 1025px, Quick Actions in hero (no burger, no sidebar drawer) ✓. The `appendChild` move across boundary worked consistently — buttons wired by id, no clones.
  - **Check 3 (Bottom nav @1024px/390px):** 5 links (Dashboard, Analytics, Loan Payments, Contacts, Admin) present and evenly spread ✓. Labels centred under icons ✓.
  - **Check 4 (manage_loans.html @1024px):** (a) Tabs: All Loans, Pending Requests, Active Loans, Repaid, Cancelled, Overdue ✓. (b) "No pending loans found" empty state ✓. (c) Pending payments: "No pending payments to review" ✓. (d) Borrower dropdown with "All Borrowers" selected ✓. (e) "Clear filter" hidden at "All Borrowers" ✓. (f) ⚡ Forced Loans quick action present ✓; collapsed `<details>` at page foot with summary "Forced Loans Automatic loans... Off" ✓.
  - **Check 5 (Layout polish):** NOT VERIFIED at this pass — hero centring and 2-up grid wrapping need visual inspection at each width. Deferred to owner review.
  - **Bugs found:** The burger-inaccessibility-while-drawer-open is a UX defect (users can't close the drawer by re-tapping the burger). The overlay click path is also blocked. Escape key works. Not a blocker — the drawer closes via Escape or by tapping a nav link.
- [x] **J3-SLICE-1: Backend period drill-down — ALREADY BUILT + LIVE-VERIFIED.** See detailed reconciliation above. Four flow figures drill correctly; seed-money NULL-month gap is the owner-decided D4 behaviour.
- [x] **J2-SLICE-2: Admin penalty-rules UI — BUILT (frontend only).** Not browser-tested. See details above.
- [x] **J5: Three client-side money-math defects — DONE + BROWSER-PROVEN 2026-08-05.** All three displayed totals now read a server field; no client re-summation remains in any of the three functions. Backend added exactly ONE field (`loans.list summary.activeBalance`); no DDL.
  - **AUTONOMOUS DECISION — built 1 of the 3 briefed server fields, not 3.** The brief asked for `activeReceived`, `totalArrearsAcrossObligations` and `totalAmountPaid`. Two already existed under other names: `loans.list summary.activePrincipal` is already Σ principal over `['approved','disbursed']` (byte-identical to the requested `activeReceived`), and `payments.list summary.verifiedCollected` is already Σ `amountPaid` over `['approved','completed']` (identical to `totalAmountPaid`). `payments.obligations summary.overdue` already carries the arrears total. Shipping duplicates would have left two server names for one money total — the way two figures silently drift apart. Only `activeBalance` (Σ `remainingBalance` over the same active set) was genuinely missing.
  - **AUTONOMOUS DECISION — the arrears modal's row filter changed, and this changes what a member sees.** `openArrearsModal` selected rows with a browser-side `dueDate < today` test, ignoring the server's `counts` flag. That listed months the group's cycle never raised, i.e. money the member never owed and that `record_payment`/`approve_payment` would refuse to collect a penalty on. Rows are now selected by the server's own rule (seed/service fee: outstanding ⇒ overdue; month: `counts && overdue`), which is exactly the rule behind `summary.overdue` — so the footer is now a server total that reconciles with its rows by construction. Effect: a non-cycle month with a past due date no longer appears as arrears. Proven live in-browser: a stubbed February with `counts:false` and a past due date was correctly excluded, giving 35,000.00 (server) instead of the old client 40,000.00.
  - **Proven (Playwright, 1440px, stubbed API deliberately made to disagree with its own rows):** active-loan rows summing to 222.22/444.44 rendered **50,000.00 / 41,666.66** (the server summary); all-payments rows summing to 3.00 rendered **140,000.00** (`verifiedCollected`); arrears footer **35,000.00** = Σ its two listed rows. A surviving client sum would have shown the row-sum in every case.
  - **Reconciled against the live DB** (group `cf4156a1…`): `activeBalance` = 41,666.66, `activePrincipal` = 50,000.00, `verifiedCollected` = 140,000.00. The 41,666.66 independently matches the `outstandingLoanPrincipal` figure the cycle-121 scout recorded.
  - **Boundary:** the `loans.list` HTTP response was NOT observed carrying `activeBalance` — that endpoint is session-gated and no test login is available. The field's value is reconciled at DB level and `php -l` is clean; the browser proof used a stub.
- [x] **J8: Broken "i" info toggles — ROOT-CAUSED + FIXED + BROWSER-PROVEN 2026-08-05 (real login, owner-supplied QA credentials).**
  - **The owner's premise was partly false, and the audit is what found the real bug.** The report was "the i buttons on the ADMIN dashboard do nothing". Audited live in-browser: admin_dashboard's 4 toggles all open with real content (Collections, Active Loans, Pending, Arrears), analytics' 4 all open, and 5 of user_dashboard's 6 open. **Exactly one toggle in the entire app was dead — "Contributed" on the MEMBER dashboard.** Reported as evidence rather than pushed through, per the retry policy.
  - **Root cause — a field-name mismatch shipped by the most recent commit** (`685a6ca "populate Contributed popover with dynamic seed/monthly/service-fee breakdown"`). The client read `summary.seedMoneyContributed` / `.monthlyContributed` / `.serviceFeeContributed`; the server has never sent those names — it returns the split as its own sibling object `contributionBreakdown.{seedMoney,monthly,serviceFee}`. All three read `undefined` → total 0 → the builder appended nothing → `card_info.openFor()` refuses to open an empty panel → **the button did nothing, with no console error**. Now reads the real fields.
  - **AUTONOMOUS DECISION — fixed the failure MODE, not just the field names.** `card_info`'s "never flash an empty box" rule is correct in isolation, but it converts any renderer that blanks a popover source into a visibly dead button with no trace. Both mirror-the-source builders (`initHeroStatPopover`, `setupStatCardPopovers`) now capture the card's SHIPPED explanation text at init and fall back to it when the source is empty, with a last-resort "No details available for this period." So this bug class cannot silently recur on any hero or stat card. The admin renderers happen to always emit an empty-state line today — that guard is no longer load-bearing.
  - **AUTONOMOUS DECISION — Contributed no longer blanks its own copy, and now closes the derivation.** The old code called `replaceChildren()` unconditionally, destroying the useful static explanation even when it had no breakdown to put there. It now only replaces once real rows exist, and appends a **"Total contributed"** row so the member can see the parts add up to the headline figure (AUTONOMOUS THINKING RULE — transparency over mystery).
  - **Proven in browser (1440px, real login, live data):** all 14 toggles across `admin_dashboard` / `user_dashboard` / `analytics` open with non-empty content; 0 legacy dead `.stat-card-info-toggle` buttons remain; 0 cards missing a toggle. Contributed now reads "How your contributions break down → Monthly contributions MWK 10,000.00 → Total contributed MWK 10,000.00", and **10,000.00 independently matches this member's verified-collected total from a direct DB query**. `node --input-type=module --check` clean on both changed scripts. No `innerHTML` used.
  - **Explicitly NOT done, and why:** the brief's per-member breakdown modals. `payments.groupArrears` returns group totals + `memberCount` only — no per-member rows — so this needs a new admin-gated server aggregation. Split out as **J8-SLICE-2** rather than bolted onto a UI fix.
- [x] **J8-SLICE-2: Per-member breakdown — DONE + BROWSER-PROVEN 2026-08-05 (real login, live data).**
  - **MY OWN PREMISE WAS WRONG — recorded because I wrote it one cycle earlier.** I scoped this slice as "the per-member modals don't exist and there is no per-member data". The modals DO exist and are wired (`openStatModal` → Arrears/Active Loans/Pending/Collections, `.stat-modal`). What was actually wrong is that two of them added money up **client-side** (`buildArrearsItems`, `buildCollectionsItems` accumulating per-member totals from the cached payments list) — the same A2 violation J5 fixed on the member side. A stale scoping note is a claim with a shelf life, mine included.
  - **A REAL ACCURACY BUG, found by building it: the Arrears modal was showing nothing against a true 200,000.00.** `buildArrearsItems()` summed the persisted `payments.arrears` column. **Arrears is not a ledger sum** — it is derived from `group_rules`, so an obligation with NO payment row at all is owed and completely invisible to the ledger. My first server implementation reproduced the same mistake and returned `0.00 / 0 members` while the Arrears tile read `MWK 200,000.00`; that disagreement is what exposed it. The endpoint now walks the same active-member set, the same `payment_overdue_months` rule and the same primitives as `group_live_contribution_penalty_minor`, so the rows sum to the card above them by construction. **This is the same bug class as the arrears tile that once showed 0 against a true 1,379,000.**
  - **Shipped:** `payments.memberBreakdown` (GET, `PAYMENT_ADMIN_ROLES` — it exposes every member's position, so it can never be member-visible), `?figure=arrears|collections`, optional `year`, returns `{figure, total, memberCount, members:[{uid, memberName, amount, breakdown:[{label, amount}]}]}`, sorted largest-position-first (the member an admin most needs to act on). All money `money_to_minor`/`money_from_minor`, row-wise, no SQL SUM, no float. **No DDL.** Route added to `api/index.php`; no existing route touched.
  - **AUTONOMOUS DECISION — collections reads the ledger, arrears reads the rules.** Deliberately asymmetric and commented as such: money *received* is a fact recorded in `payments`, money *owed* is derived from `group_rules`. Using one source for both is exactly what produced the 0.00. A future reader must not "simplify" these into one query.
  - **AUTONOMOUS DECISION — deleted rather than left in place.** `buildArrearsItems()`/`buildCollectionsItems()` were removed (functions, not files — no file deletion) with a comment naming the bug, because leaving a wrong money aggregation in the file invites its reuse.
  - **Proven in browser (1440px, real login, live data):** Arrears modal shows **"MWK 200,000.00 across 5 members"** with 5 rows summing to exactly that, and it matches the Arrears tile behind it; per-member breakdown lines reconcile (e.g. Seed Money 50,000 + Monthly-July 10,000 = 60,000). Collections shows **"MWK 140,000.00 across 4 members"**, matching an independent direct DB query per member (60,000 / 60,000 / 10,000 / 10,000). "Loading…" renders while in flight; Escape closes; bad `figure` → 422. `php -l` + `node --input-type=module --check` clean.
- [x] **J4: Flat-rate loan interest method — DONE + END-TO-END PROVEN 2026-08-05 (real login, live API).**
  - **BRIEF PREMISE FALSE — the named UI files have no interest fields.** The brief said to add the dropdown to `pages/manage_rules.html` / `scripts/manage_rules_sql.js`. That is the **prose governance** page (rules text + rules PDF); its own header says the numeric money policy is edited elsewhere. `grep -i interest` returns nothing in either file. The real surface is the **"Edit Interest Rates & Penalties" modal in `scripts/interest_penalties_sql.js`**, which is where `loanInterestRateMonth1/2/3` are already edited. Built there instead.
  - **Shipped:** `compute_flat_rate_schedule()` in `api/lib/money.php` + a `$method` parameter on `compute_loan_schedule()` (defaults to `reduced_balance`, so every existing caller is unchanged); `loan_calculation_method()` in `loans.php` as the single reader of the rule, passed at all three pricing call sites (preview, approve, admin-created loan); the `501 flat_rate is not implemented` guard replaced by one that still refuses any value outside the ENUM; `loanInterestCalculationMethod` added to the `update_rules()` whitelist with ENUM validation; a labelled dropdown + plain-English help in the rates modal. **No DDL** — the ENUM already existed.
  - **AUTONOMOUS DECISION — flat rate uses the Month 1 rate as THE monthly rate; months 2 and 3 are ignored.** The group configures three declining rates because under a REDUCING balance the early months carry a bigger balance. A flat loan has no reducing balance, so a declining tier describes nothing. Applying all three to the full principal would invent a fourth product that is neither flat nor reducing. Month 1 is the group's headline rate and the one an admin means by "the interest rate". **Owner may want a dedicated flat-rate field instead — flagging as reviewable.**
  - **AUTONOMOUS DECISION — flat rate is materially more expensive and that is left visible, not softened.** On 30,000 over 3 months at 10%: reducing = 4,900.00, flat = 9,000.00 (~1.8×). That is what flat-rate lending *is*. Safe-defaults rule honoured: the method defaults to `reduced_balance`, an admin must opt in, and the dropdown's help text says plainly that flat costs more and that existing loans keep their approved terms.
  - **Rounding:** flat computes interest ONCE over the whole term then splits it (the opposite order from the reducing branch — inherent to the product, there is only one charge to round). Months 1..n−1 take the rounded share of both principal and interest; the final instalment absorbs both remainders. A reconciliation self-check now asserts principal, interest AND total each sum exactly, and throws rather than emit an unbalanced schedule.
  - **Proven end-to-end through the live API (not just the formula):** same loan (30,000 / 3 months), group switched via `rules.update` and switched back — preview returned **4,900.00 with rates 10/7/5** under reduced_balance and **9,000.00 with 10% every month** under flat_rate, `readback` confirmed each write, and the QA group was **restored to `reduced_balance`** (final readback confirms). Unit checks: reducing baseline unchanged at 4,900.00; flat 1,000/3m splits 333.33/333.33/333.34 summing exactly; 10,000/7m remainder absorbed; omitting the method argument equals reduced_balance; an unknown method throws. Invalid method via `rules.update` → 422. `php -l` clean on money.php/loans.php/rules.php; `node --input-type=module --check` clean on interest_penalties_sql.js.
- [x] **J6: Borrower financial context at loan approval — DONE + BROWSER-PROVEN 2026-08-05 (real login, live data).**
  - **The real finding: approval had NO confirmation step at all.** `approveLoan()` fired `loans.approve` straight from the button's click handler — one click committed the group's cash, with the borrower's existing position nowhere on screen. That is the actual lending risk the brief was pointing at.
  - **AUTONOMOUS DECISION — extended `loans.eligibility` instead of adding an endpoint.** The brief said "add a new endpoint or extend `loans.get`". `loans.eligibility` **already** had the admin-only `?uid=` override, the 404-if-not-in-this-group check, and `loan_member_standing()` — it already returned active loans, outstanding balance, arrears and penalties. It needed only `contributed` + an exposure block. A second endpoint would have duplicated an auth boundary, which is the last thing worth duplicating.
  - **AUTONOMOUS DECISION — the snapshot is ADVISORY and says so in code.** `loan_exposure_assessment()` never blocks; `loan_eligibility_check()` remains the only gate and still re-runs inside `loans.approve`. Conflating a soft warning with a hard gate would silently start refusing loans the group's rules permit. The modal shows the two separately: an **amber** advisory box for risk, a **red** box when the group's own rules say the member does not qualify.
  - **AUTONOMOUS DECISION — a missing ratio is reported as `null`, never 0%.** A member who has borrowed but never contributed has no meaningful debt-to-contribution ratio (divisor zero). It returns `null` plus its own warning and the modal prints "Not applicable — no contributions yet". A fabricated 0% would read as the safest possible borrower, which is the exact inversion of the truth.
  - **AUTONOMOUS DECISION — warnings carry no money amounts.** First build embedded `money_from_minor()` output in the warning text, which rendered a bare `40000.00` directly beneath a formatted `MWK 40,000.00` in the same modal — only the client's `formatCurrency()` renders money. Every figure a warning refers to is already shown, formatted, in the rows above it, so the warnings now name the problem and not the number.
  - **AUTONOMOUS DECISION — built the modal in JS, not in `manage_loans.html`.** The brief said to add a container to the page. This page's established pattern is JS-built modals appended to `<body>` (`promptForReason`); adding a second, HTML-declared pattern would leave two ways to do one thing. No HTML file was touched.
  - **Proven in browser (1440px, real login, live data):** with a pending loan present, clicking **Approve** opens "Review before approving" showing Borrower / Amount MWK 15,000.00 / 3 months / Purpose, then Already owes MWK 10,700.00, Across active loans 2, Has contributed MWK 90,000.00, Overdue contributions MWK 40,000.00, Outstanding penalties MWK 66,800.00, **Debt vs contributions 12%** (10,700 / 90,000 — correct), plus the amber advisory box; buttons Cancel / Approve loan. Sampled continuously for 8s — the modal stays open. **Cancel leaves the loan pending** (no approval fired). Threshold logic proven by direct unit checks: 50% not flagged, 250% flagged, **exactly 200% not flagged, 201% flagged**, zero-contributions → `null` + warning, brand-new member → `null` + not flagged, arrears-only and penalties-only each flag. `uid` not in group → 404. `php -l` + `node --input-type=module --check` clean.
  - **Test data created and cleaned up.** To get a pending loan the group's `loanRulesMaxActiveLoansByMember` was raised 1→9, one loan requested through the app's own `loans.request` (purpose "J6 verification - safe to reject"), then the loan was **rejected** and the rule **restored to 1**. Final state verified: `maxActiveLoans=1`, `interestMethod=reduced_balance`, `pending=0`. The eligibility gate correctly refused the first attempt (admin already at the limit) — it was raised through the sanctioned admin rule, never weakened in code.
  - **HARNESS BUG, not an app bug — worth recording.** The verification harness ignored `wait` on eval-only steps, so a step that kicked off an async fetch was checked by the NEXT step before it resolved. This reported "MODAL_NOT_OPENED" **twice** for a feature that worked. Fixed in the harness. The lesson is the project's own: a negative result from tooling is a claim about the tooling until proven otherwise.
  - **LIVE DATA IS MOVING UNDER THE LOOP.** The QA group's figures changed mid-session (group verified collections 140,000.00 → 505,000.00; a fifth member gained payments; loan balances changed). Every reconciliation in this session was correct **against the data present when it ran** — J5's and J8-SLICE-2's recorded numbers are therefore historical, not current. Re-verify against live data rather than against those figures.
- [x] **J11: Quick-fill amounts + proof of payment on all four record forms — DONE + ALL FOUR BROWSER-PROVEN (owner-directed).** Loan presets proven; proof of payment wired on all four forms; seeder fixed so loan repayment works. See full details in archive.
- [x] **J12: Seeder fix, due dates on every next payment, and the cycle's order of operations (owner-directed 2026-08-06).** `seed_test_data.php` now writes proper `loan_repayment_schedule` rows; due dates on all presets and every next payment chip; basics written into section 6 assumptions and enforced in UI.
- [x] **J10: "i"-toggle uniformity + borrower names — DONE + BROWSER-PROVEN 2026-08-05 (owner-reported).** One shared panel shape across all 15 toggles; borrower names resolved live; uniform flow with server totals only; "4 of 5" mislabelling fixed.
- [x] **J7: Member borrowing-power card — DONE + BOTH PATHS BROWSER-PROVEN 2026-08-05 (real login, live data).** 7th `.hero-stat` card on user dashboard; fed by `loans.eligibility`; button stays clickable when ineligible (UX call).
- [x] **J2-SLICE-3: Penalty display — DONE + LIVE-VERIFIED 2026-08-06 (computation level).** Member now sees penalty columns in arrears modal; A2 violation removed; derivation sentence fixed (ratePeriod in both branches).

---

## Cycle 127 — BUILT, AWAITING BROWSER VERIFICATION: owner-directed UI-only mobile pass (9 items)

Owner interrupted the J-group sequence on 2026-07-26 with a direct UI brief. All 9 items are code-complete and statically verified. Not browser-verified — no Chrome extension connected. What shipped: mobile bottom nav, manage_payments mobile table fixes, denser mobile grids, hero redesign, user-dashboard drawer root cause found and fixed, drawer z-order fixed, forced loans relocated, status/borrower dropdown consolidation. Cycle 126 dispatch brief stands unchanged for whoever picks it up next.

---

## Cycle 126 — DISPATCHED (NOT RUN — superseded this session by the owner's UI directive)

Brief stands as-is: J3 Slice 1 backend — additive opt-in period drill-down on payments.accountingSummary (four FLOW figures). Files: api/handlers/payments.php, api/index.php. COMPLEXITY: high. No route change. Drill response shape: `{figure, year, month?, periodTotal, rows}`. Period scoping: payments INT year + ENUM month; loans/loan_payments YEAR(approvedAt)+MONTH(approvedAt).

---

## Closed this session (cycles 114–125, one line each)

- **125 (J3 scout)** — mapped #accountingFiguresBlock/statCard, reusable admin_dashboard .stat-modal, per-figure period/row table. Resolved D1/D2/D3 decisions, cut Slice 1.
- **124 (J5 frontend read-swap)** — swapped three cycle-121 defects to server fields; fixed two same-class sites the scout missed inline; all modules parse clean module-mode.
- **123 (J5 backend slice)** — three additive server totals (totalOwed, pending, issuedPrincipal), no DDL, live-reconciled at computation level.
- **122 (accountingSummary penalty figures)** — live contribution + live loan accrual, both guarded RuntimeException→501; live-verified at computation level.
- **121 (ground-truth accounting scout)** — six settled-money fields reconcile byte-for-byte; confirmed penalty-accuracy gap and three client-side money-math defects.
- **120 (J2 Slice 1)** — admin-configurable penalty engine, loan + contribution, fixed|percentage x day|month; loan % on overdue (BL-6(a)), contribution % on full obligation (BL-6(b)).
- **119** — scout: live group_rules penalty schema + both groups' values; both type='fixed' so percentage ships behaviour-preserving; loanPenaltyRate reused.
- **118** — scout: J1 (member loan requests) already built and live; BL-4 premise stale; UX gap on loan_payments.html noted.
- **117** — hotfix: manage_payments blank page (duplicate emptyState); all 46 modules parse in module mode; JS gate now `node --input-type=module --check` everywhere.
- **116** — group_rules row self-heals on senior_admin path; QA PASS, live dry-run verified; no live group was actually broken.
- **115** — defined --bn-gray-50 + fixed 3 wrong-name token call sites; undefined-token bug class now zero across 76 files.
- **114** — defined 4 missing --bn-gray rungs; QA PASS, HTTP-verified.

---

## SUPERSEDED HANDOVER BLOCK (rotated out of BUILD_PLAN.md 2026-08-07)

Verbatim text of the 2026-08-05 "handing back to Cline" summary that headed BUILD_PLAN.md until the 2026-08-07 browser run. Kept whole; nothing removed.

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

## ROTATED FROM BUILD_PLAN.md 2026-08-07 — four closed cycles

### 2026-08-07 (fourth) — accounting audit, Money Masters rule coverage, uploads + exports. Owner-directed.

**ACCOUNTING — 20 identities checked against live data, ZERO failures.** Group level: contributions split == total; `contributed − disbursed + repayments + penaltiesCollected == cashPosition`; `collected + waived + outstanding == penaltiesCharged`; `overdue + notYetDue == outstanding`; `expected − collected == outstanding`; `sum(behind.owed) == outstanding`. Member level: `overdue + notYetDue == arrears`; `arrears + penalties == totalOwed`; seed+monthly+fee == contributed; `paid + arrears == totalAmount` on all 12 months and on seed. Per loan (all four): `principal + interest == totalRepayment` and `totalRepayment − repaid == remaining`. **Member→group roll-ups:** `sum(member penalties) == 258,200.00`, `sum(member overdue) == 135,000.00`, `sum(member arrears) == 184,900.00`, `sum(member totalOwed) == 443,100.00` — every one exact. `financial_reports` renders only server figures; zero console errors on every money page.
- **One residue, reported not hidden:** LN-0001 charged 58,166.66 and was repaid 58,166.64, leaving **MWK 0.02** — a rounding artefact in repayment allocation. It is what drives the "1 borrower to follow up · MWK 0.02 overdue" banner on manage_loans. Real, trivial, and the owner's call whether to write off.

**MONEY MASTERS RULES (PDF) — coverage checked; the gaps were about what could be SET, not what could be computed.** Already expressible: seed money + due date, 15% month-1/2/3 interest, MWK 5,000/day fixed loan penalty with grace, loan booking day (15th), last loan month (October), minimum membership months (no exit before 6), max active loans, collateral/guarantor/next-of-kin/photo fields, service fee.
- **FIXED — three obligation flags were readable but NOT writable.** `seedMoneyRequired`, `monthlyContributionRequired` and `serviceFeeRequired` are returned by `get_rules()` but `update_rules()` had no writer, so they were pinned to their schema defaults forever. A group that does not use seed money still carried a **required seed obligation of 0.00** — the shape that bars borrowing on "unpaid seed" and puts a meaningless line in every member's what-I-owe. Now settable; garbage rejected with 422.
- **FIXED — `cycleDurationMonths` was not writable either, so every group was pinned to 12 months.** Not cosmetic: `payment_cycle_months_to_date()` uses it to decide which months a group is owed for, so an **11-month constitution (Money Masters) could not be expressed at all**. Now settable, validated 1–60. `loanRulesRequireCollateral` likewise.
- **FIXED — group creation.** Seed money was the one `required` money field on the form; it is now optional, and leaving it at 0 sets `seedMoneyRequired: false` (same for monthly contributions; service fee is opt-in). Added a **Maximum Members** field — `groups.create` already accepted `maxMembers` but no form collected it, so a constitution capping membership (Money Masters caps at 30) had nowhere to record it. Penalties, service fee, contributions and loan limits were already optional.
- **STILL NOT COVERED (reported, not silently skipped):** loan term banded by amount (<500k → 2 months, >500k → 3 months — the app has one `loanInterestMaxRepaymentMonths`); guarantor capped at 2 members (fields exist, no enforcement); termination after 3 months of non-payment; and death rules (forfeit loan balance, pay principal + interest to next of kin). These are new features, not settings — flagged for the owner to prioritise.
- **⚠ PREMISE CORRECTION 2026-08-07 — this line previously also listed end-of-cycle share-out / dividend distribution as "not covered … a new feature". THAT WAS FALSE for the backend half, and it is the sixth false-premise entry on this project.** The share-out **backend has been live since commit 78e291a (2026-07-21)**: `cycle.equity`, `cycle.payout.preview` (GET, admin|senior_admin|treasurer) and `cycle.settle` (POST, **senior_admin only**, strict `confirm === true`) are routed at `api/index.php:113-116` and implemented in `api/handlers/cycle.php` (`cycle_compute_payout` :258, `cycle_equity` :379, `cycle_payout_preview` :590, `cycle_settle` :646). The `cycle_payouts` table exists in the live DB (19 columns, **0 rows — never settled**). What was genuinely missing is (a) **any UI at all** — grep confirms zero call sites under `pages/` or `scripts/` for `cycle.payout.preview` or `cycle.settle` — and (b) **a read endpoint for an already-settled share-out**, so settled rows are currently write-only and invisible forever. Both are now scoped as **deliverable K** (section 3) and dispatched this cycle.

**UPLOADS — work, and the security holds.** `files.upload` returns `{url,fileName,fileSize,mime}`; the URL serves the file back (200, `image/png`). Profile picture round-trips through `profile.update` and reads back identical. **A `.php` payload is rejected 422 even when disguised with an `image/png` mime type** — the server validates content, not the client's claim — and every upload is renamed to a random hash with an extension derived from the *validated* type, so a `shell.png.php` attempt lands on disk as `.png`, defused.

**EXPORTS — all five CSV routes work:** payments (62 rows), loans, members, report, statement. Correct `text/csv` content-type, dated filenames, real data, no JSON error leaking into a download. **Formula-injection guard verified: zero cells begin `=`, `+`, `-` or `@`.**

**TEST RESIDUE:** three 1×1 PNGs in `uploads/proofs/` from the upload probes. The QA admin's avatar was overwritten during the profile test and has been **restored to empty**; `serviceFeeRequired`, `cycleDurationMonths` and `loanRulesRequireCollateral` were flipped to prove the writers and **all restored to their original values**.

### 2026-08-07 (third) — "I cannot see the i button", and the Accounting Summary made decisive. Owner-directed.

**1. THE "i" TOGGLE WAS INVISIBLE ON SEVERAL PAGES — two separate causes, both fixed at the source.**
- **Clipped.** `.bn-info-toggle` was `top/right: -10px`, deliberately overhanging its card. Every host that sets `overflow: hidden` (`.hero-stat` and friends) simply **cut it away** — computed styles said visible and opaque, nothing was painted. Now positioned *inside* at 10px, so no host's overflow can ever clip it again.
- **Escaped.** `.page-stat` is `position: static`, so the absolutely-positioned toggle anchored to the nearest positioned ancestor instead: all four of manage_payments' toggles ended up **stacked on each other in the top-right corner of `.dashboard-content`, ~1300px from their cards**. `attachCardInfo()` now promotes a static host to `position: relative` when it attaches — fixing every host at once, including any card added later, rather than chasing card classes through stylesheets.
- Tap target raised to **44×44** via an invisible `::before` expander, keeping the 26px visual dot and changing no layout. Proven: manage_payments 9/9 and user_dashboard 7/7 inside their own card and individually hit-testable; admin dashboard 8/8.

**2. THE ACCOUNTING SUMMARY CONTRADICTED ITSELF — one figure, two answers.** It showed **MWK 204,900.00** outstanding in the banner, the tile and the follow-up total, and **MWK 184,900.00** in the compliance block and "Who owes what", in the same section.
- **Root cause:** the section re-summed the persisted `payments.arrears` column in the browser. That column carries obligations the group is not yet owed — it was picking up a **December** row in a cycle that has only reached August, and a duplicate seed-money line. Third appearance of this bug class.
- **The banner was the worst of it: `Math.max(serverFigure, clientSummedFigure)` and `Math.max(membersBehind, followups.length)`** — deliberately printing whichever number was *larger*, manufacturing a headline matching neither source.
- **Fixed by sourcing the whole section from `compliance.behind[]`, which reconciles BY CONSTRUCTION** (`sum(owed) === toDate.outstanding`). Proven live: five member rows summing to exactly **184,900.00**, matching the stated total.
- **Every amount now states what it is and its scope.** Tiles read `Collected · This month`, `Payments recorded · This month`, `Pending approval · now`, `Still owed · today`; category cards read `collected · this month`; follow-up rows read `MWK 65,000.00 owed` with `55,000.00 overdue · 10,000.00 not yet due` beneath, and a `LATE` badge only when the member actually is. Three of those tiles follow the period selector and two do not — nothing had said so.
- **Penalties were missing entirely.** Compliance carries no penalty figure, so the summary stated a receivable while omitting **MWK 258,200.00** of accrued charges. `payments.groupArrears` is now read alongside it and penalties are stated explicitly as *charged on top*.
- **The page's own Arrears headline was client-summed too** (204,900.00). It now reads the server's `totalArrears` — **393,200.00, identical to the Arrears tile on the admin dashboard**, so the same word means the same money on both screens.
- **The member list was rendered twice** in one section, same people, same amounts. The compliance block now points to the follow-up block, which owns it (it has the per-member split, expandable detail, penalties and Send reminders).
- **Category cards no longer invent a split.** Their per-category "owed" and "penalties" were browser subtotals coming to 204,900.00 and 252,600.00 against true 184,900.00 and 258,200.00 — contradicting the section in two directions. The server does not split the receivable by payment type, so rather than fabricate one the cards show *how many members still owe that category* (counted from the server's own `missing` list) and leave money to the one authoritative total.
- **`manage_loans`' summary got the same treatment** — every tile scoped in its label, and **Interest earned (MWK 21,450.00, the server's figure) added**: a loan accounting summary that omits what the lending actually earned is not a summary. Principal returning is the group's own money coming back, not income.

**Proven:** banner, tiles, categories, follow-up rows and per-member detail all trace to one server source and reconcile (135,000 + 49,900 = 184,900; 135,000 + 258,200 = 393,200). Zero console errors on manage_payments, manage_loans and admin_dashboard; all seven modules parse clean; CSS brace depth 0.

### 2026-08-07 (later) — INFO-PANEL AUDIT: every "i" panel made uniform, and given a second level. Owner-directed.

**Ask:** let an info-panel row give more when clicked if there is more to give (e.g. *which* members were collected from), and sweep every panel for uniformity and sufficiency.

**Component work (`card_info.js` + `design-system.css`) — the capability now exists once, for everyone:**
- `infoContent()` rows accept a richer object form `{label, value, detail, onClick, detailLabel}` alongside the original `[label, value]` pair, so **no existing call site had to change**. `detail` may be a string, a list, label/value pairs, a **function** (resolved on first expand only) or a **Promise** — which is what makes it safe for a row to fetch per-member figures from the server, and only when someone actually asks.
- `actions` (plural) added; `action` still supported.
- `.bn-info-row-detail` **had no CSS rule at all** — the one panel using it (the admin due-payment card) hand-rolled ~6 inline styles, which is precisely why the capability never spread. Now a real style, plus `.is-clickable` rows, a rotating chevron, and detail lines.
- The panel is positioned once at open; an expanding row changed its height and could push content off screen. Added `repositionInfoPanel()` (called on every expand) and `max-height: min(70vh, 520px)` + scroll.

**Defects found by auditing — all fixed, all browser-proven:**
1. **INVISIBLE TEXT.** `.hero-stat-popover-title` is `color: var(--bn-dark)` and the shared panel's background is `var(--bn-dark)` — **contrast ratio 1.0**. The line it hid on the member's Borrowing Power card was *"Why you cannot borrow right now"*, the one sentence that card exists to deliver. Fixed with panel-scoped overrides (specificity 0,2,0, so stylesheet order cannot undo it) covering every cloned popover, not just the card where it was spotted. Panel's worst contrast is now **16.55:1**. *Caught a second trap while fixing it: `--bn-danger-light` / `--bn-success-light` are translucent **background tints** (rgba, 0.12 alpha), not text colours — using them here would have swapped one invisible colour for another.*
2. **ALL FOUR "i" TOGGLES ON `user_analytics.html` NEVER RENDERED.** The page was redesigned onto `.hero-section` / `.hero-stat`, and the attach calls still looked for `.page-stat` / `.stat-card`; `closest()` matched nothing, so no toggle, no panel, **no error**. Two of the four target ids no longer exist either. Now attaches against a selector list covering every card shell the app uses.
3. **The member dashboard — the screen a member actually lives on — had the weakest panels in the app.** All seven cloned ad-hoc hidden markup: title only, **no description, no derivation rows, no action**, two rendering bare text. Six now have a server-backed spec (Arrears, Contributed, Loans, Pending, Next Payment, Group Members) with expandable detail and actions. Borrowing Power deliberately keeps its own renderer's panel — it already writes a full eligibility explanation, and a second copy would be two things to keep in step.
4. **A bare string was the whole panel body** on `manage_payments`' cycle-to-date row and on all four period tiles of both `manage_payments` and `manage_loans` — they opened as one unlabelled paragraph while every other "i" opened titled and itemised. Fixed at each page's tile builder, so every tile on those pages is covered including any added later.
5. **A fake row used as an action.** `manage_payments`' four stat tiles carried `["Click the card", "to see pending payments"]` as their only "derivation" — an instruction dressed as a figure. Replaced with real lazy rows plus a proper action button.
6. **Analytics' four headline tiles had a sentence and no rows.** They are attached before any group is chosen, so rows captured at attach time could only ever be empty. Now resolved at open: Cash Position spells out its formula and **reconciles live — 505,100.00 − 140,000.00 + 121,549.97 = 486,649.97**, which is also the clearest possible answer to why that tile is not "profit".

**"Members who have paid → who, exactly" — the owner's example, delivered.** Expanding it lists each member and their amount from `payments.memberBreakdown` (the same admin-gated server pass the stat modals use, cached per figure, never re-summed in the browser). Live: five members totalling **505,100.00**, matching the Verified-collections row above it.

**A2 HELD THROUGHOUT — deliberately.** Where a second level would have required adding money up in the browser, it does **counts and per-row server values instead**. `manage_payments`' `collected` tile already sums client-side (pre-existing); bucketing those same rows into per-type money subtotals would have created a second client total free to drift from the first. Recorded rather than quietly done.

**Proven:** admin dashboard 8/8 panels titled + described + expandable + actioned; manage_payments 9/9; manage_loans 8/8; analytics 4/4 reconciling; user_analytics live again; user_dashboard 6/7 structured (7th by design). Zero bare-text panels anywhere, zero console errors on every page, CSS brace depth 0, all seven touched modules parse clean.

### 2026-08-07 — FIRST AUTHENTICATED BROWSER RUN. The browser pass finally happened, and it found five real defects.

**A browser connected and a real login worked** (`qa.admin@banknkhonde.test`, owner-supplied password, QA Test Savings Group `cf4156a1…`). Every prior run recorded "no browser available"; this is the first cycle where rendered evidence exists. **Five defects were found that `php -l`, module-parse, diff review and DB reconciliation had all passed.** That is the standing argument for this step, now with receipts.

**FIXED + BROWSER-PROVEN (5):**
1. **Admin dashboard "Collections vs Arrears" donut showed 172,800.00 against a true 393,200.00** — on the same screen as the Arrears tile, which was right. Cause: it re-summed the persisted `payments.arrears` column over the trend range, in the browser. Arrears is DERIVED from `group_rules` (an obligation nobody recorded a row for has no row to sum), and range-scoping a *balance* invents a figure. **This is the third appearance of this exact bug class** (the arrears modal in J8-SLICE-2 and the 200,000.00 case before it). Now reads the same server figure as the tile. Proven: tile 393,200.00 == donut 393,200.00, Collections 505,000.00, identity 898,200.00 = 56%.
2. **Adjacent pie was labelled "Total Collections" while range-scoped** — 260.0K sitting beside the all-time 505,000.00 with nothing to explain the gap. Now "Collections in range"; the ranged pie stays ranged (it is a flow, which is the honest thing to scope).
3. **Mobile/tablet content was CLIPPED, not scrollable, at ≤1280px.** `.content-grid`'s `1fr` tracks carry an implicit `auto` minimum, so the Collection Trends chart forced a **466px track inside a 385px container**; `body{overflow-x:hidden}` then hid the overflow instead of letting it scroll. Collection Trends and Pending Approvals were both cut off. Fixed with `minmax(0, …)` + `min-width: 0` on grid items. Proven: 52 overflowing elements → 0, document scroll width 482 → 416, all four cards 385px. The only remaining wide content sits inside `.trend-bars-scroll`, which is the correct pattern.
4. **The member arrears modal used the word "Arrears" for two different numbers, 10,000.00 apart.** Header + table rows said 40,000.00 (overdue only); the reconciliation block said 50,000.00 (all outstanding) — so the list did not add up to its own total and the difference was never shown. Server already distinguishes these (`overdue` / `notYetDue` / `arrears`). Block is now **Overdue now 40,000.00 · Not yet due 10,000.00 · Late penalties 67,200.00 · Total owed 117,200.00**, and the header reads "Overdue Now". Proven: rows == header, and the four lines reconcile to the tile.
5. **Analytics headline tiles misdescribed their own figures — the most consequential find.** `applySummaryTilesFromServer` binds `totalContributed` / `totalDisbursed` / `cashPosition` / `interestEarned`, but the labels still read **Total Income / Total Expenses / NET PROFIT / Loan Interest**. The page told the group it had made **MWK 486,549.97 "Net Profit"** when that figure is the **cash in the box** — overwhelmingly the members' own capital, owed back to them. Real earnings are the interest tile: **18,216.66**. The tooltip contradicted the number too ("income minus loans disbursed" = 365,000.00 ≠ 486,549.97). Relabelled to **Total Contributed / Loans Disbursed / Cash Position / Interest Earned** — the vocabulary the drill cards on the same page already use — and all four tooltips rewritten. Ids unchanged.

---

## ROTATED FROM BUILD_PLAN.md 2026-08-07 — second pass (J11 + J13 blocks + other narrative)

### J11: Profile picture — PARTLY BUILT 2026-08-06, NOT BROWSER-PROVEN. One deliberate divergence, one part not attempted.

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

---

### J13 — ADMIN HALF NOW ACTS INSTEAD OF NAVIGATING. Built + browser-proven 2026-08-07.

**The scout's "real admin gap" is closed.** `appendStatModalActions()` was commented *"all navigate to a management page"* and `payments.record` / `repayments.record` appeared nowhere in the file — its header still said *"this is a READ/DISPLAY port"*. The admin can now run the whole collection loop on the dashboard: **see who owes → record their payment → approve or reject it**, without leaving the page.

- **Approve / Reject a pending payment inline.** Proven live both ways: Approve moved the Pending tile 1 → 0 and Collections MWK 0.00 → 100.00 with the row going `approved` server-side; Reject prompts for a reason (both endpoints 422 without one), stores it, zeroes the amount and banks nothing. Both re-read from the server afterwards rather than mutating local state, so the tiles and the list cannot drift apart. Buttons freeze during flight so a double-tap cannot file twice.
- **DECISION — a pending LOAN is deliberately still a navigation.** Approving one disburses the group's cash, and `manage_loans.html` owns the borrower-context review J6 added *because "approval was previously a single unconfirmed click"*. A one-click Approve here would have re-opened that hole on a second surface. **Money IN can be confirmed in place; money OUT keeps its review.**
- **Record a payment in place**, from any row of the Arrears modal. Obligations, their outstanding amounts, due dates and live penalties all come from `payments.obligations` under the admin `uid`-override — the browser derives nothing. Amount is pre-filled from the server figure but stays editable (standing decision: admins record partial and advance payments). Seed money is listed first, per the cycle order in §6. Filing creates a PENDING claim; approval stays a separate deliberate act.
- **Proven end to end:** recorded MWK 100.00 against QA Member Four's seed money → appeared as `pending` → rejected from the same page → group arrears returned to exactly **393,200.00**, matching the server. Mobile: all controls 47px tall, submit 44px, zero overflow in the modal.
- **MY OWN PREMISE WAS FALSE, caught by running it.** I coded the obligations reader against a `data.obligations{seedMoney, months}` wrapper. The endpoint actually returns `seedMoney` / `serviceFee` / `monthlyContributions.months` at the TOP level — no wrapper. The form rendered *"has nothing outstanding"* for a member owing MWK 200,000.00. **That is the fifth false-premise build on this project and the first one I authored; a static check would have passed it.** Shape is now documented in the code from a verified live response.

**TEST DATA LEFT LIVE (owner to delete):** three rows in the QA group tagged `[VERIFY - safe to delete]` — one **approved** MWK 100.00 August contribution for QA Admin (the only money actually banked this run), and two **rejected** rows at 0.00. Group arrears verified unchanged at 393,200.00.

### J13 — CLOSED 2026-08-07. Final three pieces built + browser-proven.

- **Group Health at a Glance (admin).** New card above the content grid: collection rate this month as a progress bar, members in good standing vs behind vs holding a balance, outstanding to date (with the not-yet-due portion split out), loans outstanding, cash position, interest earned, penalties outstanding, plus drill-through to the arrears list and full accounting. Two reads this page did not previously make (`payments.compliance`, `payments.accountingSummary`). **Every figure verified equal to the server**: 0% / 100.00 of 50,000.00, 4 behind of 5, outstanding 184,900.00, not-yet-due 49,900.00, loans 39,900.03, cash 486,649.97, interest 18,216.66, penalties 258,200.00. The bar is drawn from the server's own `percentCollected`, not from dividing collected by expected.
- **Loan repayment from the member dashboard.** The Loans hero card opened `loan_payments.html`; it now opens a repayment modal in place. Preset amounts and the next instalment come from `repayments.balance` — the same schedule and penalty `repayments.record` allocates against — so a preset can never be rejected by the endpoint it was built for and nothing is computed here. **Proof of payment is required**, matching every other member-initiated path (the server does not enforce it; the app's policy does, and a shortcut that dropped it would be a weaker route to the same endpoint). Proven: opens without navigating, offers **only the member's own loan** (group has 4 active, admin sees 1 — the `borrowerId` filter is what stops an admin being handed a member's loan), preset "Next instalment — MWK 10,700.00" pre-filled, due 2026-08-15; submitting without proof is blocked **and never reaches the server**; Escape closes it.
  - **A live `onclick="window.location.href='loan_payments.html'"` on the card beat the JS listener and navigated away regardless.** Removed — the behaviour was invisible to a diff review of the script alone.
- **My Standing — WAS ALREADY BUILT; the plan's "not started" was wrong.** `renderMyStanding()` existed and was wired at load; `#myStandingCard` starts `hidden`, which is why it read as missing. I began writing a second implementation and **the module-mode gate caught the duplicate identifier** — exactly the collision `node --check` cannot see (standing rule, section 6). My duplicate was removed and the existing card fixed instead:
  - **The eligibility badge was pinned to "Not eligible" for everyone.** It tested `summary.eligibleForLoan === 1`, and the obligations summary carries no such key (verified live: `'eligibleForLoan' in summary === false`). It read correctly only by coincidence when the member genuinely was ineligible; **a member who qualified was still told they did not.** Now reads `standing.eligibleForLoan`.
  - **It said "Not eligible" with no reason.** Now states why from the server's own flags — live: *"Why: seed money not fully paid."*
  - Its single "Arrears" line is split into **Overdue now / Not yet due**, matching the arrears modal, so the same word no longer names different figures on different surfaces.

**"Who owes what" was deliberately NOT built as a new section.** "Due Payments This Month" already carries per-member totals with a per-obligation breakdown in each card's info panel, and `renderWhatIOwe()` already exists on the member side. The missing half was the ability to *act*, which is what shipped. A parallel section would have duplicated live money figures in two places — the drift risk this plan has paid for repeatedly.

**J13 close-out state:** admin dashboard at 461px CSS — zero overflow, zero console errors; all new controls ≥44px.

**FOR OWNER REVIEW:** defect 5 changes what four headline tiles are *called* on the analytics page. The figures are untouched — only the labels and tooltips, which were describing numbers the tiles do not carry. Flagged because it materially changes what the page tells you about the group's money. J11's sidebar-avatar divergence (a link to settings rather than an upload control in the global nav) also remains an owner call, unchanged.

**J13 in-flight narrative (2026-08-06 scout + Slice 1) — SUPERSEDED by the two J13 blocks above, which closed it.** One line retained: the scout was right that most of the user-dashboard half already shipped and the real gap was the admin's inability to *act* from a stat modal; Slice 1 (Next Payment card actionable) built then, browser-proven later. Do not plan against the superseded text.

---

## J13 ORIGINAL SPECIFICATION (NEW CHECKLIST ITEMS, rotated 2026-08-07)

### J13: Dashboard overhaul — both admin and user dashboards become the command centre (owner-directed 2026-08-06)

**The problem:** The dashboards show summary cards but the user/admin has to navigate away to do anything. Paying a loan, recording a contribution, checking what you owe, seeing who's behind — all require leaving the dashboard. The owner wants the dashboards to be the single place where everything happens.

**What to build — USER DASHBOARD (`pages/user_dashboard.html` + `scripts/user_dashboard_sql.js`):**

1. **Pay-from-card modals on every hero stat.** Each hero card that represents money should open a modal where the member can act:
   - **Next Payment card** → opens a "Pay Now" modal pre-filled with the next due obligation (type, month, amount). Reuses the existing `openPaymentModal()` flow.
   - **Arrears card** → opens a modal listing every obligation the member is behind on, with a "Pay" button per row that opens the payment form pre-filled for that obligation.
   - **Loans card** → opens a modal listing active loans with "Make Payment" per loan, pre-filling the next instalment amount.
   - **Contributed card** → opens a modal showing contribution history with a "Record Payment" button.

2. **"What I owe" section.** A dedicated section below the hero that shows:
   - Total outstanding (arrears + penalties) with a "Pay All" button
   - Breakdown by type: Seed Money, Monthly Contributions (per month), Service Fee
   - Each row has a "Pay" button that opens the payment form pre-filled
   - Live penalty on each overdue obligation

3. **"My Standing" section.** A card showing:
   - Loan eligibility status (✅/❌ with reasons)
   - Active loans count and total balance
   - Contribution history summary (months paid vs missed)
   - Debt-to-contribution ratio
   - Next payment due date and amount

4. **Quick loan repayment.** The Loans card should have a "Make Payment" button that opens a modal with:
   - Active loan selector
   - Preset amounts (Next instalment, Pay off in full, Everything overdue, Penalty only)
   - Due dates on each preset
   - Proof of payment upload
   - Submit → `repayments.record`

**What to build — ADMIN DASHBOARD (`pages/admin_dashboard.html` + `scripts/admin_dashboard_sql.js`):**

1. **Action modals on every stat card.** Each card opens a modal with actions:
   - **Collections card** → opens a modal showing who paid what this month, with a "Record Payment" button that opens the record-payment form pre-selecting the member.
   - **Active Loans card** → opens a modal listing all active loans with per-loan "Record Repayment" buttons.
   - **Pending card** → opens the pending approvals list with inline Approve/Reject (reuses existing `openStatModal`).
   - **Arrears card** → opens a modal showing who owes what, ranked most-behind first, with per-member "Record Payment" and "Send Reminder" buttons.

2. **"Who owes what" section.** A dedicated section showing:
   - Summary total: "X members owe MWK Y"
   - Per-member breakdown with expandable detail (seed money first, then monthly contributions)
   - Per-member "Record Payment" button
   - "Send Reminders" bulk action

3. **Quick actions that actually work from the dashboard.** The existing Quick Actions grid should:
   - "Record Payment" → opens the record-payment modal (already wired)
   - "Record Loan Repayment" → opens the loan repayment modal (NEW)
   - "Approve Pending" → jumps to the pending section with inline approve/reject (NEW)
   - "Send Reminders" → opens the reminders modal (already wired)

4. **"Group Health at a Glance" section.** Below the stat cards, show:
   - Collection rate this month (progress bar)
   - Members in good standing vs behind
   - Total loans outstanding
   - Cash position
   - All figures clickable to drill into detail

**Files to edit:**
- `pages/user_dashboard.html` — add modals, "What I Owe" section, "My Standing" section
- `scripts/user_dashboard_sql.js` — wire card clicks to modals, build "What I Owe" and "My Standing" renderers
- `pages/admin_dashboard.html` — add modals, "Who Owes What" section, "Group Health" section
- `scripts/admin_dashboard_sql.js` — wire card clicks to modals, build "Who Owes What" and "Group Health" renderers

**Data already available (no new API calls needed):**
- User dashboard already loads: `payments.obligations`, `loans.list`, `payments.list`, `loans.eligibility`
- Admin dashboard already loads: `payments.list`, `loans.list`, `members.list`, `payments.groupArrears`, `payments.compliance`
- All payment/repayment recording endpoints already exist: `payments.record`, `repayments.record`
- All approval endpoints already exist: `payments.approve`, `repayments.approve`

**Acceptance:**
- Every hero stat card on both dashboards opens a modal with relevant actions.
- User can pay any obligation directly from the dashboard without navigating away.
- Admin can record payments, approve pending items, and send reminders from the dashboard.
- "What I Owe" / "Who Owes What" sections show complete, accurate breakdowns.
- All modals close on Escape, overlay click, or close button.
- No new API endpoints needed — reuse existing data and endpoints.
- `node --input-type=module --check` clean on all changed scripts.
- No innerHTML with user data.
- All money server-side, minor units. No client money math.
