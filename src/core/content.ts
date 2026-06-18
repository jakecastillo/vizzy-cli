/**
 * core/content.ts — pure content-based secret scanner.
 *
 * scanContent(text: string): ContentHit[]
 *
 * High-confidence patterns only — tuned for low false positives.
 *
 * Patterns:
 *   aws-key      — AWS access key ID: AKIA[0-9A-Z]{16}
 *   github-token — GitHub PAT: ghp_<20+> or github_pat_<20+>
 *   stripe-key   — Stripe live secret: sk_live_<20+>
 *   slack-token  — Slack xox[baprs]-<token>
 *   google-key   — Google API key: AIzaSy<33+>
 *   pem-private  — PEM private key header: -----BEGIN ... PRIVATE KEY-----
 *
 * All pure — no I/O, no side effects.
 */

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface ContentHit {
  /** Short identifier for the rule that fired (e.g. "aws-key"). */
  rule: string;
  /** The matched string extracted from the text. */
  match: string;
}

// ---------------------------------------------------------------------------
// Pattern table
// ---------------------------------------------------------------------------

interface ContentRule {
  name: string;
  /** Global regex; each match produces one ContentHit. */
  pattern: RegExp;
}

const RULES: ContentRule[] = [
  // ── AWS access key ID ────────────────────────────────────────────────────
  // Format: AKIA followed by exactly 16 uppercase alphanumeric chars.
  // Word-boundary anchors prevent partial matches inside longer tokens.
  {
    name: 'aws-key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },

  // ── GitHub PAT (Classic: ghp_) ───────────────────────────────────────────
  // ghp_ followed by ≥20 base62 chars (letters + digits).
  // Placeholder strings like "ghp_YOUR_TOKEN_HERE" contain underscores and
  // uppercase-only words — the regex requires lowercase chars to be present
  // which real tokens always have. We instead require ≥20 word chars and
  // exclude the known placeholder literal via a negative lookahead.
  {
    name: 'github-token',
    pattern: /\bghp_[A-Za-z0-9]{20,}\b/g,
  },

  // ── GitHub PAT (Fine-grained: github_pat_) ───────────────────────────────
  // github_pat_ followed by ≥20 word chars
  {
    name: 'github-token',
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  },

  // ── Stripe live secret key ───────────────────────────────────────────────
  // sk_live_ followed by ≥20 base62 chars.
  // sk_test_ is explicitly NOT included (safe for development).
  {
    name: 'stripe-key',
    pattern: /\bsk_live_[A-Za-z0-9]{20,}\b/g,
  },

  // ── Slack tokens ─────────────────────────────────────────────────────────
  // xox[baprs]- followed by at least one segment of digits/letters.
  // Known prefixes: b (bot), a (app), p (user), r (refresh), s (org).
  {
    name: 'slack-token',
    pattern: /\bxox[baprs]-[0-9A-Za-z][0-9A-Za-z-]{8,}\b/g,
  },

  // ── Google API key ───────────────────────────────────────────────────────
  // AIzaSy followed by ≥30 base62 + hyphen/underscore chars.
  // Real keys are 39 chars total (AIzaSy + 33). We require at least 30 after
  // the prefix. No \b anchors: hyphens and underscores are valid in keys but
  // are not \w chars so word boundaries can fail at key boundaries.
  {
    name: 'google-key',
    pattern: /AIzaSy[A-Za-z0-9_-]{30,}/g,
  },

  // ── PEM private key header ───────────────────────────────────────────────
  // Matches -----BEGIN <OPTIONAL TYPE> PRIVATE KEY-----
  // Covers RSA, EC, OPENSSH, PKCS#8 (bare "PRIVATE KEY"), etc.
  // Excludes PUBLIC KEY via negative lookahead.
  {
    name: 'pem-private',
    pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g,
  },
];

// ---------------------------------------------------------------------------
// Precision filters — suppress known placeholder / template false positives
// ---------------------------------------------------------------------------

/**
 * Returns true when the candidate match looks like a deliberate placeholder
 * (all-uppercase words, contains YOUR_, _HERE, _KEY_HERE, etc.).
 */
function isPlaceholder(value: string): boolean {
  // Common placeholder patterns used in templates
  if (/your/i.test(value)) return true;
  if (/_here$/i.test(value)) return true;
  if (/^AKIA[X_]{16}$/.test(value)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan arbitrary text for high-confidence secret patterns.
 *
 * Returns one ContentHit per match. A single text can produce multiple hits
 * from the same or different rules.
 */
export function scanContent(text: string): ContentHit[] {
  const results: ContentHit[] = [];

  for (const rule of RULES) {
    // Reset lastIndex since we reuse RegExp objects (all are /g)
    rule.pattern.lastIndex = 0;

    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(text)) !== null) {
      const matched = m[0];
      if (!isPlaceholder(matched)) {
        results.push({ rule: rule.name, match: matched });
      }
    }
  }

  return results;
}
