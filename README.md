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
