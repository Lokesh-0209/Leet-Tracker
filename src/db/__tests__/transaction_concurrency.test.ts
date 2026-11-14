/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSqliteDatabase, type SqliteDatabasePort } from '../sqliteDatabase.js';
import { runMigrations } from '../schema.js';
import { SqliteProblemRepository } from '../../repositories/sqliteProblemRepository.js';
import { SqliteSettingsRepository } from '../../repositories/settingsRepository.js';
import { BackupService } from '../../services/backupService.js';
import { SystemClock } from '../../domain/clock.js';
import type { Review } from '../../domain/models.js';

describe('SQLite Transaction Concurrency & Completion Verification', () => {
  let db: SqliteDatabasePort;

  beforeEach(() => {
    db = createSqliteDatabase(':memory:');
    runMigrations(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS test_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        val INTEGER NOT NULL
      );
    `);
  });

  afterEach(() => {
    if (!db.isClosed) {
      db.close();
    }
  });

  /* -------------------------------------------------------------------------- */
  /* TEST 1: A second top-level transaction waits until the first completes      */
  /* -------------------------------------------------------------------------- */
  it('Requirement 1: A second top-level transaction waits until the first completes', async () => {
    const events: string[] = [];

    const tx1 = db.transaction(async () => {
      events.push('tx1_start');
      db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('item1', 100);
      await new Promise((r) => setTimeout(r, 25));
      events.push('tx1_end');
      return 'res1';
    });

    const tx2 = db.transaction(async () => {
      events.push('tx2_start');
      db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('item2', 200);
      events.push('tx2_end');
      return 'res2';
    });

    const results = await Promise.all([tx1, tx2]);

    expect(results).toEqual(['res1', 'res2']);
    expect(events).toEqual(['tx1_start', 'tx1_end', 'tx2_start', 'tx2_end']);

    const items = db.prepare<{ name: string; val: number }>('SELECT name, val FROM test_items ORDER BY id').all();
    expect(items).toEqual([
      { name: 'item1', val: 100 },
      { name: 'item2', val: 200 },
    ]);
  });

  /* -------------------------------------------------------------------------- */
  /* TEST 2: A queued transaction completes before its calling operation returns */
  /* -------------------------------------------------------------------------- */
  it('Requirement 2: A queued transaction completes before its calling operation returns', async () => {
    let tx1Finished = false;

    const tx1 = db.transaction(async () => {
      await new Promise((r) => setTimeout(r, 30));
      db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('blocking', 1);
      tx1Finished = true;
    });

    // tx2 is queued while tx1 is in progress
    const runQueuedOp = async () => {
      await db.transaction(async () => {
        expect(tx1Finished).toBe(true);
        db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('queued_complete', 2);
      });
      // Verifies database row is committed BEFORE runQueuedOp returns to caller
      const row = db.prepare<{ val: number }>('SELECT val FROM test_items WHERE name = ?').get('queued_complete');
      expect(row?.val).toBe(2);
      return 'done';
    };

    const [_, result] = await Promise.all([tx1, runQueuedOp()]);
    expect(result).toBe('done');

    const committedRow = db.prepare<{ val: number }>('SELECT val FROM test_items WHERE name = ?').get('queued_complete');
    expect(committedRow?.val).toBe(2);
  });

  /* -------------------------------------------------------------------------- */
  /* TEST 3: A queued transaction failure reaches its original caller           */
  /* -------------------------------------------------------------------------- */
  it('Requirement 3: A queued transaction failure reaches its original caller', async () => {
    const tx1 = db.transaction(async () => {
      await new Promise((r) => setTimeout(r, 20));
      db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('survivor', 1);
    });

    const tx2 = db.transaction(async () => {
      db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('doomed', 999);
      throw new Error('Specific failure in queued transaction');
    });

    await tx1;
    await expect(tx2).rejects.toThrow('Specific failure in queued transaction');

    // Verify rollback: doomed was NOT persisted, survivor was persisted
    const doomed = db.prepare('SELECT * FROM test_items WHERE name = ?').get('doomed');
    expect(doomed).toBeUndefined();

    const survivor = db.prepare('SELECT * FROM test_items WHERE name = ?').get('survivor');
    expect(survivor).toBeDefined();
  });

  /* -------------------------------------------------------------------------- */
  /* TEST 4: restoreBackup() does not report success before restoration commits  */
  /* -------------------------------------------------------------------------- */
  it('Requirement 4: restoreBackup() does not report success before restoration commits', async () => {
    const clock = new SystemClock();
    const problemRepo = new SqliteProblemRepository(db);
    const settingsRepo = new SqliteSettingsRepository(db);
    const backupService = new BackupService(db, problemRepo, settingsRepo, clock);
    const userId = 'user_backup_test';

    // Seed user in database
    db.prepare('INSERT INTO users (id, leetcode_username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)').run(
      userId,
      'test_user',
      'hashed_pwd',
      'salt_val',
      clock.nowIso()
    );

    const backupPayload = {
      version: 1,
      exportedAt: clock.nowIso(),
      settings: { username: 'test_user' },
      problems: [
        {
          problem: {
            id: '11111111-1111-4111-8111-111111111111',
            platform: 'LEETCODE',
            slug: 'two-sum',
            title: 'Two Sum',
            difficulty: 'Easy',
            url: 'https://leetcode.com/problems/two-sum',
            solvedAt: clock.nowIso(),
            status: 'INBOX',
            enrolledAt: null,
            deletedAt: null,
          },
          note: null,
          reviews: [],
        },
      ],
    };

    // Hold database in an async transaction
    let blockerActive = true;
    const blockerTx = db.transaction(async () => {
      await new Promise((r) => setTimeout(r, 30));
      blockerActive = false;
    });

    // Call restoreBackup while blocker is holding the connection
    const restorePromise = backupService.restoreBackup(backupPayload, userId);

    const res = await restorePromise;
    expect(blockerActive).toBe(false);
    expect(res.restoredCount).toBe(1);

    // Verify actual database record exists immediately
    const row = db.prepare<{ slug: string }>('SELECT slug FROM problems WHERE id = ?').get('11111111-1111-4111-8111-111111111111');
    expect(row?.slug).toBe('two-sum');

    await blockerTx;
  });

  /* -------------------------------------------------------------------------- */
  /* TEST 5: saveReviews() does not report success before its writes commit     */
  /* -------------------------------------------------------------------------- */
  it('Requirement 5: saveReviews() does not report success before its writes commit', async () => {
    const clock = new SystemClock();
    const repo = new SqliteProblemRepository(db);
    const userId = 'user_reviews_test';

    // Seed user and problem
    db.prepare('INSERT INTO users (id, leetcode_username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)').run(
      userId,
      'reviews_user',
      'hashed_pwd',
      'salt_val',
      clock.nowIso()
    );

    const problem = await repo.create({
      id: 'prob_reviews_1',
      userId,
      platform: 'LEETCODE',
      slug: 'valid-anagram',
      title: 'Valid Anagram',
      difficulty: 'Easy',
      url: 'https://leetcode.com/problems/valid-anagram',
      solvedAt: clock.nowIso(),
      status: 'ACTIVE',
      enrolledAt: clock.nowIso(),
      deletedAt: null,
    });

    const reviews: Review[] = [
      {
        problemId: problem.id,
        stage: 1,
        dueDate: clock.nowIso(),
        completedAt: null,
      },
    ];

    // Hold database in an async transaction
    let blockerActive = true;
    const blockerTx = db.transaction(async () => {
      await new Promise((r) => setTimeout(r, 30));
      blockerActive = false;
    });

    const savePromise = repo.saveReviews(reviews, userId);
    await savePromise;

    expect(blockerActive).toBe(false);

    // Verify review is in database
    const savedReviews = await repo.getReviews(problem.id, userId);
    expect(savedReviews).toHaveLength(1);
    expect(savedReviews[0].stage).toBe(1);

    await blockerTx;
  });

  /* -------------------------------------------------------------------------- */
  /* TEST 6: enrollProblemAtomic() does not report success before writes commit */
  /* -------------------------------------------------------------------------- */
  it('Requirement 6: enrollProblemAtomic() does not report success before its writes commit', async () => {
    const clock = new SystemClock();
    const repo = new SqliteProblemRepository(db);
    const userId = 'user_enroll_test';

    db.prepare('INSERT INTO users (id, leetcode_username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)').run(
      userId,
      'enroll_user',
      'hashed_pwd',
      'salt_val',
      clock.nowIso()
    );

    const problem = await repo.create({
      id: 'prob_enroll_1',
      userId,
      platform: 'LEETCODE',
      slug: 'group-anagrams',
      title: 'Group Anagrams',
      difficulty: 'Medium',
      url: 'https://leetcode.com/problems/group-anagrams',
      solvedAt: clock.nowIso(),
      status: 'INBOX',
      enrolledAt: null,
      deletedAt: null,
    });

    const now = clock.nowIso();
    const reviews: Review[] = [
      { problemId: problem.id, stage: 1, dueDate: now, completedAt: null },
      { problemId: problem.id, stage: 2, dueDate: now, completedAt: null },
      { problemId: problem.id, stage: 3, dueDate: now, completedAt: null },
    ];

    let blockerActive = true;
    const blockerTx = db.transaction(async () => {
      await new Promise((r) => setTimeout(r, 30));
      blockerActive = false;
    });

    const enrollPromise = repo.enrollProblemAtomic({
      problemId: problem.id,
      userId,
      status: 'ACTIVE',
      enrolledAt: now,
      reviews,
      note: {
        problemId: problem.id,
        approaches: [{ id: 'app1', title: 'Hash Map', body: 'Categorize by sorted string' }],
        updatedAt: now,
      },
    });

    await enrollPromise;
    expect(blockerActive).toBe(false);

    // Verify state committed in database
    const updated = await repo.findById(problem.id, userId);
    expect(updated?.status).toBe('ACTIVE');

    const createdReviews = await repo.getReviews(problem.id, userId);
    expect(createdReviews).toHaveLength(3);

    const note = await repo.getNote(problem.id, userId);
    expect(note?.approaches[0].title).toBe('Hash Map');

    await blockerTx;
  });

  /* -------------------------------------------------------------------------- */
  /* TEST 7: Nested transactions commit correctly                               */
  /* -------------------------------------------------------------------------- */
  it('Requirement 7: Nested transactions commit correctly', async () => {
    await db.transaction(async () => {
      db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('outer_1', 1);

      await db.transaction(async () => {
        db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('nested_1', 2);
      });

      db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('outer_2', 3);
    });

    const rows = db.prepare<{ name: string }>('SELECT name FROM test_items ORDER BY id').all();
    expect(rows.map((r) => r.name)).toEqual(['outer_1', 'nested_1', 'outer_2']);
  });

  /* -------------------------------------------------------------------------- */
  /* TEST 8: Nested failures roll back without corrupting outer transaction     */
  /* -------------------------------------------------------------------------- */
  it('Requirement 8: Nested transaction failures roll back correctly without corrupting the outer transaction', async () => {
    await db.transaction(async () => {
      db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('outer_kept', 10);

      try {
        await db.transaction(async () => {
          db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('nested_reverted', 20);
          throw new Error('Nested transaction abort');
        });
      } catch (err: unknown) {
        expect((err as Error).message).toBe('Nested transaction abort');
      }

      // Synchronous nested failure must also roll back cleanly without deadlocking subsequent nested calls
      expect(() =>
        db.transaction(() => {
          db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('nested_sync_reverted', 25);
          throw new Error('Nested sync abort');
        })
      ).toThrow('Nested sync abort');

      await db.transaction(async () => {
        db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('nested_after_sync_abort', 28);
      });

      db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('outer_continued', 30);
    });

    const rows = db.prepare<{ name: string }>('SELECT name FROM test_items ORDER BY id').all();
    expect(rows.map((r) => r.name)).toEqual([
      'outer_kept',
      'nested_after_sync_abort',
      'outer_continued',
    ]);
  });

  /* -------------------------------------------------------------------------- */
  /* TEST 9: Concurrent nested transactions cannot corrupt savepoint ordering   */
  /* -------------------------------------------------------------------------- */
  it('Requirement 9: Concurrent nested transactions cannot corrupt savepoint ordering', async () => {
    await db.transaction(async () => {
      db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('outer_root', 0);

      // Launch concurrent sibling nested transactions inside the same outer transaction context
      const p1 = db.transaction(async () => {
        await new Promise((r) => setTimeout(r, 20));
        db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('nested_first', 1);
        return 'res_n1';
      });

      const p2 = db.transaction(async () => {
        db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('nested_second', 2);
        return 'res_n2';
      });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect([r1, r2]).toEqual(['res_n1', 'res_n2']);

      db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('outer_after', 3);
    });

    const rows = db.prepare<{ name: string }>('SELECT name FROM test_items ORDER BY id').all();
    expect(rows.map((r) => r.name)).toEqual(['outer_root', 'nested_first', 'nested_second', 'outer_after']);

    // Test with concurrent nested transaction failure
    await db.transaction(async () => {
      const failPromise = db.transaction(async () => {
        await new Promise((r) => setTimeout(r, 15));
        db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('nested_fail', 99);
        throw new Error('Intentional nested failure');
      });

      const passPromise = db.transaction(async () => {
        db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('nested_survivor', 77);
        return 'pass_ok';
      });

      await expect(failPromise).rejects.toThrow('Intentional nested failure');
      const passResult = await passPromise;
      expect(passResult).toBe('pass_ok');
    });

    const failRow = db.prepare('SELECT * FROM test_items WHERE name = ?').get('nested_fail');
    expect(failRow).toBeUndefined();

    const survivorRow = db.prepare('SELECT * FROM test_items WHERE name = ?').get('nested_survivor');
    expect(survivorRow).toBeDefined();
  });

  /* -------------------------------------------------------------------------- */
  /* TEST 10: Closing the database safely handles queued transactions           */
  /* -------------------------------------------------------------------------- */
  it('Requirement 10: Closing the database safely handles queued transactions', async () => {
    const testDb = createSqliteDatabase(':memory:');
    testDb.exec('CREATE TABLE close_test (id INTEGER PRIMARY KEY, msg TEXT);');

    // 1. Start an in-flight transaction that tries to commit after close
    const tx1 = testDb.transaction(async () => {
      testDb.prepare('INSERT INTO close_test (msg) VALUES (?)').run('tx1_data');
      await new Promise((r) => setTimeout(r, 30));
      return 'should_not_commit';
    });

    // 2. Queue a second transaction while tx1 is in flight
    const tx2 = testDb.transaction(async () => {
      testDb.prepare('INSERT INTO close_test (msg) VALUES (?)').run('tx2_data');
    });

    // 3. Queue a third transaction
    const tx3 = testDb.transaction(async () => {
      testDb.prepare('INSERT INTO close_test (msg) VALUES (?)').run('tx3_data');
    });

    // Close the database while transactions are queued
    testDb.close();
    expect(testDb.isClosed).toBe(true);

    // tx2 and tx3 must be rejected safely with Database is closed
    await expect(tx2).rejects.toThrow('Database is closed');
    await expect(tx3).rejects.toThrow('Database is closed');
    // In-flight tx1 must not report success after DB was closed before commit
    await expect(tx1).rejects.toThrow('Database is closed');

    // Any new transaction attempted on closed DB must immediately throw
    expect(() => testDb.transaction(() => 123)).toThrow('Database is closed');
    expect(() => testDb.transaction(async () => 123)).toThrow('Database is closed');
  });

  /* -------------------------------------------------------------------------- */
  /* TEST 11: Separate database instances do not block or interfere with each other */
  /* -------------------------------------------------------------------------- */
  it('Requirement 11: Separate database instances do not block or interfere with each other', async () => {
    const db2 = createSqliteDatabase(':memory:');
    db2.exec('CREATE TABLE db2_items (id INTEGER PRIMARY KEY, msg TEXT);');

    const results = await Promise.all([
      db.transaction(async () => {
        await new Promise((r) => setTimeout(r, 20));
        db.prepare('INSERT INTO test_items (name, val) VALUES (?, ?)').run('db1_item', 1);
        return 'db1_done';
      }),
      db2.transaction(async () => {
        await new Promise((r) => setTimeout(r, 20));
        db2.prepare('INSERT INTO db2_items (msg) VALUES (?)').run('db2_item');
        return 'db2_done';
      }),
    ]);

    expect(results).toEqual(['db1_done', 'db2_done']);

    const row1 = db.prepare('SELECT name FROM test_items WHERE name = ?').get('db1_item');
    expect(row1).toBeDefined();

    const row2 = db2.prepare('SELECT msg FROM db2_items WHERE msg = ?').get('db2_item');
    expect(row2).toBeDefined();

    db2.close();
  });
});
