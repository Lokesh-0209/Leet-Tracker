# Leet Tracker

A single-user spaced-repetition web application for tracking, reviewing, and mastering solved LeetCode coding problems at Day 1, Day 3, and Day 7 intervals.

## Quick Start (Fresh Clone)

```bash
# 1. Clone repository
git clone <repository-url>
cd leet-tracker

# 2. Configure environment
cp .env.example .env

# 3. Install dependencies
npm install

# 4. Start full-stack development server (Express + Vite)
npm run dev

# 5. Run automated test suite
npm test
```

The application will be live at `http://localhost:3000`.

## Prerequisites & Node.js Engine
- **Node.js**: `>=22.13.0`
- Leet Tracker utilizes Node 22's built-in `node:sqlite` (`DatabaseSync`), enabled by default starting in Node.js v22.13.0. Node outputs an `ExperimentalWarning: SQLite is an experimental feature` at startup, which is normal and expected. All SQLite adapter logic is cleanly isolated in `src/db/sqliteDatabase.ts` through the `SqliteDatabasePort` interface so it can be swapped for `better-sqlite3` or any other SQLite driver without altering repository or domain logic.

## Persistence & Database Location
- **Database Path**: Configured via the `DATABASE_PATH` environment variable. Defaults to `./data/leet-tracker.db`.
- **Startup Resolution**: The server logs the absolute resolved database path on startup (`[Database] Initialized SQLite at resolved path: ...`) without leaking it in API responses.
- **In-Memory Testing**: All unit, repository, service, and API integration tests run against `:memory:` for ephemeral, isolated execution.

## Your Data and Backups

### Ephemeral Preview vs. Local Persistence
- **Cloud Preview Container**: In this containerized preview environment (Google Cloud Run / AI Studio preview), the container disk is **ephemeral**. When the preview service is rebuilt, redeployed, or undergoes a scale-to-zero cold restart, a fresh container instance is spawned and any data written to `./data/leet-tracker.db` is reset to an initial empty state.
- **Local Machine**: When running Leet Tracker locally on your own machine, files written to `./data/leet-tracker.db` persist permanently across restarts and reboots.

### Exporting and Restoring Backups
To safeguard your study history across container resets or transfer data to a local instance:
1. **Export**: Click the **Settings** gear icon in the top navigation bar, then click **Export Backup**. Your browser will immediately download a JSON snapshot named `leet-tracker-backup-YYYY-MM-DD.json`.
2. **Import**: On any fresh instance or after a preview reset, open **Settings**, click **Import Backup**, and select your saved backup JSON file.
3. **Atomic Replacement**: A confirmation modal will appear. Upon confirmation, the backend validates the file against the Version 1 schema and replaces all problems, notes (with all approach tabs), reviews, and settings within a single atomic database transaction. If the file is invalid or from an unsupported version, the transaction aborts and no data is modified.

## Scripts
- `npm run dev`: Runs the full-stack application (Express + Vite development middlewares) on port 3000.
- `npm run build`: Compiles the TypeScript and Vite frontend assets, then bundles `src/serverApp.ts` to `dist/server.mjs` via esbuild for production.
- `npm run start`: Launches the server in production mode.
- `npm test`: Runs the Vitest test suite across all domain, service, repository, API, and frontend tests.
- `npm run lint`: Validates TypeScript strict mode and syntax across the codebase (`tsc --noEmit`).

