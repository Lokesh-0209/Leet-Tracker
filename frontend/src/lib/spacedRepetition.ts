import { addDays, startOfDay } from 'date-fns';

export const REVIEW_SCHEDULE = [1, 3, 7]; // Days after initial solve

export function getNextReviewDate(reviewCount: number, baseDate: Date = new Date()): Date {
  if (reviewCount >= REVIEW_SCHEDULE.length) {
    return addDays(baseDate, 365); // Effectively completed, but keep a far date
  }
  const daysToAdd = REVIEW_SCHEDULE[reviewCount];
  return startOfDay(addDays(baseDate, daysToAdd));
}

export function isReviewDue(nextReviewAt: Date): boolean {
  return startOfDay(new Date()) >= startOfDay(nextReviewAt);
}
