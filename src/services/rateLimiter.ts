/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RateLimitedError } from '../domain/errors.js';

export interface RateLimitRecord {
  timestamps: number[];
  windowMs: number;
}

/**
 * Maximum total keys tracked across all rate limit categories to bound process memory.
 */
export const DEFAULT_MAX_TOTAL_RECORDS = 10000;

/**
 * Maximum keys allowed in any single category pool to ensure cross-category isolation.
 * Prevents a surge or attack in one category (e.g. login_ip) from consuming the capacity
 * needed by other categories (e.g. start_verif_ip, verify_code_ip, register_ip).
 */
export const DEFAULT_MAX_CATEGORY_RECORDS = 2000;

/**
 * Interval for background cleanup of expired rate limit keys (5 minutes).
 */
export const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * In-memory sliding-window rate limiter with partitioned category pools,
 * strict active-record preservation, and bounded memory guarantees.
 *
 * NOTE ON MULTI-INSTANCE DEPLOYMENTS:
 * This rate limiter maintains state in-memory for the local Node.js process.
 * In a multi-instance or horizontally scaled cluster (e.g., multiple Cloud Run or Kubernetes replicas),
 * requests routed to different containers will not share this state. For distributed multi-instance
 * deployments, a shared external datastore (such as Redis) is required.
 */
export class RateLimiter {
  private pools = new Map<string, Map<string, RateLimitRecord>>();
  private cleanupTimer?: NodeJS.Timeout;
  private readonly maxTotalRecords: number;
  private readonly maxCategoryRecords: number;

  constructor(options?: {
    maxTotalRecords?: number;
    maxCategoryRecords?: number;
    enableAutoCleanup?: boolean;
  }) {
    this.maxTotalRecords = options?.maxTotalRecords ?? DEFAULT_MAX_TOTAL_RECORDS;
    this.maxCategoryRecords =
      options?.maxCategoryRecords ??
      Math.min(DEFAULT_MAX_CATEGORY_RECORDS, this.maxTotalRecords);

    if (options?.enableAutoCleanup !== false) {
      this.startAutoCleanup();
    }
  }

  /**
   * Extracts category prefix from a key (e.g., 'login_ip' from 'login_ip:127.0.0.1').
   */
  private getCategory(key: string): string {
    const idx = key.indexOf(':');
    return idx !== -1 ? key.slice(0, idx) : 'default';
  }

  /**
   * Retrieves or creates the isolated map pool for a category.
   */
  private getPool(category: string): Map<string, RateLimitRecord> {
    let pool = this.pools.get(category);
    if (!pool) {
      pool = new Map<string, RateLimitRecord>();
      this.pools.set(category, pool);
    }
    return pool;
  }

  /**
   * Starts periodic cleanup timer. The timer is unref'd so it does not prevent
   * Node.js event loop shutdown in test runners or graceful process exit.
   */
  private startAutoCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stops auto cleanup timer (useful for test teardown).
   */
  public stopAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Cleans up expired records across all category pools.
   * Only records with no active timestamps remaining within their sliding window are removed.
   * Active security records are strictly preserved across all categories.
   */
  public cleanup(defaultMaxAgeMs = 15 * 60 * 1000): void {
    const now = Date.now();
    for (const [category, pool] of this.pools.entries()) {
      for (const [key, record] of pool.entries()) {
        const window = record.windowMs || defaultMaxAgeMs;
        const cutoff = now - window;
        record.timestamps = record.timestamps.filter((ts) => ts > cutoff);
        if (record.timestamps.length === 0) {
          pool.delete(key);
        }
      }
      if (pool.size === 0) {
        this.pools.delete(category);
      }
    }
  }

  /**
   * Checks whether the given key has exceeded maxRequests within windowMs.
   * If limit is exceeded, throws RateLimitedError.
   * Otherwise, records this timestamp.
   *
   * Capacity & Isolation Policy:
   * 1. If key exists in its category pool, its sliding window is updated and evaluated.
   * 2. If key is new and either its category pool or the global total reaches capacity,
   *    expired records across all pools are purged first.
   * 3. If the specific category pool remains at capacity because all its records are active,
   *    new keys in THAT category are safely rejected without evicting active security records.
   * 4. Unrelated categories maintain their dedicated capacity and continue serving legitimate users.
   */
  public check(key: string, maxRequests: number, windowMs: number, customMessage?: string): void {
    const now = Date.now();
    const cutoff = now - windowMs;
    const category = this.getCategory(key);
    let pool = this.getPool(category);

    let record = pool.get(key);
    if (!record) {
      if (pool.size >= this.maxCategoryRecords || this.size >= this.maxTotalRecords) {
        // Purge expired records across all pools before evaluating exhaustion
        this.cleanup(windowMs);

        // Re-acquire the active category pool from this.pools in case cleanup deleted an empty pool
        pool = this.getPool(category);

        // If category is still at capacity, reject new key in THIS category only.
        // Active security records are NEVER evicted under key churn.
        if (pool.size >= this.maxCategoryRecords || this.size >= this.maxTotalRecords) {
          throw new RateLimitedError(
            customMessage ||
              `Rate limiting capacity reached for ${category}. Please wait before submitting new requests.`
          );
        }
      }
      record = { timestamps: [], windowMs };
      pool.set(key, record);
    } else {
      record.windowMs = Math.max(record.windowMs, windowMs);
    }

    // Filter out expired timestamps for this key
    record.timestamps = record.timestamps.filter((ts) => ts > cutoff);

    if (record.timestamps.length >= maxRequests) {
      const oldestValid = record.timestamps[0];
      const waitSeconds = Math.ceil((oldestValid + windowMs - now) / 1000);
      throw new RateLimitedError(
        customMessage ||
          `Rate limit exceeded: too many requests. Please wait ${Math.max(1, waitSeconds)} seconds before trying again.`
      );
    }

    record.timestamps.push(now);
  }

  /**
   * Checks if a key has exceeded limits without recording a hit.
   */
  public isLimited(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    const cutoff = now - windowMs;
    const category = this.getCategory(key);
    const pool = this.pools.get(category);
    if (!pool) return false;
    const record = pool.get(key);
    if (!record) return false;
    const validTimestamps = record.timestamps.filter((ts) => ts > cutoff);
    return validTimestamps.length >= maxRequests;
  }

  /**
   * Resets the limit record for a specific key or clears all pools if no key is provided.
   */
  public reset(key?: string): void {
    if (key) {
      const category = this.getCategory(key);
      const pool = this.pools.get(category);
      if (pool) {
        pool.delete(key);
        if (pool.size === 0) {
          this.pools.delete(category);
        }
      }
    } else {
      this.pools.clear();
    }
  }

  /**
   * Returns current total number of tracked keys across all category pools.
   */
  public get size(): number {
    let count = 0;
    for (const pool of this.pools.values()) {
      count += pool.size;
    }
    return count;
  }

  /**
   * Returns the count of tracked keys within a specific category pool.
   */
  public categorySize(category: string): number {
    return this.pools.get(category)?.size ?? 0;
  }

  /**
   * Checks if a key exists in its category pool.
   */
  public has(key: string): boolean {
    const category = this.getCategory(key);
    return this.pools.get(category)?.has(key) ?? false;
  }
}

export const globalRateLimiter = new RateLimiter();
