/**
 * Theme helper for accessible output.
 *
 * colorEnabled(noColorEnv, plain) → boolean
 *   - Returns false if NO_COLOR is any non-empty string (per the NO_COLOR spec:
 *     https://no-color.org/ — "when set to any value other than the empty string").
 *   - Returns false if plain === true (--plain flag).
 *   - Returns true otherwise.
 *
 * themeColor(color, enabled) → color | undefined
 *   - Returns the color when enabled, otherwise undefined (Ink treats undefined
 *     as "no color", so no ANSI sequences are emitted).
 */

export function colorEnabled(noColorEnv: string | undefined, plain: boolean): boolean {
  if (plain) return false;
  if (noColorEnv !== undefined && noColorEnv !== '') return false;
  return true;
}

export function themeColor(
  color: string | undefined,
  enabled: boolean,
): string | undefined {
  if (!enabled) return undefined;
  return color;
}
