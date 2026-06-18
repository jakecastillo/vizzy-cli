/**
 * core/snapshot.test.ts — snapshot() and diffSnapshot() pure functions.
 *
 * Covers:
 *   - snapshot(): produces {repo -> {visibility, fingerprints}} from assessments
 *   - diffSnapshot(): newlyPublic, newFindings, resolved, first-run (no prior)
 */

import { describe, it, expect } from 'vitest';
import { snapshot, diffSnapshot } from './snapshot.js';
import type { SnapshotState } from './snapshot.js';
import type { RepoAssessment } from './checks.js';
import type { Repo } from '../types.js';

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

function makeAssessment(
  name: string,
  visibility: 'public' | 'private' = 'public',
  findings: Array<{ kind: string; detail?: string }> = [],
): RepoAssessment {
  const repo = makeRepo({ name, visibility });
  const hasDanger = findings.length > 0;
  return {
    repo,
    findings: findings.map((f) => ({
      kind: f.kind as RepoAssessment['findings'][number]['kind'],
      severity: 'danger' as const,
      label: f.kind,
      detail: f.detail,
    })),
    severity: hasDanger ? 'danger' : 'clean',
    requiredConfirm: hasDanger ? 'name' : 'y',
  };
}

// ---------------------------------------------------------------------------
// snapshot()
// ---------------------------------------------------------------------------

