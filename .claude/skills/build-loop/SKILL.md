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
- `model: haiku` for the LINT pass (syntax, eslint on `functions/`, stray `console.log`).
- Default sonnet for the REVIEW pass (logic, security checklist, acceptance criteria).
- Run LINT first — if it fails, don't spend sonnet on REVIEW.

**5. RESOLVE**
- `PASS` → tick it in `BUILD_PLAN.md`, move it to Done.
- `FAIL` → hand the findings back to the same specialist **once**. Re-verify.
- Still failing after that one retry → mark `BLOCKED — <the qa finding>` in `BUILD_PLAN.md` and move on. **Never a third attempt.**

**6. REPORT**
Print the **STATUS block** (format below), then a `/cost` checkpoint. Every cycle, no exceptions. Then — unless a stop condition is hit — go straight back to step 1 for the next objective in the same run.

## Reporting — every cycle, no exceptions

**STATUS block** — print after every task completes or is parked as blocked:
```
STATUS
FINISHED   <the task just completed or parked — 1 line>
IN PROGRESS <the task now starting, or "none — advancing to next">
NEXT 3     1. <next objective from BUILD_PLAN.md, priority order>
           2. <…>
           3. <…>
BLOCKED    <each item awaiting the user's decision + the exact question needed> (or "none")
```

**SESSION SUMMARY** — print once at the end of the whole `/build-loop` run (when a stop condition halts it):
```
SESSION SUMMARY
COMPLETED  <tasks finished this run, as a list>
REMAINING  Phase 0: <n> · Phase 1: <n> · Phase 2: <n> · Phase 3: <n>
BLOCKERS   <every open blocker + its question>
RECOMMEND  <one line: what the user should tackle or decide next>
```

## Maximum autonomy rails — finish as much as possible without stopping

- **Never pause or end the loop just because a task finished.** Automatically pull the next task from `BUILD_PLAN.md` and continue — no waiting for user input between tasks.
- After `qa-auditor` returns PASS, **advance to the next queued item in the same run**. Never require a manual restart between tasks.
- **Stop the loop for ONLY these conditions:**
  0. **PROJECT COMPLETE — the terminal stop.** When EVERY deliverable in the `BUILD_PLAN.md` **PROJECT COMPLETE WHEN** checklist is marked `[x]`, **STOP the loop entirely — not pause.** Print a final **PROJECT COMPLETE** report summarising every checked deliverable, then HALT. **Do NOT search for additional work once the checklist is fully checked off.** Do not pull from FUTURE IDEAS. Do not invent polish. The checklist is the whole job; when it is done, the loop is done.
  1. A **blocked item requiring the user's decision** (park it, and if no other unblocked task remains, stop).
  2. A **failed retry** — a task that failed QA twice.
  3. A **safety-rail violation** would be required to proceed (commit/push, destructive SQL/Firestore, file deletion without sign-off).

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
- Default **haiku** for anything read-only: scouting, lookups, lint, format. Escalate tier only when the planner's brief carries `COMPLEXITY: high` (security rules, money arithmetic, 4+ files).
- Run `/compact` after every **3 completed tasks**. Run `/clear` when switching **phase**.
- Every brief states exact file paths and line ranges. A brief saying "explore", "investigate", or "as needed" is malformed — send it back to the planner rather than spending a specialist on it.
- Never re-scan a directory the map already covers. The map exists so specialists don't re-read the repo.
- Print `/cost` after every full cycle.

**Safety**
- **Never `git commit`. Never `git push`.** Not even when a task looks finished. The human commits.
- **Never run destructive SQL or destructive Firestore ops** — no collection wipes, no bulk deletes, no unbounded batch writes.
- Never delete a file without explicit human sign-off — park it as BLOCKED with a recommendation.
- Never loosen `firestore.rules` to make a feature pass — that is an automatic qa FAIL.
- Never write a credential into a tracked file.
- Anything needing a human decision → mark **BLOCKED** in `BUILD_PLAN.md` with the exact question, and move to the next task. Do not wait, do not guess.

## Report format

```
CYCLE     <n> · Phase <p>
OBJECTIVE <one line>
AGENTS    <who ran, at what tier>
CHANGED   <file paths>
QA        PASS | FAIL→retry→PASS | BLOCKED — <reason>
NEXT      <the next objective, or the blocking question>
```
Then `/cost`.
