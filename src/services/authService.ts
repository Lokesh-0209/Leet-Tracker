/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import type { HttpClient } from './httpClient.js';
import type { UserRepository } from '../repositories/userRepository.js';
import type { SessionRepository } from '../repositories/sessionRepository.js';
import type { VerificationRepository } from '../repositories/verificationRepository.js';
import type { SettingsRepository } from '../repositories/settingsRepository.js';
import type { DatabasePort } from '../db/sqliteDatabase.js';
import type { Clock } from '../domain/clock.js';
import type { User } from '../domain/models.js';
import { ValidationError } from '../domain/errors.js';
import {
  fetchLeetCodeProfileGql,
  matchesVerificationCode,
} from './leetcode/leetcodeGql.js';
import { RateLimiter, globalRateLimiter } from './rateLimiter.js';

/**
 * Returns the server secret used for HMAC-SHA256 hashing of verification codes.
 * In production mode, VERIFICATION_SECRET must be set and at least 16 characters long.
 * In development or testing, a deterministic fallback is used if not provided.
 */
export function getVerificationSecret(): string {
  const secret = process.env.VERIFICATION_SECRET;
  if (!secret || secret.trim().length < 16) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'VERIFICATION_SECRET environment variable must be set and at least 16 characters long in production.'
      );
    }
    return 'dev-verification-secret-32-chars-min-key!';
  }
  return secret.trim();
}

/**
 * Hashes a 6-digit verification code using HMAC-SHA256 with the server-side secret.
 * This prevents precomputation / rainbow table attacks against the small 6-digit keyspace
 * in the event of a database dump. Never logs the raw code or secret.
 */
export function hashVerificationCode(code: string, secret?: string): string {
  const key = secret || getVerificationSecret();
  return crypto.createHmac('sha256', key).update(code.trim()).digest('hex');
}

/**
 * Computes standard SHA-256 hash for session tokens and high-entropy identifiers.
 */
export function hashStringSha256(val: string): string {
  return crypto.createHash('sha256').update(val).digest('hex');
}

export function generateVerificationCode(): string {
  const num = crypto.randomInt(0, 1000000);
  return num.toString().padStart(6, '0');
}

export async function hashPassword(
  password: string,
  saltHex?: string
): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve({
        hash: derivedKey.toString('hex'),
        salt: salt.toString('hex'),
      });
    });
  });
}

export async function verifyPassword(
  password: string,
  storedHashHex: string,
  saltHex: string
): Promise<boolean> {
  const { hash } = await hashPassword(password, saltHex);
  const hashBuf = Buffer.from(hash, 'hex');
  const storedBuf = Buffer.from(storedHashHex, 'hex');
  if (hashBuf.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, storedBuf);
}

export interface AuthServiceDependencies {
  readonly userRepository: UserRepository;
  readonly sessionRepository: SessionRepository;
  readonly verificationRepository: VerificationRepository;
  readonly settingsRepository: SettingsRepository;
  readonly httpClient: HttpClient;
  readonly clock: Clock;
  readonly db?: DatabasePort;
  readonly rateLimiter?: RateLimiter;
}

export class AuthService {
  private readonly rateLimiter: RateLimiter;

  constructor(private readonly deps: AuthServiceDependencies) {
    this.rateLimiter = deps.rateLimiter || globalRateLimiter;
  }