## API Routes & Specification

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health check endpoint returning `{ ok: true }`. |
| `GET` | `/api/problems` | Lists problems with optional `status`, `difficulty`, and query `q` filters. |
| `GET` | `/api/problems/deleted` | Lists soft-deleted problems for management and restoration in Settings. |
| `GET` | `/api/problems/:id` | Returns a single problem aggregate (problem, notes with approaches, and review schedule). |
| `POST` | `/api/problems/manual` | Manually adds a problem by LeetCode URL or slug (with difficulty fallback). Restores soft-deleted problems on re-add. |
| `POST` | `/api/problems/sync` | Syncs recent accepted submissions from public LeetCode profiles with bounded concurrency (3x). Displays manual Retry button on failure. |
| `GET` | `/api/reviews/today` | Returns due and overdue reviews for the client's current calendar day (using `X-Timezone`). |
| `POST` | `/api/problems/:id/note` | Saves problem notes. For `INBOX` problems, passes enrollment complexity gate to transition `INBOX -> ACTIVE` and create Day 1, 3, 7 review rows. |
| `POST` | `/api/problems/:id/reviews/:stage/complete` | Completes review stage 1, 2, or 3. Enforces strict in-order completion. Completing stage 3 transitions problem to `FULLY_SOLVED`. |
| `POST` | `/api/problems/:id/reviews/:stage/undo` | Undoes the most recently completed review stage. Undoing stage 3 transitions problem back to `ACTIVE`. |
| `DELETE` | `/api/problems/:id` | Soft-deletes a problem (sets `deleted_at`). Sync will never recreate soft-deleted problems. |
| `POST` | `/api/problems/:id/restore` | Restores a soft-deleted problem to its previous status (`INBOX`, `ACTIVE`, or `FULLY_SOLVED`). |
| `DELETE` | `/api/problems/:id/permanent` | Permanently deletes a problem and cascades deletion to notes and reviews. |
| `GET` | `/api/settings/username` | Retrieves saved LeetCode username. |
| `PUT` | `/api/settings/username` | Updates saved LeetCode username. |
| `GET` | `/api/backup` | Exports complete database snapshot as a Version 1 backup JSON object. |
| `POST` | `/api/backup/restore` | Atomically replaces database contents with validated backup JSON. |

## API Error Mapping & Contract

The central error middleware maps domain `AppError` subclasses to standard HTTP status codes and responds with the strict `{ code, message, retryable, details? }` JSON contract:

| Error Code | HTTP Status | Description | Retryable |
| :--- | :--- | :--- | :--- |
| `VALIDATION_ERROR` | `400 Bad Request` | Invalid request inputs, non-LeetCode URLs, duplicate manual additions, note enrollment gate failures (missing Approach 1 complexity), or invalid backup schemas | `false` |
| `NOT_FOUND` | `404 Not Found` | Requested problem, review stage, or resource not found | `false` |
| `ILLEGAL_TRANSITION` | `409 Conflict` | Illegal state transitions (out-of-order reviews, attempting stage 2 before stage 1, or invalid undo attempts) | `false` |
| `INVALID_USERNAME` | `422 Unprocessable Entity` | Non-existent or unrecognized LeetCode username | `false` |
| `PRIVATE_OR_EMPTY_PROFILE` | `422 Unprocessable Entity` | User profile is private or has 0 accepted submissions | `false` |
| `RATE_LIMITED` | `429 Too Many Requests` | LeetCode upstream rate limit encountered | `true` |
| `NETWORK_ERROR` | `502 Bad Gateway` | Network dropouts, connection timeouts, or upstream outages | `true` |
| `UPSTREAM_SCHEMA_CHANGED` | `502 Bad Gateway` | Unofficial LeetCode GraphQL response shape altered or invalid | `false` |
| `INTERNAL_SERVER_ERROR` | `500 Internal Error` | Unexpected server errors (stack traces never leaked to client) | `false` |

## Core Architecture & Features

### 1. Spaced Repetition State Machine
- **Stages**: Day 1 (+1 calendar day), Day 2 (+3 calendar days), Day 3 (+7 calendar days) anchored to problem enrollment date.
- **Statuses**: `INBOX` -> `ACTIVE` -> `FULLY_SOLVED` (with soft delete `deleted_at`).
- **Ordering**: Review Stage 2 requires Stage 1 completion; Stage 3 requires Stage 2 completion.
- **Undo**: Only the most recently completed stage can be undone; undoing Stage 3 moves the problem from `FULLY_SOLVED` back to `ACTIVE`.

### 2. Timezone Resolution
- The client detects user local time zone via `Intl.DateTimeFormat().resolvedOptions().timeZone` and transmits it in the `X-Timezone` header on all API calls.
- Validated server-side against IANA canonical zones via `Intl.DateTimeFormat`. Falls back to server runtime zone if omitted or invalid.
- Prevents day-shifting near midnight boundaries.

### 3. Collapsible Inbox Grouped by Solved Date
- The Inbox groups all incoming problems by local calendar day of `solvedAt`.
- Headings: `"Solved today"`, `"Yesterday"`, or formatted date (e.g. `"Oct 15, 2026"`).
- Problem counts displayed next to each heading badge.
- Fully collapsible with toggle state preserved.
- Uses a pure, deterministic domain function (`groupProblemsBySolvedDate`) with zero grouping logic inside React components.