describe('snapshot()', () => {
  it('produces a record keyed by repo name', () => {
    const assessments = [
      makeAssessment('repo-a', 'public', []),
      makeAssessment('repo-b', 'private', []),
    ];
    const state = snapshot(assessments);
    expect(Object.keys(state)).toHaveLength(2);
    expect(state['repo-a']).toBeDefined();
    expect(state['repo-b']).toBeDefined();
  });

  it('records the visibility for each repo', () => {
    const assessments = [
      makeAssessment('pub-repo', 'public', []),
      makeAssessment('priv-repo', 'private', []),
    ];
    const state = snapshot(assessments);
    expect(state['pub-repo'].visibility).toBe('public');
    expect(state['priv-repo'].visibility).toBe('private');
  });

  it('produces a fingerprint for each finding (kind+detail)', () => {
    const assessments = [
      makeAssessment('repo-a', 'public', [
        { kind: 'secret-file', detail: '.env' },
        { kind: 'no-license' },
      ]),
    ];
    const state = snapshot(assessments);
    const fps = state['repo-a'].fingerprints;
    expect(fps).toHaveLength(2);
    // fingerprint for secret-file:.env
    expect(fps[0]).toBe('secret-file:.env');
    // fingerprint for no-license with no detail — just the kind
    expect(fps[1]).toBe('no-license:');
  });

  it('produces empty fingerprints for clean repos', () => {
    const assessments = [makeAssessment('clean-repo', 'public', [])];
    const state = snapshot(assessments);
    expect(state['clean-repo'].fingerprints).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// diffSnapshot() — first run (no prior)
// ---------------------------------------------------------------------------

describe('diffSnapshot() — first run (null prev)', () => {
  it('returns empty deltas when prev is null (first run)', () => {
    const curr: SnapshotState = {
      'repo-a': { visibility: 'public', fingerprints: ['secret-file:.env'] },
    };
    const diff = diffSnapshot(null, curr);
    expect(diff.newlyPublic).toHaveLength(0);
    expect(diff.newFindings).toHaveLength(0);
    expect(diff.resolved).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// diffSnapshot() — newlyPublic
// ---------------------------------------------------------------------------

describe('diffSnapshot() — newlyPublic', () => {
  it('detects a repo that went from private to public', () => {
    const prev: SnapshotState = {
      'repo-a': { visibility: 'private', fingerprints: [] },
    };
    const curr: SnapshotState = {
      'repo-a': { visibility: 'public', fingerprints: [] },
    };
    const diff = diffSnapshot(prev, curr);
    expect(diff.newlyPublic).toContain('repo-a');
  });

  it('does NOT flag a repo that was already public in prev', () => {
    const prev: SnapshotState = {
      'repo-a': { visibility: 'public', fingerprints: [] },
    };
    const curr: SnapshotState = {
      'repo-a': { visibility: 'public', fingerprints: [] },
    };
    const diff = diffSnapshot(prev, curr);
    expect(diff.newlyPublic).toHaveLength(0);
  });

  it('does NOT flag a repo that went from public to private', () => {
    const prev: SnapshotState = {
      'repo-a': { visibility: 'public', fingerprints: [] },
    };
    const curr: SnapshotState = {
      'repo-a': { visibility: 'private', fingerprints: [] },
    };
    const diff = diffSnapshot(prev, curr);
    expect(diff.newlyPublic).toHaveLength(0);
  });

  it('detects a brand-new repo that appears as public (not in prev)', () => {
    const prev: SnapshotState = {};
    const curr: SnapshotState = {
      'new-repo': { visibility: 'public', fingerprints: [] },
    };
    const diff = diffSnapshot(prev, curr);
    expect(diff.newlyPublic).toContain('new-repo');
  });

  it('does NOT flag a new repo that appears as private', () => {
    const prev: SnapshotState = {};
    const curr: SnapshotState = {
      'new-repo': { visibility: 'private', fingerprints: [] },
    };
    const diff = diffSnapshot(prev, curr);
    expect(diff.newlyPublic).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// diffSnapshot() — newFindings
// ---------------------------------------------------------------------------

describe('diffSnapshot() — newFindings', () => {
  it('detects a finding that appears in curr but not prev', () => {
    const prev: SnapshotState = {
      'repo-a': { visibility: 'public', fingerprints: [] },
    };
    const curr: SnapshotState = {
      'repo-a': { visibility: 'public', fingerprints: ['secret-file:.env'] },
    };
    const diff = diffSnapshot(prev, curr);
    expect(diff.newFindings).toHaveLength(1);
    expect(diff.newFindings[0].repo).toBe('repo-a');
    expect(diff.newFindings[0].kind).toBe('secret-file:.env');
  });

  it('does NOT flag a finding that was already in prev', () => {
    const prev: SnapshotState = {
      'repo-a': { visibility: 'public', fingerprints: ['secret-file:.env'] },
    };
    const curr: SnapshotState = {
      'repo-a': { visibility: 'public', fingerprints: ['secret-file:.env'] },
    };
    const diff = diffSnapshot(prev, curr);
    expect(diff.newFindings).toHaveLength(0);
  });

  it('detects multiple new findings across repos', () => {
    const prev: SnapshotState = {
      'repo-a': { visibility: 'public', fingerprints: [] },
      'repo-b': { visibility: 'public', fingerprints: ['no-license:'] },
    };
    const curr: SnapshotState = {
      'repo-a': { visibility: 'public', fingerprints: ['secret-file:.env'] },
      'repo-b': { visibility: 'public', fingerprints: ['no-license:', 'secret-file:id_rsa'] },
    };
    const diff = diffSnapshot(prev, curr);
    expect(diff.newFindings).toHaveLength(2);
    const repos = diff.newFindings.map((f) => f.repo);
    expect(repos).toContain('repo-a');
    expect(repos).toContain('repo-b');
  });

  it('flags new findings for a brand-new repo in curr', () => {
    const prev: SnapshotState = {};
    const curr: SnapshotState = {
      'new-repo': { visibility: 'public', fingerprints: ['secret-file:.env'] },
    };
    const diff = diffSnapshot(prev, curr);
    expect(diff.newFindings).toHaveLength(1);
    expect(diff.newFindings[0].repo).toBe('new-repo');
  });
});

// ---------------------------------------------------------------------------
// diffSnapshot() — resolved
// ---------------------------------------------------------------------------

describe('diffSnapshot() — resolved', () => {
  it('detects a finding that was in prev but not in curr', () => {
    const prev: SnapshotState = {
      'repo-a': { visibility: 'public', fingerprints: ['secret-file:.env'] },
    };
    const curr: SnapshotState = {
      'repo-a': { visibility: 'public', fingerprints: [] },
    };
    const diff = diffSnapshot(prev, curr);
    expect(diff.resolved).toHaveLength(1);
    expect(diff.resolved[0].repo).toBe('repo-a');
    expect(diff.resolved[0].kind).toBe('secret-file:.env');
  });

  it('does NOT flag a finding that still exists in curr', () => {
    const prev: SnapshotState = {
      'repo-a': { visibility: 'public', fingerprints: ['secret-file:.env'] },
    };
    const curr: SnapshotState = {
      'repo-a': { visibility: 'public', fingerprints: ['secret-file:.env'] },
    };
    const diff = diffSnapshot(prev, curr);
    expect(diff.resolved).toHaveLength(0);
  });

  it('marks a repo removed from curr as having all prev findings resolved', () => {
    // Repo was in prev but not in curr (e.g., deleted or now excluded)
    const prev: SnapshotState = {
      'repo-gone': { visibility: 'public', fingerprints: ['secret-file:.env', 'no-license:'] },
    };
    const curr: SnapshotState = {};
    const diff = diffSnapshot(prev, curr);
    expect(diff.resolved).toHaveLength(2);
    expect(diff.resolved.every((r) => r.repo === 'repo-gone')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// diffSnapshot() — combined scenario
// ---------------------------------------------------------------------------

describe('diffSnapshot() — combined drift scenario', () => {
  it('correctly handles newlyPublic + newFindings + resolved together', () => {
    const prev: SnapshotState = {
      'repo-a': { visibility: 'private', fingerprints: ['secret-file:.env'] }, // was private, had a finding
      'repo-b': { visibility: 'public', fingerprints: ['no-license:'] },       // finding resolved
      'repo-c': { visibility: 'public', fingerprints: [] },                    // unchanged
    };
    const curr: SnapshotState = {
      'repo-a': { visibility: 'public', fingerprints: ['secret-file:.env'] }, // now public → newlyPublic; finding unchanged
      'repo-b': { visibility: 'public', fingerprints: [] },                   // finding resolved
      'repo-c': { visibility: 'public', fingerprints: ['secret-file:id_rsa'] }, // new finding
    };

    const diff = diffSnapshot(prev, curr);

    // repo-a went private→public
    expect(diff.newlyPublic).toContain('repo-a');
    expect(diff.newlyPublic).not.toContain('repo-b');
    expect(diff.newlyPublic).not.toContain('repo-c');

    // repo-c has a new finding
    expect(diff.newFindings.map((f) => f.repo)).toContain('repo-c');
    expect(diff.newFindings.map((f) => f.repo)).not.toContain('repo-a'); // same fp as prev
    expect(diff.newFindings.map((f) => f.repo)).not.toContain('repo-b');

    // repo-b's finding was resolved
    expect(diff.resolved.map((r) => r.repo)).toContain('repo-b');
    expect(diff.resolved.map((r) => r.repo)).not.toContain('repo-c');
  });
});
