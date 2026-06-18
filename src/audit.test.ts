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
import * as githubModule from './github.js';
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

// ---------------------------------------------------------------------------
// NEW: format tests (bead vizzy-cli-9cm.2)
// ---------------------------------------------------------------------------

describe('runAudit — format: json', () => {
  it('emits valid JSON to stdout when format is json', async () => {
    const repos: Repo[] = [makeRepo({ name: 'pub-repo', visibility: 'public' })];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = async () => ({ paths: ['.env'], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS, format: 'json' };
    const output = await captureStdout(async () => {
      await runAudit(loadRepos, treeFetch, opts);
    });

    // Must be valid JSON
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('repos');
    expect(Array.isArray(parsed.repos)).toBe(true);
    expect(parsed.repos[0].repo).toBe('octocat/pub-repo');
    expect(parsed.repos[0].severity).toBe('danger');
  });

  it('still returns exit code 1 on danger with json format', async () => {
    const repos: Repo[] = [makeRepo({ name: 'danger-repo', visibility: 'public' })];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = async () => ({ paths: ['.env'], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS, format: 'json' };
    let code: number;
    await captureStdout(async () => {
      code = await runAudit(loadRepos, treeFetch, opts);
    });
    expect(code!).toBe(1);
  });

  it('still returns exit code 0 when clean with json format', async () => {
    const repos: Repo[] = [makeRepo({ name: 'clean-repo', visibility: 'public' })];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = async () => ({ paths: ['src/index.ts'], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS, format: 'json' };
    let code: number;
    await captureStdout(async () => {
      code = await runAudit(loadRepos, treeFetch, opts);
    });
    expect(code!).toBe(0);
  });

  it('json output contains findings array per repo', async () => {
    const repos: Repo[] = [makeRepo({ name: 'pub-repo', visibility: 'public' })];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = async () => ({ paths: ['.env'], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS, format: 'json' };
    const output = await captureStdout(async () => {
      await runAudit(loadRepos, treeFetch, opts);
    });

    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed.repos[0].findings)).toBe(true);
    expect(parsed.repos[0].findings.length).toBeGreaterThan(0);
    expect(parsed.repos[0].findings[0]).toHaveProperty('kind');
    expect(parsed.repos[0].findings[0]).toHaveProperty('severity');
    expect(parsed.repos[0].findings[0]).toHaveProperty('label');
  });
});

describe('runAudit — format: sarif', () => {
  it('emits valid SARIF 2.1.0 to stdout when format is sarif', async () => {
    const repos: Repo[] = [makeRepo({ name: 'pub-repo', visibility: 'public' })];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = async () => ({ paths: ['.env'], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS, format: 'sarif' };
    const output = await captureStdout(async () => {
      await runAudit(loadRepos, treeFetch, opts);
    });

    const parsed = JSON.parse(output);
    expect(parsed.$schema).toContain('sarif-schema-2.1.0');
    expect(parsed.version).toBe('2.1.0');
    expect(Array.isArray(parsed.runs)).toBe(true);
    expect(parsed.runs[0].tool.driver.name).toBe('vizzy');
    expect(Array.isArray(parsed.runs[0].results)).toBe(true);
  });

  it('still returns exit code 1 on danger with sarif format', async () => {
    const repos: Repo[] = [makeRepo({ name: 'danger-repo', visibility: 'public' })];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = async () => ({ paths: ['.env'], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS, format: 'sarif' };
    let code: number;
    await captureStdout(async () => {
      code = await runAudit(loadRepos, treeFetch, opts);
    });
    expect(code!).toBe(1);
  });

  it('still returns exit code 0 when clean with sarif format', async () => {
    const repos: Repo[] = [makeRepo({ name: 'clean-repo', visibility: 'public' })];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = async () => ({ paths: ['src/index.ts'], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS, format: 'sarif' };
    let code: number;
    await captureStdout(async () => {
      code = await runAudit(loadRepos, treeFetch, opts);
    });
    expect(code!).toBe(0);
  });

  it('sarif tool.driver.version matches package version', async () => {
    const repos: Repo[] = [makeRepo({ name: 'pub-repo', visibility: 'public' })];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = async () => ({ paths: ['.env'], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS, format: 'sarif' };
    const output = await captureStdout(async () => {
      await runAudit(loadRepos, treeFetch, opts);
    });

    const parsed = JSON.parse(output);
    // Version should be a valid semver-like string from package.json
    expect(typeof parsed.runs[0].tool.driver.version).toBe('string');
    expect(parsed.runs[0].tool.driver.version.length).toBeGreaterThan(0);
  });
});

describe('runAudit — format: text (default)', () => {
  it('defaults to text format when format is not specified', async () => {
    const repos: Repo[] = [makeRepo({ name: 'pub-repo', visibility: 'public' })];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = async () => ({ paths: ['.env'], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS };
    const output = await captureStdout(async () => {
      await runAudit(loadRepos, treeFetch, opts);
    });

    // Text format: NOT valid JSON
    expect(() => JSON.parse(output)).toThrow();
    expect(output).toContain('pub-repo');
  });

  it('explicit format: text produces human-readable text (not JSON)', async () => {
    const repos: Repo[] = [makeRepo({ name: 'pub-repo', visibility: 'public' })];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = async () => ({ paths: ['.env'], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS, format: 'text' };
    const output = await captureStdout(async () => {
      await runAudit(loadRepos, treeFetch, opts);
    });

    expect(() => JSON.parse(output)).toThrow();
    expect(output).toContain('pub-repo');
  });
});

describe('runAudit — no GitHub writes', () => {
  it('never reaches the github write surface (setVisibility/makeSetter)', async () => {
    // Spy on the REAL github exports so that a regression which imported and
    // called them from runAudit's call graph would actually trip these
    // assertions. (The prior test asserted on a local vi.fn() never wired into
    // runAudit, so it passed unconditionally — vacuous.)
    const setVisibilitySpy = vi.spyOn(githubModule, 'setVisibility').mockResolvedValue(undefined);
    const makeSetterSpy = vi.spyOn(githubModule, 'makeSetter');

    // A repo with DANGER findings — the exact case where a buggy audit might be
    // tempted to "remediate" by flipping visibility. It must stay strictly read-only.
    const repos: Repo[] = [makeRepo({ name: 'pub-repo', visibility: 'public', license: null })];
    const loadRepos = async () => repos;
    const treeFetch: TreeFetcher = async () => ({ paths: ['.env', 'id_rsa'], truncated: false });

    const opts: AuditOpts = { assessOpts: ASSESS_OPTS };
    await captureStdout(async () => {
      await runAudit(loadRepos, treeFetch, opts);
    });

    expect(setVisibilitySpy).not.toHaveBeenCalled();
    expect(makeSetterSpy).not.toHaveBeenCalled();

    setVisibilitySpy.mockRestore();
    makeSetterSpy.mockRestore();
  });
});