### 4. Tabbed Notes Component
- Panel header with "+ Add approach" button and problem metadata.
- Approaches are presented as tabs (`Approach 1`, `Approach 2`, ...). Adding an approach transitions in-place with smooth 150-200ms motion (respecting `prefers-reduced-motion`).
- Tabs are renameable and can be deleted (protected: last tab cannot be deleted).
- **View Mode** (default when opening existing notes): renders React nodes with **ONLY** the words `"Time Complexity"` and `"Space Complexity"` rendered at 32px bold via `--complexity-label-size: 32px`. User-typed content remains normal font size.
- **Edit Mode**: highlight layer behind a transparent textarea with identical font metrics and scroll sync highlights the 5 template labels (`Your approach:`, `Actual approach:`, `Mistakes:`, `Time Complexity:`, `Space Complexity:`) in amber bold while preserving plain-text storage.
- **Enrollment Gate**: saving notes for an `INBOX` problem requires non-empty Time and Space complexity in Approach 1 to transition `INBOX -> ACTIVE`. Clear inline errors are presented on gate failure.
- **Safety**: Unsaved changes indicator and discard confirmation prompt on closing.

## Known Limitations
1. **Recent Submissions Window**: The LeetCode public profile GraphQL query returns only the most recent window of ~20 accepted submissions (`recentAcSubmissionList`). Problems solved earlier that have scrolled out of this window cannot be retrieved via sync; they can be added manually via the URL/slug input.
2. **Unofficial LeetCode API Endpoint**: LeetCode does not offer a documented public API. Synchronization relies on the public GraphQL endpoint (`https://leetcode.com/graphql`). Any upstream changes to query schemas or Cloudflare challenges are mitigated via timeout, error classification (`UPSTREAM_SCHEMA_CHANGED`, `RATE_LIMITED`, `NETWORK_ERROR`), and a manual Retry button on the UI banner.
3. **SQLite Local Disk Persistence in Ephemeral Containers**: SQLite stores data locally on disk at `DATABASE_PATH`. In serverless ephemeral environments where instances scale to zero and disk state is wiped, backups can be exported and imported with one click via the Settings dialog.

## Specification Compliance Matrix

