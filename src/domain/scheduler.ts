/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Review } from './models.js';
import type { ReviewStage } from './constants.js';
import { calculateReviewDueDates } from './dateMath.js';

export function createInitialReviews(problemId: string, anchorDate: string): readonly Review[] {
  const dueDates = calculateReviewDueDates(anchorDate);
  return [
    {
      problemId,
      stage: 1,
      dueDate: dueDates[1],
      completedAt: null,
    },
    {
      problemId,
      stage: 2,
      dueDate: dueDates[2],
      completedAt: null,
    },
    {
      problemId,
      stage: 3,
      dueDate: dueDates[3],
      completedAt: null,
    },
  ];
}

/**
 * Checks if a review is overdue.
 * A review is overdue if dueDate < today and not completed.
 */
export function isReviewOverdue(review: Review, today: string): boolean {
  return review.completedAt === null && review.dueDate < today;
}

/**
 * Checks if a review is due today.
 */
export function isReviewDueToday(review: Review, today: string): boolean {
  return review.completedAt === null && review.dueDate === today;
}

/**
 * Checks if a review is due today or overdue.
 */
export function isReviewDueOrOverdue(review: Review, today: string): boolean {
  return review.completedAt === null && review.dueDate <= today;
}

/**
 * Checks if a review is due in the future relative to today.
 */
export function isReviewFuture(review: Review, today: string): boolean {
  return review.completedAt === null && review.dueDate > today;
}

/**
 * Determines whether a given stage can be completed at this time.
 * Per Amendment 1: Early completion before due date is allowed as long as the previous stage is already completed.
 * Only out-of-order completion is rejected.
 */
export function canCompleteStage(
  reviews: readonly Review[],
  stage: ReviewStage
): { readonly allowed: boolean; readonly reason?: string } {
  const review = reviews.find((r) => r.stage === stage);
  if (!review) {
    return { allowed: false, reason: `Review for stage ${stage} not found.` };
  }

  // Idempotent: already completed
  if (review.completedAt !== null) {
    return { allowed: true };
  }

  // Check preceding stages
  if (stage === 2) {
    const stage1 = reviews.find((r) => r.stage === 1);
    if (!stage1 || stage1.completedAt === null) {
      return { allowed: false, reason: 'Stage 1 must be completed before Stage 2 can be completed.' };
    }
  }

  if (stage === 3) {
    const stage1 = reviews.find((r) => r.stage === 1);
    const stage2 = reviews.find((r) => r.stage === 2);
    if (!stage1 || stage1.completedAt === null) {
      return { allowed: false, reason: 'Stage 1 must be completed before Stage 3 can be completed.' };
    }
    if (!stage2 || stage2.completedAt === null) {
      return { allowed: false, reason: 'Stage 2 must be completed before Stage 3 can be completed.' };
    }
  }

  return { allowed: true };
}

/**
 * Determines whether a completed review stage can be undone.
 * Rule: Only the most recently completed review can be undone.
 * Undoing stage N while stage N+1 is completed is rejected.
 */
export function canUndoStage(
  reviews: readonly Review[],
  stage: ReviewStage
): { readonly allowed: boolean; readonly reason?: string } {
  const review = reviews.find((r) => r.stage === stage);
  if (!review) {
    return { allowed: false, reason: `Review for stage ${stage} not found.` };
  }

  if (review.completedAt === null) {
    return { allowed: false, reason: `Cannot undo Stage ${stage} because it is not completed.` };
  }

  if (stage === 1) {
    const stage2 = reviews.find((r) => r.stage === 2);
    if (stage2 && stage2.completedAt !== null) {
      return { allowed: false, reason: 'Cannot undo Stage 1 while Stage 2 is completed.' };
    }
  }

  if (stage === 2) {
    const stage3 = reviews.find((r) => r.stage === 3);
    if (stage3 && stage3.completedAt !== null) {
      return { allowed: false, reason: 'Cannot undo Stage 2 while Stage 3 is completed.' };
    }
  }

  return { allowed: true };
}
