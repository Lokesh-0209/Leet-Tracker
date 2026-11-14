/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { csrfMiddleware } from '../csrfMiddleware.js';

describe('CSRF Security Middleware - 10 Core Scenarios', () => {
  let server: Server;
  let baseUrl: string;
  let serverHost: string;

  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    app.use(csrfMiddleware);

    app.get('/api/resource', (_req, res) => {
      res.json({ ok: true });
    });

    app.post('/api/mutation', (_req, res) => {
      res.json({ mutated: true });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        serverHost = `127.0.0.1:${addr.port}`;
        baseUrl = `http://${serverHost}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  /* -------------------------------------------------------------------------- */
  /* SCENARIO 1: Safe methods (GET, HEAD, OPTIONS) bypass CSRF checks           */
  /* -------------------------------------------------------------------------- */
  it('Scenario 1: Non-mutating methods bypass CSRF checks even with cross-site headers', async () => {
    const res = await fetch(`${baseUrl}/api/resource`, {
      method: 'GET',
      headers: {
        'Sec-Fetch-Site': 'cross-site',
        Origin: 'http://malicious.example.com',
      },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
  });

  /* -------------------------------------------------------------------------- */
  /* SCENARIO 2: Mutating request with Sec-Fetch-Site: cross-site -> 403        */
  /* -------------------------------------------------------------------------- */
  it('Scenario 2: Mutating request with Sec-Fetch-Site: cross-site is rejected with 403 FORBIDDEN', async () => {
    const res = await fetch(`${baseUrl}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'cross-site',
      },
      body: JSON.stringify({ item: 'val' }),
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe('FORBIDDEN');
    expect(json.message).toContain('Cross-site request blocked by CSRF policy');
  });

  /* -------------------------------------------------------------------------- */
  /* SCENARIO 3: Mutating request with Sec-Fetch-Site: same-origin & matching Origin */
  /* -------------------------------------------------------------------------- */
  it('Scenario 3: Mutating request with Sec-Fetch-Site: same-origin and matching Origin is allowed (200)', async () => {
    const res = await fetch(`${baseUrl}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'same-origin',
        Origin: `http://${serverHost}`,
        Host: serverHost,
      },
      body: JSON.stringify({ item: 'val' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ mutated: true });
  });

  /* -------------------------------------------------------------------------- */
  /* SCENARIO 4: Mutating request with Sec-Fetch-Site: same-site & matching Origin */
  /* -------------------------------------------------------------------------- */
  it('Scenario 4: Mutating request with Sec-Fetch-Site: same-site and matching Origin is allowed (200)', async () => {
    const res = await fetch(`${baseUrl}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'same-site',
        Origin: `http://${serverHost}`,
        Host: serverHost,
      },
      body: JSON.stringify({ item: 'val' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ mutated: true });
  });

  /* -------------------------------------------------------------------------- */
  /* SCENARIO 5: Mutating request with mismatched Origin -> 403 FORBIDDEN       */
  /* -------------------------------------------------------------------------- */
  it('Scenario 5: Mutating request with mismatched Origin header is rejected with 403', async () => {
    const res = await fetch(`${baseUrl}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://attacker-site.com',
        Host: serverHost,
      },
      body: JSON.stringify({ item: 'val' }),
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe('FORBIDDEN');
    expect(json.message).toContain('Origin mismatch');
  });

  /* -------------------------------------------------------------------------- */
  /* SCENARIO 6: Mutating request with malformed Origin header -> 403           */
  /* -------------------------------------------------------------------------- */
  it('Scenario 6: Mutating request with malformed Origin header is rejected with 403', async () => {
    const res = await fetch(`${baseUrl}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'not-a-valid-url-format::',
        Host: serverHost,
      },
      body: JSON.stringify({ item: 'val' }),
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe('FORBIDDEN');
    expect(json.message).toContain('Invalid Origin header');
  });

  /* -------------------------------------------------------------------------- */
  /* SCENARIO 7: Missing Origin, valid same-origin Referer fallback -> 200 OK   */
  /* -------------------------------------------------------------------------- */
  it('Scenario 7: When Origin is absent, valid same-origin Referer is accepted with 200', async () => {
    const res = await fetch(`${baseUrl}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: `http://${serverHost}/dashboard`,
        Host: serverHost,
      },
      body: JSON.stringify({ item: 'val' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ mutated: true });
  });

  /* -------------------------------------------------------------------------- */
  /* SCENARIO 8: Missing Origin, cross-origin Referer fallback -> 403 FORBIDDEN */
  /* -------------------------------------------------------------------------- */
  it('Scenario 8: When Origin is absent, cross-origin Referer is rejected with 403', async () => {
    const res = await fetch(`${baseUrl}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: 'http://phishing.site.org/attack',
        Host: serverHost,
      },
      body: JSON.stringify({ item: 'val' }),
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe('FORBIDDEN');
    expect(json.message).toContain('Referer mismatch');
  });

  /* -------------------------------------------------------------------------- */
  /* SCENARIO 9: Cookie-authenticated request without Origin/Referer/Custom header */
  /* -------------------------------------------------------------------------- */
  it('Scenario 9: Cookie-authenticated mutating request missing Origin, Referer, and custom header is rejected (403)', async () => {
    const res = await fetch(`${baseUrl}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: 'leet_session=secret_session_token_12345',
        Host: serverHost,
      },
      body: 'item=val',
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe('FORBIDDEN');
    expect(json.message).toContain('requires Origin, Referer, or custom anti-CSRF header');
  });

  /* -------------------------------------------------------------------------- */
  /* SCENARIO 10: Cookie request with custom header OR programmatic without cookie */
  /* -------------------------------------------------------------------------- */
  it('Scenario 10a: Cookie-authenticated request with X-Requested-With custom header is allowed (200)', async () => {
    const res = await fetch(`${baseUrl}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: 'leet_session=secret_session_token_12345',
        'X-Requested-With': 'XMLHttpRequest',
        Host: serverHost,
      },
      body: 'item=val',
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ mutated: true });
  });

  it('Scenario 10b: Cookie-authenticated request with X-Timezone custom header (apiClient) is allowed (200)', async () => {
    const res = await fetch(`${baseUrl}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: 'leet_session=secret_session_token_12345',
        'X-Timezone': 'America/New_York',
        Host: serverHost,
      },
      body: 'item=val',
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ mutated: true });
  });

  it('Scenario 10c: Unauthenticated programmatic request without session cookie is allowed (200)', async () => {
    const res = await fetch(`${baseUrl}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: serverHost,
      },
      body: JSON.stringify({ item: 'val' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ mutated: true });
  });
});
