import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs vitest against TypeScript ESM', () => {
    expect(1 + 1).toBe(2);
  });
});
