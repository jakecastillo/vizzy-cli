/**
 * check.test.ts — runCheck pre-publish readiness command.
 *
 * All tests inject loaders/fetchers (no network).
 *
 * Acceptance criteria (bead vizzy-cli-9cm.9):
 *   - ready repo (clean tree, has LICENSE + README, no large files) → exit 0
 *   - repo with danger finding (e.g., .env) → exit 1 with the item named
 *   - repo with large file (blob size > 50 MB) → exit 1 with the item named
 *   - repo with missing license → exit 1 with the item named
 *   - repo with missing community files (README, CONTRIBUTING, CODE_OF_CONDUCT) → exit 1 with item named
 *   - error loading repo metadata → exit 3
 *   - output is a checklist (pass/fail per check)
 */

import { describe, it, expect } from 'vitest';
import { runCheck } from './check.js';
import type { CheckDeps, CheckOpts } from './check.js';
import type { Repo } from './types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    name: 'my-repo',
    owner: 'octocat',
    visibility: 'public',
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

const BASE_OPTS: CheckOpts = {
  assessOpts: {
    staleMonths: 12,
    highProfileStars: 100,
    now: NOW,
  },
};

/** A tree that looks "healthy": no secrets, has LICENSE, README, CONTRIBUTING, CODE_OF_CONDUCT, small files. */
const READY_TREE = [
  { path: 'LICENSE', size: 1024 },
  { path: 'README.md', size: 2048 },
  { path: 'CONTRIBUTING.md', size: 512 },
  { path: 'CODE_OF_CONDUCT.md', size: 256 },
  { path: 'src/index.ts', size: 512 },
];

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

