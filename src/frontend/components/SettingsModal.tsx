/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import {
  X,
  Settings,
  RotateCcw,
  Trash2,
  Check,
  Download,
  Upload,
  AlertTriangle,
  AlertCircle,
  Database,
} from 'lucide-react';
import type { ProblemAggregate } from '../../domain/index.js';
import { apiClient } from '../apiClient.js';

interface SettingsModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly username: string;
  readonly onSaveUsername: (username: string) => Promise<void>;
  readonly savingUsername: boolean;
  readonly saveSuccess: boolean;
  readonly deletedProblems: readonly ProblemAggregate[];
  readonly onRestoreProblem: (id: string) => void;
  readonly onPermanentDeleteProblem: (id: string, title: string) => void;
  readonly onBackupRestored?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  username,
  onSaveUsername,
  savingUsername,
  saveSuccess,
  deletedProblems,
  onRestoreProblem,
  onPermanentDeleteProblem,
  onBackupRestored,
}) => {
  const [inputUser, setInputUser] = useState(username);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  // Restore confirmation modal state
  const [showConfirmRestore, setShowConfirmRestore] = useState(false);
  const [pendingBackup, setPendingBackup] = useState<{ fileName: string; data: unknown } | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync state if username changes
  React.useEffect(() => {
    setInputUser(username);
  }, [username]);

  if (!isOpen) return null;

  const handleUserSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveUsername(inputUser);
  };

  const handleExportBackup = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      const data = await apiClient.exportBackup();
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = `leet-tracker-backup-${dateStr}.json`;

      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : 'Failed to export backup');
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportError(null);
    setImportSuccess(null);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setPendingBackup({ fileName: file.name, data: parsed });
      setShowConfirmRestore(true);
    } catch {
      setImportError('Selected file is not valid JSON.');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingBackup) return;

    setIsImporting(true);
    setImportError(null);
    setImportSuccess(null);

    try {
      const result = await apiClient.restoreBackup(pendingBackup.data);
      setImportSuccess(
        `Backup restored successfully (${result.restoredCount} problem${result.restoredCount === 1 ? '' : 's'}).`
      );
      setShowConfirmRestore(false);
      setPendingBackup(null);
      if (onBackupRestored) {
        onBackupRestored();
      }
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'Failed to restore backup');
      setShowConfirmRestore(false);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl relative max-h-[85vh] flex flex-col">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-zinc-500 hover:text-zinc-300 cursor-pointer"
          aria-label="Close settings"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-zinc-800 text-zinc-200 flex items-center justify-center">
            <Settings className="w-5 h-5" />
          </div>
          <div>
            <h3 id="settings-title" className="text-base font-bold text-zinc-100">
              Settings & Data Management
            </h3>
            <p className="text-xs text-zinc-400">Configure profile, manage backups, and restore hidden problems</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-6 pr-1">
          {/* Section 1: LeetCode Account */}
          <section className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-4">
            <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
              LeetCode Account
            </h4>
            <p className="text-xs text-zinc-400 mb-3">
              Your public username is used to fetch solved problems into your Inbox. We never ask for or store passwords.
            </p>

            <form onSubmit={handleUserSubmit} className="flex gap-2">
              <input
                type="text"
                value={inputUser}
                onChange={(e) => setInputUser(e.target.value)}
                placeholder="e.g. lee215"
                className="flex-1 px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
              />
              <button
                type="submit"
                disabled={savingUsername}
                className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs transition disabled:opacity-50 cursor-pointer"
              >
                {savingUsername ? 'Saving...' : 'Save'}
              </button>
            </form>

            {saveSuccess && (
              <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                Username saved successfully.
              </p>
            )}
          </section>

          {/* Section 2: Data Backup & Portability */}
          <section className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-4">
            <div className="flex items-center space-x-2 mb-2">
              <Database className="w-4 h-4 text-amber-400" />
              <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                Backup Export & Import
              </h4>
            </div>
            <p className="text-xs text-zinc-400 mb-4">
              Export your problems, approaches, notes, reviews, and settings to a JSON file. In cloud preview environments where instances may reset, keeping a backup guarantees your data is never lost.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleExportBackup}
                disabled={isExporting}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold text-xs border border-zinc-700 transition disabled:opacity-50 cursor-pointer"
                title="Download full database snapshot as JSON"
              >
                <Download className="w-3.5 h-3.5 text-amber-400" />
                <span>{isExporting ? 'Exporting...' : 'Export Backup'}</span>
              </button>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChosen}
                accept=".json,application/json"
                className="hidden"
                aria-label="Upload backup JSON file"
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold text-xs border border-zinc-700 transition disabled:opacity-50 cursor-pointer"
                title="Upload and restore a previous backup JSON"
              >
                <Upload className="w-3.5 h-3.5 text-blue-400" />
                <span>{isImporting ? 'Restoring...' : 'Import Backup'}</span>
              </button>
            </div>

            {exportError && (
              <p className="text-xs text-rose-400 mt-3 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{exportError}</span>
              </p>
            )}

            {importError && (
              <p className="text-xs text-rose-400 mt-3 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{importError}</span>
              </p>
            )}

            {importSuccess && (
              <p className="text-xs text-emerald-400 mt-3 flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 shrink-0" />
                <span>{importSuccess}</span>
              </p>
            )}
          </section>

          {/* Section 3: Deleted Problems */}
          <section className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                Deleted Problems ({deletedProblems.length})
              </h4>
            </div>
            <p className="text-xs text-zinc-400 mb-4">
              Problems in this list are hidden from the dashboard and will never be resurrected by automatic sync.
            </p>

            {deletedProblems.length === 0 ? (
              <div className="py-6 text-center text-xs text-zinc-500">
                No deleted problems.
              </div>
            ) : (
              <div className="space-y-2">
                {deletedProblems.map(({ problem }) => (
                  <div
                    key={problem.id}
                    className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <span className="font-semibold text-zinc-200">{problem.title}</span>
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        Deleted: {problem.deletedAt?.slice(0, 10)} · {problem.difficulty}
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => onRestoreProblem(problem.id)}
                        className="flex items-center space-x-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-emerald-400 font-medium transition cursor-pointer"
                        title="Restore back to active dashboard"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Restore</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onPermanentDeleteProblem(problem.id, problem.title)}
                        className="flex items-center space-x-1 px-2.5 py-1 rounded bg-rose-950/30 hover:bg-rose-900/50 text-rose-400 border border-rose-900/40 font-medium transition cursor-pointer"
                        title="Permanently remove from database"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Purge</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="pt-4 border-t border-zinc-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition cursor-pointer"
          >
            Close
          </button>
        </div>

        {/* Confirmation Dialog for Restore */}
        {showConfirmRestore && pendingBackup && (
          <div
            className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-restore-title"
          >
            <div className="bg-zinc-900 border border-amber-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
              <div className="flex items-start space-x-3">
                <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h4 id="confirm-restore-title" className="text-base font-bold text-zinc-100">
                    Replace All Data with Backup?
                  </h4>
                  <p className="text-xs text-zinc-400 mt-1">
                    Restoring from <span className="font-semibold text-zinc-200">"{pendingBackup.fileName}"</span> will <strong className="text-amber-400">completely replace</strong> all current problems, reviews, notes, and username settings.
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-900/30 text-xs text-amber-200/90 leading-relaxed">
                Existing data is wiped inside a single atomic transaction. If the file is invalid, nothing will be changed.
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowConfirmRestore(false);
                    setPendingBackup(null);
                  }}
                  disabled={isImporting}
                  className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRestore}
                  disabled={isImporting}
                  className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold transition disabled:opacity-50 cursor-pointer"
                >
                  {isImporting ? 'Restoring...' : 'Confirm & Replace All'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
