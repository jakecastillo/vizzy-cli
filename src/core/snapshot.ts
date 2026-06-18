/**
 * core/snapshot.ts — pure snapshot + drift detection.
 *
 * snapshot(assessments) -> SnapshotState
 *   Builds {repo -> {visibility, fingerprints: string[]}} from a set of
 *   RepoAssessments. Each finding is fingerprinted as "kind:detail" (detail
 *   may be empty string when the finding has no detail).
 *
 * diffSnapshot(prev, curr) -> SnapshotDiff
 *   Compares two SnapshotState objects and returns:
 *     - newlyPublic: repo names that became public (prev private/absent, curr public)
 *     - newFindings: {repo, kind} for fingerprints present in curr but not prev
 *     - resolved:    {repo, kind} for fingerprints present in prev but not curr
 *   When prev is null (first run), all deltas are empty (no prior baseline to diff).
 *
 * Pure: no I/O, no Date.now(). The caller (audit.ts) handles reading/writing
 * .vizzy/state.json via injected fs helpers.
 */

import type { RepoAssessment } from './checks.js';
import type { Visibility } from '../types.js';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface RepoSnapshot {
  visibility: Visibility;
  /** Each finding fingerprinted as "kind:detail" (detail is '' when absent). */
  fingerprints: string[];
}

/** The on-disk state object: one entry per repo assessed. */
export type SnapshotState = Record<string, RepoSnapshot>;

export interface SnapshotDiff {
  /** Repos that went from private (or absent) in prev to public in curr. */
  newlyPublic: string[];
  /** Findings that are in curr but not in prev. */
  newFindings: Array<{ repo: string; kind: string }>;
  /** Findings that were in prev but are no longer in curr. */
  resolved: Array<{ repo: string; kind: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Produce a stable fingerprint string for a single finding. */
function fingerprint(kind: string, detail: string | undefined): string {
  return `${kind}:${detail ?? ''}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a SnapshotState from an array of RepoAssessments.
 * Each entry records the repo's current visibility and the fingerprinted set
 * of findings, so future runs can diff against it.
 */
export function snapshot(assessments: RepoAssessment[]): SnapshotState {
  const state: SnapshotState = {};
  for (const a of assessments) {
    state[a.repo.name] = {
      visibility: a.repo.visibility,
      fingerprints: a.findings.map((f) => fingerprint(f.kind, f.detail)),
    };
  }
  return state;
}

/**
 * Diff two snapshots.
 *
 * @param prev  - The previously-persisted state, or null if this is the first run.
 * @param curr  - The freshly-computed state.
 * @returns     - Structural deltas: newlyPublic, newFindings, resolved.
 *
 * First-run semantics: when prev is null, all delta arrays are empty — there
 * is no prior baseline to compare against, so nothing counts as "new".
 */
export function diffSnapshot(prev: SnapshotState | null, curr: SnapshotState): SnapshotDiff {
  if (prev === null) {
    return { newlyPublic: [], newFindings: [], resolved: [] };
  }

  const newlyPublic: string[] = [];
  const newFindings: Array<{ repo: string; kind: string }> = [];
  const resolved: Array<{ repo: string; kind: string }> = [];

  // Check all repos in curr
  for (const [repo, currEntry] of Object.entries(curr)) {
    const prevEntry = prev[repo];

    // newlyPublic: curr is public AND (prev was private OR repo is new)
    if (currEntry.visibility === 'public') {
      if (!prevEntry || prevEntry.visibility === 'private') {
        newlyPublic.push(repo);
      }
    }

    // newFindings: fingerprints in curr that weren't in prev
    const prevFps = new Set(prevEntry?.fingerprints ?? []);
    for (const fp of currEntry.fingerprints) {
      if (!prevFps.has(fp)) {
        newFindings.push({ repo, kind: fp });
      }
    }
  }

  // resolved: fingerprints in prev that are no longer in curr
  for (const [repo, prevEntry] of Object.entries(prev)) {
    const currEntry = curr[repo];
    const currFps = new Set(currEntry?.fingerprints ?? []);
    for (const fp of prevEntry.fingerprints) {
      if (!currFps.has(fp)) {
        resolved.push({ repo, kind: fp });
      }
    }
  }

  return { newlyPublic, newFindings, resolved };
}
