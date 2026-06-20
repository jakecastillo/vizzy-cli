import { createHash } from 'node:crypto';

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

  // ── AWS secret access key ────────────────────────────────────────────────
  // The 40-char base64 secret — the credential that actually grants access (the
  // AKIA id alone is useless). A bare 40-char base64 blob is common (git SHAs,
  // hashes), so we anchor on an aws_secret_access_key assignment via lookbehind
  // and match ONLY the value; that keeps false positives low. isPlaceholder
  // still filters template values like "your_secret_key_here".
  {
    name: 'aws-secret',
    pattern: /(?<=aws_secret_access_key["'\s:=]{1,8})[A-Za-z0-9/+]{40}\b/gi,
  },

  // ── GitHub tokens (ghp_/gho_/ghu_/ghs_/ghr_) ─────────────────────────────
  // One of GitHub's single-letter token prefixes followed by ≥20 base62 chars:
  //   p = classic PAT, o = OAuth, u = user-to-server,
  //   s = server-to-server / Actions / app installation, r = refresh.
  // All are live, exfiltratable credentials. Placeholders like
  // "ghp_YOUR_TOKEN_HERE" contain underscores, so the ≥20 base62-char
  // requirement (no underscores) already excludes them.
  {
    name: 'github-token',
    pattern: /\bgh[posur]_[A-Za-z0-9]{20,}\b/g,
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

  // ── JSON Web Token (JWT) ─────────────────────────────────────────────────
  // header.payload.signature, where header and payload are base64url segments
  // that begin with "eyJ" — the base64 encoding of '{"'. Requiring TWO such
  // segments plus a signature makes this a high-precision anchor with very low
  // false-positive risk on ordinary dotted text.
  {
    name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
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
  // "your" only signals a template when it is a DELIMITED word — bounded by a
  // non-alphanumeric (e.g. YOUR_TOKEN, your-bot-token) or the string ends. A
  // real high-entropy token whose random base62 body merely contains the
  // letters y-o-u-r (e.g. ghp_abc**your**def…) must NOT be suppressed:
  // dropping a true positive is worse than the false positive it prevents.
  if (/(?:^|[^a-z0-9])your(?:[^a-z0-9]|$)/i.test(value)) return true;
  if (/_here$/i.test(value)) return true;
  if (/^AKIA[X_]{16}$/.test(value)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Redact a detected secret for any user-facing or persisted surface.
 *
 * A secret scanner must never re-expose what it finds — not in stdout / CI
 * logs, not in SARIF/JSON output, not in the on-disk drift snapshot. Returns a
 * non-reversible sha256 prefix plus the length, with NO bytes of the secret
 * itself, yet deterministic enough that drift detection can still tell two
 * distinct secrets apart.
 */
export function maskSecret(value: string): string {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 8);
  return `redacted:${digest} (${value.length} chars)`;
}

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
