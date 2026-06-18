/**
 * core/select.ts — pure non-interactive selection resolver.
 *
 * resolveSelection(eligible, spec): { selected, unknown }
 *
 * - spec.repos: names matched against eligible (case-sensitive, by repo.name).
 *   Unknown names (not found in eligible) are returned in `unknown`.
 * - spec.allEligible: when true, all eligible repos are selected.
 * - Pure — no file/stdin reading; that is the CLI layer's responsibility.
 */

import type { Repo } from '../types.js';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface SelectionSpec {
  /** Explicit repo names to select. Unknown names surface in `unknown`. */
  repos?: string[];
  /** When true, select all eligible repos. */
  allEligible?: boolean;
}

export interface SelectionResult {
  /** Repos from `eligible` that were matched. Order follows `eligible`. */
  selected: Repo[];
  /** Names from `spec.repos` that were not found in `eligible`. */
  unknown: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a selection spec against an array of eligible repos.
 *
 * @param eligible - The full pool of repos to select from.
 * @param spec     - Selection spec: either a list of names or allEligible flag.
 * @returns        - `selected` repos (in eligible order) and `unknown` names.
 */
export function resolveSelection(eligible: Repo[], spec: SelectionSpec): SelectionResult {
  if (spec.allEligible) {
    return { selected: [...eligible], unknown: [] };
  }

  if (!spec.repos || spec.repos.length === 0) {
    return { selected: [], unknown: [] };
  }

  const eligibleByName = new Map<string, Repo>(eligible.map((r) => [r.name, r]));

  const requestedSet = new Set(spec.repos);

  // Unknown: names not present in eligible
  const unknown = spec.repos.filter((name) => !eligibleByName.has(name));

  // Selected: eligible repos whose name was requested, preserving eligible order
  const selected = eligible.filter((r) => requestedSet.has(r.name));

  return { selected, unknown };
}
