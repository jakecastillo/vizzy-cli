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
import type { ExtraRules } from './sensitive.js';
import { maskSecret } from './content.js';
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
    | 'secret-in-history'
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
  /** Optional custom scan rules from .vizzyscan (deny globs + allow list). */
  scanRules?: ExtraRules;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return true when pushedAt is more than staleMonths before now. */
function isStale(pushedAt: string, staleMonths: number, now: Date): boolean {
  const pushed = new Date(pushedAt);
  // Shift "now" back by staleMonths months to get the boundary. Set the day to 1
  // before adjusting the month so setMonth can't overflow (e.g. "Feb 31" rolling
  // forward to March would wrongly flag a repo pushed ~29 days ago as stale),
  // then clamp the day to the last valid day of the target month.
  const boundary = new Date(now);
  const day = boundary.getDate();
  boundary.setDate(1);
  boundary.setMonth(boundary.getMonth() - staleMonths);
  const lastDay = new Date(boundary.getFullYear(), boundary.getMonth() + 1, 0).getDate();
  boundary.setDate(Math.min(day, lastDay));
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
 * @param historyHits  - Optional filenames from commit history that match the sensitive
 *                       classifier but are NOT present in the current HEAD tree.
 *                       Each unique path produces one secret-in-history danger finding.
 */
export function assess(
  repo: Repo,
  paths: string[] | null,
  opts: AssessOptions,
  contentHits?: ContentHit[],
  historyHits?: string[],
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
    const hits = scanPaths(paths, opts.scanRules);
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
        // Never store the raw secret on a finding — it flows to stdout, SARIF/
        // JSON output and the on-disk drift snapshot. Persist a redacted form.
        detail: maskSecret(hit.match),
      });
    }
  }

  // ── secret-in-history (danger) — sensitive file deleted from HEAD but seen in history ──
  // Only flag files that are NOT currently in the HEAD tree (no double-counting).
  if (historyHits && historyHits.length > 0) {
    const headSet = new Set(paths ?? []);
    for (const histPath of historyHits) {
      if (!headSet.has(histPath)) {
        findings.push({
          kind: 'secret-in-history',
          severity: 'danger',
          label: `Secret deleted from history: ${histPath}`,
          detail: histPath,
        });
      }
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
