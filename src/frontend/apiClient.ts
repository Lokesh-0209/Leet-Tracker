/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AppError,
  ERROR_CODES,
  type Problem,
  type ProblemAggregate,
  type ProblemStatus,
  type Difficulty,
  type ReviewStage,
  type Approach,
  type ErrorCode,
} from '../domain/index.js';
import type { SyncResult } from '../services/syncService.js';
import type { ManualAddInput } from '../services/problemService.js';

export interface TodayReviewsResponse {
  readonly today: string;
  readonly count: number;
  readonly items: readonly { readonly problem: Problem; readonly review: { readonly problemId: string; readonly stage: ReviewStage; readonly dueDate: string; readonly completedAt: string | null } }[];
}

export class ApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  public get timeZone(): string {
    return this.getTimeZone();
  }

  public getTimeZone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(options.headers || {});
    headers.set('X-Timezone', this.getTimeZone());

    if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers,
      });
    } catch (err: unknown) {
      throw new AppError({
        code: ERROR_CODES.NETWORK_ERROR,
        message: err instanceof Error ? err.message : 'Network request failed.',
        retryable: true,
      });
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = null;
    }

    if (!response.ok) {
      if (json && typeof json === 'object' && 'code' in json && 'message' in json) {
        const errObj = json as { code: ErrorCode; message: string; retryable?: boolean; details?: unknown };
        throw new AppError({
          code: errObj.code,
          message: errObj.message,
          retryable: errObj.retryable ?? false,
          details: errObj.details,
        });
      }

      throw new AppError({
        code: ERROR_CODES.NETWORK_ERROR,
        message: `HTTP ${response.status}: ${response.statusText}`,
        retryable: response.status >= 500,
      });
    }

    return json as T;
  }

  public async getProblems(filter?: {
    status?: ProblemStatus;
    difficulty?: Difficulty;
    q?: string;
  }): Promise<ProblemAggregate[]> {
    const params = new URLSearchParams();
    if (filter?.status) params.set('status', filter.status);
    if (filter?.difficulty) params.set('difficulty', filter.difficulty);
    if (filter?.q) params.set('q', filter.q);

    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await this.request<{ problems: ProblemAggregate[] }>(`/problems${query}`);
    return res.problems;
  }

  public async getDeletedProblems(): Promise<ProblemAggregate[]> {
    const res = await this.request<{ problems: ProblemAggregate[] }>('/problems/deleted');
    return res.problems;
  }

  public async getProblem(id: string): Promise<ProblemAggregate> {
    return this.request<ProblemAggregate>(`/problems/${id}`);
  }

  public async manualAddProblem(input: ManualAddInput): Promise<ProblemAggregate> {
    return this.request<ProblemAggregate>('/problems/manual', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  public async syncLeetCode(username?: string): Promise<SyncResult> {
    return this.request<SyncResult>('/problems/sync', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
  }

  public async getTodayReviews(): Promise<TodayReviewsResponse> {
    return this.request<TodayReviewsResponse>('/reviews/today');
  }

  public async saveNote(problemId: string, approaches: readonly Approach[]): Promise<ProblemAggregate> {
    return this.request<ProblemAggregate>(`/problems/${problemId}/note`, {
      method: 'POST',
      body: JSON.stringify({ approaches }),
    });
  }

  public async completeReview(problemId: string, stage: ReviewStage): Promise<ProblemAggregate> {
    return this.request<ProblemAggregate>(`/problems/${problemId}/reviews/${stage}/complete`, {
      method: 'POST',
    });
  }

  public async undoReview(problemId: string, stage: ReviewStage): Promise<ProblemAggregate> {
    return this.request<ProblemAggregate>(`/problems/${problemId}/reviews/${stage}/undo`, {
      method: 'POST',
    });
  }

  public async softDelete(problemId: string): Promise<void> {
    await this.request<{ success: boolean; id: string }>(`/problems/${problemId}`, {
      method: 'DELETE',
    });
  }

  public async restore(problemId: string): Promise<void> {
    await this.request<{ success: boolean }>(`/problems/${problemId}/restore`, {
      method: 'POST',
    });
  }

  public async permanentDelete(problemId: string): Promise<void> {
    await this.request<{ success: boolean; id: string }>(`/problems/${problemId}/permanent`, {
      method: 'DELETE',
    });
  }

  public async getUsername(): Promise<string | null> {
    const res = await this.request<{ username: string | null }>('/settings/username');
    return res.username;
  }

  public async setUsername(username: string): Promise<void> {
    await this.request<{ username: string }>('/settings/username', {
      method: 'PUT',
      body: JSON.stringify({ leetcodeUsername: username }),
    });
  }

  public async exportBackup(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/backup');
  }

  public async restoreBackup(data: unknown): Promise<{ ok: boolean; restoredCount: number }> {
    return this.request<{ ok: boolean; restoredCount: number }>('/backup/restore', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
}

export const apiClient = new ApiClient();
