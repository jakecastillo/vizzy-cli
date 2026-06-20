/**
 * check.ts — pre-publish readiness for ONE repo.
 *
 * runCheck(repoRef, deps, opts): Promise<number>
 *
 * - Loads repo metadata + tree (with blob sizes) via injected deps.
 * - Runs the FULL deep scan: tree (secret-file), content, history.
 * - Checks LICENSE file present in tree.
 * - Checks README, CONTRIBUTING, CODE_OF_CONDUCT present in tree.
 * - Checks for large files (blob size > 50 MB).
 * - Prints a pass/fail checklist to stdout.
 * - Returns 0 ready / 1 not ready / 3 error.
 *
 * All I/O is injected — tests pass fake loaders/fetchers (no network).
 *
 * Exit-code contract (same as the rest of vizzy):
 *   0  ready — all checks pass
 *   1  not ready — one or more checks fail (prints which)
 *   3  error — could not load repo metadata or tree
 */

import { assess } from './core/checks.js';
import { loadScanRules } from './core/scanrules.js';
import { scanContent } from './core/content.js';
import { classifyPath } from './core/sensitive.js';
import type { AssessOptions } from './core/checks.js';
import type { ContentFetcher, HistoryFetcher } from './core/scan.js';
import type { Repo } from './types.js';

// ---------------------------------------------------------------------------
// LARGE_FILE_THRESHOLD
// ---------------------------------------------------------------------------

const LARGE_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * A tree item with a path and optional blob size (bytes).
 * Matches the shape returned by GitHub's tree API for blobs.
 */
export interface TreeItem {
  path: string;
  size?: number;
}

/**
 * Injected dependencies for runCheck (no network in tests).
 */
export interface CheckDeps {
  /**
   * Load the Repo metadata for the given owner/name.
   * Errors propagate → exit 3.
   */
  loadRepo: (owner: string, name: string) => Promise<Repo>;

  /**
   * Fetch the repo tree with blob sizes.
   * Returns items (path + size) and a truncated flag.
   * Errors propagate → exit 3.
   */
  treeFetch: (repo: Repo) => Promise<{ items: TreeItem[]; truncated: boolean }>;

  /**
   * Fetch the text content of a blob at a given path.
   * Used for the deep content scan.
   * Errors are caught (→ scan-incomplete finding, not exit 3).
   */
  contentFetcher: ContentFetcher;

  /**
   * Fetch the set of filenames seen across recent commits.
   * Used for the deep history scan.
   * Errors are caught (→ scan-incomplete finding, not exit 3).
   */
  historyFetcher: HistoryFetcher;

  /**
   * Raw text of .vizzyscan from cwd (empty string if absent).
   */
  scanRulesText: string;
}

