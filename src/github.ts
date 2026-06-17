import { Octokit } from '@octokit/rest';
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
  };
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

export async function setVisibility(
  octokit: Octokit,
  owner: string,
  repo: string,
  visibility: Visibility,
): Promise<void> {
  // Prefer the `visibility` string over the legacy `private` boolean.
  await octokit.rest.repos.update({ owner, repo, visibility });
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
