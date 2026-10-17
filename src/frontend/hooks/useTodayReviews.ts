/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import type { TodayReviewsResponse } from '../apiClient.js';
import { apiClient } from '../apiClient.js';

export function useTodayReviews() {
  const [data, setData] = useState<TodayReviewsResponse>({ today: '', count: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchToday = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.getTodayReviews();
      setData(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch reviews.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchToday();
  }, [fetchToday]);

  return {
    today: data.today,
    count: data.count,
    items: data.items,
    loading,
    error,
    refresh: fetchToday,
  };
}
