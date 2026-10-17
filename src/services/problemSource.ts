/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Platform, Difficulty, SolvedProblem } from '../domain/index.js';

export interface QuestionMetadata {
  readonly title: string;
  readonly difficulty: Difficulty;
}

/**
 * Platform-agnostic ProblemSource interface.
 * Extensible for future platforms (e.g., Codeforces, GeeksForGeeks).
 */
export interface ProblemSource {
  readonly platform: Platform;

  /**
   * Fetches accepted solved problems for the given username.
   */
  fetchSolved(username: string): Promise<SolvedProblem[]>;

  /**
   * Looks up problem metadata (title, difficulty) by slug.
   * Returns null if not found.
   */
  lookupProblem(slug: string): Promise<QuestionMetadata | null>;
}
