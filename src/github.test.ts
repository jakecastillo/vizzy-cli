import { describe, it, expect, vi } from 'vitest';
import { RequestError } from '@octokit/request-error';
import {
  normalizeRepo,
  listOwnerRepos,
  listRepoTree,
  setVisibility,
  explainError,
  makeSetter,
  type RawRepo,
} from './github.js';

const raw = (over: Partial<RawRepo> = {}): RawRepo => ({
  name: 'r',
  owner: { login: 'me' },
  private: false,
  fork: false,
  archived: false,
  stargazers_count: 3,
  pushed_at: '2024-01-01T00:00:00Z',
  default_branch: 'main',
  license: { spdx_id: 'MIT' },
  ...over,
});

const reqError = (status: number, headers: Record<string, string> = {}) =>
  new RequestError('boom', status, {
    request: { method: 'PATCH', url: 'x', headers: {} },
    response: { status, url: 'x', headers, data: {} },
  } as never);

describe('normalizeRepo', () => {
  it('derives visibility from the private boolean', () => {
    expect(normalizeRepo(raw({ private: true })).visibility).toBe('private');
    expect(normalizeRepo(raw({ private: false })).visibility).toBe('public');
  });

  it('maps fields and tolerates a null pushed_at', () => {
    const r = normalizeRepo(raw({ name: 'x', fork: true, pushed_at: null, stargazers_count: 9 }));
    expect(r).toMatchObject({ name: 'x', owner: 'me', isFork: true, stars: 9 });
    expect(typeof r.pushedAt).toBe('string');
  });

  it('maps defaultBranch from default_branch', () => {
    expect(normalizeRepo(raw({ default_branch: 'trunk' })).defaultBranch).toBe('trunk');
  });

  it('falls back defaultBranch to HEAD when default_branch is absent', () => {
    const r = raw();
    // Simulate absence by casting to unknown
    const rawNoDefault = { ...r, default_branch: undefined } as unknown as RawRepo;
    expect(normalizeRepo(rawNoDefault).defaultBranch).toBe('HEAD');
  });

  it('maps license spdx_id to license string', () => {
    expect(normalizeRepo(raw({ license: { spdx_id: 'Apache-2.0' } })).license).toBe('Apache-2.0');
  });

  it('maps null spdx_id to null license', () => {
    expect(normalizeRepo(raw({ license: { spdx_id: null } })).license).toBeNull();
  });

  it('maps absent license to null', () => {
    expect(normalizeRepo(raw({ license: null })).license).toBeNull();
  });
});

describe('listOwnerRepos', () => {
  it('paginates owner repos and normalizes them', async () => {
    const paginate = vi.fn().mockResolvedValue([raw({ name: 'a' }), raw({ name: 'b', private: true })]);
    const octokit = { paginate, rest: { repos: { listForAuthenticatedUser: {} } } };
    const repos = await listOwnerRepos(octokit as never);
    expect(repos.map((r) => r.name)).toEqual(['a', 'b']);
    expect(paginate).toHaveBeenCalledWith(
      octokit.rest.repos.listForAuthenticatedUser,
      { affiliation: 'owner', visibility: 'all', per_page: 100 },
    );
  });
});

describe('setVisibility', () => {
  it('calls repos.update with the visibility string', async () => {
    const update = vi.fn().mockResolvedValue({ data: {} });
    const octokit = { rest: { repos: { update } } };
    await setVisibility(octokit as never, 'me', 'r', 'private');
    expect(update).toHaveBeenCalledWith({ owner: 'me', repo: 'r', visibility: 'private' });
  });
});

describe('explainError', () => {
  it('explains a missing-scope 403', () => {
    expect(explainError(reqError(403))).toContain('scope');
  });
  it('explains a 404 distinctly from a 403', () => {
    expect(explainError(reqError(404)).toLowerCase()).toContain('not found');
  });
  it('explains a rate limit (remaining 0)', () => {
    expect(explainError(reqError(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' })))
      .toContain('Rate limited');
  });
  it('explains a 422 org policy', () => {
    expect(explainError(reqError(422))).toContain('422');
  });
  it('passes through plain errors', () => {
    expect(explainError(new Error('nope'))).toBe('nope');
  });
});

describe('makeSetter', () => {
  it('wraps update errors with a friendly message', async () => {
    const update = vi.fn().mockRejectedValue(reqError(403));
    const setter = makeSetter({ rest: { repos: { update } } } as never);
    await expect(setter('me', 'r', 'public')).rejects.toThrow(/scope/);
  });
});

describe('listRepoTree', () => {
  const makeOctokit = (result: unknown) => ({
    rest: {
      git: {
        getTree: vi.fn().mockResolvedValue({ data: result }),
      },
    },
  });

  it('returns blob paths only and the truncated flag', async () => {
    const octokit = makeOctokit({
      truncated: false,
      tree: [
        { path: 'src/index.ts', type: 'blob' },
        { path: 'src', type: 'tree' },
        { path: 'README.md', type: 'blob' },
      ],
    });
    const result = await listRepoTree(octokit as never, 'me', 'r', 'main');
    expect(result).toEqual({ paths: ['src/index.ts', 'README.md'], truncated: false });
  });

  it('sets truncated: true when the API reports truncation', async () => {
    const octokit = makeOctokit({
      truncated: true,
      tree: [{ path: 'big-file.ts', type: 'blob' }],
    });
    const result = await listRepoTree(octokit as never, 'me', 'r', 'main');
    expect(result.truncated).toBe(true);
  });

  it('returns empty result on 404 (empty repo)', async () => {
    const octokit = {
      rest: {
        git: {
          getTree: vi.fn().mockRejectedValue(reqError(404)),
        },
      },
    };
    const result = await listRepoTree(octokit as never, 'me', 'r', 'main');
    expect(result).toEqual({ paths: [], truncated: false });
  });

  it('returns empty result on 409 (empty repo — git database not initialized)', async () => {
    const octokit = {
      rest: {
        git: {
          getTree: vi.fn().mockRejectedValue(reqError(409)),
        },
      },
    };
    const result = await listRepoTree(octokit as never, 'me', 'r', 'main');
    expect(result).toEqual({ paths: [], truncated: false });
  });

  it('propagates other errors', async () => {
    const octokit = {
      rest: {
        git: {
          getTree: vi.fn().mockRejectedValue(reqError(500)),
        },
      },
    };
    await expect(listRepoTree(octokit as never, 'me', 'r', 'main')).rejects.toThrow();
  });

  it('calls the tree endpoint with recursive=1', async () => {
    const getTree = vi.fn().mockResolvedValue({ data: { truncated: false, tree: [] } });
    const octokit = { rest: { git: { getTree } } };
    await listRepoTree(octokit as never, 'me', 'my-repo', 'develop');
    expect(getTree).toHaveBeenCalledWith({
      owner: 'me',
      repo: 'my-repo',
      tree_sha: 'develop',
      recursive: '1',
    });
  });
});
