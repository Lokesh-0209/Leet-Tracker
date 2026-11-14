/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
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
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  transaction<T>(fn: () => T | Promise<T>): Promise<T> | T;
  close(): void;
  readonly isClosed: boolean;
  readonly isMemory: boolean;
  readonly path: string;
}

interface TxContext {
  readonly db: NodeSqliteAdapter;
  readonly savepointSeq: { next: number };
  currentNestedTx: Promise<void> | null;
}

interface QueuedTransaction {
  run: () => void;
  reject: (err: Error) => void;
}

const txStorage = new AsyncLocalStorage<TxContext>();

/**
 * Concrete implementation of SqliteDatabasePort backed exclusively by Node.js built-in `node:sqlite`.
 * ALL `node:sqlite` imports and operations are isolated in this file so that swapping
 * to `better-sqlite3` or another driver requires editing only this adapter.
 */
class NodeSqliteAdapter implements SqliteDatabasePort {
  private readonly db: DatabaseSync;
  private isExecutingTx = false;
  private txWaitQueue: Array<QueuedTransaction> = [];
  public isClosed = false;
  public readonly isMemory: boolean;
  public readonly path: string;

  constructor(dbPath: string) {
    this.path = dbPath;
    this.isMemory = dbPath === ':memory:';

    if (!this.isMemory) {
      const dir = path.dirname(dbPath);
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.accessSync(dir, fs.constants.W_OK | fs.constants.R_OK);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to initialize database directory at "${dir}": ${message}`);
      }
    }

    this.db = new DatabaseSync(dbPath);
  }

  public exec(sql: string): void {
    if (this.isClosed) {
      throw new Error('Database is closed');
    }
    this.db.exec(sql);
  }

  public prepare<T = Record<string, unknown>>(sql: string): SqliteStatementPort<T> {
    if (this.isClosed) {
      throw new Error('Database is closed');
    }
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: unknown[]): SqliteRunResult => {
        if (this.isClosed) {
          throw new Error('Database is closed');
        }
        const sanitized = params.map(toSqlValue);
        const result = stmt.run(...sanitized);
        return {
          changes: Number(result.changes),
          lastInsertRowid: result.lastInsertRowid,
        };
      },
      get: (...params: unknown[]): T | undefined => {
        if (this.isClosed) {
          throw new Error('Database is closed');
        }
        const sanitized = params.map(toSqlValue);
        const row = stmt.get(...sanitized);
        return row ? (row as T) : undefined;
      },
      all: (...params: unknown[]): T[] => {
        if (this.isClosed) {
          throw new Error('Database is closed');
        }
        const sanitized = params.map(toSqlValue);
        const rows = stmt.all(...sanitized);
        return rows as T[];
      },
    };
  }

  public transaction<T>(fn: () => Promise<T>): Promise<T>;
  public transaction<T>(fn: () => T | Promise<T>): Promise<T> | T;
  public transaction<T>(fn: () => T | Promise<T>): Promise<T> | T {
    if (this.isClosed) {
      throw new Error('Database is closed');
    }

    // 1. Check if we are already inside an active transaction on THIS database connection
    const currentContext = txStorage.getStore();
    if (currentContext && currentContext.db === this) {
      return this.executeNested(currentContext, fn);
    }

    // 2. If another top-level transaction is already running on this database connection,
    // we must wait for it to finish. Return a Promise that serializes execution.
    if (this.isExecutingTx) {
      return new Promise<T>((resolve, reject) => {
        this.txWaitQueue.push({
          run: () => {
            if (this.isClosed) {
              reject(new Error('Database is closed'));
              return;
            }
            try {
              const res = this.executeTopLevel(fn);
              if (res && typeof (res as Record<string, unknown>).then === 'function') {
                (res as Promise<T>).then(resolve, reject);
              } else {
                resolve(res as T);
              }
            } catch (err) {
              reject(err);
            }
          },
          reject,
        });
      });
    }

    // 3. Database is idle: execute top-level transaction immediately
    return this.executeTopLevel(fn);
  }

  private executeTopLevel<T>(fn: () => T | Promise<T>): Promise<T> | T {
    if (this.isClosed) {
      throw new Error('Database is closed');
    }

    this.isExecutingTx = true;
    try {
      this.db.exec('BEGIN IMMEDIATE');
    } catch (beginErr) {
      this.isExecutingTx = false;
      this.drainNextWaiter();
      throw beginErr;
    }

    const context: TxContext = {
      db: this,
      savepointSeq: { next: 0 },
      currentNestedTx: null,
    };

    const cleanup = (): void => {
      this.isExecutingTx = false;
      this.drainNextWaiter();
    };

    const rollback = (): void => {
      if (this.isClosed) return;
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failure if connection was closed or already terminated
      }
    };

    const commit = (): void => {
      if (this.isClosed) {
        throw new Error('Database is closed');
      }
      this.db.exec('COMMIT');
    };

    try {
      const result = txStorage.run(context, fn);
      if (result && typeof (result as Record<string, unknown>).then === 'function') {
        return (result as Promise<T>)
          .then((val) => {
            commit();
            return val;
          })
          .catch((err) => {
            rollback();
            throw err;
          })
          .finally(() => {
            cleanup();
          });
      }

      commit();
      cleanup();
      return result as T;
    } catch (error) {
      rollback();
      cleanup();
      throw error;
    }
  }

  private executeNested<T>(context: TxContext, fn: () => T | Promise<T>): Promise<T> | T {
    if (this.isClosed) {
      throw new Error('Database is closed');
    }

    // If another nested transaction is already running concurrently in this context,
    // safely serialize execution to preserve strict savepoint ordering
    if (context.currentNestedTx) {
      const prev = context.currentNestedTx;
      let release!: () => void;
      const thisGate = new Promise<void>((r) => {
        release = r;
      });
      const nextChain = prev.catch(() => {}).then(() => thisGate);
      context.currentNestedTx = nextChain;

      return prev.catch(() => {}).then(() => {
        if (this.isClosed) {
          release();
          if (context.currentNestedTx === nextChain) {
            context.currentNestedTx = null;
          }
          throw new Error('Database is closed');
        }
        let execResult: Promise<T> | T;
        try {
          execResult = this.runSingleNested(context, fn);
        } catch (err) {
          release();
          if (context.currentNestedTx === nextChain) {
            context.currentNestedTx = null;
          }
          throw err;
        }
        if (execResult && typeof (execResult as Record<string, unknown>).then === 'function') {
          return (execResult as Promise<T>).finally(() => {
            release();
            if (context.currentNestedTx === nextChain) {
              context.currentNestedTx = null;
            }
          });
        }
        release();
        if (context.currentNestedTx === nextChain) {
          context.currentNestedTx = null;
        }
        return execResult as T;
      });
    }

    // First nested transaction in this context
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });
    context.currentNestedTx = firstGate;

    let res: Promise<T> | T;
    try {
      res = this.runSingleNested(context, fn);
    } catch (err) {
      releaseFirst();
      if (context.currentNestedTx === firstGate) {
        context.currentNestedTx = null;
      }
      throw err;
    }

    if (res && typeof (res as Record<string, unknown>).then === 'function') {
      return (res as Promise<T>).finally(() => {
        releaseFirst();
        if (context.currentNestedTx === firstGate) {
          context.currentNestedTx = null;
        }
      });
    }

    releaseFirst();
    if (context.currentNestedTx === firstGate) {
      context.currentNestedTx = null;
    }
    return res as T;
  }

  private runSingleNested<T>(context: TxContext, fn: () => T | Promise<T>): Promise<T> | T {
    if (this.isClosed) {
      throw new Error('Database is closed');
    }

    context.savepointSeq.next++;
    const savepointName = `sp_${context.savepointSeq.next}`;
    this.db.exec(`SAVEPOINT ${savepointName}`);

    const rollback = (): void => {
      if (this.isClosed) return;
      try {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      } finally {
        try {
          this.db.exec(`RELEASE SAVEPOINT ${savepointName}`);
        } catch {
          // ignore
        }
      }
    };

    const commit = (): void => {
      if (this.isClosed) {
        throw new Error('Database is closed');
      }
      this.db.exec(`RELEASE SAVEPOINT ${savepointName}`);
    };

    // Child context shares the top-level savepoint sequence but has its own sibling gate
    const childContext: TxContext = {
      db: this,
      savepointSeq: context.savepointSeq,
      currentNestedTx: null,
    };

    let isPromise = false;
    try {
      const result = txStorage.run(childContext, fn);
      if (result && typeof (result as Record<string, unknown>).then === 'function') {
        isPromise = true;
        return (result as Promise<T>)
          .then((val) => {
            commit();
            return val;
          })
          .catch((err) => {
            rollback();
            throw err;
          });
      }

      commit();
      return result as T;
    } catch (error) {
      if (!isPromise) {
        rollback();
      }
      throw error;
    }
  }

  private drainNextWaiter(): void {
    if (this.isClosed) {
      while (this.txWaitQueue.length > 0) {
        const next = this.txWaitQueue.shift();
        next?.reject(new Error('Database is closed'));
      }
      return;
    }
    const next = this.txWaitQueue.shift();
    if (next) {
      queueMicrotask(next.run);
    }
  }

  public close(): void {
    this.isClosed = true;
    while (this.txWaitQueue.length > 0) {
      const next = this.txWaitQueue.shift();
      if (next) {
        try {
          next.reject(new Error('Database is closed'));
        } catch {
          // ignore
        }
      }
    }
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
