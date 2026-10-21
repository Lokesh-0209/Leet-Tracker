/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createServer as createViteServer } from 'vite';
import { createSqliteDatabase } from './db/sqliteDatabase.js';
import { runMigrations } from './db/schema.js';
import { SqliteProblemRepository } from './repositories/sqliteProblemRepository.js';
import { SqliteSettingsRepository } from './repositories/settingsRepository.js';
import { SystemClock } from './domain/clock.js';
import { FetchHttpClient } from './services/httpClient.js';
import { LeetCodeProblemSource } from './services/leetcode/leetcodeProblemSource.js';
import { SyncService } from './services/syncService.js';
import { ProblemService } from './services/problemService.js';
import { BackupService } from './services/backupService.js';
import {
  createApiApp,
  createAuthMiddleware,
  loadAuthConfig,
  csrfMiddleware,
  type AuthConfig,
} from './api/index.js';

export async function createFullApp(authConfigOverride?: AuthConfig): Promise<express.Application> {
  const rootApp = express();
  const authConfig = authConfigOverride ?? loadAuthConfig();

  // 1. LOCKED MODE: When NODE_ENV=production and APP_PASSWORD is missing or shorter than 12 characters
  if (authConfig.locked) {
    console.error(
      '[Security] ERROR: APP_PASSWORD is not configured. Server is running in locked mode.'
    );

    // Platform health check returns 200 so deployment rollout checks pass
    rootApp.get('/api/health', (_req, res) => {
      res.status(200).json({ ok: true });
    });

    // EVERY other request (any method, any path) returns 503
    rootApp.use((_req, res) => {
      res.status(503).json({
        code: 'AUTH_NOT_CONFIGURED',
        message: 'Server is locked: APP_PASSWORD is not configured.',
        retryable: false,
      });
    });

    // In locked mode, do not mount API routes or static file handlers, and do not open the database
    return rootApp;
  }

  // 2. HTTP Basic Auth as the FIRST middleware on the Express app
  // Covers Vite dev middleware, static production files, and all API routes (except GET /api/health)
  rootApp.use(createAuthMiddleware(authConfig));

  // 3. CSRF Protection for state-mutating requests (POST, PUT, PATCH, DELETE)
  rootApp.use(csrfMiddleware);

  // 4. Single Composition Root: Wire persistence, services, and clock via dependency injection
  const db = createSqliteDatabase();
  console.log(`[Database] Initialized SQLite at resolved path: ${path.resolve(db.path)}`);
  runMigrations(db);

  const clock = new SystemClock();
  const problemRepository = new SqliteProblemRepository(db);
  const settingsRepository = new SqliteSettingsRepository(db);
  const httpClient = new FetchHttpClient(10000);
  const problemSource = new LeetCodeProblemSource(httpClient);

  const syncService = new SyncService(problemRepository, problemSource, settingsRepository);
  const problemService = new ProblemService(problemRepository, problemSource, clock);
  const backupService = new BackupService(db, problemRepository, settingsRepository, clock);

  // 4. Initialize and mount API App
  const apiApp = createApiApp({
    problemRepository,
    settingsRepository,
    problemService,
    syncService,
    backupService,
    clock,
  });
  rootApp.use(apiApp);

  // 5. Mount Frontend (Vite middleware in development, static build in production)
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
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  const app = await createFullApp();
  app.listen(PORT, HOST, () => {
    console.log(`Leet Tracker server running at http://${HOST}:${PORT}`);
  });
}

// Auto-start when executed as the active entry module (disabled when imported in test suites)
if (!process.env.VITEST) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
