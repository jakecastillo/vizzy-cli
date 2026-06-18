/**
 * archive.ts — headless archive/unarchive flow.
 *
 * runArchive(deps, flags): Promise<number>
 *
 * Deps are injected (no network in tests):
 *   loadRepos   — async loader of all owned repos
 *   setArchived — (owner, name, archived) => Promise<void>
 *
 * Algorithm:
 *   1. Validate: require an explicit selector (--repos or --all-eligible) and
 *      --yes in non-interactive use; without them and no TTY → exit 2.
 *   2. Load repos; compute eligible pool:
 *        --archive   → repos where isArchived === false
 *        --unarchive → repos where isArchived === true
 *   3. Resolve selection via core/select.js resolveSelection.
 *      Unknown names → stderr, exit 2.
 *   4. Apply via applyChanges(repos, mutation) where:
 *        mutation = (r) => setArchived(r.owner, r.name, archive ? true : false)
 *   5. Emit text (default) or --json summary.
 *   6. Return exit code:
 *        0  all applied successfully (or nothing eligible)
 *        1  any apply failure
 *        2  usage error (unknown names, no selection)
 *
 * Note: No exposure scan is run — archiving is non-exposing and reversible.
 */

import { resolveSelection } from './core/select.js';
import { applyChanges } from './apply.js';
import type { Repo } from './types.js';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface ArchiveDeps {
  /** Async loader of all owned repos (injected; tests supply a fake array). */
  loadRepos: () => Promise<Repo[]>;
  /**
   * Archive or unarchive a single repo. Injected; real impl wraps
   * github.ts#setArchived bound to the octokit instance.
   */
  setArchived: (owner: string, name: string, archived: boolean) => Promise<void>;
}

export interface ArchiveFlags {
  /** Archive selected repos (make read-only). */
  archive?: boolean;
  /** Unarchive selected repos (restore write access). */
  unarchive?: boolean;
  /** Explicit repo names to operate on. */
  repos?: string[];
  /** Select all eligible repos. */
  allEligible?: boolean;
  /** Apply without interactive confirmation (required in non-TTY). */
  yes?: boolean;
  /** Output JSON instead of human text. */
  json?: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the headless archive/unarchive flow.
 *
 * @param deps  - Injected loader and setArchived.
 * @param flags - Parsed CLI flags for this mode.
 * @returns     - Exit code per the contract (0/1/2).
 */
export async function runArchive(deps: ArchiveDeps, flags: ArchiveFlags): Promise<number> {
  const doArchive = flags.archive === true;
  // doArchive is true for --archive, false for --unarchive

  // ── 1. Validate selection spec ────────────────────────────────────────────
  const hasSelection = (flags.repos && flags.repos.length > 0) || flags.allEligible;
  const hasTTY = process.stdin.isTTY && process.stdout.isTTY;

  if (!hasSelection && !hasTTY) {
    const cmd = doArchive ? '--archive' : '--unarchive';
    process.stderr.write(
      `vizzy archive: no selection given and no TTY detected.\n` +
        `\n` +
        `To run headless, provide an explicit selector and --yes:\n` +
        `  vizzy ${cmd} --all-eligible --yes\n` +
        `  vizzy ${cmd} --repos alpha,beta --yes\n`,
    );
    return 2;
  }

  // ── 2. Load repos + compute eligible pool ────────────────────────────────
  const allRepos = await deps.loadRepos();

  // For --archive: eligible = repos not yet archived.
  // For --unarchive: eligible = repos that are archived.
  const eligible = doArchive
    ? allRepos.filter((r) => !r.isArchived)
    : allRepos.filter((r) => r.isArchived);

  // ── 3. Resolve selection ──────────────────────────────────────────────────
  const { selected, unknown } = resolveSelection(eligible, {
    repos: flags.repos,
    allEligible: flags.allEligible,
  });

  if (unknown.length > 0) {
    const names = unknown.join(', ');
    process.stderr.write(
      `vizzy archive: unknown repo name(s): ${names}\n` +
        `Check the name or use --all-eligible to operate on all eligible repos.\n`,
    );
    return 2;
  }

  // ── 4. Apply ──────────────────────────────────────────────────────────────
  const targetArchived = doArchive;
  const applyResults = await applyChanges(
    selected,
    (r: Repo) => deps.setArchived(r.owner, r.name, targetArchived),
  );

  // ── 5. Emit output ────────────────────────────────────────────────────────
  if (flags.json) {
    emitJson(applyResults, doArchive);
  } else {
    emitText(applyResults, doArchive, selected);
  }

  // ── 6. Compute exit code ──────────────────────────────────────────────────
  const hasFailure = applyResults.some((r) => !r.ok);
  return hasFailure ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function emitText(
  results: Array<{ name: string; ok: boolean; error?: string }>,
  doArchive: boolean,
  selected: Repo[],
): void {
  const action = doArchive ? 'archived' : 'unarchived';

  if (selected.length === 0) {
    process.stdout.write(`No repos eligible to ${doArchive ? 'archive' : 'unarchive'}.\n`);
    return;
  }

  for (const r of results) {
    if (r.ok) {
      process.stdout.write(`${r.name}  ${action}\n`);
    } else {
      const errStr = r.error ? ` — ${r.error}` : '';
      process.stdout.write(`${r.name}  FAILED${errStr}\n`);
    }
  }
}

function emitJson(
  results: Array<{ name: string; ok: boolean; error?: string }>,
  doArchive: boolean,
): void {
  const action = doArchive ? 'archive' : 'unarchive';
  const repos = results.map((r) => ({
    name: r.name,
    action,
    applied: r.ok,
    error: r.error,
  }));
  process.stdout.write(JSON.stringify({ repos }, null, 2) + '\n');
}
