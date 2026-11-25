/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteDatabase, type SqliteDatabasePort } from '../../db/sqliteDatabase.js';
import { runMigrations } from '../../db/schema.js';
import { SqliteUserRepository } from '../../repositories/userRepository.js';
import { SqliteSessionRepository } from '../../repositories/sessionRepository.js';
import { SqliteVerificationRepository } from '../../repositories/verificationRepository.js';
import { SqliteSettingsRepository } from '../../repositories/settingsRepository.js';
import { SqliteProblemRepository } from '../../repositories/sqliteProblemRepository.js';
import { FrozenClock } from '../../domain/clock.js';
import type { HttpClient, HttpResponse } from '../httpClient.js';
import {
  AuthService,
  hashPassword,
  verifyPassword,
  generateVerificationCode,
} from '../authService.js';
import { matchesVerificationCode } from '../leetcode/leetcodeGql.js';
import { ValidationError, InvalidUsernameError } from '../../domain/errors.js';
import { globalRateLimiter } from '../rateLimiter.js';

class MockLeetCodeHttpClient implements HttpClient {
  public mockAboutMe = '';
  public mockUserExists = true;

  public async get<T>(): Promise<HttpResponse<T>> {
    throw new Error('Not implemented');
  }

  public async post<T>(_url: string, body?: unknown): Promise<HttpResponse<T>> {
    const payload = body as { query: string; variables?: { username?: string } };

    if (!this.mockUserExists) {
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
            username: payload.variables?.username || 'mockuser',
            profile: {
              aboutMe: this.mockAboutMe,
            },
          },
        },
      } as unknown as T,
    };
  }
}

