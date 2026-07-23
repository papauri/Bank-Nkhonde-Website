---
name: build-loop
description: Autonomous build cycle for Bank Nkhonde — planner picks one task, a specialist builds it, ui-designer polishes UI work, qa-auditor gates it, then report. Use when the user says /build-loop, "keep building", "next task", or "continue the build".
---

# /build-loop — Bank Nkhonde

One cycle = **one objective**. **EVERY invocation of `/build-loop` is continuous by default — treat a bare `/build-loop` as identical to `/loop /build-loop`.** When a task passes QA or is parked as blocked, immediately pull the next objective from `BUILD_PLAN.md` and keep going — do **not** stop and wait for the user. The loop runs continuously through all remaining phases until Phase 3 (Polish) is fully complete or a true stop condition is hit (see "Maximum autonomy rails" below).

**The only way to request a single cycle is the explicit phrase "run one cycle only"** (or "one cycle only"). Absent that exact instruction, never stop after one objective — always continue to the next. Per-response tool-call caps are a batching boundary, not a stop: when capped, report the STATUS block and resume on the next turn.

## The cycle

**1. PLAN**
Spawn `build-planner`. It reads `.claude/BUILD_PLAN.md` + `.claude/SYSTEM_MAP.md` and returns ONE objective with dispatch brief(s).
- If `SYSTEM_MAP.md` is missing or stale for the target area, the planner returns a **scout** brief instead → spawn `codebase-scout` (haiku, one directory tree) → that is the whole cycle. Report and stop.
- If the objective is `BLOCKED`, the planner parks it and picks the next unblocked one. Never stall.

**2. BUILD**
Spawn `backend-specialist` and/or `frontend-specialist` with the planner's brief **verbatim** — exact paths, no paraphrasing that reintroduces vagueness.
- **Max 2 concurrent specialist spawns.** Never 3.
- Two specialists run in parallel **only** if their file lists are disjoint. Overlapping paths → run sequentially.

**3. POLISH** *(only if the change has UI surface)*
Spawn `ui-designer`, scoped to **exactly the files `frontend-specialist` just changed** — pass that list explicitly. Skip entirely for backend-only work.

**4. VERIFY**
Spawn `qa-auditor` on the diff only:
- `model: haiku` for the LINT pass (`php -l` for PHP, `node --check` for JS, stray `console.log`/`var_dump`).
- Default sonnet for the REVIEW pass (logic, security checklist, acceptance criteria).
- Run LINT first — if it fails, don't spend sonnet on REVIEW.

**5. RESOLVE**
- `PASS` → tick it in `BUILD_PLAN.md`, move it to Done.
- `FAIL` → hand the findings back to the same specialist **once**. Re-verify.
- Still failing after that one retry → mark `BLOCKED — <the qa finding>` in `BUILD_PLAN.md` and move on. **Never a third attempt.**

**6. REPORT**
Print the **STATUS block** (below), then a `/cost` checkpoint. Every cycle. Then go straight back to step 1 for the next objective in the same run — unless a true stop condition is hit.

## Reporting — functional, not technical
Report **what now works or what was fixed**, in plain product language. **No code, no file paths, no agent/tier/diff chatter** in the user-facing summary — those stay in `BUILD_PLAN.md`. The owner tracks *functionality*, not implementation: say "Members can now download their full account statement as Excel," not "added export_statement() to statement.php."

**STATUS block** — after every cycle:
```
STATUS
DONE   <the capability that now works / the bug that's fixed — 1 line, functional>
NOW    <the capability being built next, or "advancing">
NEXT   <up to 3 upcoming functional outcomes — what users will be able to do, not filenames>
NOTE   <any decision taken autonomously from real-world flow logic, or "none">
```

**SESSION SUMMARY** — once, when the run stops:
```
SESSION SUMMARY
SHIPPED   <functional capabilities delivered this run — what a user can now do / what got fixed>
VERIFIED  <what was confirmed working live vs. built-and-reviewed only>
REMAINING <functional outcomes still open>
NOTES     <assumptions taken autonomously; any hard stop that was hit>
```

## Maximum autonomy rails — run to full completion, no intervention needed

The owner has authorised **full autonomy to task completion**. Make product, behaviour, wording, and default-setting decisions yourself, grounded in **real-world village-banking flows** — how seed money, contributions, loans, interest, penalties, and payouts actually work in a savings group. Record the assumption under the task in `BUILD_PLAN.md` and keep going. Do **not** ask the owner to choose, confirm, or unblock unless it's a genuine hard stop below.

