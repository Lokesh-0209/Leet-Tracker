/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatDateOnly, type Clock } from './clock.js';
import { addCalendarDays } from './dateMath.js';

export interface ProblemDateGroup<T> {
  readonly date: string; // "YYYY-MM-DD"
  readonly heading: string; // "Solved today", "Yesterday", or "MMM D, YYYY" (e.g. "Oct 15, 2026")
  readonly items: readonly T[];
  readonly count: number;
}

/**
 * Formats a "YYYY-MM-DD" calendar date into "MMM D, YYYY" (e.g. "Oct 15, 2026")
 * using noon UTC to eliminate any time zone shifting or DST float.
 */
export function formatCalendarDateHeading(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(noonUtc);
}

/**
 * Pure function that groups items by the calendar day of their `solvedAt` timestamp
 * in the specified user IANA time zone.
 *
 * Rules:
 * - Newest date group first.
 * - Group headings: "Solved today", "Yesterday", or formatted date (e.g. "Oct 15, 2026").
 * - Shows problem count per group.
 * - Never returns empty groups.
 * - Deterministic, pure domain function.
 */
export function groupProblemsBySolvedDate<T extends { solvedAt: string }>(
  items: readonly T[],
  timeZone: string,
  referenceDateOrClock?: Clock | Date | string
): ProblemDateGroup<T>[] {
  if (items.length === 0) {
    return [];
  }

  // 1. Resolve today's date in the target time zone
  let todayDateStr: string;
  if (!referenceDateOrClock) {
    todayDateStr = formatDateOnly(new Date(), timeZone);
  } else if (typeof referenceDateOrClock === 'object' && 'today' in referenceDateOrClock) {
    todayDateStr = referenceDateOrClock.today(timeZone);
  } else if (referenceDateOrClock instanceof Date) {
    todayDateStr = formatDateOnly(referenceDateOrClock, timeZone);
  } else if (typeof referenceDateOrClock === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(referenceDateOrClock)) {
      todayDateStr = referenceDateOrClock;
    } else {
      todayDateStr = formatDateOnly(new Date(referenceDateOrClock), timeZone);
    }
  } else {
    todayDateStr = formatDateOnly(new Date(), timeZone);
  }

  const yesterdayDateStr = addCalendarDays(todayDateStr, -1);

  // 2. Partition items into date buckets based on local calendar day
  const bucketMap = new Map<string, T[]>();

  for (const item of items) {
    const itemDate = new Date(item.solvedAt);
    const localDateStr = formatDateOnly(itemDate, timeZone);

    const bucket = bucketMap.get(localDateStr);
    if (bucket) {
      bucket.push(item);
    } else {
      bucketMap.set(localDateStr, [item]);
    }
  }

  // 3. Sort dates descending (newest first)
  const sortedDates = Array.from(bucketMap.keys()).sort((a, b) => b.localeCompare(a));

  // 4. Construct final groups
  const groups: ProblemDateGroup<T>[] = [];

  for (const dateStr of sortedDates) {
    const groupItems = bucketMap.get(dateStr) || [];
    if (groupItems.length === 0) continue; // Never show empty groups

    let heading: string;
    if (dateStr === todayDateStr) {
      heading = 'Solved today';
    } else if (dateStr === yesterdayDateStr) {
      heading = 'Yesterday';
    } else {
      heading = formatCalendarDateHeading(dateStr);
    }

    groups.push({
      date: dateStr,
      heading,
      items: groupItems,
      count: groupItems.length,
    });
  }

  return groups;
}
