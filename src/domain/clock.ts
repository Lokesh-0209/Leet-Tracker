/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Clock {
  /** Returns the current Date */
  now(): Date;
  /** Returns current timestamp in ISO 8601 format */
  nowIso(): string;
  /**
   * Returns current calendar date in "YYYY-MM-DD" format in the given or system time zone.
   * If timeZone is omitted, user's local runtime time zone is used.
   */
  today(timeZone?: string): string;
}

/**
 * Formats a Date object into "YYYY-MM-DD" strictly for a given time zone using Intl.DateTimeFormat.
 */
export function formatDateOnly(date: Date, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  if (!year || !month || !day) {
    // Fallback using UTC if Intl fails
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return `${year}-${month}-${day}`;
}

export class SystemClock implements Clock {
  constructor(private readonly defaultTimeZone?: string) {}

  public now(): Date {
    return new Date();
  }

  public nowIso(): string {
    return this.now().toISOString();
  }

  public today(timeZone?: string): string {
    return formatDateOnly(this.now(), timeZone || this.defaultTimeZone);
  }
}

export class FrozenClock implements Clock {
  private currentDate: Date;

  constructor(initial: Date | string = new Date(), private readonly defaultTimeZone?: string) {
    this.currentDate = typeof initial === 'string' ? new Date(initial) : new Date(initial.getTime());
  }

  public now(): Date {
    return new Date(this.currentDate.getTime());
  }

  public nowIso(): string {
    return this.now().toISOString();
  }

  public today(timeZone?: string): string {
    return formatDateOnly(this.now(), timeZone || this.defaultTimeZone);
  }

  public setDate(date: Date | string): void {
    this.currentDate = typeof date === 'string' ? new Date(date) : new Date(date.getTime());
  }

  public advanceDays(days: number): void {
    const d = new Date(this.currentDate.getTime());
    d.setDate(d.getDate() + days);
    this.currentDate = d;
  }
}
