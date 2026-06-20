/**
 * archive.test.ts — runArchive headless archive/unarchive flow.
 *
 * All tests inject deps (no network). Acceptance criteria for bead
 * vizzy-cli-9cm.12:
 *   - --archive selects repos that are NOT archived and calls setArchived(..., true)
 *   - --unarchive selects repos that ARE archived and calls setArchived(..., false)
 *   - apply failure → exit 1
 *   - unknown --repos name → exit 2
 *   - no selection spec (no --repos / --all-eligible) and no TTY → exit 2 with guidance
 *   - --json emits valid JSON
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runArchive } from './archive.js';
import type { ArchiveDeps, ArchiveFlags } from './archive.js';
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
    forksCount: 0,
    pushedAt: '2026-05-01T00:00:00Z',
    defaultBranch: 'main',
    license: 'MIT',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

type SetArchivedFn = (owner: string, name: string, archived: boolean) => Promise<void>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDeps(repos: Repo[], setArchivedSpy?: any): ArchiveDeps {
  return {
    loadRepos: async () => repos,
    setArchived: (setArchivedSpy as SetArchivedFn) ?? (vi.fn(async () => {}) as unknown as SetArchivedFn),
  };
}

// ---------------------------------------------------------------------------
// Stub: isTTY — force non-TTY so headless path is required
// ---------------------------------------------------------------------------
let origIsTTY: boolean | undefined;

beforeEach(() => {
  origIsTTY = process.stdin.isTTY;
  // Force non-TTY so the "require explicit selector" guard is testable
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
});

afterEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
});

// ---------------------------------------------------------------------------
// Tests — --archive selects non-archived repos
// ---------------------------------------------------------------------------

describe('runArchive — requires --yes to apply', () => {
  it('a selection without --yes must NOT archive anything and returns exit 2', async () => {
    // Archive has no interactive confirmation path; --yes is the only safety
    // gate. `vizzy --archive --all-eligible` without it must refuse, not
    // bulk-archive every eligible repo (account-wide read-only) silently.
    const spy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([makeRepo({ name: 'active', isArchived: false })], spy);

    let code!: number;
    const err = await captureStderr(async () => {
      await captureStdout(async () => {
        code = await runArchive(deps, { archive: true, allEligible: true });
      });
    });

    expect(code).toBe(2);
    expect(spy).not.toHaveBeenCalled();
    expect(err.toLowerCase()).toContain('--yes');
  });

  it('the same selection WITH --yes applies and returns 0', async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([makeRepo({ name: 'active', isArchived: false })], spy);

    let code!: number;
    await captureStdout(async () => {
      code = await runArchive(deps, { archive: true, allEligible: true, yes: true });
    });

    expect(code).toBe(0);
    expect(spy).toHaveBeenCalledWith('octocat', 'active', true);
  });
});

describe('runArchive — --archive', () => {
  it('selects non-archived repos and calls setArchived with true', async () => {
    const active = makeRepo({ name: 'active-repo', isArchived: false });
    const alreadyArchived = makeRepo({ name: 'already-archived', isArchived: true });
    const spy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([active, alreadyArchived], spy);

    const flags: ArchiveFlags = { archive: true, allEligible: true, yes: true };
    let code!: number;
    await captureStdout(async () => {
      code = await runArchive(deps, flags);
    });

    // Only the non-archived repo should be targeted
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('octocat', 'active-repo', true);
    expect(code).toBe(0);
  });

  it('does NOT call setArchived for already-archived repos under --archive', async () => {
    const alreadyArchived = makeRepo({ name: 'already-archived', isArchived: true });
    const spy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([alreadyArchived], spy);

    const flags: ArchiveFlags = { archive: true, allEligible: true, yes: true };
    let code!: number;
    await captureStdout(async () => {
      code = await runArchive(deps, flags);
    });

    expect(spy).not.toHaveBeenCalled();
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — --unarchive selects archived repos
// ---------------------------------------------------------------------------

describe('runArchive — --unarchive', () => {
  it('selects archived repos and calls setArchived with false', async () => {
    const active = makeRepo({ name: 'active-repo', isArchived: false });
    const archived = makeRepo({ name: 'archived-repo', isArchived: true });
    const spy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([active, archived], spy);

    const flags: ArchiveFlags = { unarchive: true, allEligible: true, yes: true };
    let code!: number;
    await captureStdout(async () => {
      code = await runArchive(deps, flags);
    });

    // Only the archived repo should be targeted
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('octocat', 'archived-repo', false);
    expect(code).toBe(0);
  });

  it('does NOT call setArchived for non-archived repos under --unarchive', async () => {
    const active = makeRepo({ name: 'active-repo', isArchived: false });
    const spy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([active], spy);

    const flags: ArchiveFlags = { unarchive: true, allEligible: true, yes: true };
    let code!: number;
    await captureStdout(async () => {
      code = await runArchive(deps, flags);
    });

    expect(spy).not.toHaveBeenCalled();
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — apply failure → exit 1
// ---------------------------------------------------------------------------

describe('runArchive — apply failure', () => {
  it('returns exit code 1 when setArchived rejects for any repo', async () => {
    const repo = makeRepo({ name: 'fail-repo', isArchived: false });
    const spy = vi.fn().mockRejectedValue(new Error('GitHub API error'));
    const deps = makeDeps([repo], spy);

    const flags: ArchiveFlags = { archive: true, allEligible: true, yes: true };
    let code!: number;
    await captureStdout(async () => {
      code = await runArchive(deps, flags);
    });

    expect(code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — unknown --repos name → exit 2
// ---------------------------------------------------------------------------

describe('runArchive — unknown --repos', () => {
  it('returns exit code 2 and writes to stderr when --repos contains unknown name', async () => {
    const repo = makeRepo({ name: 'known-repo', isArchived: false });
    const spy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([repo], spy);

    const flags: ArchiveFlags = { archive: true, repos: ['known-repo', 'ghost-repo'], yes: true };
    let code!: number;
    const errOutput = await captureStderr(async () => {
      await captureStdout(async () => {
        code = await runArchive(deps, flags);
      });
    });

    expect(code).toBe(2);
    expect(errOutput).toContain('ghost-repo');
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — no selection + no TTY → exit 2 with guidance
// ---------------------------------------------------------------------------

describe('runArchive — missing selection', () => {
  it('returns exit code 2 with guidance when no --repos / --all-eligible and no TTY', async () => {
    const repo = makeRepo({ name: 'some-repo', isArchived: false });
    const spy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([repo], spy);

    // No selection flags at all
    const flags: ArchiveFlags = { archive: true };
    let code!: number;
    const errOutput = await captureStderr(async () => {
      await captureStdout(async () => {
        code = await runArchive(deps, flags);
      });
    });

    expect(code).toBe(2);
    expect(errOutput.length).toBeGreaterThan(0);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — --repos selects by name (from eligible pool)
// ---------------------------------------------------------------------------

describe('runArchive — --repos selection', () => {
  it('only archives repos listed in --repos', async () => {
    const repoA = makeRepo({ name: 'alpha', isArchived: false });
    const repoB = makeRepo({ name: 'beta', isArchived: false });
    const spy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([repoA, repoB], spy);

    const flags: ArchiveFlags = { archive: true, repos: ['alpha'], yes: true };
    let code!: number;
    await captureStdout(async () => {
      code = await runArchive(deps, flags);
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('octocat', 'alpha', true);
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — --json output
// ---------------------------------------------------------------------------

describe('runArchive — --json output', () => {
  it('emits valid JSON when --json is set', async () => {
    const repo = makeRepo({ name: 'json-repo', isArchived: false });
    const spy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([repo], spy);

    const flags: ArchiveFlags = { archive: true, allEligible: true, yes: true, json: true };
    let code!: number;
    const output = await captureStdout(async () => {
      code = await runArchive(deps, flags);
    });

    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed.repos)).toBe(true);
    expect(code).toBe(0);
  });

  it('json output contains applied: true for successfully archived repo', async () => {
    const repo = makeRepo({ name: 'json-repo', isArchived: false });
    const spy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([repo], spy);

    const flags: ArchiveFlags = { archive: true, allEligible: true, yes: true, json: true };
    let code!: number;
    const output = await captureStdout(async () => {
      code = await runArchive(deps, flags);
    });

    const parsed = JSON.parse(output);
    const entry = parsed.repos.find((r: { name: string }) => r.name === 'json-repo');
    expect(entry).toBeDefined();
    expect(entry.applied).toBe(true);
    expect(code).toBe(0);
  });
});
