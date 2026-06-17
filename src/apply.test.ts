import { describe, it, expect, vi } from 'vitest';
import { applyChanges } from './apply.js';
import type { Repo, RowStatus } from './types.js';

const repo = (name: string): Repo => ({
  name,
  owner: 'me',
  visibility: 'public',
  isFork: false,
  isArchived: false,
  stars: 0,
  pushedAt: '2024-01-01T00:00:00Z',
  defaultBranch: 'main',
  license: null,
});

describe('applyChanges', () => {
  it('applies every repo and reports success', async () => {
    const setter = vi.fn().mockResolvedValue(undefined);
    const results = await applyChanges([repo('a'), repo('b')], 'private', setter);
    expect(results).toEqual([
      { name: 'a', ok: true },
      { name: 'b', ok: true },
    ]);
    expect(setter).toHaveBeenCalledWith('me', 'a', 'private');
  });

  it('captures per-repo failures without aborting the batch', async () => {
    const setter = vi.fn().mockImplementation(async (_o: string, name: string) => {
      if (name === 'b') throw new Error('denied');
    });
    const results = await applyChanges([repo('a'), repo('b'), repo('c')], 'private', setter);
    expect(results.find((r) => r.name === 'b')).toEqual({ name: 'b', ok: false, error: 'denied' });
    expect(results.filter((r) => r.ok)).toHaveLength(2);
  });

  it('emits progress transitions', async () => {
    const events: Array<[string, RowStatus]> = [];
    const setter = vi.fn().mockResolvedValue(undefined);
    await applyChanges([repo('a')], 'private', setter, {
      onProgress: (name, status) => events.push([name, status]),
    });
    expect(events).toContainEqual(['a', 'applying']);
    expect(events).toContainEqual(['a', 'done']);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const setter = vi.fn().mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    await applyChanges(
      Array.from({ length: 12 }, (_, i) => repo(`r${i}`)),
      'private',
      setter,
      { concurrency: 5 },
    );
    expect(peak).toBeLessThanOrEqual(5);
  });
});
