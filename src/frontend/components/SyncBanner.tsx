/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { CheckCircle2, AlertCircle, RefreshCw, X } from 'lucide-react';
import type { SyncResult } from '../../services/syncService.js';
import type { SyncErrorState } from '../hooks/useSync.js';

interface SyncBannerProps {
  readonly result: SyncResult | null;
  readonly error: SyncErrorState | null;
  readonly onRetry: () => void;
  readonly onDismiss: () => void;
}

export const SyncBanner: React.FC<SyncBannerProps> = ({
  result,
  error,
  onRetry,
  onDismiss,
}) => {
  if (!result && !error) return null;

  if (result) {
    return (
      <div className="my-4 p-4 rounded-xl bg-emerald-950/30 border border-emerald-900/50 flex items-center justify-between text-xs sm:text-sm text-emerald-200">
        <div className="flex items-center space-x-2.5">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <div>
            <span className="font-semibold text-emerald-100">Sync completed successfully!</span>
            <div className="text-emerald-300/80 mt-0.5 space-x-2">
              <span>{result.added} added to Inbox</span>
              <span>·</span>
              <span>{result.alreadyKnown} already tracked</span>
              {result.skippedDeleted > 0 && (
                <>
                  <span>·</span>
                  <span>{result.skippedDeleted} deleted (kept hidden)</span>
                </>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="text-emerald-400 hover:text-emerald-200 p-1"
          aria-label="Dismiss sync banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="my-4 p-4 rounded-xl bg-rose-950/30 border border-rose-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-sm text-rose-200">
        <div className="flex items-start sm:items-center space-x-2.5">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5 sm:mt-0" />
          <div>
            <div className="font-semibold text-rose-100 flex items-center gap-1.5">
              <span>Sync Error:</span>
              <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-rose-900/40 text-rose-300">
                {error.code}
              </span>
            </div>
            <p className="text-rose-300/90 mt-0.5">{error.message}</p>
          </div>
        </div>

        <div className="flex items-center space-x-2 self-end sm:self-auto">
          {error.retryable && (
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-rose-800 hover:bg-rose-700 text-white font-medium text-xs transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Sync</span>
            </button>
          )}

          <button
            type="button"
            onClick={onDismiss}
            className="text-rose-400 hover:text-rose-200 p-1 cursor-pointer"
            aria-label="Dismiss error banner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return null;
};
