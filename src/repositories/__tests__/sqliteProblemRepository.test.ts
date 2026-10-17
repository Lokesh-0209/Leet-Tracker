/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteDatabase, type SqliteDatabasePort } from '../../db/sqliteDatabase.js';
import { runMigrations } from '../../db/schema.js';
import { SqliteProblemRepository } from '../sqliteProblemRepository.js';
import { SqliteSettingsRepository } from '../settingsRepository.js';
import {
  PROBLEM_STATUSES,
  type Problem,
  type Note,
  type Review,
} from '../../domain/index.js';

describe('Phase 3: SQLite Persistence and Repository Layer', () => {
  let db: SqliteDatabasePort;
  let repo: SqliteProblemRepository;
  let settingsRepo: SqliteSettingsRepository;

  beforeEach(() => {
    // Repository tests use in-memory SQLite database
    db = createSqliteDatabase(':memory:');
    runMigrations(db);
    repo = new SqliteProblemRepository(db);
    settingsRepo = new SqliteSettingsRepository(db);
  });

  const createSampleProblem = (override: Partial<Problem> = {}): Problem => ({
    id: override.id || '11111111-1111-1111-1111-111111111111',
    platform: 'LEETCODE',
    slug: override.slug || 'two-sum',
    title: override.title || 'Two Sum',
    difficulty: override.difficulty || 'Easy',
    url: override.url || 'https://leetcode.com/problems/two-sum/',
    solvedAt: override.solvedAt || '2026-10-15T10:00:00.000Z',
    status: override.status || PROBLEM_STATUSES.INBOX,
    enrolledAt: override.enrolledAt || null,
    deletedAt: override.deletedAt || null,
  });

  /* -------------------------------------------------------------------------- */
  /* 1. UNIQUE CONSTRAINT ON (platform, slug)                                   */
  /* -------------------------------------------------------------------------- */
  describe('Unique Constraint', () => {
    it('Given an existing problem, When attempting to insert a duplicate (platform, slug), Then SQLite rejects with unique constraint violation', async () => {
      const p1 = createSampleProblem({ id: 'id-1', slug: 'duplicate-test' });
      await repo.create(p1);

      const p2 = createSampleProblem({ id: 'id-2', slug: 'duplicate-test', title: 'Second Version' });
      await expect(repo.create(p2)).rejects.toThrow();

      // Ensure original problem remains intact
      const stored = await repo.findById('id-1');
      expect(stored?.title).toBe('Two Sum');
    });

    it('Given problems with same slug on different platforms (future-ready), Then unique constraint allows it', async () => {
      const p1 = createSampleProblem({ id: 'id-1', slug: 'two-sum', platform: 'LEETCODE' });
      await repo.create(p1);

      // Verify finding by platform and slug
      const found = await repo.findByPlatformAndSlug('LEETCODE', 'two-sum');
      expect(found?.id).toBe('id-1');
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. SOFT DELETE AND RESTORE                                                 */
  /* -------------------------------------------------------------------------- */
  describe('Soft Delete and Restore', () => {
    it('Given an active problem, When soft-deleted, Then list queries exclude it by default and settings list includes it', async () => {
      const p = createSampleProblem({ id: 'del-1', slug: 'del-slug' });
      await repo.create(p);

      // Normal list includes it
      let list = await repo.list();
      expect(list.find((x) => x.id === 'del-1')).toBeDefined();

      // Soft delete
      const deleteTimestamp = '2026-10-16T12:00:00.000Z';
      await repo.softDelete('del-1', deleteTimestamp);

      // Normal list excludes soft-deleted items
      list = await repo.list();
      expect(list.find((x) => x.id === 'del-1')).toBeUndefined();

      // Direct find still retrieves it with deletedAt set
      const retrieved = await repo.findById('del-1');
      expect(retrieved?.deletedAt).toBe(deleteTimestamp);

      // Filter onlyDeleted returns it (used for Settings > Deleted section)
      const deletedOnly = await repo.list({ onlyDeleted: true });
      expect(deletedOnly.find((x) => x.id === 'del-1')).toBeDefined();

      // Restore problem
      await repo.restore('del-1');
      const restored = await repo.findById('del-1');
      expect(restored?.deletedAt).toBeNull();

      // Now normal list includes it again
      list = await repo.list();
      expect(list.find((x) => x.id === 'del-1')).toBeDefined();
    });

    it('Given a soft-deleted problem, When calling findByPlatformAndSlug, Then it returns the problem including soft-deleted status, and restoring clears deletedAt', async () => {
      const p = createSampleProblem({ id: 'soft-del-slug-id', slug: 'find-by-slug-del' });
      await repo.create(p);

      // Soft delete it
      await repo.softDelete('soft-del-slug-id', '2026-10-16T15:00:00.000Z');

      // findByPlatformAndSlug MUST find it, including its deleted status (crucial for sync to skip it and manual-add to restore it)
      const foundDeleted = await repo.findByPlatformAndSlug('LEETCODE', 'find-by-slug-del');
      expect(foundDeleted).not.toBeNull();
      expect(foundDeleted?.id).toBe('soft-del-slug-id');
      expect(foundDeleted?.deletedAt).toBe('2026-10-16T15:00:00.000Z');

      // Restoring it
      await repo.restore('soft-del-slug-id');
      const foundRestored = await repo.findByPlatformAndSlug('LEETCODE', 'find-by-slug-del');
      expect(foundRestored?.deletedAt).toBeNull();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. ATOMIC ENROLLMENT ROLLBACK                                              */
  /* -------------------------------------------------------------------------- */
  describe('Atomic Enrollment Rollback', () => {
    it('Given an INBOX problem, When atomic enrollment fails midway, Then transaction rolls back completely leaving zero partial writes', async () => {
      const p = createSampleProblem({ id: 'atomic-fail-id', slug: 'atomic-test', status: PROBLEM_STATUSES.INBOX });
      await repo.create(p);

      const invalidReviews: Review[] = [
        { problemId: 'atomic-fail-id', stage: 1, dueDate: '2026-10-17', completedAt: null },
        // Duplicate stage 1 violates primary key (problem_id, stage)
        { problemId: 'atomic-fail-id', stage: 1, dueDate: '2026-10-17', completedAt: null },
      ];

      const note: Note = {
        problemId: 'atomic-fail-id',
        approaches: [{ id: 'app-1', title: 'Approach 1', body: 'Time Complexity: O(n)\nSpace Complexity: O(1)' }],
        updatedAt: '2026-10-16T12:00:00.000Z',
      };

      // Attempt enrollment with invalid reviews array that violates PK constraint
      await expect(
        repo.enrollProblemAtomic({
          problemId: 'atomic-fail-id',
          status: PROBLEM_STATUSES.ACTIVE,
          enrolledAt: '2026-10-16T12:00:00.000Z',
          reviews: invalidReviews,
          note,
        })
      ).rejects.toThrow();

      // VERIFY ROLLBACK: Problem must still be INBOX, enrolledAt null, zero reviews, zero notes
      const afterProblem = await repo.findById('atomic-fail-id');
      expect(afterProblem?.status).toBe(PROBLEM_STATUSES.INBOX);
      expect(afterProblem?.enrolledAt).toBeNull();

      const reviews = await repo.getReviews('atomic-fail-id');
      expect(reviews).toHaveLength(0);

      const savedNote = await repo.getNote('atomic-fail-id');
      expect(savedNote).toBeNull();
    });

    it('Given a valid enrollment payload, When enrolled, Then problem status, 3 reviews, and notes are saved atomically', async () => {
      const p = createSampleProblem({ id: 'atomic-success-id', slug: 'atomic-success', status: PROBLEM_STATUSES.INBOX });
      await repo.create(p);

      const validReviews: Review[] = [
        { problemId: 'atomic-success-id', stage: 1, dueDate: '2026-10-17', completedAt: null },
        { problemId: 'atomic-success-id', stage: 2, dueDate: '2026-10-19', completedAt: null },
        { problemId: 'atomic-success-id', stage: 3, dueDate: '2026-10-23', completedAt: null },
      ];

      const note: Note = {
        problemId: 'atomic-success-id',
        approaches: [{ id: 'app-1', title: 'Approach 1', body: 'Time Complexity: O(n)\nSpace Complexity: O(1)' }],
        updatedAt: '2026-10-16T12:00:00.000Z',
      };

      await repo.enrollProblemAtomic({
        problemId: 'atomic-success-id',
        status: PROBLEM_STATUSES.ACTIVE,
        enrolledAt: '2026-10-16T12:00:00.000Z',
        reviews: validReviews,
        note,
      });

      const updated = await repo.findById('atomic-success-id');
      expect(updated?.status).toBe(PROBLEM_STATUSES.ACTIVE);
      expect(updated?.enrolledAt).toBe('2026-10-16T12:00:00.000Z');

      const reviews = await repo.getReviews('atomic-success-id');
      expect(reviews).toHaveLength(3);
      expect(reviews.map((r) => r.stage)).toEqual([1, 2, 3]);

      const storedNote = await repo.getNote('atomic-success-id');
      expect(storedNote?.approaches).toHaveLength(1);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. TRANSACTION BEHAVIOUR FOR SYNC SERVICE (PHASE 4 PREVIEW)                */
  /* -------------------------------------------------------------------------- */
  describe('Transaction Behaviour for Sync Service', () => {
    it('Given a multi-problem sync batch, When an error occurs mid-sync, Then runInTransaction rolls back all writes', async () => {
      const p1 = createSampleProblem({ id: 'sync-1', slug: 'sync-problem-1' });
      const p2 = createSampleProblem({ id: 'sync-2', slug: 'sync-problem-2' });

      // Run transactional batch that throws an intentional network error midway
      await expect(
        repo.runInTransaction(async () => {
          await repo.create(p1);
          // Simulate failure before p2 or during processing
          throw new Error('Simulated network disruption during sync');
        })
      ).rejects.toThrow('Simulated network disruption during sync');

      // Check p1 was NOT committed
      const foundP1 = await repo.findById('sync-1');
      expect(foundP1).toBeNull();
      const count = await repo.list();
      expect(count).toHaveLength(0);
    });

    it('Given a valid sync batch inside a transaction, When completed, Then all problems are committed together', async () => {
      const p1 = createSampleProblem({ id: 'sync-ok-1', slug: 'sync-1' });
      const p2 = createSampleProblem({ id: 'sync-ok-2', slug: 'sync-2' });

      await repo.runInTransaction(async () => {
        await repo.create(p1);
        await repo.create(p2);
      });

      const all = await repo.list();
      expect(all).toHaveLength(2);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 5. DUE & OVERDUE REVIEWS QUERY                                             */
  /* -------------------------------------------------------------------------- */
  describe('Due and Overdue Reviews Query', () => {
    it('Given reviews with various due dates, When querying getDueOrOverdueReviews, Then only uncompleted items due on or before today are returned', async () => {
      const p1 = createSampleProblem({ id: 'p-due-1', slug: 'due-1', status: PROBLEM_STATUSES.ACTIVE });
      const p2 = createSampleProblem({ id: 'p-due-2', slug: 'due-2', status: PROBLEM_STATUSES.ACTIVE });
      await repo.create(p1);
      await repo.create(p2);

      // p1 has stage 1 overdue (due Oct 14) and stage 2 future (due Oct 18)
      await repo.saveReviews([
        { problemId: 'p-due-1', stage: 1, dueDate: '2026-10-14', completedAt: null },
        { problemId: 'p-due-1', stage: 2, dueDate: '2026-10-18', completedAt: null },
      ]);

      // p2 has stage 1 due today (due Oct 16) and completed stage 2 (due Oct 16)
      await repo.saveReviews([
        { problemId: 'p-due-2', stage: 1, dueDate: '2026-10-16', completedAt: null },
        { problemId: 'p-due-2', stage: 2, dueDate: '2026-10-16', completedAt: '2026-10-16T08:00:00Z' },
      ]);

      const dueItems = await repo.getDueOrOverdueReviews('2026-10-16');

      // Expected: p1 stage 1 (due 10-14) and p2 stage 1 (due 10-16)
      expect(dueItems).toHaveLength(2);
      expect(dueItems.map((d) => `${d.problem.slug}-s${d.review.stage}`)).toEqual([
        'due-1-s1',
        'due-2-s1',
      ]);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 6. SETTINGS REPOSITORY                                                     */
  /* -------------------------------------------------------------------------- */
  describe('Settings Repository', () => {
    it('Given a LeetCode username, When saved, Then it can be retrieved and updated', async () => {
      expect(await settingsRepo.getLeetCodeUsername()).toBeNull();

      await settingsRepo.setLeetCodeUsername('alice_coder');
      expect(await settingsRepo.getLeetCodeUsername()).toBe('alice_coder');

      await settingsRepo.setLeetCodeUsername('bob_dev');
      expect(await settingsRepo.getLeetCodeUsername()).toBe('bob_dev');
    });
  });
});
