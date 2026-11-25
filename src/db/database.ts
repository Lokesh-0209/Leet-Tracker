/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createSqliteDatabase, type DatabasePort } from './sqliteDatabase.js';
import { PostgresDatabase } from './postgresDatabase.js';

/** Keep SQLite for local development; use the managed Postgres database on Netlify. */
export async function createApplicationDatabase(): Promise<DatabasePort> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) return new PostgresDatabase(databaseUrl);

  if (process.env.NETLIFY || process.env.NETLIFY_SERVER_ENTRY) {
    const { getConnectionString } = await import('@netlify/database');
    return new PostgresDatabase(getConnectionString());
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL or a Netlify Database connection is required in production.');
  }

  return createSqliteDatabase();
}
