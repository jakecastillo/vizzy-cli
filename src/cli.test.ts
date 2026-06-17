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
});
