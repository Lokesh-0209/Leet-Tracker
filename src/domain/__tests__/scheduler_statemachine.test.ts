/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  calculateReviewDueDates,
  addCalendarDays,
  createInitialReviews,
  isReviewOverdue,
  isReviewDueToday,
  isReviewDueOrOverdue,
  enrollProblem,
  completeReviewStage,
  undoReviewStage,
  canCompleteStage,
  canUndoStage,
  checkEnrollmentGate,
  validateEnrollmentComplexity,
  IllegalTransitionError,
  ValidationError,
  FrozenClock,
  PROBLEM_STATUSES,
  type Problem,
  type Approach,
  type Review,
} from '../index.js';

describe('Phase 2: Scheduler, State Machine, Date Math & Enrollment Gate', () => {
  const dummyProblem: Problem = {
    id: 'b1a2c3d4-0000-0000-0000-000000000001',
    platform: 'LEETCODE',
    slug: 'two-sum',
    title: 'Two Sum',
    difficulty: 'Easy',
    url: 'https://leetcode.com/problems/two-sum/',
    solvedAt: '2026-10-15T12:00:00.000Z',
    status: PROBLEM_STATUSES.INBOX,
    enrolledAt: null,
    deletedAt: null,
  };

  const validApproach1: Approach = {
    id: 'app-1',
    title: 'Approach 1',
    body: 'Your approach: Hash table\nTime Complexity: O(n)\nSpace Complexity: O(n)',
  };

  /* -------------------------------------------------------------------------- */
  /* 1. DATE MATH & SCHEDULING CALENDAR ARITHMETIC                              */
  /* -------------------------------------------------------------------------- */
  describe('Calendar Date Math', () => {
    it('Given enrollment on Dec 30, When calculating due dates, Then Stage 1 is Dec 31, Stage 2 is Jan 2, Stage 3 is Jan 6', () => {
      const dates = calculateReviewDueDates('2026-12-30');
      expect(dates[1]).toBe('2026-12-31');
      expect(dates[2]).toBe('2027-01-02');
      expect(dates[3]).toBe('2027-01-06');
    });

    it('Given a leap year (2024), When enrolled on Feb 28, Then dates handle leap day correctly (Feb 29, Mar 2, Mar 6)', () => {
      const dates = calculateReviewDueDates('2024-02-28');
      expect(dates[1]).toBe('2024-02-29'); // Leap day!
      expect(dates[2]).toBe('2024-03-02');
      expect(dates[3]).toBe('2024-03-06');
    });

    it('Given a non-leap year (2023), When enrolled on Feb 28, Then Stage 1 rolls over directly to Mar 1', () => {
      const dates = calculateReviewDueDates('2023-02-28');
      expect(dates[1]).toBe('2023-03-01');
      expect(dates[2]).toBe('2023-03-03');
      expect(dates[3]).toBe('2023-03-07');
    });

    it('Given month-end enrollment (Jan 31), When calculating due dates, Then dates roll into February (Feb 1, Feb 3, Feb 7)', () => {
      const dates = calculateReviewDueDates('2026-01-31');
      expect(dates[1]).toBe('2026-02-01');
      expect(dates[2]).toBe('2026-02-03');
      expect(dates[3]).toBe('2026-02-07');
    });

    it('Given a 30-day month end (Apr 30), When adding days, Then dates roll smoothly into May', () => {
      const dates = calculateReviewDueDates('2026-04-30');
      expect(dates[1]).toBe('2026-05-01');
      expect(dates[2]).toBe('2026-05-03');
      expect(dates[3]).toBe('2026-05-07');
    });

    it('Given a DST boundary transition date, When calculating calendar days, Then pure calendar math avoids 23h/25h time drift', () => {
      // US Eastern DST start: 2026-03-08 (spring forward)
      const springDates = calculateReviewDueDates('2026-03-08');
      expect(springDates[1]).toBe('2026-03-09');
      expect(springDates[2]).toBe('2026-03-11');
      expect(springDates[3]).toBe('2026-03-15');

      // US Eastern DST end: 2026-11-01 (fall back)
      const fallDates = calculateReviewDueDates('2026-11-01');
      expect(fallDates[1]).toBe('2026-11-02');
      expect(fallDates[2]).toBe('2026-11-04');
      expect(fallDates[3]).toBe('2026-11-08');
    });

    it('Given an invalid date string format, When adding calendar days, Then it throws ValidationError', () => {
      expect(() => addCalendarDays('invalid-date', 1)).toThrow(ValidationError);
      expect(() => addCalendarDays('2026-02-30', 1)).toThrow(ValidationError);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. REVIEWS & DUE DATE STATUS CHECKS                                        */
  /* -------------------------------------------------------------------------- */
  describe('Review Due Dates & Overdue Status', () => {
    const sampleReview: Review = {
      problemId: 'test-id',
      stage: 1,
      dueDate: '2026-10-16',
      completedAt: null,
    };

    it('Given a review due today, When checking status, Then isReviewDueToday and isReviewDueOrOverdue are true, isReviewOverdue is false', () => {
      expect(isReviewDueToday(sampleReview, '2026-10-16')).toBe(true);
      expect(isReviewDueOrOverdue(sampleReview, '2026-10-16')).toBe(true);
      expect(isReviewOverdue(sampleReview, '2026-10-16')).toBe(false);
    });

    it('Given a review due yesterday and not completed, When checking status, Then isReviewOverdue is true', () => {
      expect(isReviewOverdue(sampleReview, '2026-10-17')).toBe(true);
      expect(isReviewDueOrOverdue(sampleReview, '2026-10-17')).toBe(true);
    });

    it('Given a review already completed, When checking overdue status on later dates, Then it is not overdue', () => {
      const completed: Review = { ...sampleReview, completedAt: '2026-10-16T10:00:00Z' };
      expect(isReviewOverdue(completed, '2026-10-20')).toBe(false);
      expect(isReviewDueOrOverdue(completed, '2026-10-20')).toBe(false);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. REVIEWS STATE MACHINE & STAGE COMPLETION                                */
  /* -------------------------------------------------------------------------- */
  describe('Review Stage Completion & State Machine', () => {
    it('Given a problem enrolled today, When reviewing stage 1 on the same day (early), Then it succeeds', () => {
      const clock = new FrozenClock('2026-10-01T09:00:00Z', 'UTC');
      const { problem, reviews } = enrollProblem(dummyProblem, [validApproach1], clock, 'UTC');

      expect(problem.status).toBe(PROBLEM_STATUSES.ACTIVE);
      expect(reviews[0].dueDate).toBe('2026-10-02'); // Due tomorrow

      // Reviewing on the same day (Oct 1)
      const res = completeReviewStage(reviews, problem.status, 1, clock);
      expect(res.completedReview.completedAt).toBe('2026-10-01T09:00:00.000Z');
      expect(res.completedReview.dueDate).toBe('2026-10-02'); // Due date never changes
      expect(res.nextStatus).toBe(PROBLEM_STATUSES.ACTIVE);
    });

    it('Given a review completed late, When completed, Then later review due dates do not shift', () => {
      const clock = new FrozenClock('2026-10-01T09:00:00Z', 'UTC');
      const { reviews, problem } = enrollProblem(dummyProblem, [validApproach1], clock, 'UTC');

      // Due dates: Stage 1 = Oct 2, Stage 2 = Oct 4, Stage 3 = Oct 8
      expect(reviews[0].dueDate).toBe('2026-10-02');
      expect(reviews[1].dueDate).toBe('2026-10-04');
      expect(reviews[2].dueDate).toBe('2026-10-08');

      // Now jump to Oct 10 (Stage 1 is 8 days overdue!)
      clock.setDate('2026-10-10T12:00:00Z');
      const result = completeReviewStage(reviews, problem.status, 1, clock);

      // Verify Stage 1 is completed
      expect(result.updatedReviews[0].completedAt).toBe('2026-10-10T12:00:00.000Z');
      // Later due dates must NOT shift!
      expect(result.updatedReviews[1].dueDate).toBe('2026-10-04');
      expect(result.updatedReviews[2].dueDate).toBe('2026-10-08');
    });

    it('Given Stage 1 is not completed, When attempting to complete Stage 2, Then out-of-order completion is rejected', () => {
      const reviews = createInitialReviews('test-id', '2026-10-01');
      const clock = new FrozenClock('2026-10-04T12:00:00Z', 'UTC');

      expect(() => completeReviewStage(reviews, PROBLEM_STATUSES.ACTIVE, 2, clock)).toThrow(
        IllegalTransitionError
      );
    });

    it('Given Stage 2 is not completed, When attempting to complete Stage 3, Then out-of-order completion is rejected', () => {
      const reviews = createInitialReviews('test-id', '2026-10-01');
      const clock = new FrozenClock('2026-10-08T12:00:00Z', 'UTC');

      expect(() => completeReviewStage(reviews, PROBLEM_STATUSES.ACTIVE, 3, clock)).toThrow(
        IllegalTransitionError
      );
    });

    it('Given Stage 1 is completed, When completing Stage 2 early before its due date, Then it succeeds', () => {
      const clock = new FrozenClock('2026-10-02T12:00:00Z', 'UTC');
      const reviews = createInitialReviews('test-id', '2026-10-01');

      // Complete stage 1
      const step1 = completeReviewStage(reviews, PROBLEM_STATUSES.ACTIVE, 1, clock);
      // Stage 2 is due Oct 4, but we complete it early on Oct 2
      const step2 = completeReviewStage(step1.updatedReviews, step1.nextStatus, 2, clock);

      expect(step2.completedReview.completedAt).toBe('2026-10-02T12:00:00.000Z');
      expect(step2.completedReview.stage).toBe(2);
    });

    it('Given a stage is already completed, When completing it a second time, Then it is idempotent', () => {
      const clock = new FrozenClock('2026-10-02T12:00:00Z', 'UTC');
      const reviews = createInitialReviews('test-id', '2026-10-01');

      const firstPass = completeReviewStage(reviews, PROBLEM_STATUSES.ACTIVE, 1, clock);
      const originalCompletedAt = firstPass.completedReview.completedAt;

      // Clock advances 2 days
      clock.advanceDays(2);
      const secondPass = completeReviewStage(firstPass.updatedReviews, firstPass.nextStatus, 1, clock);

      expect(secondPass.completedReview.completedAt).toBe(originalCompletedAt);
      expect(secondPass.updatedReviews).toEqual(firstPass.updatedReviews);
    });

    it('Given an ACTIVE problem, When completing Stage 3, Then problem moves to FULLY_SOLVED', () => {
      const clock = new FrozenClock('2026-10-01T12:00:00Z', 'UTC');
      const reviews = createInitialReviews('test-id', '2026-10-01');

      const step1 = completeReviewStage(reviews, PROBLEM_STATUSES.ACTIVE, 1, clock);
      const step2 = completeReviewStage(step1.updatedReviews, step1.nextStatus, 2, clock);
      const step3 = completeReviewStage(step2.updatedReviews, step2.nextStatus, 3, clock);

      expect(step3.nextStatus).toBe(PROBLEM_STATUSES.FULLY_SOLVED);
      expect(step3.completedReview.completedAt).toBeDefined();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. UNDO RULES & STATE TRANSITIONS                                          */
  /* -------------------------------------------------------------------------- */
  describe('Review Undo Behavior', () => {
    it('Given Stage 3 is completed, When attempting to undo Stage 2, Then it is rejected with IllegalTransitionError', () => {
      const clock = new FrozenClock('2026-10-01T12:00:00Z', 'UTC');
      const reviews = createInitialReviews('test-id', '2026-10-01');

      const s1 = completeReviewStage(reviews, PROBLEM_STATUSES.ACTIVE, 1, clock);
      const s2 = completeReviewStage(s1.updatedReviews, s1.nextStatus, 2, clock);
      const s3 = completeReviewStage(s2.updatedReviews, s2.nextStatus, 3, clock);

      expect(() => undoReviewStage(s3.updatedReviews, s3.nextStatus, 2)).toThrow(
        IllegalTransitionError
      );
    });

    it('Given Stage 2 is completed, When attempting to undo Stage 1, Then it is rejected with IllegalTransitionError', () => {
      const clock = new FrozenClock('2026-10-01T12:00:00Z', 'UTC');
      const reviews = createInitialReviews('test-id', '2026-10-01');

      const s1 = completeReviewStage(reviews, PROBLEM_STATUSES.ACTIVE, 1, clock);
      const s2 = completeReviewStage(s1.updatedReviews, s1.nextStatus, 2, clock);

      expect(() => undoReviewStage(s2.updatedReviews, s2.nextStatus, 1)).toThrow(
        IllegalTransitionError
      );
    });

    it('Given a stage has not been completed, When attempting to undo it, Then it is rejected with IllegalTransitionError', () => {
      const reviews = createInitialReviews('test-id', '2026-10-01');
      expect(() => undoReviewStage(reviews, PROBLEM_STATUSES.ACTIVE, 1)).toThrow(
        IllegalTransitionError
      );
    });

    it('Given Stage 3 is completed, When undoing Stage 3, Then dueDate of every review is unchanged and only completedAt is cleared', () => {
      const clock = new FrozenClock('2026-10-01T12:00:00Z', 'UTC');
      const initialReviews = createInitialReviews('test-id', '2026-10-01');
      const originalDueDates = initialReviews.map((r) => r.dueDate);

      const s1 = completeReviewStage(initialReviews, PROBLEM_STATUSES.ACTIVE, 1, clock);
      const s2 = completeReviewStage(s1.updatedReviews, s1.nextStatus, 2, clock);
      const s3 = completeReviewStage(s2.updatedReviews, s2.nextStatus, 3, clock);

      const undoResult = undoReviewStage(s3.updatedReviews, s3.nextStatus, 3);
      expect(undoResult.nextStatus).toBe(PROBLEM_STATUSES.ACTIVE);
      expect(undoResult.undoneReview.completedAt).toBeNull();

      // Check all 3 reviews: due dates must be identical to original, and only stage 3 completedAt is null
      undoResult.updatedReviews.forEach((r, idx) => {
        expect(r.dueDate).toBe(originalDueDates[idx]);
      });
      expect(undoResult.updatedReviews[0].completedAt).toBeDefined();
      expect(undoResult.updatedReviews[1].completedAt).toBeDefined();
      expect(undoResult.updatedReviews[2].completedAt).toBeNull();
    });

    it('Given Stage 2 is completed, When undoing Stage 2, Then dueDate of every review is unchanged and only completedAt is cleared', () => {
      const clock = new FrozenClock('2026-10-01T12:00:00Z', 'UTC');
      const initialReviews = createInitialReviews('test-id', '2026-10-01');
      const originalDueDates = initialReviews.map((r) => r.dueDate);

      const s1 = completeReviewStage(initialReviews, PROBLEM_STATUSES.ACTIVE, 1, clock);
      const s2 = completeReviewStage(s1.updatedReviews, s1.nextStatus, 2, clock);

      const undoResult = undoReviewStage(s2.updatedReviews, s2.nextStatus, 2);
      expect(undoResult.nextStatus).toBe(PROBLEM_STATUSES.ACTIVE);
      expect(undoResult.undoneReview.completedAt).toBeNull();

      undoResult.updatedReviews.forEach((r, idx) => {
        expect(r.dueDate).toBe(originalDueDates[idx]);
      });
      expect(undoResult.updatedReviews[0].completedAt).toBeDefined();
      expect(undoResult.updatedReviews[1].completedAt).toBeNull();
      expect(undoResult.updatedReviews[2].completedAt).toBeNull();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4b. CLOCK DST BOUNDARY VERIFICATION                                        */
  /* -------------------------------------------------------------------------- */
  describe('Clock Time Zone and DST Boundary Handling', () => {
    it('Given Clock timestamps spanning Spring Forward DST transition in America/New_York, Then today() accurately reports the local calendar date', () => {
      // 2026-03-08 01:30:00 EST (UTC-5) -> 06:30:00Z
      const preShift = new FrozenClock('2026-03-08T06:30:00Z');
      expect(preShift.today('America/New_York')).toBe('2026-03-08');

      // 2026-03-08 03:30:00 EDT (UTC-4) -> 07:30:00Z (after the 2am -> 3am jump)
      const postShift = new FrozenClock('2026-03-08T07:30:00Z');
      expect(postShift.today('America/New_York')).toBe('2026-03-08');

      // 2026-03-08 23:59:00 EDT (UTC-4) -> 2026-03-09T03:59:00Z
      const endOfDay = new FrozenClock('2026-03-09T03:59:00Z');
      expect(endOfDay.today('America/New_York')).toBe('2026-03-08');

      // 2026-03-09 00:01:00 EDT (UTC-4) -> 2026-03-09T04:01:00Z
      const nextDay = new FrozenClock('2026-03-09T04:01:00Z');
      expect(nextDay.today('America/New_York')).toBe('2026-03-09');
    });

    it('Given Clock timestamps spanning Fall Back DST transition in America/New_York, Then today() accurately reports the local calendar date', () => {
      // 2026-11-01 01:30:00 EDT (UTC-4) -> 05:30:00Z
      const first130 = new FrozenClock('2026-11-01T05:30:00Z');
      expect(first130.today('America/New_York')).toBe('2026-11-01');

      // 2026-11-01 01:30:00 EST (UTC-5) -> 06:30:00Z (after 2am falls back to 1am)
      const second130 = new FrozenClock('2026-11-01T06:30:00Z');
      expect(second130.today('America/New_York')).toBe('2026-11-01');

      // 2026-11-02 00:05:00 EST (UTC-5) -> 2026-11-02T05:05:00Z
      const nextDay = new FrozenClock('2026-11-02T05:05:00Z');
      expect(nextDay.today('America/New_York')).toBe('2026-11-02');
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 5. ENROLLMENT GATE AMENDMENTS (Amendment 2)                                 */
  /* -------------------------------------------------------------------------- */
  describe('Enrollment Gate Specifications (Amendment 2)', () => {
    it('(a) When Time Complexity is empty + Space Complexity is filled, Then it is rejected', () => {
      const body = `
Your approach: Hash map
Time Complexity: 
Space Complexity: O(n)
`;
      const result = validateEnrollmentComplexity(body);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Time Complexity');
    });

    it('(b) When Space Complexity is empty + Time Complexity is filled, Then it is rejected', () => {
      const body = `
Your approach: Hash map
Time Complexity: O(n)
Space Complexity: 
`;
      const result = validateEnrollmentComplexity(body);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Space Complexity');
    });

    it('(c) When one complexity header immediately follows another, Then the label of the other complexity must never count as a value', () => {
      const body = `
Your approach: Hash map
Time Complexity: Space Complexity: O(1)
`;
      const result = validateEnrollmentComplexity(body);
      expect(result.isValid).toBe(false);
      // Time Complexity must not have treated "Space Complexity" as its value
      expect(result.error).toContain('Time Complexity');
    });

    it('(c-reverse) When Space Complexity immediately precedes Time Complexity without value, Then it is rejected', () => {
      const body = `
Your approach: Hash map
Space Complexity: Time Complexity: O(n)
`;
      const result = validateEnrollmentComplexity(body);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Space Complexity');
    });

    it('(d) When Approach 1 passes gate but Approach 2+ has no complexity labels, Then the enrollment gate succeeds because it checks only Approach 1', () => {
      const approaches: Approach[] = [
        {
          id: 'app-1',
          title: 'Approach 1',
          body: 'Your approach: Hash table\nTime Complexity: O(n)\nSpace Complexity: O(n)',
        },
        {
          id: 'app-2',
          title: 'Approach 2',
          body: 'Unfinished notes with no complexity info whatsoever.',
        },
      ];

      const result = checkEnrollmentGate(approaches);
      expect(result.isValid).toBe(true);

      const clock = new FrozenClock('2026-10-16T10:00:00Z', 'UTC');
      const enrollment = enrollProblem(dummyProblem, approaches, clock, 'UTC');
      expect(enrollment.problem.status).toBe(PROBLEM_STATUSES.ACTIVE);
      expect(enrollment.note.approaches).toHaveLength(2);
    });

    it('(d-failure) When Approach 1 fails gate even if Approach 2 passes, Then enrollment is rejected', () => {
      const approaches: Approach[] = [
        {
          id: 'app-1',
          title: 'Approach 1',
          body: 'Your approach: Brute force without complexity annotations',
        },
        {
          id: 'app-2',
          title: 'Approach 2',
          body: 'Time Complexity: O(n)\nSpace Complexity: O(1)',
        },
      ];

      const result = checkEnrollmentGate(approaches);
      expect(result.isValid).toBe(false);

      const clock = new FrozenClock('2026-10-16T10:00:00Z', 'UTC');
      expect(() => enrollProblem(dummyProblem, approaches, clock, 'UTC')).toThrow(ValidationError);
    });
  });
});
