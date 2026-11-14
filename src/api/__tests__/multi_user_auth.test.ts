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
import { SqliteUserRepository } from '../../repositories/userRepository.js';
import { SqliteSessionRepository } from '../../repositories/sessionRepository.js';
import { SqliteVerificationRepository } from '../../repositories/verificationRepository.js';
import { SystemClock } from '../../domain/clock.js';
import type { HttpClient, HttpResponse } from '../../services/httpClient.js';
import { AuthService } from '../../services/authService.js';
import { ProblemService } from '../../services/problemService.js';
import { SyncService } from '../../services/syncService.js';
import { BackupService } from '../../services/backupService.js';
import { createApiApp } from '../app.js';
import type { ProblemSource } from '../../services/problemSource.js';
import type { SolvedProblem } from '../../domain/index.js';
import { globalRateLimiter } from '../../services/rateLimiter.js';

class MockHttpClient implements HttpClient {
  public profiles = new Map<string, string>(); // username -> aboutMe
  public existingUsers = new Set<string>();

  public async get<T>(): Promise<HttpResponse<T>> {
    throw new Error('Not implemented');
  }

  public async post<T>(_url: string, body?: unknown): Promise<HttpResponse<T>> {
    const payload = body as { query: string; variables?: { username?: string; titleSlug?: string } };
    const username = payload.variables?.username || '';

    if (username && !this.existingUsers.has(username.toLowerCase())) {
      return {
        status: 200,
        headers: {},
        data: {
          data: { matchedUser: null },
          errors: [{ message: 'That user does not exist.' }],
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
              aboutMe: this.profiles.get(username.toLowerCase()) || '',
            },
          },
        },
      } as unknown as T,
    };
  }
}

class FakeProblemSource implements ProblemSource {
  public readonly platform = 'LEETCODE' as const;
  public async fetchSolved(): Promise<SolvedProblem[]> {
    return [];
  }
  public async lookupProblem(slug: string) {
    return { title: slug, difficulty: 'Easy' as const };
  }
}

