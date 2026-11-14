/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export const SplashScreen: React.FC = () => {
  return (
    <div
      role="status"
      aria-label="Loading Leet Tracker"
      className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center z-50 transition-opacity duration-500"
    >
      <div className="flex flex-col items-center animate-in fade-in zoom-in-95 duration-500">
        <div className="relative mb-6">
          <img
            src="/logo.svg"
            alt="Leet Tracker logo"
            className="w-20 h-20 object-contain drop-shadow-md"
          />
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-zinc-100 mb-2">
          Leet Tracker
        </h1>
        <p className="text-sm text-zinc-400 font-medium">
          Spaced Repetition for Solved Problems
        </p>

        {/* Subtle status loader */}
        <div className="mt-8 flex items-center space-x-1.5" aria-hidden="true">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500/80 animate-pulse" />
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500/80 animate-pulse [animation-delay:150ms]" />
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500/80 animate-pulse [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
};
