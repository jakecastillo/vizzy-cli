/**
 * core/content.test.ts — unit tests for scanContent.
 *
 * Bead vizzy-cli-9cm.5 acceptance:
 *   - Each pattern fires on a realistic sample string.
 *   - Each pattern does NOT fire on benign text / placeholders.
 *   - scanContent is pure (no I/O).
 *
 * Patterns under test:
 *   AWS AK' + 'IA[0-9A-Z]{16}
 *   GitHub  gh' + 'p_<...> / github' + '_pat_<...>
 *   Stripe  sk_' + 'live_<...>
 *   Slack   xo' + 'x[baprs]-<...>
 *   Google  AI' + 'za<...>
 *   PEM header  -----' + 'BEGIN ... PRIVATE KEY-----
 */

import { describe, it, expect } from 'vitest';
import { scanContent, maskSecret } from './content.js';
import type { ContentHit } from './content.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hits(text: string): ContentHit[] {
  return scanContent(text);
}

function expectHit(text: string, ruleFragment: string) {
  const result = hits(text);
  expect(result.length, `expected at least one hit for "${text}"`).toBeGreaterThan(0);
  const matching = result.filter((h) => h.rule.includes(ruleFragment));
  expect(
    matching.length,
    `expected a hit with rule containing "${ruleFragment}" in "${text}", got rules: ${result.map((h) => h.rule).join(', ')}`,
  ).toBeGreaterThan(0);
}

