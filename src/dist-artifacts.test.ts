/**
 * dist-artifacts.test.ts — validate in-repo distribution artifacts
 * (bead vizzy-cli-9cm.16)
 *
 * Validates:
 *   - gh-extension/gh-vizzy is a valid POSIX shell script (bash -n)
 *   - action.yml is valid YAML with required composite-action fields
 *   - examples/exposure-audit.yml is valid YAML
 *   - README contains the required distribution sections
 *
 * js-yaml is a transitive dependency already present in node_modules;
 * it is used here only at test time (not a new runtime dep).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

function root(...parts: string[]): string {
  return resolve(ROOT, ...parts);
}

// ---------------------------------------------------------------------------
// gh-extension/gh-vizzy
// ---------------------------------------------------------------------------

describe('gh-extension/gh-vizzy shim', () => {
  it('file exists at gh-extension/gh-vizzy', () => {
    expect(existsSync(root('gh-extension', 'gh-vizzy'))).toBe(true);
  });

  it('passes bash -n (syntax check)', () => {
    const path = root('gh-extension', 'gh-vizzy');
    expect(() => {
      execSync(`bash -n ${JSON.stringify(path)}`, { stdio: 'pipe' });
    }).not.toThrow();
  });

  it('contains a shebang line', () => {
    const content = readFileSync(root('gh-extension', 'gh-vizzy'), 'utf8');
    expect(content.startsWith('#!/')).toBe(true);
  });

  it('invokes vizzy-cli (npx or node)', () => {
    const content = readFileSync(root('gh-extension', 'gh-vizzy'), 'utf8');
    expect(content).toMatch(/vizzy-cli|dist\/bin\.js/);
  });

  it('passes through all arguments ($@)', () => {
    const content = readFileSync(root('gh-extension', 'gh-vizzy'), 'utf8');
    expect(content).toContain('"$@"');
  });
});

// ---------------------------------------------------------------------------
// action.yml
// ---------------------------------------------------------------------------

describe('action.yml composite action', () => {
  it('file exists at repo root', () => {
    expect(existsSync(root('action.yml'))).toBe(true);
  });

  it('is valid YAML', () => {
    const text = readFileSync(root('action.yml'), 'utf8');
    expect(() => yamlLoad(text)).not.toThrow();
  });

  it('has a name field', () => {
    const text = readFileSync(root('action.yml'), 'utf8');
    const doc = yamlLoad(text) as Record<string, unknown>;
    expect(typeof doc.name).toBe('string');
    expect((doc.name as string).length).toBeGreaterThan(0);
  });

  it('runs: using: composite', () => {
    const text = readFileSync(root('action.yml'), 'utf8');
    const doc = yamlLoad(text) as Record<string, unknown>;
    const runs = doc.runs as Record<string, unknown>;
    expect(runs).toBeDefined();
    expect(runs.using).toBe('composite');
  });

  it('has inputs: github-token and format', () => {
    const text = readFileSync(root('action.yml'), 'utf8');
    const doc = yamlLoad(text) as Record<string, unknown>;
    const inputs = doc.inputs as Record<string, unknown>;
    expect(inputs).toBeDefined();
    expect(inputs['github-token']).toBeDefined();
    expect(inputs['format']).toBeDefined();
  });

  it('format input defaults to sarif', () => {
    const text = readFileSync(root('action.yml'), 'utf8');
    const doc = yamlLoad(text) as Record<string, unknown>;
    const inputs = doc.inputs as Record<string, unknown>;
    const formatInput = inputs['format'] as Record<string, unknown>;
    expect(formatInput.default).toBe('sarif');
  });

  it('steps include actions/setup-node', () => {
    const text = readFileSync(root('action.yml'), 'utf8');
    const doc = yamlLoad(text) as Record<string, unknown>;
    const runs = doc.runs as Record<string, unknown>;
    const steps = runs.steps as Array<Record<string, unknown>>;
    expect(Array.isArray(steps)).toBe(true);
    const hasSetupNode = steps.some((s) => String(s.uses ?? '').startsWith('actions/setup-node'));
    expect(hasSetupNode).toBe(true);
  });

  it('steps include npx vizzy-cli@latest --audit', () => {
    const text = readFileSync(root('action.yml'), 'utf8');
    expect(text).toMatch(/npx vizzy-cli@latest.*--audit/);
  });

  it('steps reference codeql-action/upload-sarif', () => {
    const text = readFileSync(root('action.yml'), 'utf8');
    expect(text).toMatch(/codeql-action\/upload-sarif/);
  });
});

// ---------------------------------------------------------------------------
// examples/exposure-audit.yml
// ---------------------------------------------------------------------------

describe('examples/exposure-audit.yml sample workflow', () => {
  it('file exists', () => {
    expect(existsSync(root('examples', 'exposure-audit.yml'))).toBe(true);
  });

  it('is valid YAML', () => {
    const text = readFileSync(root('examples', 'exposure-audit.yml'), 'utf8');
    expect(() => yamlLoad(text)).not.toThrow();
  });

  it('has on: schedule or on: pull_request trigger', () => {
    const text = readFileSync(root('examples', 'exposure-audit.yml'), 'utf8');
    const doc = yamlLoad(text) as Record<string, unknown>;
    const on = doc['on'] as Record<string, unknown> | undefined;
    expect(on).toBeDefined();
    const hasSchedule = 'schedule' in (on ?? {});
    const hasPR = 'pull_request' in (on ?? {});
    expect(hasSchedule || hasPR).toBe(true);
  });

  it('references the vizzy action (uses: ./)', () => {
    const text = readFileSync(root('examples', 'exposure-audit.yml'), 'utf8');
    expect(text).toMatch(/uses:\s*\.\//);
  });
});

// ---------------------------------------------------------------------------
// README distribution sections
// ---------------------------------------------------------------------------

describe('README distribution sections', () => {
  it('contains an "Install as a gh extension" section', () => {
    const text = readFileSync(root('README.md'), 'utf8');
    expect(text).toMatch(/install as a gh extension/i);
  });

  it('README gh extension section mentions gh-vizzy', () => {
    const text = readFileSync(root('README.md'), 'utf8');
    expect(text).toContain('gh-vizzy');
  });

  it('README contains a GitHub Action usage section', () => {
    const text = readFileSync(root('README.md'), 'utf8');
    expect(text).toMatch(/github action/i);
  });

  it('README GitHub Action section contains action.yml usage snippet', () => {
    const text = readFileSync(root('README.md'), 'utf8');
    expect(text).toMatch(/uses:\s*jakecastillo\/vizzy-cli/);
  });
});
