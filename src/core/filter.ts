import type { Repo, Target } from '../types.js';

export interface FilterOptions {
  includeForks: boolean;
  includeArchived: boolean;
}

/**
 * Return the repos eligible to change to `target`: those whose current
 * visibility differs from `target`, honoring fork/archived options,
 * sorted by pushedAt descending (most recently pushed first).
 */
export function eligibleRepos(
  repos: Repo[],
  target: Target,
  opts: FilterOptions,
): Repo[] {
  return repos
    .filter((r) => r.visibility !== target)
    .filter((r) => opts.includeForks || !r.isFork)
    .filter((r) => opts.includeArchived || !r.isArchived)
    .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
}
