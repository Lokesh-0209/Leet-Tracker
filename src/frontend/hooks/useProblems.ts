/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import type { ProblemAggregate, ProblemStatus, Difficulty } from '../../domain/index.js';
import { apiClient } from '../apiClient.js';

export function useProblems(tab: 'INBOX' | 'ACTIVE' | 'FULLY_SOLVED' | 'TODAY') {
  const [problems, setProblems] = useState<ProblemAggregate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty | 'ALL'>('ALL');

  const fetchProblems = useCallback(async () => {
    if (tab === 'TODAY') {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getProblems({
        status: tab as ProblemStatus,
        difficulty: difficulty === 'ALL' ? undefined : difficulty,
        q: search.trim() ? search.trim() : undefined,
      });
      setProblems(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load problems.');
    } finally {
      setLoading(false);
    }
  }, [tab, search, difficulty]);

  useEffect(() => {
    fetchProblems();
  }, [fetchProblems]);

  return {
    problems,
    loading,
    error,
    search,
    setSearch,
    difficulty,
    setDifficulty,
    refresh: fetchProblems,
  };
}