export interface CheckOpts {
  /** Assessment thresholds (staleMonths, highProfileStars, now). */
  assessOpts: AssessOptions;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the pre-publish readiness check for a single repository.
 *
 * @param repoRef  - "owner/repo" string identifying the target repo.
 * @param deps     - Injected loaders/fetchers (no network required in tests).
 * @param opts     - Assessment options.
 * @returns        - Exit code: 0 ready, 1 not ready, 3 error.
 */
export async function runCheck(
  repoRef: string,
  deps: CheckDeps,
  opts: CheckOpts,
): Promise<number> {
  // ── Parse owner/repo ───────────────────────────────────────────────────────
  const [owner, repoName] = repoRef.split('/');
  if (!owner || !repoName) {
    process.stderr.write(`vizzy check: invalid repo ref "${repoRef}". Expected "owner/repo".\n`);
    return 3;
  }

  // ── Load repo metadata ─────────────────────────────────────────────────────
  let repo: Repo;
  try {
    repo = await deps.loadRepo(owner, repoName);
  } catch (err) {
    process.stderr.write(
      `vizzy check: failed to load repo "${repoRef}": ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 3;
  }

  // ── Fetch tree with blob sizes ─────────────────────────────────────────────
  let items: TreeItem[];
  let truncated: boolean;
  try {
    const result = await deps.treeFetch(repo);
    items = result.items;
    truncated = result.truncated;
  } catch (err) {
    process.stderr.write(
      `vizzy check: failed to fetch tree for "${repoRef}": ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 3;
  }

  // ── Parse .vizzyscan ──────────────────────────────────────────────────────
  const scanRules = loadScanRules(deps.scanRulesText);

  // Extract just the paths for the scan pass
  const paths = items.map((i) => i.path);

  // ── Deep content scan (always-on in vizzy check) ───────────────────────────
  let contentHits: import('./core/content.js').ContentHit[] | undefined;
  {
    const suspiciousPaths = paths.filter((p) => classifyPath(p, scanRules) !== null);
    const allHits: import('./core/content.js').ContentHit[] = [];
    for (const p of suspiciousPaths) {
      try {
        const text = await deps.contentFetcher(repo, p);
        const hits = scanContent(text);
        allHits.push(...hits);
      } catch {
        // Content fetch error is non-fatal for exit code — treat as scan-incomplete
      }
    }
    contentHits = allHits;
  }

  // ── Deep history scan (always-on in vizzy check) ──────────────────────────
  let historyHits: string[] | undefined;
  let historyTruncated = false;
  {
    try {
      const histResult = await deps.historyFetcher(repo);
      historyHits = histResult.paths.filter((p) => classifyPath(p, scanRules) !== null);
      historyTruncated = histResult.truncated;
    } catch {
      // History fetch error is non-fatal for exit code — treat as scan-incomplete
    }
  }

  // ── Core assessment (secret-file, secret-content, secret-in-history, etc.) ─
  const assessment = assess(repo, paths, opts.assessOpts, contentHits, historyHits);

  // ── Extra checks specific to vizzy check ────────────────────────────────────

  // LICENSE present in tree
  const hasLicenseFile = paths.some((p) => {
    const base = p.split('/').pop()?.toUpperCase() ?? '';
    return base === 'LICENSE' || base.startsWith('LICENSE.');
  });

  // README present in tree
  const hasReadme = paths.some((p) => {
    const base = p.split('/').pop()?.toUpperCase() ?? '';
    return base === 'README' || base.startsWith('README.');
  });

  // CONTRIBUTING present in tree
  const hasContributing = paths.some((p) => {
    const base = p.split('/').pop()?.toUpperCase() ?? '';
    return base === 'CONTRIBUTING' || base.startsWith('CONTRIBUTING.');
  });

  // CODE_OF_CONDUCT present in tree
  const hasCodeOfConduct = paths.some((p) => {
    const base = p.split('/').pop()?.toUpperCase() ?? '';
    return base === 'CODE_OF_CONDUCT' || base.startsWith('CODE_OF_CONDUCT.');
  });

  // Large files (blob size > 50 MB)
  const largeFiles = items.filter((i) => typeof i.size === 'number' && i.size > LARGE_FILE_BYTES);

  // ── Build checklist results ────────────────────────────────────────────────

  interface CheckItem {
    label: string;
    pass: boolean;
    detail?: string;
  }

  const checks: CheckItem[] = [];

  // No danger secret-file findings
  const secretFileFindings = assessment.findings.filter((f) => f.kind === 'secret-file');
  if (secretFileFindings.length === 0) {
    checks.push({ label: 'No sensitive files tracked', pass: true });
  } else {
    for (const f of secretFileFindings) {
      checks.push({ label: `Sensitive file tracked: ${f.detail ?? f.label}`, pass: false, detail: f.detail });
    }
  }

  // No secret-content findings
  const contentFindings = assessment.findings.filter((f) => f.kind === 'secret-content');
  if (contentFindings.length === 0) {
    checks.push({ label: 'No secrets in file content', pass: true });
  } else {
    for (const f of contentFindings) {
      // f.label carries the rule name; f.detail is already redacted (no raw
      // secret) — print both so the user knows what fired without re-leaking it.
      const masked = f.detail ? ` — ${f.detail}` : '';
      checks.push({ label: `${f.label}${masked}`, pass: false, detail: f.detail });
    }
  }

  // No secret-in-history findings
  const historyFindings = assessment.findings.filter((f) => f.kind === 'secret-in-history');
  if (historyFindings.length === 0) {
    checks.push({ label: 'No secrets in git history', pass: true });
  } else {
    for (const f of historyFindings) {
      checks.push({ label: `Secret in history: ${f.detail ?? f.label}`, pass: false, detail: f.detail });
    }
  }

  // LICENSE present (file in tree)
  checks.push({
    label: 'LICENSE file present',
    pass: hasLicenseFile,
    detail: hasLicenseFile ? undefined : 'No LICENSE file found in repository tree',
  });

  // LICENSE detected in repo metadata (GitHub API)
  const licenseMetaPass = repo.license !== null;
  checks.push({
    label: `License detected (${repo.license ?? 'none'})`,
    pass: licenseMetaPass,
    detail: licenseMetaPass ? undefined : 'GitHub API reports no license for this repository',
  });

  // README present
  checks.push({
    label: 'README present',
    pass: hasReadme,
    detail: hasReadme ? undefined : 'No README file found in repository tree',
  });

  // CONTRIBUTING present
  checks.push({
    label: 'CONTRIBUTING present',
    pass: hasContributing,
    detail: hasContributing ? undefined : 'No CONTRIBUTING file found in repository tree',
  });

  // CODE_OF_CONDUCT present
  checks.push({
    label: 'CODE_OF_CONDUCT present',
    pass: hasCodeOfConduct,
    detail: hasCodeOfConduct ? undefined : 'No CODE_OF_CONDUCT file found in repository tree',
  });

  // No large files
  if (largeFiles.length === 0) {
    checks.push({ label: 'No large files (> 50 MB)', pass: true });
  } else {
    for (const lf of largeFiles) {
      const mb = ((lf.size ?? 0) / (1024 * 1024)).toFixed(1);
      checks.push({
        label: `Large file: ${lf.path} (${mb} MB)`,
        pass: false,
        detail: lf.path,
      });
    }
  }

  // Scan complete (no truncation)
  if (truncated) {
    checks.push({ label: 'Tree scan complete (not truncated)', pass: false, detail: 'Tree was truncated; scan may be incomplete' });
  }
  if (historyTruncated) {
    checks.push({
      label: 'History scan complete (not truncated)',
      pass: false,
      detail: 'Commit history was capped at the scan window; a secret committed then deleted beyond it would not be seen',
    });
  }

  // ── Print checklist ────────────────────────────────────────────────────────

  const overallPass = checks.every((c) => c.pass);
  const statusLine = overallPass ? 'READY' : 'NOT READY';

  process.stdout.write(`\nvizzy check: ${repo.owner}/${repo.name}  [${statusLine}]\n\n`);

  for (const c of checks) {
    const icon = c.pass ? '[pass]' : '[FAIL]';
    const detail = !c.pass && c.detail ? ` — ${c.detail}` : '';
    process.stdout.write(`  ${icon}  ${c.label}${detail}\n`);
  }

  process.stdout.write('\n');

  return overallPass ? 0 : 1;
}
