/**
 * core/checks.ts — pure repo assessment (no I/O, no Date.now()).
 *
 * assess(repo, paths, opts): RepoAssessment
 *
 * Findings emitted:
 *   secret-file  (danger)  — via scanPaths from sensitive.ts
 *   no-license   (caution) — repo.license === null
 *   stale        (caution) — last push > opts.staleMonths months before opts.now
 *   high-profile (caution) — repo.stars >= opts.highProfileStars
 *   archived     (caution) — repo.isArchived === true
 *   scan-incomplete (caution) — paths === null
 *
 * Severity: danger if any danger finding, caution if any caution, else clean.
 * requiredConfirm: danger→'name', caution→'phrase', clean→'y'.
 */

import { scanPaths } from './sensitive.js';
import type { ContentHit } from './content.js';
import type { Repo } from '../types.js';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type Severity = 'clean' | 'caution' | 'danger';
export type ConfirmLevel = 'y' | 'phrase' | 'name';

export interface Finding {
  kind:
    | 'secret-file'
    | 'secret-content'
    | 'no-license'
    | 'stale'
    | 'high-profile'
    | 'archived'
    | 'scan-incomplete';
  severity: 'caution' | 'danger';
  label: string;
  detail?: string;
}

export interface RepoAssessment {
  repo: Repo;
  findings: Finding[];
  severity: Severity;
  requiredConfirm: ConfirmLevel;
}

export interface AssessOptions {
  staleMonths: number;
  highProfileStars: number;
  now: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return true when pushedAt is more than staleMonths before now. */
function isStale(pushedAt: string, staleMonths: number, now: Date): boolean {
  const pushed = new Date(pushedAt);
  // Shift "now" back by staleMonths months to get the boundary
  const boundary = new Date(now);
  boundary.setMonth(boundary.getMonth() - staleMonths);
  return pushed < boundary;
}

function deriveSeverity(findings: Finding[]): Severity {
  if (findings.some((f) => f.severity === 'danger')) return 'danger';
  if (findings.some((f) => f.severity === 'caution')) return 'caution';
  return 'clean';
}

function deriveConfirmLevel(severity: Severity): ConfirmLevel {
  if (severity === 'danger') return 'name';
  if (severity === 'caution') return 'phrase';
  return 'y';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pure assessment of a single repo.
 *
 * @param repo         - The repo metadata.
 * @param paths        - File paths from the repo tree, or null if unavailable.
 * @param opts         - Injected thresholds and reference time (makes tests deterministic).
 * @param contentHits  - Optional content-scan hits (from core/content.ts scanContent).
 *                       Each hit produces one secret-content danger finding.
 */
export function assess(
  repo: Repo,
  paths: string[] | null,
  opts: AssessOptions,
  contentHits?: ContentHit[],
): RepoAssessment {
  const findings: Finding[] = [];

  // ── scan-incomplete ────────────────────────────────────────────────────────
  if (paths === null) {
    findings.push({
      kind: 'scan-incomplete',
      severity: 'caution',
      label: 'Tree unavailable — scan incomplete',
      detail: 'File tree could not be fetched; absence of findings is not an all-clear.',
    });
  } else {
    // ── secret-file (danger) ─────────────────────────────────────────────────
    const hits = scanPaths(paths);
    for (const hit of hits) {
      findings.push({
        kind: 'secret-file',
        severity: 'danger',
        label: `${hit.path} tracked`,
        detail: hit.path,
      });
    }
  }

  // ── secret-content (danger) — one finding per content hit ─────────────────
  if (contentHits) {
    for (const hit of contentHits) {
      findings.push({
        kind: 'secret-content',
        severity: 'danger',
        label: `Secret detected in content (${hit.rule})`,
        detail: hit.match,
      });
    }
  }

  // ── no-license (caution) ──────────────────────────────────────────────────
  if (repo.license === null) {
    findings.push({
      kind: 'no-license',
      severity: 'caution',
      label: 'No license detected',
    });
  }

  // ── stale (caution) ───────────────────────────────────────────────────────
  if (isStale(repo.pushedAt, opts.staleMonths, opts.now)) {
    findings.push({
      kind: 'stale',
      severity: 'caution',
      label: `Stale — no push in over ${opts.staleMonths} months`,
      detail: repo.pushedAt,
    });
  }

  // ── high-profile (caution) ────────────────────────────────────────────────
  if (repo.stars >= opts.highProfileStars) {
    findings.push({
      kind: 'high-profile',
      severity: 'caution',
      label: `High-profile — ${repo.stars} stars`,
      detail: String(repo.stars),
    });
  }

  // ── archived (caution) ────────────────────────────────────────────────────
  if (repo.isArchived) {
    findings.push({
      kind: 'archived',
      severity: 'caution',
      label: 'Archived repository',
    });
  }

  const severity = deriveSeverity(findings);
  const requiredConfirm = deriveConfirmLevel(severity);

  return { repo, findings, severity, requiredConfirm };
}
