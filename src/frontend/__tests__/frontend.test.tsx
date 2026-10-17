/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { ProblemCard } from '../components/ProblemCard.js';
import { SyncBanner } from '../components/SyncBanner.js';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal.js';
import { NoteModal } from '../components/NoteModal.js';
import { InboxGroupedList } from '../components/InboxGroupedList.js';
import { Navbar } from '../components/Navbar.js';
import type { ProblemAggregate } from '../../domain/index.js';

afterEach(() => {
  cleanup();
});

describe('Phase 6 & 7 Frontend Components', () => {
  /* -------------------------------------------------------------------------- */
  /* 1. REVIEW CHECKBOX ORDERING RULES                                          */
  /* -------------------------------------------------------------------------- */
  describe('Review Checkbox Order Rules (ProblemCard)', () => {
    const baseAggregate: ProblemAggregate = {
      problem: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        platform: 'LEETCODE',
        slug: 'two-sum',
        title: 'Two Sum',
        difficulty: 'Easy',
        url: 'https://leetcode.com/problems/two-sum/',
        solvedAt: '2026-10-15T00:00:00Z',
        status: 'ACTIVE',
        enrolledAt: '2026-10-15T00:00:00Z',
        deletedAt: null,
      },
      note: {
        problemId: '123e4567-e89b-12d3-a456-426614174000',
        approaches: [{ id: '1', title: 'Approach 1', body: 'Time Complexity: O(n)\nSpace Complexity: O(n)' }],
        updatedAt: '2026-10-15T00:00:00Z',
      },
      reviews: [
        { problemId: '123e4567-e89b-12d3-a456-426614174000', stage: 1, dueDate: '2026-10-16', completedAt: null },
        { problemId: '123e4567-e89b-12d3-a456-426614174000', stage: 2, dueDate: '2026-10-18', completedAt: null },
        { problemId: '123e4567-e89b-12d3-a456-426614174000', stage: 3, dueDate: '2026-10-22', completedAt: null },
      ],
    };

    it('Given Stage 1 is uncompleted, Then Stage 1 checkbox is enabled and Stages 2 and 3 are disabled', () => {
      render(
        <ProblemCard
          aggregate={baseAggregate}
          today="2026-10-16"
          onOpenNotes={vi.fn()}
          onCompleteStage={vi.fn()}
          onUndoStage={vi.fn()}
          onDelete={vi.fn()}
        />
      );

      const cb1 = screen.getByLabelText(/Mark Stage 1/i) as HTMLInputElement;
      const cb2 = screen.getByLabelText(/Mark Stage 2/i) as HTMLInputElement;
      const cb3 = screen.getByLabelText(/Mark Stage 3/i) as HTMLInputElement;

      expect(cb1.disabled).toBe(false);
      expect(cb2.disabled).toBe(true);
      expect(cb3.disabled).toBe(true);
    });

    it('Given Stage 1 is completed, Then Stage 2 is enabled, Stage 3 remains disabled, and Undo is available on Stage 1', () => {
      const stage1DoneAggregate: ProblemAggregate = {
        ...baseAggregate,
        reviews: [
          { ...baseAggregate.reviews[0], completedAt: '2026-10-16T10:00:00Z' },
          baseAggregate.reviews[1],
          baseAggregate.reviews[2],
        ],
      };

      render(
        <ProblemCard
          aggregate={stage1DoneAggregate}
          today="2026-10-16"
          onOpenNotes={vi.fn()}
          onCompleteStage={vi.fn()}
          onUndoStage={vi.fn()}
          onDelete={vi.fn()}
        />
      );

      const cb1 = screen.getByLabelText(/Mark Stage 1/i) as HTMLInputElement;
      const cb2 = screen.getByLabelText(/Mark Stage 2/i) as HTMLInputElement;
      const cb3 = screen.getByLabelText(/Mark Stage 3/i) as HTMLInputElement;

      expect(cb1.checked).toBe(true);
      expect(cb1.disabled).toBe(true);

      expect(cb2.checked).toBe(false);
      expect(cb2.disabled).toBe(false);

      expect(cb3.disabled).toBe(true);
      expect(screen.getByLabelText(/Undo Stage 1/i)).toBeDefined();
    });

    it('Given Stage 1 and 2 are completed, Then Undo is ONLY available for Stage 2 (most recent)', () => {
      const stage2DoneAggregate: ProblemAggregate = {
        ...baseAggregate,
        reviews: [
          { ...baseAggregate.reviews[0], completedAt: '2026-10-16T10:00:00Z' },
          { ...baseAggregate.reviews[1], completedAt: '2026-10-18T10:00:00Z' },
          baseAggregate.reviews[2],
        ],
      };

      render(
        <ProblemCard
          aggregate={stage2DoneAggregate}
          today="2026-10-19"
          onOpenNotes={vi.fn()}
          onCompleteStage={vi.fn()}
          onUndoStage={vi.fn()}
          onDelete={vi.fn()}
        />
      );

      expect(screen.getByLabelText(/Undo Stage 2/i)).toBeDefined();
      expect(screen.queryByLabelText(/Undo Stage 1/i)).toBeNull();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. SYNC ERROR DISPLAY AND RETRY (SyncBanner)                               */
  /* -------------------------------------------------------------------------- */
  describe('Sync Error Display and Retry Action (SyncBanner)', () => {
    it('Given a retryable error (RATE_LIMITED), When rendered, Then it displays the error code, message, and Retry button', () => {
      const onRetry = vi.fn();
      render(
        <SyncBanner
          result={null}
          error={{
            code: 'RATE_LIMITED',
            message: 'Too many requests to LeetCode. Please try again.',
            retryable: true,
          }}
          onRetry={onRetry}
          onDismiss={vi.fn()}
        />
      );

      expect(screen.getByText('RATE_LIMITED')).toBeDefined();
      expect(screen.getByText(/Too many requests/i)).toBeDefined();

      const retryBtn = screen.getByText('Retry Sync');
      expect(retryBtn).toBeDefined();

      fireEvent.click(retryBtn);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('Given a non-retryable error (INVALID_USERNAME), When rendered, Then Retry button is NOT displayed', () => {
      render(
        <SyncBanner
          result={null}
          error={{
            code: 'INVALID_USERNAME',
            message: 'User does not exist on LeetCode.',
            retryable: false,
          }}
          onRetry={vi.fn()}
          onDismiss={vi.fn()}
        />
      );

      expect(screen.getByText('INVALID_USERNAME')).toBeDefined();
      expect(screen.queryByText('Retry Sync')).toBeNull();
    });

    it('Given a successful sync result, When rendered, Then it displays added and already known statistics', () => {
      render(
        <SyncBanner
          result={{ added: 4, alreadyKnown: 12, skippedDeleted: 2 }}
          error={null}
          onRetry={vi.fn()}
          onDismiss={vi.fn()}
        />
      );

      expect(screen.getByText(/4 added to Inbox/i)).toBeDefined();
      expect(screen.getByText(/12 already tracked/i)).toBeDefined();
      expect(screen.getByText(/2 deleted \(kept hidden\)/i)).toBeDefined();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. DELETE CONFIRMATION MODAL                                               */
  /* -------------------------------------------------------------------------- */
  describe('Delete Confirmation Modal', () => {
    it('Given modal is open, When user clicks Cancel or presses Escape, Then onCancel is triggered', () => {
      const onCancel = vi.fn();
      const onConfirm = vi.fn();

      render(
        <DeleteConfirmModal
          isOpen={true}
          title="Delete Problem"
          message='Move "Two Sum" to deleted?'
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      );

      expect(screen.getByText(/Move "Two Sum" to deleted/i)).toBeDefined();

      fireEvent.click(screen.getByText('Cancel'));
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('Given modal is open, When user clicks Delete, Then onConfirm is triggered', () => {
      const onCancel = vi.fn();
      const onConfirm = vi.fn();

      render(
        <DeleteConfirmModal
          isOpen={true}
          title="Delete Problem"
          message='Move "Two Sum" to deleted?'
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      );

      fireEvent.click(screen.getByText('Delete'));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. PHASE 7 NOTES COMPONENT (NoteModal)                                     */
  /* -------------------------------------------------------------------------- */
  describe('Phase 7 Notes Component (NoteModal)', () => {
    const inboxAggregate: ProblemAggregate = {
      problem: {
        id: 'note-test-1',
        platform: 'LEETCODE',
        slug: 'merge-two-sorted-lists',
        title: 'Merge Two Sorted Lists',
        difficulty: 'Easy',
        url: 'https://leetcode.com/problems/merge-two-sorted-lists/',
        solvedAt: '2026-10-15T00:00:00Z',
        status: 'INBOX',
        enrolledAt: null,
        deletedAt: null,
      },
      note: null,
      reviews: [],
    };

    const activeAggregateWithNotes: ProblemAggregate = {
      problem: {
        id: 'note-test-2',
        platform: 'LEETCODE',
        slug: 'lru-cache',
        title: 'LRU Cache',
        difficulty: 'Medium',
        url: 'https://leetcode.com/problems/lru-cache/',
        solvedAt: '2026-10-15T00:00:00Z',
        status: 'ACTIVE',
        enrolledAt: '2026-10-15T00:00:00Z',
        deletedAt: null,
      },
      note: {
        problemId: 'note-test-2',
        approaches: [
          {
            id: 'app-1',
            title: 'Approach 1',
            body: 'Your approach: HashMap + DoublyLinkedList\nTime Complexity: O(1)\nSpace Complexity: O(capacity)',
          },
        ],
        updatedAt: '2026-10-15T00:00:00Z',
      },
      reviews: [],
    };

    it('Given brand-new inbox problem, When opening notes, Then defaults to Edit mode pre-filled with the 5-label template', () => {
      render(
        <NoteModal
          aggregate={inboxAggregate}
          isOpen={true}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );

      const textarea = screen.getByLabelText(/Approach notes editor/i) as HTMLTextAreaElement;
      expect(textarea).toBeDefined();
      expect(textarea.value).toContain('Your approach:');
      expect(textarea.value).toContain('Actual approach:');
      expect(textarea.value).toContain('Mistakes:');
      expect(textarea.value).toContain('Time Complexity:');
      expect(textarea.value).toContain('Space Complexity:');
    });

    it('Given existing note, When opened, Then defaults to View mode with 32px token styling on complexity labels', () => {
      render(
        <NoteModal
          aggregate={activeAggregateWithNotes}
          isOpen={true}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );

      // In View mode, Edit Notes button is visible
      expect(screen.getByText('Edit Notes')).toBeDefined();

      // Complexity label rendered with --complexity-label-size
      const timeCompEl = screen.getByText('Time Complexity');
      expect(timeCompEl).toBeDefined();
      expect(timeCompEl.style.fontSize).toContain('var(--complexity-label-size');

      const spaceCompEl = screen.getByText('Space Complexity');
      expect(spaceCompEl).toBeDefined();
      expect(spaceCompEl.style.fontSize).toContain('var(--complexity-label-size');

      // Value text O(1) rendered normally
      expect(screen.getByText('O(1)')).toBeDefined();
    });

    it('When "+ Add approach" is clicked, Then a new approach tab is created in place', () => {
      render(
        <NoteModal
          aggregate={inboxAggregate}
          isOpen={true}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );

      // Initially 1 tab
      expect(screen.getByText('Approach 1')).toBeDefined();
      expect(screen.queryByText('Approach 2')).toBeNull();

      // Click + Add approach
      const addBtn = screen.getByLabelText(/Add new approach tab/i);
      fireEvent.click(addBtn);

      // Approach 2 tab now exists
      expect(screen.getByText('Approach 2')).toBeDefined();
    });

    it('When deleting an approach tab, Then tab is removed unless it is the last tab', () => {
      render(
        <NoteModal
          aggregate={inboxAggregate}
          isOpen={true}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );

      // When only 1 tab exists, delete button is NOT rendered
      expect(screen.queryByLabelText(/Delete Approach 1/i)).toBeNull();

      // Add a second approach
      fireEvent.click(screen.getByLabelText(/Add new approach tab/i));
      expect(screen.getByText('Approach 2')).toBeDefined();

      // Delete button now exists for tabs
      const deleteApp2Btn = screen.getByLabelText(/Delete Approach 2/i);
      expect(deleteApp2Btn).toBeDefined();

      // Click delete Approach 2
      fireEvent.click(deleteApp2Btn);
      expect(screen.queryByText('Approach 2')).toBeNull();
    });

    it('Given unsaved edits, When attempting to close, Then discard confirmation prompt is displayed', () => {
      const onClose = vi.fn();
      render(
        <NoteModal
          aggregate={inboxAggregate}
          isOpen={true}
          onClose={onClose}
          onSaved={vi.fn()}
        />
      );

      // Type an edit into textarea
      const textarea = screen.getByLabelText(/Approach notes editor/i);
      fireEvent.change(textarea, { target: { value: 'New unsaved text' } });

      // Click Cancel
      fireEvent.click(screen.getByText('Cancel'));

      // Discard prompt appears
      expect(screen.getByText('Discard unsaved changes?')).toBeDefined();
      expect(onClose).not.toHaveBeenCalled();

      // Click Discard Changes
      fireEvent.click(screen.getByText('Discard Changes'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('Given INBOX problem with missing complexity, When user attempts to Save, Then client inline error is displayed', async () => {
      const onSaved = vi.fn();
      render(
        <NoteModal
          aggregate={inboxAggregate}
          isOpen={true}
          onClose={vi.fn()}
          onSaved={onSaved}
        />
      );

      // The default template has unfilled complexity
      const saveBtn = screen.getByText('Save & Enroll');
      fireEvent.click(saveBtn);

      // Error message displayed
      expect(
        await screen.findByText(/require a value with at least one non-whitespace character/i)
      ).toBeDefined();
      expect(onSaved).not.toHaveBeenCalled();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 5. INBOX GROUPED LIST COMPONENT                                            */
  /* -------------------------------------------------------------------------- */
  describe('InboxGroupedList Component', () => {
    it('Given multiple problems from different dates, When rendered, Then displays date headings and collapsible groups', () => {
      const p1: ProblemAggregate = {
        problem: {
          id: 'p-1',
          platform: 'LEETCODE',
          slug: 'p-1',
          title: 'Problem 1 Today',
          difficulty: 'Easy',
          url: 'https://leetcode.com',
          solvedAt: '2026-10-16T10:00:00Z',
          status: 'INBOX',
          enrolledAt: null,
          deletedAt: null,
        },
        note: null,
        reviews: [],
      };

      const p2: ProblemAggregate = {
        problem: {
          id: 'p-2',
          platform: 'LEETCODE',
          slug: 'p-2',
          title: 'Problem 2 Yesterday',
          difficulty: 'Medium',
          url: 'https://leetcode.com',
          solvedAt: '2026-10-15T10:00:00Z',
          status: 'INBOX',
          enrolledAt: null,
          deletedAt: null,
        },
        note: null,
        reviews: [],
      };

      render(
        <InboxGroupedList
          problems={[p1, p2]}
          today="2026-10-16"
          onOpenNotes={vi.fn()}
          onCompleteStage={vi.fn()}
          onUndoStage={vi.fn()}
          onDelete={vi.fn()}
        />
      );

      // Both headings visible with counts
      expect(screen.getByText('Solved today')).toBeDefined();
      expect(screen.getByText('Yesterday')).toBeDefined();
      expect(screen.getByText('Problem 1 Today')).toBeDefined();
      expect(screen.getByText('Problem 2 Yesterday')).toBeDefined();

      // Click Collapse on Solved today
      const todayGroupBtn = screen.getByRole('button', { name: /Solved today/i });
      fireEvent.click(todayGroupBtn);

      // Problem 1 card is collapsed/hidden
      expect(screen.queryByText('Problem 1 Today')).toBeNull();
      // Problem 2 Yesterday remains expanded
      expect(screen.getByText('Problem 2 Yesterday')).toBeDefined();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 5. LOGO AND BRANDING VERIFICATION                                          */
  /* -------------------------------------------------------------------------- */
  describe('Logo and Branding Verification', () => {
    it('Navbar renders an img with alt "Leet Tracker logo" and src "/logo.svg"', () => {
      render(
        <Navbar
          onOpenAdd={vi.fn()}
          onOpenSettings={vi.fn()}
          onSync={vi.fn()}
          syncing={false}
          username="testuser"
        />
      );
      const logoImg = screen.getByAltText('Leet Tracker logo');
      expect(logoImg).toBeDefined();
      expect(logoImg.getAttribute('src')).toBe('/logo.svg');
    });

    it('public/logo.svg exists and contains valid SVG content', () => {
      const logoPath = path.resolve(process.cwd(), 'public', 'logo.svg');
      expect(fs.existsSync(logoPath)).toBe(true);
      const content = fs.readFileSync(logoPath, 'utf8');
      expect(content).toContain('<svg');
      expect(content).toContain('aria-label="Leet Tracker logo"');
    });

    it('index.html contains the favicon link with href="/logo.svg"', () => {
      const indexPath = path.resolve(process.cwd(), 'index.html');
      expect(fs.existsSync(indexPath)).toBe(true);
      const content = fs.readFileSync(indexPath, 'utf8');
      expect(content).toMatch(/<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="\/logo\.svg"/);
    });
  });
});
