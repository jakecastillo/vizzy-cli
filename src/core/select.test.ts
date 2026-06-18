/**
 * core/select.test.ts — unit tests for resolveSelection.
 *
 * Tests encode the acceptance criteria from bead vizzy-cli-9cm.3:
 *   - repos names matched against eligible
 *   - unknown names returned for the caller to error/exit 2
 *   - allEligible → all eligible
 *   - empty cases
 *
 * No network. Pure function only.
 */

import { describe, it, expect } from 'vitest';
import { resolveSelection } from './select.js';
import type { Repo } from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRepo(name: string, owner = 'octocat'): Repo {
  return {
    name,
    owner,
    visibility: 'private',
    isFork: false,
    isArchived: false,
    stars: 0,
    pushedAt: '2025-01-01T00:00:00Z',
    defaultBranch: 'main',
    license: 'MIT',
  };
}

const ALPHA = makeRepo('alpha');
const BETA = makeRepo('beta');
const GAMMA = makeRepo('gamma');

const ELIGIBLE = [ALPHA, BETA, GAMMA];

// ---------------------------------------------------------------------------
// name match
// ---------------------------------------------------------------------------

describe('resolveSelection — name match', () => {
  it('returns matched repos in the same order as eligible', () => {
    const { selected, unknown } = resolveSelection(ELIGIBLE, { repos: ['beta', 'alpha'] });
    // Order follows eligible array, not the repos spec order
    expect(selected.map((r) => r.name)).toEqual(['alpha', 'beta']);
    expect(unknown).toHaveLength(0);
  });

  it('single name match returns one repo', () => {
    const { selected, unknown } = resolveSelection(ELIGIBLE, { repos: ['gamma'] });
    expect(selected).toHaveLength(1);
    expect(selected[0].name).toBe('gamma');
    expect(unknown).toHaveLength(0);
  });

  it('all names matched returns all matched repos', () => {
    const { selected, unknown } = resolveSelection(ELIGIBLE, {
      repos: ['alpha', 'beta', 'gamma'],
    });
    expect(selected).toHaveLength(3);
    expect(unknown).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// unknown names
// ---------------------------------------------------------------------------

describe('resolveSelection — unknown names', () => {
  it('unknown name is returned in unknown array', () => {
    const { selected, unknown } = resolveSelection(ELIGIBLE, { repos: ['delta'] });
    expect(selected).toHaveLength(0);
    expect(unknown).toEqual(['delta']);
  });

  it('mix of known and unknown returns both', () => {
    const { selected, unknown } = resolveSelection(ELIGIBLE, { repos: ['alpha', 'nope'] });
    expect(selected.map((r) => r.name)).toEqual(['alpha']);
    expect(unknown).toEqual(['nope']);
  });

  it('multiple unknown names are all surfaced', () => {
    const { selected, unknown } = resolveSelection(ELIGIBLE, {
      repos: ['missing-1', 'missing-2'],
    });
    expect(selected).toHaveLength(0);
    expect(unknown).toEqual(['missing-1', 'missing-2']);
  });
});

// ---------------------------------------------------------------------------
// allEligible
// ---------------------------------------------------------------------------

describe('resolveSelection — allEligible', () => {
  it('allEligible=true returns all eligible repos', () => {
    const { selected, unknown } = resolveSelection(ELIGIBLE, { allEligible: true });
    expect(selected).toEqual(ELIGIBLE);
    expect(unknown).toHaveLength(0);
  });

  it('allEligible=true with empty eligible returns empty selected', () => {
    const { selected, unknown } = resolveSelection([], { allEligible: true });
    expect(selected).toHaveLength(0);
    expect(unknown).toHaveLength(0);
  });

  it('allEligible=false is equivalent to no spec — returns empty selected', () => {
    const { selected, unknown } = resolveSelection(ELIGIBLE, { allEligible: false });
    expect(selected).toHaveLength(0);
    expect(unknown).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// empty cases
// ---------------------------------------------------------------------------

describe('resolveSelection — empty cases', () => {
  it('empty repos spec returns empty selected and no unknowns', () => {
    const { selected, unknown } = resolveSelection(ELIGIBLE, { repos: [] });
    expect(selected).toHaveLength(0);
    expect(unknown).toHaveLength(0);
  });

  it('empty eligible with names returns all names as unknown', () => {
    const { selected, unknown } = resolveSelection([], { repos: ['alpha', 'beta'] });
    expect(selected).toHaveLength(0);
    expect(unknown).toEqual(['alpha', 'beta']);
  });

  it('no spec (neither repos nor allEligible) returns empty selected', () => {
    const { selected, unknown } = resolveSelection(ELIGIBLE, {});
    expect(selected).toHaveLength(0);
    expect(unknown).toHaveLength(0);
  });
});
