/**
 * core/remote.ts — parse a git remote URL into "owner/repo".
 *
 * Pure: string in, string|null out. Used by `vizzy --check` to infer the repo
 * from the cwd's `origin` remote when no explicit owner/repo is given.
 */

/**
 * Extract "owner/repo" from an SSH or HTTPS GitHub remote URL.
 *
 * Repo names frequently contain dots (every `*.github.io` Pages repo,
 * `react.dev`, `my.app`), so the repo segment is captured non-greedily as a
 * run of non-slash characters and only a single trailing `.git` is stripped.
 *
 * @returns "owner/repo", or null if the URL doesn't look like a GitHub remote.
 */
export function parseRemote(remote: string): string | null {
  const ssh = remote.match(/^git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/);
  const https = remote.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  const m = ssh ?? https;
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}
