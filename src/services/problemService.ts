/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  PLATFORMS,
  PROBLEM_STATUSES,
  type Difficulty,
  type Problem,
  type Approach,
  type ReviewStage,
  type ProblemAggregate,
  ValidationError,
  NotFoundError,
  checkEnrollmentGate,
  enrollProblem,
  completeReviewStage,
  undoReviewStage,
} from '../domain/index.js';
import type { ProblemRepository } from '../repositories/problemRepository.js';
import type { ProblemSource } from './problemSource.js';
import type { Clock } from '../domain/clock.js';
import { parseLeetCodeInput, slugToTitle } from './leetcode/urlParser.js';
import { randomUUID } from 'node:crypto';

export interface ManualAddInput {
  readonly urlOrSlug: string;
  readonly title?: string;
  readonly difficulty?: Difficulty;
}

export class ProblemService {
  constructor(
    private readonly repository: ProblemRepository,
    private readonly problemSource: ProblemSource,
    private readonly clock: Clock
  ) {}

  /**
   * Manually adds a problem by URL or slug.
   * - Restores a soft-deleted problem if the same slug is added.
   * - Works even when LeetCode is down by falling back to slug-derived title and required user difficulty.
   */
  public async manualAdd(input: ManualAddInput): Promise<Problem> {
    const { slug, canonicalUrl } = parseLeetCodeInput(input.urlOrSlug);

    // Check if problem already exists in DB
    const existing = await this.repository.findByPlatformAndSlug(PLATFORMS.LEETCODE, slug);

    if (existing) {
      if (existing.deletedAt !== null) {
        // "Adding a soft-deleted slug restores it"
        await this.repository.restore(existing.id);
        const restored = await this.repository.findById(existing.id);
        if (!restored) {
          throw new NotFoundError('Problem', existing.id);
        }
        return restored;
      }
      throw new ValidationError(`Problem "${existing.title}" (${slug}) is already in your tracker.`);
    }

    let title = input.title?.trim();
    let difficulty = input.difficulty;

    // Attempt lookup from problem source
    try {
      const metadata = await this.problemSource.lookupProblem(slug);
      if (metadata) {
        title = title || metadata.title;
        difficulty = difficulty || metadata.difficulty;
      }
    } catch {
      // Source is down or network error: continue to offline fallback
    }

    // Offline / source-down fallback: require user-supplied difficulty and derive title
    if (!difficulty) {
      throw new ValidationError(
        'Could not automatically fetch problem details from LeetCode. Please select a difficulty (Easy, Medium, Hard).'
      );
    }

    title = title || slugToTitle(slug);

    const newProblem: Problem = {
      id: randomUUID(),
      platform: PLATFORMS.LEETCODE,
      slug,
      title,
      difficulty,
      url: canonicalUrl,
      solvedAt: this.clock.nowIso(),
      status: PROBLEM_STATUSES.INBOX,
      enrolledAt: null,
      deletedAt: null,
    };

    return this.repository.create(newProblem);
  }

  public async softDelete(problemId: string): Promise<void> {
    const deletedAt = this.clock.nowIso();
    await this.repository.softDelete(problemId, deletedAt);
  }

  public async restore(problemId: string): Promise<void> {
    await this.repository.restore(problemId);
  }

  public async hardDelete(problemId: string): Promise<void> {
    await this.repository.hardDelete(problemId);
  }

  /**
   * Saves notes for a problem.
   * If the problem is in INBOX, saving a note that passes the enrollment gate
   * atomically enrolls the problem (status -> ACTIVE, creates 3 reviews, saves note).
   * For already active problems, validates Approach 1 so complexity labels cannot be removed.
   */
  public async saveNote(
    problemId: string,
    approaches: readonly Approach[],
    timeZone?: string
  ): Promise<ProblemAggregate> {
    const problem = await this.repository.findById(problemId);
    if (!problem) {
      throw new NotFoundError('Problem', problemId);
    }

    if (problem.deletedAt !== null) {
      throw new ValidationError('Cannot edit notes for a deleted problem.');
    }

    // Approach 1 complexity validation
    const gateCheck = checkEnrollmentGate(approaches);
    if (!gateCheck.isValid) {
      throw new ValidationError(
        gateCheck.error || 'Approach 1 requires both Time Complexity and Space Complexity with non-empty values.'
      );
    }

    if (problem.status === PROBLEM_STATUSES.INBOX) {
      // Transition INBOX -> ACTIVE atomically
      const enrollment = enrollProblem(problem, approaches, this.clock, timeZone);

      await this.repository.enrollProblemAtomic({
        problemId: problem.id,
        status: enrollment.problem.status,
        enrolledAt: enrollment.problem.enrolledAt!,
        reviews: enrollment.reviews,
        note: enrollment.note,
      });

      return {
        problem: enrollment.problem,
        note: enrollment.note,
        reviews: enrollment.reviews,
      };
    }

    // Problem is already ACTIVE or FULLY_SOLVED
    const updatedNote = {
      problemId: problem.id,
      approaches: approaches.map((app) => ({ ...app })),
      updatedAt: this.clock.nowIso(),
    };

    await this.repository.saveNote(updatedNote);
    const reviews = await this.repository.getReviews(problem.id);

    return {
      problem,
      note: updatedNote,
      reviews,
    };
  }

  /**
   * Completes a review stage.
   */
  public async completeReview(
    problemId: string,
    stage: ReviewStage
  ): Promise<ProblemAggregate> {
    const aggregate = await this.repository.getAggregate(problemId);
    if (!aggregate) {
      throw new NotFoundError('Problem', problemId);
    }

    const { problem, reviews, note } = aggregate;
    const completionResult = completeReviewStage(
      reviews,
      problem.status,
      stage,
      this.clock
    );

    await this.repository.runInTransaction(async () => {
      // Update problem status if changed
      if (completionResult.nextStatus !== problem.status) {
        await this.repository.update({
          ...problem,
          status: completionResult.nextStatus,
        });
      }

      await this.repository.updateReview(completionResult.completedReview);
    });

    const updatedProblem = await this.repository.findById(problemId);

    return {
      problem: updatedProblem || problem,
      note,
      reviews: completionResult.updatedReviews,
    };
  }

  /**
   * Undoes a completed review stage.
   */
  public async undoReview(
    problemId: string,
    stage: ReviewStage
  ): Promise<ProblemAggregate> {
    const aggregate = await this.repository.getAggregate(problemId);
    if (!aggregate) {
      throw new NotFoundError('Problem', problemId);
    }

    const { problem, reviews, note } = aggregate;
    const undoResult = undoReviewStage(reviews, problem.status, stage);

    await this.repository.runInTransaction(async () => {
      if (undoResult.nextStatus !== problem.status) {
        await this.repository.update({
          ...problem,
          status: undoResult.nextStatus,
        });
      }

      await this.repository.updateReview(undoResult.undoneReview);
    });

    const updatedProblem = await this.repository.findById(problemId);

    return {
      problem: updatedProblem || problem,
      note,
      reviews: undoResult.updatedReviews,
    };
  }
}
