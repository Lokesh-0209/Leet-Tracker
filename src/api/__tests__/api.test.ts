/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSqliteDatabase, type SqliteDatabasePort } from '../../db/sqliteDatabase.js';
import { runMigrations } from '../../db/schema.js';
import { SqliteProblemRepository } from '../../repositories/sqliteProblemRepository.js';
import { SqliteSettingsRepository } from '../../repositories/settingsRepository.js';
import {
  FrozenClock,
  PROBLEM_STATUSES,
  InvalidUsernameError,
  PrivateOrEmptyProfileError,
  RateLimitedError,
  NetworkError,
  UpstreamSchemaChangedError,
  type SolvedProblem,
} from '../../domain/index.js';
import type { ProblemSource } from '../../services/index.js';
import { ProblemService } from '../../services/problemService.js';
import { SyncService } from '../../services/syncService.js';
import { BackupService } from '../../services/backupService.js';
import { createApiApp } from '../app.js';

class FakeTestSource implements ProblemSource {
  public readonly platform = 'LEETCODE' as const;
  public solved: SolvedProblem[] = [];
  public questions = new Map<string, { title: string; difficulty: 'Easy' | 'Medium' | 'Hard' }>();
  public failureType: 'none' | 'invalid_user' | 'empty' | 'rate_limit' | 'network' | 'schema' = 'none';

  public async fetchSolved(username: string): Promise<SolvedProblem[]> {
    if (this.failureType === 'invalid_user') {
      throw new InvalidUsernameError(username);
    }
    if (this.failureType === 'empty') {
      throw new PrivateOrEmptyProfileError(username);
    }
    if (this.failureType === 'rate_limit') {
      throw new RateLimitedError();
    }
    if (this.failureType === 'network') {
      throw new NetworkError('Simulated network disruption');
    }
    if (this.failureType === 'schema') {
      throw new UpstreamSchemaChangedError();
    }
    return this.solved;
  }

  public async lookupProblem(
    slug: string
  ): Promise<{ title: string; difficulty: 'Easy' | 'Medium' | 'Hard' } | null> {
    return this.questions.get(slug) || null;
  }
}

