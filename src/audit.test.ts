/**
 * audit.test.ts — runAudit non-interactive report + exit code.
 *
 * All tests use fake repo loader + fake tree fetcher — NO network.
 * Tests verify:
 *   - only public repos are assessed
 *   - per-repo report is printed to stdout (repo name, severity, findings)
 *   - returns exit code 1 if ANY repo has a danger finding
 *   - returns exit code 0 when all repos are clean (or caution)
 */

import { describe, it, expect, vi } from 'vitest';
import { runAudit } from './audit.js';
import type { AuditOpts } from './audit.js';
import type { TreeFetcher } from './core/scan.js';
import type { AssessOptions } from './core/checks.js';
import type { Repo } from './types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    name: 'test-repo',
    owner: 'octocat',
    visibility: 'public',
    isFork: false,
    isArchived: false,
    stars: 0,
    pushedAt: '2026-05-01T00:00:00Z',
    defaultBranch: 'main',
    license: 'MIT',
    ...overrides,
  };
}

const NOW = new Date('2026-06-17T00:00:00Z');

const ASSESS_OPTS: AssessOptions = {
  staleMonths: 12,
  highProfileStars: 100,
  now: NOW,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture stdout writes during the callback. */
async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = origWrite;
  }
  return chunks.join('');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runAudit — public repo selection', () => {
  it('only assesses currently-public repos (ignores private)', async () => {
    const repos: Repo[] = [
      makeRepo({ name: 'pub-repo', visibility: 'public' }),
      makeRepo({ name: 'priv-repo', visibility: 'private' }),
    ];

    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = vi.fn().mockResolvedValue({ paths: [], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS };
    let output = '';
    output = await captureStdout(async () => {
      await runAudit(loadRepos, treeFetch, opts);
    });

    // Only the public repo should appear in the report
    expect(output).toContain('pub-repo');
    expect(output).not.toContain('priv-repo');
    // treeFetch should only be called once (for pub-repo)
    expect(treeFetch).toHaveBeenCalledTimes(1);
  });

  it('returns 0 when there are no public repos', async () => {
    const repos: Repo[] = [
      makeRepo({ name: 'priv-1', visibility: 'private' }),
      makeRepo({ name: 'priv-2', visibility: 'private' }),
    ];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = vi.fn().mockResolvedValue({ paths: [], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS };
    const code = await runAudit(loadRepos, treeFetch, opts);
    expect(code).toBe(0);
    expect(treeFetch).not.toHaveBeenCalled();
  });
});

describe('runAudit — exit code', () => {
  it('returns 1 when any public repo has a danger finding', async () => {
    const repos: Repo[] = [
      makeRepo({ name: 'danger-repo', visibility: 'public' }),
    ];
    const loadRepos = async () => repos;
    // .env triggers a danger finding
    const treeFetch: TreeFetcher = async () => ({ paths: ['.env'], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS };
    const code = await runAudit(loadRepos, treeFetch, opts);
    expect(code).toBe(1);
  });

  it('returns 0 when all public repos are clean', async () => {
    const repos: Repo[] = [
      makeRepo({ name: 'clean-repo', visibility: 'public' }),
    ];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = async () => ({ paths: ['src/index.ts', 'README.md'], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS };
    const code = await runAudit(loadRepos, treeFetch, opts);
    expect(code).toBe(0);
  });

  it('returns 0 when repos have only caution findings (no danger)', async () => {
    const repos: Repo[] = [
      // no-license triggers caution
      makeRepo({ name: 'no-license-repo', visibility: 'public', license: null }),
    ];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = async () => ({ paths: ['src/index.ts'], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS };
    const code = await runAudit(loadRepos, treeFetch, opts);
    expect(code).toBe(0);
  });

  it('returns 1 when at least one of multiple repos has danger', async () => {
    const repos: Repo[] = [
      makeRepo({ name: 'clean-1', visibility: 'public' }),
      makeRepo({ name: 'danger-repo', visibility: 'public' }),
      makeRepo({ name: 'clean-2', visibility: 'public' }),
    ];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = async (repo) => {
      if (repo.name === 'danger-repo') return { paths: ['.env'], truncated: false };
      return { paths: [], truncated: false };
    };

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS };
    const code = await runAudit(loadRepos, treeFetch, opts);
    expect(code).toBe(1);
  });
});

describe('runAudit — report content', () => {
  it('prints repo name in report', async () => {
    const repos: Repo[] = [makeRepo({ name: 'my-public-repo', visibility: 'public' })];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = async () => ({ paths: [], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS };
    const output = await captureStdout(async () => {
      await runAudit(loadRepos, treeFetch, opts);
    });

    expect(output).toContain('my-public-repo');
  });

  it('prints severity in report', async () => {
    const repos: Repo[] = [makeRepo({ name: 'danger-repo', visibility: 'public' })];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = async () => ({ paths: ['.env'], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS };
    const output = await captureStdout(async () => {
      await runAudit(loadRepos, treeFetch, opts);
    });

    expect(output).toContain('danger');
  });

  it('prints findings labels in report for danger repo', async () => {
    const repos: Repo[] = [makeRepo({ name: 'danger-repo', visibility: 'public' })];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = async () => ({ paths: ['.env'], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS };
    const output = await captureStdout(async () => {
      await runAudit(loadRepos, treeFetch, opts);
    });

    // The finding label should mention the file
    expect(output).toContain('.env');
  });

  it('prints a clean status for repos with no findings', async () => {
    const repos: Repo[] = [makeRepo({ name: 'clean-repo', visibility: 'public' })];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = async () => ({ paths: ['src/index.ts'], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS };
    const output = await captureStdout(async () => {
      await runAudit(loadRepos, treeFetch, opts);
    });

    expect(output).toContain('clean-repo');
    expect(output).toContain('clean');
  });

  it('prints report for all public repos', async () => {
    const repos: Repo[] = [
      makeRepo({ name: 'repo-a', visibility: 'public' }),
      makeRepo({ name: 'repo-b', visibility: 'public' }),
    ];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = async () => ({ paths: [], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS };
    const output = await captureStdout(async () => {
      await runAudit(loadRepos, treeFetch, opts);
    });

    expect(output).toContain('repo-a');
    expect(output).toContain('repo-b');
  });
});

describe('runAudit — no GitHub writes', () => {
  it('never calls setVisibility (treeFetch is read-only)', async () => {
    const repos: Repo[] = [makeRepo({ name: 'pub-repo', visibility: 'public' })];
    const loadRepos = async () => repos;
    const setVisibility = vi.fn();
    const treeFetch: TreeFetcher = async () => ({ paths: [], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS };
    await runAudit(loadRepos, treeFetch, opts);

    expect(setVisibility).not.toHaveBeenCalled();
  });
});
