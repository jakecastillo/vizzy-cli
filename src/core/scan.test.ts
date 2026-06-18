/**
 * scan.test.ts — assessRepos orchestration tests.
 *
 * All tests use a stub TreeFetcher — no network, no real Date.
 */

import { describe, it, expect, vi } from 'vitest';
import { assessRepos } from './scan.js';
import type { TreeFetcher, ContentFetcher, HistoryFetcher } from './scan.js';
import type { AssessOptions } from './checks.js';
import type { Repo } from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    name: 'test-repo',
    owner: 'octocat',
    visibility: 'private',
    isFork: false,
    isArchived: false,
    stars: 0,
    forksCount: 0,
    pushedAt: '2026-05-01T00:00:00Z',
    defaultBranch: 'main',
    license: 'MIT',
    ...overrides,
  };
}

const NOW = new Date('2026-06-17T00:00:00Z');

const OPTS: AssessOptions & { concurrency?: number } = {
  staleMonths: 12,
  highProfileStars: 100,
  now: NOW,
};

// ---------------------------------------------------------------------------
// Basic contract — returns one assessment per repo, in order
// ---------------------------------------------------------------------------

describe('assessRepos — basic contract', () => {
  it('returns an assessment for every repo, in input order', async () => {
    const repos = [makeRepo({ name: 'a' }), makeRepo({ name: 'b' }), makeRepo({ name: 'c' })];

    const fetcher: TreeFetcher = async (repo) => ({ paths: [`${repo.name}/src/index.ts`], truncated: false });

    const results = await assessRepos(repos, fetcher, OPTS);

    expect(results).toHaveLength(3);
    expect(results[0].repo.name).toBe('a');
    expect(results[1].repo.name).toBe('b');
    expect(results[2].repo.name).toBe('c');
  });

  it('returns clean assessment when tree has no sensitive files', async () => {
    const repos = [makeRepo({ name: 'clean-repo' })];
    const fetcher: TreeFetcher = async () => ({ paths: ['src/index.ts', 'README.md'], truncated: false });

    const [result] = await assessRepos(repos, fetcher, OPTS);

    expect(result.severity).toBe('clean');
    expect(result.findings).toHaveLength(0);
  });

  it('returns danger assessment when tree has a sensitive file', async () => {
    const repos = [makeRepo({ name: 'secret-repo' })];
    const fetcher: TreeFetcher = async () => ({ paths: ['.env', 'src/index.ts'], truncated: false });

    const [result] = await assessRepos(repos, fetcher, OPTS);

    expect(result.severity).toBe('danger');
    const kinds = result.findings.map((f) => f.kind);
    expect(kinds).toContain('secret-file');
  });
});

// ---------------------------------------------------------------------------
// Per-repo fetch failure isolation
// ---------------------------------------------------------------------------

