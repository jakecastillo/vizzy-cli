/**
 * core/report.test.ts — unit tests for toJsonReport + toSarif serializers.
 *
 * Tests encode the acceptance criteria from bead vizzy-cli-9cm.1:
 *   - toJsonReport returns stable serializable shape per repo
 *   - toSarif returns valid SARIF 2.1.0 with correct structure
 *
 * No network. Pure functions only.
 */

import { describe, it, expect } from 'vitest';
import { toJsonReport, toSarif } from './report.js';
import { VERSION } from '../version.js';
import type { RepoAssessment, Finding } from './checks.js';
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

function makeAssessment(
  repoOverrides: Partial<Repo> = {},
  findings: Finding[] = [],
): RepoAssessment {
  const severity = findings.some((f) => f.severity === 'danger')
    ? ('danger' as const)
    : findings.some((f) => f.severity === 'caution')
      ? ('caution' as const)
      : ('clean' as const);
  const requiredConfirm =
    severity === 'danger'
      ? ('name' as const)
      : severity === 'caution'
        ? ('phrase' as const)
        : ('y' as const);
  return {
    repo: makeRepo(repoOverrides),
    findings,
    severity,
    requiredConfirm,
  };
}

const DANGER_FINDING: Finding = {
  kind: 'secret-file',
  severity: 'danger',
  label: '.env tracked',
  detail: '.env',
};

const HISTORY_FINDING: Finding = {
  kind: 'secret-in-history',
  severity: 'danger',
  label: 'Secret deleted from history: .env',
  detail: '.env',
};

const CAUTION_FINDING: Finding = {
  kind: 'no-license',
  severity: 'caution',
  label: 'No license detected',
};

// ---------------------------------------------------------------------------
// toJsonReport
// ---------------------------------------------------------------------------