| Requirement | Description | Implementation File(s) | Test File(s) | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Ingestion (Manual & Sync)** | URL/slug parsing, title & difficulty fetching, fallback modal, recent accepted submission sync with bounded concurrency (3x). Manual Retry button on banner. | `src/services/leetcode/urlParser.ts`<br>`src/services/leetcode/leetcodeProblemSource.ts`<br>`src/services/leetcode/leetcodeGql.ts`<br>`src/services/problemService.ts`<br>`src/frontend/components/ManualAddModal.tsx`<br>`src/frontend/components/SyncBanner.tsx` | `src/services/__tests__/services.test.ts`<br>`src/api/__tests__/api.test.ts` | **Met** |
| **Scheduling (D1/D3/D7 & Overdue)** | Anchor reviews to enrollment date (`+1`, `+3`, `+7` calendar days). Due on target date; overdue if target date `< today`. | `src/domain/scheduler.ts`<br>`src/domain/dateMath.ts` | `src/domain/__tests__/scheduler_statemachine.test.ts` | **Met** |
| **State Machine & Undo** | `INBOX` -> `ACTIVE` -> `FULLY_SOLVED`. Strict stage ordering (1 then 2 then 3). Undo reverses last stage, undoing D3 reverts to `ACTIVE`. | `src/domain/stateMachine.ts`<br>`src/services/problemService.ts` | `src/domain/__tests__/scheduler_statemachine.test.ts`<br>`src/services/__tests__/services.test.ts` | **Met** |
| **Enrollment Gate** | Saving notes on `INBOX` requires non-empty Time & Space complexity in Approach 1 before activating and scheduling reviews. | `src/domain/schemas.ts`<br>`src/services/problemService.ts`<br>`src/frontend/components/NoteModal.tsx` | `src/domain/__tests__/domain.test.ts`<br>`src/services/__tests__/services.test.ts`<br>`src/frontend/__tests__/frontend.test.tsx` | **Met** |
| **Soft Delete & Restore** | Problems can be soft-deleted (`deleted_at`). Sync never resurrects deleted problems. Restorable via Settings modal or re-adding URL. | `src/repositories/sqliteProblemRepository.ts`<br>`src/services/problemService.ts`<br>`src/frontend/components/SettingsModal.tsx` | `src/repositories/__tests__/sqliteProblemRepository.test.ts`<br>`src/services/__tests__/services.test.ts`<br>`src/__tests__/e2e_integration.test.ts` | **Met** |
| **Sync & Typed Errors** | Specific errors (`VALIDATION_ERROR`, `NOT_FOUND`, `ILLEGAL_TRANSITION`, `INVALID_USERNAME`, `PRIVATE_OR_EMPTY_PROFILE`, `RATE_LIMITED`, `NETWORK_ERROR`, `UPSTREAM_SCHEMA_CHANGED`) mapped to exact HTTP status codes with `{ code, message, retryable }`. | `src/domain/errors.ts`<br>`src/api/errorMiddleware.ts`<br>`src/api/routes.ts` | `src/api/__tests__/api.test.ts` | **Met** |
| **Notes Tabs & 32px Labels** | Approach tabs with add/rename/delete (last protected). View mode renders ONLY "Time Complexity" and "Space Complexity" words at 32px bold via `--complexity-label-size: 32px`. Edit mode highlights all 5 labels via synchronized highlight backdrop. | `src/frontend/components/NoteModal.tsx`<br>`src/index.css`<br>`src/domain/constants.ts` | `src/frontend/__tests__/frontend.test.tsx` | **Met** |
| **Inbox Solved Date Grouping** | Collapsible Inbox groups ordered newest first ("Solved today", "Yesterday", "MMM D, YYYY"). Pure domain grouping function with counts. | `src/domain/grouping.ts`<br>`src/frontend/components/InboxGroupedList.tsx` | `src/domain/__tests__/domain.test.ts`<br>`src/frontend/__tests__/frontend.test.tsx` | **Met** |
| **Dashboard Tabs** | 4 filter tabs: Inbox, Today's Reviews, All Active, Fully Solved. Clean badge counts and responsive layout. | `src/App.tsx`<br>`src/frontend/components/Tabs.tsx`<br>`src/frontend/components/ProblemCard.tsx` | `src/frontend/__tests__/frontend.test.tsx` | **Met** |
| **App Logo** | Custom vector SVG logo with 3 rising gradient bars, diagonal checkmark trajectory, and top-right green arrow. Displayed at 36px in Navbar and configured as favicon. | `public/logo.svg`<br>`src/frontend/components/Navbar.tsx`<br>`index.html`<br>`metadata.json` | `src/frontend/__tests__/frontend.test.tsx` (Navbar renders img with alt and src, public/logo.svg exists and non-empty, index.html contains icon link) | **Met** |
| **Backup Export & Import** | Full export (`leet-tracker-backup-YYYY-MM-DD.json`) and import via Settings modal or API. Version 1 Zod validation, atomic transaction replacement, rollback on error. | `src/services/backupService.ts`<br>`src/api/routes.ts`<br>`src/frontend/components/SettingsModal.tsx`<br>`src/frontend/apiClient.ts` | `src/services/__tests__/backup.test.ts`<br>`src/api/__tests__/api.test.ts` | **Met** |
| **Timezone Handling** | Browser client detects IANA zone and sends `X-Timezone` header. Validated server-side; all calendar day math respects client local day boundaries. | `src/domain/clock.ts`<br>`src/domain/dateMath.ts`<br>`src/frontend/hooks/useProblems.ts`<br>`src/api/routes.ts` | `src/domain/__tests__/domain.test.ts`<br>`src/api/__tests__/api.test.ts` | **Met** |
<p align="center">
  <img src="public/logo.svg" alt="Leet Tracker logo" width="96">
</p>

<h1 align="center">Leet Tracker</h1>

<p align="center">
  A self-hosted spaced-repetition tracker for solved LeetCode problems.<br>
  Sync what you solved, write notes, then review each problem on day 1, day 3 and day 7 until it sticks.
</p>

<p align="center">
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D22.13-339933?logo=nodedotjs&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black">
</p>

