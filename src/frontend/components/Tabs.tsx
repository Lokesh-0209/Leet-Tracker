/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export type TabKey = 'INBOX' | 'TODAY' | 'ACTIVE' | 'FULLY_SOLVED';

interface TabsProps {
  readonly activeTab: TabKey;
  readonly onChange: (tab: TabKey) => void;
  readonly todayCount: number;
}

export const Tabs: React.FC<TabsProps> = ({ activeTab, onChange, todayCount }) => {
  const tabs: { key: TabKey; label: string; badge?: number }[] = [
    { key: 'INBOX', label: 'Inbox' },
    { key: 'TODAY', label: "Today's Reviews", badge: todayCount },
    { key: 'ACTIVE', label: 'All Active' },
    { key: 'FULLY_SOLVED', label: 'Fully Solved' },
  ];

  return (
    <nav className="flex space-x-1 border-b border-zinc-800" aria-label="Dashboard tabs">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={`flex items-center space-x-2 py-3 px-4 border-b-2 font-medium text-sm transition cursor-pointer ${
              isActive
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
            }`}
          >
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
};
