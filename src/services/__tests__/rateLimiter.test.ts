/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter } from '../rateLimiter.js';
import { RateLimitedError } from '../../domain/errors.js';

describe('RateLimiter Capacity & Eviction Test Suite', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    if (limiter) {
      limiter.stopAutoCleanup();
      limiter.reset();
    }
  });

  /* -------------------------------------------------------------------------- */
  /* TEST 1: Cross-category isolation                                           */
  /* -------------------------------------------------------------------------- */
  it('Scenario 1: Capacity exhaustion in one category does NOT block another category', () => {
    // Limiter with max 3 records per category, 10 total
    limiter = new RateLimiter({ maxTotalRecords: 10, maxCategoryRecords: 3, enableAutoCleanup: false });
    const now = 1000000;
    vi.useFakeTimers();
    vi.setSystemTime(now);

    // Flood 'login_ip' category to its category limit of 3
    limiter.check('login_ip:1.1.1.1', 5, 60000);
    limiter.check('login_ip:1.1.1.2', 5, 60000);
    limiter.check('login_ip:1.1.1.3', 5, 60000);
    expect(limiter.categorySize('login_ip')).toBe(3);

    // A 4th distinct IP in 'login_ip' is rejected due to category capacity
    expect(() => limiter.check('login_ip:1.1.1.4', 5, 60000)).toThrow(RateLimitedError);

    // Crucial isolation test: other categories (e.g. 'start_verif_ip', 'verify_code_ip') MUST NOT be blocked!
    expect(() => limiter.check('start_verif_ip:2.2.2.1', 5, 60000)).not.toThrow();
    expect(() => limiter.check('verify_code_ip:2.2.2.1', 5, 60000)).not.toThrow();
    expect(() => limiter.check('register_ip:2.2.2.1', 5, 60000)).not.toThrow();

    expect(limiter.categorySize('start_verif_ip')).toBe(1);
    expect(limiter.categorySize('verify_code_ip')).toBe(1);
    expect(limiter.categorySize('register_ip')).toBe(1);
  });

  /* -------------------------------------------------------------------------- */
  /* TEST 2: Expired-record cleanup                                             */
  /* -------------------------------------------------------------------------- */
  it('Scenario 2: Cleans up expired records when timestamps pass the window', () => {
    limiter = new RateLimiter({ maxTotalRecords: 10, maxCategoryRecords: 5, enableAutoCleanup: false });
    const now = 1000000;
    vi.useFakeTimers();
    vi.setSystemTime(now);

    limiter.check('login_ip:ip1', 5, 1000);
    limiter.check('login_ip:ip2', 5, 2000);
    expect(limiter.categorySize('login_ip')).toBe(2);

    // Advance 1500ms: ip1 is expired, ip2 is still active
    vi.setSystemTime(now + 1500);
    limiter.cleanup();

    expect(limiter.has('login_ip:ip1')).toBe(false);
    expect(limiter.has('login_ip:ip2')).toBe(true);
    expect(limiter.categorySize('login_ip')).toBe(1);

    // Advance to 2500ms: ip2 is now expired
    vi.setSystemTime(now + 2500);
    limiter.cleanup();

    expect(limiter.has('login_ip:ip2')).toBe(false);
    expect(limiter.size).toBe(0);
  });

  /* -------------------------------------------------------------------------- */
  /* TEST 3: Active-record preservation                                         */
  /* -------------------------------------------------------------------------- */
  it('Scenario 3: Active security records are NEVER evicted when new keys are added', () => {
    limiter = new RateLimiter({ maxTotalRecords: 3, maxCategoryRecords: 3, enableAutoCleanup: false });
    const now = 1000000;
    vi.useFakeTimers();
    vi.setSystemTime(now);

    // Add 3 active keys to fill capacity
    limiter.check('auth:active1', 5, 60000);
    limiter.check('auth:active2', 5, 60000);
    limiter.check('auth:active3', 5, 60000);
    expect(limiter.size).toBe(3);

    // Try to add a 4th key when all existing keys are active
    expect(() => limiter.check('auth:new_key_4', 5, 60000)).toThrow(RateLimitedError);

    // All active records MUST remain preserved in the limiter!
    expect(limiter.has('auth:active1')).toBe(true);
    expect(limiter.has('auth:active2')).toBe(true);
    expect(limiter.has('auth:active3')).toBe(true);
    expect(limiter.has('auth:new_key_4')).toBe(false);
    expect(limiter.size).toBe(3);
  });

  /* -------------------------------------------------------------------------- */
  /* TEST 4: Capacity exhaustion                                                */
  /* -------------------------------------------------------------------------- */
  it('Scenario 4: Capacity is strictly bounded and does not grow indefinitely', () => {
    const MAX_CAT = 4;
    limiter = new RateLimiter({ maxTotalRecords: 10, maxCategoryRecords: MAX_CAT, enableAutoCleanup: false });
    vi.useFakeTimers();
    vi.setSystemTime(1000000);

    for (let i = 0; i < MAX_CAT; i++) {
      limiter.check(`test_cat:ip_${i}`, 10, 60000);
    }
    expect(limiter.categorySize('test_cat')).toBe(MAX_CAT);

    // Attempting to add 10 more keys while active must not grow size beyond MAX_CAT
    for (let i = MAX_CAT; i < MAX_CAT + 10; i++) {
      expect(() => limiter.check(`test_cat:ip_${i}`, 10, 60000)).toThrow(RateLimitedError);
      expect(limiter.categorySize('test_cat')).toBe(MAX_CAT);
    }
  });

  /* -------------------------------------------------------------------------- */
  /* TEST 5: New-key behavior when capacity is full                             */
  /* -------------------------------------------------------------------------- */
  it('Scenario 5: When category pool is full, expired records are purged first before allowing new keys', () => {
    limiter = new RateLimiter({ maxTotalRecords: 5, maxCategoryRecords: 2, enableAutoCleanup: false });
    const now = 1000000;
    vi.useFakeTimers();
    vi.setSystemTime(now);

    limiter.check('pool:short_lived', 5, 1000); // Expires after 1000ms
    limiter.check('pool:long_lived', 5, 10000); // Expires after 10000ms
    expect(limiter.categorySize('pool')).toBe(2);

    // Advance 2000ms: short_lived is expired, long_lived is active
    vi.setSystemTime(now + 2000);

    // Adding a new key should trigger cleanup of short_lived and successfully register new_key
    expect(() => limiter.check('pool:new_key', 5, 5000)).not.toThrow();

    expect(limiter.has('pool:short_lived')).toBe(false);
    expect(limiter.has('pool:long_lived')).toBe(true);
    expect(limiter.has('pool:new_key')).toBe(true);
    expect(limiter.categorySize('pool')).toBe(2);
  });

  /* -------------------------------------------------------------------------- */
  /* TEST 6: Sliding-window expiration                                          */
  /* -------------------------------------------------------------------------- */
  it('Scenario 6: Sliding window accurately unlocks requests as timestamps age out', () => {
    limiter = new RateLimiter({ maxTotalRecords: 10, maxCategoryRecords: 5, enableAutoCleanup: false });
    const now = 1000000;
    vi.useFakeTimers();
    vi.setSystemTime(now);

    // 2 requests allowed in a 2000ms window
    limiter.check('win:user', 2, 2000);
    vi.setSystemTime(now + 500);
    limiter.check('win:user', 2, 2000);

    // 3rd request should fail
    expect(() => limiter.check('win:user', 2, 2000)).toThrow(RateLimitedError);

    // Advance to now + 2001ms: 1st timestamp is expired, 2nd is still active
    vi.setSystemTime(now + 2001);

    // Should succeed (1 request made now + 1 active from 500ms = 2)
    expect(() => limiter.check('win:user', 2, 2000)).not.toThrow();

    // Immediately next request should fail
    expect(() => limiter.check('win:user', 2, 2000)).toThrow(RateLimitedError);

    // Advance past 2nd timestamp
    vi.setSystemTime(now + 2501);
    expect(() => limiter.check('win:user', 2, 2000)).not.toThrow();
  });

  /* -------------------------------------------------------------------------- */
  /* TEST 7: Multi-category isolation under real concurrent load                */
  /* -------------------------------------------------------------------------- */
  it('Scenario 7: Concurrent overlapping async requests correctly enforce limits across partitioned categories', async () => {
    limiter = new RateLimiter({ maxTotalRecords: 50, maxCategoryRecords: 20, enableAutoCleanup: false });
    const now = 1000000;
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const categories = ['login_ip', 'start_verif_ip', 'verify_code_ip'];

    // Launch concurrent asynchronous workers simulating overlapping requests in the event loop
    const concurrentWorkers = categories.flatMap((cat) =>
      Array.from({ length: 5 }, (_, i) => async () => {
        // Yield to microtask queue to interleave execution
        await Promise.resolve();
        limiter.check(`${cat}:client_${i}`, 2, 1000);
      })
    );

    await Promise.all(concurrentWorkers.map((fn) => fn()));

    for (const cat of categories) {
      expect(limiter.categorySize(cat)).toBe(5);
    }
    expect(limiter.size).toBe(15);

    // Verify rate limit enforcement under concurrency: repeated requests for each key
    const repeatedWorkers = categories.flatMap((cat) =>
      Array.from({ length: 5 }, (_, i) => async () => {
        await Promise.resolve();
        // 2nd request allowed (limit is 2)
        expect(() => limiter.check(`${cat}:client_${i}`, 2, 1000)).not.toThrow();
        // 3rd request blocked
        expect(() => limiter.check(`${cat}:client_${i}`, 2, 1000)).toThrow(RateLimitedError);
      })
    );

    await Promise.all(repeatedWorkers.map((fn) => fn()));

    // Advance past window and ensure cleanup purges all keys
    vi.setSystemTime(now + 1500);
    limiter.cleanup();
    expect(limiter.size).toBe(0);
  });

  /* -------------------------------------------------------------------------- */
  /* REGRESSION: Pool lifecycle and recreation after cleanup                     */
  /* -------------------------------------------------------------------------- */
  it('Regression 1-4: Recreates category pool and tracks new record when cleanup removes previous records', () => {
    limiter = new RateLimiter({ maxTotalRecords: 10, maxCategoryRecords: 2, enableAutoCleanup: false });
    const now = 1000000;
    vi.useFakeTimers();
    vi.setSystemTime(now);

    // 1. Fill category 'catA' to its limit of 2 with short-lived records
    limiter.check('catA:key1', 3, 1000);
    limiter.check('catA:key2', 3, 1000);
    expect(limiter.categorySize('catA')).toBe(2);

    // 2. Advance time past the 1000ms window so all records in catA are expired
    vi.setSystemTime(now + 1500);

    // 3. Add a new key to catA. Capacity was full, so check() triggers cleanup().
    // cleanup() deletes all expired keys and removes 'catA' pool from this.pools.
    // check() must re-acquire the active pool so newKey is NOT inserted into a detached Map!
    limiter.check('catA:newKey', 2, 5000);

    // 4. Verify has(newKey) returns true
    expect(limiter.has('catA:newKey')).toBe(true);

    // 5. Verify size and categorySize accurately include the new record
    expect(limiter.size).toBe(1);
    expect(limiter.categorySize('catA')).toBe(1);

    // 6. Verify subsequent requests for newKey enforce rate limiting properly!
    // 2nd request succeeds (limit is 2)
    expect(() => limiter.check('catA:newKey', 2, 5000)).not.toThrow();

    // 3rd request MUST be rate limited (proves key was tracked in the active pool, not lost!)
    expect(() => limiter.check('catA:newKey', 2, 5000)).toThrow(RateLimitedError);
  });

  it('Regression 5: Recreates pool correctly when cleanup is triggered by global capacity exhaustion', () => {
    // Global max 3 records, category max 3 records
    limiter = new RateLimiter({ maxTotalRecords: 3, maxCategoryRecords: 3, enableAutoCleanup: false });
    const now = 1000000;
    vi.useFakeTimers();
    vi.setSystemTime(now);

    // Fill global capacity across categories with short-lived records
    limiter.check('login_ip:ip1', 2, 1000);
    limiter.check('login_ip:ip2', 2, 1000);
    limiter.check('other_cat:item1', 2, 1000);
    expect(limiter.size).toBe(3);

    // Advance time past expiration
    vi.setSystemTime(now + 1500);

    // Adding key to login_ip triggers cleanup via global capacity exhaustion
    limiter.check('login_ip:ip3', 2, 5000);

    // ip3 must be tracked in the active login_ip pool
    expect(limiter.has('login_ip:ip3')).toBe(true);
    expect(limiter.size).toBe(1);
    expect(limiter.categorySize('login_ip')).toBe(1);

    // 2nd request for ip3 succeeds
    expect(() => limiter.check('login_ip:ip3', 2, 5000)).not.toThrow();

    // 3rd request for ip3 is rate-limited!
    expect(() => limiter.check('login_ip:ip3', 2, 5000)).toThrow(RateLimitedError);
  });
});
