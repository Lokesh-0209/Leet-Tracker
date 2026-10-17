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
import { createApiApp } from './api/app.js';

export async function createFullApp(): Promise<express.Application> {
  // 1. Single Composition Root: Wire persistence, services, and clock via dependency injection
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

  // 2. Initialize API App with all dependencies injected
  const app = createApiApp({
    problemRepository,
    settingsRepository,
    problemService,
    syncService,
    backupService,
    clock,
  });

  // 3. Mount Frontend (Vite middleware in development, static build in production)
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  return app;
}

export async function startServer(): Promise<void> {
  const PORT = Number(process.env.PORT) || 3000;
  const app = await createFullApp();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Leet Tracker server running at http://0.0.0.0:${PORT}`);
  });
}

// Auto-start when executed as the active entry module
startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
