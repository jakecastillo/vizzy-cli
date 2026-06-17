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
      // credentials (bare) or credentials.json
      if (b === 'credentials' || b === 'credentials.json') return true;

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
        if (afterSecrets.startsWith('example')) return false;
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
 */
export function classifyPath(path: string): SensitiveHit | null {
  const normalizedPath = path.replace(/\\/g, '/');

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

  return null;
}

/**
 * Scan an array of file paths and return all sensitive hits.
 */
export function scanPaths(paths: string[]): SensitiveHit[] {
  const hits: SensitiveHit[] = [];
  for (const p of paths) {
    const hit = classifyPath(p);
    if (hit !== null) hits.push(hit);
  }
  return hits;
}
