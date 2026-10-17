/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import {
  InvalidUsernameError,
  PrivateOrEmptyProfileError,
  RateLimitedError,
  UpstreamSchemaChangedError,
  NetworkError,
  type Difficulty,
} from '../../domain/index.js';
import type { HttpClient, HttpResponse } from '../httpClient.js';

export const LEETCODE_GRAPHQL_ENDPOINT = 'https://leetcode.com/graphql';

/* -------------------------------------------------------------------------- */
/* GRAPHQL QUERY STRINGS (ALL ISOLATED IN THIS FILE)                          */
/* -------------------------------------------------------------------------- */

export const RECENT_AC_SUBMISSIONS_QUERY = `
query recentAcSubmissions($username: String!, $limit: Int!) {
  matchedUser(username: $username) {
    username
  }
  recentAcSubmissionList(username: $username, limit: $limit) {
    id
    title
    titleSlug
    timestamp
  }
}
`;

export const QUESTION_DETAILS_QUERY = `
query questionDifficulty($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    title
    titleSlug
    difficulty
  }
}
`;

/* -------------------------------------------------------------------------- */
/* UPSTREAM ZOD RESPONSE SCHEMAS                                              */
/* -------------------------------------------------------------------------- */

export const LeetCodeSubmissionItemSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  titleSlug: z.string().min(1),
  timestamp: z.union([z.string(), z.number()]),
});

export type LeetCodeSubmissionItem = z.infer<typeof LeetCodeSubmissionItemSchema>;

export const RecentAcResponseSchema = z.object({
  data: z
    .object({
      matchedUser: z
        .object({
          username: z.string(),
        })
        .nullable()
        .optional(),
      recentAcSubmissionList: z.array(LeetCodeSubmissionItemSchema).nullable().optional(),
    })
    .nullable()
    .optional(),
  errors: z
    .array(
      z.object({
        message: z.string(),
      })
    )
    .optional(),
});

export const QuestionDetailsResponseSchema = z.object({
  data: z
    .object({
      question: z
        .object({
          questionId: z.string().optional(),
          title: z.string(),
          titleSlug: z.string(),
          difficulty: z.enum(['Easy', 'Medium', 'Hard']),
        })
        .nullable(),
    })
    .nullable(),
  errors: z
    .array(
      z.object({
        message: z.string(),
      })
    )
    .optional(),
});

/* -------------------------------------------------------------------------- */
/* GRAPHQL CLIENT METHODS AND ERROR MAPPING                                  */
/* -------------------------------------------------------------------------- */

export async function fetchLeetCodeSubmissionsGql(
  client: HttpClient,
  username: string,
  limit = 50,
  endpoint = LEETCODE_GRAPHQL_ENDPOINT
): Promise<LeetCodeSubmissionItem[]> {
  let response: HttpResponse<unknown>;

  try {
    response = await client.post(
      endpoint,
      {
        query: RECENT_AC_SUBMISSIONS_QUERY,
        variables: { username, limit },
      },
      {
        headers: {
          Referer: `https://leetcode.com/${encodeURIComponent(username)}/`,
        },
      }
    );
  } catch (err: unknown) {
    if (err instanceof RateLimitedError || err instanceof NetworkError) {
      throw err;
    }
    throw new NetworkError(`Failed to reach LeetCode GraphQL endpoint: ${err instanceof Error ? err.message : String(err)}`, err);
  }

  if (response.status === 429) {
    throw new RateLimitedError('LeetCode rate limit exceeded. Please wait a moment and retry.');
  }

  if (response.status >= 500) {
    throw new NetworkError(`LeetCode server returned HTTP ${response.status}.`, { status: response.status });
  }

  // Validate response shape strictly with Zod
  const parseResult = RecentAcResponseSchema.safeParse(response.data);
  if (!parseResult.success) {
    throw new UpstreamSchemaChangedError(
      'LeetCode GraphQL recentAcSubmissionList response schema changed or is malformed.',
      parseResult.error.format()
    );
  }

  const { data, errors } = parseResult.data;

  // Check for GraphQL user errors
  if (errors && errors.length > 0) {
    const errorMsg = errors.map((e) => e.message).join('; ');
    if (/user does not exist|not found|invalid user/i.test(errorMsg)) {
      throw new InvalidUsernameError(username);
    }
  }

  // If matchedUser is null or missing, user does not exist
  if (!data || data.matchedUser === null) {
    throw new InvalidUsernameError(username);
  }

  // Check submissions list
  const submissions = data.recentAcSubmissionList;
  if (!submissions || submissions.length === 0) {
    throw new PrivateOrEmptyProfileError(username);
  }

  return submissions;
}

export async function fetchLeetCodeQuestionGql(
  client: HttpClient,
  slug: string,
  endpoint = LEETCODE_GRAPHQL_ENDPOINT
): Promise<{ title: string; difficulty: Difficulty } | null> {
  let response: HttpResponse<unknown>;

  try {
    response = await client.post(
      endpoint,
      {
        query: QUESTION_DETAILS_QUERY,
        variables: { titleSlug: slug },
      },
      {
        headers: {
          Referer: `https://leetcode.com/problems/${encodeURIComponent(slug)}/`,
        },
      }
    );
  } catch (err: unknown) {
    if (err instanceof RateLimitedError || err instanceof NetworkError) {
      throw err;
    }
    throw new NetworkError(`Failed to fetch question details: ${err instanceof Error ? err.message : String(err)}`, err);
  }

  if (response.status === 429) {
    throw new RateLimitedError('LeetCode rate limit exceeded. Please wait a moment and retry.');
  }

  const parseResult = QuestionDetailsResponseSchema.safeParse(response.data);
  if (!parseResult.success) {
    throw new UpstreamSchemaChangedError(
      'LeetCode GraphQL question lookup response schema changed or is malformed.',
      parseResult.error.format()
    );
  }

  const question = parseResult.data.data?.question;
  if (!question) {
    return null;
  }

  return {
    title: question.title,
    difficulty: question.difficulty as Difficulty,
  };
}
