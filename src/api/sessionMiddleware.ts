/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response, NextFunction } from 'express';
import type { AuthService } from '../services/authService.js';
import type { User } from '../domain/models.js';

declare global {
  namespace Express {
    interface Request {
      user?: User | null;
      sessionToken?: string | null;
    }
  }
}

export function parseCookies(header?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  const pairs = header.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    result[key] = decodeURIComponent(val);
  }
  return result;
}

export function serializeCookie(
  name: string,
  val: string,
  options: {
    httpOnly?: boolean;
    sameSite?: 'Lax' | 'Strict' | 'None';
    path?: string;
    maxAge?: number;
    secure?: boolean;
  } = {}
): string {
  let cookie = `${name}=${encodeURIComponent(val)}`;
  if (options.path) cookie += `; Path=${options.path}`;
  if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`;
  if (options.httpOnly) cookie += '; HttpOnly';
  if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;
  if (options.secure) cookie += '; Secure';
  return cookie;
}

export function createSessionMiddleware(authService: AuthService) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      // Check exclusive HttpOnly cookie: leet_session (no Bearer token fallback)
      const cookies = parseCookies(req.headers.cookie);
      const token = cookies['leet_session'];

      if (!token) {
        req.user = null;
        req.sessionToken = null;
        return next();
      }

      const sessionInfo = await authService.validateSession(token);
      if (sessionInfo) {
        req.user = sessionInfo.user;
        req.sessionToken = token;
      } else {
        req.user = null;
        req.sessionToken = null;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
      retryable: false,
    });
    return;
  }
  next();
}
