/**
 * core/scanrules.ts — parse .vizzyscan custom danger globs + allowlist.
 *
 * File format:
 *   # comment lines and blank lines are ignored
 *   deny: <glob>   — add a custom path glob to the deny list
 *   allow: <glob>  — add a path glob to the allowlist (allow beats deny)
 *
 * All other lines are silently ignored.
 *
 * Pure — no I/O. Callers read the file; this module only parses text.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ScanRules {
  /** Globs for paths that should be flagged as sensitive (in addition to built-ins). */
  deny: string[];
  /** Globs for paths that should never be flagged, even if a deny glob matches. */
  allow: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a .vizzyscan file's text content into `{deny, allow}` arrays.
 *
 * - Lines starting with `#` are comments and are dropped.
 * - Blank lines are dropped.
 * - Lines starting with `deny:` contribute to the deny list (glob trimmed).
 * - Lines starting with `allow:` contribute to the allow list (glob trimmed).
 * - All other lines are silently ignored.
 */
export function loadScanRules(text: string): ScanRules {
  const deny: string[] = [];
  const allow: string[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();

    // Drop blank lines and comments
    if (line === '' || line.startsWith('#')) continue;

    if (line.startsWith('deny:')) {
      const glob = line.slice('deny:'.length).trim();
      if (glob !== '') deny.push(glob);
    } else if (line.startsWith('allow:')) {
      const glob = line.slice('allow:'.length).trim();
      if (glob !== '') allow.push(glob);
    }
    // Unrecognized lines are silently dropped
  }

  return { deny, allow };
}
