import { describe, it, expect, vi } from 'vitest';
import { RequestError } from '@octokit/request-error';
import {
  normalizeRepo,
  listOwnerRepos,
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