describe('Phase 5: Express REST API & Error Middleware', () => {
  let db: SqliteDatabasePort;
  let repo: SqliteProblemRepository;
  let settingsRepo: SqliteSettingsRepository;
  let clock: FrozenClock;
  let fakeSource: FakeTestSource;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    db = createSqliteDatabase(':memory:');
    runMigrations(db);
    repo = new SqliteProblemRepository(db);
    settingsRepo = new SqliteSettingsRepository(db);
    clock = new FrozenClock('2026-10-16T12:00:00Z', 'UTC');
    fakeSource = new FakeTestSource();

    const problemService = new ProblemService(repo, fakeSource, clock);
    const syncService = new SyncService(repo, fakeSource, settingsRepo);
    const backupService = new BackupService(db, repo, settingsRepo, clock);

    const app = createApiApp({
      problemRepository: repo,
      settingsRepository: settingsRepo,
      problemService,
      syncService,
      backupService,
      clock,
    });

    // Start on ephemeral port
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}/api`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  /* -------------------------------------------------------------------------- */
  /* HEALTH CHECK                                                               */
  /* -------------------------------------------------------------------------- */
  it('GET /api/health returns 200 with { ok: true }', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
  });

  /* -------------------------------------------------------------------------- */
  /* 1. GET /api/problems & GET /api/problems/:id                               */
  /* -------------------------------------------------------------------------- */
  describe('GET /api/problems & GET /api/problems/:id', () => {
    it('Happy path: lists problems matching filters and returns 200', async () => {
      await repo.create({
        id: '11111111-1111-1111-1111-111111111111',
        platform: 'LEETCODE',
        slug: 'two-sum',
        title: 'Two Sum',
        difficulty: 'Easy',
        url: 'https://leetcode.com/problems/two-sum/',
        solvedAt: '2026-10-15T00:00:00Z',
        status: PROBLEM_STATUSES.INBOX,
        enrolledAt: null,
        deletedAt: null,
      });

      const res = await fetch(`${baseUrl}/problems?status=INBOX&difficulty=Easy&q=sum`);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.problems).toHaveLength(1);
      expect(json.problems[0].problem.slug).toBe('two-sum');
    });

    it('Error path: invalid query parameter returns 400 VALIDATION_ERROR', async () => {
      const res = await fetch(`${baseUrl}/problems?status=UNKNOWN_STATUS`);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.code).toBe('VALIDATION_ERROR');
      expect(json.retryable).toBe(false);
    });

    it('Happy path: GET /api/problems/:id returns single aggregate', async () => {
      await repo.create({
        id: '22222222-2222-2222-2222-222222222222',
        platform: 'LEETCODE',
        slug: 'valid-parentheses',
        title: 'Valid Parentheses',
        difficulty: 'Easy',
        url: 'https://leetcode.com/problems/valid-parentheses/',
        solvedAt: '2026-10-15T00:00:00Z',
        status: PROBLEM_STATUSES.INBOX,
        enrolledAt: null,
        deletedAt: null,
      });

      const res = await fetch(`${baseUrl}/problems/22222222-2222-2222-2222-222222222222`);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.problem.slug).toBe('valid-parentheses');
    });

    it('Error path: non-existent ID returns 404 NOT_FOUND', async () => {
      const res = await fetch(`${baseUrl}/problems/99999999-9999-9999-9999-999999999999`);
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.code).toBe('NOT_FOUND');
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. POST /api/problems/manual                                               */
  /* -------------------------------------------------------------------------- */
  describe('POST /api/problems/manual', () => {
    it('Happy path: adds problem by slug and difficulty, returns 201', async () => {
      const res = await fetch(`${baseUrl}/problems/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urlOrSlug: '3sum',
          difficulty: 'Medium',
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.problem.slug).toBe('3sum');
      expect(json.problem.difficulty).toBe('Medium');
      expect(json.problem.status).toBe('INBOX');
    });

    it('Error path: non-LeetCode URL returns 400 VALIDATION_ERROR', async () => {
      const res = await fetch(`${baseUrl}/problems/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urlOrSlug: 'https://codeforces.com/problem/1',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({
        code: 'VALIDATION_ERROR',
        message: expect.any(String),
        retryable: false,
      });
    });

    it('Error path: duplicate manual add of active problem returns 400 VALIDATION_ERROR', async () => {
      // First add problem
      await fetch(`${baseUrl}/problems/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urlOrSlug: 'trapping-rain-water',
          difficulty: 'Hard',
        }),
      });

      // Attempt duplicate add
      const dupRes = await fetch(`${baseUrl}/problems/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urlOrSlug: 'trapping-rain-water',
          difficulty: 'Hard',
        }),
      });

      expect(dupRes.status).toBe(400);
      const json = await dupRes.json();
      expect(json).toEqual({
        code: 'VALIDATION_ERROR',
        message: expect.stringContaining('already in your tracker'),
        retryable: false,
      });
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. POST /api/problems/sync & ERROR MAPPINGS                                */
  /* -------------------------------------------------------------------------- */
  describe('POST /api/problems/sync and Central Error Mappings', () => {
    it('Happy path: sync returns 200 with added/known counts', async () => {
      fakeSource.solved = [
        {
          platform: 'LEETCODE',
          slug: 'coin-change',
          title: 'Coin Change',
          difficulty: 'Medium',
          url: 'https://leetcode.com/problems/coin-change/',
          solvedAt: '2026-10-15T00:00:00Z',
        },
      ];

      const res = await fetch(`${baseUrl}/problems/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'valid_user' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.added).toBe(1);
    });

    it('Status mapping: INVALID_USERNAME maps to HTTP 422', async () => {
      fakeSource.failureType = 'invalid_user';

      const res = await fetch(`${baseUrl}/problems/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'missing_user' }),
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.code).toBe('INVALID_USERNAME');
      expect(json.retryable).toBe(false);
    });

    it('Status mapping: PRIVATE_OR_EMPTY_PROFILE maps to HTTP 422', async () => {
      fakeSource.failureType = 'empty';

      const res = await fetch(`${baseUrl}/problems/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'empty_user' }),
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json).toMatchObject({
        code: 'PRIVATE_OR_EMPTY_PROFILE',
        message: expect.any(String),
        retryable: false,
      });
    });

    it('Status mapping: RATE_LIMITED maps to HTTP 429 with retryable: true', async () => {
      fakeSource.failureType = 'rate_limit';

      const res = await fetch(`${baseUrl}/problems/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'spammer' }),
      });

      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.code).toBe('RATE_LIMITED');
      expect(json.retryable).toBe(true);
    });

    it('Status mapping: NETWORK_ERROR maps to HTTP 502 with retryable: true', async () => {
      fakeSource.failureType = 'network';

      const res = await fetch(`${baseUrl}/problems/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'some_user' }),
      });

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.code).toBe('NETWORK_ERROR');
      expect(json.retryable).toBe(true);
    });

    it('Status mapping: UPSTREAM_SCHEMA_CHANGED maps to HTTP 502 with retryable: false', async () => {
      fakeSource.failureType = 'schema';

      const res = await fetch(`${baseUrl}/problems/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'some_user' }),
      });

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.code).toBe('UPSTREAM_SCHEMA_CHANGED');
      expect(json.retryable).toBe(false);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. GET /api/reviews/today & TIMEZONE VALIDATION                            */
  /* -------------------------------------------------------------------------- */
  describe('GET /api/reviews/today with IANA Time Zone Resolution', () => {
    it('Given client timezone header near midnight, Then reviews and calendar today are calculated in client local time', async () => {
      // Clock is at UTC: 2026-10-16T01:30:00Z
      clock.setDate('2026-10-16T01:30:00Z');

      // In America/Los_Angeles (UTC-7 PDT), it is 2026-10-15 18:30:00 (yesterday!)
      const laRes = await fetch(`${baseUrl}/reviews/today`, {
        headers: { 'X-Timezone': 'America/Los_Angeles' },
      });
      const laJson = await laRes.json();
      expect(laJson.today).toBe('2026-10-15');

      // In Pacific/Auckland (UTC+13 NZDT), it is 2026-10-16 14:30:00 (today!)
      const aucklandRes = await fetch(`${baseUrl}/reviews/today`, {
        headers: { 'X-Timezone': 'Pacific/Auckland' },
      });
      const aucklandJson = await aucklandRes.json();
      expect(aucklandJson.today).toBe('2026-10-16');
    });

    it('Given an invalid or omitted timezone header, Then it falls back safely to server runtime zone', async () => {
      const res = await fetch(`${baseUrl}/reviews/today`, {
        headers: { 'X-Timezone': 'Mars/Olympus_Mons' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 5. POST /api/problems/:id/note & ENROLLMENT GATE                           */
  /* -------------------------------------------------------------------------- */
  describe('POST /api/problems/:id/note', () => {
    it('Happy path: saving note that passes gate transitions INBOX -> ACTIVE and creates reviews', async () => {
      const problem = await repo.create({
        id: '33333333-3333-3333-3333-333333333333',
        platform: 'LEETCODE',
        slug: 'invert-binary-tree',
        title: 'Invert Binary Tree',
        difficulty: 'Easy',
        url: 'https://leetcode.com/problems/invert-binary-tree/',
        solvedAt: '2026-10-15T00:00:00Z',
        status: PROBLEM_STATUSES.INBOX,
        enrolledAt: null,
        deletedAt: null,
      });

      const res = await fetch(`${baseUrl}/problems/${problem.id}/note`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Timezone': 'UTC',
        },
        body: JSON.stringify({
          approaches: [
            {
              id: 'app-1',
              title: 'Approach 1',
              body: 'Time Complexity: O(n)\nSpace Complexity: O(h)',
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.problem.status).toBe('ACTIVE');
      expect(json.reviews).toHaveLength(3);
    });

    it('Error path: saving note with missing complexity on INBOX problem returns 400 VALIDATION_ERROR', async () => {
      const problem = await repo.create({
        id: '44444444-4444-4444-4444-444444444444',
        platform: 'LEETCODE',
        slug: 'invert-tree-2',
        title: 'Invert Tree 2',
        difficulty: 'Easy',
        url: 'https://leetcode.com/problems/invert-tree-2/',
        solvedAt: '2026-10-15T00:00:00Z',
        status: PROBLEM_STATUSES.INBOX,
        enrolledAt: null,
        deletedAt: null,
      });

      const res = await fetch(`${baseUrl}/problems/${problem.id}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approaches: [
            {
              id: 'app-1',
              title: 'Approach 1',
              body: 'Unfilled note',
            },
          ],
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION_ERROR');
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 6. REVIEWS: COMPLETE & UNDO                                                */
  /* -------------------------------------------------------------------------- */
  describe('Reviews Complete & Undo', () => {
    it('Happy path: completing review stage 1 returns 200 and updated reviews', async () => {
      const problem = await repo.create({
        id: '55555555-5555-5555-5555-555555555555',
        platform: 'LEETCODE',
        slug: 'climbing-stairs',
        title: 'Climbing Stairs',
        difficulty: 'Easy',
        url: 'https://leetcode.com/problems/climbing-stairs/',
        solvedAt: '2026-10-15T00:00:00Z',
        status: PROBLEM_STATUSES.ACTIVE,
        enrolledAt: '2026-10-15T00:00:00Z',
        deletedAt: null,
      });
      await repo.saveReviews([
        { problemId: problem.id, stage: 1, dueDate: '2026-10-16', completedAt: null },
        { problemId: problem.id, stage: 2, dueDate: '2026-10-18', completedAt: null },
        { problemId: problem.id, stage: 3, dueDate: '2026-10-22', completedAt: null },
      ]);

      const res = await fetch(`${baseUrl}/problems/${problem.id}/reviews/1/complete`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.reviews[0].completedAt).toBeDefined();
    });

    it('Error path: out-of-order stage 2 returns 409 ILLEGAL_TRANSITION', async () => {
      const problem = await repo.create({
        id: '66666666-6666-6666-6666-666666666666',
        platform: 'LEETCODE',
        slug: 'climbing-stairs-2',
        title: 'Climbing Stairs 2',
        difficulty: 'Easy',
        url: 'https://leetcode.com/problems/climbing-stairs-2/',
        solvedAt: '2026-10-15T00:00:00Z',
        status: PROBLEM_STATUSES.ACTIVE,
        enrolledAt: '2026-10-15T00:00:00Z',
        deletedAt: null,
      });
      await repo.saveReviews([
        { problemId: problem.id, stage: 1, dueDate: '2026-10-16', completedAt: null },
        { problemId: problem.id, stage: 2, dueDate: '2026-10-18', completedAt: null },
        { problemId: problem.id, stage: 3, dueDate: '2026-10-22', completedAt: null },
      ]);

      // Stage 2 before stage 1
      const res = await fetch(`${baseUrl}/problems/${problem.id}/reviews/2/complete`, {
        method: 'POST',
      });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.code).toBe('ILLEGAL_TRANSITION');
    });

    it('Happy path & Error path: undo stage 1', async () => {
      const problem = await repo.create({
        id: '77777777-7777-7777-7777-777777777777',
        platform: 'LEETCODE',
        slug: 'undo-test',
        title: 'Undo Test',
        difficulty: 'Easy',
        url: 'https://leetcode.com/problems/undo-test/',
        solvedAt: '2026-10-15T00:00:00Z',
        status: PROBLEM_STATUSES.ACTIVE,
        enrolledAt: '2026-10-15T00:00:00Z',
        deletedAt: null,
      });
      await repo.saveReviews([
        { problemId: problem.id, stage: 1, dueDate: '2026-10-16', completedAt: '2026-10-16T10:00:00Z' },
        { problemId: problem.id, stage: 2, dueDate: '2026-10-18', completedAt: null },
        { problemId: problem.id, stage: 3, dueDate: '2026-10-22', completedAt: null },
      ]);

      // Happy path: undo stage 1
      const undoRes = await fetch(`${baseUrl}/problems/${problem.id}/reviews/1/undo`, {
        method: 'POST',
      });
      expect(undoRes.status).toBe(200);

      // Error path: undo uncompleted stage 1 returns 409
      const errRes = await fetch(`${baseUrl}/problems/${problem.id}/reviews/1/undo`, {
        method: 'POST',
      });
      expect(errRes.status).toBe(409);
      const json = await errRes.json();
      expect(json.code).toBe('ILLEGAL_TRANSITION');
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 7. SOFT DELETE, RESTORE & PERMANENT DELETE                                 */
  /* -------------------------------------------------------------------------- */
  describe('Soft Delete, Restore, Permanent Delete & Deleted List', () => {
    it('Full lifecycle: DELETE soft-deletes, GET /problems/deleted lists it, POST restore restores it, DELETE /permanent purges it', async () => {
      const problem = await repo.create({
        id: '88888888-8888-8888-8888-888888888888',
        platform: 'LEETCODE',
        slug: 'delete-lifecycle',
        title: 'Delete Lifecycle',
        difficulty: 'Hard',
        url: 'https://leetcode.com/problems/delete-lifecycle/',
        solvedAt: '2026-10-15T00:00:00Z',
        status: PROBLEM_STATUSES.INBOX,
        enrolledAt: null,
        deletedAt: null,
      });

      // 1. Soft delete
      const delRes = await fetch(`${baseUrl}/problems/${problem.id}`, { method: 'DELETE' });
      expect(delRes.status).toBe(200);

      // 2. GET /api/problems/deleted
      const listDelRes = await fetch(`${baseUrl}/problems/deleted`);
      expect(listDelRes.status).toBe(200);
      const listDelJson = await listDelRes.json();
      expect(listDelJson.problems).toHaveLength(1);
      expect(listDelJson.problems[0].problem.id).toBe(problem.id);

      // 3. Restore
      const restoreRes = await fetch(`${baseUrl}/problems/${problem.id}/restore`, { method: 'POST' });
      expect(restoreRes.status).toBe(200);

      // Verify no longer in deleted
      const checkDel = await fetch(`${baseUrl}/problems/deleted`);
      const checkJson = await checkDel.json();
      expect(checkJson.problems).toHaveLength(0);

      // 4. Permanent delete
      const permRes = await fetch(`${baseUrl}/problems/${problem.id}/permanent`, { method: 'DELETE' });
      expect(permRes.status).toBe(200);

      // Check fully purged
      const checkPurge = await fetch(`${baseUrl}/problems/${problem.id}`);
      expect(checkPurge.status).toBe(404);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 8. SETTINGS ROUTES                                                         */
  /* -------------------------------------------------------------------------- */
  describe('Settings Routes', () => {
    it('Happy path: GET and PUT /api/settings/username', async () => {
      const get1 = await fetch(`${baseUrl}/settings/username`);
      expect(get1.status).toBe(200);
      expect((await get1.json()).username).toBeNull();

      const putRes = await fetch(`${baseUrl}/settings/username`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leetcodeUsername: 'code_ninja' }),
      });
      expect(putRes.status).toBe(200);

      const get2 = await fetch(`${baseUrl}/settings/username`);
      expect((await get2.json()).username).toBe('code_ninja');
    });

    it('Error path: PUT /api/settings/username with invalid body returns 400', async () => {
      const res = await fetch(`${baseUrl}/settings/username`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wrongField: 'test' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION_ERROR');
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 8. BACKUP EXPORT & RESTORE                                                 */
  /* -------------------------------------------------------------------------- */
  describe('Backup Routes', () => {
    it('Happy path: GET /api/backup exports valid backup format', async () => {
      await settingsRepo.setLeetCodeUsername('backup_user');
      const res = await fetch(`${baseUrl}/backup`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toMatchObject({
        version: 1,
        exportedAt: '2026-10-16T12:00:00.000Z',
        settings: { username: 'backup_user' },
        problems: [],
      });
    });

    it('Happy path: POST /api/backup/restore atomically restores valid backup data', async () => {
      const backupPayload = {
        version: 1,
        exportedAt: '2026-10-16T12:00:00.000Z',
        settings: { username: 'restored_user' },
        problems: [
          {
            problem: {
              id: '123e4567-e89b-12d3-a456-426614174000',
              platform: 'LEETCODE',
              slug: 'restore-slug',
              title: 'Restored Problem',
              difficulty: 'Medium',
              url: 'https://leetcode.com/problems/restore-slug/',
              solvedAt: '2026-10-16T10:00:00.000Z',
              status: 'INBOX',
              enrolledAt: null,
              deletedAt: null,
            },
            note: null,
            reviews: [],
          },
        ],
      };

      const res = await fetch(`${baseUrl}/backup/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backupPayload),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ ok: true, restoredCount: 1 });

      const checkUsername = await fetch(`${baseUrl}/settings/username`);
      expect((await checkUsername.json()).username).toBe('restored_user');

      const checkProblems = await fetch(`${baseUrl}/problems`);
      const problemsJson = await checkProblems.json();
      expect(problemsJson.problems).toHaveLength(1);
      expect(problemsJson.problems[0].problem.title).toBe('Restored Problem');
    });

    it('Error path: POST /api/backup/restore with invalid or newer version returns 400 VALIDATION_ERROR', async () => {
      const invalidPayload = {
        version: 2, // Unsupported version
        exportedAt: '2026-10-16T12:00:00.000Z',
        settings: {},
        problems: [],
      };

      const res = await fetch(`${baseUrl}/backup/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidPayload),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION_ERROR');
      expect(json.retryable).toBe(false);
    });
  });
});
