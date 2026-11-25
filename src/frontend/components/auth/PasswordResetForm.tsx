/** @license SPDX-License-Identifier: Apache-2.0 */
import React, { useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Copy, Loader2 } from 'lucide-react';
import { apiClient, type VerificationStartResponse } from '../../apiClient.js';

type Step = 'USERNAME' | 'VERIFY' | 'PASSWORD' | 'DONE';

export const PasswordResetForm: React.FC<{ onBackToLogin: () => void }> = ({ onBackToLogin }) => {
  const [step, setStep] = useState<Step>('USERNAME');
  const [username, setUsername] = useState('');
  const [challenge, setChallenge] = useState<VerificationStartResponse | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setBusy(false); }
  };

  return <div className="space-y-5">
    <div>
      <p className="text-sm font-semibold text-zinc-100">{step === 'DONE' ? 'Password updated' : 'Recover your account'}</p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-400">{step === 'USERNAME' && 'Prove you own your LeetCode profile to set a new password.'}{step === 'VERIFY' && 'Add this code to your LeetCode About Me, then verify it here.'}{step === 'PASSWORD' && 'Choose a new password with at least 12 characters.'}{step === 'DONE' && 'Your password is ready. Sign in with your new password.'}</p>
    </div>
    {error && <div role="alert" className="flex gap-2 rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-xs text-rose-300"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
    {step === 'USERNAME' && <form className="space-y-4" onSubmit={e => { e.preventDefault(); void run(async () => { const result = await apiClient.startPasswordReset(username.trim()); setChallenge(result); setStep('VERIFY'); }); }}>
      <label className="block text-xs font-medium text-zinc-300">LeetCode username<input required value={username} onChange={e => setUsername(e.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400" placeholder="Your username" /></label>
      <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-zinc-950 disabled:opacity-60">{busy && <Loader2 className="h-4 w-4 animate-spin"/>}Send recovery code</button>
    </form>}
    {step === 'VERIFY' && challenge && <div className="space-y-4">
      <div className="rounded-xl border border-zinc-700 bg-zinc-950 p-4"><p className="text-[11px] uppercase tracking-wider text-zinc-500">Recovery code · expires in 10 minutes</p><div className="mt-2 flex items-center justify-between"><code className="text-2xl font-semibold tracking-[0.25em] text-amber-300">{challenge.code}</code><button type="button" className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800" aria-label="Copy recovery code" onClick={() => { void navigator.clipboard.writeText(challenge.code).then(() => setCopied(true)); }}><Copy className="h-4 w-4"/></button></div>{copied && <p className="mt-2 text-xs text-emerald-400">Copied</p>}</div>
      <p className="text-xs leading-relaxed text-zinc-400">On LeetCode, open your profile settings and paste the code into the <strong className="text-zinc-200">About Me</strong> field. Save it, then verify.</p>
      <button disabled={busy} onClick={() => void run(async () => { await apiClient.verifyCode(challenge.challengeId, challenge.code); setStep('PASSWORD'); })} className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-zinc-950 disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin"/> : null}Verify profile ownership</button>
      <button onClick={() => { setStep('USERNAME'); setChallenge(null); }} className="w-full text-xs text-zinc-400 hover:text-white">Use another username</button>
    </div>}
    {step === 'PASSWORD' && challenge && <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (password !== confirm) { setError('Passwords do not match.'); return; } void run(async () => { await apiClient.completePasswordReset({ challengeId: challenge.challengeId, code: challenge.code, password }); setStep('DONE'); }); }}>
      <label className="block text-xs font-medium text-zinc-300">New password<input required minLength={12} autoComplete="new-password" type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400" /></label>
      <label className="block text-xs font-medium text-zinc-300">Confirm new password<input required minLength={12} autoComplete="new-password" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400" /></label>
      <button disabled={busy} className="w-full rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-zinc-950 disabled:opacity-60">{busy ? 'Updating…' : 'Set new password'}</button>
    </form>}
    {step === 'DONE' && <div className="rounded-xl border border-emerald-900 bg-emerald-950/30 p-4 text-sm text-emerald-300"><CheckCircle2 className="mb-2 h-5 w-5"/>All existing sessions were signed out for security.</div>}
    <button type="button" onClick={onBackToLogin} className="flex items-center gap-2 text-xs font-medium text-zinc-400 hover:text-amber-300"><ArrowLeft className="h-3.5 w-3.5"/>Back to sign in</button>
  </div>;
};