describe('toJsonReport', () => {
  it('returns an object with a repos array', () => {
    const result = toJsonReport([makeAssessment()]);
    expect(result).toHaveProperty('repos');
    expect(Array.isArray((result as { repos: unknown[] }).repos)).toBe(true);
  });

  it('each entry has repo, severity, and findings', () => {
    const assessment = makeAssessment({ name: 'alpha' }, [DANGER_FINDING]);
    const result = toJsonReport([assessment]) as { repos: unknown[] };
    const entry = result.repos[0] as {
      repo: string;
      severity: string;
      findings: unknown[];
    };
    expect(entry.repo).toBe('octocat/alpha');
    expect(entry.severity).toBe('danger');
    expect(Array.isArray(entry.findings)).toBe(true);
    expect(entry.findings).toHaveLength(1);
  });

  it('findings include kind, severity, label', () => {
    const assessment = makeAssessment({ name: 'beta' }, [DANGER_FINDING]);
    const result = toJsonReport([assessment]) as {
      repos: Array<{ findings: Array<{ kind: string; severity: string; label: string }> }>;
    };
    const finding = result.repos[0].findings[0];
    expect(finding.kind).toBe('secret-file');
    expect(finding.severity).toBe('danger');
    expect(finding.label).toBe('.env tracked');
  });

  it('preserves the finding detail field', () => {
    const assessment = makeAssessment({ name: 'beta' }, [DANGER_FINDING]);
    const result = toJsonReport([assessment]) as {
      repos: Array<{ findings: Array<{ detail?: string }> }>;
    };
    expect(result.repos[0].findings[0].detail).toBe('.env');
  });

  it('handles multiple repos', () => {
    const assessments = [
      makeAssessment({ name: 'repo-a' }, [DANGER_FINDING]),
      makeAssessment({ name: 'repo-b' }, [CAUTION_FINDING]),
      makeAssessment({ name: 'repo-c' }),
    ];
    const result = toJsonReport(assessments) as { repos: unknown[] };
    expect(result.repos).toHaveLength(3);
  });

  it('handles empty assessments', () => {
    const result = toJsonReport([]) as { repos: unknown[] };
    expect(result.repos).toHaveLength(0);
  });

  it('is serializable to JSON without throwing', () => {
    const assessment = makeAssessment({ name: 'gamma' }, [DANGER_FINDING]);
    const result = toJsonReport([assessment]);
    expect(() => JSON.stringify(result)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(result));
    expect(parsed).toBeDefined();
  });

  it('clean repo has empty findings array', () => {
    const assessment = makeAssessment({ name: 'clean-repo' }, []);
    const result = toJsonReport([assessment]) as {
      repos: Array<{ severity: string; findings: unknown[] }>;
    };
    expect(result.repos[0].severity).toBe('clean');
    expect(result.repos[0].findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// toSarif
// ---------------------------------------------------------------------------

describe('toSarif', () => {
  it('returns an object with version "2.1.0"', () => {
    const result = toSarif([makeAssessment()]) as { version: string };
    expect(result.version).toBe('2.1.0');
  });

  it('has $schema pointing to the SARIF 2.1.0 schema URI', () => {
    const result = toSarif([makeAssessment()]) as { $schema: string };
    expect(result.$schema).toContain('sarif-schema-2.1.0');
  });

  it('has runs array with exactly one run', () => {
    const result = toSarif([makeAssessment()]) as { runs: unknown[] };
    expect(Array.isArray(result.runs)).toBe(true);
    expect(result.runs).toHaveLength(1);
  });

  it('run has tool.driver with name and version', () => {
    const result = toSarif([makeAssessment()]) as {
      runs: Array<{ tool: { driver: { name: string; version: string } } }>;
    };
    const driver = result.runs[0].tool.driver;
    expect(driver.name).toBe('vizzy');
    expect(driver).toHaveProperty('version');
  });

  it('driver.version defaults to the package version (no drift) and is overridable', () => {
    const def = toSarif([makeAssessment()]) as {
      runs: Array<{ tool: { driver: { version: string } } }>;
    };
    expect(def.runs[0].tool.driver.version).toBe(VERSION);
    const overridden = toSarif([makeAssessment()], '9.9.9') as {
      runs: Array<{ tool: { driver: { version: string } } }>;
    };
    expect(overridden.runs[0].tool.driver.version).toBe('9.9.9');
  });

  it('run has rules derived from finding kinds', () => {
    const assessment = makeAssessment({ name: 'repo-x' }, [DANGER_FINDING, CAUTION_FINDING]);
    const result = toSarif([assessment]) as {
      runs: Array<{ tool: { driver: { rules: Array<{ id: string }> } } }>;
    };
    const ruleIds = result.runs[0].tool.driver.rules.map((r) => r.id);
    expect(ruleIds).toContain('secret-file');
    expect(ruleIds).toContain('no-license');
  });

  it('rules are deduplicated across multiple repos', () => {
    const assessments = [
      makeAssessment({ name: 'r1' }, [DANGER_FINDING]),
      makeAssessment({ name: 'r2' }, [DANGER_FINDING]),
    ];
    const result = toSarif(assessments) as {
      runs: Array<{ tool: { driver: { rules: Array<{ id: string }> } } }>;
    };
    const ruleIds = result.runs[0].tool.driver.rules.map((r) => r.id);
    const uniqueIds = [...new Set(ruleIds)];
    expect(ruleIds).toHaveLength(uniqueIds.length);
  });

  it('run has results array', () => {
    const result = toSarif([makeAssessment({ name: 'r1' }, [DANGER_FINDING])]) as {
      runs: Array<{ results: unknown[] }>;
    };
    expect(Array.isArray(result.runs[0].results)).toBe(true);
  });

  it('danger finding maps to result.level "error"', () => {
    const assessment = makeAssessment({ name: 'dangerous' }, [DANGER_FINDING]);
    const result = toSarif([assessment]) as {
      runs: Array<{ results: Array<{ level: string }> }>;
    };
    const levels = result.runs[0].results.map((r) => r.level);
    expect(levels).toContain('error');
  });

  it('caution finding maps to result.level "warning"', () => {
    const assessment = makeAssessment({ name: 'cautious' }, [CAUTION_FINDING]);
    const result = toSarif([assessment]) as {
      runs: Array<{ results: Array<{ level: string }> }>;
    };
    const levels = result.runs[0].results.map((r) => r.level);
    expect(levels).toContain('warning');
  });

  it('result location is the repo name (owner/repo)', () => {
    const assessment = makeAssessment({ name: 'located', owner: 'acme' }, [DANGER_FINDING]);
    const result = toSarif([assessment]) as {
      runs: Array<{
        results: Array<{
          locations: Array<{
            logicalLocations: Array<{ name: string }>;
          }>;
        }>;
      }>;
    };
    const loc = result.runs[0].results[0].locations[0].logicalLocations[0].name;
    expect(loc).toBe('acme/located');
  });

  it('result has ruleId matching the finding kind', () => {
    const assessment = makeAssessment({ name: 'rid-test' }, [DANGER_FINDING]);
    const result = toSarif([assessment]) as {
      runs: Array<{ results: Array<{ ruleId: string }> }>;
    };
    expect(result.runs[0].results[0].ruleId).toBe('secret-file');
  });

  it('produces no results for clean repos', () => {
    const assessment = makeAssessment({ name: 'pristine' }, []);
    const result = toSarif([assessment]) as {
      runs: Array<{ results: unknown[] }>;
    };
    expect(result.runs[0].results).toHaveLength(0);
  });

  it('is serializable to JSON without throwing', () => {
    const assessment = makeAssessment({ name: 'serial' }, [DANGER_FINDING]);
    const result = toSarif([assessment]);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('handles empty assessments', () => {
    const result = toSarif([]) as { runs: Array<{ results: unknown[] }> };
    expect(result.runs[0].results).toHaveLength(0);
  });

  it('secret-in-history kind is covered by KIND_DESCRIPTIONS (exhaustive Record)', () => {
    // If KIND_DESCRIPTIONS does not cover 'secret-in-history', the SARIF shortDescription
    // would fall back to the raw kind string. We verify the rule is described.
    const assessment = makeAssessment({ name: 'hist-repo' }, [HISTORY_FINDING]);
    const result = toSarif([assessment]) as {
      runs: Array<{ tool: { driver: { rules: Array<{ id: string; shortDescription: { text: string } }> } } }>;
    };
    const rule = result.runs[0].tool.driver.rules.find((r) => r.id === 'secret-in-history');
    expect(rule).toBeDefined();
    // The description must not be the raw kind string (i.e., KIND_DESCRIPTIONS has an entry)
    expect(rule!.shortDescription.text).not.toBe('secret-in-history');
  });

  it('secret-in-history finding maps to result.level "error"', () => {
    const assessment = makeAssessment({ name: 'hist-repo' }, [HISTORY_FINDING]);
    const result = toSarif([assessment]) as {
      runs: Array<{ results: Array<{ level: string; ruleId: string }> }>;
    };
    const histResult = result.runs[0].results.find((r) => r.ruleId === 'secret-in-history');
    expect(histResult).toBeDefined();
    expect(histResult!.level).toBe('error');
  });
});