describe('Multi-User Auth & Data Isolation Integration', () => {
  let db: SqliteDatabasePort;
  let server: Server;
  let baseUrl: string;
  let mockHttp: MockHttpClient;

  beforeEach(async () => {
    globalRateLimiter.reset();
    db = createSqliteDatabase(':memory:');
    runMigrations(db);

    const clock = new SystemClock();
    const problemRepository = new SqliteProblemRepository(db);
    const settingsRepository = new SqliteSettingsRepository(db);
    const userRepository = new SqliteUserRepository(db);
    const sessionRepository = new SqliteSessionRepository(db);
    const verificationRepository = new SqliteVerificationRepository(db);

    mockHttp = new MockHttpClient();
    mockHttp.existingUsers.add('usera');
    mockHttp.existingUsers.add('userb');

    const authService = new AuthService({
      userRepository,
      sessionRepository,
      verificationRepository,
      settingsRepository,
      httpClient: mockHttp,
      clock,
    });

    const problemSource = new FakeProblemSource();
    const problemService = new ProblemService(problemRepository, problemSource, clock);
    const syncService = new SyncService(problemRepository, problemSource, settingsRepository);
    const backupService = new BackupService(db, problemRepository, settingsRepository, clock);

    const app = createApiApp({
      problemRepository,
      settingsRepository,
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
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  // Helper to register and extract session cookie
  async function registerUser(username: string, password: string): Promise<string> {
    // 1. Start verification
    const startRes = await fetch(`${baseUrl}/auth/verification/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    expect(startRes.status).toBe(200);
    const startData = await startRes.json();

    // 2. Mock placing code into LeetCode aboutMe
    mockHttp.profiles.set(username.toLowerCase(), `Verification: ${startData.code}`);

    // 3. Verify code
    const verifyRes = await fetch(`${baseUrl}/auth/verification/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: startData.challengeId,
        code: startData.code,
      }),
    });
    expect(verifyRes.status).toBe(200);

    // 4. Complete registration
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: startData.challengeId,
        code: startData.code,
        password,
      }),
    });
    expect(regRes.status).toBe(201);

    const setCookie = regRes.headers.get('set-cookie');
    expect(setCookie).toBeDefined();
    return setCookie?.split(';')[0] || '';
  }

  describe('Registration & Authentication Endpoints', () => {
    it('Requires authentication for protected endpoints', async () => {
      const res = await fetch(`${baseUrl}/problems`);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.code).toBe('UNAUTHORIZED');
    });

    it('Completes registration and accesses /api/auth/me with session cookie', async () => {
      const cookie = await registerUser('usera', 'ValidPassword123!');

      const meRes = await fetch(`${baseUrl}/auth/me`, {
        headers: { Cookie: cookie },
      });
      expect(meRes.status).toBe(200);
      const meData = await meRes.json();
      expect(meData.user.leetcodeUsername).toBe('usera');
    });

    it('Logs in an existing user and logs out successfully', async () => {
      await registerUser('usera', 'ValidPassword123!');

      // Login
      const loginRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'usera',
          password: 'ValidPassword123!',
        }),
      });
      expect(loginRes.status).toBe(200);
      const cookie = loginRes.headers.get('set-cookie')?.split(';')[0] || '';

      // Verify authenticated
      const meRes = await fetch(`${baseUrl}/auth/me`, {
        headers: { Cookie: cookie },
      });
      expect(meRes.status).toBe(200);

      // Logout
      const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
        method: 'POST',
        headers: { Cookie: cookie },
      });
      expect(logoutRes.status).toBe(200);

      // No longer authenticated
      const afterMe = await fetch(`${baseUrl}/auth/me`, {
        headers: { Cookie: cookie },
      });
      expect(afterMe.status).toBe(401);
    });
  });

  describe('Multi-User Data Isolation', () => {
    it('Guarantees strict isolation between User A and User B tracking the same problem', async () => {
      const cookieA = await registerUser('usera', 'PasswordForUserA123!');
      const cookieB = await registerUser('userb', 'PasswordForUserB123!');

      // User A adds 'two-sum'
      const addResA = await fetch(`${baseUrl}/problems/manual`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieA,
        },
        body: JSON.stringify({
          urlOrSlug: 'two-sum',
          title: 'Two Sum',
          difficulty: 'Easy',
        }),
      });
      expect(addResA.status).toBe(201);
      const problemA = (await addResA.json()).problem;

      // User B adds the SAME slug 'two-sum' independently without collision
      const addResB = await fetch(`${baseUrl}/problems/manual`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieB,
        },
        body: JSON.stringify({
          urlOrSlug: 'two-sum',
          title: 'Two Sum',
          difficulty: 'Easy',
        }),
      });
      expect(addResB.status).toBe(201);
      const problemB = (await addResB.json()).problem;

      expect(problemA.id).not.toBe(problemB.id);

      // User A lists problems -> only 1 item (problemA)
      const listA = await fetch(`${baseUrl}/problems`, { headers: { Cookie: cookieA } });
      const dataA = await listA.json();
      expect(dataA.problems).toHaveLength(1);
      expect(dataA.problems[0].problem.id).toBe(problemA.id);

      // User B lists problems -> only 1 item (problemB)
      const listB = await fetch(`${baseUrl}/problems`, { headers: { Cookie: cookieB } });
      const dataB = await listB.json();
      expect(dataB.problems).toHaveLength(1);
      expect(dataB.problems[0].problem.id).toBe(problemB.id);

      // User A soft deletes their problem
      const delA = await fetch(`${baseUrl}/problems/${problemA.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookieA },
      });
      expect(delA.status).toBe(200);

      // User A now has 0 active problems
      const listAfterDelA = await fetch(`${baseUrl}/problems`, { headers: { Cookie: cookieA } });
      expect((await listAfterDelA.json()).problems).toHaveLength(0);

      // User B still has their intact 'two-sum' problem!
      const listAfterDelB = await fetch(`${baseUrl}/problems`, { headers: { Cookie: cookieB } });
      const dataAfterDelB = await listAfterDelB.json();
      expect(dataAfterDelB.problems).toHaveLength(1);
      expect(dataAfterDelB.problems[0].problem.id).toBe(problemB.id);

      // User A cannot fetch User B's problem by ID (returns 404)
      const crossFetch = await fetch(`${baseUrl}/problems/${problemB.id}`, {
        headers: { Cookie: cookieA },
      });
      expect(crossFetch.status).toBe(404);
    });

    it('Isolates Backup Export and Restore between users', async () => {
      const cookieA = await registerUser('usera', 'PasswordForUserA123!');
      const cookieB = await registerUser('userb', 'PasswordForUserB123!');

      // User A adds problem
      await fetch(`${baseUrl}/problems/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieA },
        body: JSON.stringify({ urlOrSlug: 'problem-a', difficulty: 'Easy' }),
      });

      // User B adds problem
      await fetch(`${baseUrl}/problems/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieB },
        body: JSON.stringify({ urlOrSlug: 'problem-b', difficulty: 'Medium' }),
      });

      // User A exports backup
      const backupResA = await fetch(`${baseUrl}/backup`, { headers: { Cookie: cookieA } });
      const backupDataA = await backupResA.json();

      expect(backupDataA.problems).toHaveLength(1);
      expect(backupDataA.problems[0].problem.slug).toBe('problem-a');

      // User B's problem is NOT in User A's backup
      expect(backupDataA.problems.some((p: { problem: { slug: string } }) => p.problem.slug === 'problem-b')).toBe(false);
    });
  });
});