function makeDeps(overrides: Partial<CheckDeps> = {}): CheckDeps {
  return {
    loadRepo: async () => makeRepo(),
    treeFetch: async () => ({
      items: READY_TREE,
      truncated: false,
    }),
    contentFetcher: async () => '',
    historyFetcher: async () => ({ paths: [], truncated: false }),
    scanRulesText: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — ready repo → exit 0
// ---------------------------------------------------------------------------

describe('runCheck — ready repo', () => {
  it('returns exit code 0 for a fully ready repo', async () => {
    const deps = makeDeps();
    let code!: number;
    await captureStdout(async () => {
      code = await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(code).toBe(0);
  });

  it('prints a checklist to stdout', async () => {
    const deps = makeDeps();
    const output = await captureStdout(async () => {
      await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    // Should have some checkmark-like indicators
    expect(output.length).toBeGreaterThan(0);
    // Should mention the repo
    expect(output).toContain('my-repo');
  });

  it('output contains pass indicator for LICENSE when present', async () => {
    const deps = makeDeps();
    const output = await captureStdout(async () => {
      await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(output.toLowerCase()).toContain('license');
  });

  it('output contains pass indicator for README when present', async () => {
    const deps = makeDeps();
    const output = await captureStdout(async () => {
      await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(output.toLowerCase()).toContain('readme');
  });
});

// ---------------------------------------------------------------------------
// Tests — danger finding → exit 1 with item named
// ---------------------------------------------------------------------------

describe('runCheck — danger finding', () => {
  it('returns exit code 1 when a secret file is detected', async () => {
    const deps = makeDeps({
      treeFetch: async () => ({
        items: [
          { path: 'LICENSE', size: 1024 },
          { path: 'README.md', size: 2048 },
          { path: '.env', size: 100 }, // danger
        ],
        truncated: false,
      }),
    });
    let code!: number;
    await captureStdout(async () => {
      code = await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(code).toBe(1);
  });

  it('names the danger file in the output', async () => {
    const deps = makeDeps({
      treeFetch: async () => ({
        items: [
          { path: 'LICENSE', size: 1024 },
          { path: 'README.md', size: 2048 },
          { path: '.env', size: 100 },
        ],
        truncated: false,
      }),
    });
    const output = await captureStdout(async () => {
      await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(output).toContain('.env');
  });
});

// ---------------------------------------------------------------------------
// Tests — large file → exit 1 with item named
// ---------------------------------------------------------------------------

describe('runCheck — truncated history window', () => {
  it('returns exit code 1 and a NOT READY history row when the commit window is capped', async () => {
    // Otherwise-ready repo; the only problem is that history was truncated, so a
    // secret committed-then-deleted beyond the window would not be seen. A clean
    // history must NOT be reported as an all-clear.
    const deps = makeDeps({
      historyFetcher: async () => ({ paths: [], truncated: true }),
    });
    let code!: number;
    const output = await captureStdout(async () => {
      code = await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(code).toBe(1);
    expect(output).toContain('NOT READY');
    expect(output.toLowerCase()).toContain('history');
  });

  it('a non-truncated clean history keeps the repo READY', async () => {
    const deps = makeDeps({
      historyFetcher: async () => ({ paths: [], truncated: false }),
    });
    let code!: number;
    await captureStdout(async () => {
      code = await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(code).toBe(0);
  });
});

describe('runCheck — large file', () => {
  it('returns exit code 1 when a blob is larger than 50 MB', async () => {
    const FIFTY_MB_PLUS_ONE = 50 * 1024 * 1024 + 1;
    const deps = makeDeps({
      treeFetch: async () => ({
        items: [
          { path: 'LICENSE', size: 1024 },
          { path: 'README.md', size: 2048 },
          { path: 'big-file.bin', size: FIFTY_MB_PLUS_ONE },
        ],
        truncated: false,
      }),
    });
    let code!: number;
    await captureStdout(async () => {
      code = await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(code).toBe(1);
  });

  it('names the large file in the output', async () => {
    const FIFTY_MB_PLUS_ONE = 50 * 1024 * 1024 + 1;
    const deps = makeDeps({
      treeFetch: async () => ({
        items: [
          { path: 'LICENSE', size: 1024 },
          { path: 'README.md', size: 2048 },
          { path: 'big-file.bin', size: FIFTY_MB_PLUS_ONE },
        ],
        truncated: false,
      }),
    });
    const output = await captureStdout(async () => {
      await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(output).toContain('big-file.bin');
  });

  it('accepts files exactly at 50 MB as NOT large', async () => {
    const EXACTLY_50MB = 50 * 1024 * 1024;
    const deps = makeDeps({
      treeFetch: async () => ({
        items: [
          { path: 'LICENSE', size: 1024 },
          { path: 'README.md', size: 2048 },
          { path: 'CONTRIBUTING.md', size: 512 },
          { path: 'CODE_OF_CONDUCT.md', size: 256 },
          { path: 'ok-file.bin', size: EXACTLY_50MB },
        ],
        truncated: false,
      }),
    });
    let code!: number;
    await captureStdout(async () => {
      code = await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    // Exactly 50 MB is NOT over the threshold
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — missing license → exit 1
// ---------------------------------------------------------------------------

describe('runCheck — missing license', () => {
  it('returns exit code 1 when repo metadata has no license', async () => {
    const deps = makeDeps({
      loadRepo: async () => makeRepo({ license: null }),
    });
    let code!: number;
    await captureStdout(async () => {
      code = await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(code).toBe(1);
  });

  it('names missing license in the output', async () => {
    const deps = makeDeps({
      loadRepo: async () => makeRepo({ license: null }),
    });
    const output = await captureStdout(async () => {
      await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(output.toLowerCase()).toContain('license');
  });

  it('also returns exit code 1 when LICENSE file is absent from tree (even if metadata has license)', async () => {
    const deps = makeDeps({
      treeFetch: async () => ({
        items: [
          { path: 'README.md', size: 2048 },
          // No LICENSE file
        ],
        truncated: false,
      }),
    });
    let code!: number;
    await captureStdout(async () => {
      code = await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — missing community files → exit 1
// ---------------------------------------------------------------------------

describe('runCheck — missing community files', () => {
  it('returns exit code 1 when README is missing from tree', async () => {
    const deps = makeDeps({
      treeFetch: async () => ({
        items: [
          { path: 'LICENSE', size: 1024 },
          // No README
        ],
        truncated: false,
      }),
    });
    let code!: number;
    await captureStdout(async () => {
      code = await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(code).toBe(1);
  });

  it('names the missing README in the output', async () => {
    const deps = makeDeps({
      treeFetch: async () => ({
        items: [{ path: 'LICENSE', size: 1024 }],
        truncated: false,
      }),
    });
    const output = await captureStdout(async () => {
      await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(output.toLowerCase()).toContain('readme');
  });

  it('returns exit code 1 when CONTRIBUTING is missing', async () => {
    const deps = makeDeps({
      treeFetch: async () => ({
        items: [
          { path: 'LICENSE', size: 1024 },
          { path: 'README.md', size: 2048 },
          // No CONTRIBUTING
        ],
        truncated: false,
      }),
    });
    let code!: number;
    await captureStdout(async () => {
      code = await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(code).toBe(1);
  });

  it('names the missing CONTRIBUTING in the output', async () => {
    const deps = makeDeps({
      treeFetch: async () => ({
        items: [
          { path: 'LICENSE', size: 1024 },
          { path: 'README.md', size: 2048 },
        ],
        truncated: false,
      }),
    });
    const output = await captureStdout(async () => {
      await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(output.toLowerCase()).toContain('contributing');
  });

  it('returns exit code 1 when CODE_OF_CONDUCT is missing', async () => {
    const deps = makeDeps({
      treeFetch: async () => ({
        items: [
          { path: 'LICENSE', size: 1024 },
          { path: 'README.md', size: 2048 },
          { path: 'CONTRIBUTING.md', size: 512 },
          // No CODE_OF_CONDUCT
        ],
        truncated: false,
      }),
    });
    let code!: number;
    await captureStdout(async () => {
      code = await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(code).toBe(1);
  });

  it('names the missing CODE_OF_CONDUCT in the output', async () => {
    const deps = makeDeps({
      treeFetch: async () => ({
        items: [
          { path: 'LICENSE', size: 1024 },
          { path: 'README.md', size: 2048 },
          { path: 'CONTRIBUTING.md', size: 512 },
        ],
        truncated: false,
      }),
    });
    const output = await captureStdout(async () => {
      await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(output.toLowerCase()).toContain('code_of_conduct');
  });

  it('returns exit code 0 when all community files are present', async () => {
    const deps = makeDeps({
      treeFetch: async () => ({
        items: [
          { path: 'LICENSE', size: 1024 },
          { path: 'README.md', size: 2048 },
          { path: 'CONTRIBUTING.md', size: 512 },
          { path: 'CODE_OF_CONDUCT.md', size: 256 },
        ],
        truncated: false,
      }),
    });
    let code!: number;
    await captureStdout(async () => {
      code = await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — error loading repo → exit 3
// ---------------------------------------------------------------------------

describe('runCheck — error path', () => {
  it('returns exit code 3 when loadRepo throws', async () => {
    const deps = makeDeps({
      loadRepo: async () => {
        throw new Error('Network error');
      },
    });
    let code!: number;
    await captureStdout(async () => {
      code = await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(code).toBe(3);
  });

  it('returns exit code 3 when treeFetch throws', async () => {
    const deps = makeDeps({
      treeFetch: async () => {
        throw new Error('Tree fetch error');
      },
    });
    let code!: number;
    await captureStdout(async () => {
      code = await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(code).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Tests — content hit (secret-content) via injected contentFetcher → exit 1
// ---------------------------------------------------------------------------

describe('runCheck — content scan (deep, always-on)', () => {
  it('produces a secret-content finding (not just the filename match) when a real key is in content', async () => {
    let fetched = '';
    const deps = makeDeps({
      treeFetch: async () => ({
        items: [
          { path: 'LICENSE', size: 1024 },
          { path: 'README.md', size: 2048 },
          { path: 'CONTRIBUTING.md', size: 512 },
          { path: 'CODE_OF_CONDUCT.md', size: 256 },
          // A suspicious filename that the content scan will fetch + scan.
          { path: '.env.local', size: 100 },
        ],
        truncated: false,
      }),
      contentFetcher: async (_repo, path) => {
        fetched = path;
        // A VALID AWS access key id: AKIA + exactly 16 [0-9A-Z]. The previous
        // fixture had trailing chars so it never matched /\bAKIA[0-9A-Z]{16}\b/,
        // making the secret-content path silently untested.
        return 'const k = "AKIAIOSFODNN7EXAMPLE";';
      },
    });
    let code!: number;
    const out = await captureStdout(async () => {
      code = await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(code).toBe(1);
    // The content fetcher actually ran on the suspicious file...
    expect(fetched).toBe('.env.local');
    // ...and a content secret was reported (proves the secret-content path, not
    // only the secret-file filename match).
    expect(out).toContain('Secret in content');
  });
});

// ---------------------------------------------------------------------------
// Tests — history hit (secret-in-history) via injected historyFetcher → exit 1
// ---------------------------------------------------------------------------

describe('runCheck — history scan (deep, always-on)', () => {
  it('returns exit code 1 when history scan finds a previously-sensitive file', async () => {
    const deps = makeDeps({
      treeFetch: async () => ({
        items: [
          { path: 'LICENSE', size: 1024 },
          { path: 'README.md', size: 2048 },
          { path: 'CONTRIBUTING.md', size: 512 },
          { path: 'CODE_OF_CONDUCT.md', size: 256 },
          // .env was deleted from HEAD — no longer in current tree
        ],
        truncated: false,
      }),
      historyFetcher: async () => ({
        paths: ['.env'], // was committed historically
        truncated: false,
      }),
    });
    let code!: number;
    await captureStdout(async () => {
      code = await runCheck('octocat/my-repo', deps, BASE_OPTS);
    });
    expect(code).toBe(1);
  });
});
