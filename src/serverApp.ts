/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import 'dotenv/config';
import { createServer as createViteServer } from 'vite';
import { createApplicationDatabase } from './db/database.js';
import { runMigrations } from './db/schema.js';
import type { SqliteDatabasePort } from './db/sqliteDatabase.js';
import { runPostgresMigrations } from './db/postgresSchema.js';
import { SqliteProblemRepository } from './repositories/sqliteProblemRepository.js';
import { SqliteSettingsRepository } from './repositories/settingsRepository.js';
import { SqliteUserRepository } from './repositories/userRepository.js';
import { SqliteSessionRepository } from './repositories/sessionRepository.js';
import { SqliteVerificationRepository } from './repositories/verificationRepository.js';
import { SystemClock } from './domain/clock.js';
import { FetchHttpClient } from './services/httpClient.js';
import { LeetCodeProblemSource } from './services/leetcode/leetcodeProblemSource.js';
import { SyncService } from './services/syncService.js';
import { ProblemService } from './services/problemService.js';
import { BackupService } from './services/backupService.js';
import { AuthService } from './services/authService.js';
import {
  createApiApp,
  csrfMiddleware,
  configureProxyTrust,
} from './api/index.js';

export interface AppOptions {
  readonly locked?: boolean;
}

export async function createFullApp(options?: AppOptions): Promise<express.Application> {
  const rootApp = express();

  // Configure reverse proxy trust for secure req.ip determination
  configureProxyTrust(rootApp);

  // Support explicit locked mode override (used for testing locked mode behavior)
  if (options?.locked) {
    console.error(
      '[Security] Server is running in locked maintenance mode.'
    );

    // Platform health check returns 200 so deployment rollout checks pass
    rootApp.get('/api/health', (_req, res) => {
      res.status(200).json({ ok: true });
    });

    // EVERY other request (any method, any path) returns 503
    rootApp.use((_req, res) => {
      res.status(503).json({
        code: 'AUTH_NOT_CONFIGURED',
        message: 'Server is locked: administrative authentication is not configured.',
        retryable: false,
      });
    });

    return rootApp;
  }

  // CSRF Protection for state-mutating requests (POST, PUT, PATCH, DELETE)
  rootApp.use(csrfMiddleware);

  // Single Composition Root: Wire persistence, services, and clock via dependency injection
  const db = await createApplicationDatabase();
  if (db.path === 'postgresql') {
    console.log('[Database] Connected to PostgreSQL.');
    await runPostgresMigrations(db);
  } else {
    console.log(`[Database] Initialized SQLite at resolved path: ${path.resolve(db.path)}`);
    runMigrations(db as SqliteDatabasePort);
  }

  const clock = new SystemClock();
  const problemRepository = new SqliteProblemRepository(db);
  const settingsRepository = new SqliteSettingsRepository(db);
  const userRepository = new SqliteUserRepository(db);
  const sessionRepository = new SqliteSessionRepository(db);
  const verificationRepository = new SqliteVerificationRepository(db);

  const httpClient = new FetchHttpClient(10000);
  const problemSource = new LeetCodeProblemSource(httpClient);

  const authService = new AuthService({
    userRepository,
    sessionRepository,
    verificationRepository,
    settingsRepository,
    httpClient,
    clock,
    db,
  });

  const syncService = new SyncService(problemRepository, problemSource, settingsRepository);
  const problemService = new ProblemService(problemRepository, problemSource, clock);
  const backupService = new BackupService(db, problemRepository, settingsRepository, clock);

  // Initialize and mount API App
  const apiApp = createApiApp({
    problemRepository,
    settingsRepository,
    problemService,
    syncService,
    backupService,
    authService,
    clock,
  });
  rootApp.use(apiApp);

  // Mount Frontend (Vite middleware in development, static build in production)
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    rootApp.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      rootApp.use(express.static(distPath));
      rootApp.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  return rootApp;
}

export async function startServer(): Promise<void> {
  // Fail before opening the database or accepting traffic when production is
  // missing the secret used to protect profile verification challenges.
  if (process.env.NODE_ENV === 'production') {
    const secret = process.env.VERIFICATION_SECRET?.trim();
    if (!secret || secret.length < 16) {
      throw new Error(
        'VERIFICATION_SECRET must be set to at least 16 characters in production.'
      );
    }
  }

  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  const app = await createFullApp();
  app.listen(PORT, HOST, () => {
    console.log(`Leet Tracker server running at http://${HOST}:${PORT}`);
  });
}

// Auto-start when executed as the active entry module (disabled when imported in test suites)
if (!process.env.VITEST && !process.env.NETLIFY_SERVER_ENTRY) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
