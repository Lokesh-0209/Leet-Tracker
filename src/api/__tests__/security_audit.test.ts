/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSqliteDatabase, type SqliteDatabasePort } from '../../db/sqliteDatabase.js';
import { runMigrations } from '../../db/schema.js';
import { SqliteProblemRepository } from '../../repositories/sqliteProblemRepository.js';
import { SqliteSettingsRepository } from '../../repositories/settingsRepository.js';
import { SqliteUserRepository } from '../../repositories/userRepository.js';
import { SqliteSessionRepository } from '../../repositories/sessionRepository.js';
import { SqliteVerificationRepository } from '../../repositories/verificationRepository.js';
import { AuthService, getVerificationSecret, hashVerificationCode } from '../../services/authService.js';
import { ProblemService } from '../../services/problemService.js';
import { SyncService } from '../../services/syncService.js';
import { BackupService } from '../../services/backupService.js';
import { globalRateLimiter } from '../../services/rateLimiter.js';
import { FrozenClock } from '../../domain/clock.js';
import { ValidationError } from '../../domain/errors.js';
import { PROBLEM_STATUSES } from '../../domain/constants.js';
import type { ProblemSource } from '../../services/problemSource.js';
import type { HttpClient, HttpResponse } from '../../services/httpClient.js';
import type { User } from '../../domain/models.js';
import { createApiApp } from '../app.js';

class MockLeetCodeHttpClient implements HttpClient {
  public mockAboutMe = '';
  public mockUserExists = true;

  public async get<T = unknown>(): Promise<HttpResponse<T>> {
    throw new Error('Not implemented');
  }

  public async post<T = unknown>(_url: string, body: unknown): Promise<HttpResponse<T>> {
    const payload = body as { query?: string; variables?: { username?: string } };
    const username = payload.variables?.username || 'mockuser';

    if (!this.mockUserExists) {
      return {
        status: 200,
        headers: {},
        data: {
          data: {
            matchedUser: null,
          },
        } as unknown as T,
      };
    }

    return {
      status: 200,
      headers: {},
      data: {
        data: {
          matchedUser: {
            username,
            profile: {
              aboutMe: this.mockAboutMe,
            },
          },
        },
      } as unknown as T,
    };
  }
}

class DummyProblemSource implements ProblemSource {
  public readonly platform = 'LEETCODE' as const;
  public async fetchSolved() {
    return [];
  }
  public async lookupProblem(slug: string) {
    return { title: slug, difficulty: 'Easy' as const };
  }
}

