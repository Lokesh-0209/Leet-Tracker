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
import {
  createAuthMiddleware,
  loadAuthConfig,
  csrfMiddleware,
  type AuthConfig,
} from '../index.js';
import { createSqliteDatabase } from '../../db/sqliteDatabase.js';
import { createFullApp } from '../../serverApp.js';

describe('Password Gate, CSRF Protection, and Security Hardening', () => {
  /* -------------------------------------------------------------------------- */
  /* 1. ENV LOADER BEHAVIOR                                                     */
  /* -------------------------------------------------------------------------- */
  describe('loadAuthConfig', () => {
    it('Given NODE_ENV=production without APP_PASSWORD, Then returns locked mode', () => {
      const config = loadAuthConfig({ NODE_ENV: 'production' });
      expect(config.locked).toBe(true);
      expect(config.enabled).toBe(false);
      expect(config.lockedReason).toBe('APP_PASSWORD is not configured.');
    });

    it('Given NODE_ENV=production with short APP_PASSWORD, Then returns locked mode', () => {
      const config = loadAuthConfig({ NODE_ENV: 'production', APP_PASSWORD: 'short' });
      expect(config.locked).toBe(true);
      expect(config.enabled).toBe(false);
    });

    it('Given APP_PASSWORD shorter than 12 characters in development, Then throws clear error', () => {
      expect(() => {
        loadAuthConfig({ NODE_ENV: 'development', APP_PASSWORD: 'short' });
      }).toThrow('APP_PASSWORD must be at least 12 characters long (received 5).');

      expect(() => {
        loadAuthConfig({ NODE_ENV: 'development', APP_PASSWORD: '12345678901' });
      }).toThrow('APP_PASSWORD must be at least 12 characters long (received 11).');
    });

    it('Given non-production without APP_PASSWORD, Then runs with gate disabled', () => {
      const config = loadAuthConfig({ NODE_ENV: 'development' });
      expect(config.locked).toBe(false);
      expect(config.enabled).toBe(false);
      expect(config.username).toBe('leet');
    });

    it('Given APP_USERNAME default and override, Then honors configuration', () => {
      const configDefault = loadAuthConfig({
        NODE_ENV: 'production',
        APP_PASSWORD: 'supersecretpassword123',
      });
      expect(configDefault.username).toBe('leet');
      expect(configDefault.locked).toBe(false);
      expect(configDefault.enabled).toBe(true);

      const configCustom = loadAuthConfig({
        NODE_ENV: 'production',
        APP_PASSWORD: 'supersecretpassword123',
        APP_USERNAME: 'admin_user',
      });
      expect(configCustom.username).toBe('admin_user');
      expect(configCustom.locked).toBe(false);
      expect(configCustom.enabled).toBe(true);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. LOCKED MODE IN PRODUCTION                                               */
  /* -------------------------------------------------------------------------- */
  describe('Locked Mode in Production (createFullApp)', () => {
    let server: Server;
    let baseUrl: string;

    const startAppWithConfig = async (authConfig: AuthConfig) => {
      const app = await createFullApp(authConfig);
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

    it('production with no password gives locked mode (503 on / and /api/problems, 200 on /api/health)', async () => {
      const config = loadAuthConfig({ NODE_ENV: 'production' });
      expect(config.locked).toBe(true);

      await startAppWithConfig(config);

      const healthRes = await fetch(`${baseUrl}/api/health`);
      expect(healthRes.status).toBe(200);
      expect(await healthRes.json()).toEqual({ ok: true });

      const rootRes = await fetch(`${baseUrl}/`);
      expect(rootRes.status).toBe(503);
      expect(await rootRes.json()).toEqual({
        code: 'AUTH_NOT_CONFIGURED',
        message: 'Server is locked: APP_PASSWORD is not configured.',
        retryable: false,
      });

      const problemsRes = await fetch(`${baseUrl}/api/problems`);
      expect(problemsRes.status).toBe(503);
      expect(await problemsRes.json()).toEqual({
        code: 'AUTH_NOT_CONFIGURED',
        message: 'Server is locked: APP_PASSWORD is not configured.',
        retryable: false,
      });
    });

    it('production with a short password gives locked mode (503 on / and /api/problems, 200 on /api/health)', async () => {
      const config = loadAuthConfig({ NODE_ENV: 'production', APP_PASSWORD: 'short' });
      expect(config.locked).toBe(true);

      await startAppWithConfig(config);

      const healthRes = await fetch(`${baseUrl}/api/health`);
      expect(healthRes.status).toBe(200);

      const rootRes = await fetch(`${baseUrl}/`);
      expect(rootRes.status).toBe(503);

      const problemsRes = await fetch(`${baseUrl}/api/problems`);
      expect(problemsRes.status).toBe(503);
    });

    it('production with K_SERVICE set and no password gives locked mode (503 on / and /api/problems, 200 on /api/health)', async () => {
      const config = loadAuthConfig({ NODE_ENV: 'production', K_SERVICE: 'test' });
      expect(config.locked).toBe(true);

      await startAppWithConfig(config);

      const healthRes = await fetch(`${baseUrl}/api/health`);
      expect(healthRes.status).toBe(200);

      const rootRes = await fetch(`${baseUrl}/`);
      expect(rootRes.status).toBe(503);

      const problemsRes = await fetch(`${baseUrl}/api/problems`);
      expect(problemsRes.status).toBe(503);
    });

    it('production with a valid password returns 401 without credentials and 200 with credentials', async () => {
      const config = loadAuthConfig({
        NODE_ENV: 'production',
        APP_PASSWORD: 'supersecretpassword123',
      });
      expect(config.locked).toBe(false);
      expect(config.enabled).toBe(true);

      await startAppWithConfig(config);

      // GET /api/health returns 200 without credentials
      const healthRes = await fetch(`${baseUrl}/api/health`);
      expect(healthRes.status).toBe(200);

      // GET /api/problems without credentials returns 401
      const unauthRes = await fetch(`${baseUrl}/api/problems`);
      expect(unauthRes.status).toBe(401);
      expect(unauthRes.headers.get('www-authenticate')).toBe('Basic realm="Leet Tracker", charset="UTF-8"');

      // GET /api/problems with credentials returns 200
      const creds = Buffer.from('leet:supersecretpassword123').toString('base64');
      const authRes = await fetch(`${baseUrl}/api/problems`, {
        headers: { Authorization: `Basic ${creds}` },
      });
      expect(authRes.status).toBe(200);
      expect(await authRes.json()).toEqual({ problems: [] });
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. BASIC AUTH GATE MIDDLEWARE                                              */
  /* -------------------------------------------------------------------------- */
  describe('HTTP Basic Auth Middleware', () => {
    let server: Server;
    let baseUrl: string;

    const testUser = 'leet';
    const testPassWithColon = 'secret:password:with:colons:123';

    beforeEach(async () => {
      const app = express();
      const authMiddleware = createAuthMiddleware({
        locked: false,
        enabled: true,
        username: testUser,
        password: testPassWithColon,
      });

      app.use(authMiddleware);

      // Exempt health check
      app.get('/api/health', (_req, res) => {
        res.json({ ok: true });
      });

      // Protected routes
      app.get('/', (_req, res) => {
        res.send('<html><body>Leet Tracker HTML</body></html>');
      });

      app.get('/api/problems', (_req, res) => {
        res.json({ problems: [] });
      });

      await new Promise<void>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          const addr = server.address() as AddressInfo;
          baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });
    });

    afterEach(async () => {
      if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('Given no credentials, When accessing protected route, Then returns 401 with challenge header and error body', async () => {
      const start = Date.now();
      const res = await fetch(`${baseUrl}/api/problems`);
      const elapsed = Date.now() - start;

      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Basic realm="Leet Tracker", charset="UTF-8"');
      expect(elapsed).toBeGreaterThanOrEqual(700); // 750 ms rate-limiting delay

      const json = await res.json();
      expect(json).toEqual({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        retryable: false,
      });
    });

    it('Given wrong password, When accessing protected route, Then returns 401 with challenge header', async () => {
      const wrongCredentials = Buffer.from(`${testUser}:wrongpassword`).toString('base64');
      const res = await fetch(`${baseUrl}/api/problems`, {
        headers: {
          Authorization: `Basic ${wrongCredentials}`,
        },
      });

      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Basic realm="Leet Tracker", charset="UTF-8"');
      const json = await res.json();
      expect(json.code).toBe('UNAUTHORIZED');
      expect(json.message).toBe('Invalid credentials');
    });

    it('Given wrong username, When accessing protected route, Then returns 401 with challenge header', async () => {
      const wrongUserCredentials = Buffer.from(`wronguser:${testPassWithColon}`).toString('base64');
      const res = await fetch(`${baseUrl}/api/problems`, {
        headers: {
          Authorization: `Basic ${wrongUserCredentials}`,
        },
      });

      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Basic realm="Leet Tracker", charset="UTF-8"');
    });

    it('Given malformed Authorization header without colon, Then returns 401 with challenge header', async () => {
      const noColon = Buffer.from('justapasswordwithnocolon').toString('base64');
      const res = await fetch(`${baseUrl}/api/problems`, {
        headers: {
          Authorization: `Basic ${noColon}`,
        },
      });

      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Basic realm="Leet Tracker", charset="UTF-8"');
      const json = await res.json();
      expect(json.message).toBe('Invalid authorization format');
    });

    it('Given correct credentials including a colon in the password, Then allows request and returns 200', async () => {
      const validCredentials = Buffer.from(`${testUser}:${testPassWithColon}`).toString('base64');
      const res = await fetch(`${baseUrl}/api/problems`, {
        headers: {
          Authorization: `Basic ${validCredentials}`,
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ problems: [] });
    });

    it('Given GET /api/health, When accessed without credentials, Then returns 200 without challenge', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ ok: true });
      expect(res.headers.get('www-authenticate')).toBeNull();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. CSRF PROTECTION                                                         */
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
  /* 5. DATABASE DIRECTORY CREATION                                             */
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
