/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Platform,
  Difficulty,
  ProblemStatus,
  Problem,
  Note,
  Review,
  ProblemAggregate,
} from '../domain/index.js';

export interface ListProblemsFilter {
  readonly userId?: string;
  readonly status?: ProblemStatus;
  readonly difficulty?: Difficulty;
  readonly search?: string;
  readonly includeDeleted?: boolean;
  readonly onlyDeleted?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

export interface EnrollProblemAtomicParams {
  readonly problemId: string;
  readonly userId?: string;
  readonly status: ProblemStatus;
  readonly enrolledAt: string;
  readonly reviews: readonly Review[];
  readonly note: Note;
}

export interface ProblemRepository {
  findById(id: string, userId?: string): Promise<Problem | null>;
  findByPlatformAndSlug(platform: Platform, slug: string, userId?: string): Promise<Problem | null>;
  list(filter?: ListProblemsFilter): Promise<Problem[]>;
  create(problem: Problem): Promise<Problem>;
  update(problem: Problem): Promise<Problem>;
  softDelete(id: string, deletedAt: string, userId?: string): Promise<void>;
  restore(id: string, userId?: string): Promise<void>;
  hardDelete(id: string, userId?: string): Promise<void>;

  // Notes
  getNote(problemId: string, userId?: string): Promise<Note | null>;
  saveNote(note: Note, userId?: string): Promise<void>;

  // Reviews
  getReviews(problemId: string, userId?: string): Promise<Review[]>;
  saveReviews(reviews: readonly Review[], userId?: string): Promise<void>;
  updateReview(review: Review, userId?: string): Promise<void>;
  getDueOrOverdueReviews(today: string, userId?: string): Promise<{ problem: Problem; review: Review }[]>;

  // Aggregates
  getAggregate(problemId: string, userId?: string): Promise<ProblemAggregate | null>;
  listAggregates(filter?: ListProblemsFilter): Promise<ProblemAggregate[]>;

  // Atomic Enrollment
  enrollProblemAtomic(params: EnrollProblemAtomicParams): Promise<void>;

  // Transaction support for callers like SyncService
  runInTransaction<T>(fn: () => T | Promise<T>): Promise<T>;
}
