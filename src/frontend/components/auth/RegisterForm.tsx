/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { apiClient, type VerificationStartResponse } from '../../apiClient.js';
import {
  User,
  Lock,
  Copy,
  Check,
  ExternalLink,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Eye,
  EyeOff,
  ArrowRight,
} from 'lucide-react';

interface RegisterFormProps {
  readonly onSwitchToLogin: () => void;
}

type RegistrationStep = 'USERNAME' | 'VERIFY_PROFILE' | 'CREATE_PASSWORD';

export const RegisterForm: React.FC<RegisterFormProps> = ({ onSwitchToLogin }) => {
  const { register } = useAuth();
  const [step, setStep] = useState<RegistrationStep>('USERNAME');

  // Step 1 state
  const [username, setUsername] = useState('');
  const [checkingUsername, setCheckingUsername] = useState(false);

  // Step 2 state
  const [challengeData, setChallengeData] = useState<VerificationStartResponse | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);

  // Step 3 state
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submittingPassword, setSubmittingPassword] = useState(false);

  // Global error message
  const [error, setError] = useState<string | null>(null);

  // 1. Submit Username -> Start verification
  const handleStartVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('Please enter your LeetCode username.');
      return;
    }

    try {
      setCheckingUsername(true);
      setError(null);
      const res = await apiClient.startVerification(username.trim());
      setChallengeData(res);
      setStep('VERIFY_PROFILE');
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not start verification. Please verify that this username exists on LeetCode.'
      );
    } finally {
      setCheckingUsername(false);
    }
  };

  // Copy code to clipboard
  const handleCopyCode = async () => {
    if (!challengeData) return;
    try {
      await navigator.clipboard.writeText(challengeData.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // 2. Verify Profile ownership
  const handleVerifyProfile = async () => {
    if (!challengeData) return;

    try {
      setVerifying(true);
      setError(null);
      const res = await apiClient.verifyCode(challengeData.challengeId, challengeData.code);
      if (res.verified) {
        setStep('CREATE_PASSWORD');
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not verify ownership. Make sure you saved the code in your LeetCode "About Me" section.'
      );
    } finally {
      setVerifying(false);
    }
  };

  // 3. Submit Password -> Register & Log in
  const handleCreatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challengeData) return;

    if (password.length < 12) {
      setError('Password must be at least 12 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    try {
      setSubmittingPassword(true);
      setError(null);
      await register({
        challengeId: challengeData.challengeId,
        code: challengeData.code,
        password,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
      setSubmittingPassword(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Progress indicators */}
      <div className="flex items-center justify-between px-1 text-xs text-zinc-400">
        <div
          className={`flex items-center gap-1.5 font-medium ${
            step === 'USERNAME' ? 'text-amber-400 font-semibold' : 'text-zinc-500'
          }`}
        >
          <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px]">
            1
          </span>
          <span>Username</span>
        </div>
        <div className="w-8 h-px bg-zinc-800" />
        <div
          className={`flex items-center gap-1.5 font-medium ${
            step === 'VERIFY_PROFILE' ? 'text-amber-400 font-semibold' : 'text-zinc-500'
          }`}
        >
          <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px]">
            2
          </span>
          <span>Ownership</span>
        </div>
        <div className="w-8 h-px bg-zinc-800" />
        <div
          className={`flex items-center gap-1.5 font-medium ${
            step === 'CREATE_PASSWORD' ? 'text-amber-400 font-semibold' : 'text-zinc-500'
          }`}
        >
          <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px]">
            3
          </span>
          <span>Password</span>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-900/60 text-rose-300 text-xs flex items-start gap-2.5"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      {/* STEP 1: USERNAME */}
      {step === 'USERNAME' && (
        <form onSubmit={handleStartVerification} className="space-y-4">
          <div>
            <label
              htmlFor="reg-username"
              className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5"
            >
              Your LeetCode Username
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
                <User className="w-4 h-4" />
              </div>
              <input
                id="reg-username"
                type="text"
                required
                autoComplete="off"
                autoCapitalize="none"
                spellCheck="false"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. tourist"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-zinc-800 bg-zinc-900/80 text-zinc-100 placeholder-zinc-500 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 transition"
              />
            </div>
            <p className="text-xs text-zinc-500 mt-1.5">
              We'll verify you own this LeetCode account before creating your tracker.
            </p>
          </div>

          <button
            type="submit"
            disabled={checkingUsername}
            className="w-full py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm transition flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer shadow-sm"
          >
            {checkingUsername ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Checking LeetCode...</span>
              </>
            ) : (
              <>
                <span>Continue</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      )}

      {/* STEP 2: VERIFICATION CODE IN ABOUT ME */}
      {step === 'VERIFY_PROFILE' && challengeData && (
        <div className="space-y-4">
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 text-center">
            <p className="text-xs text-zinc-400 font-medium mb-2">
              Add this 6-digit verification code to your LeetCode "About Me":
            </p>
            <div className="flex items-center justify-center gap-3 my-2">
              <span className="font-mono text-3xl font-extrabold tracking-widest text-amber-400 bg-zinc-950 px-4 py-2 rounded-lg border border-zinc-800">
                {challengeData.code}
              </span>
              <button
                type="button"
                onClick={handleCopyCode}
                className="p-2.5 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
                title="Copy verification code"
                aria-label="Copy verification code"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            {copied && (
              <p className="text-xs text-emerald-400 font-medium animate-in fade-in">
                Code copied to clipboard!
              </p>
            )}
          </div>

          <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5 space-y-2 text-xs text-zinc-300">
            <h4 className="font-semibold text-zinc-200">How to verify:</h4>
            <ol className="list-decimal list-inside space-y-1 text-zinc-400">
              <li>
                Open your{' '}
                <a
                  href="https://leetcode.com/profile/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-400 hover:underline inline-flex items-center gap-0.5 font-medium"
                >
                  LeetCode Profile Settings <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>Paste the code into the "About Me" box and save.</li>
              <li>Return here and click "Verify Profile" below.</li>
            </ol>
            <p className="text-[11px] text-zinc-500 pt-1">
              You can remove or change the code after completing registration.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setStep('USERNAME');
                setError(null);
              }}
              className="py-2.5 px-3 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 text-xs font-medium transition cursor-pointer"
            >
              Back
            </button>
            <button
              type="button"
              disabled={verifying}
              onClick={handleVerifyProfile}
              className="flex-1 py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm transition flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer shadow-sm"
            >
              {verifying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying on LeetCode...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Verify Profile</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: CREATE PASSWORD */}
      {step === 'CREATE_PASSWORD' && challengeData && (
        <form onSubmit={handleCreatePassword} className="space-y-4">
          <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-900/60 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Profile verified for @{challengeData.username}! Set your password.</span>
          </div>

          <div>
            <label
              htmlFor="reg-password"
              className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5"
            >
              Password (Minimum 12 Characters)
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
                <Lock className="w-4 h-4" />
              </div>
              <input
                id="reg-password"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={12}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 12 characters"
                className="w-full pl-9 pr-10 py-2.5 rounded-lg border border-zinc-800 bg-zinc-900/80 text-zinc-100 placeholder-zinc-500 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-500 hover:text-zinc-300 cursor-pointer"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              Length: {password.length}/12 characters {password.length >= 12 && '✓'}
            </p>
          </div>

          <div>
            <label
              htmlFor="reg-confirm-password"
              className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5"
            >
              Confirm Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
                <Lock className="w-4 h-4" />
              </div>
              <input
                id="reg-confirm-password"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={12}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-zinc-800 bg-zinc-900/80 text-zinc-100 placeholder-zinc-500 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 transition"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submittingPassword || password.length < 12}
            className="w-full py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm transition flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer shadow-sm"
          >
            {submittingPassword ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Creating Account...</span>
              </>
            ) : (
              <span>Complete Registration</span>
            )}
          </button>
        </form>
      )}

      <div className="pt-2 text-center text-xs text-zinc-400">
        Already registered?{' '}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="text-amber-400 hover:text-amber-300 font-semibold underline underline-offset-4 cursor-pointer"
        >
          Sign in here
        </button>
      </div>
    </div>
  );
};
