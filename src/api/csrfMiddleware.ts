/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response, NextFunction } from 'express';

/**
 * CSRF Protection Middleware
 *
 * Rules:
 * - Safe methods (GET, HEAD, OPTIONS) bypass CSRF checks.
 * - For mutating methods (POST, PUT, PATCH, DELETE):
 *   1. Reject with 403 when Sec-Fetch-Site is "cross-site".
 *   2. When Origin header is present:
 *      - Reject with 403 if malformed.
 *      - Reject with 403 if origin host does not match request Host.
 *      - Allow if matches.
 *   3. When Origin is absent but Referer is present:
 *      - Reject with 403 if malformed.
 *      - Reject with 403 if referer host does not match request Host.
 *      - Allow if matches.
 *   4. When both Origin and Referer are absent:
 *      - If request carries ambient session credentials (leet_session cookie),
 *        require a custom anti-CSRF header (X-Requested-With, X-CSRF-Token, X-CSRF-Protection, or X-Timezone)
 *        to prevent CSRF via header stripping. Reject with 403 if missing.
 *      - Programmatic non-browser requests without session cookies (curl, CLI, tests) are allowed.
 */
export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  const mutatingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];

  if (!mutatingMethods.includes(method)) {
    return next();
  }

  // 1. Check Sec-Fetch-Site
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite === 'cross-site') {
    res.status(403).json({
      code: 'FORBIDDEN',
      message: 'Cross-site request blocked by CSRF policy',
      retryable: false,
    });
    return;
  }

  const requestHost = (req.get('host') || req.headers['host'] || '').toLowerCase();

  // 2. Check Origin header against Host header
  const originHeader = req.headers['origin'];
  if (originHeader) {
    let originHost = '';
    try {
      const url = new URL(String(originHeader));
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.host) {
        res.status(403).json({
          code: 'FORBIDDEN',
          message: 'Invalid Origin header',
          retryable: false,
        });
        return;
      }
      originHost = url.host.toLowerCase();
    } catch {
      res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Invalid Origin header',
        retryable: false,
      });
      return;
    }

    if (!requestHost || originHost !== requestHost) {
      res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Cross-origin request blocked: Origin mismatch',
        retryable: false,
      });
      return;
    }

    return next();
  }

  // 3. Check Referer fallback when Origin is not provided
  const refererHeader = req.headers['referer'];
  if (refererHeader) {
    let refererHost = '';
    try {
      const url = new URL(String(refererHeader));
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.host) {
        res.status(403).json({
          code: 'FORBIDDEN',
          message: 'Invalid Referer header',
          retryable: false,
        });
        return;
      }
      refererHost = url.host.toLowerCase();
    } catch {
      res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Invalid Referer header',
        retryable: false,
      });
      return;
    }

    if (!requestHost || refererHost !== requestHost) {
      res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Cross-origin request blocked: Referer mismatch',
        retryable: false,
      });
      return;
    }

    return next();
  }

  // 4. Neither Origin nor Referer provided.
  // Ambient cookie requests from browsers using simple form encodings (or stripped headers)
  // must be rejected unless accompanied by a custom anti-CSRF header.
  const cookieHeader = req.headers.cookie;
  const hasSessionCookie = Boolean(
    cookieHeader && /(?:^|;\s*)leet_session=[^;]+/.test(cookieHeader)
  );

  if (hasSessionCookie) {
    const contentType = (req.headers['content-type'] || '').toLowerCase();
    const hasCustomHeader = Boolean(
      req.headers['x-requested-with'] ||
      req.headers['x-csrf-token'] ||
      req.headers['x-csrf-protection'] ||
      req.headers['x-timezone']
    );

    const isSimpleForm =
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data') ||
      contentType.includes('text/plain');

    const isBrowserNavigation =
      req.headers['sec-fetch-mode'] === 'navigate' ||
      req.headers['sec-fetch-dest'] === 'document';

    if ((isSimpleForm || isBrowserNavigation) && !hasCustomHeader) {
      res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Mutating request with session credentials requires Origin, Referer, or custom anti-CSRF header',
        retryable: false,
      });
      return;
    }
  }

  // Non-browser or unauthenticated programmatic API clients (curl, CLI, tests) are allowed
  next();
}
