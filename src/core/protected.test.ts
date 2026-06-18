import { describe, it, expect } from 'vitest';
import { loadProtected, isProtected, partitionProtected } from './protected.js';
import type { Repo } from '../types.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const repo = (name: string, over: Partial<Repo> = {}): Repo => ({
  name,
  owner: 'me',
  visibility: 'public',
  isFork: false,
  isArchived: false,
  stars: 0,
  forksCount: 0,
  pushedAt: '2024-01-01T00:00:00Z',
  defaultBranch: 'main',
  license: null,
  ...over,
});

// ---------------------------------------------------------------------------
// loadProtected — parsing .vizzyignore text
// ---------------------------------------------------------------------------

describe('loadProtected', () => {
  it('returns empty array for empty string', () => {
    expect(loadProtected('')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(loadProtected('   \n   \n')).toEqual([]);
  });

  it('drops blank lines', () => {
    const text = '\nmy-secret-repo\n\nanother-repo\n';
    expect(loadProtected(text)).toEqual(['my-secret-repo', 'another-repo']);
  });

  it('drops lines that start with #', () => {
    const text = '# This is a comment\nmy-repo\n# another comment\n';
    expect(loadProtected(text)).toEqual(['my-repo']);
  });

  it('drops inline comments (full-line # only; inline # is kept as-is)', () => {
    // Only lines whose TRIMMED form starts with '#' are dropped.
    // A pattern like 'my-repo # note' is kept verbatim (not a .vizzyignore convention).
    const text = '  # leading spaces comment\nmy-repo\n';
    expect(loadProtected(text)).toEqual(['my-repo']);
  });

  it('trims leading and trailing whitespace from each pattern', () => {
    const text = '  spaced-repo  \n\t tabbed-repo\t\n';
    expect(loadProtected(text)).toEqual(['spaced-repo', 'tabbed-repo']);
  });

  it('handles mixed comments, blanks, and real patterns', () => {
    const text = [
      '# .vizzyignore — repos never made public',
      '',
      'my-private-notes',
      '  infra-secrets ',
      '# end',
      'deploy-keys',
    ].join('\n');
    expect(loadProtected(text)).toEqual(['my-private-notes', 'infra-secrets', 'deploy-keys']);
  });
});

// ---------------------------------------------------------------------------
// isProtected — glob matching
// ---------------------------------------------------------------------------

describe('isProtected', () => {
  it('returns false for empty pattern list', () => {
    expect(isProtected('any-repo', [])).toBe(false);
  });

  it('matches an exact name', () => {
    expect(isProtected('my-repo', ['my-repo'])).toBe(true);
    expect(isProtected('other-repo', ['my-repo'])).toBe(false);
  });

  it('* matches any sequence of characters', () => {
    expect(isProtected('infra-secrets', ['infra-*'])).toBe(true);
    expect(isProtected('infra-deploy', ['infra-*'])).toBe(true);
    expect(isProtected('other-thing', ['infra-*'])).toBe(false);
  });

  it('* at the start matches suffix', () => {
    expect(isProtected('my-secrets', ['*-secrets'])).toBe(true);
    expect(isProtected('prod-secrets', ['*-secrets'])).toBe(true);
    expect(isProtected('prod-notes', ['*-secrets'])).toBe(false);
  });

  it('bare * matches everything', () => {
    expect(isProtected('anything', ['*'])).toBe(true);
    expect(isProtected('', ['*'])).toBe(true);
  });

  it('? matches exactly one character', () => {
    expect(isProtected('repoA', ['repo?'])).toBe(true);
    expect(isProtected('repoBC', ['repo?'])).toBe(false);
    expect(isProtected('repo', ['repo?'])).toBe(false);
  });

  it('? does not match zero characters', () => {
    expect(isProtected('rep', ['repo?'])).toBe(false);
  });

  it('matches against the first matching pattern (any-of semantics)', () => {
    expect(isProtected('my-repo', ['other', 'my-repo', 'yet-another'])).toBe(true);
  });

  it('is case-sensitive (glob matches repo name exactly)', () => {
    expect(isProtected('My-Repo', ['my-repo'])).toBe(false);
    expect(isProtected('my-repo', ['My-Repo'])).toBe(false);
  });

  it('handles combined * and ? in a pattern', () => {
    expect(isProtected('env-prod1', ['env-*?'])).toBe(true);
    expect(isProtected('env-', ['env-*?'])).toBe(false); // '*' can be empty but '?' needs one char
  });
});

// ---------------------------------------------------------------------------
// partitionProtected — splitting repos into allowed vs. protectedOut
// ---------------------------------------------------------------------------

describe('partitionProtected', () => {
  it('returns all repos as allowed when patterns is empty', () => {
    const repos = [repo('a'), repo('b'), repo('c')];
    const result = partitionProtected(repos, []);
    expect(result.allowed.map((r) => r.name)).toEqual(['a', 'b', 'c']);
    expect(result.protectedOut).toHaveLength(0);
  });

  it('moves exact-match repos to protectedOut', () => {
    const repos = [repo('public-one'), repo('secret-notes'), repo('public-two')];
    const { allowed, protectedOut } = partitionProtected(repos, ['secret-notes']);
    expect(allowed.map((r) => r.name)).toEqual(['public-one', 'public-two']);
    expect(protectedOut.map((r) => r.name)).toEqual(['secret-notes']);
  });

  it('moves glob-match repos to protectedOut', () => {
    const repos = [repo('infra-secrets'), repo('infra-deploy'), repo('app-server')];
    const { allowed, protectedOut } = partitionProtected(repos, ['infra-*']);
    expect(allowed.map((r) => r.name)).toEqual(['app-server']);
    expect(protectedOut.map((r) => r.name)).toEqual(['infra-secrets', 'infra-deploy']);
  });

  it('handles multiple patterns', () => {
    const repos = [repo('keep-me'), repo('secret-notes'), repo('deploy-keys'), repo('public')];
    const { allowed, protectedOut } = partitionProtected(repos, ['secret-notes', 'deploy-keys']);
    expect(allowed.map((r) => r.name)).toEqual(['keep-me', 'public']);
    expect(protectedOut.map((r) => r.name)).toEqual(['secret-notes', 'deploy-keys']);
  });

  it('returns empty allowed and all protectedOut when * pattern is used', () => {
    const repos = [repo('a'), repo('b')];
    const { allowed, protectedOut } = partitionProtected(repos, ['*']);
    expect(allowed).toHaveLength(0);
    expect(protectedOut).toHaveLength(2);
  });

  it('preserves the full Repo objects (not just names)', () => {
    const r = repo('special', { stars: 42, visibility: 'private' });
    const { protectedOut } = partitionProtected([r], ['special']);
    expect(protectedOut[0]).toEqual(r);
  });

  it('keeps order of allowed repos stable', () => {
    const repos = [repo('z'), repo('a'), repo('m'), repo('secret')];
    const { allowed } = partitionProtected(repos, ['secret']);
    expect(allowed.map((r) => r.name)).toEqual(['z', 'a', 'm']);
  });
});
