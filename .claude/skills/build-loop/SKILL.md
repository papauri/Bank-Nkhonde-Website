---
name: build-loop
description: Autonomous build cycle for Bank Nkhonde — planner picks one task, a specialist builds it, ui-designer polishes UI work, qa-auditor reviews the diff, live-verifier proves it runs, then report. Use when the user says /build-loop, "keep building", "next task", or "continue the build".
---

# /build-loop — Bank Nkhonde

One cycle = **one objective**. **Every invocation is continuous by default — treat a bare `/build-loop` as identical to `/loop /build-loop`.** When a task passes or is parked as blocked, immediately pull the next objective from `BUILD_PLAN.md` and keep going — do **not** stop and wait for the user. The loop runs until the PROJECT COMPLETE checklist is fully `[x]` or a true stop condition fires.

**The only way to request a single cycle is the explicit phrase "run one cycle only".** Absent that, never stop after one objective. Per-response tool-call caps are a batching boundary, not a stop: when capped, print the STATUS block and resume next turn.

## The agents

| Agent | Tier | Owns |
|---|---|---|
| `build-planner` | opus | `BUILD_PLAN.md`. Picks the ONE objective, writes the briefs. Never edits code. |
| `codebase-scout` | haiku | Read-only ground truth on ONE surface → `SYSTEM_MAP.md`. |
| `backend-specialist` | sonnet | `api/**`, live MySQL + DDL. |
| `frontend-specialist` | sonnet | `pages/**`, `scripts/*_sql.js` — functional wiring. |
| `ui-designer` | sonnet | Visual polish, scoped to files frontend-specialist just touched. |
| `qa-auditor` | haiku (LINT) / sonnet (REVIEW) | Reviews the diff. Nothing is done until it PASSes. |
| `live-verifier` | sonnet | **Proves it works at runtime** — API, money reconciliation, auth boundary. |
| `doc-curator` | haiku | Plan/map hygiene: archive rotation, superseded markers. |

## The cycle

**1. PLAN**
Spawn `build-planner`. It reads `BUILD_PLAN.md` + `SYSTEM_MAP.md` and returns ONE objective with dispatch brief(s).
- If the map is missing or stale for the target area, the planner returns a **scout** brief instead → spawn `codebase-scout` → that is the whole cycle. Report and continue to the next cycle.
- If the objective is `BLOCKED`, the planner parks it and picks the next unblocked one. Never stall.

**2. BUILD**
Spawn `backend-specialist` and/or `frontend-specialist` with the planner's brief **verbatim** — exact paths, no paraphrasing that reintroduces vagueness.
- **Max 2 concurrent specialist spawns.** Never 3.
- Two specialists run in parallel **only** if their file lists are disjoint. Overlapping paths → sequential.

**3. POLISH** *(only if the change has UI surface)*
Spawn `ui-designer`, scoped to **exactly the files `frontend-specialist` just changed** — pass that list and the unstyled class hooks from its handoff. Skip entirely for backend-only work.

**4. REVIEW**
Spawn `qa-auditor` on the diff:
- `model: haiku` for the **LINT** pass (`php -l`; JS parsed **as a module** via `node --input-type=module --check < file.js` — plain `node --check` parses as CommonJS and misses import/local duplicate-identifier collisions that blank the page; stray `console.log`/`var_dump`).
- Default sonnet for the **REVIEW** pass (logic, security, money, acceptance).
- Run LINT first — a syntax error must never cost a sonnet review.

**5. VERIFY** *(the step the loop used to be missing)*
Spawn `live-verifier` with the brief's `VERIFY` block. It runs the thing: API calls through a cookie jar, read-only DB queries, money reconciliations, a real probe of the auth boundary.
- Skip only when the planner wrote `static only` with a reason (pure CSS, dead-code removal).
- **The browser pass is yours, not the verifier's** — the Chrome connection is session-scoped and doesn't reach a subagent. When the verifier returns `NEEDS BROWSER PASS`, or the change is visual/click-path, drive it here with the `claude-in-chrome` tools: load the page, exercise the path, check the console for errors, and look at it at 375px and 1440px. If no browser is connected, say so in the report — don't silently drop it.
- A `FAILED` from the verifier reopens the task exactly like a QA `FAIL`, with the same one-retry limit.

**Why this step exists:** the loop marked four surfaces DONE and QA-PASSED; the owner then found four real bugs on those exact surfaces by opening the app. A diff review cannot see a wrong number, an unreachable control, or a layout that overflows.

**6. RESOLVE**
- `PASS` + `VERIFIED` → tick it in `BUILD_PLAN.md`, collapse the cycle to one line under its deliverable, clear section 8.
- `FAIL` → hand the findings back to the **same specialist once**. Re-review and re-verify.
- Still failing after that one retry → mark `BLOCKED — <the finding>` and move on. **Never a third attempt.**
- A specialist reporting the **brief's premise was false** is evidence, not an excuse: send it back to the planner to rewrite rather than pushing the original through.

**7. REPORT**
Print the **STATUS block**, then `/cost`. Every cycle. Then go straight back to step 1.

**8. CURATE** *(every 5 completed cycles, or whenever a cap is breached)*
Spawn `doc-curator`. `BUILD_PLAN.md` must stay **under 400 lines / 60 KB** — it was allowed to reach 781 KB, past the Read tool's 256 KB limit, and the planner could no longer open the plan it owns. `SYSTEM_MAP.md` over 2,500 lines gets its superseded sections rotated.

