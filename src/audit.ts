/**
 * audit.ts — non-interactive --audit report mode.
 *
 * runAudit(loadRepos, treeFetch, opts):
 *   1. Loads all owned repos via loadRepos().
 *   2. Filters to currently-PUBLIC repos only.
 *   3. Runs assessRepos() over them (injectable treeFetch — no GitHub writes).
 *   4. Emits a report to stdout in the requested format (text/json/sarif).
 *   5. Returns the appropriate exit code.
 *
 * No setVisibility calls — this is a read-only audit.
 * Designed to be wired into bin.tsx before the TTY check + Ink render.
 *
 * Exit-code contract:
 *   0  ok / clean — no danger findings
 *   1  danger finding detected in one or more public repos
 *   (2 = usage error and 3 = auth/network are handled at the bin.tsx layer)
 */

import { assessRepos } from './core/scan.js';
import type { TreeFetcher } from './core/scan.js';
import type { AssessOptions } from './core/checks.js';
import type { Repo } from './types.js';
import { toJsonReport, toSarif } from './core/report.js';
import { VERSION } from './version.js';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface AuditOpts {
  /** Assessment thresholds (staleMonths, highProfileStars, now). */
  assessOpts: AssessOptions;
  /** Bounded concurrency for tree fetches (default 5). */
  concurrency?: number;
  /**
   * Output format for the audit report.
   * - 'text'  (default) — human-readable per-repo text
   * - 'json'  — JSON via toJsonReport from core/report
   * - 'sarif' — SARIF 2.1.0 via toSarif from core/report
   */
  format?: 'text' | 'json' | 'sarif';
}

/** Injected repo loader. In production this is () => listOwnerRepos(octokit). */
export type RepoLoader = () => Promise<Repo[]>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a non-interactive audit of all currently-public repos.
 *
 * @param loadRepos  - Injected loader; tests supply a fake array, production uses listOwnerRepos.
 * @param treeFetch  - Injected tree fetcher; tests supply a stub, production wraps listRepoTree.
 * @param opts       - Assessment options + optional concurrency + optional output format.
 * @returns          - Exit code: 1 if any repo has a danger finding, else 0.
 */
export async function runAudit(
  loadRepos: RepoLoader,
  treeFetch: TreeFetcher,
  opts: AuditOpts,
): Promise<number> {
  const allRepos = await loadRepos();

  // Only audit currently-public repos — that's the "what have I already exposed?" view.
  const publicRepos = allRepos.filter((r) => r.visibility === 'public');

  if (publicRepos.length === 0) {
    if (!opts.format || opts.format === 'text') {
      process.stdout.write('No public repos found.\n');
    } else if (opts.format === 'json') {
      process.stdout.write(JSON.stringify({ repos: [] }, null, 2) + '\n');
    } else if (opts.format === 'sarif') {
      process.stdout.write(JSON.stringify(toSarif([], VERSION), null, 2) + '\n');
    }
    return 0;
  }

  const assessOpts = { ...opts.assessOpts, concurrency: opts.concurrency };
  const assessments = await assessRepos(publicRepos, treeFetch, assessOpts);

  const format = opts.format ?? 'text';

  if (format === 'json') {
    const report = toJsonReport(assessments);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else if (format === 'sarif') {
    const sarif = toSarif(assessments, VERSION);
    process.stdout.write(JSON.stringify(sarif, null, 2) + '\n');
  } else {
    // Human-readable text report (default)
    for (const a of assessments) {
      const severityLabel = a.severity.toUpperCase();
      process.stdout.write(`\n${a.repo.name}  [${severityLabel}]\n`);

      if (a.findings.length === 0) {
        process.stdout.write('  (no findings)\n');
      } else {
        for (const f of a.findings) {
          const tag = f.severity === 'danger' ? '✗' : '⚠';
          const detail = f.detail ? ` — ${f.detail}` : '';
          process.stdout.write(`  ${tag} ${f.label}${detail}\n`);
        }
      }
    }
  }

  // Exit code: 1 if any repo has a danger finding.
  const hasDanger = assessments.some((a) => a.severity === 'danger');
  return hasDanger ? 1 : 0;
}
