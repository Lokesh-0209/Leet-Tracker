/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const PLATFORMS = {
  LEETCODE: 'LEETCODE',
} as const;

export type Platform = (typeof PLATFORMS)[keyof typeof PLATFORMS];

export const DIFFICULTIES = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
} as const;

export type Difficulty = (typeof DIFFICULTIES)[keyof typeof DIFFICULTIES];

export const PROBLEM_STATUSES = {
  INBOX: 'INBOX',
  ACTIVE: 'ACTIVE',
  FULLY_SOLVED: 'FULLY_SOLVED',
} as const;

export type ProblemStatus = (typeof PROBLEM_STATUSES)[keyof typeof PROBLEM_STATUSES];

export const REVIEW_STAGES = [1, 2, 3] as const;
export type ReviewStage = (typeof REVIEW_STAGES)[number];

/**
 * Review intervals in calendar days relative to the enrollment anchor date.
 * Stage 1: anchor + 1 day
 * Stage 2: anchor + 3 days
 * Stage 3: anchor + 7 days
 */
export const REVIEW_INTERVAL_DAYS: Record<ReviewStage, number> = {
  1: 1,
  2: 3,
  3: 7,
};

export const TEMPLATE_LABELS = [
  'Your approach:',
  'Actual approach:',
  'Mistakes:',
  'Time Complexity:',
  'Space Complexity:',
] as const;

export const APPROACH_DEFAULT_TEMPLATE = `Your approach:

Actual approach:

Mistakes:

Time Complexity: 

Space Complexity: `;

export const ERROR_CODES = {
  INVALID_USERNAME: 'INVALID_USERNAME',
  PRIVATE_OR_EMPTY_PROFILE: 'PRIVATE_OR_EMPTY_PROFILE',
  RATE_LIMITED: 'RATE_LIMITED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  UPSTREAM_SCHEMA_CHANGED: 'UPSTREAM_SCHEMA_CHANGED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