## Reporting — functional, not technical
Report **what now works or what was fixed**, in plain product language. **No code, no file paths, no agent/tier/diff chatter** in the user-facing summary — those stay in `BUILD_PLAN.md`. The owner tracks *functionality*: say "Members can now download their full account statement as Excel," not "added export_statement() to statement.php."

**STATUS block** — after every cycle:
```
STATUS
DONE   <the capability that now works / the bug that's fixed — 1 line, functional>
NOW    <the capability being built next, or "advancing">
NEXT   <up to 3 upcoming functional outcomes — what users will be able to do>
PROVEN <what was confirmed working by actually running it, vs. built-and-reviewed only>
NOTE   <any decision taken autonomously from real-world flow logic, or "none">
```

**SESSION SUMMARY** — once, when the run stops:
```
SESSION SUMMARY
SHIPPED   <functional capabilities delivered this run>
VERIFIED  <what was confirmed working live vs. built-and-reviewed only>
REMAINING <functional outcomes still open>
NOTES     <assumptions taken autonomously; any hard stop that was hit>
```

`PROVEN`/`VERIFIED` must be honest. "Built and reviewed" is not "works" — that conflation is what produced the cycle-109 bug report.

## Maximum autonomy rails — run to completion, no intervention needed

The owner has authorised **full autonomy to task completion**. Make product, behaviour, wording, and default-setting decisions yourself, grounded in **real-world village-banking flows** — how seed money, contributions, loans, interest, penalties, and payouts actually work in a savings group. Record the assumption in `BUILD_PLAN.md` section 6 and keep going.

- **Never pause or end the loop just because a task finished.** Pull the next objective and continue.
- **Decide, don't ask — EXCEPT for critical changes.** Ambiguity in ordinary behaviour/UX/wording/defaults → pick what a real savings group would expect, record it, proceed. This includes sensible money-rule *defaults* (one active loan at a time; arrears/penalties block a new loan by default): implement the reasonable default, record it, expose it as a retunable setting.
- **Ask precisely for CRITICAL changes.** A change that materially alters how the app *behaves*, *looks*, or *moves money* — a major page/flow redesign, a change to a core money rule (not just its default), removing an existing capability, anything hard to reverse — is not decided silently. Pause and put **ONE precise question**: the exact change, the concrete options, your recommendation. Unsure whether it's critical? Lean toward the tight question.
- **Ambiguous ≠ blocked.** Only credentials and irreversible data loss are truly the owner's to unblock.

**Stop the loop for ONLY these conditions:**

0. **PROJECT COMPLETE — the terminal stop.** Every deliverable in `PROJECT COMPLETE WHEN` is `[x]`. **Stop entirely — not pause.** Print the PROJECT COMPLETE report and HALT. Do **not** search for additional work, do not pull from FUTURE IDEAS, do not invent polish. The checklist is the whole job.
1. **A hard blocker no reasonable assumption can resolve** — a required secret/credential you don't have, or an action both irreversible AND destructive of real data. Park it; if nothing else is unblocked, stop.
2. **A failed retry** — a task that failed QA or live verification twice.
3. **A safety-rail hard stop** would be required to proceed (commit/push, destructive SQL, file/data deletion without sign-off).

Always state **which** condition stopped the loop.

**PROJECT COMPLETE report** (printed once, only at condition 0):
```
PROJECT COMPLETE — Bank Nkhonde
DELIVERED   <every PROJECT COMPLETE WHEN item, tag + one line each>
PROVEN      <which deliverables were verified running, vs. built-and-reviewed only>
NOT DONE    none — all deliverables [x]
FUTURE      <count> ideas logged out-of-scope
```

## Rails — every cycle, not negotiable

**Cost**
- Default **haiku** for anything read-only: scouting, lint, lookup, curation. Escalate only when the brief carries `COMPLEXITY: high` (auth boundaries, money/interest arithmetic, 4+ files).
- `/compact` after every **3 completed tasks**. `/clear` when switching **phase**.
- Every brief states exact file paths and line ranges. A brief saying "explore", "investigate", or "as needed" is malformed — send it back to the planner rather than spending a specialist on it.
- Never re-scan a directory the map already covers. Never re-read a file already in context.
- Print `/cost` after every full cycle.

**Safety** (hard stops even under full autonomy)
- **Never `git commit`. Never `git push`.** Not even when a task looks finished. The human commits.
- **Never run destructive SQL** — no `DROP`/`TRUNCATE`, no unscoped `DELETE`/`UPDATE`, no unbounded batch writes. Additive, idempotent `ALTER … ADD COLUMN … DEFAULT` on the live DB (behaviour-preserving default), recorded in `BUILD_PLAN.md` section 5, is how schema changes ship — no offline `.sql`.
- Never delete a file or real data without explicit human sign-off — park it BLOCKED with a recommendation.
- Never weaken a server-side `require_role`/auth gate to make a feature pass — automatic QA FAIL. If a gate blocks you, it is working.
- Never write a credential into a tracked file (secrets live in `.env`).
- Test data written during verification is clearly prefixed `[VERIFY - safe to delete]` and reported, never cleaned up unilaterally.
