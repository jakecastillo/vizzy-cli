export const delay = (ms = 25): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll `predicate` until it returns true, or throw on timeout. Use this instead
 * of a fixed delay for async Ink assertions so tests stay deterministic on slow
 * CI runners. A throwing predicate counts as "not yet".
 */
export async function waitFor(
  predicate: () => boolean,
  { timeout = 3000, interval = 10 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const start = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = predicate();
    } catch {
      ok = false;
    }
    if (ok) return;
    if (Date.now() - start > timeout) {
      throw new Error(`waitFor: condition not met within ${timeout}ms`);
    }
    await delay(interval);
  }
}

// Arrow keys MUST include the leading ESC byte (0x1B) or Ink's input parser
// ignores them. Enter is '\r' (carriage return), NOT '\n'.
const ESC = String.fromCharCode(27);

export const KEY = {
  up: `${ESC}[A`,
  down: `${ESC}[B`,
  left: `${ESC}[D`,
  right: `${ESC}[C`,
  enter: '\r',
  space: ' ',
};
