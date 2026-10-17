/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ValidationError } from '../../domain/index.js';

export function slugToTitle(slug: string): string {
  return slug
    .split(/[-_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export interface ParsedProblemIdentifier {
  readonly slug: string;
  readonly canonicalUrl: string;
}

/**
 * Parses a LeetCode problem URL or slug.
 * Accepts:
 * - Plain slugs: e.g. "two-sum", "reverse-linked-list"
 * - Full URLs with trailing slashes, /description/ subpaths, query strings, and mixed-case domains:
 *   e.g. "https://LEETCODE.COM/problems/two-sum/description/?envType=study-plan-v2"
 * Rejects non-LeetCode URLs with a typed ValidationError.
 */
export function parseLeetCodeInput(input: string): ParsedProblemIdentifier {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ValidationError('Problem URL or slug cannot be empty.');
  }

  // Check if it's a URL
  if (/^https?:\/\//i.test(trimmed)) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      throw new ValidationError(`Malformed URL: "${trimmed}".`);
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    const isLeetCode =
      hostname === 'leetcode.com' ||
      hostname === 'www.leetcode.com' ||
      hostname === 'leetcode.cn' ||
      hostname === 'www.leetcode.cn';

    if (!isLeetCode) {
      throw new ValidationError(
        `Invalid URL domain "${parsedUrl.hostname}". Only LeetCode URLs are supported in V1.`
      );
    }

    // Pathname typically looks like: /problems/{slug}/ or /problems/{slug}/description/
    const parts = parsedUrl.pathname.split('/').filter(Boolean);
    const problemsIndex = parts.findIndex((part) => part.toLowerCase() === 'problems');

    if (problemsIndex === -1 || problemsIndex + 1 >= parts.length) {
      throw new ValidationError(
        `Could not extract problem slug from LeetCode URL "${trimmed}". Expected /problems/{slug}/.`
      );
    }

    const slug = parts[problemsIndex + 1].toLowerCase();
    if (!slug) {
      throw new ValidationError(`Invalid slug extracted from URL "${trimmed}".`);
    }

    return {
      slug,
      canonicalUrl: `https://leetcode.com/problems/${slug}/`,
    };
  }

  // Otherwise treat as plain slug
  // Validate slug characters: alphanumeric, hyphens, underscores
  const cleanSlug = trimmed.toLowerCase();
  if (!/^[a-z0-9-_]+$/.test(cleanSlug)) {
    throw new ValidationError(
      `Invalid problem slug: "${trimmed}". Slugs must contain only alphanumeric characters and hyphens.`
    );
  }

  return {
    slug: cleanSlug,
    canonicalUrl: `https://leetcode.com/problems/${cleanSlug}/`,
  };
}
