/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import {
  PLATFORMS,
  DIFFICULTIES,
  PROBLEM_STATUSES,
  REVIEW_STAGES,
  ERROR_CODES,
} from './constants.js';

export const PlatformSchema = z.nativeEnum(PLATFORMS);
export const DifficultySchema = z.enum([DIFFICULTIES.EASY, DIFFICULTIES.MEDIUM, DIFFICULTIES.HARD]);
export const ProblemStatusSchema = z.enum([
  PROBLEM_STATUSES.INBOX,
  PROBLEM_STATUSES.ACTIVE,
  PROBLEM_STATUSES.FULLY_SOLVED,
]);
export const ReviewStageSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const ApproachSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(100),
  body: z.string(),
});

export const NoteSchema = z.object({
  problemId: z.string().uuid(),
  approaches: z.array(ApproachSchema).min(1),
  updatedAt: z.string().datetime(),
});

export const ReviewSchema = z.object({
  problemId: z.string().uuid(),
  stage: ReviewStageSchema,
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be in YYYY-MM-DD format'),
  completedAt: z.string().datetime().nullable(),
});

export const ProblemSchema = z.object({
  id: z.string().uuid(),
  platform: PlatformSchema,
  slug: z.string().min(1),
  title: z.string().min(1),
  difficulty: DifficultySchema,
  url: z.string().url(),
  solvedAt: z.string().datetime(),
  status: ProblemStatusSchema,
  enrolledAt: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
});

export const SolvedProblemSchema = z.object({
  platform: PlatformSchema,
  slug: z.string().min(1),
  title: z.string().min(1),
  difficulty: DifficultySchema,
  url: z.string().url(),
  solvedAt: z.string().datetime(),
});

export const ErrorResponseSchema = z.object({
  code: z.nativeEnum(ERROR_CODES),
  message: z.string(),
  retryable: z.boolean(),
  details: z.unknown().optional(),
});

/**
 * Validates whether an approach body satisfies the enrollment gate:
 * Contains both "Time Complexity" and "Space Complexity" (case-insensitive),
 * each followed by at least one non-whitespace character of text.
 * The label of the other complexity must never count as a value.
 */
export function validateEnrollmentComplexity(approach1Body: string): {
  readonly isValid: boolean;
  readonly error?: string;
  readonly timeComplexityText?: string;
  readonly spaceComplexityText?: string;
} {
  const timeRegex = /\btime\s+complexity\b/i;
  const spaceRegex = /\bspace\s+complexity\b/i;

  const timeMatch = timeRegex.exec(approach1Body);
  const spaceMatch = spaceRegex.exec(approach1Body);

  if (!timeMatch && !spaceMatch) {
    return {
      isValid: false,
      error: 'Approach 1 must contain both "Time Complexity" and "Space Complexity" labels.',
    };
  }

  if (!timeMatch) {
    return {
      isValid: false,
      error: 'Approach 1 is missing the "Time Complexity" label.',
    };
  }

  if (!spaceMatch) {
    return {
      isValid: false,
      error: 'Approach 1 is missing the "Space Complexity" label.',
    };
  }

  const timeStart = timeMatch.index;
  const timeEnd = timeStart + timeMatch[0].length;
  const spaceStart = spaceMatch.index;
  const spaceEnd = spaceStart + spaceMatch[0].length;

  let timeSegment = '';
  let spaceSegment = '';

  if (timeStart < spaceStart) {
    timeSegment = approach1Body.slice(timeEnd, spaceStart);
    spaceSegment = approach1Body.slice(spaceEnd);
  } else {
    spaceSegment = approach1Body.slice(spaceEnd, timeStart);
    timeSegment = approach1Body.slice(timeEnd);
  }

  // Strip leading punctuation often used after headers: ":", "-", "*", and whitespace
  const cleanSegment = (raw: string): string => {
    // Also strip any trailing markdown / punctuation
    const stripped = raw.replace(/^[\s:*`\-—#]+/, '').trim();
    // Ensure the segment does not solely consist of another complexity label
    if (timeRegex.test(stripped) && !stripped.replace(timeRegex, '').trim()) {
      return '';
    }
    if (spaceRegex.test(stripped) && !stripped.replace(spaceRegex, '').trim()) {
      return '';
    }
    return stripped;
  };

  const timeVal = cleanSegment(timeSegment);
  const spaceVal = cleanSegment(spaceSegment);

  if (!timeVal && !spaceVal) {
    return {
      isValid: false,
      error: 'Both "Time Complexity" and "Space Complexity" require a value with at least one non-whitespace character.',
    };
  }

  if (!timeVal) {
    return {
      isValid: false,
      error: '"Time Complexity" requires a value with at least one non-whitespace character.',
    };
  }

  if (!spaceVal) {
    return {
      isValid: false,
      error: '"Space Complexity" requires a value with at least one non-whitespace character.',
    };
  }

  return {
    isValid: true,
    timeComplexityText: timeVal,
    spaceComplexityText: spaceVal,
  };
}

/**
 * Validates the enrollment gate across an array of approaches.
 * Per spec: The gate checks ONLY Approach 1 (approaches[0]), not Approach 2+.
 */
export function checkEnrollmentGate(approaches: readonly { id: string; title: string; body: string }[]): {
  readonly isValid: boolean;
  readonly error?: string;
} {
  if (!approaches || approaches.length === 0) {
    return {
      isValid: false,
      error: 'At least one approach is required.',
    };
  }

  const approach1 = approaches[0];
  const result = validateEnrollmentComplexity(approach1.body);
  if (!result.isValid) {
    return {
      isValid: false,
      error: result.error,
    };
  }

  return { isValid: true };
}

/**
 * Save Note input schema
 */
export const SaveNoteInputSchema = z.object({
  approaches: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1).max(100),
        body: z.string(),
      })
    )
    .min(1, 'At least one approach is required.'),
});

/**
 * Manual Add Problem input schema
 */
export const ManualAddProblemInputSchema = z.object({
  urlOrSlug: z.string().trim().min(1, 'URL or problem slug is required.'),
  title: z.string().trim().min(1).optional(),
  difficulty: DifficultySchema.optional(),
});

/**
 * User Settings schema
 */
export const SettingsSchema = z.object({
  leetcodeUsername: z.string().trim(),
});

/**
 * Problem aggregate schema (problem + note + reviews)
 */
export const ProblemAggregateSchema = z.object({
  problem: ProblemSchema,
  note: NoteSchema.nullable(),
  reviews: z.array(ReviewSchema),
});

/**
 * Backup export/import schema (Version 1)
 */
export const BackupDataSchema = z.object({
  version: z.literal(1, {
    message: 'Unsupported backup version. Only version 1 is supported.',
  }),
  exportedAt: z.string().datetime({ message: 'Invalid exportedAt timestamp format' }),
  settings: z.object({
    username: z.string().nullable().optional(),
  }),
  problems: z.array(ProblemAggregateSchema),
});
