/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ExternalLink, Check, AlertTriangle, FileText, CheckCircle2 } from 'lucide-react';
import type { ProblemAggregate, ReviewStage } from '../../domain/index.js';
import type { TodayReviewsResponse } from '../apiClient.js';

interface ReviewQueueListProps {
  readonly items: TodayReviewsResponse['items'];
  readonly today: string;
  readonly onComplete: (problemId: string, stage: ReviewStage) => void;
  readonly onOpenNotes: (problemId: string) => void;
}

export const ReviewQueueList: React.FC<ReviewQueueListProps> = ({
  items,
  today,
  onComplete,
  onOpenNotes,
}) => {
  if (items.length === 0) {
    return (
      <div className="text-center py-16 px-4 bg-zinc-900/50 border border-zinc-800/80 rounded-2xl">
        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3 opacity-90" />
        <h3 className="text-base font-semibold text-zinc-100">All caught up!</h3>
        <p className="text-sm text-zinc-400 max-w-sm mx-auto mt-1">
          No reviews due or overdue today ({today}). Great work keeping your spaced repetition on track.
        </p>
      </div>
    );
  }

  const difficultyColors = {
    Easy: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    Medium: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    Hard: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  };

  return (
    <div className="space-y-3">
      {items.map(({ problem, review }) => {
        const isOverdue = review.dueDate < today;
        const stageDays = review.stage === 1 ? 1 : review.stage === 2 ? 3 : 7;

        return (
          <div
            key={`${problem.id}-${review.stage}`}
            className={`p-4 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition ${
              isOverdue
                ? 'bg-rose-950/10 border-rose-900/40 hover:border-rose-800/60'
                : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <div className="flex-1">
              <div className="flex items-center space-x-2">
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                    difficultyColors[problem.difficulty]
                  }`}
                >
                  {problem.difficulty}
                </span>

                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700">
                  Stage {review.stage} (Day {stageDays})
                </span>

                {isOverdue && (
                  <span className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                    <AlertTriangle className="w-3 h-3" />
                    <span>Overdue ({review.dueDate})</span>
                  </span>
                )}
                {!isOverdue && (
                  <span className="text-xs text-zinc-400">Due today ({review.dueDate})</span>
                )}
              </div>

              <h4 className="text-base font-semibold text-zinc-100 mt-1 flex items-center gap-1.5">
                <a
                  href={problem.url}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-amber-400 transition"
                >
                  {problem.title}
                </a>
                <ExternalLink className="w-3.5 h-3.5 text-zinc-600 inline" />
              </h4>
            </div>

            <div className="flex items-center space-x-2 self-end sm:self-center">
              <button
                type="button"
                onClick={() => onOpenNotes(problem.id)}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 text-amber-400" />
                <span>View Notes</span>
              </button>

              <button
                type="button"
                onClick={() => onComplete(problem.id, review.stage)}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition cursor-pointer"
                aria-label={`Mark Stage ${review.stage} complete for ${problem.title}`}
              >
                <Check className="w-4 h-4" />
                <span>Mark Reviewed</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
