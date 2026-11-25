/**
 * Copy the ignored local SQLite data file into an already provisioned Postgres DB.
 * This command requires an explicit --confirm flag and never deletes source data.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSqliteDatabase } from '../src/db/sqliteDatabase.js';
import { runMigrations } from '../src/db/schema.js';
import { createApplicationDatabase } from '../src/db/database.js';
import { runPostgresMigrations } from '../src/db/postgresSchema.js';

const sourcePath = path.resolve(process.argv[2] ?? 'data/leet-tracker.db');
if (!process.argv.includes('--confirm')) {
  throw new Error('Add --confirm to copy SQLite data to the configured PostgreSQL database.');
}
if (!process.env.DATABASE_URL) {
  throw new Error('Set DATABASE_URL to the destination PostgreSQL connection string.');
}
if (!fs.existsSync(sourcePath)) {
  throw new Error(`SQLite database not found: ${sourcePath}`);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leet-tracker-migration-'));
const workingCopy = path.join(tempDir, 'source.db');
fs.copyFileSync(sourcePath, workingCopy);

const source = createSqliteDatabase(workingCopy);
const destination = await createApplicationDatabase();
const tables = ['users', 'verification_challenges', 'problems', 'notes', 'reviews', 'settings', 'sessions'];

try {
  // Run any legacy SQLite migrations on a temporary copy, preserving the user's file.
  runMigrations(source);
  await runPostgresMigrations(destination);

  const copiedCounts: Record<string, number> = {};
  await destination.transaction(async () => {
    for (const table of tables) {
      const rows = source.prepare<Record<string, unknown>>(`SELECT * FROM ${table}`).all();
      copiedCounts[table] = rows.length;
      if (!rows.length) continue;

      const columns = Object.keys(rows[0]);
      const names = columns.map((column) => `"${column}"`).join(', ');
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
      const insert = destination.prepare(
        `INSERT INTO ${table} (${names}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
      );
      for (const row of rows) {
        await insert.run(...columns.map((column) => row[column]));
      }
    }
  });

  console.log('SQLite data copied. Existing Postgres rows were kept. Row counts read from the SQLite copy:');
  for (const [table, count] of Object.entries(copiedCounts)) console.log(`  ${table}: ${count}`);
} finally {
  source.close();
  await destination.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
