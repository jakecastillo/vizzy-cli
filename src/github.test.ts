import { describe, it, expect, vi } from 'vitest';
import { RequestError } from '@octokit/request-error';
import {
  normalizeRepo,
  listOwnerRepos,
  listOrgRepos,
  listRepoTree,
  setVisibility,
  explainError,
  makeSetter,
  getBlobText,
  listHistoryFilenames,
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

  it('propagates a 404 (ref not found) so it becomes scan-incomplete, NOT a clean all-clear', async () => {
    // A 404 means the tree_sha/ref did not resolve (stale or wrong default branch,
    // or no access) — we never actually scanned the repo. It must propagate so the
    // scan layer marks the repo scan-incomplete (caution), never silently clean.
    const octokit = {
      rest: {
        git: {
          getTree: vi.fn().mockRejectedValue(reqError(404)),
        },
      },
    };
    await expect(listRepoTree(octokit as never, 'me', 'r', 'main')).rejects.toBeTruthy();
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

describe('getBlobText', () => {
  it('base64-decodes blob content and returns a string', async () => {
    const content = 'hello world\n';
    const encoded = Buffer.from(content).toString('base64');
    const getBlob = vi.fn().mockResolvedValue({ data: { content: encoded, encoding: 'base64' } });
    const octokit = { rest: { git: { getBlob } } };
    const result = await getBlobText(octokit as never, 'me', 'r', 'abc123sha');
    expect(result).toBe(content);
    expect(getBlob).toHaveBeenCalledWith({ owner: 'me', repo: 'r', file_sha: 'abc123sha' });
  });

  it('handles content with newlines in base64 (GitHub API wraps at 60 chars)', async () => {
    const content = 'AKIAIOSFODNN7EXAMPLE1234\n';
    const encoded = Buffer.from(content).toString('base64');
    // GitHub API wraps base64 at 60 chars with \n
    const wrapped = encoded.match(/.{1,60}/g)!.join('\n');
    const getBlob = vi.fn().mockResolvedValue({ data: { content: wrapped, encoding: 'base64' } });
    const octokit = { rest: { git: { getBlob } } };
    const result = await getBlobText(octokit as never, 'me', 'r', 'sha99');
    expect(result).toBe(content);
  });

  it('propagates errors (→ scan-incomplete upstream)', async () => {
    const getBlob = vi.fn().mockRejectedValue(new Error('blob not found'));
    const octokit = { rest: { git: { getBlob } } };
    await expect(getBlobText(octokit as never, 'me', 'r', 'badsha')).rejects.toThrow('blob not found');
  });
});

describe('listHistoryFilenames', () => {
  // The real API is two-step: listCommits returns commit SUMMARIES (sha only,
  // NO files), then getCommit(ref=sha) returns that commit's files. This mock
  // mirrors that contract so a regression to "read files off listCommits" fails.
  function makeOctokit(commitFiles: Array<string[] | undefined>) {
    const shas = commitFiles.map((_, i) => `sha${i}`);
    const listCommits = vi.fn().mockResolvedValue({ data: shas.map((sha) => ({ sha })) });
    const getCommit = vi.fn().mockImplementation(({ ref }: { ref: string }) => {
      const idx = shas.indexOf(ref);
      const names = commitFiles[idx];
      const files = names === undefined ? undefined : names.map((filename) => ({ filename }));
      return Promise.resolve({ data: { files } });
    });
    return { octokit: { rest: { repos: { listCommits, getCommit } } }, listCommits, getCommit };
  }

  it('fetches each commit (getCommit per sha) and returns unique filenames', async () => {
    const { octokit, getCommit } = makeOctokit([
      ['.env', 'src/index.ts'],
      ['README.md', 'src/index.ts'],
    ]);
    const result = await listHistoryFilenames(octokit as never, 'me', 'r');
    expect(result.paths).toContain('.env');
    expect(result.paths).toContain('src/index.ts');
    expect(result.paths).toContain('README.md');
    // Deduped — src/index.ts appears only once
    expect(result.paths.filter((p) => p === 'src/index.ts')).toHaveLength(1);
    expect(result.truncated).toBe(false);
    // The two-step contract: getCommit is actually called per commit (the bug
    // this guards was reading `files` off listCommits, which never has them).
    expect(getCommit).toHaveBeenCalledTimes(2);
  });

  it('sets truncated=true when returned commits equals maxCommits', async () => {
    const { octokit } = makeOctokit([['a.txt'], ['b.txt'], ['c.txt']]);
    const result = await listHistoryFilenames(octokit as never, 'me', 'r', 3);
    expect(result.truncated).toBe(true);
  });

  it('handles a commit with no files array gracefully', async () => {
    const { octokit } = makeOctokit([undefined, ['config.env']]);
    const result = await listHistoryFilenames(octokit as never, 'me', 'r');
    expect(result.paths).toContain('config.env');
    expect(result.truncated).toBe(false);
  });

  it('defaults maxCommits to 100', async () => {
    const { octokit, listCommits } = makeOctokit([]);
    await listHistoryFilenames(octokit as never, 'me', 'r');
    expect(listCommits).toHaveBeenCalledWith(expect.objectContaining({ per_page: 100 }));
  });

  it('returns empty paths and truncated=false for a repo with no commits', async () => {
    const { octokit, getCommit } = makeOctokit([]);
    const result = await listHistoryFilenames(octokit as never, 'me', 'r');
    expect(result.paths).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(getCommit).not.toHaveBeenCalled();
  });

  it('propagates a listCommits error so it becomes scan-incomplete upstream', async () => {
    const listCommits = vi.fn().mockRejectedValue(new Error('network error'));
    const octokit = { rest: { repos: { listCommits } } };
    await expect(listHistoryFilenames(octokit as never, 'me', 'r')).rejects.toThrow('network error');
  });

  it('propagates a getCommit error so it becomes scan-incomplete upstream', async () => {
    const listCommits = vi.fn().mockResolvedValue({ data: [{ sha: 'abc' }] });
    const getCommit = vi.fn().mockRejectedValue(new Error('commit fetch failed'));
    const octokit = { rest: { repos: { listCommits, getCommit } } };
    await expect(listHistoryFilenames(octokit as never, 'me', 'r')).rejects.toThrow('commit fetch failed');
  });
});

// ---------------------------------------------------------------------------
// listOrgRepos (bead vizzy-cli-9cm.10)
// ---------------------------------------------------------------------------

describe('listOrgRepos', () => {
  it('paginates org repos via GET /orgs/{org}/repos and normalizes them', async () => {
    const paginate = vi.fn().mockResolvedValue([
      raw({ name: 'infra', private: false }),
      raw({ name: 'backend', private: true }),
    ]);
    const octokit = { paginate, rest: { repos: { listForOrg: {} } } };
    const repos = await listOrgRepos(octokit as never, 'acme');
    expect(repos.map((r) => r.name)).toEqual(['infra', 'backend']);
    expect(paginate).toHaveBeenCalledWith(
      octokit.rest.repos.listForOrg,
      { org: 'acme', type: 'all', per_page: 100 },
    );
  });

  it('normalizes visibility from private flag', async () => {
    const paginate = vi.fn().mockResolvedValue([
      raw({ name: 'pub', private: false }),
      raw({ name: 'priv', private: true }),
    ]);
    const octokit = { paginate, rest: { repos: { listForOrg: {} } } };
    const repos = await listOrgRepos(octokit as never, 'acme');
    expect(repos.find((r) => r.name === 'pub')!.visibility).toBe('public');
    expect(repos.find((r) => r.name === 'priv')!.visibility).toBe('private');
  });

  it('returns an empty array when the org has no repos', async () => {
    const paginate = vi.fn().mockResolvedValue([]);
    const octokit = { paginate, rest: { repos: { listForOrg: {} } } };
    const repos = await listOrgRepos(octokit as never, 'empty-org');
    expect(repos).toEqual([]);
  });

  it('normalizes owner to the org name (raw owner.login)', async () => {
    const paginate = vi.fn().mockResolvedValue([
      raw({ name: 'repo-x', owner: { login: 'acme' } }),
    ]);
    const octokit = { paginate, rest: { repos: { listForOrg: {} } } };
    const repos = await listOrgRepos(octokit as never, 'acme');
    expect(repos[0].owner).toBe('acme');
  });
});
