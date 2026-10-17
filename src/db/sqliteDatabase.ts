/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type SqlInputValue = null | string | number | bigint | Uint8Array;

function toSqlValue(val: unknown): SqlInputValue {
  if (val === undefined || val === null) return null;
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'bigint') return val;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (val instanceof Uint8Array) return val;
  return String(val);
}

export interface SqliteRunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

export interface SqliteStatementPort<T = Record<string, unknown>> {
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): T | undefined;
  all(...params: unknown[]): T[];
}

export interface SqliteDatabasePort {
  exec(sql: string): void;
  prepare<T = Record<string, unknown>>(sql: string): SqliteStatementPort<T>;
  transaction<T>(fn: () => T): T;
  close(): void;
  readonly isMemory: boolean;
  readonly path: string;
}

/**
 * Concrete implementation of SqliteDatabasePort backed exclusively by Node.js built-in `node:sqlite`.
 * ALL `node:sqlite` imports and operations are isolated in this file so that swapping
 * to `better-sqlite3` or another driver requires editing only this adapter.
 */
class NodeSqliteAdapter implements SqliteDatabasePort {
  private readonly db: DatabaseSync;
  private transactionDepth = 0;
  public readonly isMemory: boolean;
  public readonly path: string;

  constructor(dbPath: string) {
    this.path = dbPath;
    this.isMemory = dbPath === ':memory:';

    if (!this.isMemory) {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(dbPath);
  }

  public exec(sql: string): void {
    this.db.exec(sql);
  }

  public prepare<T = Record<string, unknown>>(sql: string): SqliteStatementPort<T> {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: unknown[]): SqliteRunResult => {
        const sanitized = params.map(toSqlValue);
        const result = stmt.run(...sanitized);
        return {
          changes: Number(result.changes),
          lastInsertRowid: result.lastInsertRowid,
        };
      },
      get: (...params: unknown[]): T | undefined => {
        const sanitized = params.map(toSqlValue);
        const row = stmt.get(...sanitized);
        return row ? (row as T) : undefined;
      },
      all: (...params: unknown[]): T[] => {
        const sanitized = params.map(toSqlValue);
        const rows = stmt.all(...sanitized);
        return rows as T[];
      },
    };
  }

  public transaction<T>(fn: () => T): T {
    const isTopLevel = this.transactionDepth === 0;
    const savepointName = `sp_${this.transactionDepth}`;

    if (isTopLevel) {
      this.db.exec('BEGIN IMMEDIATE');
    } else {
      this.db.exec(`SAVEPOINT ${savepointName}`);
    }

    this.transactionDepth++;

    const rollback = (): void => {
      if (isTopLevel) {
        this.db.exec('ROLLBACK');
      } else {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      }
    };

    const commit = (): void => {
      if (isTopLevel) {
        this.db.exec('COMMIT');
      } else {
        this.db.exec(`RELEASE SAVEPOINT ${savepointName}`);
      }
    };

    try {
      const result = fn();
      if (result && typeof (result as Record<string, unknown>).then === 'function') {
        return (result as unknown as Promise<unknown>)
          .then((val) => {
            commit();
            return val;
          })
          .catch((err) => {
            rollback();
            throw err;
          })
          .finally(() => {
            this.transactionDepth--;
          }) as unknown as T;
      }

      commit();
      this.transactionDepth--;
      return result;
    } catch (error) {
      rollback();
      this.transactionDepth--;
      throw error;
    }
  }

  public close(): void {
    this.db.close();
  }
}

/**
 * Resolves the default database path using the DATABASE_PATH env var,
 * defaulting to `./data/leet-tracker.db`.
 */
export function getDefaultDatabasePath(): string {
  return process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'leet-tracker.db');
}

/**
 * Factory creating an instance of SqliteDatabasePort.
 * Pass `:memory:` for ephemeral in-memory databases (ideal for tests).
 */
export function createSqliteDatabase(dbPath?: string): SqliteDatabasePort {
  const targetPath = dbPath ?? getDefaultDatabasePath();
  return new NodeSqliteAdapter(targetPath);
}