  private getRateLimitConfig() {
    return {
      loginMaxAttempts: Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS) || 5,
      loginIpMaxAttempts: Number(process.env.AUTH_LOGIN_IP_MAX_ATTEMPTS) || 20,
      verifyMaxAttempts: Number(process.env.AUTH_VERIFY_MAX_ATTEMPTS) || 15,
      windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    };
  }

  public async startVerification(
    username: string,
    clientIp?: string
  ): Promise<{
    challengeId: string;
    code: string;
    expiresAt: string;
    username: string;
  }> {
    const cleanUsername = username.trim();
    const config = this.getRateLimitConfig();

    // 1. Fast check if username is already registered in local database
    const existing = await this.deps.userRepository.findByUsername(cleanUsername);
    if (existing) {
      throw new ValidationError(
        'This LeetCode username is already registered. Please log in.'
      );
    }

    // 2. Rate limiting BEFORE making external LeetCode GraphQL requests.
    // Limits are applied per IP and per IP-plus-username to prevent unauthenticated
    // attackers from globally locking out legitimate account owners from other IPs.
    const ipKey = clientIp || '127.0.0.1';
    this.rateLimiter.check(
      `start_verif_ip:${ipKey}`,
      10,
      config.windowMs,
      'Too many verification requests from this IP. Please wait 15 minutes.'
    );
    this.rateLimiter.check(
      `start_verif_user_ip:${cleanUsername.toLowerCase()}:${ipKey}`,
      3,
      config.windowMs,
      'Too many verification attempts for this username from your IP. Please wait 15 minutes before requesting another code.'
    );

    // 3. Verify username exists on LeetCode and compare returned username with requested account
    const profile = await fetchLeetCodeProfileGql(this.deps.httpClient, cleanUsername);
    if (profile.username.trim().toLowerCase() !== cleanUsername.toLowerCase()) {
      throw new ValidationError('LeetCode profile username mismatch. Verification rejected.');
    }

    // 4. Generate 6-digit code, keyed HMAC-SHA256, and 10-minute expiry
    const code = generateVerificationCode();
    const codeHash = hashVerificationCode(code);
    const expiresAt = new Date(this.deps.clock.now().getTime() + 10 * 60 * 1000).toISOString();
    const challengeId = crypto.randomUUID();

    await this.deps.verificationRepository.createChallenge({
      id: challengeId,
      leetcodeUsername: profile.username,
      codeHash,
      expiresAt,
      maxAttempts: 5,
    });

    return {
      challengeId,
      code,
      expiresAt,
      username: profile.username,
    };
  }

  /** Starts recovery only after asking the owner to prove control of their public LeetCode profile. */
  public async startPasswordReset(
    username: string,
    clientIp?: string
  ): Promise<{ challengeId: string; code: string; expiresAt: string; username: string }> {
    const cleanUsername = username.trim();
    const config = this.getRateLimitConfig();
    const ipKey = clientIp || '127.0.0.1';

    this.rateLimiter.check(
      `password_reset_ip:${ipKey}`,
      10,
      config.windowMs,
      'Too many password reset requests from this IP. Please wait 15 minutes.'
    );
    this.rateLimiter.check(
      `password_reset_user_ip:${cleanUsername.toLowerCase()}:${ipKey}`,
      3,
      config.windowMs,
      'Too many password reset requests for this username from your IP. Please wait 15 minutes.'
    );

    const recentChallenges = await this.deps.verificationRepository.countRecentChallenges(
      cleanUsername,
      new Date(this.deps.clock.now().getTime() - config.windowMs).toISOString()
    );
    if (recentChallenges >= 5) {
      throw new ValidationError('Too many verification requests for this username. Please wait 15 minutes.');
    }

    const profile = await fetchLeetCodeProfileGql(this.deps.httpClient, cleanUsername);
    if (profile.username.trim().toLowerCase() !== cleanUsername.toLowerCase()) {
      throw new ValidationError('LeetCode profile username mismatch.');
    }

    const code = generateVerificationCode();
    const codeHash = hashVerificationCode(code);
    const expiresAt = new Date(this.deps.clock.now().getTime() + 10 * 60 * 1000).toISOString();
    const challengeId = crypto.randomUUID();
    await this.deps.verificationRepository.createChallenge({
      id: challengeId,
      leetcodeUsername: profile.username,
      codeHash,
      expiresAt,
      maxAttempts: 5,
      purpose: 'password_reset',
    });

    // The response is intentionally generic with respect to account registration.
    // The profile owner must complete verification before the app reveals whether a reset applies.
    return { challengeId, code, expiresAt, username: profile.username };
  }

  public async resetPassword(params: {
    challengeId: string;
    code: string;
    password: string;
    clientIp?: string;
  }): Promise<{ username: string }> {
    const { challengeId, code, password, clientIp } = params;
    if (!password || password.length < 12) {
      throw new ValidationError('Password must be at least 12 characters long.');
    }

    const config = this.getRateLimitConfig();
    const ipKey = clientIp || '127.0.0.1';
    this.rateLimiter.check(
      `password_reset_complete:${ipKey}`,
      5,
      config.windowMs,
      'Too many password reset attempts from this IP. Please wait 15 minutes.'
    );

    const challenge = await this.deps.verificationRepository.findChallengeById(challengeId);
    if (
      !challenge ||
      challenge.purpose !== 'password_reset' ||
      challenge.consumedAt !== null ||
      challenge.verifiedAt === null ||
      new Date(challenge.expiresAt).getTime() <= this.deps.clock.now().getTime()
    ) {
      throw new ValidationError('This recovery request is invalid or expired. Start again.');
    }
    if (challenge.attempts >= challenge.maxAttempts) {
      throw new ValidationError('Too many attempts. Start a new recovery request.');
    }

    const inputHash = hashVerificationCode(code.trim());
    const expected = Buffer.from(challenge.codeHash, 'hex');
    const received = Buffer.from(inputHash, 'hex');
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      await this.deps.verificationRepository.recordAttempt(challenge.id);
      throw new ValidationError('Verification code is incorrect.');
    }

    const account = await this.deps.userRepository.findByUsername(challenge.leetcodeUsername);
    if (!account) {
      throw new ValidationError('No Leet Tracker account is registered for this LeetCode username.');
    }

    const { hash, salt } = await hashPassword(password);
    const finishReset = async (): Promise<void> => {
      await this.deps.verificationRepository.markConsumed(challenge.id, this.deps.clock.nowIso());
      await this.deps.userRepository.updatePassword(account.id, hash, salt);
      await this.deps.sessionRepository.deleteUserSessions(account.id);
    };

    if (this.deps.db) await this.deps.db.transaction(finishReset);
    else await finishReset();

    return { username: account.leetcodeUsername };
  }

  public async verifyCode(
    challengeId: string,
    code: string,
    clientIp?: string
  ): Promise<{ verified: boolean; challengeId: string; username: string }> {
    const cleanCode = code.trim();
    const nowIso = this.deps.clock.nowIso();
    const config = this.getRateLimitConfig();

    // 1. Rate limiting BEFORE making external LeetCode GraphQL requests
    const ipKey = clientIp || '127.0.0.1';
    this.rateLimiter.check(
      `verify_code_ip:${ipKey}`,
      config.verifyMaxAttempts,
      config.windowMs,
      'Too many verification attempts from this IP. Please wait 15 minutes.'
    );
    this.rateLimiter.check(
      `verify_code_chal:${challengeId}`,
      5,
      config.windowMs,
      'Too many verification attempts for this challenge. Please request a new code.'
    );

    const challenge = await this.deps.verificationRepository.findChallengeById(challengeId);
    if (!challenge) {
      throw new ValidationError('Verification challenge not found. Please request a new code.');
    }

    if (new Date(challenge.expiresAt).getTime() <= this.deps.clock.now().getTime()) {
      throw new ValidationError('Verification code has expired. Please request a new code.');
    }

    if (challenge.consumedAt !== null) {
      throw new ValidationError('Verification code has already been used.');
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      throw new ValidationError(
        'Too many failed attempts. For your security, this verification code has been invalidated. Please request a new code.'
      );
    }

    // Record attempt
    await this.deps.verificationRepository.recordAttempt(challenge.id);

    // Verify code matches challenge HMAC hash using timingSafeEqual
    const inputHash = hashVerificationCode(cleanCode);
    const expectedHashBuf = Buffer.from(challenge.codeHash, 'hex');
    const inputHashBuf = Buffer.from(inputHash, 'hex');
    const matchesCode =
      expectedHashBuf.length === inputHashBuf.length &&
      crypto.timingSafeEqual(expectedHashBuf, inputHashBuf);

    if (!matchesCode) {
      throw new ValidationError('Incorrect verification code. Please check the 6-digit code.');
    }

    // Fetch user's LeetCode profile "About Me" and ensure username matches challenge
    const profile = await fetchLeetCodeProfileGql(this.deps.httpClient, challenge.leetcodeUsername);
    if (profile.username.trim().toLowerCase() !== challenge.leetcodeUsername.trim().toLowerCase()) {
      throw new ValidationError('LeetCode profile username mismatch. Verification rejected.');
    }

    const codeFound = matchesVerificationCode(profile.aboutMe, cleanCode);
    if (!codeFound) {
      throw new ValidationError(
        `Verification code ${cleanCode} was not found in your LeetCode "About Me" profile. Please paste the code into your profile and click Verify again.`
      );
    }

    // Mark verified
    await this.deps.verificationRepository.markVerified(challenge.id, nowIso);

    return {
      verified: true,
      challengeId: challenge.id,
      username: challenge.leetcodeUsername,
    };
  }

  public async register(params: {
    challengeId: string;
    code: string;
    password: string;
    clientIp?: string;
  }): Promise<{ user: User; sessionToken: string }> {
    const { challengeId, code, password, clientIp } = params;
    const config = this.getRateLimitConfig();

    // Rate limit registration requests per IP
    const ipKey = clientIp || '127.0.0.1';
    this.rateLimiter.check(
      `register_ip:${ipKey}`,
      5,
      config.windowMs,
      'Too many registration requests from this IP. Please wait 15 minutes.'
    );

    if (!password || password.length < 12) {
      throw new ValidationError('Password must be at least 12 characters long.');
    }

    const challenge = await this.deps.verificationRepository.findChallengeById(challengeId);
    if (!challenge) {
      throw new ValidationError('Verification challenge not found.');
    }

    if (challenge.purpose !== 'registration') {
      throw new ValidationError('This verification request cannot be used to create an account.');
    }

    if (new Date(challenge.expiresAt).getTime() <= this.deps.clock.now().getTime()) {
      throw new ValidationError('Verification code has expired.');
    }

    if (challenge.consumedAt !== null) {
      throw new ValidationError('Verification code has already been used.');
    }

    if (challenge.verifiedAt === null) {
      throw new ValidationError('Please verify profile ownership before completing registration.');
    }

    // Constant-time check on HMAC code hash
    const inputHash = hashVerificationCode(code.trim());
    const expectedHashBuf = Buffer.from(challenge.codeHash, 'hex');
    const inputHashBuf = Buffer.from(inputHash, 'hex');
    const matchesCode =
      expectedHashBuf.length === inputHashBuf.length &&
      crypto.timingSafeEqual(expectedHashBuf, inputHashBuf);

    if (!matchesCode) {
      throw new ValidationError('Invalid verification code.');
    }

    // Concurrency check before hashing
    const existing = await this.deps.userRepository.findByUsername(challenge.leetcodeUsername);
    if (existing) {
      throw new ValidationError('This username is already registered. Please log in.');
    }

    // Hash password (expensive async operation done outside the database transaction)
    const { hash, salt } = await hashPassword(password);
    const userId = crypto.randomUUID();

    // Prepare session token
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashStringSha256(sessionToken);
    const expiresAt = new Date(this.deps.clock.now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // Atomic execution: execute all writes inside a single database transaction.
    // If any step fails, roll back so the verification challenge is not lost and
    // no partial user/session records are left.
    const executeRegistrationWrites = async (): Promise<User> => {
      const nowIso = this.deps.clock.nowIso();

      // 1. Mark challenge consumed
      await this.deps.verificationRepository.markConsumed(challenge.id, nowIso);

      // 2. Create user
      const createdUser = await this.deps.userRepository.create({
        id: userId,
        leetcodeUsername: challenge.leetcodeUsername,
        passwordHash: hash,
        passwordSalt: salt,
      });

      // 3. Safe legacy data claiming (only if verified username matches legacy username)
      await this.deps.userRepository.claimLegacyData(createdUser.id, createdUser.leetcodeUsername);

      // 4. Set configured username in user's settings
      await this.deps.settingsRepository.setLeetCodeUsername(createdUser.leetcodeUsername, createdUser.id);

      // 5. Create session
      await this.deps.sessionRepository.createSession({
        tokenHash,
        userId: createdUser.id,
        expiresAt,
      });

      return createdUser;
    };

    const user = this.deps.db
      ? await this.deps.db.transaction(executeRegistrationWrites)
      : await executeRegistrationWrites();

    return { user, sessionToken };
  }

  public async login(
    username: string,
    password: string,
    clientIp?: string
  ): Promise<{ user: User; sessionToken: string }> {
    const cleanUsername = username.trim().toLowerCase();
    const ipKey = clientIp || '127.0.0.1';
    const config = this.getRateLimitConfig();

    // 1. Broad IP-level rate limit
    this.rateLimiter.check(
      `login_ip:${ipKey}`,
      config.loginIpMaxAttempts,
      config.windowMs,
      'Too many login attempts from this IP. Please wait 15 minutes.'
    );

    // 2. Account + IP pair rate limit (prevents an attacker on IP A from locking out legitimate user on IP B)
    this.rateLimiter.check(
      `login_account_ip:${cleanUsername}:${ipKey}`,
      config.loginMaxAttempts,
      config.windowMs,
      'Too many failed login attempts for this account from your IP. Please wait 15 minutes.'
    );

    const userRecord = await this.deps.userRepository.findByUsername(cleanUsername);

    if (!userRecord) {
      throw new ValidationError('Invalid username or password.');
    }

    const isValid = await verifyPassword(
      password,
      userRecord.passwordHash,
      userRecord.passwordSalt
    );

    if (!isValid) {
      throw new ValidationError('Invalid username or password.');
    }

    // Reset account-level rate limiter record for THIS IP ONLY on successful authentication.
    // Note: Never reset other IPs' abuse records to prevent cross-IP rate-limit bypass.
    this.rateLimiter.reset(`login_account_ip:${cleanUsername}:${ipKey}`);

    // Create session (7 days)
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashStringSha256(sessionToken);
    const expiresAt = new Date(this.deps.clock.now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await this.deps.sessionRepository.createSession({
      tokenHash,
      userId: userRecord.id,
      expiresAt,
    });

    return {
      user: {
        id: userRecord.id,
        leetcodeUsername: userRecord.leetcodeUsername,
        createdAt: userRecord.createdAt,
      },
      sessionToken,
    };
  }

  public async logout(sessionToken: string): Promise<void> {
    if (!sessionToken) return;
    const tokenHash = hashStringSha256(sessionToken);
    await this.deps.sessionRepository.deleteSession(tokenHash);
  }

  public async validateSession(sessionToken: string): Promise<{ user: User } | null> {
    if (!sessionToken) return null;
    const tokenHash = hashStringSha256(sessionToken);
    const result = await this.deps.sessionRepository.findSessionByTokenHash(
      tokenHash,
      this.deps.clock.nowIso()
    );
    if (!result) return null;
    return { user: result.user };
  }
}
