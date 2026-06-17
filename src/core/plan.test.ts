import { describe, it, expect } from 'vitest';
import { buildPlan, formatSummary } from './plan.js';
import type { Repo } from '../types.js';

const repo = (name: string, visibility: Repo['visibility']): Repo => ({
  name,
  owner: 'me',
  visibility,
  isFork: false,
  isArchived: false,
  stars: 0,
  pushedAt: '2024-01-01T00:00:00Z',
  defaultBranch: 'main',
  license: null,
});

describe('buildPlan', () => {
  it('captures the target and selected repos', () => {
    const plan = buildPlan('private', [repo('a', 'public')]);
    expect(plan.target).toBe('private');
    expect(plan.repos.map((r) => r.name)).toEqual(['a']);
  });
});

describe('formatSummary', () => {
  it('lists repos and the PRIVATE target', () => {
    const text = formatSummary(buildPlan('private', [repo('a', 'public'), repo('b', 'public')]));
    expect(text).toContain('2 repos PRIVATE');
    expect(text).toContain('a');
    expect(text).toContain('b');
  });

  it('warns loudly when the target is PUBLIC', () => {
    const text = formatSummary(buildPlan('public', [repo('secret', 'private')]));
    expect(text).toContain('PUBLIC');
    expect(text.toLowerCase()).toContain('expos'); // "expose"/"exposed"
    expect(text).toContain('secret');
  });
});
