/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  PLATFORMS,
  type Difficulty,
  type SolvedProblem,
} from '../../domain/index.js';
import type { HttpClient } from '../httpClient.js';
import type { ProblemSource, QuestionMetadata } from '../problemSource.js';
import {
  fetchLeetCodeSubmissionsGql,
  fetchLeetCodeQuestionGql,
  LEETCODE_GRAPHQL_ENDPOINT,
} from './leetcodeGql.js';

export class LeetCodeProblemSource implements ProblemSource {
  public readonly platform = PLATFORMS.LEETCODE;
  private readonly questionCache = new Map<string, QuestionMetadata>();

  constructor(
    private readonly httpClient: HttpClient,
    private readonly endpoint: string = LEETCODE_GRAPHQL_ENDPOINT
  ) {}

  public async fetchSolved(username: string): Promise<SolvedProblem[]> {
    const rawSubmissions = await fetchLeetCodeSubmissionsGql(
      this.httpClient,
      username,
      100,
      this.endpoint
    );

    // Group submissions by titleSlug and keep the latest solvedAt consistently
    const latestBySlug = new Map<
      string,
      { title: string; slug: string; timestampNum: number }
    >();

    for (const sub of rawSubmissions) {
      const slug = sub.titleSlug.trim().toLowerCase();
      const tsNum = typeof sub.timestamp === 'string' ? Number(sub.timestamp) : sub.timestamp;

      const existing = latestBySlug.get(slug);
      if (!existing || tsNum > existing.timestampNum) {
        latestBySlug.set(slug, {
          title: sub.title,
          slug,
          timestampNum: tsNum,
        });
      }
    }

    // Resolve difficulty for each unique slug with bounded concurrency (3 at a time)
    const uniqueEntries = Array.from(latestBySlug.entries());

    const resolveMetadata = async (
      entry: [string, { title: string; slug: string; timestampNum: number }]
    ): Promise<SolvedProblem> => {
      const [slug, item] = entry;
      let metadata = this.questionCache.get(slug);

      if (!metadata) {
        const fetched = await fetchLeetCodeQuestionGql(this.httpClient, slug, this.endpoint);
        if (fetched) {
          metadata = fetched;
          this.questionCache.set(slug, fetched);
        } else {
          metadata = {
            title: item.title,
            difficulty: 'Medium' as Difficulty,
          };
        }
      }

      const solvedAt = new Date(item.timestampNum * 1000).toISOString();
      const url = `https://leetcode.com/problems/${slug}/`;

      return {
        platform: PLATFORMS.LEETCODE,
        slug,
        title: metadata.title || item.title,
        difficulty: metadata.difficulty,
        url,
        solvedAt,
      };
    };

    // Concurrency limit: 3 concurrent requests
    const CONCURRENCY_LIMIT = 3;
    const results: SolvedProblem[] = new Array(uniqueEntries.length);
    let nextIndex = 0;

    const workers = Array.from(
      { length: Math.min(CONCURRENCY_LIMIT, uniqueEntries.length) },
      async () => {
        while (nextIndex < uniqueEntries.length) {
          const currentIndex = nextIndex++;
          results[currentIndex] = await resolveMetadata(uniqueEntries[currentIndex]);
        }
      }
    );

    await Promise.all(workers);
    return results;
  }

  public async lookupProblem(slug: string): Promise<QuestionMetadata | null> {
    const cached = this.questionCache.get(slug);
    if (cached) {
      return cached;
    }

    const fetched = await fetchLeetCodeQuestionGql(this.httpClient, slug, this.endpoint);
    if (fetched) {
      this.questionCache.set(slug, fetched);
    }
    return fetched;
  }
}
