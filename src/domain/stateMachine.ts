/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PROBLEM_STATUSES, type ProblemStatus, type ReviewStage } from './constants.js';
import type { Approach, Note, Problem, Review } from './models.js';
import { IllegalTransitionError, ValidationError } from './errors.js';
import { checkEnrollmentGate } from './schemas.js';
import { createInitialReviews, canCompleteStage, canUndoStage } from './scheduler.js';
import type { Clock } from './clock.js';

export interface EnrollmentResult {
  readonly problem: Problem;
  readonly reviews: readonly Review[];
  readonly note: Note;
}

export interface ReviewCompletionResult {
  readonly updatedReviews: readonly Review[];
  readonly nextStatus: ProblemStatus;
  readonly completedReview: Review;
}

export interface ReviewUndoResult {
  readonly updatedReviews: readonly Review[];
  readonly nextStatus: ProblemStatus;
  readonly undoneReview: Review;
}

/**
 * Enrolls an INBOX problem into ACTIVE status upon saving a note that passes the enrollment gate.
 * Creates the 3 review rows based on today's calendar date in the given timezone.
 */
export function enrollProblem(
  problem: Problem,
  approaches: readonly Approach[],
  clock: Clock,
  timeZone?: string
): EnrollmentResult {
  if (problem.deletedAt !== null) {
    throw new ValidationError('Cannot enroll a deleted problem. Restore it first.');
  }

  if (problem.status !== PROBLEM_STATUSES.INBOX) {
    throw new IllegalTransitionError(
      `Cannot enroll problem with status "${problem.status}". Only INBOX problems can be enrolled.`
    );
  }

  const gateResult = checkEnrollmentGate(approaches);
  if (!gateResult.isValid) {
    throw new ValidationError(gateResult.error || 'Approach 1 failed enrollment gate complexity check.');
  }

  const enrolledAt = clock.nowIso();
  const anchorDate = clock.today(timeZone);

  const updatedProblem: Problem = {
    ...problem,
    status: PROBLEM_STATUSES.ACTIVE,
    enrolledAt,
  };

  const reviews = createInitialReviews(problem.id, anchorDate);

  const note: Note = {
    problemId: problem.id,
    approaches: approaches.map((app) => ({ ...app })),
    updatedAt: enrolledAt,
  };

  return {
    problem: updatedProblem,
    reviews,
    note,
  };
}

/**
 * Completes a review stage.
 * Per spec and Amendment 1:
 * - A review may be completed before its due date, as long as the previous stage is already completed.
 * - Out-of-order completion is rejected with an IllegalTransitionError.
 * - Completing an already-completed review is idempotent (no error, no change).
 * - Completing stage 3 transitions ACTIVE -> FULLY_SOLVED.
 */
export function completeReviewStage(
  reviews: readonly Review[],
  currentStatus: ProblemStatus,
  stage: ReviewStage,
  clock: Clock
): ReviewCompletionResult {
  const check = canCompleteStage(reviews, stage);
  if (!check.allowed) {
    throw new IllegalTransitionError(check.reason || `Cannot complete Stage ${stage}.`);
  }

  const target = reviews.find((r) => r.stage === stage);
  if (!target) {
    throw new IllegalTransitionError(`Review for stage ${stage} not found.`);
  }

  // Idempotent completion if already completed
  if (target.completedAt !== null) {
    return {
      updatedReviews: reviews,
      nextStatus: currentStatus,
      completedReview: target,
    };
  }

  const completedAt = clock.nowIso();
  const completedReview: Review = {
    ...target,
    completedAt,
    // Due date remains completely unchanged
  };

  const updatedReviews = reviews.map((r) => (r.stage === stage ? completedReview : r));

  const nextStatus = stage === 3 ? PROBLEM_STATUSES.FULLY_SOLVED : currentStatus;

  return {
    updatedReviews,
    nextStatus,
    completedReview,
  };
}

/**
 * Undoes a review stage.
 * Per spec:
 * - Only the most recently completed review can be undone.
 * - Undoing stage N while stage N+1 is completed is rejected with IllegalTransitionError.
 * - Undoing stage 3 transitions FULLY_SOLVED -> ACTIVE.
 * - Clears completedAt only; due dates never change.
 */
export function undoReviewStage(
  reviews: readonly Review[],
  currentStatus: ProblemStatus,
  stage: ReviewStage
): ReviewUndoResult {
  const check = canUndoStage(reviews, stage);
  if (!check.allowed) {
    throw new IllegalTransitionError(check.reason || `Cannot undo Stage ${stage}.`);
  }

  const target = reviews.find((r) => r.stage === stage);
  if (!target) {
    throw new IllegalTransitionError(`Review for stage ${stage} not found.`);
  }

  const undoneReview: Review = {
    ...target,
    completedAt: null,
    // Due date remains completely unchanged
  };

  const updatedReviews = reviews.map((r) => (r.stage === stage ? undoneReview : r));

  // If stage 3 was undone and problem was FULLY_SOLVED, move back to ACTIVE
  const nextStatus =
    stage === 3 && currentStatus === PROBLEM_STATUSES.FULLY_SOLVED
      ? PROBLEM_STATUSES.ACTIVE
      : currentStatus;

  return {
    updatedReviews,
    nextStatus,
    undoneReview,
  };
}
