/**
 * Sensitive-file classifier (pure, filename-based).
 *
 * Rules are an ordered named table so adding a rule is one line and every
 * hit carries the rule name for the UI / tests.
 */

export interface SensitiveHit {
  path: string;
  rule: string;
}

// ---------------------------------------------------------------------------
// Minimal glob matcher (no runtime deps)
// ---------------------------------------------------------------------------
// Supports: * (any chars except /), ** (any chars including /), ? (single char)
// Does NOT support character classes or braces — sufficient for .vizzyscan usage.

function globToRegex(glob: string): RegExp {
  // Escape regex metacharacters except * and ?
  let pattern = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i]!;
    if (ch === '*' && glob[i + 1] === '*') {
      // ** — match any sequence including slashes
      pattern += '.*';
      i += 2;
      // Skip an optional trailing slash after **
      if (glob[i] === '/') i++;
    } else if (ch === '*') {
      // * — match any sequence except /
      pattern += '[^/]*';
      i++;
    } else if (ch === '?') {
      // ? — match any single char except /
      pattern += '[^/]';
      i++;
    } else {
      // Escape regex special chars
      pattern += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return new RegExp(`^${pattern}$`);
}

/** Returns true if the normalised path matches any of the given globs. */
function matchesAnyGlob(normalizedPath: string, globs: string[]): boolean {
  for (const glob of globs) {
    const re = globToRegex(glob);
    // Match against the full path AND just the basename so that globs like
    // "*.secret" work on both "deploy.secret" and "config/deploy.secret".
    if (re.test(normalizedPath)) return true;
    const basename = normalizedPath.split('/').pop() ?? normalizedPath;
    if (re.test(basename)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Extra rules type (injected by callers, e.g. from loadScanRules)
// ---------------------------------------------------------------------------

export interface ExtraRules {
  deny: string[];
  allow: string[];
}

// ---------------------------------------------------------------------------
// Excluded directory prefixes — anything under these trees is never flagged.
// ---------------------------------------------------------------------------

const EXCLUDED_DIRS = ['node_modules/', '.git/', 'vendor/', 'dist/', 'build/'];

// ---------------------------------------------------------------------------
// Rule table — each entry is a named predicate over the *basename*.
// Rules are evaluated in order; the first match wins.
// All comparisons are case-insensitive (basename is lower-cased before checks).
// ---------------------------------------------------------------------------

interface Rule {
  name: string;
  match: (basename: string) => boolean;
}

const RULES: Rule[] = [
  // ── .env ────────────────────────────────────────────────────────────────
  {
    name: 'env-file',
    match: (b) => {
      if (!b.startsWith('.env')) return false;
      // Bare ".env" — flag it.
      if (b === '.env') return true;
      // ".env.<suffix>" — allow safe conventional suffixes.
      if (b.startsWith('.env.')) {
        const suffix = b.slice(5); // the part after ".env."
        const safeEnvSuffixes = ['example', 'sample', 'template', 'dist', 'defaults'];
        return !safeEnvSuffixes.includes(suffix);
      }
      return false;
    },
  },

  // ── Private SSH / raw keys ───────────────────────────────────────────────
  {
    name: 'private-key',
    match: (b) => {
      // Named private key files (without .pub)
      const namedPrivateKeys = ['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'];
      if (namedPrivateKeys.includes(b)) return true;

      // *.pub — public keys, never flag
      if (b.endsWith('.pub')) return false;

      // *.pub.key and *.public.key — explicitly excluded
      if (b.endsWith('.pub.key') || b.endsWith('.public.key')) return false;

      // *.pem — all flagged
      if (b.endsWith('.pem')) return true;

      // *.key — flagged (exclusions already handled above)
      if (b.endsWith('.key')) return true;

      // *.ppk, *.p12, *.pfx, *.keystore, *.jks
      if (
        b.endsWith('.ppk') ||
        b.endsWith('.p12') ||
        b.endsWith('.pfx') ||
        b.endsWith('.keystore') ||
        b.endsWith('.jks')
      )
        return true;

      return false;
    },
  },

  // ── Credentials ──────────────────────────────────────────────────────────
  {
    name: 'credentials',
    match: (b) => {
      // credentials* — bare, credentials.json, credentials_backup.json, etc.
      // EXCEPT conventional samples (credentials.example*/.sample*/.template*).
      if (b.startsWith('credentials')) {
        const after = b.slice('credentials'.length);
        if (
          after.startsWith('.example') ||
          after.startsWith('.sample') ||
          after.startsWith('.template')
        ) {
          return false;
        }
        return true;
      }

      // .npmrc / .pypirc
      if (b === '.npmrc' || b === '.pypirc') return true;

      // service-account*.json
      if (b.startsWith('service-account') && b.endsWith('.json')) return true;

      // *-service-account.json
      if (b.endsWith('-service-account.json')) return true;

      // gcloud-*.json
      if (b.startsWith('gcloud-') && b.endsWith('.json')) return true;

      // *.kdbx
      if (b.endsWith('.kdbx')) return true;

      // secrets.* — EXCEPT secrets.example.*
      if (b === 'secrets') return true;
      if (b.startsWith('secrets.')) {
        // e.g. "secrets.example.json" — the part after "secrets." starts with "example"
        const afterSecrets = b.slice('secrets.'.length);
        // Only "secrets.example" or "secrets.example.<ext>" are conventional samples;
        // "secrets.example2.json" / "secrets.examplefile.json" are real and must flag.
        if (afterSecrets === 'example' || afterSecrets.startsWith('example.')) return false;
        return true;
      }

      return false;
    },
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a single file path.
 *
 * Returns a `SensitiveHit` if the path matches a danger rule, or `null`
 * if it is considered safe (exclusions apply first).
 *
 * @param extra  Optional custom rules from a .vizzyscan file.
 *               `extra.deny` globs add matches on top of built-in rules.
 *               `extra.allow` globs override both built-in rules and deny
 *               globs (allow beats deny).
 */
export function classifyPath(path: string, extra?: ExtraRules): SensitiveHit | null {
  const normalizedPath = path.replace(/\\/g, '/');

  // ── Allow-list check (extra.allow beats everything) ──────────────────────
  if (extra && extra.allow.length > 0) {
    if (matchesAnyGlob(normalizedPath, extra.allow)) {
      return null;
    }
  }

  // ── Directory exclusions ─────────────────────────────────────────────────
  for (const dir of EXCLUDED_DIRS) {
    if (normalizedPath.includes(`/${dir}`) || normalizedPath.startsWith(dir)) {
      return null;
    }
  }

  // ── *.lock exclusion ─────────────────────────────────────────────────────
  const rawBasename = normalizedPath.split('/').pop() ?? normalizedPath;
  if (rawBasename.endsWith('.lock')) return null;

  // ── Rule matching (case-insensitive via lowercase basename) ──────────────
  const basename = rawBasename.toLowerCase();

  for (const rule of RULES) {
    if (rule.match(basename)) {
      return { path, rule: rule.name };
    }
  }

  // ── Custom deny globs (from .vizzyscan) ──────────────────────────────────
  if (extra && extra.deny.length > 0) {
    if (matchesAnyGlob(normalizedPath, extra.deny)) {
      return { path, rule: 'custom-deny' };
    }
  }

  return null;
}

/**
 * Scan an array of file paths and return all sensitive hits.
 *
 * @param extra  Optional custom rules from a .vizzyscan file (passed through to classifyPath).
 */
export function scanPaths(paths: string[], extra?: ExtraRules): SensitiveHit[] {
  const hits: SensitiveHit[] = [];
  for (const p of paths) {
    const hit = classifyPath(p, extra);
    if (hit !== null) hits.push(hit);
  }
  return hits;
}
