/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteDatabase, type SqliteDatabasePort } from '../../db/sqliteDatabase.js';
import { runMigrations } from '../../db/schema.js';
import { SqliteProblemRepository } from '../../repositories/sqliteProblemRepository.js';
import { SqliteSettingsRepository } from '../../repositories/settingsRepository.js';
import {
  SyncService,
  ProblemService,
  LeetCodeProblemSource,
  parseLeetCodeInput,
  slugToTitle,
  type HttpClient,
  type HttpResponse,
  type HttpRequestOptions,
  type ProblemSource,
} from '../index.js';
import {
  PLATFORMS,
  PROBLEM_STATUSES,
  FrozenClock,
  InvalidUsernameError,
  PrivateOrEmptyProfileError,
  RateLimitedError,
  UpstreamSchemaChangedError,
  ValidationError,
  type SolvedProblem,
} from '../../domain/index.js';

/* -------------------------------------------------------------------------- */
/* FAKE HTTP CLIENT FOR TESTING LEETCODE GRAPHQL ADAPTER                     */
/* -------------------------------------------------------------------------- */
class FakeHttpClient implements HttpClient {
  public postResponses: HttpResponse<unknown>[] = [];
  public postHandler?: (
    url: string,
    body: unknown
  ) => HttpResponse<unknown> | Promise<HttpResponse<unknown>>;

  public async post<T = unknown>(
    url: string,
    body: unknown,
    _options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    if (this.postHandler) {
      const result = await this.postHandler(url, body);
      return result as HttpResponse<T>;
    }
    const resp = this.postResponses.shift();
    if (!resp) {
      throw new Error(`Unexpected POST request to ${url}`);
    }
    return resp as HttpResponse<T>;
  }

  public async get<T = unknown>(
    url: string,
    _options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    throw new Error(`Unexpected GET request to ${url}`);
  }
}

/* -------------------------------------------------------------------------- */
/* FAKE PROBLEM SOURCE FOR TESTING SERVICES INDEPENDENTLY                    */
/* -------------------------------------------------------------------------- */
class FakeProblemSource implements ProblemSource {
  public readonly platform = PLATFORMS.LEETCODE;
  public solvedProblems: SolvedProblem[] = [];
  public questions = new Map<string, { title: string; difficulty: 'Easy' | 'Medium' | 'Hard' }>();
  public shouldFail = false;

  public async fetchSolved(_username: string): Promise<SolvedProblem[]> {
    if (this.shouldFail) {
      throw new Error('Problem source fetch failure');
    }
    return this.solvedProblems;
  }

  public async lookupProblem(
    slug: string
  ): Promise<{ title: string; difficulty: 'Easy' | 'Medium' | 'Hard' } | null> {
    if (this.shouldFail) {
      throw new Error('Lookup service down');
    }
    return this.questions.get(slug) || null;
  }
}

