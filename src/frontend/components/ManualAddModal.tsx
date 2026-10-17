/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { X, Plus, AlertCircle, HelpCircle } from 'lucide-react';
import type { Difficulty } from '../../domain/index.js';
import { apiClient } from '../apiClient.js';
import { AppError } from '../../domain/index.js';

interface ManualAddModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
}

export const ManualAddModal: React.FC<ManualAddModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [urlOrSlug, setUrlOrSlug] = useState('');
  const [title, setTitle] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty | ''>('');
  const [needsDifficulty, setNeedsDifficulty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setUrlOrSlug('');
      setTitle('');
      setDifficulty('');
      setNeedsDifficulty(false);
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlOrSlug.trim()) {
      setError('Please enter a problem URL or slug.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await apiClient.manualAddProblem({
        urlOrSlug: urlOrSlug.trim(),
        title: title.trim() || undefined,
        difficulty: (difficulty || undefined) as Difficulty | undefined,
      });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      if (err instanceof AppError) {
        if (/difficulty/i.test(err.message)) {
          setNeedsDifficulty(true);
        }
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to add problem.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-add-title"
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-zinc-500 hover:text-zinc-300 cursor-pointer"
          aria-label="Close dialog"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center">
            <Plus className="w-5 h-5" />
          </div>
          <div>
            <h3 id="manual-add-title" className="text-base font-bold text-zinc-100">
              Add LeetCode Problem
            </h3>
            <p className="text-xs text-zinc-400">Add by problem URL or slug into your Inbox</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="url-input" className="block text-xs font-semibold text-zinc-300 mb-1">
              LeetCode Problem URL or Slug <span className="text-rose-400">*</span>
            </label>
            <input
              id="url-input"
              type="text"
              value={urlOrSlug}
              onChange={(e) => setUrlOrSlug(e.target.value)}
              placeholder="e.g. two-sum or https://leetcode.com/problems/two-sum/"
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
              autoFocus
            />
            <p className="text-[11px] text-zinc-500 mt-1 flex items-center gap-1">
              <HelpCircle className="w-3 h-3" />
              Accepts plain slugs, /description/ URLs, and query strings.
            </p>
          </div>

          <div>
            <label htmlFor="title-input" className="block text-xs font-semibold text-zinc-300 mb-1">
              Custom Title <span className="text-zinc-500 font-normal">(Optional)</span>
            </label>
            <input
              id="title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Leave empty to auto-derive from LeetCode"
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label htmlFor="difficulty-select" className="block text-xs font-semibold text-zinc-300 mb-1">
              Difficulty{' '}
              {needsDifficulty ? (
                <span className="text-amber-400 font-bold">(Required when LeetCode is offline)</span>
              ) : (
                <span className="text-zinc-500 font-normal">(Auto-fetched if omitted)</span>
              )}
            </label>
            <select
              id="difficulty-select"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty | '')}
              className={`w-full px-3 py-2 bg-zinc-950 border rounded-lg text-sm text-zinc-100 focus:outline-none ${
                needsDifficulty ? 'border-amber-500/80 ring-1 ring-amber-500/50' : 'border-zinc-800 focus:border-amber-500'
              }`}
            >
              <option value="">Auto-fetch difficulty</option>
              <option value="Easy">Easy</option>
              <option value="Medium">Medium</option>
              <option value="Hard">Hard</option>
            </select>
          </div>

          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-sm transition disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Adding...' : 'Add to Inbox'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
