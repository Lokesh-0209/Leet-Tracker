/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { RefreshCw, Plus, Settings, User as UserIcon, LogOut, ExternalLink, ChevronDown } from 'lucide-react';
import type { User } from '../../domain/models.js';

interface NavbarProps {
  readonly onOpenAdd: () => void;
  readonly onOpenSettings: () => void;
  readonly onSync: () => void;
  readonly syncing: boolean;
  readonly username?: string | null;
  readonly user?: User | null;
  readonly onLogout?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenAdd,
  onOpenSettings,
  onSync,
  syncing,
  username,
  user,
  onLogout,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const activeUsername = user?.leetcodeUsername || username;

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
            title={activeUsername ? `Sync from LeetCode account "${activeUsername}"` : 'Sync from LeetCode'}
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

          {/* User Profile Avatar & Dropdown */}
          {activeUsername && (
            <div className="relative ml-1" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                aria-expanded={dropdownOpen}
                aria-haspopup="true"
                className="flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs font-medium transition cursor-pointer"
              >
                <div className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center text-[10px] font-bold">
                  {activeUsername.charAt(0).toUpperCase()}
                </div>
                <span className="max-w-[100px] truncate">{activeUsername}</span>
                <ChevronDown className="w-3 h-3 text-zinc-400" />
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 mt-1.5 w-52 rounded-xl bg-zinc-900 border border-zinc-800 shadow-xl py-1 z-40 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-3 py-2 border-b border-zinc-800/80">
                    <p className="text-[11px] text-zinc-400">Signed in as</p>
                    <p className="text-xs font-semibold text-zinc-100 truncate mt-0.5">
                      @{activeUsername}
                    </p>
                  </div>

                  <a
                    href={`https://leetcode.com/${encodeURIComponent(activeUsername)}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between px-3 py-2 text-xs text-zinc-300 hover:text-white hover:bg-zinc-800 transition"
                    onClick={() => setDropdownOpen(false)}
                  >
                    <span className="flex items-center gap-2">
                      <UserIcon className="w-3.5 h-3.5 text-zinc-400" />
                      <span>LeetCode Profile</span>
                    </span>
                    <ExternalLink className="w-3 h-3 text-zinc-500" />
                  </a>

                  {onLogout && (
                    <>
                      <div className="h-px bg-zinc-800/80 my-1" />
                      <button
                        type="button"
                        onClick={() => {
                          setDropdownOpen(false);
                          onLogout();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-400 hover:bg-rose-950/30 hover:text-rose-300 transition text-left cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Sign Out</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