describe('Security Audit Vulnerability Test Suite', () => {
  let db: SqliteDatabasePort;
  let repo: SqliteProblemRepository;
  let settingsRepo: SqliteSettingsRepository;
  let userRepo: SqliteUserRepository;
  let sessionRepo: SqliteSessionRepository;
  let verificationRepo: SqliteVerificationRepository;
  let clock: FrozenClock;
  let mockHttp: MockLeetCodeHttpClient;
  let authService: AuthService;
  let server: Server;
  let baseUrl: string;

  async function createVerifiedUser(username: string, password = 'ValidPassword123!'): Promise<{ user: User; sessionToken: string }> {
    const challenge = await authService.startVerification(username);
    mockHttp.mockAboutMe = `Code: ${challenge.code}`;
    await authService.verifyCode(challenge.challengeId, challenge.code);
    return await authService.register({
      challengeId: challenge.challengeId,
      code: challenge.code,
      password,
    });
  }

  beforeEach(async () => {
    globalRateLimiter.reset();
    db = createSqliteDatabase(':memory:');
    runMigrations(db);

    repo = new SqliteProblemRepository(db);
    settingsRepo = new SqliteSettingsRepository(db);
    userRepo = new SqliteUserRepository(db);
    sessionRepo = new SqliteSessionRepository(db);
    verificationRepo = new SqliteVerificationRepository(db);
    clock = new FrozenClock('2026-10-16T12:00:00Z', 'UTC');
    mockHttp = new MockLeetCodeHttpClient();

    authService = new AuthService({
      userRepository: userRepo,
      sessionRepository: sessionRepo,
      verificationRepository: verificationRepo,
      settingsRepository: settingsRepo,
      httpClient: mockHttp,
      clock,
      db,
    });

    const problemService = new ProblemService(repo, new DummyProblemSource(), clock);
    const syncService = new SyncService(repo, new DummyProblemSource(), settingsRepo);
    const backupService = new BackupService(db, repo, settingsRepo, clock);

    const app = createApiApp({
      problemRepository: repo,
      settingsRepository: settingsRepo,
      problemService,
      syncService,
      backupService,
      authService,
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
    globalRateLimiter.reset();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  /* -------------------------------------------------------------------------- */
  /* VULNERABILITY 1: Basic / Bearer Auth Bypass Prevention                      */
  /* -------------------------------------------------------------------------- */
  it('Fix 1: Authorization Basic or Bearer header CANNOT bypass session authentication', async () => {
    // 1. Basic auth attempt on protected route
    const basicRes = await fetch(`${baseUrl}/problems`, {
      headers: {
        Authorization: 'Basic ' + Buffer.from('leet:secretpassword123').toString('base64'),
      },
    });
    expect(basicRes.status).toBe(401);
    const basicJson = await basicRes.json();
    expect(basicJson.code).toBe('UNAUTHORIZED');

    // 2. Bearer auth attempt with arbitrary token
    const bearerRes = await fetch(`${baseUrl}/problems`, {
      headers: {
        Authorization: 'Bearer arbitrary-untrusted-token',
      },
    });
    expect(bearerRes.status).toBe(401);
  });

  it('Fix 1b: Unauthenticated request without session cookie returns 401', async () => {
    const res = await fetch(`${baseUrl}/problems`);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.code).toBe('UNAUTHORIZED');
  });

  /* -------------------------------------------------------------------------- */
  /* VULNERABILITY 2: Multi-User Data Isolation Enforcement                     */
  /* -------------------------------------------------------------------------- */
  it('Fix 2: Repository methods strictly reject missing userId with ValidationError', async () => {
    await expect(repo.list({})).rejects.toThrow(ValidationError);
    await expect(repo.findById('some-id', '')).rejects.toThrow(ValidationError);
    await expect(repo.create({
      id: 'p-no-user',
      platform: 'LEETCODE',
      slug: 'test-slug',
      title: 'Test',
      difficulty: 'Easy',
      url: 'https://leetcode.com',
      solvedAt: '2026-10-16T12:00:00Z',
      status: PROBLEM_STATUSES.INBOX,
      enrolledAt: null,
      deletedAt: null,
    })).rejects.toThrow(ValidationError);
    await expect(repo.softDelete('some-id', undefined as unknown as string)).rejects.toThrow(ValidationError);
    await expect(repo.hardDelete('some-id', '   ')).rejects.toThrow(ValidationError);
    await expect(repo.getNote('some-id', '')).rejects.toThrow(ValidationError);
    await expect(repo.saveReviews([], '')).rejects.toThrow(ValidationError);
    await expect(settingsRepo.get('')).rejects.toThrow(ValidationError);
    await expect(settingsRepo.set('k', 'v', '')).rejects.toThrow(ValidationError);
  });

  it('Fix 2b: User A cannot read, modify, or delete User B data', async () => {
    // Create User A and User B
    const userA = await createVerifiedUser('usera');
    const userB = await createVerifiedUser('userb');

    // User A creates a problem
    await repo.create({
      id: 'problem-of-user-a',
      userId: userA.user.id,
      platform: 'LEETCODE',
      slug: 'two-sum',
      title: 'Two Sum',
      difficulty: 'Easy',
      url: 'https://leetcode.com/problems/two-sum/',
      solvedAt: '2026-10-16T12:00:00Z',
      status: PROBLEM_STATUSES.INBOX,
      enrolledAt: null,
      deletedAt: null,
    });

    // User B tries to find User A's problem -> returns null
    const foundByB = await repo.findById('problem-of-user-a', userB.user.id);
    expect(foundByB).toBeNull();

    // User B tries to list problems -> should have 0 problems
    const listB = await repo.list({ userId: userB.user.id });
    expect(listB).toHaveLength(0);

    // User B tries to soft-delete User A's problem -> fails with NotFoundError
    await expect(
      repo.softDelete('problem-of-user-a', '2026-10-16T12:00:00Z', userB.user.id)
    ).rejects.toThrow();
    const stillExistsForA = await repo.findById('problem-of-user-a', userA.user.id);
    expect(stillExistsForA?.deletedAt).toBeNull();

    // User B tries to hard-delete User A's problem -> fails with NotFoundError
    await expect(
      repo.hardDelete('problem-of-user-a', userB.user.id)
    ).rejects.toThrow();
    const stillActiveForA = await repo.findById('problem-of-user-a', userA.user.id);
    expect(stillActiveForA).not.toBeNull();
  });

  /* -------------------------------------------------------------------------- */
  /* VULNERABILITY 3: Secure Session Tokens (HttpOnly Cookie only)              */
  /* -------------------------------------------------------------------------- */
  it('Fix 3: Register and Login do NOT expose sessionToken in JSON responses', async () => {
    // 1. Create a verification challenge first
    const challenge = await authService.startVerification('cookie_test_user', '127.0.0.1');
    // Pre-verify the challenge in DB
    db.prepare("UPDATE verification_challenges SET verified_at = datetime('now') WHERE id = ?").run(challenge.challengeId);

    // Register via HTTP API
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        code: challenge.code,
        password: 'ValidPassword123!',
      }),
    });
    expect(regRes.status).toBe(201);
    const regJson = await regRes.json();

    // ASSERTION: sessionToken must NOT be present in JSON response
    expect(regJson.sessionToken).toBeUndefined();
    expect(regJson.user).toBeDefined();
    expect(regJson.user.leetcodeUsername).toBe('cookie_test_user');

    // ASSERTION: cookie header must contain HttpOnly cookie
    const setCookie = regRes.headers.get('set-cookie');
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('leet_session=');
    expect(setCookie?.toLowerCase()).toContain('httponly');

    // 2. Test Login endpoint
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'cookie_test_user',
        password: 'ValidPassword123!',
      }),
    });
    expect(loginRes.status).toBe(200);
    const loginJson = await loginRes.json();

    // ASSERTION: sessionToken must NOT be present in JSON response
    expect(loginJson.sessionToken).toBeUndefined();
    expect(loginJson.user).toBeDefined();

    const loginCookie = loginRes.headers.get('set-cookie');
    expect(loginCookie).toContain('leet_session=');
    expect(loginCookie?.toLowerCase()).toContain('httponly');
  });

  /* -------------------------------------------------------------------------- */
  /* VULNERABILITY 4: Proper Rate Limiting                                      */
  /* -------------------------------------------------------------------------- */
  it('Fix 4: Login brute-force rate limit blocks after 5 failed attempts with 429', async () => {
    await createVerifiedUser('target_user');

    // Make 5 failed attempts
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'target_user',
          password: 'wrong_password_attempt',
        }),
      });
      expect(res.status).toBe(400);
    }

    // 6th attempt should be rate limited with 429
    const limitedRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'target_user',
        password: 'wrong_password_attempt',
      }),
    });
    expect(limitedRes.status).toBe(429);
    const json = await limitedRes.json();
    expect(json.code).toBe('RATE_LIMITED');
  });

  it('Fix 4b: Challenge creation rate limits before external calls', async () => {
    // Limit is 3 per 15 minutes for username challenge generation
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/auth/verification/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'rate_test_user' }),
      });
      expect(res.status).toBe(200);
    }

    // 4th request must be rate limited with 429
    const blockedRes = await fetch(`${baseUrl}/auth/verification/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'rate_test_user' }),
    });
    expect(blockedRes.status).toBe(429);
    const json = await blockedRes.json();
    expect(json.code).toBe('RATE_LIMITED');
  });

  /* -------------------------------------------------------------------------- */
  /* VULNERABILITY 5: Legacy Database Ownership Fix                             */
  /* -------------------------------------------------------------------------- */
  it('Fix 5: Automatic legacy data claiming ONLY happens if LeetCode username matches legacy setting', async () => {
    // 1. Seed legacy settings and an unowned problem (user_id IS NULL)
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('leetcode_username', 'original_owner', datetime('now'))").run();
    db.prepare(`
      INSERT INTO problems (id, user_id, platform, slug, title, difficulty, url, solved_at, status)
      VALUES ('legacy-prob-1', NULL, 'LEETCODE', 'two-sum', 'Two Sum', 'Easy', 'https://leetcode.com', '2026-10-10', 'INBOX')
    `).run();

    // 2. A different user registers ('attacker_user')
    await createVerifiedUser('attacker_user');

    // Legacy problem should NOT be claimed by attacker_user
    const probCheck1 = db.prepare<{ user_id: string | null }>('SELECT user_id FROM problems WHERE id = ?').get('legacy-prob-1');
    expect(probCheck1?.user_id).toBeNull();

    // 3. The rightful owner registers ('original_owner')
    const userOriginal = await createVerifiedUser('original_owner');

    // Legacy problem should now be claimed by original_owner
    const probCheck2 = db.prepare<{ user_id: string | null }>('SELECT user_id FROM problems WHERE id = ?').get('legacy-prob-1');
    expect(probCheck2?.user_id).toBe(userOriginal.user.id);
  });

  /* -------------------------------------------------------------------------- */
  /* VULNERABILITY 6: Atomic Registration Rollback                              */
  /* -------------------------------------------------------------------------- */
  it('Fix 6: Registration mutations run in a transaction and rollback on failure', async () => {
    const challenge = await authService.startVerification('rollback_user', '127.0.0.1');
    db.prepare("UPDATE verification_challenges SET verified_at = datetime('now') WHERE id = ?").run(challenge.challengeId);

    // Simulate failure by making sessions insertion fail
    const originalPrepare = db.prepare.bind(db);
    let failOnSessions = false;
    db.prepare = ((sql: string) => {
      if (failOnSessions && sql.includes('INSERT INTO sessions')) {
        throw new Error('Simulated disk error during session generation');
      }
      return originalPrepare(sql);
    }) as any;

    failOnSessions = true;

    // Attempt registration
    await expect(
      authService.register({
        challengeId: challenge.challengeId,
        code: challenge.code,
        password: 'ValidPassword123!',
      })
    ).rejects.toThrow('Simulated disk error during session generation');

    db.prepare = originalPrepare;

    // Challenge should NOT be marked consumed because transaction rolled back!
    const challengeRow = db.prepare<{ consumed_at: string | null }>(
      'SELECT consumed_at FROM verification_challenges WHERE id = ?'
    ).get(challenge.challengeId);
    expect(challengeRow?.consumed_at).toBeNull();

    // User should NOT exist in users table
    const userRow = db.prepare('SELECT id FROM users WHERE leetcode_username = ?').get('rollback_user');
    expect(userRow).toBeUndefined();
  });

  /* -------------------------------------------------------------------------- */
  /* VULNERABILITY 7: Sync and Username Change Locked to Verified Account       */
  /* -------------------------------------------------------------------------- */
  it('Fix 7: Sync rejects frontend-supplied username if different from verified account', async () => {
    const { sessionToken } = await createVerifiedUser('verified_owner');

    const res = await fetch(`${baseUrl}/problems/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `leet_session=${sessionToken}`,
      },
      body: JSON.stringify({ username: 'someone_else' }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('VALIDATION_ERROR');
    expect(json.message).toContain('Cannot synchronize another LeetCode account');
  });

  it('Fix 7b: Changing linked LeetCode username requires fresh ownership verification', async () => {
    const { sessionToken } = await createVerifiedUser('verified_dev');

    const res = await fetch(`${baseUrl}/settings/username`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `leet_session=${sessionToken}`,
      },
      body: JSON.stringify({ leetcodeUsername: 'hacked_username' }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('VALIDATION_ERROR');
    expect(json.message).toContain('Changing a linked LeetCode account requires ownership verification.');
  });

  /* -------------------------------------------------------------------------- */
  /* VULNERABILITY 8: Balanced Rate Limiting & Denial of Service Resilience     */
  /* -------------------------------------------------------------------------- */
  it('Fix 8: Attacker failing logins from IP A does NOT lock out legitimate user on IP B', async () => {
    await createVerifiedUser('dos_target_user', 'CorrectPassword123!');

    // Attacker on IP 192.168.1.100 fails 5 times
    for (let i = 0; i < 5; i++) {
      await expect(
        authService.login('dos_target_user', 'wrong_pass', '192.168.1.100')
      ).rejects.toThrow('Invalid username or password.');
    }

    // 6th attempt from attacker's IP is rate limited
    await expect(
      authService.login('dos_target_user', 'wrong_pass', '192.168.1.100')
    ).rejects.toThrow('Too many failed login attempts for this account from your IP');

    // Legitimate user on IP 10.0.0.50 can STILL log in successfully!
    const legitResult = await authService.login(
      'dos_target_user',
      'CorrectPassword123!',
      '10.0.0.50'
    );
    expect(legitResult.user.leetcodeUsername).toBe('dos_target_user');
    expect(legitResult.sessionToken).toBeDefined();
  });

  /* -------------------------------------------------------------------------- */
  /* VULNERABILITY 9: LeetCode Profile Username Strict Validation               */
  /* -------------------------------------------------------------------------- */
  it('Fix 9: Profile verification strictly rejects username mismatches from upstream', async () => {
    // Simulate LeetCode returning a profile with a mismatched username
    mockHttp.mockUserExists = true;
    const originalPost = mockHttp.post.bind(mockHttp);
    mockHttp.post = async <T = unknown>(_url: string, _body: unknown): Promise<HttpResponse<T>> => {
      return {
        status: 200,
        headers: {},
        data: {
          data: {
            matchedUser: {
              username: 'completely_different_user',
              profile: {
                aboutMe: 'Code: 123456',
              },
            },
          },
        } as unknown as T,
      };
    };

    // startVerification should reject when upstream returns a different username
    await expect(
      authService.startVerification('expected_user', '127.0.0.1')
    ).rejects.toThrow('The username "expected_user" is invalid or does not exist on LeetCode.');

    mockHttp.post = originalPost;

    // verifyCode should also reject if profile does not match challenge account
    const challenge = await verificationRepo.createChallenge({
      id: 'test-challenge-mismatch',
      leetcodeUsername: 'legit_user',
      codeHash: hashVerificationCode('123456'),
      expiresAt: '2026-10-17T12:00:00Z',
      maxAttempts: 5,
    });

    mockHttp.post = async <T = unknown>(_url: string, _body: unknown): Promise<HttpResponse<T>> => {
      return {
        status: 200,
        headers: {},
        data: {
          data: {
            matchedUser: {
              username: 'imposter_user',
              profile: {
                aboutMe: '123456',
              },
            },
          },
        } as unknown as T,
      };
    };

    await expect(
      authService.verifyCode(challenge.id, '123456', '127.0.0.1')
    ).rejects.toThrow();

    mockHttp.post = originalPost;
  });

  /* -------------------------------------------------------------------------- */
  /* VULNERABILITY 10: HMAC-SHA256 Verification Code Keying                     */
  /* -------------------------------------------------------------------------- */
  it('Fix 10: Verification codes are hashed with HMAC-SHA256 using server secret', async () => {
    const code = '123456';
    const secret = 'custom-test-secret-at-least-16-chars';
    const hmacHash = hashVerificationCode(code, secret);

    // Ensure it is 64 hex characters (HMAC-SHA256)
    expect(hmacHash).toHaveLength(64);

    // Ensure plain SHA-256 does NOT match the HMAC hash
    const plainSha256 = crypto.createHash('sha256').update(code).digest('hex');
    expect(hmacHash).not.toBe(plainSha256);

    // In production, VERIFICATION_SECRET must be at least 16 chars
    const prevEnv = process.env.NODE_ENV;
    const prevSecret = process.env.VERIFICATION_SECRET;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.VERIFICATION_SECRET;

      expect(() => getVerificationSecret()).toThrow(
        'VERIFICATION_SECRET environment variable must be set and at least 16 characters long in production.'
      );
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevSecret) process.env.VERIFICATION_SECRET = prevSecret;
      else delete process.env.VERIFICATION_SECRET;
    }
  });

  /* -------------------------------------------------------------------------- */
  /* SECTION 3: Distributed Account Lockout Remediation (Tests A, B, C, D)       */
  /* -------------------------------------------------------------------------- */
  it('Section 3 - Test A: Multiple failed login attempts from one IP are rate-limited', async () => {
    await createVerifiedUser('sec3_user_a', 'StrongPassword123!');
    const ip = '198.51.100.1';

    for (let i = 0; i < 5; i++) {
      await expect(
        authService.login('sec3_user_a', 'wrong_password', ip)
      ).rejects.toThrow('Invalid username or password.');
    }

    // 6th attempt from the same IP must be blocked by rate limiting
    await expect(
      authService.login('sec3_user_a', 'wrong_password', ip)
    ).rejects.toThrow('Too many failed login attempts for this account from your IP');
  });

  it('Section 3 - Test B: Failed login attempts distributed across multiple IP addresses do not globally lock out a legitimate account', async () => {
    await createVerifiedUser('sec3_user_b', 'StrongPassword123!');

    // 10 distinct IPs each make 3 failed login attempts (total 30 failed attempts across IPs)
    for (let i = 1; i <= 10; i++) {
      const distinctIp = `192.0.2.${i}`;
      for (let attempt = 0; attempt < 3; attempt++) {
        await expect(
          authService.login('sec3_user_b', 'bad_guess', distinctIp)
        ).rejects.toThrow('Invalid username or password.');
      }
    }

    // Legitimate user logging in from their own IP must NOT be globally locked!
    const legitResult = await authService.login(
      'sec3_user_b',
      'StrongPassword123!',
      '203.0.113.50'
    );
    expect(legitResult.user.leetcodeUsername).toBe('sec3_user_b');
    expect(legitResult.sessionToken).toBeDefined();
  });

  it('Section 3 - Test C: A legitimate user can still log in after another IP has repeatedly attempted incorrect passwords', async () => {
    await createVerifiedUser('sec3_user_c', 'StrongPassword123!');
    const attackerIp = '198.51.100.99';
    const legitIp = '203.0.113.1';

    // Attacker exhausts attempts and gets blocked
    for (let i = 0; i < 5; i++) {
      await expect(
        authService.login('sec3_user_c', 'wrong', attackerIp)
      ).rejects.toThrow();
    }
    await expect(
      authService.login('sec3_user_c', 'wrong', attackerIp)
    ).rejects.toThrow('Too many failed login attempts for this account from your IP');

    // Legitimate user on legitimate IP logs in immediately
    const result = await authService.login('sec3_user_c', 'StrongPassword123!', legitIp);
    expect(result.user.leetcodeUsername).toBe('sec3_user_c');
  });

  it('Section 3 - Test D: Successful login does not incorrectly reset another IP abuse protection', async () => {
    await createVerifiedUser('sec3_user_d', 'StrongPassword123!');
    const attackerIp = '198.51.100.123';
    const legitIp = '203.0.113.88';

    // Attacker gets rate-limited
    for (let i = 0; i < 5; i++) {
      await expect(
        authService.login('sec3_user_d', 'wrong', attackerIp)
      ).rejects.toThrow();
    }
    await expect(
      authService.login('sec3_user_d', 'wrong', attackerIp)
    ).rejects.toThrow('Too many failed login attempts for this account from your IP');

    // Legitimate user logs in successfully
    await authService.login('sec3_user_d', 'StrongPassword123!', legitIp);

    // Attacker IP must STILL be blocked (its abuse record was NOT reset)
    await expect(
      authService.login('sec3_user_d', 'wrong', attackerIp)
    ).rejects.toThrow('Too many failed login attempts for this account from your IP');
  });

  /* -------------------------------------------------------------------------- */
  /* SECTION 4: Prevent Verification Challenge DoS (Tests A, B, C, D)           */
  /* -------------------------------------------------------------------------- */
  it('Section 4 - Test A: Repeated challenge requests from one IP are rate-limited', async () => {
    const ip = '198.51.100.5';

    // 3 challenge attempts for a specific username from this IP are permitted
    for (let i = 0; i < 3; i++) {
      await authService.startVerification('sec4_user_a', ip);
    }

    // 4th challenge request for this username from the same IP must be rate-limited
    await expect(
      authService.startVerification('sec4_user_a', ip)
    ).rejects.toThrow('Too many verification attempts for this username from your IP');
  });

  it('Section 4 - Test B: Requests from unrelated IPs cannot globally lock a username', async () => {
    const attackerIp = '198.51.100.200';
    const legitIp = '203.0.113.200';

    // Attacker sends 3 challenge requests from attacker IP
    for (let i = 0; i < 3; i++) {
      await authService.startVerification('sec4_target_user', attackerIp);
    }

    // Attacker IP is now rate-limited
    await expect(
      authService.startVerification('sec4_target_user', attackerIp)
    ).rejects.toThrow('Too many verification attempts for this username from your IP');

    // Legitimate user from unrelated IP is NOT locked out and can start verification
    const legitChallenge = await authService.startVerification('sec4_target_user', legitIp);
    expect(legitChallenge.challengeId).toBeDefined();
    expect(legitChallenge.username).toBe('sec4_target_user');
  });

  it('Section 4 - Test C: A legitimate account owner can still initiate verification after an attacker has attempted challenge creation', async () => {
    const attackerIp = '198.51.100.201';
    const ownerIp = '203.0.113.201';

    // Attacker attempts challenge creation
    await authService.startVerification('owner_account', attackerIp);

    // Legitimate owner initiates verification smoothly
    const ownerChallenge = await authService.startVerification('owner_account', ownerIp);
    expect(ownerChallenge.challengeId).toBeDefined();
    expect(ownerChallenge.code).toHaveLength(6);
  });

  it('Section 4 - Test D: Expired and already-consumed challenges cannot verify an account', async () => {
    const challenge = await authService.startVerification('expiry_user', '127.0.0.1');

    // 1. Expired challenge test
    db.prepare("UPDATE verification_challenges SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?").run(
      challenge.challengeId
    );
    await expect(
      authService.verifyCode(challenge.challengeId, challenge.code)
    ).rejects.toThrow('Verification code has expired');

    // Reset expiry for consumption test
    db.prepare("UPDATE verification_challenges SET expires_at = '2099-01-01T00:00:00Z' WHERE id = ?").run(
      challenge.challengeId
    );

    // 2. Already consumed challenge test
    db.prepare("UPDATE verification_challenges SET consumed_at = datetime('now') WHERE id = ?").run(
      challenge.challengeId
    );
    await expect(
      authService.verifyCode(challenge.challengeId, challenge.code)
    ).rejects.toThrow('Verification code has already been used');
  });
});
