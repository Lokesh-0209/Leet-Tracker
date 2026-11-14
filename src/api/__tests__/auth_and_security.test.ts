/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { csrfMiddleware } from '../index.js';
import { createSqliteDatabase } from '../../db/sqliteDatabase.js';
import { createFullApp, type AppOptions } from '../../serverApp.js';

describe('Security Hardening, Locked Mode, CSRF, and Persistence', () => {
  /* -------------------------------------------------------------------------- */
  /* 1. LOCKED MODE IN PRODUCTION                                               */
  /* -------------------------------------------------------------------------- */
  describe('Locked Mode in Production (createFullApp)', () => {
    let server: Server;
    let baseUrl: string;

    const startAppWithOptions = async (options?: AppOptions) => {
      const app = await createFullApp(options);
      return new Promise<void>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          const addr = server.address() as AddressInfo;
          baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });
    };

    afterEach(async () => {
      if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('production locked mode returns 200 on /api/health and 503 on / and /api/problems', async () => {
      await startAppWithOptions({ locked: true });

      const healthRes = await fetch(`${baseUrl}/api/health`);
      expect(healthRes.status).toBe(200);
      expect(await healthRes.json()).toEqual({ ok: true });

      const rootRes = await fetch(`${baseUrl}/`);
      expect(rootRes.status).toBe(503);
      expect(await rootRes.json()).toEqual({
        code: 'AUTH_NOT_CONFIGURED',
        message: 'Server is locked: administrative authentication is not configured.',
        retryable: false,
      });

      const problemsRes = await fetch(`${baseUrl}/api/problems`);
      expect(problemsRes.status).toBe(503);
      expect(await problemsRes.json()).toEqual({
        code: 'AUTH_NOT_CONFIGURED',
        message: 'Server is locked: administrative authentication is not configured.',
        retryable: false,
      });
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. CSRF PROTECTION                                                         */
  /* -------------------------------------------------------------------------- */
  describe('CSRF Protection Middleware', () => {
    let server: Server;
    let baseUrl: string;
    let serverHost: string;

    beforeEach(async () => {
      const app = express();
      app.use(express.json());
      app.use(csrfMiddleware);

      app.post('/api/test-mutation', (_req, res) => {
        res.json({ success: true });
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

    it('Given cross-origin POST with mismatched Origin header, Then rejects with 403 FORBIDDEN', async () => {
      const res = await fetch(`${baseUrl}/api/test-mutation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://malicious-website.com',
          Host: serverHost,
        },
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe('FORBIDDEN');
    });

    it('Given POST with Sec-Fetch-Site: cross-site, Then rejects with 403 FORBIDDEN', async () => {
      const res = await fetch(`${baseUrl}/api/test-mutation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Sec-Fetch-Site': 'cross-site',
        },
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe('FORBIDDEN');
    });

    it('Given same-origin POST with matching Origin and Host, Then allows request with 200', async () => {
      const res = await fetch(`${baseUrl}/api/test-mutation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: `http://${serverHost}`,
          Host: serverHost,
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ success: true });
    });

    it('Given programmatic request with neither header (e.g. curl / internal), Then allows request with 200', async () => {
      const res = await fetch(`${baseUrl}/api/test-mutation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ success: true });
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. DATABASE DIRECTORY CREATION                                             */
  /* -------------------------------------------------------------------------- */
  describe('Database directory creation', () => {
    it('Given a database path with non-existent parent directory, When initialized, Then creates missing directory', () => {
      const tmpDir = path.join(os.tmpdir(), `leet_test_${Date.now()}`);
      const dbPath = path.join(tmpDir, 'nested', 'test.db');

      expect(fs.existsSync(path.dirname(dbPath))).toBe(false);

      const db = createSqliteDatabase(dbPath);
      expect(fs.existsSync(path.dirname(dbPath))).toBe(true);

      db.close();

      // Clean up
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
