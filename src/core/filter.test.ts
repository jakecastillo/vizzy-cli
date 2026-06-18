import { describe, it, expect } from 'vitest';
import { eligibleRepos } from './filter.js';
import type { Repo } from '../types.js';

const repo = (over: Partial<Repo>): Repo => ({
  name: 'r',
  owner: 'me',
  visibility: 'public',
  isFork: false,
  isArchived: false,
  stars: 0,
  forksCount: 0,
  pushedAt: '2020-01-01T00:00:00Z',
  defaultBranch: 'main',
  license: null,
  ...over,
});

const opts = { includeForks: true, includeArchived: false };

describe('eligibleRepos', () => {
  it('keeps only repos not already in the target state', () => {
    const repos = [
      repo({ name: 'pub', visibility: 'public' }),
      repo({ name: 'priv', visibility: 'private' }),
    ];
    expect(eligibleRepos(repos, 'private', opts).map((r) => r.name)).toEqual(['pub']);
    expect(eligibleRepos(repos, 'public', opts).map((r) => r.name)).toEqual(['priv']);
  });

  it('includes forks by default and excludes them when includeForks is false', () => {
    const repos = [repo({ name: 'fork', isFork: true }), repo({ name: 'own' })];
    expect(eligibleRepos(repos, 'private', opts).map((r) => r.name)).toEqual([
      'fork',
      'own',
    ]);
    expect(
      eligibleRepos(repos, 'private', { ...opts, includeForks: false }).map((r) => r.name),
    ).toEqual(['own']);
  });

  it('excludes archived repos by default and includes them when asked', () => {
    const repos = [repo({ name: 'arch', isArchived: true }), repo({ name: 'live' })];
    expect(eligibleRepos(repos, 'private', opts).map((r) => r.name)).toEqual(['live']);
    expect(
      eligibleRepos(repos, 'private', { ...opts, includeArchived: true }).map((r) => r.name),
    ).toEqual(['arch', 'live']);
  });

  it('sorts by pushedAt descending (most recent first)', () => {
    const repos = [
      repo({ name: 'old', pushedAt: '2020-01-01T00:00:00Z' }),
      repo({ name: 'new', pushedAt: '2024-01-01T00:00:00Z' }),
      repo({ name: 'mid', pushedAt: '2022-01-01T00:00:00Z' }),
    ];
    expect(eligibleRepos(repos, 'private', opts).map((r) => r.name)).toEqual([
      'new',
      'mid',
      'old',
    ]);
  });
});
