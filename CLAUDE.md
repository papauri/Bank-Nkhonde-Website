# CLAUDE.md — Bank Nkhonde

> Project rules. The global `~/.claude/CLAUDE.md` still applies; this adds project detail.

## Default mode: `/build-loop`

This project runs an autonomous agent build system. **When asked to build, fix, continue, or "keep going" — invoke `/build-loop`** (`.claude/skills/build-loop/SKILL.md`). Do not free-hand edits across the repo; the loop exists to keep scope and cost bounded.

Session start: read `.claude/BUILD_PLAN.md` (what's next, what's blocked) and `.claude/SYSTEM_MAP.md` (what exists). Those two files are the source of truth — do **not** re-scan the repo to rebuild context that is already written down.

### The loop runs in continuous / maximum-autonomy mode
- **Do not stop between tasks.** When a task passes QA or is parked as blocked, immediately pull the next objective from `BUILD_PLAN.md` and continue in the same run — no waiting for user input.
- **Stop only for these four conditions:** (1) a blocked item needing the user's decision and no other unblocked task remains; (2) a task that failed QA twice; (3) a required action would violate a safety rail (commit/push, destructive SQL/Firestore, deletion without sign-off); (4) Phase 3 (Polish) is fully complete. Always say which condition stopped it.
- **Ambiguous ≠ blocked.** If unclear but not a genuine user decision, make the most reasonable assumption, record it under that task in `BUILD_PLAN.md`, and continue. Park only when the answer is truly the user's (money rules, product behaviour, a credential, an irreversible delete).
- **Report every cycle:** a `STATUS` block (finished / in-progress / next 3 / blocked-with-question) after each task, and a `SESSION SUMMARY` (completed this run / remaining by phase / blockers / one-line recommendation) at the end of the run. Full formats in the skill.

### Stack has pivoted: Firebase → PHP + MySQL (cycle 3)
Scaffold-first migration is underway. The SQL data layer exists (`database/migrations/001–003_*.sql`, `config/database.php`, `config/env.php`, `run_migrations.php`, `.env`). Firebase code is still live and untouched — it is removed only at the end, with human sign-off. The full data model is in `SYSTEM_MAP.md` → "Data model (for SQL migration)". Migration runner convention: `php run_migrations.php`.

## Stack — the givens

- **Static site.** Plain HTML in `pages/`, **vanilla ES modules** in `scripts/`, plain CSS in `styles/`. **No build step, no bundler, no package.json at root, no test framework.** A client-side npm package cannot be added — there is nothing to bundle it.
- **Firebase Web SDK v9.15.0, modular**, loaded from the gstatic CDN. Every Firebase symbol is re-exported from the single barrel `scripts/firebaseConfig.js` (`db`, `auth`, `storage`, `functions`, `doc`, `collection`, `onSnapshot`, `httpsCallable`, …). Page scripts import from the barrel — never from a gstatic URL, never call `initializeApp` twice.
- **Backend = `functions/index.js` only.** Cloud Functions, Node 18, **CommonJS**, `firebase-functions` v4, `firebase-admin` v12, nodemailer. Lints with `eslint-config-google` as a **predeploy hook** — a lint failure is a broken deploy.
- **Database = Firestore**, not SQL. `users/{uid}`, `groups/{groupId}`, `groups/{groupId}/members/{uid}` (holds `role`). Authorization is `firestore.rules`, with helpers `isSignedIn`, `isGroupAdmin`, `isSeniorAdmin`, `isGroupMember`. Roles: `admin`, `senior_admin`, member.
- `config.php` is a **vestigial leftover** — no PHP runtime is deployed. Treat as dead.
- Domain: village-banking savings groups — seed money, contributions, loans, interest, penalties. **This app moves real money.** Currency maths goes through `scripts/utils_financial.js`, never re-implemented.

## Known state (from the Phase-0 scan)

- **`firebase.json` hosting points at `frontend/`, which does not exist.** The app is at the repo root. Deploys are publishing nothing. This is BLOCKER-1.
- **`functions/index.js` has a hardcoded SMTP password** as a `functions.config()` fallback. BLOCKER-2 — the literal must come out, and the password must then be rotated by a human.
- Duplicate `_new` twins exist (`user_dashboard*`, `manage_members*`), and five overlapping nav scripts. See `BUILD_PLAN.md` Phase 2.

## The agents (`.claude/agents/`)

| Agent | Tier | Role |
|---|---|---|
| `codebase-scout` | haiku | Read-only. Maps ONE directory tree into `.claude/SYSTEM_MAP.md`. Never the whole repo at once. |
| `build-planner` | opus | Owns `BUILD_PLAN.md`. Picks ONE objective per cycle, writes exact-path dispatch briefs. **Never edits code.** |
| `backend-specialist` | sonnet | `functions/`, `firestore.rules`, `firestore.indexes.json`, named Firestore calls. |
| `frontend-specialist` | sonnet | `pages/`, `scripts/` — functional wiring only. |
| `ui-designer` | sonnet | Visual/responsive/a11y polish, scoped **only** to files `frontend-specialist` just touched. No behaviour changes. |
| `qa-auditor` | haiku (lint) / sonnet (review) | Read-only gate. **Diff only, never whole files.** Nothing is done until it PASSes. |

## Cost rails

- Default **haiku** for read-only, lint, and lookup work. Escalate tier only when the planner flags `COMPLEXITY: high` (security rules, money arithmetic, 4+ files).
- **Max 2 concurrent specialist spawns.** Parallel only when their file lists are disjoint.
- Every subagent brief states **exact file paths and line ranges**. A brief containing "explore" / "investigate" / "as needed" is malformed — reject it, don't spend a specialist on it.
- `/compact` after every 3 completed tasks. `/clear` when switching phase.
- Print `/cost` after every full loop cycle.
- Never re-read a file already in context; never re-scan a tree the map covers.

## Safety rails — hard stops

- **Never `git commit`. Never `git push`.** The human commits. No exceptions, not even on a finished task.
- **Never run destructive SQL or destructive Firestore ops** — no collection wipes, no bulk deletes, no unbounded batch writes.
- **Never delete a file** without explicit human sign-off — park it BLOCKED with a recommendation.
- **Never loosen `firestore.rules`** to make a feature pass — automatic QA failure. If a rule blocks you, it is working.
- **Never write a credential into a tracked file.** (The Firebase web config in `firebaseConfig.js` is public by design; nothing else is.)
- Every callable verifies `context.auth` and re-checks the caller's group role **server-side**. Client-side role checks are UX, never a gate.
- No `innerHTML` carrying user-authored or Firestore-sourced strings — `createElement` + `textContent`.
- Anything needing a human decision → mark **BLOCKED** in `BUILD_PLAN.md` with the exact question and move on. Never stall, never guess.

## Retry policy

Specialist fails QA → one retry with the findings. Still failing → mark BLOCKED and move on. **Never a third attempt.**
