# CLAUDE.md — Bank Nkhonde

> Project rules. The global `~/.claude/CLAUDE.md` still applies; this adds project detail.

## Default mode: `/build-loop`

This project runs an autonomous agent build system. **When asked to build, fix, continue, or "keep going" — invoke `/build-loop`** (`.claude/skills/build-loop/SKILL.md`). Do not free-hand edits across the repo; the loop exists to keep scope and cost bounded.

Session start: read `.claude/BUILD_PLAN.md` (what's next, what's blocked) and `.claude/SYSTEM_MAP.md` (what exists). Those two files are the source of truth — do **not** re-scan the repo to rebuild context that is already written down. Closed history lives in `.claude/archive/` — **grep it, never read it whole**; `BUILD_PLAN.md` itself stays under 400 lines / 60 KB (it once reached 781 KB, past the Read limit, and became unopenable by the planner that owns it).

### The loop runs in continuous / maximum-autonomy mode
- **Full autonomy to completion — no owner intervention.** Run continuously; pull the next objective and keep going. Decide product / behaviour / wording / default questions yourself from **real-world village-banking flows** (how seed money, contributions, loans, interest, penalties, payouts actually work), record the assumption in `BUILD_PLAN.md`, and proceed.
- **Stop only for:** (1) a genuine hard blocker no reasonable assumption can resolve — a missing credential/secret, or an irreversible + destructive data action; (2) a task that failed QA twice; (3) an action that would violate a safety rail (commit/push, destructive SQL, deletion without sign-off); (4) the PROJECT COMPLETE checklist fully `[x]`. Always say which one stopped it.
- **Ambiguous ≠ blocked.** Make the reasonable real-world assumption, record it, continue. Only credentials and irreversible data loss are truly the owner's to unblock — everything else you decide.
- **Ask precisely for CRITICAL changes.** Ordinary fixes/wording/layout/defaults are autonomous, but a change that materially alters how the app behaves, looks, or moves money — a major redesign/restructure of a page or flow, a change to a core money rule (not just its default), removing/replacing an existing capability, or anything hard to reverse — is confirmed FIRST with ONE precise question (the exact change + options + your recommendation), then built. Unsure if it's critical? Lean toward asking a tight question.
- **Report functionally every cycle:** a `STATUS` block (done / now / next / proven / note) in plain product language — what now works or was fixed — and a `SESSION SUMMARY` (shipped / verified / remaining / notes) at the end. **No code, file paths, or agent chatter in the summary.** Full formats in the skill.
- **"Built and reviewed" is not "works".** Every cycle with runtime surface ends at `live-verifier`, and anything visual or click-path-dependent gets a browser pass driven from the main session (the Chrome connection doesn't reach a subagent). Report what was actually *proven* separately from what was merely built — conflating the two is what let four real bugs reach the owner on surfaces the loop had marked done.

### Stack: PHP + MySQL (migrated off Firebase)
The live path is the **PHP API + MySQL**. Frontend pages load their `*_sql.js` modules, which call the action-routed API (`api/index.php?action=x.y` → `api/handlers/*.php`). Any Firebase files still in the tree are **legacy** — do not build on them. **Schema changes are applied DIRECTLY to the live MySQL DB** and the DDL recorded in `BUILD_PLAN.md` — keep **no** offline `.sql` migration files (owner rule). `config/database.php` (PDO) + `config/env.php` read creds from `.env`.

## Stack — the givens

- **No build step, no bundler, no root `package.json`, no test framework, no client npm.** Plain HTML in `pages/`, **vanilla ES modules** in `scripts/` (`*_sql.js` per page), plain CSS in `styles/`.
- **API = `api/index.php`** front controller: action-routed `?action=x.y` via a `ROUTES` map (`['GET'|'POST','handler']`) to handlers in `api/handlers/*.php`. JSON envelope via `api/lib/http.php` (`json_response`/`json_error`). The client calls it through `scripts/api.js` — `apiGet`/`apiPost` **unwrap** the envelope (return `data`); `downloadExport()` handles CSV/Excel downloads.
- **Auth = PHP sessions** (`api/lib/session.php`): `require_role($groupId, [roles])` returns the caller `{uid, role}` and is re-checked server-side on every callable. Roles: `member`, `admin`, `senior_admin`, `treasurer`. Cross-member reads use the admin-only `uid`-override pattern (`payments.php::my_obligations`).
- **Database = MySQL** (live cPanel), PDO from `config/database.php`. Tables: `users`, `groups`, `members`, `group_rules`, `loans`, `loan_payments`, `payments`, `penalty_settlements`, … Prepared statements always; back-tick reserved words (`groups`).
- **Money:** server-side **integer minor units** via `api/lib/money.php` (`money_to_minor` / `money_from_minor`, which returns a bare `"1000.00"` string — no `MWK`). Display via `scripts/utils_financial.js` `formatCurrency`. **Never floats, never client-side maths.** This app moves real money.
- Domain: village-banking savings groups — seed money, contributions, loans, interest, penalties.

## Known state

- The app runs on the PHP API + MySQL; earlier Firebase blockers (BLOCKER-1 hosting, BLOCKER-2 SMTP literal) belong to the retired stack — see `BUILD_PLAN.md` history.
- **`php -S` (local dev) is single-threaded** — rapid sequential requests cause transient 500s/empty bodies. The remote cPanel MySQL **throttles** connections after many rapid connects (`SQLSTATE[HY000] [2002]` timeout). Both are infra, not code — don't hammer, retry.
- Duplicate `_new` twins exist (`user_dashboard*`, `manage_members*`) — a page may load the `_new` variant; confirm the `<script type="module">` tag before editing. See `BUILD_PLAN.md`.
- **There is no `mysql` CLI on this machine.** Any DB read goes through PHP + `getDbConnection()` (`config/database.php:12`), which loads `.env` via `config/env.php`.
- **The `--bn-*` gray scale has holes.** `--bn-gray-200`, `-300`, `-500`, `-600` are *not defined* in `styles/design-system.css` (it defines `50/100/400/700/800/900` plus `--bn-gray`/`-light`/`-lighter`). An undefined custom property silently resolves to `currentcolor` — a visual bug invisible to code review. Six live occurrences are logged in `BUILD_PLAN.md` section 4.

## The agents (`.claude/agents/`)

| Agent | Tier | Role |
|---|---|---|
| `build-planner` | opus | Owns `BUILD_PLAN.md`. Picks ONE objective per cycle, writes exact-path dispatch briefs. **Never edits code.** |
| `codebase-scout` | haiku | Read-only. Maps ONE surface into `.claude/SYSTEM_MAP.md`. Never the whole repo at once. Every negative claim ("dead", "never called") must ship with the grep that proves it. |
| `backend-specialist` | sonnet | `api/index.php`, `api/handlers/*.php`, `api/lib/*.php`, live MySQL + DDL, named server calls. |
| `frontend-specialist` | sonnet | `pages/`, `scripts/*_sql.js` — functional wiring only (API via `scripts/api.js`). |
| `ui-designer` | sonnet | Visual/responsive/a11y polish, scoped **only** to files `frontend-specialist` just touched. No behaviour changes. Verifies every `--bn-*` token exists before using it. |
| `qa-auditor` | haiku (lint) / sonnet (review) | Read-only gate. **Diff only, never whole files.** Reviews correctness; never claims to have run anything. |
| `live-verifier` | sonnet | **Runs it.** API through a cookie jar, read-only DB queries, money reconciliations, a real probe of the auth boundary. Reports observed-vs-expected; never fixes. |
| `doc-curator` | haiku | Plan/map hygiene: archive rotation, superseded markers, the map's table of contents. Never decides what gets built. |

The pipeline is **plan → (scout) → build → polish → review → verify → curate**. `qa-auditor` answers "is this code correct?"; `live-verifier` answers "does it actually work?" — they are different questions, and this project has paid for confusing them.

## Cost rails

- Default **haiku** for read-only, lint, and lookup work. Escalate tier only when the planner flags `COMPLEXITY: high` (auth boundaries, money/interest arithmetic, 4+ files).
- **Max 2 concurrent specialist spawns.** Parallel only when their file lists are disjoint.
- Every subagent brief states **exact file paths and line ranges**. A brief containing "explore" / "investigate" / "as needed" is malformed — reject it, don't spend a specialist on it.
- `/compact` after every 3 completed tasks. `/clear` when switching phase.
- Print `/cost` after every full loop cycle.
- Never re-read a file already in context; never re-scan a tree the map covers.

## Safety rails — hard stops

- **Never `git commit`. Never `git push`.** The human commits. No exceptions, not even on a finished task.
- **Never run destructive SQL** — no `DROP`/`TRUNCATE`, no unscoped `DELETE`/`UPDATE`, no unbounded batch writes. Additive, idempotent `ALTER … ADD COLUMN … DEFAULT` applied to the live DB (behaviour-preserving default) is allowed and recorded in `BUILD_PLAN.md`.
- **Never delete a file** without explicit human sign-off — park it BLOCKED with a recommendation.
- **Never weaken a server-side `require_role` / auth gate** to make a feature pass — automatic QA failure. If a gate blocks you, it is working.
- **Never write a credential into a tracked file.** Secrets live in `.env` (gitignored) — DB creds, SMTP.
- Every callable verifies the session and re-checks the caller's group role **server-side** via `require_role`; cross-member reads use the admin-only `uid`-override. Client-side role checks are UX, never a gate.
- No `innerHTML` carrying user- or server-sourced strings — `createElement` + `textContent` (SVG via `createElementNS`).
- Anything needing a human decision → mark **BLOCKED** in `BUILD_PLAN.md` with the exact question and move on. Never stall, never guess.

## Retry policy

Specialist fails QA **or live verification** → one retry with the findings. Still failing → mark BLOCKED and move on. **Never a third attempt.**

A specialist reporting that the **brief's premise was false** (a column that already existed, an element that isn't there, an endpoint key that isn't returned) is evidence, not an excuse — send it back to the planner to rewrite rather than pushing the original brief through. Two scout misdiagnoses are on record; both were caught by re-reading live code, and the owner looking at the running app always outranks a stale audit.
