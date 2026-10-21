/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response, NextFunction } from 'express';

/**
 * CSRF Protection Middleware
 *
 * Rules:
 * - For POST, PUT, PATCH, and DELETE requests:
 *   - Reject with 403 when Sec-Fetch-Site is "cross-site".
 *   - Reject with 403 when an Origin header is present and its host does not match the request Host.
 *   - Requests with neither header (curl, tests, automated scripts) are allowed.
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

  // 2. Check Origin header against Host header
  const originHeader = req.headers['origin'];
  if (originHeader) {
    let originHost = '';
    try {
      const url = new URL(String(originHeader));
      originHost = url.host; // includes hostname + port if present (e.g., "localhost:3000")
    } catch {
      res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Invalid Origin header',
        retryable: false,
      });
      return;
    }

    const requestHost = req.headers['host'];
    if (!requestHost || originHost.toLowerCase() !== requestHost.toLowerCase()) {
      res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Cross-origin request blocked: Origin mismatch',
        retryable: false,
      });
      return;
    }
  }

  // Requests with neither header (curl, programmatic API clients, tests) are allowed
  next();
}