describe('AuthService and Multi-User Authentication', () => {
  let db: SqliteDatabasePort;
  let userRepo: SqliteUserRepository;
  let sessionRepo: SqliteSessionRepository;
  let verificationRepo: SqliteVerificationRepository;
  let settingsRepo: SqliteSettingsRepository;
  let problemRepo: SqliteProblemRepository;
  let clock: FrozenClock;
  let mockHttp: MockLeetCodeHttpClient;
  let authService: AuthService;

  beforeEach(() => {
    globalRateLimiter.reset();
    db = createSqliteDatabase(':memory:');
    runMigrations(db);

    userRepo = new SqliteUserRepository(db);
    sessionRepo = new SqliteSessionRepository(db);
    verificationRepo = new SqliteVerificationRepository(db);
    settingsRepo = new SqliteSettingsRepository(db);
    problemRepo = new SqliteProblemRepository(db);
    clock = new FrozenClock('2026-10-16T12:00:00.000Z', 'UTC');
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
  });

  describe('Password Hashing with Scrypt & Salt', () => {
    it('hashes passwords using scrypt with random salt and verifies in constant time', async () => {
      const password = 'SuperSecurePassword123!';
      const { hash, salt } = await hashPassword(password);

      expect(hash).toHaveLength(128); // 64 bytes in hex
      expect(salt).toHaveLength(32); // 16 bytes in hex

      // Verification succeeds with correct password
      const isMatch = await verifyPassword(password, hash, salt);
      expect(isMatch).toBe(true);

      // Verification fails with wrong password
      const isWrongMatch = await verifyPassword('WrongPassword123!', hash, salt);
      expect(isWrongMatch).toBe(false);
    });

    it('generates different salts for identical passwords', async () => {
      const p1 = await hashPassword('same_password_123');
      const p2 = await hashPassword('same_password_123');
      expect(p1.salt).not.toBe(p2.salt);
      expect(p1.hash).not.toBe(p2.hash);
    });
  });

  describe('Verification Code & LeetCode Standalone Matching', () => {
    it('generates a 6-digit numeric verification code', () => {
      for (let i = 0; i < 50; i++) {
        const code = generateVerificationCode();
        expect(code).toMatch(/^\d{6}$/);
      }
    });

    it('accurately matches standalone 6-digit verification code inside aboutMe', () => {
      expect(matchesVerificationCode('123456', '123456')).toBe(true);
      expect(matchesVerificationCode('My verification: 123456', '123456')).toBe(true);
      expect(matchesVerificationCode('Code 123456. Thanks!', '123456')).toBe(true);
      expect(matchesVerificationCode('123456\nSoftware Engineer', '123456')).toBe(true);

      // Negative cases: part of a larger number or word
      expect(matchesVerificationCode('1234567', '123456')).toBe(false);
      expect(matchesVerificationCode('0123456', '123456')).toBe(false);
      expect(matchesVerificationCode('abc123456def', '123456')).toBe(false);
      expect(matchesVerificationCode('', '123456')).toBe(false);
    });
  });

  describe('Full Registration Flow: Verification -> Password -> Session', () => {
    it('Given a valid LeetCode user, initiates challenge and stores hashed code with 10m expiry', async () => {
      const challenge = await authService.startVerification('tourist');

      expect(challenge.challengeId).toBeDefined();
      expect(challenge.code).toMatch(/^\d{6}$/);
      expect(challenge.username).toBe('tourist');
      expect(challenge.expiresAt).toBe('2026-10-16T12:10:00.000Z');

      // Stored in DB
      const stored = await verificationRepo.findChallengeById(challenge.challengeId);
      expect(stored).toBeDefined();
      expect(stored?.codeHash).toHaveLength(64); // SHA-256
    });

    it('Rejects registration if username does not exist on LeetCode', async () => {
      mockHttp.mockUserExists = false;
      await expect(authService.startVerification('nonexistent_user_999')).rejects.toThrow(
        InvalidUsernameError
      );
    });

    it('Enforces rate limiting on challenge generation (max 3 challenges per 15 min)', async () => {
      await authService.startVerification('fastuser');
      await authService.startVerification('fastuser');
      await authService.startVerification('fastuser');

      // 4th attempt within 15 min should throw
      await expect(authService.startVerification('fastuser')).rejects.toThrow();
    });

    it('Given code is placed in LeetCode profile, verifies ownership and allows password registration', async () => {
      const challenge = await authService.startVerification('lee215');

      // Set profile aboutMe to contain the generated code
      mockHttp.mockAboutMe = `Competitive programmer. Verification code: ${challenge.code}`;

      // Verify code
      const verifyRes = await authService.verifyCode(challenge.challengeId, challenge.code);
      expect(verifyRes.verified).toBe(true);

      // Register with password >= 12 chars
      const regRes = await authService.register({
        challengeId: challenge.challengeId,
        code: challenge.code,
        password: 'ValidPassword123!',
      });

      expect(regRes.user.id).toBeDefined();
      expect(regRes.user.leetcodeUsername).toBe('lee215');
      expect(regRes.sessionToken).toHaveLength(64);

      // Validate session works
      const sessionUser = await authService.validateSession(regRes.sessionToken);
      expect(sessionUser?.user.leetcodeUsername).toBe('lee215');
    });

    it('Rejects password shorter than 12 characters during registration', async () => {
      const challenge = await authService.startVerification('alicesmith');
      mockHttp.mockAboutMe = `Code: ${challenge.code}`;
      await authService.verifyCode(challenge.challengeId, challenge.code);

      await expect(
        authService.register({
          challengeId: challenge.challengeId,
          code: challenge.code,
          password: 'short',
        })
      ).rejects.toThrow('Password must be at least 12 characters long.');
    });

    it('Rejects verifyCode if the code is NOT found in the LeetCode profile', async () => {
      const challenge = await authService.startVerification('bob');
      mockHttp.mockAboutMe = 'Different text without code';

      await expect(authService.verifyCode(challenge.challengeId, challenge.code)).rejects.toThrow(
        ValidationError
      );
    });

    it('Rejects registration if verification challenge has already been consumed', async () => {
      const challenge = await authService.startVerification('user1');
      mockHttp.mockAboutMe = `Code: ${challenge.code}`;
      await authService.verifyCode(challenge.challengeId, challenge.code);

      // 1st register succeeds
      await authService.register({
        challengeId: challenge.challengeId,
        code: challenge.code,
        password: 'Password123456!',
      });

      // 2nd register with same challenge fails
      await expect(
        authService.register({
          challengeId: challenge.challengeId,
          code: challenge.code,
          password: 'Password123456!',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('Claims legacy single-user problems when the verified username matches legacy configuration', async () => {
      // Seed legacy setting matching 'firstuser'
      db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('leetcode_username', 'firstuser', datetime('now'))").run();

      // Seed legacy unattached problem directly with user_id NULL
      db.prepare(`
        INSERT INTO problems (id, user_id, platform, slug, title, difficulty, url, solved_at, status)
        VALUES ('11111111-1111-1111-1111-111111111111', NULL, 'LEETCODE', 'legacy-two-sum', 'Two Sum', 'Easy', 'https://leetcode.com/problems/two-sum/', '2026-10-15T12:00:00Z', 'INBOX')
      `).run();

      // Register matching first user
      const challenge = await authService.startVerification('firstuser');
      mockHttp.mockAboutMe = `Code: ${challenge.code}`;
      await authService.verifyCode(challenge.challengeId, challenge.code);
      const reg = await authService.register({
        challengeId: challenge.challengeId,
        code: challenge.code,
        password: 'Password123456!',
      });

      // Problem is now claimed by firstuser!
      const userProblems = await problemRepo.list({ userId: reg.user.id });
      expect(userProblems).toHaveLength(1);
      expect(userProblems[0].slug).toBe('legacy-two-sum');
      expect(userProblems[0].userId).toBe(reg.user.id);
    });
  });

  describe('Login, Logout, and Session Expiry', () => {
    beforeEach(async () => {
      globalRateLimiter.reset();
      const challenge = await authService.startVerification('existinguser');
      mockHttp.mockAboutMe = `Code: ${challenge.code}`;
      await authService.verifyCode(challenge.challengeId, challenge.code);
      await authService.register({
        challengeId: challenge.challengeId,
        code: challenge.code,
        password: 'MyPassword123456!',
      });
    });

    it('Given correct credentials, login returns user and valid session', async () => {
      const res = await authService.login('existinguser', 'MyPassword123456!');
      expect(res.user.leetcodeUsername).toBe('existinguser');
      expect(res.sessionToken).toBeDefined();

      const valid = await authService.validateSession(res.sessionToken);
      expect(valid?.user.leetcodeUsername).toBe('existinguser');
    });

    it('Given incorrect password, login rejects with ValidationError', async () => {
      await expect(authService.login('existinguser', 'WrongPassword123!')).rejects.toThrow(
        'Invalid username or password.'
      );
    });

    it('Given nonexistent username, login rejects with ValidationError', async () => {
      await expect(authService.login('unknownuser', 'MyPassword123456!')).rejects.toThrow(
        'Invalid username or password.'
      );
    });

    it('Logout invalidates session token', async () => {
      const { sessionToken } = await authService.login('existinguser', 'MyPassword123456!');
      expect(await authService.validateSession(sessionToken)).not.toBeNull();

      await authService.logout(sessionToken);
      expect(await authService.validateSession(sessionToken)).toBeNull();
    });
  });

  describe('Password recovery', () => {
    it('requires verified LeetCode ownership, changes the password, and revokes existing sessions', async () => {
      const signup = await authService.startVerification('recoveryuser');
      mockHttp.mockAboutMe = `Verification code: ${signup.code}`;
      await authService.verifyCode(signup.challengeId, signup.code);
      const { sessionToken } = await authService.register({
        challengeId: signup.challengeId,
        code: signup.code,
        password: 'OriginalPassword123!',
      });

      const recovery = await authService.startPasswordReset('recoveryuser', '127.0.0.2');
      const stored = await verificationRepo.findChallengeById(recovery.challengeId);
      expect(stored?.purpose).toBe('password_reset');
      mockHttp.mockAboutMe = `Recovery code: ${recovery.code}`;
      await authService.verifyCode(recovery.challengeId, recovery.code, '127.0.0.2');
      await authService.resetPassword({
        challengeId: recovery.challengeId,
        code: recovery.code,
        password: 'ReplacementPassword123!',
        clientIp: '127.0.0.2',
      });

      expect(await authService.validateSession(sessionToken)).toBeNull();
      await expect(authService.login('recoveryuser', 'OriginalPassword123!')).rejects.toThrow(
        'Invalid username or password.'
      );
      const renewed = await authService.login('recoveryuser', 'ReplacementPassword123!');
      expect(renewed.user.leetcodeUsername).toBe('recoveryuser');
    });
  });
});
