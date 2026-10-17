/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import type { ProblemAggregate } from '../../domain/index.js';
import { apiClient } from '../apiClient.js';

export function useSettings() {
  const [username, setUsernameState] = useState<string>('');
  const [deletedProblems, setDeletedProblems] = useState<ProblemAggregate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const fetchSettingsData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [user, deleted] = await Promise.all([
        apiClient.getUsername(),
        apiClient.getDeletedProblems(),
      ]);
      setUsernameState(user || '');
      setDeletedProblems(deleted);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettingsData();
  }, [fetchSettingsData]);

  const saveUsername = async (newUsername: string) => {
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      await apiClient.setUsername(newUsername.trim());
      setUsernameState(newUsername.trim());
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save username.');
    } finally {
      setSaving(false);
    }
  };

  const restoreProblem = async (id: string) => {
    try {
      await apiClient.restore(id);
      await fetchSettingsData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to restore problem.');
    }
  };

  const permanentDeleteProblem = async (id: string) => {
    try {
      await apiClient.permanentDelete(id);
      await fetchSettingsData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to permanently delete problem.');
    }
  };

  return {
    username,
    setUsernameState,
    deletedProblems,
    loading,
    saving,
    error,
    saveSuccess,
    saveUsername,
    restoreProblem,
    permanentDeleteProblem,
    refresh: fetchSettingsData,
  };
}
