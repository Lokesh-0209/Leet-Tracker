/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteDatabase, type SqliteDatabasePort } from '../../db/sqliteDatabase.js';
import { runMigrations } from '../../db/schema.js';
import { SqliteProblemRepository } from '../../repositories/sqliteProblemRepository.js';
import { SqliteSettingsRepository } from '../../repositories/settingsRepository.js';
import { BackupService } from '../backupService.js';
import { FrozenClock, ValidationError, type Problem, type Note, type Review } from '../../domain/index.js';

describe('BackupService', () => {
  let db: SqliteDatabasePort;
  let problemRepo: SqliteProblemRepository;
  let settingsRepo: SqliteSettingsRepository;
  let clock: FrozenClock;
  let backupService: BackupService;

  beforeEach(() => {
    db = createSqliteDatabase(':memory:');
    runMigrations(db);
    problemRepo = new SqliteProblemRepository(db);
    settingsRepo = new SqliteSettingsRepository(db);
    clock = new FrozenClock('2026-10-17T12:00:00.000Z');
    backupService = new BackupService(db, problemRepo, settingsRepo, clock);
  });

  it('Given populated database with active and soft-deleted problems, multiple approaches, and reviews, When exported and imported into empty database, Then gives identical data', async () => {
    // 1. Seed initial data
    await settingsRepo.setLeetCodeUsername('alice_coder');

    const activeProblem: Problem = {
      id: 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
      platform: 'LEETCODE',
      slug: 'two-sum',
      title: 'Two Sum',
      difficulty: 'Easy',
      url: 'https://leetcode.com/problems/two-sum/',
      solvedAt: '2026-10-15T10:00:00.000Z',
      status: 'ACTIVE',
      enrolledAt: '2026-10-15T12:00:00.000Z',
      deletedAt: null,
    };
    await problemRepo.create(activeProblem);

    const activeNote: Note = {
      problemId: activeProblem.id,
      approaches: [
        {
          id: 'app-1',
          title: 'Brute Force',
          body: 'Your approach:\nDouble loop\n\nActual approach:\nHash table\n\nMistakes:\nNone\n\nTime Complexity: O(n^2)\n\nSpace Complexity: O(1)',
        },
        {
          id: 'app-2',
          title: 'Hash Map Optimal',
          body: 'Your approach:\nHash map\n\nActual approach:\nHash map\n\nMistakes:\nNone\n\nTime Complexity: O(n)\n\nSpace Complexity: O(n)',
        },
      ],
      updatedAt: '2026-10-15T12:05:00.000Z',
    };
    await problemRepo.saveNote(activeNote);

    const activeReviews: Review[] = [
      { problemId: activeProblem.id, stage: 1, dueDate: '2026-10-16', completedAt: '2026-10-16T09:00:00.000Z' },
      { problemId: activeProblem.id, stage: 2, dueDate: '2026-10-18', completedAt: null },
      { problemId: activeProblem.id, stage: 3, dueDate: '2026-10-22', completedAt: null },
    ];
    await problemRepo.saveReviews(activeReviews);

    const deletedProblem: Problem = {
      id: 'b2c3d4e5-f6a1-4b2c-9d3e-4f5a6b7c8d9e',
      platform: 'LEETCODE',
      slug: 'add-two-numbers',
      title: 'Add Two Numbers',
      difficulty: 'Medium',
      url: 'https://leetcode.com/problems/add-two-numbers/',
      solvedAt: '2026-10-14T08:00:00.000Z',
      status: 'INBOX',
      enrolledAt: null,
      deletedAt: '2026-10-16T14:00:00.000Z',
    };
    await problemRepo.create(deletedProblem);

    // 2. Export backup
    const backup = await backupService.exportBackup();
    expect(backup.version).toBe(1);
    expect(backup.settings.username).toBe('alice_coder');
    expect(backup.problems).toHaveLength(2);

    // 3. Create fresh empty database
    const db2 = createSqliteDatabase(':memory:');
    runMigrations(db2);
    const problemRepo2 = new SqliteProblemRepository(db2);
    const settingsRepo2 = new SqliteSettingsRepository(db2);
    const backupService2 = new BackupService(db2, problemRepo2, settingsRepo2, clock);

    // 4. Restore into empty database
    const result = await backupService2.restoreBackup(backup);
    expect(result.restoredCount).toBe(2);

    // 5. Assert identical state
    const restoredUsername = await settingsRepo2.getLeetCodeUsername();
    expect(restoredUsername).toBe('alice_coder');

    const restoredAggregates = await problemRepo2.listAggregates({ includeDeleted: true });
    expect(restoredAggregates).toHaveLength(2);

    const restoredActive = restoredAggregates.find((a) => a.problem.id === activeProblem.id);
    expect(restoredActive).toBeDefined();
    expect(restoredActive?.problem).toEqual(activeProblem);
    expect(restoredActive?.note).toEqual(activeNote);
    expect(restoredActive?.reviews).toEqual(activeReviews);
    expect(restoredActive?.note?.approaches).toHaveLength(2);

    const restoredDeleted = restoredAggregates.find((a) => a.problem.id === deletedProblem.id);
    expect(restoredDeleted).toBeDefined();
    expect(restoredDeleted?.problem).toEqual(deletedProblem);
    expect(restoredDeleted?.problem.deletedAt).toBe('2026-10-16T14:00:00.000Z');
  });

  it('Given an invalid backup file (missing required fields or invalid schema), When restore is attempted, Then throws ValidationError and changes nothing in database', async () => {
    // Seed initial data
    await settingsRepo.setLeetCodeUsername('original_user');
    const existingProblem: Problem = {
      id: 'c3d4e5f6-a1b2-4c3d-8e4f-5a6b7c8d9e0f',
      platform: 'LEETCODE',
      slug: 'valid-parentheses',
      title: 'Valid Parentheses',
      difficulty: 'Easy',
      url: 'https://leetcode.com/problems/valid-parentheses/',
      solvedAt: '2026-10-16T10:00:00.000Z',
      status: 'INBOX',
      enrolledAt: null,
      deletedAt: null,
    };
    await problemRepo.create(existingProblem);

    // Invalid payload missing version and valid problem structures
    const invalidPayload = {
      version: 999, // unsupported version
      problems: 'not-an-array',
    };

    await expect(backupService.restoreBackup(invalidPayload)).rejects.toThrow(ValidationError);

    // Verify existing database data is completely untouched
    expect(await settingsRepo.getLeetCodeUsername()).toBe('original_user');
    const problems = await problemRepo.list();
    expect(problems).toHaveLength(1);
    expect(problems[0].id).toBe(existingProblem.id);
  });

  it('Given a restore payload that causes a database constraint error midway, Then the transaction rolls back and preserves all prior data', async () => {
    // Seed initial data
    await settingsRepo.setLeetCodeUsername('safe_user');
    const safeProblem: Problem = {
      id: 'd4e5f6a1-b2c3-4d4e-9f5a-6b7c8d9e0f1a',
      platform: 'LEETCODE',
      slug: 'climbing-stairs',
      title: 'Climbing Stairs',
      difficulty: 'Easy',
      url: 'https://leetcode.com/problems/climbing-stairs/',
      solvedAt: '2026-10-16T10:00:00.000Z',
      status: 'INBOX',
      enrolledAt: null,
      deletedAt: null,
    };
    await problemRepo.create(safeProblem);

    // Payload containing duplicate (platform, slug) which will violate unique constraint on 2nd problem insert
    const payloadWithDuplicateSlugs = {
      version: 1,
      exportedAt: '2026-10-17T12:00:00.000Z',
      settings: { username: 'new_hacked_user' },
      problems: [
        {
          problem: {
            id: '11111111-1111-4111-8111-111111111111',
            platform: 'LEETCODE',
            slug: 'same-slug',
            title: 'Problem 1',
            difficulty: 'Easy',
            url: 'https://leetcode.com/problems/same-slug/',
            solvedAt: '2026-10-17T10:00:00.000Z',
            status: 'INBOX',
            enrolledAt: null,
            deletedAt: null,
          },
          note: null,
          reviews: [],
        },
        {
          problem: {
            id: '22222222-2222-4222-8222-222222222222',
            platform: 'LEETCODE',
            slug: 'same-slug', // duplicate slug causes SQLite UNIQUE constraint failure!
            title: 'Problem 2 Duplicate',
            difficulty: 'Easy',
            url: 'https://leetcode.com/problems/same-slug/',
            solvedAt: '2026-10-17T10:00:00.000Z',
            status: 'INBOX',
            enrolledAt: null,
            deletedAt: null,
          },
          note: null,
          reviews: [],
        },
      ],
    };

    // Attempting restore will fail midway on the 2nd insert
    await expect(backupService.restoreBackup(payloadWithDuplicateSlugs)).rejects.toThrow();

    // Verify atomic rollback: safe_user and safeProblem must still exist intact!
    expect(await settingsRepo.getLeetCodeUsername()).toBe('safe_user');
    const problems = await problemRepo.list();
    expect(problems).toHaveLength(1);
    expect(problems[0].id).toBe(safeProblem.id);
  });
});
