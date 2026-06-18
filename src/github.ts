import { Octokit } from '@octokit/rest';
import pLimit from 'p-limit';
import type { Repo, Visibility, VisibilitySetter } from './types.js';

export function makeOctokit(token: string): Octokit {
  return new Octokit({ auth: token, userAgent: 'vizzy-cli' });
}

/** The subset of GET /user/repos fields vizzy reads. */
export interface RawRepo {
  name: string;
  owner: { login: string };
  private: boolean;
  fork: boolean;
  archived: boolean;
  stargazers_count: number;
  pushed_at: string | null;
  default_branch: string;
  license: { spdx_id: string | null } | null;
}

export function normalizeRepo(raw: RawRepo): Repo {
  return {
    name: raw.name,
    owner: raw.owner.login,
    visibility: raw.private ? 'private' : 'public',
    isFork: raw.fork,
    isArchived: raw.archived,
    stars: raw.stargazers_count,
    pushedAt: raw.pushed_at ?? '1970-01-01T00:00:00Z',
    defaultBranch: raw.default_branch ?? 'HEAD',
    license: raw.license?.spdx_id ?? null,
  };
}

export async function listRepoTree(
  octokit: Pick<Octokit, 'rest'>,
  owner: string,
  repo: string,
  ref: string,
): Promise<{ paths: string[]; truncated: boolean }> {
  try {
    const { data } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: ref,
      recursive: '1',
    });
    const paths = data.tree
      .filter((item) => item.type === 'blob')
      .map((item) => item.path!)
      .filter((p): p is string => typeof p === 'string');
    return { paths, truncated: data.truncated ?? false };
  } catch (err) {
    const httpErr = asHttpError(err);
    // 409 = the repo is genuinely EMPTY (no commits) → nothing to expose, a real
    // all-clear. A 404 means the ref/tree was NOT found (a stale or wrong default
    // branch, or no access) — we did NOT actually scan the repo, so it must
    // propagate and become a scan-incomplete (caution) upstream, never a silent
    // all-clear. Same for every other status.
    if (httpErr && httpErr.status === 409) {
      return { paths: [], truncated: false };
    }
    throw err;
  }
}

export async function listOwnerRepos(
  octokit: Pick<Octokit, 'paginate' | 'rest'>,
): Promise<Repo[]> {
  // affiliation:'owner' restricts to repos owned by the authed user.
  // Do NOT also pass `type` — GitHub 422s if type is sent with affiliation.
  const raw = (await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
    affiliation: 'owner',
    visibility: 'all',
    per_page: 100,
  })) as RawRepo[];
  return raw.map(normalizeRepo);
}

/**
 * List all repos for a GitHub organization via GET /orgs/{org}/repos.
 *
 * Equivalent to listOwnerRepos but scoped to an org. Only usable on the
 * read-only audit path — write paths stay personal-only.
 *
 * @param octokit - Octokit instance (or compatible subset with paginate + rest).
 * @param org     - GitHub organization login.
 * @returns       - Normalized Repo array.
 */
export async function listOrgRepos(
  octokit: Pick<Octokit, 'paginate' | 'rest'>,
  org: string,
): Promise<Repo[]> {
  const raw = (await octokit.paginate(octokit.rest.repos.listForOrg, {
    org,
    type: 'all',
    per_page: 100,
  })) as RawRepo[];
  return raw.map(normalizeRepo);
}

export async function setVisibility(
  octokit: Octokit,
  owner: string,
  repo: string,
  visibility: Visibility,
): Promise<void> {
  // Prefer the `visibility` string over the legacy `private` boolean.
  await octokit.rest.repos.update({ owner, repo, visibility });
}

/**
 * Archive or unarchive a repository via PATCH /repos/{owner}/{repo}.
 *
 * Passing `archived: true` archives the repo (makes it read-only).
 * Passing `archived: false` unarchives it (restores write access).
 * Archiving is reversible and non-exposing — no exposure scan needed.
 */
export async function setArchived(
  octokit: Octokit,
  owner: string,
  repo: string,
  archived: boolean,
): Promise<void> {
  await octokit.rest.repos.update({ owner, repo, archived });
}

interface HttpError {
  status: number;
  message: string;
  response?: { headers: Record<string, string | undefined> };
}

/** Duck-type an Octokit RequestError without relying on `instanceof`. */
function asHttpError(err: unknown): HttpError | null {
  if (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { status?: unknown }).status === 'number'
  ) {
    return err as HttpError;
  }
  return null;
}