describe('Phase 4: ProblemSource, LeetCode Fetcher, SyncService & ProblemService', () => {
  let db: SqliteDatabasePort;
  let repo: SqliteProblemRepository;
  let settingsRepo: SqliteSettingsRepository;
  let clock: FrozenClock;
  let fakeSource: FakeProblemSource;
  let syncService: SyncService;
  let problemService: ProblemService;

  beforeEach(() => {
    db = createSqliteDatabase(':memory:');
    runMigrations(db);
    repo = new SqliteProblemRepository(db);
    settingsRepo = new SqliteSettingsRepository(db);
    clock = new FrozenClock('2026-10-16T10:00:00Z', 'UTC');
    fakeSource = new FakeProblemSource();
    syncService = new SyncService(repo, fakeSource, settingsRepo);
    problemService = new ProblemService(repo, fakeSource, clock);
  });

  /* -------------------------------------------------------------------------- */
  /* 1. LEETCODE GRAPHQL ADAPTER & ERROR MAPPINGS                               */
  /* -------------------------------------------------------------------------- */
  describe('LeetCode Problem Source & Upstream Error Mappings', () => {
    it('Given a non-existent LeetCode username, When fetching, Then it maps to InvalidUsernameError (INVALID_USERNAME)', async () => {
      const fakeHttp = new FakeHttpClient();
      fakeHttp.postResponses.push({
        status: 200,
        headers: {},
        data: {
          data: {
            matchedUser: null,
            recentAcSubmissionList: null,
          },
        },
      });

      const source = new LeetCodeProblemSource(fakeHttp);
      await expect(source.fetchSolved('non_existent_user_99999')).rejects.toThrow(
        InvalidUsernameError
      );
    });

    it('Given a private or empty LeetCode profile, When fetching, Then it maps to PrivateOrEmptyProfileError', async () => {
      const fakeHttp = new FakeHttpClient();
      fakeHttp.postResponses.push({
        status: 200,
        headers: {},
        data: {
          data: {
            matchedUser: { username: 'private_user' },
            recentAcSubmissionList: [],
          },
        },
      });

      const source = new LeetCodeProblemSource(fakeHttp);
      await expect(source.fetchSolved('private_user')).rejects.toThrow(
        PrivateOrEmptyProfileError
      );
    });

    it('Given LeetCode responds with HTTP 429, When fetching, Then it maps to RateLimitedError (RATE_LIMITED, retryable: true)', async () => {
      const fakeHttp = new FakeHttpClient();
      fakeHttp.postResponses.push({
        status: 429,
        headers: {},
        data: { error: 'Too many requests' },
      });

      const source = new LeetCodeProblemSource(fakeHttp);
      try {
        await source.fetchSolved('testuser');
        expect.unreachable('Should have thrown RateLimitedError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(RateLimitedError);
        expect((err as RateLimitedError).code).toBe('RATE_LIMITED');
        expect((err as RateLimitedError).retryable).toBe(true);
      }
    });

    it('Given a malformed upstream payload, When validating schema, Then it yields UpstreamSchemaChangedError', async () => {
      const fakeHttp = new FakeHttpClient();
      fakeHttp.postResponses.push({
        status: 200,
        headers: {},
        data: {
          data: {
            matchedUser: { username: 'testuser' },
            recentAcSubmissionList: 'INVALID_NOT_AN_ARRAY', // Malformed!
          },
        },
      });

      const source = new LeetCodeProblemSource(fakeHttp);
      await expect(source.fetchSolved('testuser')).rejects.toThrow(
        UpstreamSchemaChangedError
      );
    });

    it('Given duplicate submissions in fetch results, When processed, Then it dedupes by slug and keeps latest solvedAt', async () => {
      const fakeHttp = new FakeHttpClient();
      // First POST is recentAcSubmissions
      fakeHttp.postResponses.push({
        status: 200,
        headers: {},
        data: {
          data: {
            matchedUser: { username: 'alex' },
            recentAcSubmissionList: [
              { title: 'Two Sum', titleSlug: 'two-sum', timestamp: '1700000000' }, // Older
              { title: 'Two Sum', titleSlug: 'two-sum', timestamp: '1700000999' }, // LATEST
              { title: '3Sum', titleSlug: '3sum', timestamp: '1699999000' },
            ],
          },
        },
      });

      // Next POSTs are question difficulty lookups for two-sum and 3sum
      fakeHttp.postResponses.push({
        status: 200,
        headers: {},
        data: {
          data: {
            question: { title: 'Two Sum', titleSlug: 'two-sum', difficulty: 'Easy' },
          },
        },
      });
      fakeHttp.postResponses.push({
        status: 200,
        headers: {},
        data: {
          data: {
            question: { title: '3Sum', titleSlug: '3sum', difficulty: 'Medium' },
          },
        },
      });

      const source = new LeetCodeProblemSource(fakeHttp);
      const solved = await source.fetchSolved('alex');

      expect(solved).toHaveLength(2);
      const twoSum = solved.find((s) => s.slug === 'two-sum');
      expect(twoSum).toBeDefined();
      expect(twoSum?.difficulty).toBe('Easy');
      // Must keep latest timestamp (1700000999s -> ISO)
      expect(twoSum?.solvedAt).toBe(new Date(1700000999 * 1000).toISOString());
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. SYNC SERVICE BEHAVIOR                                                   */
  /* -------------------------------------------------------------------------- */
  describe('SyncService', () => {
    it('Given a soft-deleted problem, When sync runs with that problem in upstream results, Then sync does NOT resurrect it', async () => {
      // 1. Problem exists and was soft-deleted
      await repo.create({
        id: 'del-resurrect-id',
        platform: 'LEETCODE',
        slug: 'two-sum',
        title: 'Two Sum',
        difficulty: 'Easy',
        url: 'https://leetcode.com/problems/two-sum/',
        solvedAt: '2026-10-10T00:00:00Z',
        status: PROBLEM_STATUSES.INBOX,
        enrolledAt: null,
        deletedAt: '2026-10-15T12:00:00Z', // Deleted!
      });

      // 2. LeetCode returns two-sum in solved problems
      fakeSource.solvedProblems = [
        {
          platform: 'LEETCODE',
          slug: 'two-sum',
          title: 'Two Sum',
          difficulty: 'Easy',
          url: 'https://leetcode.com/problems/two-sum/',
          solvedAt: '2026-10-16T00:00:00Z',
        },
      ];

      // 3. Run sync
      const result = await syncService.sync('testuser');

      expect(result).toEqual({
        added: 0,
        alreadyKnown: 0,
        skippedDeleted: 1, // Correctly skipped and counted!
      });

      // 4. Confirm problem is STILL soft-deleted
      const stored = await repo.findByPlatformAndSlug('LEETCODE', 'two-sum');
      expect(stored?.deletedAt).toBe('2026-10-15T12:00:00Z');
    });

    it('Given existing problems in DB, When sync runs with 0 new problems, Then counts reflect 0 added and N alreadyKnown', async () => {
      await repo.create({
        id: 'p-1',
        platform: 'LEETCODE',
        slug: 'merge-intervals',
        title: 'Merge Intervals',
        difficulty: 'Medium',
        url: 'https://leetcode.com/problems/merge-intervals/',
        solvedAt: '2026-10-14T00:00:00Z',
        status: PROBLEM_STATUSES.ACTIVE,
        enrolledAt: '2026-10-15T00:00:00Z',
        deletedAt: null,
      });

      fakeSource.solvedProblems = [
        {
          platform: 'LEETCODE',
          slug: 'merge-intervals',
          title: 'Merge Intervals',
          difficulty: 'Medium',
          url: 'https://leetcode.com/problems/merge-intervals/',
          solvedAt: '2026-10-14T00:00:00Z',
        },
      ];

      const res = await syncService.sync('testuser');
      expect(res).toEqual({
        added: 0,
        alreadyKnown: 1,
        skippedDeleted: 0,
      });

      // Existing status and enrolledAt are completely preserved
      const stored = await repo.findById('p-1');
      expect(stored?.status).toBe(PROBLEM_STATUSES.ACTIVE);
      expect(stored?.enrolledAt).toBe('2026-10-15T00:00:00Z');
    });

    it('Given a network failure mid-sync, When transaction fails, Then zero partial writes remain in DB', async () => {
      fakeSource.solvedProblems = [
        {
          platform: 'LEETCODE',
          slug: 'problem-1',
          title: 'Problem 1',
          difficulty: 'Easy',
          url: 'https://leetcode.com/problems/problem-1/',
          solvedAt: '2026-10-16T00:00:00Z',
        },
        {
          platform: 'LEETCODE',
          slug: 'problem-2',
          title: 'Problem 2',
          difficulty: 'Medium',
          url: 'https://leetcode.com/problems/problem-2/',
          solvedAt: '2026-10-16T00:00:00Z',
        },
      ];

      // Simulate a failure on the second create call by replacing repository create with failure
      const originalCreate = repo.create.bind(repo);
      let callCount = 0;
      repo.create = async (p) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Database disk error mid-sync');
        }
        return originalCreate(p);
      };

      await expect(syncService.sync('testuser')).rejects.toThrow('Database disk error mid-sync');

      // Verify transaction rollback: problem-1 was NOT saved!
      repo.create = originalCreate;
      const allProblems = await repo.list();
      expect(allProblems).toHaveLength(0);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. MANUAL ADD & URL PARSER                                                 */
  /* -------------------------------------------------------------------------- */
  describe('Manual Add and URL Parsing', () => {
    it('Given a soft-deleted problem, When manually adding the same slug, Then it restores the problem', async () => {
      await repo.create({
        id: 'del-manual-id',
        platform: 'LEETCODE',
        slug: 'lru-cache',
        title: 'LRU Cache',
        difficulty: 'Medium',
        url: 'https://leetcode.com/problems/lru-cache/',
        solvedAt: '2026-10-10T00:00:00Z',
        status: PROBLEM_STATUSES.INBOX,
        enrolledAt: null,
        deletedAt: '2026-10-15T12:00:00Z',
      });

      const restored = await problemService.manualAdd({
        urlOrSlug: 'https://leetcode.com/problems/lru-cache/',
      });

      expect(restored.id).toBe('del-manual-id');
      expect(restored.deletedAt).toBeNull();

      const stored = await repo.findById('del-manual-id');
      expect(stored?.deletedAt).toBeNull();
    });

    it('Given an already active problem, When manually adding the same slug, Then it throws ValidationError', async () => {
      await repo.create({
        id: 'active-slug-id',
        platform: 'LEETCODE',
        slug: 'valid-anagram',
        title: 'Valid Anagram',
        difficulty: 'Easy',
        url: 'https://leetcode.com/problems/valid-anagram/',
        solvedAt: '2026-10-10T00:00:00Z',
        status: PROBLEM_STATUSES.INBOX,
        enrolledAt: null,
        deletedAt: null,
      });

      await expect(
        problemService.manualAdd({ urlOrSlug: 'valid-anagram' })
      ).rejects.toThrow(ValidationError);
    });

    it('Given the LeetCode source is down, When manually adding with user-supplied difficulty, Then it derives title and adds problem successfully', async () => {
      // Simulate LeetCode source being offline
      fakeSource.shouldFail = true;

      const added = await problemService.manualAdd({
        urlOrSlug: 'trapping-rain-water',
        difficulty: 'Hard',
      });

      expect(added.slug).toBe('trapping-rain-water');
      expect(added.title).toBe('Trapping Rain Water');
      expect(added.difficulty).toBe('Hard');
      expect(added.status).toBe(PROBLEM_STATUSES.INBOX);
    });

    it('Given the LeetCode source is down, When manually adding without difficulty, Then it throws ValidationError requiring difficulty', async () => {
      fakeSource.shouldFail = true;

      await expect(
        problemService.manualAdd({ urlOrSlug: 'trapping-rain-water' })
      ).rejects.toThrow(/difficulty/i);
    });

    it('Given all URL variants, When parsing, Then it extracts correct slug and canonical URL', () => {
      // Plain slug
      expect(parseLeetCodeInput('two-sum')).toEqual({
        slug: 'two-sum',
        canonicalUrl: 'https://leetcode.com/problems/two-sum/',
      });

      // Standard URL with trailing slash
      expect(parseLeetCodeInput('https://leetcode.com/problems/two-sum/')).toEqual({
        slug: 'two-sum',
        canonicalUrl: 'https://leetcode.com/problems/two-sum/',
      });

      // Without trailing slash
      expect(parseLeetCodeInput('http://leetcode.com/problems/two-sum')).toEqual({
        slug: 'two-sum',
        canonicalUrl: 'https://leetcode.com/problems/two-sum/',
      });

      // Mixed-case host, query parameters, /description/ suffix
      expect(
        parseLeetCodeInput(
          'HTTPS://LEETCODE.COM/problems/two-sum/description/?envType=study-plan-v2'
        )
      ).toEqual({
        slug: 'two-sum',
        canonicalUrl: 'https://leetcode.com/problems/two-sum/',
      });

      // www subdomain
      expect(
        parseLeetCodeInput('https://www.leetcode.com/problems/reverse-linked-list/description/')
      ).toEqual({
        slug: 'reverse-linked-list',
        canonicalUrl: 'https://leetcode.com/problems/reverse-linked-list/',
      });
    });

    it('Given a non-LeetCode URL, When parsing, Then it throws ValidationError', () => {
      expect(() => parseLeetCodeInput('https://codeforces.com/problem/123')).toThrow(
        ValidationError
      );
      expect(() => parseLeetCodeInput('https://geeksforgeeks.org/problems/two-sum')).toThrow(
        ValidationError
      );
    });

    it('Given slugToTitle, When invoked, Then it formats titles cleanly', () => {
      expect(slugToTitle('two-sum')).toBe('Two Sum');
      expect(slugToTitle('median-of-two-sorted-arrays')).toBe('Median Of Two Sorted Arrays');
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. NETWORK ERROR & TIMEOUT TESTS (RETRYABLE)                               */
  /* -------------------------------------------------------------------------- */
  describe('Network Errors and Lookup Concurrency', () => {
    it('Given fetch throws a network exception, When calling problem source, Then it wraps in NetworkError with retryable: true', async () => {
      const fakeHttp = new FakeHttpClient();
      fakeHttp.postHandler = () => {
        throw new Error('ECONNREFUSED 127.0.0.1:443');
      };

      const source = new LeetCodeProblemSource(fakeHttp);
      try {
        await source.fetchSolved('testuser');
        expect.unreachable('Should have thrown NetworkError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        expect((err as { code?: string }).code).toBe('NETWORK_ERROR');
        expect((err as { retryable?: boolean }).retryable).toBe(true);
      }
    });

    it('Given a request timeout (AbortError), When calling problem source, Then it wraps in NetworkError with retryable: true', async () => {
      const fakeHttp = new FakeHttpClient();
      fakeHttp.postHandler = () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      };

      const source = new LeetCodeProblemSource(fakeHttp);
      try {
        await source.fetchSolved('testuser');
        expect.unreachable('Should have thrown NetworkError');
      } catch (err: unknown) {
        expect((err as { code?: string }).code).toBe('NETWORK_ERROR');
        expect((err as { retryable?: boolean }).retryable).toBe(true);
      }
    });

    it('Given multiple difficulty lookups, When running, Then concurrency is bounded to at most 3 at a time', async () => {
      const fakeHttp = new FakeHttpClient();
      fakeHttp.postResponses.push({
        status: 200,
        headers: {},
        data: {
          data: {
            matchedUser: { username: 'testuser' },
            recentAcSubmissionList: [
              { title: 'P1', titleSlug: 'p-1', timestamp: '1700000000' },
              { title: 'P2', titleSlug: 'p-2', timestamp: '1700000000' },
              { title: 'P3', titleSlug: 'p-3', timestamp: '1700000000' },
              { title: 'P4', titleSlug: 'p-4', timestamp: '1700000000' },
              { title: 'P5', titleSlug: 'p-5', timestamp: '1700000000' },
            ],
          },
        },
      });

      let activeRequests = 0;
      let maxConcurrent = 0;

      fakeHttp.postHandler = async (url, body) => {
        // First request is submissions query
        const queryStr = (body as { query: string }).query;
        if (queryStr.includes('recentAcSubmissions')) {
          return {
            status: 200,
            headers: {},
            data: {
              data: {
                matchedUser: { username: 'testuser' },
                recentAcSubmissionList: [
                  { title: 'P1', titleSlug: 'p-1', timestamp: '1700000000' },
                  { title: 'P2', titleSlug: 'p-2', timestamp: '1700000000' },
                  { title: 'P3', titleSlug: 'p-3', timestamp: '1700000000' },
                  { title: 'P4', titleSlug: 'p-4', timestamp: '1700000000' },
                  { title: 'P5', titleSlug: 'p-5', timestamp: '1700000000' },
                ],
              },
            },
          };
        }

        activeRequests++;
        maxConcurrent = Math.max(maxConcurrent, activeRequests);
        // Small async delay
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeRequests--;

        return {
          status: 200,
          headers: {},
          data: {
            data: {
              question: { title: 'Problem', titleSlug: 'slug', difficulty: 'Easy' },
            },
          },
        };
      };

      const source = new LeetCodeProblemSource(fakeHttp);
      const solved = await source.fetchSolved('testuser');

      expect(solved).toHaveLength(5);
      // Concurrency must not exceed 3
      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });

    it('Given one difficulty lookup fails mid-sync, Then whole sync fails and leaves zero partial writes in DB', async () => {
      const fakeHttp = new FakeHttpClient();
      let lookupCount = 0;

      fakeHttp.postHandler = async (_url, body) => {
        const queryStr = (body as { query: string }).query;
        if (queryStr.includes('recentAcSubmissions')) {
          return {
            status: 200,
            headers: {},
            data: {
              data: {
                matchedUser: { username: 'testuser' },
                recentAcSubmissionList: [
                  { title: 'P1', titleSlug: 'p-1', timestamp: '1700000000' },
                  { title: 'P2', titleSlug: 'p-2', timestamp: '1700000000' },
                ],
              },
            },
          };
        }

        lookupCount++;
        if (lookupCount === 2) {
          throw new Error('Network dropout during second difficulty lookup');
        }

        return {
          status: 200,
          headers: {},
          data: {
            data: {
              question: { title: 'P1', titleSlug: 'p-1', difficulty: 'Easy' },
            },
          },
        };
      };

      const sourceWithFailingLookup = new LeetCodeProblemSource(fakeHttp);
      const testSyncService = new SyncService(repo, sourceWithFailingLookup, settingsRepo);

      await expect(testSyncService.sync('testuser')).rejects.toThrow();

      // Ensure zero partial problems written to database
      const all = await repo.list();
      expect(all).toHaveLength(0);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 5. PROBLEM SERVICE: LIFECYCLE, NOTES & REVIEWS                             */
  /* -------------------------------------------------------------------------- */
  describe('ProblemService Lifecycle, Notes & Reviews', () => {
    it('Given a problem in INBOX, When saving note with invalid complexity, Then gate rejects and problem stays INBOX', async () => {
      const problem = await problemService.manualAdd({
        urlOrSlug: 'two-sum',
        title: 'Two Sum',
        difficulty: 'Easy',
      });
      expect(problem.status).toBe(PROBLEM_STATUSES.INBOX);

      // Attempt to save incomplete note
      await expect(
        problemService.saveNote(problem.id, [
          { id: 'app-1', title: 'Approach 1', body: 'Missing complexity labels' },
        ])
      ).rejects.toThrow(ValidationError);

      const check = await repo.findById(problem.id);
      expect(check?.status).toBe(PROBLEM_STATUSES.INBOX);
      expect(check?.enrolledAt).toBeNull();
    });

    it('Given a problem in INBOX, When saving note passing gate, Then it atomically enrolls problem (INBOX -> ACTIVE) and creates 3 reviews', async () => {
      const problem = await problemService.manualAdd({
        urlOrSlug: 'two-sum',
        title: 'Two Sum',
        difficulty: 'Easy',
      });

      const aggregate = await problemService.saveNote(
        problem.id,
        [
          {
            id: 'app-1',
            title: 'Approach 1',
            body: 'Time Complexity: O(n)\nSpace Complexity: O(n)',
          },
        ],
        'UTC'
      );

      expect(aggregate.problem.status).toBe(PROBLEM_STATUSES.ACTIVE);
      expect(aggregate.problem.enrolledAt).toBe('2026-10-16T10:00:00.000Z');
      expect(aggregate.reviews).toHaveLength(3);
      expect(aggregate.reviews[0].dueDate).toBe('2026-10-17');
      expect(aggregate.reviews[1].dueDate).toBe('2026-10-19');
      expect(aggregate.reviews[2].dueDate).toBe('2026-10-23');
    });

    it('Given an ACTIVE problem, When editing notes, Then gate re-validates Approach 1 preventing removal of complexity', async () => {
      const problem = await problemService.manualAdd({
        urlOrSlug: 'two-sum',
        title: 'Two Sum',
        difficulty: 'Easy',
      });
      await problemService.saveNote(
        problem.id,
        [{ id: 'app-1', title: 'Approach 1', body: 'Time Complexity: O(1)\nSpace Complexity: O(1)' }],
        'UTC'
      );

      // Valid edit of active problem
      const updated = await problemService.saveNote(problem.id, [
        { id: 'app-1', title: 'Approach 1', body: 'Time Complexity: O(N)\nSpace Complexity: O(log N)' },
        { id: 'app-2', title: 'Approach 2', body: 'Secondary method' },
      ]);
      expect(updated.note?.approaches).toHaveLength(2);

      // Attempt to remove complexity on active problem: must be rejected!
      await expect(
        problemService.saveNote(problem.id, [
          { id: 'app-1', title: 'Approach 1', body: 'Removed complexity here' },
        ])
      ).rejects.toThrow(ValidationError);
    });

    it('Given an ACTIVE problem, When completing reviews through Stage 3, Then status moves to FULLY_SOLVED', async () => {
      const problem = await problemService.manualAdd({
        urlOrSlug: 'two-sum',
        title: 'Two Sum',
        difficulty: 'Easy',
      });
      await problemService.saveNote(
        problem.id,
        [{ id: 'app-1', title: 'Approach 1', body: 'Time Complexity: O(1)\nSpace Complexity: O(1)' }],
        'UTC'
      );

      // Complete stages 1, 2, 3
      await problemService.completeReview(problem.id, 1);
      await problemService.completeReview(problem.id, 2);
      const stage3Res = await problemService.completeReview(problem.id, 3);

      expect(stage3Res.problem.status).toBe(PROBLEM_STATUSES.FULLY_SOLVED);

      // Undo Stage 3: moves FULLY_SOLVED -> ACTIVE
      const undoRes = await problemService.undoReview(problem.id, 3);
      expect(undoRes.problem.status).toBe(PROBLEM_STATUSES.ACTIVE);
      expect(undoRes.reviews[2].completedAt).toBeNull();
    });

    it('Given softDelete, restore, and permanentDelete, When invoked, Then states update correctly', async () => {
      const problem = await problemService.manualAdd({
        urlOrSlug: 'delete-test-slug',
        title: 'Delete Test',
        difficulty: 'Easy',
      });

      // Soft delete
      await problemService.softDelete(problem.id);
      let p = await repo.findById(problem.id);
      expect(p?.deletedAt).toBe('2026-10-16T10:00:00.000Z');

      // Restore
      await problemService.restore(problem.id);
      p = await repo.findById(problem.id);
      expect(p?.deletedAt).toBeNull();

      // Permanent delete
      await problemService.hardDelete(problem.id);
      p = await repo.findById(problem.id);
      expect(p).toBeNull();
    });
  });

});
