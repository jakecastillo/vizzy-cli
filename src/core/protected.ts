/**
 * .vizzyignore loader and glob matcher (pure, no I/O).
 *
 * The caller is responsible for reading the file text from disk.
 * Glob support: '*' (any sequence) and '?' (exactly one character).
 * Matching is against the repo NAME only.
 */

import type { Repo } from '../types.js';

// ---------------------------------------------------------------------------
// loadProtected — parse .vizzyignore file text
// ---------------------------------------------------------------------------

/**
 * Parse a .vizzyignore file's text content into a list of glob patterns.
 *
 * - Trims each line.
 * - Drops blank lines.
 * - Drops lines whose trimmed form starts with '#' (comments).
 */
export function loadProtected(fileText: string): string[] {
  return fileText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

// ---------------------------------------------------------------------------
// isProtected — glob match (supports * and ?)
// ---------------------------------------------------------------------------

/**
 * Return true if `repoName` matches any of the glob `patterns`.
 *
 * Supported wildcards:
 *   - `*`  matches any sequence of characters (including empty).
 *   - `?`  matches exactly one character.
 *
 * Matching is case-sensitive and against the repo name only.
 */
export function isProtected(repoName: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globMatch(pattern, repoName));
}

/**
 * Match a single glob pattern against a string.
 * Only `*` and `?` are treated as wildcards; all other characters are literal.
 */
function globMatch(pattern: string, str: string): boolean {
  // Convert the glob pattern to a RegExp.
  // Escape all regex special chars except * and ?, then replace them.
  const regexSource = pattern
    .split('')
    .map((ch) => {
      if (ch === '*') return '.*';
      if (ch === '?') return '.';
      // Escape characters that are special in RegExp
      return ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    })
    .join('');

  const re = new RegExp(`^${regexSource}$`);
  return re.test(str);
}

// ---------------------------------------------------------------------------
// partitionProtected — split repos into allowed vs. protected
// ---------------------------------------------------------------------------

/**
 * Partition `repos` into two groups:
 *   - `allowed`      — repos whose names do NOT match any pattern.
 *   - `protectedOut` — repos whose names match at least one pattern.
 *
 * Order within each group is stable (preserves original array order).
 */
export function partitionProtected(
  repos: Repo[],
  patterns: string[],
): { allowed: Repo[]; protectedOut: Repo[] } {
  const allowed: Repo[] = [];
  const protectedOut: Repo[] = [];

  for (const r of repos) {
    if (isProtected(r.name, patterns)) {
      protectedOut.push(r);
    } else {
      allowed.push(r);
    }
  }

  return { allowed, protectedOut };
}
