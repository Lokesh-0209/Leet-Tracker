/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { RefreshCw, Plus, Settings } from 'lucide-react';

interface NavbarProps {
  readonly onOpenAdd: () => void;
  readonly onOpenSettings: () => void;
  readonly onSync: () => void;
  readonly syncing: boolean;
  readonly username?: string | null;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenAdd,
  onOpenSettings,
  onSync,
  syncing,
  username,
}) => {
  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <img
            src="/logo.svg"
            alt="Leet Tracker logo"
            className="h-9 w-auto object-contain"
          />
          <div>
            <h1 className="text-lg font-bold text-zinc-100 leading-none">Leet Tracker</h1>
            <p className="text-xs text-zinc-400 mt-1">Spaced Repetition for Solved Problems</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={onSync}
            disabled={syncing}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-white transition disabled:opacity-50 cursor-pointer"
            title={username ? `Sync from LeetCode account "${username}"` : 'Sync from LeetCode'}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-amber-400' : ''}`} />
            <span>{syncing ? 'Syncing...' : 'Sync from LeetCode'}</span>
          </button>

          <button
            type="button"
            onClick={onOpenAdd}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 text-zinc-950 hover:bg-amber-400 font-semibold transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Problem</span>
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition cursor-pointer"
            title="Settings & Deleted Problems"
            aria-label="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
