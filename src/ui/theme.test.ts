import { describe, it, expect } from 'vitest';
import { colorEnabled, themeColor } from './theme.js';

describe('colorEnabled', () => {
  it('returns true when NO_COLOR is undefined and plain is false', () => {
    expect(colorEnabled(undefined, false)).toBe(true);
  });

  it('returns true when NO_COLOR is empty string and plain is false', () => {
    // Spec: "any non-empty value disables" — empty string does NOT disable.
    expect(colorEnabled('', false)).toBe(true);
  });

  it('returns false when NO_COLOR is any non-empty value', () => {
    expect(colorEnabled('1', false)).toBe(false);
    expect(colorEnabled('true', false)).toBe(false);
    expect(colorEnabled('anything', false)).toBe(false);
  });

  it('returns false when plain is true (regardless of NO_COLOR)', () => {
    expect(colorEnabled(undefined, true)).toBe(false);
    expect(colorEnabled('', true)).toBe(false);
    expect(colorEnabled('1', true)).toBe(false);
  });
});

describe('themeColor', () => {
  it('returns the color when enabled', () => {
    expect(themeColor('red', true)).toBe('red');
    expect(themeColor('yellow', true)).toBe('yellow');
    expect(themeColor('green', true)).toBe('green');
  });

  it('returns undefined when disabled (NO_COLOR or plain)', () => {
    expect(themeColor('red', false)).toBeUndefined();
    expect(themeColor('yellow', false)).toBeUndefined();
    expect(themeColor('green', false)).toBeUndefined();
  });

  it('returns undefined when color is already undefined', () => {
    expect(themeColor(undefined, true)).toBeUndefined();
    expect(themeColor(undefined, false)).toBeUndefined();
  });
});