function expectClean(text: string) {
  const result = hits(text);
  expect(result, `expected no hits for "${text}" but got: ${result.map((h) => h.rule).join(', ')}`).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// AWS access key
// ---------------------------------------------------------------------------

describe('scanContent — AWS AK' + 'IA', () => {
  it('hits on a realistic AWS access key ID', () => {
    expectHit('export AWS_ACCESS_KEY_ID=AK' + 'IAIOSFODNN7EXAMPLE', 'aws');
  });

  it('hits mid-line in a config file', () => {
    expectHit('aws_access_key_id = AK' + 'IAJYECFX3YPLH3CXUQ', 'aws');
  });

  it('hits when the key is 20 chars (AK' + 'IA + 16)', () => {
    // AK' + 'IA + exactly 16 uppercase alphanum chars = 20 total
    expectHit('AK' + 'IAIOSFODNN7EXAMPLE', 'aws');
  });

  it('does NOT hit on AK' + 'IA + only 15 chars (too short)', () => {
    // AK' + 'IA + 15 chars = 19 total (one short)
    expectClean('AK' + 'IAIOSFODNN7EXAM');
  });

  it('does NOT hit on a placeholder like AK' + 'IAXXXXXXXXXXXXXXXX', () => {
    // Placeholders should not use only uppercase letters that look real;
    // test: contains lowercase 'x' so it should not match [0-9A-Z]{16}
    expectClean('AK' + 'IA_placeholder_value');
  });

  it('does NOT hit on benign prose containing AK' + 'IA', () => {
    expectClean('The prefix for AWS access keys is AK' + 'IA but this has no valid key here.');
  });
});

// ---------------------------------------------------------------------------
// AWS secret access key (the 40-char value — the credential that actually
// matters, not just the AK' + 'IA id). Assignment-anchored to stay precise.
// ---------------------------------------------------------------------------

describe('scanContent — AWS secret access key', () => {
  it('hits on aws_secret_access_key assignment with a 40-char value', () => {
    expectHit('aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'aws');
  });

  it('hits on the upper-case env-var form', () => {
    expectHit('AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"', 'aws');
  });

  it('does NOT hit on a placeholder value', () => {
    expectClean('aws_secret_access_key=your_secret_key_here');
  });

  it('does NOT hit on a bare 40-char string with no aws_secret context', () => {
    // A 40-char hex blob (e.g. a git SHA / hash) must not trip the rule.
    expectClean('const hash = "0123456789abcdef0123456789abcdef01234567"');
  });
});

// ---------------------------------------------------------------------------
// GitHub tokens
// ---------------------------------------------------------------------------

describe('scanContent — GitHub tokens', () => {
  it('hits on gh' + 'p_ token', () => {
    expectHit('GITHUB_TOKEN=gh' + 'p_16C7e42F292c6912E7710c838347Ae178B4a', 'github');
  });

  it('hits on github' + '_pat_ token', () => {
    expectHit('token: github' + '_pat_11ABCDE0_longRandomStringHere12345678', 'github');
  });

  it('hits on gh' + 'p_ token inline', () => {
    expectHit('Authorization: Bearer gh' + 'p_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123', 'github');
  });

  it('does NOT hit on benign "ghp" without underscore', () => {
    expectClean('The word ghp is not a token without the underscore.');
  });

  it('does NOT hit on a short gh' + 'p_ string (placeholder)', () => {
    // A realistic placeholder that is clearly not a token
    expectClean('set GITHUB_TOKEN=gh' + 'p_YOUR_TOKEN_HERE');
  });

  it('does NOT hit on plain GitHub URL', () => {
    expectClean('https://github.com/owner/repo is a public URL');
  });

  // GitHub also issues gho_ (OAuth), ghu_ (user-to-server), ghs_ (server-to-
  // server / Actions / app installation) and ghr_ (refresh) tokens — all live,
  // exfiltratable credentials, not just classic ghp_.
  it('hits on gh' + 'o_ OAuth token', () => {
    expectHit('token=gh' + 'o_16C7e42F292c6912E7710c838347Ae178B4a', 'github');
  });

  it('hits on gh' + 's_ server-to-server token', () => {
    expectHit('token=gh' + 's_16C7e42F292c6912E7710c838347Ae178B4a', 'github');
  });

  it('hits on gh' + 'u_ user-to-server token', () => {
    expectHit('token=gh' + 'u_16C7e42F292c6912E7710c838347Ae178B4a', 'github');
  });

  it('hits on gh' + 'r_ refresh token', () => {
    expectHit('token=gh' + 'r_16C7e42F292c6912E7710c838347Ae178B4a', 'github');
  });

  it('does NOT hit on a short gh' + 'o_ placeholder', () => {
    expectClean('token=gh' + 'o_short');
  });
});

// ---------------------------------------------------------------------------
// Stripe secret key
// ---------------------------------------------------------------------------

describe('scanContent — Stripe sk_' + 'live_', () => {
  it('hits on a realistic Stripe secret key', () => {
    expectHit('STRIPE_SECRET_KEY=sk_' + 'live_51ABCDEFGHIJKLMNOPQRSTUVwx', 'stripe');
  });

  it('hits mid-line', () => {
    expectHit('const stripe = Stripe("sk_' + 'live_ABCDEFGHIJKLMNOP1234567890abcdef")', 'stripe');
  });

  it('does NOT hit on sk_' + 'test_ key', () => {
    expectClean('sk_' + 'test_51ABCDEFGHIJKLMNOPQRSTUVwx is a test key and safe');
  });

  it('does NOT hit on sk_' + 'live_ with fewer than 20 chars after prefix', () => {
    expectClean('sk_' + 'live_tooshort');
  });

  it('does NOT hit on benign prose containing live', () => {
    expectClean('We run sk_' + 'live_ style config but only in prod — see the docs.');
  });
});

// ---------------------------------------------------------------------------
// Slack tokens
// ---------------------------------------------------------------------------

describe('scanContent — Slack xo' + 'x tokens', () => {
  it('hits on xo' + 'xb- bot token', () => {
    expectHit('SLACK_TOKEN=xo' + 'xb-123456789012-1234567890123-abcdefghijklmnopqrstuvwx', 'slack');
  });

  it('hits on xo' + 'xa- app token', () => {
    expectHit('token = xo' + 'xa-2-ABCDEFGHIJKLMNOP-1234567890', 'slack');
  });

  it('hits on xo' + 'xp- user token', () => {
    expectHit('xo' + 'xp-123456789-123456789-123456789-abc', 'slack');
  });

  it('hits on xo' + 'xr- refresh token', () => {
    expectHit('refresh_token: xo' + 'xr-123456789012-abcde12345', 'slack');
  });

  it('hits on xo' + 'xs- org token', () => {
    expectHit('xo' + 'xs-123456789012-1234567890123-something', 'slack');
  });

  it('does NOT hit on xo' + 'xz- (not a known Slack prefix)', () => {
    expectClean('xo' + 'xz-123456789012 is not a real Slack token prefix');
  });

  it('does NOT hit on benign text with xo' + 'x', () => {
    expectClean('The word xo' + 'x means nothing by itself in this sentence.');
  });
});

// ---------------------------------------------------------------------------
// Google API key
// ---------------------------------------------------------------------------

describe('scanContent — Google AI' + 'za', () => {
  it('hits on a realistic Google API key', () => {
    expectHit('GOOGLE_API_KEY=AI' + 'zaSyDt_8nU6Xk0pL9qW2mV3rBhJeI7fG5cYoA', 'google');
  });

  it('hits on key embedded in a URL', () => {
    // AI' + 'zaSy + 33 alphanumeric chars = 39 total (standard Google API key length)
    expectHit('https://maps.googleapis.com/maps/api/js?key=AI' + 'zaSyDt_8nU6Xk0pL9qW2mV3rBhJeI7fG5cYoA', 'google');
  });

  it('hits on key with hyphen (allowed in Google keys)', () => {
    // AI' + 'zaSy + 33 chars including hyphen
    expectHit('key=AI' + 'zaSyD-ABCDEFGHIJKLMNOPQRSTUVWXYZab', 'google');
  });

  it('does NOT hit on benign text containing AI' + 'za', () => {
    expectClean('The prefix AI' + 'za is used by Google but this string is too short to match.');
  });

  it('does NOT hit on AI' + 'za with only 5 chars after (too short)', () => {
    expectClean('AI' + 'zaSyABC');
  });
});

// ---------------------------------------------------------------------------
// PEM private key headers
// ---------------------------------------------------------------------------

describe('scanContent — PEM private key headers', () => {
  it('hits on BEGIN RSA PRIVATE KEY', () => {
    expectHit('-----' + 'BEGIN RSA PRIVATE KEY-----', 'pem');
  });

  it('hits on BEGIN PRIVATE KEY (PKCS#8)', () => {
    expectHit('-----' + 'BEGIN PRIVATE KEY-----', 'pem');
  });

  it('hits on BEGIN EC PRIVATE KEY', () => {
    expectHit('-----' + 'BEGIN EC PRIVATE KEY-----', 'pem');
  });

  it('hits on BEGIN OPENSSH PRIVATE KEY', () => {
    expectHit('-----' + 'BEGIN OPENSSH PRIVATE KEY-----', 'pem');
  });

  it('hits when embedded in a multi-line string', () => {
    const keyBlock = [
      'const key = `',
      '-----' + 'BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA...',
      '-----END RSA PRIVATE KEY-----',
      '`',
    ].join('\n');
    expectHit(keyBlock, 'pem');
  });

  it('does NOT hit on BEGIN CERTIFICATE (not a private key)', () => {
    expectClean('-----' + 'BEGIN CERTIFICATE-----');
  });

  it('does NOT hit on BEGIN PUBLIC KEY', () => {
    expectClean('-----' + 'BEGIN PUBLIC KEY-----');
  });

  it('does NOT hit on plain text mentioning private key docs', () => {
    expectClean('See the section on PRIVATE KEY management in the docs.');
  });
});

// ---------------------------------------------------------------------------
// Placeholder precision — "your" must only suppress a DELIMITED template word,
// never an embedded substring of a real high-entropy token (suppressing a true
// positive is the worst failure mode for a secret scanner).
// ---------------------------------------------------------------------------

describe('scanContent — placeholder "your" does not eat real tokens', () => {
  it('hits a real gh' + 'p_ token whose random body contains the substring your', () => {
    // body = abc + your + def...0123 (34 base62 chars); "your" is embedded
    // between alphanumerics, NOT a delimited placeholder word.
    expectHit('GITHUB_TOKEN=gh' + 'p_abcyourdefghijklmnopqrstuvwxyz0123', 'github');
  });

  it('hits a real Google key whose body contains the substring your', () => {
    expectHit('GOOGLE_API_KEY=AI' + 'zaSyDyourABCDEFGHIJKLMNOPQRSTUVWXYZ', 'google');
  });

  it('still suppresses a delimited "your" placeholder (Slack -your-)', () => {
    expectClean('SLACK_BOT_TOKEN=xo' + 'xb-your-bot-token');
  });
});

// ---------------------------------------------------------------------------
// JWT (eyJ<header>.eyJ<payload>.<signature>) — a common leaked credential in
// .env / config / fixtures. The two eyJ-prefixed base64url segments (base64 of
// '{"') make this a high-precision anchor.
// ---------------------------------------------------------------------------

describe('scanContent — JWT', () => {
  it('hits on a 3-segment JWT', () => {
    expectHit(
      'TOKEN=' +
        'ey' +
        'JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      'jwt',
    );
  });

  it('does NOT hit on a single base64url segment (no dots)', () => {
    expectClean('value=' + 'ey' + 'JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  it('does NOT hit on benign dotted prose', () => {
    expectClean('the quick.brown.fox jumps over the lazy dog');
  });
});

// ---------------------------------------------------------------------------
// maskSecret — redact a detected secret for display/persistence so the tool
// never re-exposes what it found (stdout, CI logs, SARIF/JSON, drift snapshot).
// ---------------------------------------------------------------------------

describe('maskSecret', () => {
  const RAW = 'AK' + 'IAIOSFODNN7EXAMPLE';

  it('never contains any run of the raw secret', () => {
    expect(maskSecret(RAW)).not.toContain(RAW);
  });

  it('includes the length for human context', () => {
    expect(maskSecret(RAW)).toContain(String(RAW.length));
  });

  it('is deterministic for the same secret (drift-stable)', () => {
    expect(maskSecret(RAW)).toBe(maskSecret(RAW));
  });

  it('distinguishes two different secrets of the same length', () => {
    const a = 'AK' + 'IAIOSFODNN7EXAMPLE';
    const b = 'AK' + 'IA1234567890ABCDEF'; // same length, different value
    expect(maskSecret(a)).not.toBe(maskSecret(b));
  });
});

// ---------------------------------------------------------------------------
// Return shape
// ---------------------------------------------------------------------------

describe('scanContent — ContentHit shape', () => {
  it('hit has rule and match fields', () => {
    // AK' + 'IAIOSFODNN7EXAMPLE is exactly AK' + 'IA + 16 chars = 20 total — valid AWS key
    const real = scanContent('AK' + 'IAIOSFODNN7EXAMPLE');
    expect(real.length).toBeGreaterThan(0);
    const hit = real[0];
    expect(hit).toHaveProperty('rule');
    expect(hit).toHaveProperty('match');
    expect(typeof hit.rule).toBe('string');
    expect(typeof hit.match).toBe('string');
  });

  it('returns empty array for clean text', () => {
    expect(scanContent('Hello world, nothing to see here.')).toHaveLength(0);
  });

  it('returns multiple hits when multiple patterns match', () => {
    const text = [
      // Valid AK' + 'IA key: AK' + 'IA + 16 = 20 chars
      'key=AK' + 'IAIOSFODNN7EXAMPLE',
      // Valid GitHub gh' + 'p_ token: gh' + 'p_ + 20+ alphanumeric
      'token=gh' + 'p_ABCDEFGHIJKLMNOPQRSTUVWXYZa0123456',
    ].join('\n');
    const result = scanContent(text);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Precision guard: benign text must stay clean
// ---------------------------------------------------------------------------

describe('scanContent — benign text does not fire', () => {
  it('README prose', () => {
    expectClean([
      '# My Project',
      '',
      'This project uses AWS, GitHub, Stripe, and Slack integrations.',
      'Set GITHUB_TOKEN in your environment. See .env.example for all vars.',
      'Never commit secrets. Use a secrets manager.',
    ].join('\n'));
  });

  it('.env.example template', () => {
    expectClean([
      'AWS_ACCESS_KEY_ID=your_access_key_here',
      'AWS_SECRET_ACCESS_KEY=your_secret_key_here',
      'GITHUB_TOKEN=gh' + 'p_YOUR_TOKEN_HERE',
      'STRIPE_SECRET_KEY=sk_' + 'test_YOUR_KEY',
      'SLACK_BOT_TOKEN=xo' + 'xb-your-bot-token',
      'GOOGLE_API_KEY=your_google_key',
    ].join('\n'));
  });
});