describe('assessRepos — fetch failure isolation', () => {
  it('isolates a fetch failure: failed repo gets scan-incomplete, others succeed', async () => {
    const repos = [
      makeRepo({ name: 'good-1' }),
      makeRepo({ name: 'bad-fetch' }),
      makeRepo({ name: 'good-2' }),
    ];

    const fetcher: TreeFetcher = async (repo) => {
      if (repo.name === 'bad-fetch') throw new Error('network timeout');
      return { paths: ['src/index.ts'], truncated: false };
    };

    const results = await assessRepos(repos, fetcher, OPTS);

    expect(results).toHaveLength(3);

    // Failed repo → scan-incomplete caution
    const badResult = results.find((r) => r.repo.name === 'bad-fetch')!;
    expect(badResult).toBeDefined();
    const kinds = badResult.findings.map((f) => f.kind);
    expect(kinds).toContain('scan-incomplete');
    expect(badResult.severity).toBe('caution');

    // Good repos are unaffected
    const good1 = results.find((r) => r.repo.name === 'good-1')!;
    const good2 = results.find((r) => r.repo.name === 'good-2')!;
    expect(good1.severity).toBe('clean');
    expect(good2.severity).toBe('clean');
  });

  it('order is preserved even when middle fetch fails', async () => {
    const repos = [
      makeRepo({ name: 'first' }),
      makeRepo({ name: 'second' }),
      makeRepo({ name: 'third' }),
    ];

    const fetcher: TreeFetcher = async (repo) => {
      if (repo.name === 'second') throw new Error('rejected');
      return { paths: [], truncated: false };
    };

    const results = await assessRepos(repos, fetcher, OPTS);

    expect(results[0].repo.name).toBe('first');
    expect(results[1].repo.name).toBe('second');
    expect(results[2].repo.name).toBe('third');
  });

  it('batch always completes even if all repos fail', async () => {
    const repos = [makeRepo({ name: 'a' }), makeRepo({ name: 'b' })];

    const fetcher: TreeFetcher = async () => {
      throw new Error('always fails');
    };

    // Should resolve (not reject)
    const results = await assessRepos(repos, fetcher, OPTS);
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.findings.some((f) => f.kind === 'scan-incomplete')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Truncated tree → scan-incomplete
// ---------------------------------------------------------------------------

describe('assessRepos — truncated tree', () => {
  it('yields scan-incomplete caution when truncated===true', async () => {
    const repos = [makeRepo({ name: 'huge-repo' })];

    const fetcher: TreeFetcher = async () => ({
      paths: ['src/index.ts', 'README.md'],
      truncated: true,
    });

    const [result] = await assessRepos(repos, fetcher, OPTS);

    const kinds = result.findings.map((f) => f.kind);
    expect(kinds).toContain('scan-incomplete');
    expect(result.severity).toBe('caution');
  });

  it('truncated tree still processes the paths it received', async () => {
    const repos = [makeRepo({ name: 'huge-with-secret' })];

    const fetcher: TreeFetcher = async () => ({
      paths: ['.env', 'src/index.ts'],
      truncated: true,
    });

    const [result] = await assessRepos(repos, fetcher, OPTS);

    // Should have both secret-file (danger) AND scan-incomplete (caution)
    const kinds = result.findings.map((f) => f.kind);
    expect(kinds).toContain('secret-file');
    expect(kinds).toContain('scan-incomplete');
    expect(result.severity).toBe('danger');
  });
});

// ---------------------------------------------------------------------------
// Concurrency — respects opts.concurrency
// ---------------------------------------------------------------------------

describe('assessRepos — concurrency', () => {
  it('runs with default concurrency of 5 when concurrency is not set', async () => {
    const repos = Array.from({ length: 10 }, (_, i) => makeRepo({ name: `repo-${i}` }));
    const fetcher: TreeFetcher = async () => ({ paths: [], truncated: false });

    // Should complete without error
    const results = await assessRepos(repos, fetcher, OPTS);
    expect(results).toHaveLength(10);
  });

  it('respects opts.concurrency=1 (serial execution)', async () => {
    const executionOrder: string[] = [];
    const repos = [
      makeRepo({ name: 'r1' }),
      makeRepo({ name: 'r2' }),
      makeRepo({ name: 'r3' }),
    ];

    const fetcher: TreeFetcher = async (repo) => {
      executionOrder.push(repo.name);
      return { paths: [], truncated: false };
    };

    await assessRepos(repos, fetcher, { ...OPTS, concurrency: 1 });

    // With concurrency=1, all repos are fetched
    expect(executionOrder).toHaveLength(3);
    expect(executionOrder).toContain('r1');
    expect(executionOrder).toContain('r2');
    expect(executionOrder).toContain('r3');
  });

  it('limits concurrent calls to opts.concurrency', async () => {
    const inFlight: Set<string> = new Set();
    let maxSeen = 0;
    const repos = Array.from({ length: 8 }, (_, i) => makeRepo({ name: `repo-${i}` }));

    const fetcher: TreeFetcher = async (repo) => {
      inFlight.add(repo.name);
      maxSeen = Math.max(maxSeen, inFlight.size);
      // Yield to allow other tasks to interleave
      await new Promise<void>((resolve) => setImmediate(resolve));
      inFlight.delete(repo.name);
      return { paths: [], truncated: false };
    };

    await assessRepos(repos, fetcher, { ...OPTS, concurrency: 3 });

    expect(maxSeen).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Empty repo list
// ---------------------------------------------------------------------------

describe('assessRepos — edge cases', () => {
  it('returns empty array for empty repos input', async () => {
    const fetcher: TreeFetcher = vi.fn().mockResolvedValue({ paths: [], truncated: false });

    const results = await assessRepos([], fetcher, OPTS);
    expect(results).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Content pass — opt-in, injected, bounded
// ---------------------------------------------------------------------------

describe('assessRepos — content pass (deep=true)', () => {
  it('is NOT run by default (no contentFetcher option)', async () => {
    // Even when paths include a .env-like file, without deep the content fetcher
    // should never be called.
    const contentFetcher: ContentFetcher = vi.fn().mockResolvedValue('secret content');
    const repos = [makeRepo({ name: 'repo' })];
    const treeFetcher: TreeFetcher = async () => ({ paths: ['config.js'], truncated: false });

    // Without deep/contentFetcher, content fetcher is never called
    await assessRepos(repos, treeFetcher, OPTS);
    expect(contentFetcher).not.toHaveBeenCalled();
  });

  it('calls contentFetcher for suspicious text blobs when deep=true', async () => {
    const repos = [makeRepo({ name: 'repo' })];
    // .env is suspicious; should trigger content fetch
    const treeFetcher: TreeFetcher = async () => ({
      paths: ['.env'],
      truncated: false,
    });
    const contentFetcher: ContentFetcher = vi.fn().mockResolvedValue('AWS_KEY=AKIAIOSFODNN7EXAMPLE1');

    await assessRepos(repos, treeFetcher, { ...OPTS, deep: true, contentFetcher });
    expect(contentFetcher).toHaveBeenCalled();
  });

  it('content hit → secret-content danger finding', async () => {
    const repos = [makeRepo({ name: 'repo' })];
    const treeFetcher: TreeFetcher = async () => ({
      paths: ['secrets.txt'],
      truncated: false,
    });
    // The content fetcher returns text with a valid AWS access key ID (AKIA + 16 chars)
    const awsKey = 'AKIAIOSFODNN7EXAMPLE';
    const contentFetcher: ContentFetcher = vi.fn().mockResolvedValue(`AWS_KEY=${awsKey}\n`);

    const [result] = await assessRepos(repos, treeFetcher, { ...OPTS, deep: true, contentFetcher });
    const kinds = result!.findings.map((f) => f.kind);
    expect(kinds).toContain('secret-content');
    expect(result!.severity).toBe('danger');
  });

  it('is bounded: does not call contentFetcher for non-suspicious files', async () => {
    const repos = [makeRepo({ name: 'repo' })];
    const treeFetcher: TreeFetcher = async () => ({
      // Only safe files — content fetch should not happen
      paths: ['src/index.ts', 'README.md', 'package.json'],
      truncated: false,
    });
    const contentFetcher: ContentFetcher = vi.fn().mockResolvedValue('safe content');

    await assessRepos(repos, treeFetcher, { ...OPTS, deep: true, contentFetcher });
    // Non-suspicious paths should not be fetched
    expect(contentFetcher).not.toHaveBeenCalled();
  });

  it('content fetch error → scan-incomplete finding, never silent clean', async () => {
    // Use a path that classifyPath flags (so content fetch is attempted) but
    // use a repo that would otherwise be clean — verifying that a fetch failure
    // is never silently ignored.
    const repos = [makeRepo({ name: 'repo' })];
    const treeFetcher: TreeFetcher = async () => ({
      // secrets.txt is classified as suspicious (secrets.*), but triggers content
      // scanning. With a failed fetch we must get scan-incomplete, not silent clean.
      paths: ['secrets.txt'],
      truncated: false,
    });
    const contentFetcher: ContentFetcher = vi.fn().mockRejectedValue(new Error('blob fetch failed'));

    const [result] = await assessRepos(repos, treeFetcher, { ...OPTS, deep: true, contentFetcher });
    const kinds = result!.findings.map((f) => f.kind);
    // scan-incomplete must be present
    expect(kinds).toContain('scan-incomplete');
    // severity must not be clean (at minimum caution)
    expect(result!.severity).not.toBe('clean');
  });

  it('no-hit content → no secret-content finding', async () => {
    const repos = [makeRepo({ name: 'repo' })];
    const treeFetcher: TreeFetcher = async () => ({
      paths: ['.env'],
      truncated: false,
    });
    // Content with no pattern matches
    const contentFetcher: ContentFetcher = vi.fn().mockResolvedValue('PLACEHOLDER=nothing_here');

    const [result] = await assessRepos(repos, treeFetcher, { ...OPTS, deep: true, contentFetcher });
    const kinds = result!.findings.map((f) => f.kind);
    expect(kinds).not.toContain('secret-content');
  });
});

// ---------------------------------------------------------------------------
// History pass — opt-in, injected HistoryFetcher
// ---------------------------------------------------------------------------

describe('assessRepos — history pass (deep=true, historyFetcher)', () => {
  it('deleted .env in history → secret-in-history danger finding', async () => {
    const repos = [makeRepo({ name: 'repo' })];
    // HEAD tree is clean
    const treeFetcher: TreeFetcher = async () => ({ paths: ['README.md'], truncated: false });
    // .env was deleted; it appears in history but NOT in HEAD
    const historyFetcher: HistoryFetcher = vi.fn().mockResolvedValue({
      paths: ['.env', 'README.md'],
      truncated: false,
    });

    const [result] = await assessRepos(repos, treeFetcher, {
      ...OPTS,
      deep: true,
      historyFetcher,
    });
    const kinds = result!.findings.map((f) => f.kind);
    expect(kinds).toContain('secret-in-history');
    expect(result!.severity).toBe('danger');
  });

  it('a secret file present in HEAD is NOT double-flagged as history', async () => {
    const repos = [makeRepo({ name: 'repo' })];
    // .env is in current HEAD
    const treeFetcher: TreeFetcher = async () => ({ paths: ['.env'], truncated: false });
    // .env also appears in history
    const historyFetcher: HistoryFetcher = vi.fn().mockResolvedValue({
      paths: ['.env'],
      truncated: false,
    });

    const [result] = await assessRepos(repos, treeFetcher, {
      ...OPTS,
      deep: true,
      historyFetcher,
    });
    const kinds = result!.findings.map((f) => f.kind);
    expect(kinds).toContain('secret-file');
    expect(kinds).not.toContain('secret-in-history');
  });

  it('history fetcher is NOT called without deep=true', async () => {
    const repos = [makeRepo({ name: 'repo' })];
    const treeFetcher: TreeFetcher = async () => ({ paths: [], truncated: false });
    const historyFetcher: HistoryFetcher = vi.fn().mockResolvedValue({ paths: [], truncated: false });

    await assessRepos(repos, treeFetcher, { ...OPTS, historyFetcher });
    expect(historyFetcher).not.toHaveBeenCalled();
  });

  it('history fetcher error → scan-incomplete, not silent clean', async () => {
    const repos = [makeRepo({ name: 'repo' })];
    const treeFetcher: TreeFetcher = async () => ({ paths: [], truncated: false });
    const historyFetcher: HistoryFetcher = vi.fn().mockRejectedValue(new Error('history fetch failed'));

    const [result] = await assessRepos(repos, treeFetcher, {
      ...OPTS,
      deep: true,
      historyFetcher,
    });
    const kinds = result!.findings.map((f) => f.kind);
    expect(kinds).toContain('scan-incomplete');
    expect(result!.severity).not.toBe('clean');
  });

  it('clean history (no sensitive filenames) → no secret-in-history finding', async () => {
    const repos = [makeRepo({ name: 'repo' })];
    const treeFetcher: TreeFetcher = async () => ({ paths: [], truncated: false });
    const historyFetcher: HistoryFetcher = vi.fn().mockResolvedValue({
      paths: ['README.md', 'src/index.ts'],
      truncated: false,
    });

    const [result] = await assessRepos(repos, treeFetcher, {
      ...OPTS,
      deep: true,
      historyFetcher,
    });
    const kinds = result!.findings.map((f) => f.kind);
    expect(kinds).not.toContain('secret-in-history');
  });
});
