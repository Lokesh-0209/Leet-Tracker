/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Platform, Difficulty, ProblemStatus, ReviewStage } from './constants.js';

export type { Platform, Difficulty, ProblemStatus, ReviewStage };

export interface Approach {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export interface Note {
  readonly problemId: string;
  readonly approaches: readonly Approach[];
  readonly updatedAt: string; // ISO 8601 string
}

export interface Review {
  readonly problemId: string;
  readonly stage: ReviewStage;
  readonly dueDate: string; // Date-only "YYYY-MM-DD"
  readonly completedAt: string | null; // ISO 8601 string or null
}

export interface Problem {
  readonly id: string;
  readonly platform: Platform;
  readonly slug: string;
  readonly title: string;
  readonly difficulty: Difficulty;
  readonly url: string;
  readonly solvedAt: string; // ISO 8601 string
  readonly status: ProblemStatus;
  readonly enrolledAt: string | null; // ISO 8601 string or null
  readonly deletedAt: string | null; // ISO 8601 string or null
}

export interface SolvedProblem {
  readonly platform: Platform;
  readonly slug: string;
  readonly title: string;
  readonly difficulty: Difficulty;
  readonly url: string;
  readonly solvedAt: string; // ISO 8601 string
}

export interface ProblemAggregate {
  readonly problem: Problem;
  readonly note: Note | null;
  readonly reviews: readonly Review[];
}

export interface BackupData {
  readonly version: 1;
  readonly exportedAt: string;
  readonly settings: {
    readonly username?: string | null;
  };
  readonly problems: readonly ProblemAggregate[];
}
