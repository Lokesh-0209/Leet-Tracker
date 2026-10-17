/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      userTimeZone: string;
    }
  }
}

/**
 * Validates whether an IANA time zone identifier is recognized by the runtime.
 */
export function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the user's timezone from the X-Timezone header or query parameter,
 * falling back to the server's default timezone.
 */
export function timezoneMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const headerTz = req.header('x-timezone')?.trim();
  const queryTz = typeof req.query.timezone === 'string' ? req.query.timezone.trim() : undefined;

  const candidate = headerTz || queryTz;

  if (candidate && isValidTimeZone(candidate)) {
    req.userTimeZone = candidate;
  } else {
    req.userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }

  next();
}
