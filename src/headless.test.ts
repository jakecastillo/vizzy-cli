/**
 * headless.test.ts — runHeadless non-interactive apply + exit-code contract.
 *
 * All tests inject deps (no network). Tests encode the acceptance criteria
 * from bead vizzy-cli-9cm.4:
 *   - clean repos are always applied
 *   - caution repos applied only with --yes
 *   - danger repos SKIPPED (reported) without --force-public/--allow-danger
 *   - danger repos applied WITH --force-public or --allow-danger
 *   - --json output produces valid JSON
 *   - exit codes: 0 clean/caution applied, 1 danger or apply failure
 *   - unknown --repos names → exit 2
 *   - text output (default) contains repo names and status
 */

import { describe, it, expect, vi } from 'vitest';
import { runHeadless } from './headless.js';
import type { HeadlessDeps, HeadlessFlags, HeadlessOpts } from './headless.js';
import type { Repo } from './types.js';
import type { VisibilitySetter } from './types.js';

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

const BASE_OPTS: HeadlessOpts = {
  assessOpts: {
    staleMonths: 12,
    highProfileStars: 100,
    now: NOW,
  },
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

/** Capture stderr writes during the callback. */
async function captureStderr(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stderr.write;
  try {
    await fn();
  } finally {
    process.stderr.write = origWrite;
  }
  return chunks.join('');
}

function makeDeps(repos: Repo[], setter?: VisibilitySetter): HeadlessDeps {
  return {
    loadRepos: async () => repos,
    setter: setter ?? vi.fn().mockResolvedValue(undefined),
    treeFetch: async () => ({ paths: [], truncated: false }),
  };
}

// ---------------------------------------------------------------------------
// Tests — clean repos
// ---------------------------------------------------------------------------

describe('runHeadless — clean repos', () => {
  it('applies clean repos and returns exit code 0', async () => {
    const repo = makeRepo({ name: 'clean-repo', visibility: 'private' });
    const setter = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([repo], setter);

    const flags: HeadlessFlags = { target: 'public', allEligible: true };
    let code!: number;
    await captureStdout(async () => {
      code = await runHeadless(deps, flags, BASE_OPTS);
    });

    expect(setter).toHaveBeenCalledWith('octocat', 'clean-repo', 'public');
    expect(code).toBe(0);
  });

  it('text output contains the repo name', async () => {
    const repo = makeRepo({ name: 'my-clean-repo', visibility: 'private' });
    const deps = makeDeps([repo]);

    const flags: HeadlessFlags = { target: 'public', allEligible: true };
    const output = await captureStdout(async () => {
      await runHeadless(deps, flags, BASE_OPTS);
    });

    expect(output).toContain('my-clean-repo');
  });
});

// ---------------------------------------------------------------------------
// Tests — caution repos
// ---------------------------------------------------------------------------

describe('runHeadless — caution repos', () => {
  it('does NOT apply caution repos without --yes (returns 0, skips)', async () => {
    // no-license triggers caution
    const repo = makeRepo({ name: 'caution-repo', visibility: 'private', license: null });
    const setter = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([repo], setter);

    const flags: HeadlessFlags = { target: 'public', allEligible: true };
    let code!: number;
    await captureStdout(async () => {
      code = await runHeadless(deps, flags, BASE_OPTS);
    });

    expect(setter).not.toHaveBeenCalled();
    // Exit 0: no danger, just skipped caution
    expect(code).toBe(0);
  });

  it('applies caution repos WITH --yes and returns 0', async () => {
    const repo = makeRepo({ name: 'caution-repo', visibility: 'private', license: null });
    const setter = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([repo], setter);

    const flags: HeadlessFlags = { target: 'public', allEligible: true, yes: true };
    let code!: number;
    await captureStdout(async () => {
      code = await runHeadless(deps, flags, BASE_OPTS);
    });

    expect(setter).toHaveBeenCalledWith('octocat', 'caution-repo', 'public');
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — danger repos
// ---------------------------------------------------------------------------

describe('runHeadless — danger repos', () => {
  it('skips danger repos without --force-public/--allow-danger and returns 1', async () => {
    // .env triggers danger
    const repo = makeRepo({ name: 'danger-repo', visibility: 'private' });
    const setter = vi.fn().mockResolvedValue(undefined);
    const deps = {
      loadRepos: async () => [repo],
      setter,
      treeFetch: async () => ({ paths: ['.env'], truncated: false }),
    };

    const flags: HeadlessFlags = { target: 'public', allEligible: true };
    let code!: number;
    await captureStdout(async () => {
      code = await runHeadless(deps, flags, BASE_OPTS);
    });

    expect(setter).not.toHaveBeenCalled();
    // Exit 1: danger finding was skipped (danger present)
    expect(code).toBe(1);
  });

  it('applies danger repos WITH --force-public and returns 0 on success', async () => {
    const repo = makeRepo({ name: 'danger-repo', visibility: 'private' });
    const setter = vi.fn().mockResolvedValue(undefined);
    const deps = {
      loadRepos: async () => [repo],
      setter,
      treeFetch: async () => ({ paths: ['.env'], truncated: false }),
    };

    const flags: HeadlessFlags = { target: 'public', allEligible: true, forcePublic: true };
    let code!: number;
    await captureStdout(async () => {
      code = await runHeadless(deps, flags, BASE_OPTS);
    });

    expect(setter).toHaveBeenCalledWith('octocat', 'danger-repo', 'public');
    expect(code).toBe(0);
  });

  it('--json + a skipped danger repo emits valid JSON and still exits 1', async () => {
    const repo = makeRepo({ name: 'danger-repo', visibility: 'private' });
    const setter = vi.fn().mockResolvedValue(undefined);
    const deps = {
      loadRepos: async () => [repo],
      setter,
      treeFetch: async () => ({ paths: ['.env'], truncated: false }),
    };

    const flags: HeadlessFlags = { target: 'public', allEligible: true, json: true };
    let code!: number;
    const out = await captureStdout(async () => {
      code = await runHeadless(deps, flags, BASE_OPTS);
    });

    // Machine output is valid JSON...
    expect(() => JSON.parse(out)).not.toThrow();
    // ...the danger repo was NOT applied...
    expect(setter).not.toHaveBeenCalled();
    // ...and the exit code still honors the contract (danger present → 1).
    expect(code).toBe(1);
  });

  it('applies danger repos WITH --allow-danger and returns 0 on success', async () => {
    const repo = makeRepo({ name: 'danger-repo', visibility: 'private' });
    const setter = vi.fn().mockResolvedValue(undefined);
    const deps = {
      loadRepos: async () => [repo],
      setter,
      treeFetch: async () => ({ paths: ['.env'], truncated: false }),
    };

    const flags: HeadlessFlags = { target: 'public', allEligible: true, allowDanger: true };
    let code!: number;
    await captureStdout(async () => {
      code = await runHeadless(deps, flags, BASE_OPTS);
    });

    expect(setter).toHaveBeenCalledWith('octocat', 'danger-repo', 'public');
    expect(code).toBe(0);
  });

  it('reports skipped danger repos in text output', async () => {
    const repo = makeRepo({ name: 'secret-repo', visibility: 'private' });
    const deps = {
      loadRepos: async () => [repo],
      setter: vi.fn().mockResolvedValue(undefined),
      treeFetch: async () => ({ paths: ['.env'], truncated: false }),
    };

    const flags: HeadlessFlags = { target: 'public', allEligible: true };
    const output = await captureStdout(async () => {
      await runHeadless(deps, flags, BASE_OPTS);
    });

    expect(output).toContain('secret-repo');
  });
});

// ---------------------------------------------------------------------------
// Tests — --json output
// ---------------------------------------------------------------------------

describe('runHeadless — --json output', () => {
  it('emits valid JSON to stdout when --json is set', async () => {
    const repo = makeRepo({ name: 'pub-repo', visibility: 'private' });
    const deps = makeDeps([repo]);

    const flags: HeadlessFlags = { target: 'public', allEligible: true, json: true };
    const output = await captureStdout(async () => {
      await runHeadless(deps, flags, BASE_OPTS);
    });

    const parsed = JSON.parse(output);
    expect(parsed).toBeDefined();
    expect(typeof parsed).toBe('object');
  });

  it('json output contains repos array', async () => {
    const repo = makeRepo({ name: 'pub-repo', visibility: 'private' });
    const deps = makeDeps([repo]);

    const flags: HeadlessFlags = { target: 'public', allEligible: true, json: true };
    const output = await captureStdout(async () => {
      await runHeadless(deps, flags, BASE_OPTS);
    });

    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed.repos)).toBe(true);
  });

  it('json contains applied status for clean repos', async () => {
    const repo = makeRepo({ name: 'clean-repo', visibility: 'private' });
    const setter = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([repo], setter);

    const flags: HeadlessFlags = { target: 'public', allEligible: true, json: true };
    const output = await captureStdout(async () => {
      await runHeadless(deps, flags, BASE_OPTS);
    });

    const parsed = JSON.parse(output);
    const entry = parsed.repos.find((r: { name: string }) => r.name === 'clean-repo');
    expect(entry).toBeDefined();
    expect(entry.applied).toBe(true);
  });

  it('json contains skipped status for danger repos without flag', async () => {
    const repo = makeRepo({ name: 'danger-repo', visibility: 'private' });
    const deps = {
      loadRepos: async () => [repo],
      setter: vi.fn().mockResolvedValue(undefined),
      treeFetch: async () => ({ paths: ['.env'], truncated: false }),
    };

    const flags: HeadlessFlags = { target: 'public', allEligible: true, json: true };
    const output = await captureStdout(async () => {
      await runHeadless(deps, flags, BASE_OPTS);
    });

    const parsed = JSON.parse(output);
    const entry = parsed.repos.find((r: { name: string }) => r.name === 'danger-repo');
    expect(entry).toBeDefined();
    expect(entry.applied).toBe(false);
    expect(entry.skipped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — --repos spec / unknown names
// ---------------------------------------------------------------------------

describe('runHeadless — --repos selection', () => {
  it('only applies repos listed in --repos', async () => {
    const repoA = makeRepo({ name: 'alpha', visibility: 'private' });
    const repoB = makeRepo({ name: 'beta', visibility: 'private' });
    const setter = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([repoA, repoB], setter);

    const flags: HeadlessFlags = { target: 'public', repos: ['alpha'] };
    let code!: number;
    await captureStdout(async () => {
      code = await runHeadless(deps, flags, BASE_OPTS);
    });

    expect(setter).toHaveBeenCalledTimes(1);
    expect(setter).toHaveBeenCalledWith('octocat', 'alpha', 'public');
    expect(code).toBe(0);
  });

  it('returns exit code 2 when --repos contains unknown names', async () => {
    const repo = makeRepo({ name: 'alpha', visibility: 'private' });
    const setter = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([repo], setter);

    const flags: HeadlessFlags = { target: 'public', repos: ['alpha', 'does-not-exist'] };
    let code!: number;
    // Should write to stderr with unknown name
    const errOutput = await captureStderr(async () => {
      await captureStdout(async () => {
        code = await runHeadless(deps, flags, BASE_OPTS);
      });
    });

    expect(code).toBe(2);
    expect(errOutput).toContain('does-not-exist');
    // setter should not have been called at all
    expect(setter).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — apply failure exit code
// ---------------------------------------------------------------------------

describe('runHeadless — apply failure', () => {
  it('returns exit code 1 when apply fails for any repo', async () => {
    const repo = makeRepo({ name: 'fail-repo', visibility: 'private' });
    const setter = vi.fn().mockRejectedValue(new Error('API error'));
    const deps = makeDeps([repo], setter);

    const flags: HeadlessFlags = { target: 'public', allEligible: true };
    let code!: number;
    await captureStdout(async () => {
      code = await runHeadless(deps, flags, BASE_OPTS);
    });

    expect(code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — no eligible repos
// ---------------------------------------------------------------------------

describe('runHeadless — no eligible repos', () => {
  it('returns exit code 0 and no setter calls when no repos match target', async () => {
    // repos are already public — so eligibleRepos(repos, 'public') = []
    const repo = makeRepo({ name: 'already-public', visibility: 'public' });
    const setter = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([repo], setter);

    const flags: HeadlessFlags = { target: 'public', allEligible: true };
    let code!: number;
    await captureStdout(async () => {
      code = await runHeadless(deps, flags, BASE_OPTS);
    });

    expect(setter).not.toHaveBeenCalled();
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — no selection spec → exit 2
// ---------------------------------------------------------------------------

describe('runHeadless — missing selection', () => {
  it('returns exit code 2 when neither --repos nor --all-eligible is given', async () => {
    const repo = makeRepo({ name: 'alpha', visibility: 'private' });
    const setter = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([repo], setter);

    // Neither repos nor allEligible — no selection spec
    const flags: HeadlessFlags = { target: 'public' };
    let code!: number;
    const errOutput = await captureStderr(async () => {
      await captureStdout(async () => {
        code = await runHeadless(deps, flags, BASE_OPTS);
      });
    });

    expect(code).toBe(2);
    expect(errOutput.length).toBeGreaterThan(0);
    expect(setter).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — guard wiring (final-review fixes): .vizzyignore + .vizzyscan + fail-safe
// ---------------------------------------------------------------------------

describe('runHeadless — guards (.vizzyignore / .vizzyscan / fail-safe)', () => {
  it('drops a .vizzyignore-protected repo from a public switch (never applied), exit 0', async () => {
    const setter = vi.fn().mockResolvedValue(undefined);
    const deps: HeadlessDeps = {
      loadRepos: async () => [makeRepo({ name: 'secret-repo', visibility: 'private' })],
      setter,
      treeFetch: async () => ({ paths: [], truncated: false }),
    };
    const flags: HeadlessFlags = { target: 'public', repos: ['secret-repo'], yes: true, protect: true };
    const opts: HeadlessOpts = { ...BASE_OPTS, protectPatterns: ['secret-repo'] };
    let code!: number;
    const out = await captureStdout(async () => {
      code = await runHeadless(deps, flags, opts);
    });
    expect(setter).not.toHaveBeenCalled(); // protected repo is never exposed
    expect(out.toLowerCase()).toContain('protected');
    expect(code).toBe(0); // a protected skip is intentional, not a failure
  });

  it('--no-protect lets a protected repo through (protect:false)', async () => {
    const setter = vi.fn().mockResolvedValue(undefined);
    const deps: HeadlessDeps = {
      loadRepos: async () => [makeRepo({ name: 'secret-repo', visibility: 'private' })],
      setter,
      treeFetch: async () => ({ paths: [], truncated: false }),
    };
    const flags: HeadlessFlags = { target: 'public', repos: ['secret-repo'], yes: true, protect: false };
    const opts: HeadlessOpts = { ...BASE_OPTS, protectPatterns: ['secret-repo'] };
    let code!: number;
    await captureStdout(async () => {
      code = await runHeadless(deps, flags, opts);
    });
    expect(setter).toHaveBeenCalledWith('octocat', 'secret-repo', 'public');
    expect(code).toBe(0);
  });

  it('applies custom .vizzyscan deny rules (a custom-danger file is skipped), exit 1', async () => {
    const setter = vi.fn().mockResolvedValue(undefined);
    const deps: HeadlessDeps = {
      loadRepos: async () => [makeRepo({ name: 'app', visibility: 'private' })],
      setter,
      treeFetch: async () => ({ paths: ['config/app.myco-secret'], truncated: false }),
    };
    const flags: HeadlessFlags = { target: 'public', allEligible: true };
    const opts: HeadlessOpts = { ...BASE_OPTS, scanRules: { deny: ['*.myco-secret'], allow: [] } };
    let code!: number;
    await captureStdout(async () => {
      code = await runHeadless(deps, flags, opts);
    });
    expect(setter).not.toHaveBeenCalled(); // custom-deny → danger → skipped (no --allow-danger)
    expect(code).toBe(1);
  });

  it('fail-safe: a treeFetch rejection degrades to scan-incomplete (caution), NOT applied without --yes', async () => {
    const setter = vi.fn().mockResolvedValue(undefined);
    const deps: HeadlessDeps = {
      loadRepos: async () => [makeRepo({ name: 'r', visibility: 'private' })],
      setter,
      treeFetch: async () => {
        throw new Error('network');
      },
    };
    const flags: HeadlessFlags = { target: 'public', allEligible: true }; // no --yes
    let code!: number;
    await captureStdout(async () => {
      code = await runHeadless(deps, flags, BASE_OPTS);
    });
    expect(setter).not.toHaveBeenCalled(); // a failed scan never silently applies
    expect(code).toBe(0); // caution skipped (not danger) → no failure
  });
});
