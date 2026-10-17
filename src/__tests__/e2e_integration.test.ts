/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSqliteDatabase, type SqliteDatabasePort } from '../db/sqliteDatabase.js';
import { runMigrations } from '../db/schema.js';
import { SqliteProblemRepository } from '../repositories/sqliteProblemRepository.js';
import { SqliteSettingsRepository } from '../repositories/settingsRepository.js';
import { FrozenClock } from '../domain/clock.js';
import { ProblemService } from '../services/problemService.js';
import { SyncService } from '../services/syncService.js';
import type { ProblemSource } from '../services/problemSource.js';
import { createApiApp } from '../api/app.js';
import { PROBLEM_STATUSES } from '../domain/constants.js';

class MockProblemSource implements ProblemSource {
  public readonly platform = 'LEETCODE' as const;
  public async fetchSolved() {
    return [];
  }
  public async lookupProblem(slug: string) {
    return {
      title: slug.replace(/-/g, ' ').toUpperCase(),
      difficulty: 'Medium' as const,
    };
  }
}

describe('Phase 7 Full End-to-End Integration Test', () => {
  let db: SqliteDatabasePort;
  let repo: SqliteProblemRepository;
  let settingsRepo: SqliteSettingsRepository;
  let clock: FrozenClock;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    db = createSqliteDatabase(':memory:');
    runMigrations(db);
    repo = new SqliteProblemRepository(db);
    settingsRepo = new SqliteSettingsRepository(db);
    clock = new FrozenClock('2026-10-16T12:00:00Z', 'UTC');
    const source = new MockProblemSource();

    const problemService = new ProblemService(repo, source, clock);
    const syncService = new SyncService(repo, source, settingsRepo);

    const app = createApiApp({
      problemRepository: repo,
      settingsRepository: settingsRepo,
      problemService,
      syncService,
      clock,
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}/api`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('Full lifecycle: Manual Add -> Inbox -> Notes with Complexity -> Enrolled to ACTIVE -> D1, D2, D3 Completion -> FULLY_SOLVED -> Undo -> Soft Delete -> Restore -> Hard Delete', async () => {
    // 1. Manually add problem
    const addRes = await fetch(`${baseUrl}/problems/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urlOrSlug: 'lru-cache', difficulty: 'Medium' }),
    });
    expect(addRes.status).toBe(201);
    const addData = await addRes.json();
    const problemId = addData.problem.id;
    expect(addData.problem.status).toBe(PROBLEM_STATUSES.INBOX);

    // 2. Gate rejection on empty complexity
    const badNoteRes = await fetch(`${baseUrl}/problems/${problemId}/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approaches: [{ id: 'app-1', title: 'Approach 1', body: 'Unfinished note' }],
      }),
    });
    expect(badNoteRes.status).toBe(400);

    // 3. Save valid note with Time and Space complexity -> Enrolls to ACTIVE
    const noteRes = await fetch(`${baseUrl}/problems/${problemId}/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Timezone': 'UTC' },
      body: JSON.stringify({
        approaches: [
          {
            id: 'app-1',
            title: 'Approach 1 (HashMap + DLL)',
            body: 'Your approach: Double LinkedList with Map\nTime Complexity: O(1)\nSpace Complexity: O(capacity)',
          },
        ],
      }),
    });
    expect(noteRes.status).toBe(200);
    const noteData = await noteRes.json();
    expect(noteData.problem.status).toBe(PROBLEM_STATUSES.ACTIVE);
    expect(noteData.reviews).toHaveLength(3);
    expect(noteData.reviews[0].dueDate).toBe('2026-10-17'); // anchor (Oct 16) + 1 day
    expect(noteData.reviews[1].dueDate).toBe('2026-10-19'); // anchor + 3 days
    expect(noteData.reviews[2].dueDate).toBe('2026-10-23'); // anchor + 7 days

    // 4. Complete Review 1
    const rev1Res = await fetch(`${baseUrl}/problems/${problemId}/reviews/1/complete`, {
      method: 'POST',
    });
    expect(rev1Res.status).toBe(200);
    const rev1Data = await rev1Res.json();
    expect(rev1Data.reviews[0].completedAt).toBeDefined();

    // 5. Out-of-order completion error: Attempt Stage 3 before Stage 2 -> 409
    const rev3Err = await fetch(`${baseUrl}/problems/${problemId}/reviews/3/complete`, {
      method: 'POST',
    });
    expect(rev3Err.status).toBe(409);

    // 6. Complete Review 2
    const rev2Res = await fetch(`${baseUrl}/problems/${problemId}/reviews/2/complete`, {
      method: 'POST',
    });
    expect(rev2Res.status).toBe(200);

    // 7. Complete Review 3 -> Problem transitions to FULLY_SOLVED
    const rev3Res = await fetch(`${baseUrl}/problems/${problemId}/reviews/3/complete`, {
      method: 'POST',
    });
    expect(rev3Res.status).toBe(200);
    const rev3Data = await rev3Res.json();
    expect(rev3Data.problem.status).toBe(PROBLEM_STATUSES.FULLY_SOLVED);

    // 8. Undo Stage 3 -> Transitions back to ACTIVE
    const undoRes = await fetch(`${baseUrl}/problems/${problemId}/reviews/3/undo`, {
      method: 'POST',
    });
    expect(undoRes.status).toBe(200);
    const undoData = await undoRes.json();
    expect(undoData.problem.status).toBe(PROBLEM_STATUSES.ACTIVE);
    expect(undoData.reviews[2].completedAt).toBeNull();

    // 9. Soft delete problem
    const delRes = await fetch(`${baseUrl}/problems/${problemId}`, { method: 'DELETE' });
    expect(delRes.status).toBe(200);

    // Verify it is excluded from active list
    const activeList = await fetch(`${baseUrl}/problems?status=ACTIVE`);
    const activeJson = await activeList.json();
    expect(activeJson.problems.find((p: any) => p.problem.id === problemId)).toBeUndefined();

    // Verify it appears in deleted list
    const deletedList = await fetch(`${baseUrl}/problems/deleted`);
    const deletedJson = await deletedList.json();
    expect(deletedJson.problems.find((p: any) => p.problem.id === problemId)).toBeDefined();

    // 10. Restore problem
    const restoreRes = await fetch(`${baseUrl}/problems/${problemId}/restore`, { method: 'POST' });
    expect(restoreRes.status).toBe(200);

    // 11. Permanent delete
    const permRes = await fetch(`${baseUrl}/problems/${problemId}/permanent`, { method: 'DELETE' });
    expect(permRes.status).toBe(200);

    // Check 404
    const notFound = await fetch(`${baseUrl}/problems/${problemId}`);
    expect(notFound.status).toBe(404);
  });
});
