/**
 * core/scan.ts — assessRepos orchestration (injectable fetcher, p-limit).
 *
 * assessRepos(repos, fetch, opts): Promise<RepoAssessment[]>
 *
 * - Uses p-limit(opts.concurrency ?? 5) for bounded concurrency.
 * - Per-repo fetch failure is isolated: the repo gets assess(repo, null, opts)
 *   which emits a scan-incomplete caution; the batch always completes.
 * - A truncated tree (truncated===true) also calls assess with a synthetic null
 *   for the paths argument to trigger scan-incomplete, but any paths already
 *   received are passed through so secret-file findings are preserved.
 * - Order is preserved (Promise.all over a pre-mapped array).
 */

import pLimit from 'p-limit';
import { assess } from './checks.js';
import type { AssessOptions, RepoAssessment, Finding } from './checks.js';
import { scanContent } from './content.js';
import type { ContentHit } from './content.js';
import { classifyPath } from './sensitive.js';
import type { Repo } from '../types.js';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * Injected tree fetcher.  Tests pass a stub; production wraps listRepoTree.
 */
export type TreeFetcher = (repo: Repo) => Promise<{ paths: string[]; truncated: boolean }>;

/**
 * Injected content fetcher for the deep content pass.
 * Given a repo and a blob path, returns the decoded text content.
 * Errors propagate → scan-incomplete.
 */
export type ContentFetcher = (repo: Repo, path: string) => Promise<string>;

/**
 * Injected history fetcher for the deep history pass.
 * Returns the set of all filenames seen across recent commits and a truncated flag.
 * Errors propagate → scan-incomplete.
 */
export type HistoryFetcher = (repo: Repo) => Promise<{ paths: string[]; truncated: boolean }>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assess an array of repos with bounded concurrency.
 *
 * @param repos   - Repos to assess.
 * @param fetch   - Injected tree fetcher (no network in tests).
 * @param opts    - AssessOptions + optional concurrency cap (default 5).
 *                  Pass `deep: true` and `contentFetcher` to enable the opt-in
 *                  content pass over suspicious text blobs.
 * @returns       - One RepoAssessment per repo, in the same order as `repos`.
 */
export async function assessRepos(
  repos: Repo[],
  fetch: TreeFetcher,
  opts: AssessOptions & { concurrency?: number; deep?: boolean; contentFetcher?: ContentFetcher; historyFetcher?: HistoryFetcher },
): Promise<RepoAssessment[]> {
  const limit = pLimit(opts.concurrency ?? 5);

  const tasks = repos.map((repo) =>
    limit(async (): Promise<RepoAssessment> => {
      let paths: string[] | null;
      let truncated = false;

      try {
        const result = await fetch(repo);
        paths = result.paths;
        truncated = result.truncated;
      } catch {
        // Fetch failed — treat as unavailable (scan-incomplete via assess)
        paths = null;
      }

      // ── Optional content pass (opt-in, bounded, injected) ──────────────────
      // Only runs when deep=true AND a contentFetcher is provided AND we have paths.
      let contentHits: ContentHit[] | undefined;
      let contentScanIncomplete = false;

      if (opts.deep && opts.contentFetcher && paths !== null) {
        // BOUNDED: only fetch content for paths that classifyPath flags as suspicious.
        const suspiciousPaths = paths.filter((p) => classifyPath(p) !== null);
        if (suspiciousPaths.length > 0) {
          const allHits: ContentHit[] = [];
          for (const p of suspiciousPaths) {
            try {
              const text = await opts.contentFetcher(repo, p);
              const hits = scanContent(text);
              allHits.push(...hits);
            } catch {
              // A content-fetch error → mark scan-incomplete; never a silent clean.
              contentScanIncomplete = true;
            }
          }
          contentHits = allHits;
        }
      }

      // ── Optional history pass (opt-in, injected) ──────────────────────────
      // Only runs when deep=true AND a historyFetcher is provided.
      // historyHits = filenames from recent commits that match the sensitive classifier
      // but are NOT in the current HEAD tree (deduplication happens in assess()).
      let historyHits: string[] | undefined;
      let historyScanIncomplete = false;

      if (opts.deep && opts.historyFetcher) {
        try {
          const histResult = await opts.historyFetcher(repo);
          // Filter to only sensitive filenames; assess() will further exclude HEAD paths.
          historyHits = histResult.paths.filter((p) => classifyPath(p) !== null);
        } catch {
          // A history-fetch error → mark scan-incomplete; never a silent clean.
          historyScanIncomplete = true;
        }
      }

      if (paths !== null && truncated) {
        // Truncated: assess the paths we have but also inject scan-incomplete.
        // We do this by calling assess twice and merging — actually, the cleanest
        // approach is to pass the paths so secret-file findings are preserved,
        // then manually add a scan-incomplete finding on top.
        const base = assess(repo, paths, opts, contentHits, historyHits);
        const extraFindings: Finding[] = [];
        extraFindings.push({
          kind: 'scan-incomplete',
          severity: 'caution',
          label: 'Tree truncated — scan incomplete',
          detail: 'The file tree was truncated; absence of findings is not an all-clear.',
        });
        if (contentScanIncomplete) {
          extraFindings.push({
            kind: 'scan-incomplete',
            severity: 'caution',
            label: 'Content fetch failed — scan incomplete',
            detail: 'A content fetch error occurred during the deep scan.',
          });
        }
        if (historyScanIncomplete) {
          extraFindings.push({
            kind: 'scan-incomplete',
            severity: 'caution',
            label: 'History fetch failed — scan incomplete',
            detail: 'A history fetch error occurred during the deep scan.',
          });
        }
        const findings = [...base.findings, ...extraFindings];
        // Re-derive severity and requiredConfirm to account for the new finding.
        const severity = findings.some((f) => f.severity === 'danger')
          ? ('danger' as const)
          : findings.some((f) => f.severity === 'caution')
            ? ('caution' as const)
            : ('clean' as const);
        const requiredConfirm =
          severity === 'danger' ? ('name' as const) : severity === 'caution' ? ('phrase' as const) : ('y' as const);
        return { repo, findings, severity, requiredConfirm };
      }

      // paths is null (fetch failed) or a normal non-truncated tree.
      const base = assess(repo, paths, opts, contentHits, historyHits);

      // If a content or history fetch error occurred, inject scan-incomplete findings.
      if (contentScanIncomplete || historyScanIncomplete) {
        const extraFindings: Finding[] = [];
        if (contentScanIncomplete) {
          extraFindings.push({
            kind: 'scan-incomplete',
            severity: 'caution',
            label: 'Content fetch failed — scan incomplete',
            detail: 'A content fetch error occurred during the deep scan.',
          });
        }
        if (historyScanIncomplete) {
          extraFindings.push({
            kind: 'scan-incomplete',
            severity: 'caution',
            label: 'History fetch failed — scan incomplete',
            detail: 'A history fetch error occurred during the deep scan.',
          });
        }
        const findings = [...base.findings, ...extraFindings];
        const severity = findings.some((f) => f.severity === 'danger')
          ? ('danger' as const)
          : findings.some((f) => f.severity === 'caution')
            ? ('caution' as const)
            : ('clean' as const);
        const requiredConfirm =
          severity === 'danger' ? ('name' as const) : severity === 'caution' ? ('phrase' as const) : ('y' as const);
        return { repo, findings, severity, requiredConfirm };
      }

      return base;
    }),
  );

  return Promise.all(tasks);
}
