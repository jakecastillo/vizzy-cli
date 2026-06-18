/**
 * headless.ts — non-interactive apply mode.
 *
 * runHeadless(deps, flags, opts): Promise<number>
 *
 * Deps are injected (no network in tests):
 *   loadRepos  — async loader of all owned repos
 *   setter     — VisibilitySetter
 *   treeFetch  — TreeFetcher
 *
 * Algorithm:
 *   1. Load repos, compute eligible (visibility !== target), filter by forks/archived.
 *   2. Resolve selection via resolveSelection (--repos or --all-eligible).
 *      Unknown names → stderr, exit 2.
 *   3. Run assessRepos over selected.
 *   4. Apply the SAFE subset:
 *        clean   → always apply
 *        caution → apply ONLY with --yes
 *        danger  → SKIP + report UNLESS --force-public or --allow-danger
 *   5. Emit text (default) or --json.
 *   6. Return exit code:
 *        0  clean / caution (with --yes) applied successfully
 *        1  any danger skipped -OR- any apply failure
 *        2  usage error (unknown names, no selection)
 *
 * Exit-code contract (same as the rest of vizzy):
 *   0  ok / clean
 *   1  danger finding or apply failure
 *   2  usage error
 *   3  auth / network error (handled at bin.tsx layer)
 */

import { eligibleRepos } from './core/filter.js';
import { resolveSelection } from './core/select.js';
import { assessRepos } from './core/scan.js';
import { applyChanges } from './apply.js';
import { toJsonReport } from './core/report.js';
import type { TreeFetcher } from './core/scan.js';
import type { AssessOptions, RepoAssessment } from './core/checks.js';
import type { Repo, Visibility, VisibilitySetter } from './types.js';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface HeadlessDeps {
  /** Async loader of all owned repos (injected; tests supply a fake array). */
  loadRepos: () => Promise<Repo[]>;
  /** Injected visibility setter (no network in tests). */
  setter: VisibilitySetter;
  /** Injected tree fetcher (no network in tests). */
  treeFetch: TreeFetcher;
}

export interface HeadlessFlags {
  /** Target visibility to apply. */
  target: Visibility;
  /** Explicit repo names to operate on (csv / @file / stdin processed upstream). */
  repos?: string[];
  /** Select all eligible repos. */
  allEligible?: boolean;
  /** Apply caution-level repos without interactive confirmation. */
  yes?: boolean;
  /** Allow applying even danger repos (bypass the safety guard). */
  allowDanger?: boolean;
  /** Alias for allowDanger — mirrors the --force-public flag. */
  forcePublic?: boolean;
  /** Output JSON instead of human text. */
  json?: boolean;
  /** Include forked repos in the eligible pool (default true). */
  forks?: boolean;
  /** Include archived repos in the eligible pool (default false). */
  includeArchived?: boolean;
}

export interface HeadlessOpts {
  /** Assessment thresholds. */
  assessOpts: AssessOptions;
  /** Bounded concurrency for tree fetches (default 5). */
  concurrency?: number;
}

// ---------------------------------------------------------------------------
// Internal result type (per-repo)
// ---------------------------------------------------------------------------

