/**
 * audit.ts — non-interactive --audit report mode.
 *
 * runAudit(loadRepos, treeFetch, opts):
 *   1. Loads all owned repos via loadRepos().
 *   2. Filters to currently-PUBLIC repos only.
 *   3. Runs assessRepos() over them (injectable treeFetch — no GitHub writes).
 *   4. Prints a per-repo report (repo name, severity, findings) to stdout.
 *   5. Returns 1 if ANY repo has a danger finding, else 0.
 *
 * No setVisibility calls — this is a read-only audit.
 * Designed to be wired into bin.tsx before the TTY check + Ink render.
 */

import { assessRepos } from './core/scan.js';
import type { TreeFetcher } from './core/scan.js';
import type { AssessOptions } from './core/checks.js';
import type { Repo } from './types.js';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface AuditOpts {
  /** Assessment thresholds (staleMonths, highProfileStars, now). */
  assessOpts: AssessOptions;
  /** Bounded concurrency for tree fetches (default 5). */
  concurrency?: number;
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
 * @param opts       - Assessment options + optional concurrency.
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
    process.stdout.write('No public repos found.\n');
    return 0;
  }

  const assessOpts = { ...opts.assessOpts, concurrency: opts.concurrency };
  const assessments = await assessRepos(publicRepos, treeFetch, assessOpts);

  // Print per-repo report to stdout.
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

  // Exit code: 1 if any repo has a danger finding.
  const hasDanger = assessments.some((a) => a.severity === 'danger');
  return hasDanger ? 1 : 0;
}
