import { describe, it, expect } from 'vitest';
import { parseArgs } from './cli.js';

describe('parseArgs', () => {
  it('defaults forks to true and other flags undefined', () => {
    const f = parseArgs([]);
    expect(f.forks).toBe(true);
    expect(f.dryRun).toBeUndefined();
    expect(f.public).toBeUndefined();
  });

  it('parses boolean flags and camelCases them', () => {
    const f = parseArgs(['--dry-run', '--private', '--include-archived']);
    expect(f.dryRun).toBe(true);
    expect(f.private).toBe(true);
    expect(f.includeArchived).toBe(true);
  });

  it('sets forks=false when --no-forks is passed', () => {
    expect(parseArgs(['--no-forks']).forks).toBe(false);
  });

  it('rejects --public together with --private', () => {
    expect(() => parseArgs(['--public', '--private'], { exitOverride: true })).toThrow();
  });

  // --- new flags (bead vizzy-cli-6qi.6) ---

  it('parses --force-public as forcePublic=true', () => {
    const f = parseArgs(['--force-public']);
    expect(f.forcePublic).toBe(true);
  });

  it('forcePublic defaults to undefined when not passed', () => {
    const f = parseArgs([]);
    expect(f.forcePublic).toBeUndefined();
  });

  it('protect defaults to true (--no-protect not passed)', () => {
    const f = parseArgs([]);
    expect(f.protect).toBe(true);
  });

  it('sets protect=false when --no-protect is passed', () => {
    const f = parseArgs(['--no-protect']);
    expect(f.protect).toBe(false);
  });

  it('parses --audit as audit=true', () => {
    const f = parseArgs(['--audit']);
    expect(f.audit).toBe(true);
  });

  it('audit defaults to undefined when not passed', () => {
    const f = parseArgs([]);
    expect(f.audit).toBeUndefined();
  });

  it('rejects --audit together with --dry-run', () => {
    expect(() =>
      parseArgs(['--audit', '--dry-run'], { exitOverride: true }),
    ).toThrow();
  });

  // --- new flags (bead vizzy-cli-9cm.2) ---

  it('parses --format json as format: json', () => {
    const f = parseArgs(['--format', 'json']);
    expect(f.format).toBe('json');
  });

  it('parses --format sarif as format: sarif', () => {
    const f = parseArgs(['--format', 'sarif']);
    expect(f.format).toBe('sarif');
  });

  it('parses --format text as format: text', () => {
    const f = parseArgs(['--format', 'text']);
    expect(f.format).toBe('text');
  });

  it('--json is an alias for --format json', () => {
    const f = parseArgs(['--json']);
    expect(f.format).toBe('json');
  });

  it('format defaults to undefined when not passed', () => {
    const f = parseArgs([]);
    expect(f.format).toBeUndefined();
  });

  // --- new flags (bead vizzy-cli-9cm.4) ---

  it('parses --repos csv into string[]', () => {
    const f = parseArgs(['--repos', 'alpha,beta,gamma']);
    expect(f.repos).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('repos defaults to undefined when not passed', () => {
    const f = parseArgs([]);
    expect(f.repos).toBeUndefined();
  });

  it('parses --all-eligible as allEligible=true', () => {
    const f = parseArgs(['--all-eligible']);
    expect(f.allEligible).toBe(true);
  });

  it('allEligible defaults to undefined when not passed', () => {
    const f = parseArgs([]);
    expect(f.allEligible).toBeUndefined();
  });

  it('parses --yes as yes=true', () => {
    const f = parseArgs(['--yes']);
    expect(f.yes).toBe(true);
  });

  it('yes defaults to undefined when not passed', () => {
    const f = parseArgs([]);
    expect(f.yes).toBeUndefined();
  });

  it('parses --allow-danger as allowDanger=true', () => {
    const f = parseArgs(['--allow-danger']);
    expect(f.allowDanger).toBe(true);
  });

  it('allowDanger defaults to undefined when not passed', () => {
    const f = parseArgs([]);
    expect(f.allowDanger).toBeUndefined();
  });
});
