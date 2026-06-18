import { describe, it, expect } from 'vitest';
import { consequencesFor } from './consequences.js';
import type { Repo } from '../types.js';

const repo = (overrides: Partial<Repo> = {}): Repo => ({
  name: 'my-repo',
  owner: 'me',
  visibility: 'public',
  isFork: false,
  isArchived: false,
  stars: 0,
  forksCount: 0,
  pushedAt: '2024-01-01T00:00:00Z',
  defaultBranch: 'main',
  license: null,
  ...overrides,
});

describe('consequencesFor — going private', () => {
  it('returns erases-stars consequence when stars > 0', () => {
    const r = repo({ stars: 42 });
    const result = consequencesFor(r, 'private');
    expect(result).toContain('erases 42 stars');
  });

  it('omits erases-stars when stars === 0', () => {
    const r = repo({ stars: 0 });
    const result = consequencesFor(r, 'private');
    expect(result.some((c) => c.includes('star'))).toBe(false);
  });

  it('returns detaches-forks consequence when forksCount > 0', () => {
    const r = repo({ forksCount: 3 });
    const result = consequencesFor(r, 'private');
    expect(result).toContain('detaches 3 forks');
  });

  it('omits detaches-forks when forksCount === 0', () => {
    const r = repo({ forksCount: 0 });
    const result = consequencesFor(r, 'private');
    expect(result.some((c) => c.includes('fork'))).toBe(false);
  });

  it('always includes unpublishes GitHub Pages', () => {
    const r = repo();
    const result = consequencesFor(r, 'private');
    expect(result).toContain('unpublishes GitHub Pages');
  });

  it('returns empty array for stars=0 and forksCount=0 except Pages', () => {
    const r = repo({ stars: 0, forksCount: 0 });
    const result = consequencesFor(r, 'private');
    // Pages is always included
    expect(result).toEqual(['unpublishes GitHub Pages']);
  });

  it('includes all three consequences when stars>0 and forks>0', () => {
    const r = repo({ stars: 10, forksCount: 5 });
    const result = consequencesFor(r, 'private');
    expect(result).toContain('erases 10 stars');
    expect(result).toContain('detaches 5 forks');
    expect(result).toContain('unpublishes GitHub Pages');
  });
});

describe('consequencesFor — going public', () => {
  it('returns publishes Actions logs', () => {
    const r = repo();
    const result = consequencesFor(r, 'public');
    expect(result).toContain('publishes Actions logs');
  });

  it('returns disables push rulesets', () => {
    const r = repo();
    const result = consequencesFor(r, 'public');
    expect(result).toContain('disables push rulesets');
  });

  it('returns exactly two consequences for public target', () => {
    const r = repo();
    const result = consequencesFor(r, 'public');
    expect(result).toHaveLength(2);
  });
});
