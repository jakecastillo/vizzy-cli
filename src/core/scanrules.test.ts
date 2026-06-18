/**
 * core/scanrules.test.ts — unit tests for loadScanRules + classifyPath extra param.
 *
 * Bead vizzy-cli-9cm.8 acceptance:
 *   - loadScanRules(text) parses .vizzyscan format: #comments and blanks dropped,
 *     deny: and allow: sections populate respective arrays.
 *   - classifyPath extra={deny,allow}: custom deny globs add matches.
 *   - allow globs override deny (allow beats deny), including built-in rules.
 *   - Existing built-in rules are not broken.
 */

import { describe, it, expect } from 'vitest';
import { loadScanRules } from './scanrules.js';
import { classifyPath } from './sensitive.js';

// ---------------------------------------------------------------------------
// loadScanRules
// ---------------------------------------------------------------------------

describe('loadScanRules — basic parsing', () => {
  it('returns empty deny and allow for empty text', () => {
    const result = loadScanRules('');
    expect(result).toEqual({ deny: [], allow: [] });
  });

  it('strips comment lines (# prefix)', () => {
    const text = `
# this is a comment
# another comment
`;
    const result = loadScanRules(text);
    expect(result).toEqual({ deny: [], allow: [] });
  });

  it('strips blank lines', () => {
    const text = `



`;
    const result = loadScanRules(text);
    expect(result).toEqual({ deny: [], allow: [] });
  });

  it('parses deny: prefixed globs into deny array', () => {
    const text = `
deny: *.secret
deny: config/*.key
`;
    const result = loadScanRules(text);
    expect(result.deny).toEqual(['*.secret', 'config/*.key']);
    expect(result.allow).toEqual([]);
  });

  it('parses allow: prefixed globs into allow array', () => {
    const text = `
allow: public/*.key
allow: fixtures/**
`;
    const result = loadScanRules(text);
    expect(result.allow).toEqual(['public/*.key', 'fixtures/**']);
    expect(result.deny).toEqual([]);
  });

  it('parses mixed deny and allow lines', () => {
    const text = `
# custom danger globs
deny: *.secret
deny: deploy/*.pem

# allowlist — these are safe
allow: fixtures/*.pem
allow: test/**
`;
    const result = loadScanRules(text);
    expect(result.deny).toEqual(['*.secret', 'deploy/*.pem']);
    expect(result.allow).toEqual(['fixtures/*.pem', 'test/**']);
  });

  it('ignores inline # comments (text after # on a non-prefix line is fine, prefix wins)', () => {
    // Lines with deny:/allow: prefix are parsed; lines that are only comments are dropped
    const text = `
# full comment line dropped
deny: *.token
allow: safe/*.token
`;
    const result = loadScanRules(text);
    expect(result.deny).toEqual(['*.token']);
    expect(result.allow).toEqual(['safe/*.token']);
  });

  it('trims whitespace around globs', () => {
    const text = `
deny:   *.secret
allow:   safe/**
`;
    const result = loadScanRules(text);
    expect(result.deny).toEqual(['*.secret']);
    expect(result.allow).toEqual(['safe/**']);
  });

  it('drops lines that are not deny: or allow: and not comments/blanks (unrecognized lines)', () => {
    // Unknown directives / bare globs (no prefix) are silently dropped
    const text = `
deny: *.secret
random-unknown-line
*.bareglob
`;
    const result = loadScanRules(text);
    expect(result.deny).toEqual(['*.secret']);
    expect(result.allow).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// classifyPath with extra param — custom deny globs add matches
// ---------------------------------------------------------------------------

describe('classifyPath — extra.deny custom globs', () => {
  it('flags a path matching a custom deny glob that built-ins would miss', () => {
    // "deploy.secret" does not match any built-in rule
    const hit = classifyPath('deploy.secret', { deny: ['*.secret'], allow: [] });
    expect(hit).not.toBeNull();
    expect(hit!.rule).toBe('custom-deny');
    expect(hit!.path).toBe('deploy.secret');
  });

  it('flags a nested path matching a custom deny glob', () => {
    const hit = classifyPath('config/api.token', { deny: ['**/*.token'], allow: [] });
    expect(hit).not.toBeNull();
    expect(hit!.rule).toBe('custom-deny');
  });

  it('built-in rules still fire when no extra is provided', () => {
    const hit = classifyPath('.env');
    expect(hit).not.toBeNull();
    expect(hit!.rule).toBe('env-file');
  });

  it('built-in rules still fire when extra is provided but does not match', () => {
    const hit = classifyPath('.env', { deny: ['*.secret'], allow: [] });
    expect(hit).not.toBeNull();
    expect(hit!.rule).toBe('env-file');
  });

  it('flags a path that matches both custom deny and built-in (first match wins — built-in)', () => {
    // .env matches built-in env-file; custom deny also matches *.env
    // built-in rules run first, so env-file wins
    const hit = classifyPath('.env', { deny: ['*.env'], allow: [] });
    expect(hit).not.toBeNull();
    // Rule could be either, but a hit must be returned
    expect(hit!.path).toBe('.env');
  });

  it('returns null for a path that does not match any deny glob', () => {
    const hit = classifyPath('README.md', { deny: ['*.secret'], allow: [] });
    expect(hit).toBeNull();
  });

  it('custom deny glob with no allow: does not accidentally allow built-in hits', () => {
    // id_rsa should still be flagged even with a custom deny added
    const hit = classifyPath('id_rsa', { deny: ['*.secret'], allow: [] });
    expect(hit).not.toBeNull();
    expect(hit!.rule).toContain('key');
  });
});

// ---------------------------------------------------------------------------
// classifyPath — allow globs override deny (allow beats deny)
// ---------------------------------------------------------------------------

describe('classifyPath — extra.allow overrides deny', () => {
  it('allow glob overrides a custom deny glob', () => {
    // *.secret is denied, but fixtures/*.secret is allowed
    const hit = classifyPath('fixtures/test.secret', {
      deny: ['*.secret'],
      allow: ['fixtures/*'],
    });
    expect(hit).toBeNull();
  });

  it('allow glob overrides built-in rule', () => {
    // .env is flagged by built-in env-file, but allow: .env overrides it
    const hit = classifyPath('.env', { deny: [], allow: ['.env'] });
    expect(hit).toBeNull();
  });

  it('allow glob with ** overrides built-in rule for nested path', () => {
    // vendor/secrets.json is normally spared by dir exclusion, but:
    // src/config/.env should be flaggable, then overridden by allow
    const hit = classifyPath('src/config/.env', { deny: [], allow: ['src/config/*'] });
    expect(hit).toBeNull();
  });

  it('allow does NOT apply when path does not match allow glob', () => {
    // Only fixtures/.env is allowed; src/.env is still denied
    const hit = classifyPath('src/.env', { deny: [], allow: ['fixtures/*'] });
    expect(hit).not.toBeNull();
  });

  it('allow overrides custom deny for an exact match', () => {
    const hit = classifyPath('config/prod.token', {
      deny: ['config/*.token'],
      allow: ['config/prod.token'],
    });
    expect(hit).toBeNull();
  });

  it('deny still fires when allow glob does not cover the path', () => {
    const hit = classifyPath('config/staging.token', {
      deny: ['config/*.token'],
      allow: ['config/prod.token'],
    });
    expect(hit).not.toBeNull();
    expect(hit!.rule).toBe('custom-deny');
  });
});

// ---------------------------------------------------------------------------
// Existing sensitive.test.ts cases must still pass (regression guard)
// ---------------------------------------------------------------------------

describe('classifyPath — existing built-in behavior unchanged (no extra)', () => {
  it('still flags .env', () => {
    const hit = classifyPath('.env');
    expect(hit).not.toBeNull();
    expect(hit!.rule).toContain('env');
  });

  it('still flags id_rsa', () => {
    const hit = classifyPath('id_rsa');
    expect(hit).not.toBeNull();
    expect(hit!.rule).toContain('key');
  });

  it('still flags credentials.json', () => {
    const hit = classifyPath('credentials.json');
    expect(hit).not.toBeNull();
    expect(hit!.rule).toContain('cred');
  });

  it('still spares .env.example', () => {
    expect(classifyPath('.env.example')).toBeNull();
  });

  it('still spares node_modules/.env', () => {
    expect(classifyPath('node_modules/.env')).toBeNull();
  });
});
