/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  ERROR_CODES,
  AppError,
  ValidationError,
  IllegalTransitionError,
  NotFoundError,
  FrozenClock,
  SystemClock,
  validateEnrollmentComplexity,
  ProblemSchema,
  NoteSchema,
  APPROACH_DEFAULT_TEMPLATE,
  groupProblemsBySolvedDate,
} from '../index.js';

describe('Domain Model & Validation (Phase 1)', () => {
  describe('Given the Error Contract', () => {
    it('When instantiating AppError, Then it preserves code, message, and retryable flag', () => {
      const err = new AppError({
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Too many requests',
        retryable: true,
      });

      expect(err.code).toBe('RATE_LIMITED');
      expect(err.retryable).toBe(true);
      expect(err.toJSON()).toEqual({
        code: 'RATE_LIMITED',
        message: 'Too many requests',
        retryable: true,
      });
    });

    it('When creating domain-specific errors, Then appropriate default codes and retryable values are applied', () => {
      const validation = new ValidationError('Bad input');
      expect(validation.code).toBe('VALIDATION_ERROR');
      expect(validation.retryable).toBe(false);

      const illegal = new IllegalTransitionError('Cannot undo stage 1 while stage 2 is done');
      expect(illegal.code).toBe('ILLEGAL_TRANSITION');
      expect(illegal.retryable).toBe(false);

      const notFound = new NotFoundError('Problem', 'two-sum');
      expect(notFound.code).toBe('NOT_FOUND');
      expect(notFound.retryable).toBe(false);
    });
  });

  describe('Given the Clock Interface', () => {
    it('When using FrozenClock, Then it returns deterministic dates and advances accurately', () => {
      const clock = new FrozenClock('2026-10-16T10:00:00Z', 'UTC');
      expect(clock.today('UTC')).toBe('2026-10-16');

      clock.advanceDays(1);
      expect(clock.today('UTC')).toBe('2026-10-17');

      clock.advanceDays(7);
      expect(clock.today('UTC')).toBe('2026-10-24');
    });

    it('When using SystemClock, Then it produces valid ISO and YYYY-MM-DD strings', () => {
      const clock = new SystemClock();
      expect(clock.now()).toBeInstanceOf(Date);
      expect(clock.nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(clock.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('Given the Enrollment Gate Complexity Validator', () => {
    it('When approach 1 has the default unfilled template, Then saving notes with an empty complexity value is rejected', () => {
      const result = validateEnrollmentComplexity(APPROACH_DEFAULT_TEMPLATE);
      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('When complexity labels are missing, Then it is rejected with missing label message', () => {
      const body = 'Your approach: Brute force.\nTime Complexity: O(n)';
      const result = validateEnrollmentComplexity(body);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Space Complexity');
    });

    it('When complexity labels are detected case-insensitively with non-whitespace text, Then validation succeeds', () => {
      const body = `
Your approach: Hash map.
tiMe compLexiTy: O(N)
sPaCe COMPLexiTy: O(n)
`;
      const result = validateEnrollmentComplexity(body);
      expect(result.isValid).toBe(true);
      expect(result.timeComplexityText).toBe('O(N)');
      expect(result.spaceComplexityText).toBe('O(n)');
    });

    it('When complexity values have multiline content or Markdown punctuation, Then validation succeeds', () => {
      const body = `
**Time Complexity:**
O(V + E) where V is vertices.

**Space Complexity:**
O(V) recursion stack.
`;
      const result = validateEnrollmentComplexity(body);
      expect(result.isValid).toBe(true);
      expect(result.timeComplexityText).toContain('O(V + E)');
      expect(result.spaceComplexityText).toContain('O(V)');
    });
  });

  describe('Given Zod Schemas for Domain Models', () => {
    it('When parsing a valid Problem entity, Then it succeeds', () => {
      const problem = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        platform: 'LEETCODE',
        slug: 'two-sum',
        title: 'Two Sum',
        difficulty: 'Easy',
        url: 'https://leetcode.com/problems/two-sum/',
        solvedAt: '2026-10-15T12:00:00.000Z',
        status: 'INBOX',
        enrolledAt: null,
        deletedAt: null,
      };
      const parsed = ProblemSchema.parse(problem);
      expect(parsed.slug).toBe('two-sum');
    });

    it('When parsing a valid Note entity with multiple approaches, Then it succeeds', () => {
      const note = {
        problemId: '123e4567-e89b-12d3-a456-426614174000',
        approaches: [
          { id: 'app-1', title: 'Approach 1', body: 'Hash map solution' },
          { id: 'app-2', title: 'Approach 2 (Two pointers)', body: 'Sort array then two pointers' },
        ],
        updatedAt: '2026-10-16T00:00:00.000Z',
      };
      const parsed = NoteSchema.parse(note);
      expect(parsed.approaches).toHaveLength(2);
    });
  });

  describe('Given groupProblemsBySolvedDate', () => {
    it('When problems are solved at 23:30 and 00:30 local time, Then they land in different calendar day groups', () => {
      // In America/Los_Angeles (PDT = UTC-7):
      // 2026-10-16T06:30:00Z -> 2026-10-15 23:30:00 (Oct 15)
      // 2026-10-16T07:30:00Z -> 2026-10-16 00:30:00 (Oct 16)
      const problems = [
        { id: 'p1', title: 'Problem 1', solvedAt: '2026-10-16T06:30:00Z' },
        { id: 'p2', title: 'Problem 2', solvedAt: '2026-10-16T07:30:00Z' },
      ];

      const referenceDate = '2026-10-16'; // "Today" in LA
      const groups = groupProblemsBySolvedDate(problems, 'America/Los_Angeles', referenceDate);

      expect(groups).toHaveLength(2);
      expect(groups[0].date).toBe('2026-10-16');
      expect(groups[0].heading).toBe('Solved today');
      expect(groups[0].count).toBe(1);
      expect(groups[0].items[0].id).toBe('p2');

      expect(groups[1].date).toBe('2026-10-15');
      expect(groups[1].heading).toBe('Yesterday');
      expect(groups[1].count).toBe(1);
      expect(groups[1].items[0].id).toBe('p1');
    });

    it('When grouping older dates, Then headings use formatted date (e.g. Oct 14, 2026) and groups are ordered newest first', () => {
      const problems = [
        { id: 'p-old-1', title: 'Old 1', solvedAt: '2026-10-13T12:00:00Z' },
        { id: 'p-today', title: 'Today', solvedAt: '2026-10-16T12:00:00Z' },
        { id: 'p-yesterday', title: 'Yesterday', solvedAt: '2026-10-15T12:00:00Z' },
        { id: 'p-old-2', title: 'Old 2', solvedAt: '2026-10-14T12:00:00Z' },
      ];

      const groups = groupProblemsBySolvedDate(problems, 'UTC', '2026-10-16');

      expect(groups.map((g) => g.heading)).toEqual([
        'Solved today',
        'Yesterday',
        'Oct 14, 2026',
        'Oct 13, 2026',
      ]);
      expect(groups.map((g) => g.count)).toEqual([1, 1, 1, 1]);
    });

    it('When evaluating in a time zone far from UTC (e.g. Pacific/Auckland UTC+13), Then day boundaries reflect local calendar', () => {
      // 2026-10-15T10:30:00Z is 2026-10-15 23:30 in Auckland (UTC+13)
      // 2026-10-15T11:30:00Z is 2026-10-16 00:30 in Auckland (UTC+13)
      const problems = [
        { id: 'p-auckland-1', title: 'Auckland 1', solvedAt: '2026-10-15T10:30:00Z' },
        { id: 'p-auckland-2', title: 'Auckland 2', solvedAt: '2026-10-15T11:30:00Z' },
      ];

      const groups = groupProblemsBySolvedDate(problems, 'Pacific/Auckland', '2026-10-16');

      expect(groups).toHaveLength(2);
      expect(groups[0].date).toBe('2026-10-16');
      expect(groups[0].heading).toBe('Solved today');
      expect(groups[1].date).toBe('2026-10-15');
      expect(groups[1].heading).toBe('Yesterday');
    });

    it('When input is empty or has dates with no items, Then empty groups are never returned', () => {
      expect(groupProblemsBySolvedDate([], 'UTC', '2026-10-16')).toEqual([]);
    });
  });
});