<!--
  Add 2-3 screenshots here (Inbox, Today's Reviews, Notes) before publishing:
  <p align="center"><img src="docs/inbox.png" width="800" alt="Inbox grouped by solved date"></p>
-->

## Features

- **LeetCode sync**: enter your username and pull your recent accepted submissions into an Inbox, grouped by the day you solved them (Solved today, Yesterday, then dated groups).
- **Manual add**: paste a problem URL or slug. It works even when LeetCode is unreachable.
- **Spaced repetition**: once you save notes, a problem is enrolled and gets three review dates: +1, +3 and +7 days. Enrolled on Oct 1, reviews are due Oct 2, Oct 4 and Oct 8.
- **Review queue**: check off each stage. Overdue reviews stay completable and never shift later dates. Stages must be completed in order, and the last completed stage can be undone.
- **Multi-approach notes**: one note per problem, with a tab for each approach (add, rename, delete). Every approach starts from a template: *Your approach, Actual approach, Mistakes, Time Complexity, Space Complexity*. In view mode the two complexity labels render in bold at 32px.
- **Lifecycle**: Inbox, then Active, then Fully Solved after the third review. Deleting is a soft delete with restore, and a sync never brings a deleted problem back.
- **Backup and restore**: export everything to a JSON file and import it back atomically.

## How it works

1. **Sync** from LeetCode (or add a problem manually). New problems land in the **Inbox**.
2. **Write notes.** Approach 1 needs both a Time Complexity and a Space Complexity value. Saving enrolls the problem and creates its three reviews.
3. **Review** on days +1, +3 and +7 from the **Today's Reviews** tab.
4. After the third review the problem moves to **Fully Solved**.

## Quick start

Requires **Node.js 22.13 or newer** (it uses the built-in `node:sqlite`).

```bash
git clone https://github.com/Lokesh-0209/leet-tracker.git
cd leet-tracker
npm install
npm run dev
```

Open <http://localhost:3000>, go to **Settings**, enter your LeetCode username, then click **Sync from LeetCode**.

Node prints an `ExperimentalWarning: SQLite is an experimental feature` at startup. This is expected.

### Configuration

No configuration is required. One optional environment variable is read from the process environment:

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `DATABASE_PATH` | `./data/leet-tracker.db` | Location of the SQLite file |

```bash
# macOS / Linux
DATABASE_PATH=./data/my.db npm run dev
```

```powershell
# Windows PowerShell
$env:DATABASE_PATH="./data/my.db"; npm run dev
```

## Your data and backups

All data lives in a single SQLite file (by default `./data/leet-tracker.db`, which is git-ignored). Keep that folder, and it survives restarts.

On hosts with an **ephemeral disk** (some cloud previews and serverless platforms), the file is wiped on rebuild or restart. Use a persistent volume, or back up regularly:

- **Export**: Settings, then **Export Backup**, downloads `leet-tracker-backup-YYYY-MM-DD.json`. It includes all problems, notes with every approach, reviews, soft-deleted problems and your username.
- **Import**: Settings, then **Import Backup**. After confirmation, the file is validated against the version 1 schema and **replaces** all data in one transaction. An invalid file changes nothing.

## Scripts

| Command | What it does |
| :--- | :--- |
| `npm run dev` | Express API and Vite dev middleware on port 3000 |
| `npm run build` | Builds the client with Vite and bundles the server to `dist/server.mjs` with esbuild |
| `npm test` | Runs the Vitest suite |
| `npm run lint` | Type-checks the whole project (`tsc --noEmit`, strict mode) |

## Tech stack

React 19, Vite, Tailwind CSS 4, TypeScript (strict), Express, `node:sqlite`, Zod, Vitest, Testing Library, esbuild.

## Architecture

Layered, with dependencies pointing inward. The domain layer imports nothing from the layers around it.

```
src/
  domain/        Pure rules: scheduler, state machine, date math, inbox grouping, Zod schemas, typed errors, Clock
  db/            node:sqlite adapter (behind a port) and schema / migrations
  repositories/  Persistence interfaces and the SQLite implementation
  services/      Use cases: sync, manual add, notes and reviews, backup; LeetCode source adapter
  api/           Express app, routes, error and timezone middleware
  frontend/      React UI: components, hooks, typed API client
server.ts        Entry point
src/serverApp.ts Composition root (wires everything together)
```

Design decisions worth knowing:

- **Pure scheduling.** Due dates are calendar-day strings (`YYYY-MM-DD`) computed with calendar arithmetic, not 24-hour offsets, so month ends, leap years and DST changes are correct. "Today" comes from an injectable `Clock`.
- **Time zones.** The browser sends its IANA zone in an `X-Timezone` header. The server validates it and uses it for "today", overdue checks, enrollment dates and Inbox grouping.
- **Pluggable sources.** LeetCode access sits behind a `ProblemSource` interface, and all LeetCode queries and response schemas live in one file. Adding another platform means adding an adapter.
- **Atomic writes.** Enrollment, sync and backup restore each run in a single transaction, so a failure leaves nothing half-written.
- **Typed errors.** Every error reaches the client as `{ code, message, retryable }`.

## API

All routes are under `/api`. Errors use the contract `{ code, message, retryable, details? }`.

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/health` | Health check |
| `GET` | `/problems` | List problems (`status`, `difficulty`, `q` filters) |
| `GET` | `/problems/deleted` | List soft-deleted problems |
| `GET` | `/problems/:id` | One problem with its note and reviews |
| `POST` | `/problems/manual` | Add by URL or slug (restores a soft-deleted match) |
| `POST` | `/problems/sync` | Sync recent accepted submissions |
| `POST` | `/problems/:id/note` | Save notes (enrolls an Inbox problem when the gate passes) |
| `POST` | `/problems/:id/reviews/:stage/complete` | Complete review stage 1, 2 or 3 |
| `POST` | `/problems/:id/reviews/:stage/undo` | Undo the latest completed stage |
| `DELETE` | `/problems/:id` | Soft delete |
| `POST` | `/problems/:id/restore` | Restore a soft-deleted problem |
| `DELETE` | `/problems/:id/permanent` | Permanently delete, including notes and reviews |
| `GET` | `/reviews/today` | Due and overdue reviews for the client's day |
| `GET` / `PUT` | `/settings/username` | Read or set the LeetCode username |
| `GET` | `/backup` | Export a version 1 backup |
| `POST` | `/backup/restore` | Replace all data from a backup |

| Error code | HTTP | Retryable | Meaning |
| :--- | :--- | :--- | :--- |
| `VALIDATION_ERROR` | 400 | no | Bad input, non-LeetCode URL, duplicate add, failed notes gate, invalid backup |
| `NOT_FOUND` | 404 | no | Unknown problem or resource |
| `ILLEGAL_TRANSITION` | 409 | no | Out-of-order review, invalid undo |
| `INVALID_USERNAME` | 422 | no | LeetCode user not found |
| `PRIVATE_OR_EMPTY_PROFILE` | 422 | no | Private profile or no accepted submissions |
| `RATE_LIMITED` | 429 | yes | LeetCode rate limit |
| `NETWORK_ERROR` | 502 | yes | Timeout or network failure |
| `UPSTREAM_SCHEMA_CHANGED` | 502 | no | LeetCode response shape changed |
| `INTERNAL_SERVER_ERROR` | 500 | no | Unexpected error (no stack trace is sent to the client) |

## Testing

```bash
npm test
```

The suite covers the following layers: date math and the state machine (month and year ends, leap days, DST, out-of-order and early reviews, undo), the notes gate, repository constraints and transaction rollback, sync error mapping with a fake source, backup round-trips, every API error status, the notes and Inbox UI, and one end-to-end lifecycle test from manual add to Fully Solved, undo, delete and restore. No test touches the real LeetCode API.

## Known limitations

- **Recent window only.** LeetCode's public query returns only your most recent accepted submissions (about 20), so older problems must be added manually.
- **Unofficial endpoint.** LeetCode has no public API. Sync uses its public GraphQL endpoint, which can change or be rate-limited without notice. Failures are reported as typed errors with a Retry button, and manual add keeps working.
- **No authentication.** This is a single-user app for local use. The server listens on all network interfaces, so don't expose it to an untrusted network.
- **SQLite on ephemeral disks.** See [Your data and backups](#your-data-and-backups).

## Roadmap

- Additional problem sources: Codeforces and GeeksforGeeks (the `ProblemSource` interface is designed for this).

## Disclaimer

Leet Tracker is an independent project and is not affiliated with or endorsed by LeetCode. It reads only public profile data.