interface RepoResult {
  name: string;
  severity: RepoAssessment['severity'];
  applied: boolean;
  skipped: boolean;
  skippedReason?: 'danger' | 'caution-no-yes';
  applyError?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the headless (non-interactive) apply flow.
 *
 * @param deps  - Injected loader / setter / treeFetch.
 * @param flags - Parsed CLI flags for this mode.
 * @param opts  - Assessment options.
 * @returns     - Exit code per the contract.
 */
export async function runHeadless(
  deps: HeadlessDeps,
  flags: HeadlessFlags,
  opts: HeadlessOpts,
): Promise<number> {
  // ── 1. Validate selection spec ────────────────────────────────────────────
  const hasSelection = (flags.repos && flags.repos.length > 0) || flags.allEligible;
  if (!hasSelection) {
    process.stderr.write(
      'vizzy headless: specify a selection with --repos <list> or --all-eligible.\n' +
        'Example: vizzy --public --all-eligible --yes\n',
    );
    return 2;
  }

  // ── 2. Load repos + compute eligible ────────────────────────────────────
  const allRepos = await deps.loadRepos();

  const eligible = eligibleRepos(allRepos, flags.target, {
    includeForks: flags.forks !== false,
    includeArchived: flags.includeArchived ?? false,
  });

  // ── 3. Resolve selection (--repos or --all-eligible) ─────────────────────
  const { selected, unknown } = resolveSelection(eligible, {
    repos: flags.repos,
    allEligible: flags.allEligible,
  });

  if (unknown.length > 0) {
    const names = unknown.join(', ');
    process.stderr.write(
      `vizzy headless: unknown repo name(s): ${names}\n` +
        'Check the name or use --all-eligible to operate on all eligible repos.\n',
    );
    return 2;
  }

  // ── 4. Assess selected repos ─────────────────────────────────────────────
  const assessments = await assessRepos(selected, deps.treeFetch, {
    ...opts.assessOpts,
    concurrency: opts.concurrency,
  });

  // ── 5. Apply the SAFE subset ──────────────────────────────────────────────
  const canForceDanger = flags.forcePublic === true || flags.allowDanger === true;

  const toApply: Repo[] = [];
  const results: RepoResult[] = [];

  for (const a of assessments) {
    if (a.severity === 'danger' && !canForceDanger) {
      results.push({
        name: a.repo.name,
        severity: a.severity,
        applied: false,
        skipped: true,
        skippedReason: 'danger',
      });
    } else if (a.severity === 'caution' && !flags.yes && !canForceDanger) {
      results.push({
        name: a.repo.name,
        severity: a.severity,
        applied: false,
        skipped: true,
        skippedReason: 'caution-no-yes',
      });
    } else {
      toApply.push(a.repo);
    }
  }

  // Apply the repos that passed the safety filter
  let applyResults: { name: string; ok: boolean; error?: string }[] = [];
  if (toApply.length > 0) {
    applyResults = await applyChanges(toApply, flags.target, deps.setter, {
      concurrency: opts.concurrency,
    });
  }

  // Merge apply results into results array (preserving assessment order)
  const applyMap = new Map<string, { ok: boolean; error?: string }>();
  for (const r of applyResults) {
    applyMap.set(r.name, r);
  }

  for (const a of assessments) {
    if (!results.some((r) => r.name === a.repo.name)) {
      const ar = applyMap.get(a.repo.name);
      results.push({
        name: a.repo.name,
        severity: a.severity,
        applied: ar?.ok ?? false,
        skipped: false,
        applyError: ar?.error,
      });
    }
  }

  // ── 6. Emit output ────────────────────────────────────────────────────────
  if (flags.json) {
    emitJson(results, assessments);
  } else {
    emitText(results, assessments, flags.target);
  }

  // ── 7. Compute exit code ──────────────────────────────────────────────────
  const hasDangerSkipped = results.some((r) => r.skipped && r.skippedReason === 'danger');
  const hasApplyFailure = results.some((r) => !r.skipped && !r.applied);

  if (hasDangerSkipped || hasApplyFailure) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function emitText(
  results: RepoResult[],
  assessments: RepoAssessment[],
  target: Visibility,
): void {
  const assessMap = new Map<string, RepoAssessment>(assessments.map((a) => [a.repo.name, a]));

  for (const r of results) {
    const a = assessMap.get(r.name);
    const severityTag = r.severity === 'danger' ? '[DANGER]' : r.severity === 'caution' ? '[CAUTION]' : '[CLEAN]';

    if (r.skipped) {
      const reason =
        r.skippedReason === 'danger'
          ? 'SKIPPED — danger finding (use --force-public or --allow-danger to override)'
          : 'SKIPPED — caution (use --yes to apply)';
      process.stdout.write(`${r.name}  ${severityTag}  ${reason}\n`);
      // Print findings for skipped repos
      if (a) {
        for (const f of a.findings) {
          const tag = f.severity === 'danger' ? '  ✗' : '  ⚠';
          process.stdout.write(`${tag} ${f.label}\n`);
        }
      }
    } else if (r.applied) {
      process.stdout.write(`${r.name}  ${severityTag}  applied → ${target}\n`);
    } else {
      const errStr = r.applyError ? ` — ${r.applyError}` : '';
      process.stdout.write(`${r.name}  ${severityTag}  FAILED${errStr}\n`);
    }
  }

  if (results.length === 0) {
    process.stdout.write(`No repos eligible for → ${target}.\n`);
  }
}

function emitJson(results: RepoResult[], assessments: RepoAssessment[]): void {
  const assessMap = new Map<string, RepoAssessment>(assessments.map((a) => [a.repo.name, a]));
  const jsonReport = toJsonReport(assessments);

  // Merge apply results into the JSON shape
  const repos = results.map((r) => {
    const jsonEntry = jsonReport.repos.find((e) => e.repo.endsWith(`/${r.name}`));
    return {
      name: r.name,
      repo: jsonEntry?.repo ?? r.name,
      severity: r.severity,
      applied: r.applied,
      skipped: r.skipped,
      skippedReason: r.skippedReason,
      applyError: r.applyError,
      findings: jsonEntry?.findings ?? [],
    };
  });

  // Suppress unused variable lint warning
  void assessMap;

  process.stdout.write(JSON.stringify({ repos }, null, 2) + '\n');
}
