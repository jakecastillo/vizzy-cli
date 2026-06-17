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
});
