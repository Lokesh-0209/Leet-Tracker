/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Navbar } from './frontend/components/Navbar.js';
import { Tabs, type TabKey } from './frontend/components/Tabs.js';
import { FilterBar } from './frontend/components/FilterBar.js';
import { ProblemCard } from './frontend/components/ProblemCard.js';
import { ReviewQueueList } from './frontend/components/ReviewQueueList.js';
import { SyncBanner } from './frontend/components/SyncBanner.js';
import { ManualAddModal } from './frontend/components/ManualAddModal.js';
import { DeleteConfirmModal } from './frontend/components/DeleteConfirmModal.js';
import { NoteModal } from './frontend/components/NoteModal.js';
import { InboxGroupedList } from './frontend/components/InboxGroupedList.js';
import { SettingsModal } from './frontend/components/SettingsModal.js';
import { useProblems } from './frontend/hooks/useProblems.js';
import { useTodayReviews } from './frontend/hooks/useTodayReviews.js';
import { useSync } from './frontend/hooks/useSync.js';
import { useSettings } from './frontend/hooks/useSettings.js';
import { apiClient } from './frontend/apiClient.js';
import type { ProblemAggregate, ReviewStage } from './domain/index.js';
import { Inbox, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('INBOX');

  // Modals state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeNoteProblem, setActiveNoteProblem] = useState<ProblemAggregate | null>(null);

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string; isPermanent: boolean } | null>(null);

  // Hooks
  const todayReviews = useTodayReviews();
  const problemsHook = useProblems(activeTab);
  const settingsHook = useSettings();

  const refreshAll = () => {
    problemsHook.refresh();
    todayReviews.refresh();
    settingsHook.refresh();
  };

  const syncHook = useSync(refreshAll);

  // Review stage handlers
  const handleCompleteStage = async (problemId: string, stage: ReviewStage) => {
    try {
      await apiClient.completeReview(problemId, stage);
      refreshAll();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to complete review stage');
    }
  };

  const handleUndoStage = async (problemId: string, stage: ReviewStage) => {
    try {
      await apiClient.undoReview(problemId, stage);
      refreshAll();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to undo review stage');
    }
  };

  // Open note modal by problem ID (e.g. from Today's Reviews list)
  const handleOpenNotesById = async (problemId: string) => {
    try {
      const aggregate = await apiClient.getProblem(problemId);
      setActiveNoteProblem(aggregate);
    } catch (err) {
      console.error('Failed to load notes for problem:', err);
    }
  };

  // Delete confirm handler
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;

    try {
      if (deleteTarget.isPermanent) {
        await settingsHook.permanentDeleteProblem(deleteTarget.id);
      } else {
        await apiClient.softDelete(deleteTarget.id);
        refreshAll();
      }
      setDeleteTarget(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <Navbar
        onOpenAdd={() => setIsAddOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onSync={() => syncHook.sync(settingsHook.username)}
        syncing={syncHook.syncing}
        username={settingsHook.username}
      />

      {/* Main Container */}
      <main className="max-w-6xl w-full mx-auto px-4 py-6 flex-1 flex flex-col">
        {/* Sync notification banner */}
        <SyncBanner
          result={syncHook.result}
          error={syncHook.error}
          onRetry={() => syncHook.sync(settingsHook.username)}
          onDismiss={() => {
            syncHook.clearResult();
            syncHook.clearError();
          }}
        />

        {/* Dashboard Navigation Tabs */}
        <Tabs
          activeTab={activeTab}
          onChange={setActiveTab}
          todayCount={todayReviews.count}
        />

        {/* Filters (Shown on Inbox, Active, and Solved tabs) */}
        {activeTab !== 'TODAY' && (
          <FilterBar
            search={problemsHook.search}
            onSearchChange={problemsHook.setSearch}
            difficulty={problemsHook.difficulty}
            onDifficultyChange={problemsHook.setDifficulty}
          />
        )}

        {/* Tab Content */}
        <div className="mt-4 flex-1">
          {/* TAB 1: TODAY'S REVIEWS QUEUE */}
          {activeTab === 'TODAY' && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-zinc-100">Today's Review Queue</h2>
                  <p className="text-xs text-zinc-400">
                    Spaced repetition reviews due or overdue on {todayReviews.today || 'today'}
                  </p>
                </div>
              </div>

              {todayReviews.loading ? (
                <div className="py-16 text-center text-zinc-500 text-sm">
                  Loading review queue...
                </div>
              ) : todayReviews.error ? (
                <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-900/50 text-rose-300 text-sm flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-rose-400" />
                  <span>{todayReviews.error}</span>
                </div>
              ) : (
                <ReviewQueueList
                  items={todayReviews.items}
                  today={todayReviews.today}
                  onComplete={handleCompleteStage}
                  onOpenNotes={handleOpenNotesById}
                />
              )}
            </div>
          )}

          {/* TAB 2, 3, 4: PROBLEMS LIST */}
          {activeTab !== 'TODAY' && (
            <div>
              {problemsHook.loading ? (
                <div className="py-16 text-center text-zinc-500 text-sm">
                  Loading problems...
                </div>
              ) : problemsHook.error ? (
                <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-900/50 text-rose-300 text-sm flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-rose-400" />
                  <span>{problemsHook.error}</span>
                </div>
              ) : problemsHook.problems.length === 0 ? (
                <div className="text-center py-20 px-4 bg-zinc-900/30 border border-zinc-800/60 rounded-2xl">
                  {activeTab === 'INBOX' && (
                    <>
                      <Inbox className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
                      <h3 className="text-base font-semibold text-zinc-200">Your Inbox is empty</h3>
                      <p className="text-sm text-zinc-400 max-w-sm mx-auto mt-1 mb-4">
                        Connect your LeetCode username in Settings or click "Sync from LeetCode" to import your solved problems.
                      </p>
                      <button
                        type="button"
                        onClick={() => setIsAddOpen(true)}
                        className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 transition cursor-pointer"
                      >
                        + Add problem manually
                      </button>
                    </>
                  )}

                  {activeTab === 'ACTIVE' && (
                    <>
                      <Sparkles className="w-12 h-12 text-amber-500/60 mx-auto mb-3" />
                      <h3 className="text-base font-semibold text-zinc-200">No active review schedules</h3>
                      <p className="text-sm text-zinc-400 max-w-sm mx-auto mt-1">
                        Go to your Inbox and write notes (with Time and Space complexity) for any problem to enroll it into the 1, 3, 7 day review schedule.
                      </p>
                    </>
                  )}

                  {activeTab === 'FULLY_SOLVED' && (
                    <>
                      <CheckCircle2 className="w-12 h-12 text-emerald-500/60 mx-auto mb-3" />
                      <h3 className="text-base font-semibold text-zinc-200">No fully solved problems yet</h3>
                      <p className="text-sm text-zinc-400 max-w-sm mx-auto mt-1">
                        Complete all 3 spaced repetition reviews for an active problem to permanently master it and move it here.
                      </p>
                    </>
                  )}
                </div>
              ) : activeTab === 'INBOX' ? (
                <InboxGroupedList
                  problems={problemsHook.problems}
                  today={todayReviews.today}
                  onOpenNotes={setActiveNoteProblem}
                  onCompleteStage={handleCompleteStage}
                  onUndoStage={handleUndoStage}
                  onDelete={(id, title) =>
                    setDeleteTarget({ id, title, isPermanent: false })
                  }
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {problemsHook.problems.map((aggregate) => (
                    <ProblemCard
                      key={aggregate.problem.id}
                      aggregate={aggregate}
                      today={todayReviews.today}
                      onOpenNotes={setActiveNoteProblem}
                      onCompleteStage={handleCompleteStage}
                      onUndoStage={handleUndoStage}
                      onDelete={(id, title) =>
                        setDeleteTarget({ id, title, isPermanent: false })
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      <ManualAddModal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onSuccess={refreshAll}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        username={settingsHook.username}
        onSaveUsername={settingsHook.saveUsername}
        savingUsername={settingsHook.saving}
        saveSuccess={settingsHook.saveSuccess}
        deletedProblems={settingsHook.deletedProblems}
        onRestoreProblem={async (id) => {
          await settingsHook.restoreProblem(id);
          refreshAll();
        }}
        onPermanentDeleteProblem={(id, title) =>
          setDeleteTarget({ id, title, isPermanent: true })
        }
        onBackupRestored={refreshAll}
      />

      <DeleteConfirmModal
        isOpen={deleteTarget !== null}
        title={deleteTarget?.isPermanent ? 'Permanently Delete Problem' : 'Delete Problem'}
        message={
          deleteTarget?.isPermanent
            ? `Are you sure you want to permanently delete "${deleteTarget?.title}"? All notes and review history will be purged forever.`
            : `Move "${deleteTarget?.title}" to deleted? You can restore it anytime in Settings, and sync will never recreate it.`
        }
        isPermanent={deleteTarget?.isPermanent}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <NoteModal
        aggregate={activeNoteProblem}
        isOpen={activeNoteProblem !== null}
        onClose={() => setActiveNoteProblem(null)}
        onSaved={refreshAll}
      />
    </div>
  );
}
