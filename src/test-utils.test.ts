import { describe, it, expect } from 'vitest';
import { commandExists } from './test-utils.js';

// commandExists is the portability guard used to skip tests that shell out to an
// external tool (e.g. shellcheck) when that tool isn't installed — so the suite
// stays green where the binary is absent, while still enforcing the check wherever
// it IS present.
describe('commandExists', () => {
  it('returns true for a binary that is always present (node)', () => {
    expect(commandExists('node')).toBe(true);
  });

  it('returns false for a binary that does not exist', () => {
    expect(commandExists('vizzy-definitely-not-a-real-binary-xyz123')).toBe(false);
  });

  it('does not throw for a name containing no shell metacharacters', () => {
    expect(() => commandExists('git')).not.toThrow();
  });
});
