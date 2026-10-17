/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Calendar } from 'lucide-react';
import {
  groupProblemsBySolvedDate,
  type ProblemAggregate,
  type ReviewStage,
} from '../../domain/index.js';
import { ProblemCard } from './ProblemCard.js';
import { apiClient } from '../apiClient.js';

interface InboxGroupedListProps {
  readonly problems: readonly ProblemAggregate[];
  readonly today: string;
  readonly onOpenNotes: (problem: ProblemAggregate) => void;
  readonly onCompleteStage: (problemId: string, stage: ReviewStage) => void;
  readonly onUndoStage: (problemId: string, stage: ReviewStage) => void;
  readonly onDelete: (problemId: string, title: string) => void;
}

export const InboxGroupedList: React.FC<InboxGroupedListProps> = ({
  problems,
  today,
  onOpenNotes,
  onCompleteStage,
  onUndoStage,
  onDelete,
}) => {
  // Collapsed groups set (keyed by date "YYYY-MM-DD")
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());

  // Use pure domain function to group items by local calendar day
  const userTimeZone = apiClient.timeZone;
  const groups = groupProblemsBySolvedDate(
    problems.map((p) => ({ ...p, solvedAt: p.problem.solvedAt })),
    userTimeZone,
    today
  );

  const toggleGroup = (date: string) => {
    setCollapsedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const isCollapsed = collapsedDates.has(group.date);

        return (
          <section
            key={group.date}
            aria-labelledby={`inbox-group-${group.date}`}
            className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-4 transition"
          >
            {/* Collapsible Heading */}
            <button
              type="button"
              id={`inbox-group-${group.date}`}
              onClick={() => toggleGroup(group.date)}
              aria-expanded={!isCollapsed}
              className="w-full flex items-center justify-between py-1 text-left cursor-pointer group"
            >
              <div className="flex items-center space-x-2.5">
                <Calendar className="w-4 h-4 text-amber-400/80" />
                <h3 className="text-sm font-bold text-zinc-100 group-hover:text-amber-400 transition">
                  {group.heading}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-800 border border-zinc-700/60 text-zinc-300">
                  {group.count}
                </span>
              </div>

              <div className="flex items-center space-x-1 text-zinc-500 group-hover:text-zinc-300 text-xs transition">
                <span>{isCollapsed ? 'Expand' : 'Collapse'}</span>
                {isCollapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </div>
            </button>

            {/* Problem Cards Grid */}
            {!isCollapsed && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mt-3.5 pt-3 border-t border-zinc-800/60">
                {group.items.map((aggregate) => (
                  <ProblemCard
                    key={aggregate.problem.id}
                    aggregate={aggregate}
                    today={today}
                    onOpenNotes={onOpenNotes}
                    onCompleteStage={onCompleteStage}
                    onUndoStage={onUndoStage}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
};