- **Never pause or end the loop just because a task finished.** Pull the next objective and continue — no waiting for input.
- After `qa-auditor` returns PASS, advance to the next item in the same run.
- **Decide, don't ask.** Ambiguity in behaviour/UX/wording/defaults → pick what a real savings group would expect, note it, proceed. This includes sensible money-rule *defaults* (e.g. one active loan at a time; arrears/penalties block a new loan by default) — implement the reasonable real-world default, record it, and expose it as a setting the owner can retune later; do not stall waiting to be told.
- **Stop the loop for ONLY these conditions:**
  0. **PROJECT COMPLETE — the terminal stop.** When EVERY deliverable in the `BUILD_PLAN.md` **PROJECT COMPLETE WHEN** checklist is marked `[x]`, **STOP the loop entirely — not pause.** Print a final **PROJECT COMPLETE** report summarising every checked deliverable, then HALT. **Do NOT search for additional work once the checklist is fully checked off.** Do not pull from FUTURE IDEAS. Do not invent polish. The checklist is the whole job; when it is done, the loop is done.
  1. A **hard blocker no reasonable assumption can resolve** — a required secret/credential you don't have, or an action that is BOTH irreversible AND destructive of real data. (Ordinary product/behaviour/money-rule *defaults* are NOT this — decide them from real-world flows and continue.) Park it; if nothing else is unblocked, stop.
  2. A **failed retry** — a task that failed QA twice.
  3. A **safety-rail hard stop** would be required to proceed (commit/push, destructive SQL, file/data deletion without sign-off).

**PROJECT COMPLETE report format** (printed once, only at condition 0):
```
PROJECT COMPLETE — Bank Nkhonde
DELIVERED   <every PROJECT COMPLETE WHEN item, tag + one line each>
NOT DONE    none — all deliverables [x]
FUTURE      <count> ideas logged out-of-scope (see BUILD_PLAN FUTURE IDEAS)
```
Every objective a cycle picks must trace to an UNCHECKED deliverable. If nothing unchecked remains and no blocker is open, the checklist is complete → condition 0.
- **Ambiguous ≠ blocked.** If a task is unclear but not a genuine user decision, make the most reasonable assumption, **write it under that task in `BUILD_PLAN.md`**, and continue. Only park a task when the answer is truly the user's to give (money rules, product behaviour, a credential, an irreversible delete).
- When the loop stops, always state **which** of the four conditions triggered it.

## Rails — every cycle, not negotiable

**Cost**
- Default **haiku** for anything read-only: scouting, lookups, lint, format. Escalate tier only when the planner's brief carries `COMPLEXITY: high` (auth boundaries, money/interest arithmetic, 4+ files).
- Run `/compact` after every **3 completed tasks**. Run `/clear` when switching **phase**.
- Every brief states exact file paths and line ranges. A brief saying "explore", "investigate", or "as needed" is malformed — send it back to the planner rather than spending a specialist on it.
- Never re-scan a directory the map already covers. The map exists so specialists don't re-read the repo.
- Print `/cost` after every full cycle.

**Safety** (these remain hard stops even under full autonomy)
- **Never `git commit`. Never `git push`.** Not even when a task looks finished. The human commits.
- **Never run destructive SQL** — no `DROP`/`TRUNCATE`, no unscoped `DELETE`/`UPDATE`, no unbounded batch writes. Additive, idempotent `ALTER … ADD COLUMN … DEFAULT` on the live DB (behaviour-preserving default), recorded in `BUILD_PLAN.md`, is allowed — that's how schema changes ship (no offline `.sql`).
- Never delete a file or real data without explicit human sign-off — park it as BLOCKED with a recommendation.
- Never weaken a server-side `require_role`/auth gate to make a feature pass — automatic qa FAIL.
- Never write a credential into a tracked file (secrets live in `.env`).
- Only a genuine hard blocker (missing credential, irreversible data loss) is marked **BLOCKED** with the exact question. **Everything else is decided from real-world flow logic, recorded, and continued** — do not wait, do not ask.

## Report format
The functional **STATUS block** above IS the per-cycle report — capability-level language only. Keep internal mechanics (agents, tiers, file paths, diffs, QA pass/fail plumbing) out of the user-facing text; they live in `BUILD_PLAN.md`. What the owner reads each cycle: what now works, what's next, and any assumption taken. End each cycle with `/cost`.
