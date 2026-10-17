/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { NetworkError } from '../domain/errors.js';

export interface HttpRequestOptions {
  readonly headers?: Record<string, string>;
  readonly timeoutMs?: number;
}

export interface HttpResponse<T = unknown> {
  readonly status: number;
  readonly data: T;
  readonly headers: Record<string, string>;
}

export interface HttpClient {
  post<T = unknown>(url: string, body: unknown, options?: HttpRequestOptions): Promise<HttpResponse<T>>;
  get<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>;
}

/**
 * Production HttpClient implementation wrapping global fetch with configurable timeouts.
 */
export class FetchHttpClient implements HttpClient {
  constructor(private readonly defaultTimeoutMs: number = 10000) {}

  public async post<T = unknown>(
    url: string,
    body: unknown,
    options: HttpRequestOptions = {}
  ): Promise<HttpResponse<T>> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          ...(options.headers || {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((val, key) => {
        responseHeaders[key.toLowerCase()] = val;
      });

      const data = (await response.json()) as T;
      return {
        status: response.status,
        data,
        headers: responseHeaders,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new NetworkError(`Request to ${url} timed out after ${timeoutMs}ms.`, { timeoutMs });
      }
      throw new NetworkError(`Network request failed: ${err instanceof Error ? err.message : String(err)}`, err);
    } finally {
      clearTimeout(timer);
    }
  }

  public async get<T = unknown>(
    url: string,
    options: HttpRequestOptions = {}
  ): Promise<HttpResponse<T>> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((val, key) => {
        responseHeaders[key.toLowerCase()] = val;
      });

      const data = (await response.json()) as T;
      return {
        status: response.status,
        data,
        headers: responseHeaders,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new NetworkError(`Request to ${url} timed out after ${timeoutMs}ms.`, { timeoutMs });
      }
      throw new NetworkError(`Network request failed: ${err instanceof Error ? err.message : String(err)}`, err);
    } finally {
      clearTimeout(timer);
    }
  }
}
