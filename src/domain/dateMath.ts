/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { REVIEW_INTERVAL_DAYS, type ReviewStage } from './constants.js';
import { ValidationError } from './errors.js';

/**
 * Validates whether a string matches "YYYY-MM-DD" format.
 */
export function isValidDateOnly(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/**
 * Adds an integer number of calendar days to a "YYYY-MM-DD" string.
 * Uses UTC date calculations to avoid daylight saving time (DST) shifts,
 * correctly handling month ends, year ends, and leap years.
 */
export function addCalendarDays(dateStr: string, days: number): string {
  if (!isValidDateOnly(dateStr)) {
    throw new ValidationError(`Invalid date-only format: "${dateStr}". Expected YYYY-MM-DD.`);
  }

  const [y, m, d] = dateStr.split('-').map(Number);
  // Noon UTC guarantees zero DST transitions and zero midnight-boundary float issues
  const date = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));

  const resY = date.getUTCFullYear();
  const resM = String(date.getUTCMonth() + 1).padStart(2, '0');
  const resD = String(date.getUTCDate()).padStart(2, '0');

  return `${resY}-${resM}-${resD}`;
}

/**
 * Calculates the 3 due dates based on the anchor enrollment date.
 * Stage 1: anchor + 1 day
 * Stage 2: anchor + 3 days
 * Stage 3: anchor + 7 days
 */
export function calculateReviewDueDates(anchorDate: string): Record<ReviewStage, string> {
  return {
    1: addCalendarDays(anchorDate, REVIEW_INTERVAL_DAYS[1]),
    2: addCalendarDays(anchorDate, REVIEW_INTERVAL_DAYS[2]),
    3: addCalendarDays(anchorDate, REVIEW_INTERVAL_DAYS[3]),
  };
}
