import { execSync } from 'node:child_process';

export const delay = (ms = 25): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * True if `cmd` resolves on PATH. Use it to skip tests that shell out to an
 * external tool (e.g. shellcheck) so the suite stays green where the tool isn't
 * installed, while still running the check wherever it IS present. Probes with
 * the platform's own resolver (`where` on Windows, `command -v` elsewhere) so it
 * never executes the target binary.
 */
export function commandExists(cmd: string): boolean {
  const probe =
    process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
  try {
    execSync(probe, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

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
// DEL (0x7F) — what most terminals send for the Backspace key; Ink maps it to
// key.backspace/key.delete, both of which the typed-confirm buffer handles.
const DEL = String.fromCharCode(127);

export const KEY = {
  up: `${ESC}[A`,
  down: `${ESC}[B`,
  left: `${ESC}[D`,
  right: `${ESC}[C`,
  enter: '\r',
  space: ' ',
  backspace: DEL,
};
