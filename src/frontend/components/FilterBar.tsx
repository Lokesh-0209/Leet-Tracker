/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Search, X } from 'lucide-react';
import type { Difficulty } from '../../domain/index.js';

interface FilterBarProps {
  readonly search: string;
  readonly onSearchChange: (val: string) => void;
  readonly difficulty: Difficulty | 'ALL';
  readonly onDifficultyChange: (val: Difficulty | 'ALL') => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  search,
  onSearchChange,
  difficulty,
  onDifficultyChange,
}) => {
  const difficulties: (Difficulty | 'ALL')[] = ['ALL', 'Easy', 'Medium', 'Hard'];

  return (
    <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between my-4">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by title or slug..."
          className="w-full pl-9 pr-8 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition"
          aria-label="Search problems"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-2.5 top-2.5 text-zinc-500 hover:text-zinc-300"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex items-center space-x-1.5 self-start sm:self-auto" role="group" aria-label="Difficulty filter">
        {difficulties.map((diff) => {
          const isSelected = difficulty === diff;
          return (
            <button
              key={diff}
              type="button"
              onClick={() => onDifficultyChange(diff)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                isSelected
                  ? 'bg-zinc-800 text-amber-400 border border-amber-500/40'
                  : 'bg-zinc-900/60 text-zinc-400 border border-zinc-800 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              {diff}
            </button>
          );
        })}
      </div>
    </div>
  );
};