export function explainError(err: unknown): string {
  // Duck-type rather than `instanceof RequestError`: a bundled/duplicate copy of
  // @octokit/request-error would defeat instanceof and drop the helpful message.
  const httpErr = asHttpError(err);
  if (httpErr) {
    const remaining = httpErr.response?.headers['x-ratelimit-remaining'];
    const reset = httpErr.response?.headers['x-ratelimit-reset'];
    if ((httpErr.status === 403 || httpErr.status === 429) && remaining === '0') {
      const resetMs = Number(reset) * 1000; // header is epoch SECONDS
      const when = Number.isFinite(resetMs)
        ? new Date(resetMs).toLocaleTimeString()
        : 'soon';
      return `Rate limited. Try again after ${when}.`;
    }
    if (httpErr.status === 403) {
      return 'Permission denied (403). Your token likely lacks the `repo` scope (classic PAT) or Administration:write (fine-grained PAT).';
    }
    if (httpErr.status === 404) {
      return 'Repository not found or not accessible with this token (404).';
    }
    if (httpErr.status === 422) {
      return `GitHub rejected the request (422): ${httpErr.message}`;
    }
    return `GitHub error ${httpErr.status}: ${httpErr.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export function makeSetter(octokit: Octokit): VisibilitySetter {
  return async (owner, repo, visibility) => {
    try {
      await setVisibility(octokit, owner, repo, visibility);
    } catch (err) {
      throw new Error(explainError(err));
    }
  };
}

/**
 * Fetch the text content of a blob by its SHA.
 *
 * GitHub's Blobs API returns content as base64 (with possible embedded newlines).
 * Errors propagate to the caller — they should become scan-incomplete upstream.
 *
 * @param octokit - Octokit instance (or compatible subset).
 * @param owner   - Repository owner.
 * @param repo    - Repository name.
 * @param sha     - Blob SHA.
 * @returns       - Decoded UTF-8 text content.
 */
export async function getBlobText(
  octokit: Pick<Octokit, 'rest'>,
  owner: string,
  repo: string,
  sha: string,
): Promise<string> {
  const { data } = await octokit.rest.git.getBlob({ owner, repo, file_sha: sha });
  // GitHub wraps base64 at 60 characters with \n — strip all whitespace before decoding.
  const clean = (data.content as string).replace(/\s/g, '');
  return Buffer.from(clean, 'base64').toString('utf8');
}

/**
 * Walk recent commits' changed files to collect the set of all filenames that
 * have ever appeared in the recent history of a repository.
 *
 * Uses the List commits API (GET /repos/{owner}/{repo}/commits) with per_page
 * set to maxCommits. Each commit's `files` array is flattened into a deduplicated
 * set of paths.
 *
 * `truncated` is true when the API returned exactly maxCommits results, indicating
 * there may be more history that was not examined.
 *
 * Errors propagate — callers should treat them as scan-incomplete.
 *
 * @param octokit    - Octokit instance (or compatible subset).
 * @param owner      - Repository owner.
 * @param repo       - Repository name.
 * @param maxCommits - Maximum number of commits to inspect (default 100).
 * @returns          - Deduplicated file paths seen across recent commits, and a
 *                     truncated flag indicating whether the history window was capped.
 */
export async function listHistoryFilenames(
  octokit: Pick<Octokit, 'rest'>,
  owner: string,
  repo: string,
  maxCommits = 100,
): Promise<{ paths: string[]; truncated: boolean }> {
  // listCommits returns commit SUMMARIES with no `files` field — the changed
  // files live only on the single-commit endpoint. So we fetch each commit
  // (bounded by maxCommits) via getCommit, with bounded concurrency.
  const { data: commits } = await octokit.rest.repos.listCommits({
    owner,
    repo,
    per_page: maxCommits,
  });

  const limit = pLimit(5);
  const perCommit = await Promise.all(
    commits.map((c) =>
      limit(async () => {
        const { data: full } = await octokit.rest.repos.getCommit({
          owner,
          repo,
          ref: c.sha,
        });
        return (full.files ?? [])
          .map((f) => f.filename)
          .filter((n): n is string => typeof n === 'string');
      }),
    ),
  );

  const seen = new Set<string>(perCommit.flat());
  return {
    paths: [...seen],
    truncated: commits.length >= maxCommits,
  };
}
