// Minimal ambient declaration for js-yaml (transitive dep, no @types package).
// Used only in tests (dist-artifacts.test.ts); not a runtime module.
declare module 'js-yaml' {
  export function load(input: string, options?: unknown): unknown;
  export function dump(obj: unknown, options?: unknown): string;
}
