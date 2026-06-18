/**
 * core/report.ts — pure serializers for RepoAssessment[].
 *
 * toJsonReport(assessments): stable serializable object with per-repo
 *   { repo: "owner/name", severity, findings[] }
 *
 * toSarif(assessments): SARIF 2.1.0 object (single run, rules from finding
 *   kind, result.level = "error" for danger / "warning" for caution,
 *   locations = repo name).
 *
 * Both functions are pure (no I/O, no side effects) and produce fully
 * serializable output (JSON.stringify compatible).
 */

import type { RepoAssessment, Finding } from './checks.js';
import { VERSION } from '../version.js';

// ---------------------------------------------------------------------------
// JSON report
// ---------------------------------------------------------------------------

export interface JsonFinding {
  kind: Finding['kind'];
  severity: Finding['severity'];
  label: string;
  detail?: string;
}

export interface JsonRepoEntry {
  repo: string; // "owner/name"
  severity: RepoAssessment['severity'];
  findings: JsonFinding[];
}

export interface JsonReport {
  repos: JsonRepoEntry[];
}

/**
 * Serialize an array of RepoAssessments to a stable, serializable JSON shape.
 *
 * Each entry contains:
 *   - repo: "owner/name"
 *   - severity: 'clean' | 'caution' | 'danger'
 *   - findings: array of { kind, severity, label, detail? }
 */
export function toJsonReport(assessments: RepoAssessment[]): JsonReport {
  const repos: JsonRepoEntry[] = assessments.map((assessment) => {
    const { repo, severity, findings } = assessment;
    const repoSlug = `${repo.owner}/${repo.name}`;

    const serializedFindings: JsonFinding[] = findings.map((f) => {
      const entry: JsonFinding = {
        kind: f.kind,
        severity: f.severity,
        label: f.label,
      };
      if (f.detail !== undefined) {
        entry.detail = f.detail;
      }
      return entry;
    });

    return {
      repo: repoSlug,
      severity,
      findings: serializedFindings,
    };
  });

  return { repos };
}

// ---------------------------------------------------------------------------
// SARIF 2.1.0
// ---------------------------------------------------------------------------

/** SARIF result level — maps danger→error, caution→warning. */
type SarifLevel = 'error' | 'warning' | 'note' | 'none';

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
}

interface SarifLogicalLocation {
  name: string;
  kind: 'module';
}

interface SarifLocation {
  logicalLocations: SarifLogicalLocation[];
}

interface SarifResult {
  ruleId: string;
  level: SarifLevel;
  message: { text: string };
  locations: SarifLocation[];
}

interface SarifDriver {
  name: string;
  version: string;
  informationUri: string;
  rules: SarifRule[];
}

interface SarifRun {
  tool: { driver: SarifDriver };
  results: SarifResult[];
}

export interface SarifReport {
  $schema: string;
  version: '2.1.0';
  runs: SarifRun[];
}

const SARIF_SCHEMA =
  'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json';

/** Human-readable descriptions for each finding kind. */
const KIND_DESCRIPTIONS: Record<Finding['kind'], string> = {
  'secret-file': 'A file matching a known-secret pattern is tracked in the repository.',
  'no-license': 'The repository has no detected license.',
  'stale': 'The repository has not been pushed to recently.',
  'high-profile': 'The repository has a high star count and increased exposure.',
  'archived': 'The repository is archived.',
  'scan-incomplete': 'The file tree could not be fully scanned; results may be incomplete.',
};

function findingLevelToSarif(severity: Finding['severity']): SarifLevel {
  if (severity === 'danger') return 'error';
  if (severity === 'caution') return 'warning';
  return 'note';
}

/**
 * Serialize an array of RepoAssessments to a SARIF 2.1.0 object.
 *
 * - Single run with tool.driver named "vizzy".
 * - Rules are derived from the unique finding kinds present across all repos.
 * - Each finding becomes a result with:
 *     - ruleId = finding.kind
 *     - level = "error" (danger) or "warning" (caution)
 *     - locations[0].logicalLocations[0].name = "owner/repo"
 */
export function toSarif(
  assessments: RepoAssessment[],
  version: string = VERSION,
): SarifReport {
  // Collect all unique finding kinds across all assessments
  const kindsSeen = new Set<Finding['kind']>();
  for (const assessment of assessments) {
    for (const finding of assessment.findings) {
      kindsSeen.add(finding.kind);
    }
  }

  // Build the rules list (one per unique kind)
  const rules: SarifRule[] = [...kindsSeen].map((kind) => ({
    id: kind,
    name: kind
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(''),
    shortDescription: {
      text: KIND_DESCRIPTIONS[kind] ?? kind,
    },
  }));

  // Build the results list (one per finding per repo)
  const results: SarifResult[] = [];
  for (const assessment of assessments) {
    const repoSlug = `${assessment.repo.owner}/${assessment.repo.name}`;
    for (const finding of assessment.findings) {
      results.push({
        ruleId: finding.kind,
        level: findingLevelToSarif(finding.severity),
        message: { text: finding.label },
        locations: [
          {
            logicalLocations: [
              {
                name: repoSlug,
                kind: 'module',
              },
            ],
          },
        ],
      });
    }
  }

  const run: SarifRun = {
    tool: {
      driver: {
        name: 'vizzy',
        version,
        informationUri: 'https://github.com/jakecastillo/vizzy-cli',
        rules,
      },
    },
    results,
  };

  return {
    $schema: SARIF_SCHEMA,
    version: '2.1.0',
    runs: [run],
  };
}
