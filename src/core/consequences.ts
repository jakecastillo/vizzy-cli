/**
 * core/consequences.ts — pure, no I/O.
 *
 * consequencesFor(repo, target): string[]
 *
 * Returns concrete human-readable consequences of the planned visibility
 * change using data vizzy already holds about the repo:
 *
 *   Going PRIVATE:
 *     - 'erases N stars'        (only when stars > 0)
 *     - 'detaches N forks'      (only when forksCount > 0)
 *     - 'unpublishes GitHub Pages' (always)
 *
 *   Going PUBLIC:
 *     - 'publishes Actions run logs'
 *     - 'disables push rulesets'
 */

import type { Repo, Target } from '../types.js';

/**
 * Return an array of consequence strings for the planned visibility change.
 * All strings are sentence-fragment style (no trailing period) so callers
 * can format them as a bullet list.
 */
export function consequencesFor(repo: Repo, target: Target): string[] {
  if (target === 'private') {
    const effects: string[] = [];
    if (repo.stars > 0) {
      effects.push(`erases ${repo.stars} stars`);
    }
    if (repo.forksCount > 0) {
      effects.push(`detaches ${repo.forksCount} forks`);
    }
    effects.push('unpublishes GitHub Pages');
    return effects;
  }

  // Going public
  return ['publishes Actions run logs', 'disables push rulesets'];
}
