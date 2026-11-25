/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import type { DatabasePort, SqliteRunResult } from './sqliteDatabase.js';

type PgClient = pg.PoolClient;

interface TransactionContext {
  readonly client: PgClient;
  savepoint: number;
}

const transactionStorage = new AsyncLocalStorage<TransactionContext>();

function toPgSql(sql: string): string {
  let index = 0;
  return sql
    .replace(/\?/g, () => `$${++index}`)
    .replace(/\s+COLLATE\s+NOCASE/gi, '');
}

/** PostgreSQL implementation of the application's small SQL port. */
export class PostgresDatabase implements DatabasePort {
  private readonly pool: pg.Pool;
  public isClosed = false;
  public readonly isMemory = false;
  public readonly path = 'postgresql';

  constructor(connectionString: string, options: { maxConnections?: number } = {}) {
    this.pool = new pg.Pool({
      connectionString,
      max: options.maxConnections ?? 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    this.pool.on('error', (error) => {
      console.error('[Database] Idle PostgreSQL connection error:', error.message);
    });
  }

  public async exec(sql: string): Promise<void> {
    this.assertOpen();
    const context = transactionStorage.getStore();
    await (context ? context.client : this.pool).query(toPgSql(sql));
  }

  public prepare<T = Record<string, unknown>>(sql: string) {
    const statement = toPgSql(sql);
    return {
      run: async (...params: unknown[]): Promise<SqliteRunResult> => {
        this.assertOpen();
        const context = transactionStorage.getStore();
        const result = await (context ? context.client : this.pool).query(statement, params);
        return { changes: result.rowCount ?? 0, lastInsertRowid: 0 };
      },
      get: async (...params: unknown[]): Promise<T | undefined> => {
        this.assertOpen();
        const context = transactionStorage.getStore();
        const result = await (context ? context.client : this.pool).query(statement, params);
        return result.rows[0] as T | undefined;
      },
      all: async <R = T>(...params: unknown[]): Promise<R[]> => {
        this.assertOpen();
        const context = transactionStorage.getStore();
        const result = await (context ? context.client : this.pool).query(statement, params);
        return result.rows as R[];
      },
    };
  }

  public async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    this.assertOpen();
    const parent = transactionStorage.getStore();
    if (parent) {
      const name = `nested_${++parent.savepoint}`;
      await parent.client.query(`SAVEPOINT ${name}`);
      try {
        const result = await fn();
        await parent.client.query(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (error) {
        await parent.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        await parent.client.query(`RELEASE SAVEPOINT ${name}`);
        throw error;
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await transactionStorage.run({ client, savepoint: 0 }, fn);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    await this.pool.end();
  }

  private assertOpen(): void {
    if (this.isClosed) throw new Error('Database is closed');
  }
}
