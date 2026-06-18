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
 *
 * ColorContext — React context carrying the global color-enabled boolean.
 * useColor()   — Hook that returns a helper: (color) => enabled ? color : undefined.
 *               Components that accept an optional color prop can call useColor()
 *               once and then pass the result of color(someColor) to Ink's <Text>.
 */

import { createContext, useContext } from 'react';

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

/**
 * React context holding the global color-enabled flag.
 * Default value is true so components render with color when used outside a Provider
 * (e.g. in snapshot tests that do not wrap with App).
 */
export const ColorContext = createContext<boolean>(true);

/**
 * Hook that returns a convenience helper bound to the current color-enabled setting.
 *
 * Usage:
 *   const color = useColor();
 *   <Text color={color('green')}>…</Text>
 *
 * When color is disabled (NO_COLOR or --plain), the helper returns undefined so Ink
 * emits no ANSI sequences for that prop.
 */
export function useColor(): (color: string | undefined) => string | undefined {
  const enabled = useContext(ColorContext);
  return (c) => (enabled ? c : undefined);
}
