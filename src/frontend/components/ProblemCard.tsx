/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ExternalLink, FileText, Trash2, RotateCcw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { ProblemAggregate, ReviewStage } from '../../domain/index.js';
import { isReviewOverdue } from '../../domain/scheduler.js';

interface ProblemCardProps {
  readonly aggregate: ProblemAggregate;
  readonly today: string;
  readonly onOpenNotes: (problem: ProblemAggregate) => void;
  readonly onCompleteStage: (problemId: string, stage: ReviewStage) => void;
  readonly onUndoStage: (problemId: string, stage: ReviewStage) => void;
  readonly onDelete: (problemId: string, title: string) => void;
}

export const ProblemCard: React.FC<ProblemCardProps> = ({
  aggregate,
  today,
  onOpenNotes,
  onCompleteStage,
  onUndoStage,
  onDelete,
}) => {
  const { problem, note, reviews } = aggregate;

  const difficultyColors = {
    Easy: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    Medium: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    Hard: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  }[problem.difficulty];

  // Stage reviews sorted 1, 2, 3
  const sortedReviews = [...reviews].sort((a, b) => a.stage - b.stage);

  // Determine the most recently completed stage that can be undone
  const completedStages = sortedReviews.filter((r) => r.completedAt !== null);
  const mostRecentCompletedStage =
    completedStages.length > 0 ? completedStages[completedStages.length - 1].stage : null;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 flex flex-col justify-between hover:border-zinc-700 transition">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center space-x-2">
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${difficultyColors}`}
              >
                {problem.difficulty}
              </span>
              <span className="text-xs text-zinc-500 uppercase tracking-wider font-mono">
                {problem.platform}
              </span>
            </div>

            <h3 className="text-base font-semibold text-zinc-100 mt-1 flex items-center gap-1.5 group">
              <a
                href={problem.url}
                target="_blank"
                rel="noreferrer"
                className="hover:text-amber-400 transition"
              >
                {problem.title}
              </a>
              <ExternalLink className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 inline" />
            </h3>

            <p className="text-xs text-zinc-500 mt-1">
              Solved: {problem.solvedAt.slice(0, 10)}
              {problem.enrolledAt && ` · Enrolled: ${problem.enrolledAt.slice(0, 10)}`}
            </p>
          </div>

          <div className="flex items-center space-x-1.5">
            <button
              type="button"
              onClick={() => onOpenNotes(aggregate)}
              className="flex items-center space-x-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition cursor-pointer"
              title="View or Edit Notes"
            >
              <FileText className="w-3.5 h-3.5 text-amber-400" />
              <span>Notes</span>
              {note && note.approaches.length > 0 && (
                <span className="text-zinc-400 text-[10px]">({note.approaches.length})</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => onDelete(problem.id, problem.title)}
              className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition cursor-pointer"
              title="Delete Problem"
              aria-label={`Delete ${problem.title}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Spaced-Repetition Reviews Section */}
        {problem.status !== 'INBOX' && (
          <div className="mt-4 pt-3 border-t border-zinc-800/80">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Review Schedule
              </span>
              {problem.status === 'FULLY_SOLVED' && (
                <span className="flex items-center space-x-1 text-emerald-400 text-xs font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Fully Solved</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {sortedReviews.map((review) => {
                const isCompleted = review.completedAt !== null;
                const overdue = isReviewOverdue(review, today);

                // Stage ordering rule: stage 2 can only be completed if stage 1 is done;
                // stage 3 only if stage 2 is done.
                let canCheck = true;
                if (review.stage === 2 && !sortedReviews.find((r) => r.stage === 1)?.completedAt) {
                  canCheck = false;
                }
                if (review.stage === 3 && !sortedReviews.find((r) => r.stage === 2)?.completedAt) {
                  canCheck = false;
                }

                const canUndo = isCompleted && mostRecentCompletedStage === review.stage;

                return (
                  <div
                    key={review.stage}
                    className={`p-2.5 rounded-lg border text-xs flex flex-col justify-between transition ${
                      isCompleted
                        ? 'bg-zinc-950/60 border-emerald-900/40 text-emerald-300'
                        : overdue
                        ? 'bg-rose-950/20 border-rose-900/50 text-rose-200'
                        : 'bg-zinc-950/40 border-zinc-800 text-zinc-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[11px]">Day {review.stage === 1 ? 1 : review.stage === 2 ? 3 : 7}</span>
                      {overdue && (
                        <span className="flex items-center text-[10px] text-rose-400 font-semibold gap-0.5">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          <span>Overdue</span>
                        </span>
                      )}
                    </div>

                    <div className="mt-1 text-[11px] text-zinc-400">
                      Due: {review.dueDate}
                    </div>

                    <div className="mt-2.5 flex items-center justify-between pt-1 border-t border-zinc-800/40">
                      <label className="flex items-center space-x-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isCompleted}
                          disabled={isCompleted || !canCheck}
                          onChange={() => onCompleteStage(problem.id, review.stage)}
                          className="rounded border-zinc-700 bg-zinc-800 text-amber-500 focus:ring-amber-500 w-3.5 h-3.5 disabled:opacity-40 disabled:cursor-not-allowed"
                          aria-label={`Mark Stage ${review.stage} (Day ${review.stage === 1 ? 1 : review.stage === 2 ? 3 : 7}) complete for ${problem.title}`}
                        />
                        <span className="text-[11px] text-zinc-300 font-medium">
                          {isCompleted ? 'Done' : 'Review'}
                        </span>
                      </label>

                      {canUndo && (
                        <button
                          type="button"
                          onClick={() => onUndoStage(problem.id, review.stage)}
                          className="flex items-center space-x-0.5 text-[10px] text-zinc-400 hover:text-amber-400 transition"
                          title="Undo this review"
                          aria-label={`Undo Stage ${review.stage} for ${problem.title}`}
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                          <span>Undo</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Inbox Enrollment Prompt */}
        {problem.status === 'INBOX' && (
          <div className="mt-3 p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800 text-xs text-zinc-400 flex items-center justify-between">
            <span>In Inbox. Add your approach notes to start the review schedule.</span>
            <button
              type="button"
              onClick={() => onOpenNotes(aggregate)}
              className="text-amber-400 font-semibold hover:underline ml-2 whitespace-nowrap cursor-pointer"
            >
              Write Notes &rarr;
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
