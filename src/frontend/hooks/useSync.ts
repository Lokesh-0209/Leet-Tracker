/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from 'react';
import type { SyncResult } from '../../services/syncService.js';
import { AppError, type ErrorCode } from '../../domain/index.js';
import { apiClient } from '../apiClient.js';

export interface SyncErrorState {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export function useSync(onSuccess?: () => void) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<SyncErrorState | null>(null);

  const sync = useCallback(
    async (username?: string) => {
      setSyncing(true);
      setError(null);
      setResult(null);

      try {
        const res = await apiClient.syncLeetCode(username);
        setResult(res);
        if (onSuccess) {
          onSuccess();
        }
      } catch (err: unknown) {
        if (err instanceof AppError) {
          setError({
            code: err.code,
            message: err.message,
            retryable: err.retryable,
          });
        } else {
          setError({
            code: 'NETWORK_ERROR',
            message: err instanceof Error ? err.message : 'Sync failed.',
            retryable: true,
          });
        }
      } finally {
        setSyncing(false);
      }
    },
    [onSuccess]
  );

  const clearResult = () => setResult(null);
  const clearError = () => setError(null);

  return {
    syncing,
    result,
    error,
    sync,
    clearResult,
    clearError,
  };
}
