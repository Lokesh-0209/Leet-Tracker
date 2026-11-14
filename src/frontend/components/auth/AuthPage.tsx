/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { LoginForm } from './LoginForm.js';
import { RegisterForm } from './RegisterForm.js';

export const AuthPage: React.FC = () => {
  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col justify-center items-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <img
              src="/logo.svg"
              alt="Leet Tracker logo"
              className="h-12 w-auto object-contain drop-shadow"
            />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
            Leet Tracker
          </h1>
          <p className="text-xs text-zinc-400 mt-1 font-medium">
            Spaced Repetition for Solved Problems
          </p>
        </div>

        {/* Auth Card */}
        <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
          {/* Mode Tabs */}
          <div className="flex rounded-lg bg-zinc-950 p-1 mb-6 border border-zinc-800">
            <button
              type="button"
              onClick={() => setMode('LOGIN')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition cursor-pointer ${
                mode === 'LOGIN'
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setMode('REGISTER')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition cursor-pointer ${
                mode === 'REGISTER'
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Register with LeetCode
            </button>
          </div>

          {/* Active View */}
          {mode === 'LOGIN' ? (
            <LoginForm onSwitchToRegister={() => setMode('REGISTER')} />
          ) : (
            <RegisterForm onSwitchToLogin={() => setMode('LOGIN')} />
          )}
        </div>

        {/* Footer info */}
        <div className="mt-8 text-center text-xs text-zinc-500">
          Secure Multi-User LeetCode Tracking · Isolated Database
        </div>
      </div>
    </div>
  );
};
