/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export interface AuthConfig {
  readonly locked: boolean;
  readonly lockedReason?: string;
  readonly enabled: boolean;
  readonly username: string;
  readonly password?: string;
}

/**
 * Loads and validates authentication configuration from environment variables.
 *
 * Rules:
 * - When NODE_ENV=production and APP_PASSWORD is missing or shorter than 12 characters:
 *   Returns locked mode (locked: true). The server will start and bind to PORT/HOST so
 *   platform health checks pass, but will reject all non-health requests with 503.
 * - Outside production:
 *   - No APP_PASSWORD means no gate (enabled: false) for local development.
 *   - A password shorter than 12 characters is rejected (throws an error).
 * - When APP_PASSWORD is valid (>= 12 characters):
 *   Returns active gate (locked: false, enabled: true).
 */
export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const isProduction = env.NODE_ENV === 'production';
  const password = env.APP_PASSWORD;
  const username = env.APP_USERNAME || 'leet';

  if (isProduction) {
    if (!password || password.length < 12) {
      return {
        locked: true,
        lockedReason: 'APP_PASSWORD is not configured.',
        enabled: false,
        username,
      };
    }

    return {
      locked: false,
      enabled: true,
      username,
      password,
    };
  }

  // Non-production (local development / testing)
  if (password !== undefined && password !== '') {
    if (password.length < 12) {
      throw new Error(`APP_PASSWORD must be at least 12 characters long (received ${password.length}).`);
    }
    return {
      locked: false,
      enabled: true,
      username,
      password,
    };
  }

  return {
    locked: false,
    enabled: false,
    username,
  };
}

/**
 * HTTP Basic Authentication middleware for active mode.
 *
 * Enforces:
 * - Constant-time comparison using SHA-256 digests and crypto.timingSafeEqual.
 * - Evaluates both username and password.
 * - Failed attempts receive a 750 ms delay and a 401 response with WWW-Authenticate header.
 * - Passwords containing colons are properly supported (first colon separates username).
 * - Exempts only GET /api/health.
 * - Never logs credentials or Authorization headers.
 */
export function createAuthMiddleware(config: AuthConfig = loadAuthConfig()) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Exempt ONLY GET /api/health
    const reqPath = req.path || req.originalUrl?.split('?')[0];
    if (req.method === 'GET' && reqPath === '/api/health') {
      return next();
    }

    // Gate disabled in non-production when APP_PASSWORD is not set
    if (!config.enabled) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      res.setHeader('WWW-Authenticate', 'Basic realm="Leet Tracker", charset="UTF-8"');
      res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        retryable: false,
      });
      return;
    }

    const encoded = authHeader.slice(6).trim();
    let decoded = '';
    try {
      decoded = Buffer.from(encoded, 'base64').toString('utf8');
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 750));
      res.setHeader('WWW-Authenticate', 'Basic realm="Leet Tracker", charset="UTF-8"');
      res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Invalid authorization encoding',
        retryable: false,
      });
      return;
    }

    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      res.setHeader('WWW-Authenticate', 'Basic realm="Leet Tracker", charset="UTF-8"');
      res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Invalid authorization format',
        retryable: false,
      });
      return;
    }

    const suppliedUser = decoded.slice(0, colonIndex);
    const suppliedPass = decoded.slice(colonIndex + 1);

    const expectedUser = config.username;
    const expectedPass = config.password || '';

    // Constant-time comparison: hash both strings to 32-byte buffers before timingSafeEqual
    const expectedUserDigest = crypto.createHash('sha256').update(expectedUser).digest();
    const suppliedUserDigest = crypto.createHash('sha256').update(suppliedUser).digest();
    const userMatch = crypto.timingSafeEqual(expectedUserDigest, suppliedUserDigest);

    const expectedPassDigest = crypto.createHash('sha256').update(expectedPass).digest();
    const suppliedPassDigest = crypto.createHash('sha256').update(suppliedPass).digest();
    const passMatch = crypto.timingSafeEqual(expectedPassDigest, suppliedPassDigest);

    if (userMatch && passMatch) {
      return next();
    }

    // Delay on failed credential verification
    await new Promise((resolve) => setTimeout(resolve, 750));
    res.setHeader('WWW-Authenticate', 'Basic realm="Leet Tracker", charset="UTF-8"');
    res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Invalid credentials',
      retryable: false,
    });
  };
}
