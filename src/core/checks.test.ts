import { describe, it, expect } from 'vitest';
import { assess } from './checks.js';
import type { AssessOptions, RepoAssessment } from './checks.js';
import type { Repo } from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    name: 'my-repo',
    owner: 'octocat',
    visibility: 'private',
    isFork: false,
    isArchived: false,
    stars: 0,
    pushedAt: '2025-01-01T00:00:00Z',
    defaultBranch: 'main',
    license: 'MIT',
    ...overrides,
  };
}

// "now" is fixed so thresholds are deterministic.
// staleMonths=12, highProfileStars=10, now = 2026-06-17
const NOW = new Date('2026-06-17T00:00:00Z');

const OPTS: AssessOptions = {
  staleMonths: 12,
  highProfileStars: 10,
  now: NOW,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findingKinds(r: RepoAssessment) {
  return r.findings.map((f) => f.kind);
}

// ---------------------------------------------------------------------------
// paths === null → scan-incomplete caution
// ---------------------------------------------------------------------------

describe('paths === null', () => {
  it('yields a scan-incomplete caution finding', () => {
    const r = assess(makeRepo(), null, OPTS);
    expect(findingKinds(r)).toContain('scan-incomplete');
    const f = r.findings.find((x) => x.kind === 'scan-incomplete')!;
    expect(f.severity).toBe('caution');
  });

  it('severity is at least caution', () => {
    const r = assess(makeRepo(), null, OPTS);
    expect(r.severity).toBe('caution');
  });

  it('requiredConfirm is phrase', () => {
    const r = assess(makeRepo(), null, OPTS);
    expect(r.requiredConfirm).toBe('phrase');
  });
});

// ---------------------------------------------------------------------------
// secret-file → danger finding
// ---------------------------------------------------------------------------

describe('secret-file finding', () => {
  it('emits a danger finding for .env in paths', () => {
    const r = assess(makeRepo(), ['.env', 'src/index.ts'], OPTS);
    const f = r.findings.find((x) => x.kind === 'secret-file');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('danger');
    expect(f!.detail).toContain('.env');
  });

  it('emits one finding per sensitive file', () => {
    const r = assess(makeRepo(), ['.env', 'id_rsa', 'README.md'], OPTS);
    const danger = r.findings.filter((x) => x.kind === 'secret-file');
    expect(danger).toHaveLength(2);
  });

  it('severity is danger when secret-file found', () => {
    const r = assess(makeRepo(), ['.env'], OPTS);
    expect(r.severity).toBe('danger');
  });

  it('requiredConfirm is name when danger', () => {
    const r = assess(makeRepo(), ['.env'], OPTS);
    expect(r.requiredConfirm).toBe('name');
  });
});

// ---------------------------------------------------------------------------
// no-license caution
// ---------------------------------------------------------------------------

describe('no-license finding', () => {
  it('emits caution finding when license is null', () => {
    const r = assess(makeRepo({ license: null }), [], OPTS);
    const f = r.findings.find((x) => x.kind === 'no-license');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('caution');
  });

  it('does not emit no-license when license is set', () => {
    const r = assess(makeRepo({ license: 'MIT' }), [], OPTS);
    expect(findingKinds(r)).not.toContain('no-license');
  });
});

// ---------------------------------------------------------------------------
// stale caution
// ---------------------------------------------------------------------------

describe('stale finding', () => {
  it('emits caution for a repo pushed more than staleMonths ago', () => {
    // 13 months before NOW
    const stale = new Date('2025-05-17T00:00:00Z').toISOString();
    const r = assess(makeRepo({ pushedAt: stale }), [], OPTS);
    const f = r.findings.find((x) => x.kind === 'stale');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('caution');
  });

  it('does not flag a recent repo', () => {
    // 1 month before NOW
    const recent = new Date('2026-05-17T00:00:00Z').toISOString();
    const r = assess(makeRepo({ pushedAt: recent }), [], OPTS);
    expect(findingKinds(r)).not.toContain('stale');
  });

  it('uses injected now and staleMonths (custom thresholds)', () => {
    const customNow = new Date('2026-01-01T00:00:00Z');
    const opts: AssessOptions = { staleMonths: 6, highProfileStars: 10, now: customNow };
    // 7 months before customNow
    const stale = new Date('2025-06-01T00:00:00Z').toISOString();
    const r = assess(makeRepo({ pushedAt: stale }), [], opts);
    expect(findingKinds(r)).toContain('stale');
  });
});

// ---------------------------------------------------------------------------
// high-profile caution
// ---------------------------------------------------------------------------

describe('high-profile finding', () => {
  it('emits caution when stars >= highProfileStars', () => {
    const r = assess(makeRepo({ stars: 10 }), [], OPTS);
    const f = r.findings.find((x) => x.kind === 'high-profile');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('caution');
  });

  it('does not flag below threshold', () => {
    const r = assess(makeRepo({ stars: 9 }), [], OPTS);
    expect(findingKinds(r)).not.toContain('high-profile');
  });

  it('uses injected highProfileStars', () => {
    const opts: AssessOptions = { staleMonths: 12, highProfileStars: 5, now: NOW };
    const r = assess(makeRepo({ stars: 5 }), [], opts);
    expect(findingKinds(r)).toContain('high-profile');
  });
});

// ---------------------------------------------------------------------------
// archived caution
// ---------------------------------------------------------------------------

describe('archived finding', () => {
  it('emits caution for archived repos', () => {
    const r = assess(makeRepo({ isArchived: true }), [], OPTS);
    const f = r.findings.find((x) => x.kind === 'archived');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('caution');
  });

  it('does not flag non-archived repos', () => {
    const r = assess(makeRepo({ isArchived: false }), [], OPTS);
    expect(findingKinds(r)).not.toContain('archived');
  });
});

// ---------------------------------------------------------------------------
// Severity precedence
// ---------------------------------------------------------------------------

describe('severity precedence', () => {
  it('danger beats caution: secret-file + no-license → danger', () => {
    const r = assess(makeRepo({ license: null }), ['.env'], OPTS);
    expect(r.severity).toBe('danger');
    expect(r.requiredConfirm).toBe('name');
  });

  it('caution beats clean: no-license alone → caution', () => {
    const r = assess(makeRepo({ license: null }), [], OPTS);
    expect(r.severity).toBe('caution');
    expect(r.requiredConfirm).toBe('phrase');
  });

  it('clean when no findings', () => {
    // Recent push, licensed, low stars, not archived, no secrets
    const recent = new Date('2026-05-01T00:00:00Z').toISOString();
    const r = assess(makeRepo({ pushedAt: recent, license: 'MIT', stars: 0, isArchived: false }), [], OPTS);
    expect(r.severity).toBe('clean');
    expect(r.requiredConfirm).toBe('y');
  });

  it('fail-safe: an otherwise-clean repo with a FAILED scan (null paths) is caution, never clean', () => {
    // The exact property that stops a failed scan from silently green-lighting:
    // a repo that would otherwise be clean must be bumped to caution when paths===null,
    // with scan-incomplete as its SOLE finding (no stale/license/etc. masking it).
    const recent = new Date('2026-05-01T00:00:00Z').toISOString();
    const r = assess(makeRepo({ pushedAt: recent, license: 'MIT', stars: 0, isArchived: false }), null, OPTS);
    expect(r.severity).toBe('caution');
    expect(r.requiredConfirm).toBe('phrase');
    expect(r.findings.map((f) => f.kind)).toEqual(['scan-incomplete']);
  });
});

// ---------------------------------------------------------------------------
// RepoAssessment.repo pass-through
// ---------------------------------------------------------------------------

describe('repo pass-through', () => {
  it('returns the original repo on the assessment', () => {
    const repo = makeRepo({ name: 'test-repo' });
    const r = assess(repo, [], OPTS);
    expect(r.repo).toBe(repo);
  });
});
