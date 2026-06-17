# vizzy — Repo Visibility CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `vizzy`, an npm CLI (package `vizzy-cli`) that lists a user's personal GitHub repositories and bulk-changes their visibility (public ↔ private) through an interactive Ink TUI.

**Architecture:** Pure decision logic (`core/`, `auth`, `github`, `apply`, `cli`) is fully separated from the Ink UI and is dependency-injected, so the heart of the tool is unit-tested with no network and no module mocking. The UI is a small Ink state machine that receives `loadRepos()` and a `setter` as props. The flow is: pick target visibility → fetch owner repos → filter to repos not already in that state → multi-select → confirm (loud for public) → apply with concurrency 5 → summary.

**Tech Stack:** TypeScript (ESM), Ink 5 + React 18, `@octokit/rest` 22, `commander` 14, `p-limit` 7, `tsup` 8, `vitest` 4, `ink-testing-library` 4.

## Global Constraints

Every task's requirements implicitly include this section. Values are exact.

- **Runtime:** Node `>=20`. `package.json` has `"type": "module"` (pure ESM).
- **Dependencies (exact ranges):** `@octokit/rest@^22.0.1`, `@octokit/request-error@^7.0.0`, `commander@^14.0.3`, `ink@^5.2.1`, `ink-spinner@^5.0.0`, `p-limit@^7.3.0`, `react@^18.3.1`.
- **Dev dependencies:** `@types/node@^20`, `@types/react@^18.3`, `eslint@^9`, `typescript-eslint@^8`, `ink-testing-library@^4.0.0`, `tsup@^8.5.1`, `typescript@^5.7`, `vitest@^4.1.9`.
- **ESM import rule:** with `moduleResolution: NodeNext`, all **relative** imports in source use a `.js` extension even though the file is `.ts`/`.tsx` (e.g. `import { App } from './ui/App.js'`). Bare package imports do not.
- **JSX:** `tsconfig` `jsx: "react-jsx"` (automatic runtime) — do NOT `import React` just for JSX; only import the hooks you use (`import { useState } from 'react'`).
- **TDD:** every task writes the failing test first, watches it fail, writes minimal code, watches it pass. Run a single test file with `npx vitest run <path>`.
- **Ink test gotcha (mandatory):** in every ink-testing-library test, `await delay()` once **after** `render()` and **before** the first `stdin.write()`, and `await delay()` between writes and before reading `lastFrame()`. Use real timers (never `vi.useFakeTimers()` around stdin). Helpers live in `src/test-utils.ts`.
- **Key sequences:** ArrowUp `'[A'`, ArrowDown `'[B'`, Enter `'\r'` (NOT `'\n'`), Space `' '`. Branch navigation/submit on `key.*` booleans; branch toggle on `input === ' '`.
- **Visibility type:** the domain models exactly two states, `'public' | 'private'`. GitHub's `'internal'` is out of scope; derive visibility from the API `private` boolean, never the `visibility` string.
- **Commits:** conventional-commit message after each task. Commit only the files that task created/changed.

---

## File structure

```
vizzy-cli/
  package.json
  tsconfig.json
  tsup.config.ts
  vitest.config.ts
  eslint.config.js
  .gitignore
  README.md
  LICENSE
  .github/workflows/ci.yml
  src/
    test-utils.ts        # delay() + KEY constants for ink tests
    types.ts             # Visibility, Target, Repo, ApplyResult, VisibilitySetter, RowStatus
    auth.ts              # getToken() (gh -> env), TokenError
    github.ts            # makeOctokit, normalizeRepo, listOwnerRepos, setVisibility, explainError, makeSetter
    apply.ts             # applyChanges() with p-limit + onProgress
    cli.ts               # parseArgs() (commander), CliFlags
    core/
      filter.ts          # eligibleRepos(), FilterOptions
      plan.ts            # buildPlan(), formatSummary(), ChangePlan
    ui/
      TargetSelect.tsx   # choose Private | Public
      RepoList.tsx       # scrollable spacebar multi-select w/ columns
      Confirm.tsx        # summary + y/N (loud for public)
      ApplyProgress.tsx  # per-row spinner / ✔ / ✖
      App.tsx            # state machine, DI of loadRepos + setter
    bin.tsx              # shebang entry: parseArgs -> TTY guard -> getToken -> render <App/>
```

Tests live next to their module as `*.test.ts` / `*.test.tsx`.

---

## Task 1: Project scaffold + toolchain smoke

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.gitignore`
- Create: `src/bin.tsx` (placeholder, replaced in Task 13)
- Test: `src/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test` and `npm run build` (emits an executable `dist/bin.js`).

- [ ] **Step 1: Write `.gitignore`**

```
node_modules
dist
*.log
.DS_Store
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "vizzy-cli",
  "version": "0.1.0",
  "description": "Bulk-toggle the visibility of your personal GitHub repos via an interactive TUI",
  "type": "module",
  "bin": { "vizzy": "dist/bin.js" },
  "files": ["dist"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "start": "node dist/bin.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "prepublishOnly": "npm run build"
  },
  "keywords": ["github", "cli", "tui", "repository", "visibility", "ink"],
  "license": "MIT",
  "dependencies": {
    "@octokit/request-error": "^7.0.0",
    "@octokit/rest": "^22.0.1",
    "commander": "^14.0.3",
    "ink": "^5.2.1",
    "ink-spinner": "^5.0.0",
    "p-limit": "^7.3.0",
    "react": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.3.0",
    "eslint": "^9.0.0",
    "ink-testing-library": "^4.0.0",
    "tsup": "^8.5.1",
    "typescript": "^5.7.0",
    "typescript-eslint": "^8.0.0",
    "vitest": "^4.1.9"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2023"],
    "types": ["node"],
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": true,
    "isolatedModules": true
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 4: Write `tsup.config.ts`** (shebang in source is preserved and made executable by tsup; no chmod/banner needed)

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { bin: 'src/bin.tsx' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
});
```

- [ ] **Step 5: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
  esbuild: { jsx: 'automatic' },
});
```

- [ ] **Step 6: Write `eslint.config.js`** (flat config, minimal)

```javascript
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
```

> `@eslint/js` ships with `eslint`; `typescript-eslint` is the dev dep above. If `eslint .` errors on config resolution, that is a lint-only concern — it does NOT block tests or build.

- [ ] **Step 7: Write placeholder `src/bin.tsx`** (replaced in Task 13; exists now so `tsup` has an entry and we validate the shebang/executable path early)

```tsx
#!/usr/bin/env node
// Placeholder entry — replaced with the real wiring in Task 13.
console.log('vizzy: not yet implemented');
```

- [ ] **Step 8: Write the smoke test `src/smoke.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs vitest against TypeScript ESM', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 9: Install dependencies**

Run: `npm install`
Expected: completes; `node_modules` present; no `EBADENGINE` errors (you are on Node ≥20).

- [ ] **Step 10: Run the test to confirm the runner works**

Run: `npx vitest run src/smoke.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 11: Build and confirm the bin is executable**

Run: `npm run build && test -x dist/bin.js && node dist/bin.js`
Expected: build succeeds; `test -x` exits 0 (file is executable); prints `vizzy: not yet implemented`.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: scaffold vizzy-cli toolchain (tsup, vitest, eslint, tsconfig)"
```

---

## Task 2: Domain types + `eligibleRepos`

**Files:**
- Create: `src/types.ts`, `src/core/filter.ts`
- Test: `src/core/filter.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `types.ts`: `type Visibility = 'public' | 'private'`; `type Target = Visibility`; `interface Repo { name: string; owner: string; visibility: Visibility; isFork: boolean; isArchived: boolean; stars: number; pushedAt: string }`; `interface ApplyResult { name: string; ok: boolean; error?: string }`; `type VisibilitySetter = (owner: string, repo: string, visibility: Visibility) => Promise<void>`; `type RowStatus = 'pending' | 'applying' | 'done' | 'error'`.
  - `filter.ts`: `interface FilterOptions { includeForks: boolean; includeArchived: boolean }`; `function eligibleRepos(repos: Repo[], target: Target, opts: FilterOptions): Repo[]`.

- [ ] **Step 1: Write the failing test `src/core/filter.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { eligibleRepos } from './filter.js';
import type { Repo } from '../types.js';

const repo = (over: Partial<Repo>): Repo => ({
  name: 'r',
  owner: 'me',
  visibility: 'public',
  isFork: false,
  isArchived: false,
  stars: 0,
  pushedAt: '2020-01-01T00:00:00Z',
  ...over,
});

const opts = { includeForks: true, includeArchived: false };

describe('eligibleRepos', () => {
  it('keeps only repos not already in the target state', () => {
    const repos = [
      repo({ name: 'pub', visibility: 'public' }),
      repo({ name: 'priv', visibility: 'private' }),
    ];
    expect(eligibleRepos(repos, 'private', opts).map((r) => r.name)).toEqual(['pub']);
    expect(eligibleRepos(repos, 'public', opts).map((r) => r.name)).toEqual(['priv']);
  });

  it('includes forks by default and excludes them when includeForks is false', () => {
    const repos = [repo({ name: 'fork', isFork: true }), repo({ name: 'own' })];
    expect(eligibleRepos(repos, 'private', opts).map((r) => r.name)).toEqual([
      'fork',
      'own',
    ]);
    expect(
      eligibleRepos(repos, 'private', { ...opts, includeForks: false }).map((r) => r.name),
    ).toEqual(['own']);
  });

  it('excludes archived repos by default and includes them when asked', () => {
    const repos = [repo({ name: 'arch', isArchived: true }), repo({ name: 'live' })];
    expect(eligibleRepos(repos, 'private', opts).map((r) => r.name)).toEqual(['live']);
    expect(
      eligibleRepos(repos, 'private', { ...opts, includeArchived: true }).map((r) => r.name),
    ).toEqual(['arch', 'live']);
  });

  it('sorts by pushedAt descending (most recent first)', () => {
    const repos = [
      repo({ name: 'old', pushedAt: '2020-01-01T00:00:00Z' }),
      repo({ name: 'new', pushedAt: '2024-01-01T00:00:00Z' }),
      repo({ name: 'mid', pushedAt: '2022-01-01T00:00:00Z' }),
    ];
    expect(eligibleRepos(repos, 'private', opts).map((r) => r.name)).toEqual([
      'new',
      'mid',
      'old',
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/filter.test.ts`
Expected: FAIL — cannot find `./filter.js` / `../types.js`.

- [ ] **Step 3: Write `src/types.ts`**

```typescript
export type Visibility = 'public' | 'private';
export type Target = Visibility;

export interface Repo {
  name: string;
  owner: string;
  visibility: Visibility;
  isFork: boolean;
  isArchived: boolean;
  stars: number;
  pushedAt: string; // ISO 8601
}

export interface ApplyResult {
  name: string;
  ok: boolean;
  error?: string;
}

export type VisibilitySetter = (
  owner: string,
  repo: string,
  visibility: Visibility,
) => Promise<void>;

export type RowStatus = 'pending' | 'applying' | 'done' | 'error';
```

- [ ] **Step 4: Write `src/core/filter.ts`**

```typescript
import type { Repo, Target } from '../types.js';

export interface FilterOptions {
  includeForks: boolean;
  includeArchived: boolean;
}

/**
 * Return the repos eligible to change to `target`: those whose current
 * visibility differs from `target`, honoring fork/archived options,
 * sorted by pushedAt descending (most recently pushed first).
 */
export function eligibleRepos(
  repos: Repo[],
  target: Target,
  opts: FilterOptions,
): Repo[] {
  return repos
    .filter((r) => r.visibility !== target)
    .filter((r) => opts.includeForks || !r.isFork)
    .filter((r) => opts.includeArchived || !r.isArchived)
    .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/core/filter.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/core/filter.ts src/core/filter.test.ts
git commit -m "feat: add domain types and eligibleRepos filtering"
```

---

## Task 3: Change plan + summary formatting

**Files:**
- Create: `src/core/plan.ts`
- Test: `src/core/plan.test.ts`

**Interfaces:**
- Consumes: `Repo`, `Target` from `../types.js`.
- Produces: `interface ChangePlan { target: Target; repos: Repo[] }`; `function buildPlan(target: Target, repos: Repo[]): ChangePlan`; `function formatSummary(plan: ChangePlan): string`.

- [ ] **Step 1: Write the failing test `src/core/plan.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { buildPlan, formatSummary } from './plan.js';
import type { Repo } from '../types.js';

const repo = (name: string, visibility: Repo['visibility']): Repo => ({
  name,
  owner: 'me',
  visibility,
  isFork: false,
  isArchived: false,
  stars: 0,
  pushedAt: '2024-01-01T00:00:00Z',
});

describe('buildPlan', () => {
  it('captures the target and selected repos', () => {
    const plan = buildPlan('private', [repo('a', 'public')]);
    expect(plan.target).toBe('private');
    expect(plan.repos.map((r) => r.name)).toEqual(['a']);
  });
});

describe('formatSummary', () => {
  it('lists repos and the PRIVATE target', () => {
    const text = formatSummary(buildPlan('private', [repo('a', 'public'), repo('b', 'public')]));
    expect(text).toContain('2 repos PRIVATE');
    expect(text).toContain('a');
    expect(text).toContain('b');
  });

  it('warns loudly when the target is PUBLIC', () => {
    const text = formatSummary(buildPlan('public', [repo('secret', 'private')]));
    expect(text).toContain('PUBLIC');
    expect(text.toLowerCase()).toContain('expos'); // "expose"/"exposed"
    expect(text).toContain('secret');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/plan.test.ts`
Expected: FAIL — cannot find `./plan.js`.

- [ ] **Step 3: Write `src/core/plan.ts`**

```typescript
import type { Repo, Target } from '../types.js';

export interface ChangePlan {
  target: Target;
  repos: Repo[];
}

export function buildPlan(target: Target, repos: Repo[]): ChangePlan {
  return { target, repos };
}

export function formatSummary(plan: ChangePlan): string {
  const count = plan.repos.length;
  const noun = count === 1 ? 'repo' : 'repos';
  const list = plan.repos.map((r) => `  - ${r.name}`).join('\n');
  const headline = `Making ${count} ${noun} ${plan.target.toUpperCase()}:`;
  if (plan.target === 'public') {
    return `⚠ ${headline}\n  This will EXPOSE their code publicly.\n${list}`;
  }
  return `${headline}\n${list}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/plan.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/plan.ts src/core/plan.test.ts
git commit -m "feat: add change plan and summary formatting"
```

---

## Task 4: Token resolution (`getToken`)

**Files:**
- Create: `src/auth.ts`
- Test: `src/auth.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `class TokenError extends Error`; `interface TokenDeps { runGh?: () => Promise<string>; env?: NodeJS.ProcessEnv }`; `function getToken(deps?: TokenDeps): Promise<string>`.
- Resolution order: `gh auth token` → `GH_TOKEN` → `GITHUB_TOKEN` → throw `TokenError`. (`gh` itself already honors env precedence; the Node-side env fallback exists mainly for when `gh` is absent.)

- [ ] **Step 1: Write the failing test `src/auth.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { getToken, TokenError } from './auth.js';

describe('getToken', () => {
  it('returns the trimmed gh token when gh succeeds', async () => {
    const token = await getToken({
      runGh: async () => 'ghtoken123\n',
      env: {},
    });
    expect(token).toBe('ghtoken123');
  });

  it('falls back to GH_TOKEN when gh fails', async () => {
    const token = await getToken({
      runGh: async () => {
        throw new Error('gh not installed');
      },
      env: { GH_TOKEN: 'envtok' },
    });
    expect(token).toBe('envtok');
  });

  it('falls back to GITHUB_TOKEN when gh fails and GH_TOKEN is absent', async () => {
    const token = await getToken({
      runGh: async () => {
        throw new Error('logged out');
      },
      env: { GITHUB_TOKEN: 'ghub' },
    });
    expect(token).toBe('ghub');
  });

  it('prefers GH_TOKEN over GITHUB_TOKEN', async () => {
    const token = await getToken({
      runGh: async () => {
        throw new Error('x');
      },
      env: { GH_TOKEN: 'a', GITHUB_TOKEN: 'b' },
    });
    expect(token).toBe('a');
  });

  it('throws TokenError when nothing is available', async () => {
    await expect(
      getToken({
        runGh: async () => {
          throw new Error('x');
        },
        env: {},
      }),
    ).rejects.toBeInstanceOf(TokenError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/auth.test.ts`
Expected: FAIL — cannot find `./auth.js`.

- [ ] **Step 3: Write `src/auth.ts`**

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenError';
  }
}

export interface TokenDeps {
  /** Returns the raw stdout of `gh auth token`, or throws if unavailable. */
  runGh?: () => Promise<string>;
  env?: NodeJS.ProcessEnv;
}

async function defaultRunGh(): Promise<string> {
  const { stdout } = await execFileAsync('gh', ['auth', 'token'], {
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

/**
 * Resolve a GitHub token. Order: `gh auth token` -> GH_TOKEN -> GITHUB_TOKEN
 * -> throw. A single gh call already covers gh-stored creds AND env tokens;
 * the explicit env fallback matters mainly when the gh binary is missing.
 */
export async function getToken(deps: TokenDeps = {}): Promise<string> {
  const runGh = deps.runGh ?? defaultRunGh;
  const env = deps.env ?? process.env;

  try {
    const token = (await runGh()).trim();
    if (token) return token;
  } catch {
    // gh missing or logged out — fall through to env vars.
  }

  const envToken = env.GH_TOKEN?.trim() || env.GITHUB_TOKEN?.trim();
  if (envToken) return envToken;

  throw new TokenError(
    'No GitHub token found.\n' +
      'Run `gh auth login` (recommended), or set GITHUB_TOKEN / GH_TOKEN.\n' +
      'The token needs the classic `repo` scope, or a fine-grained PAT with\n' +
      'repository Administration: Read and write to change repo visibility.',
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/auth.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts src/auth.test.ts
git commit -m "feat: resolve GitHub token via gh CLI with env fallback"
```

---

## Task 5: GitHub client (`github.ts`)

**Files:**
- Create: `src/github.ts`
- Test: `src/github.test.ts`

**Interfaces:**
- Consumes: `Repo`, `Visibility`, `VisibilitySetter` from `./types.js`.
- Produces:
  - `function makeOctokit(token: string): Octokit`
  - `interface RawRepo { name: string; owner: { login: string }; private: boolean; fork: boolean; archived: boolean; stargazers_count: number; pushed_at: string | null }`
  - `function normalizeRepo(raw: RawRepo): Repo`
  - `function listOwnerRepos(octokit: Pick<Octokit, 'paginate' | 'rest'>): Promise<Repo[]>`
  - `function setVisibility(octokit: Octokit, owner: string, repo: string, visibility: Visibility): Promise<void>`
  - `function explainError(err: unknown): string`
  - `function makeSetter(octokit: Octokit): VisibilitySetter`

- [ ] **Step 1: Write the failing test `src/github.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { RequestError } from '@octokit/request-error';
import {
  normalizeRepo,
  listOwnerRepos,
  setVisibility,
  explainError,
  makeSetter,
  type RawRepo,
} from './github.js';

const raw = (over: Partial<RawRepo> = {}): RawRepo => ({
  name: 'r',
  owner: { login: 'me' },
  private: false,
  fork: false,
  archived: false,
  stargazers_count: 3,
  pushed_at: '2024-01-01T00:00:00Z',
  ...over,
});

const reqError = (status: number, headers: Record<string, string> = {}) =>
  new RequestError('boom', status, {
    request: { method: 'PATCH', url: 'x', headers: {} },
    response: { status, url: 'x', headers, data: {} },
  } as never);

describe('normalizeRepo', () => {
  it('derives visibility from the private boolean', () => {
    expect(normalizeRepo(raw({ private: true })).visibility).toBe('private');
    expect(normalizeRepo(raw({ private: false })).visibility).toBe('public');
  });

  it('maps fields and tolerates a null pushed_at', () => {
    const r = normalizeRepo(raw({ name: 'x', fork: true, pushed_at: null, stargazers_count: 9 }));
    expect(r).toMatchObject({ name: 'x', owner: 'me', isFork: true, stars: 9 });
    expect(typeof r.pushedAt).toBe('string');
  });
});

describe('listOwnerRepos', () => {
  it('paginates owner repos and normalizes them', async () => {
    const paginate = vi.fn().mockResolvedValue([raw({ name: 'a' }), raw({ name: 'b', private: true })]);
    const octokit = { paginate, rest: { repos: { listForAuthenticatedUser: {} } } };
    const repos = await listOwnerRepos(octokit as never);
    expect(repos.map((r) => r.name)).toEqual(['a', 'b']);
    expect(paginate).toHaveBeenCalledWith(
      octokit.rest.repos.listForAuthenticatedUser,
      { affiliation: 'owner', visibility: 'all', per_page: 100 },
    );
  });
});

describe('setVisibility', () => {
  it('calls repos.update with the visibility string', async () => {
    const update = vi.fn().mockResolvedValue({ data: {} });
    const octokit = { rest: { repos: { update } } };
    await setVisibility(octokit as never, 'me', 'r', 'private');
    expect(update).toHaveBeenCalledWith({ owner: 'me', repo: 'r', visibility: 'private' });
  });
});

describe('explainError', () => {
  it('explains a missing-scope 403', () => {
    expect(explainError(reqError(403))).toContain('scope');
  });
  it('explains a rate limit (remaining 0)', () => {
    expect(explainError(reqError(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' })))
      .toContain('Rate limited');
  });
  it('explains a 422 org policy', () => {
    expect(explainError(reqError(422))).toContain('422');
  });
  it('passes through plain errors', () => {
    expect(explainError(new Error('nope'))).toBe('nope');
  });
});

describe('makeSetter', () => {
  it('wraps update errors with a friendly message', async () => {
    const update = vi.fn().mockRejectedValue(reqError(403));
    const setter = makeSetter({ rest: { repos: { update } } } as never);
    await expect(setter('me', 'r', 'public')).rejects.toThrow(/scope/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/github.test.ts`
Expected: FAIL — cannot find `./github.js`.

- [ ] **Step 3: Write `src/github.ts`**

```typescript
import { Octokit } from '@octokit/rest';
import { RequestError } from '@octokit/request-error';
import type { Repo, Visibility, VisibilitySetter } from './types.js';

export function makeOctokit(token: string): Octokit {
  return new Octokit({ auth: token, userAgent: 'vizzy-cli' });
}

/** The subset of GET /user/repos fields vizzy reads. */
export interface RawRepo {
  name: string;
  owner: { login: string };
  private: boolean;
  fork: boolean;
  archived: boolean;
  stargazers_count: number;
  pushed_at: string | null;
}

export function normalizeRepo(raw: RawRepo): Repo {
  return {
    name: raw.name,
    owner: raw.owner.login,
    visibility: raw.private ? 'private' : 'public',
    isFork: raw.fork,
    isArchived: raw.archived,
    stars: raw.stargazers_count,
    pushedAt: raw.pushed_at ?? '1970-01-01T00:00:00Z',
  };
}

export async function listOwnerRepos(
  octokit: Pick<Octokit, 'paginate' | 'rest'>,
): Promise<Repo[]> {
  // affiliation:'owner' restricts to repos owned by the authed user.
  // Do NOT also pass `type` — GitHub 422s if type is sent with affiliation.
  const raw = (await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
    affiliation: 'owner',
    visibility: 'all',
    per_page: 100,
  })) as RawRepo[];
  return raw.map(normalizeRepo);
}

export async function setVisibility(
  octokit: Octokit,
  owner: string,
  repo: string,
  visibility: Visibility,
): Promise<void> {
  // Prefer the `visibility` string over the legacy `private` boolean.
  await octokit.rest.repos.update({ owner, repo, visibility });
}

export function explainError(err: unknown): string {
  if (err instanceof RequestError) {
    const remaining = err.response?.headers['x-ratelimit-remaining'];
    const reset = err.response?.headers['x-ratelimit-reset'];
    if ((err.status === 403 || err.status === 429) && remaining === '0') {
      const resetMs = Number(reset) * 1000; // header is epoch SECONDS
      const when = Number.isFinite(resetMs)
        ? new Date(resetMs).toLocaleTimeString()
        : 'soon';
      return `Rate limited. Try again after ${when}.`;
    }
    if (err.status === 403 || err.status === 404) {
      return 'Permission denied. Your token likely lacks the `repo` scope (classic PAT) or Administration:write (fine-grained PAT).';
    }
    if (err.status === 422) {
      return `GitHub rejected the request (422): ${err.message}`;
    }
    return `GitHub error ${err.status}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export function makeSetter(octokit: Octokit): VisibilitySetter {
  return async (owner, repo, visibility) => {
    try {
      await setVisibility(octokit, owner, repo, visibility);
    } catch (err) {
      throw new Error(explainError(err));
    }
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/github.test.ts`
Expected: PASS, all cases. (If the `RequestError` constructor signature differs at runtime, the error-shape tests still hold because `explainError` only reads `.status` and `.response.headers`.)

- [ ] **Step 5: Commit**

```bash
git add src/github.ts src/github.test.ts
git commit -m "feat: add GitHub client (list, set visibility, error explain)"
```

---

## Task 6: Apply step (`applyChanges`)

**Files:**
- Create: `src/apply.ts`
- Test: `src/apply.test.ts`

**Interfaces:**
- Consumes: `Repo`, `Visibility`, `ApplyResult`, `VisibilitySetter`, `RowStatus` from `./types.js`.
- Produces: `interface ApplyOptions { concurrency?: number; onProgress?: (name: string, status: RowStatus, error?: string) => void }`; `function applyChanges(repos: Repo[], target: Visibility, setter: VisibilitySetter, opts?: ApplyOptions): Promise<ApplyResult[]>`.

- [ ] **Step 1: Write the failing test `src/apply.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { applyChanges } from './apply.js';
import type { Repo, RowStatus } from './types.js';

const repo = (name: string): Repo => ({
  name,
  owner: 'me',
  visibility: 'public',
  isFork: false,
  isArchived: false,
  stars: 0,
  pushedAt: '2024-01-01T00:00:00Z',
});

describe('applyChanges', () => {
  it('applies every repo and reports success', async () => {
    const setter = vi.fn().mockResolvedValue(undefined);
    const results = await applyChanges([repo('a'), repo('b')], 'private', setter);
    expect(results).toEqual([
      { name: 'a', ok: true },
      { name: 'b', ok: true },
    ]);
    expect(setter).toHaveBeenCalledWith('me', 'a', 'private');
  });

  it('captures per-repo failures without aborting the batch', async () => {
    const setter = vi.fn().mockImplementation(async (_o: string, name: string) => {
      if (name === 'b') throw new Error('denied');
    });
    const results = await applyChanges([repo('a'), repo('b'), repo('c')], 'private', setter);
    expect(results.find((r) => r.name === 'b')).toEqual({ name: 'b', ok: false, error: 'denied' });
    expect(results.filter((r) => r.ok)).toHaveLength(2);
  });

  it('emits progress transitions', async () => {
    const events: Array<[string, RowStatus]> = [];
    const setter = vi.fn().mockResolvedValue(undefined);
    await applyChanges([repo('a')], 'private', setter, {
      onProgress: (name, status) => events.push([name, status]),
    });
    expect(events).toContainEqual(['a', 'applying']);
    expect(events).toContainEqual(['a', 'done']);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const setter = vi.fn().mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    await applyChanges(
      Array.from({ length: 12 }, (_, i) => repo(`r${i}`)),
      'private',
      setter,
      { concurrency: 5 },
    );
    expect(peak).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/apply.test.ts`
Expected: FAIL — cannot find `./apply.js`.

- [ ] **Step 3: Write `src/apply.ts`**

```typescript
import pLimit from 'p-limit';
import type { Repo, Visibility, ApplyResult, VisibilitySetter, RowStatus } from './types.js';

export interface ApplyOptions {
  concurrency?: number;
  onProgress?: (name: string, status: RowStatus, error?: string) => void;
}

/**
 * Apply `target` visibility to each repo using the injected setter, with a
 * concurrency cap. Errors are caught per-repo so the batch always completes;
 * results preserve input order.
 */
export async function applyChanges(
  repos: Repo[],
  target: Visibility,
  setter: VisibilitySetter,
  opts: ApplyOptions = {},
): Promise<ApplyResult[]> {
  const limit = pLimit(opts.concurrency ?? 5);
  return Promise.all(
    repos.map((r) =>
      limit(async (): Promise<ApplyResult> => {
        opts.onProgress?.(r.name, 'applying');
        try {
          await setter(r.owner, r.name, target);
          opts.onProgress?.(r.name, 'done');
          return { name: r.name, ok: true };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          opts.onProgress?.(r.name, 'error', error);
          return { name: r.name, ok: false, error };
        }
      }),
    ),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/apply.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/apply.ts src/apply.test.ts
git commit -m "feat: add concurrency-limited apply step with progress"
```

---

## Task 7: CLI flags (`parseArgs`)

**Files:**
- Create: `src/cli.ts`
- Test: `src/cli.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface CliFlags { public?: boolean; private?: boolean; dryRun?: boolean; includeArchived?: boolean; forks: boolean }`; `function parseArgs(userArgv?: string[], opts?: { exitOverride?: boolean }): CliFlags`.
- Note: `--no-forks` reads as `forks` (default `true`, `false` when passed). `--public`/`--private` are mutually exclusive. Property names are camelCased (`--dry-run` → `dryRun`).

- [ ] **Step 1: Write the failing test `src/cli.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { parseArgs } from './cli.js';

describe('parseArgs', () => {
  it('defaults forks to true and other flags undefined', () => {
    const f = parseArgs([]);
    expect(f.forks).toBe(true);
    expect(f.dryRun).toBeUndefined();
    expect(f.public).toBeUndefined();
  });

  it('parses boolean flags and camelCases them', () => {
    const f = parseArgs(['--dry-run', '--private', '--include-archived']);
    expect(f.dryRun).toBe(true);
    expect(f.private).toBe(true);
    expect(f.includeArchived).toBe(true);
  });

  it('sets forks=false when --no-forks is passed', () => {
    expect(parseArgs(['--no-forks']).forks).toBe(false);
  });

  it('rejects --public together with --private', () => {
    expect(() => parseArgs(['--public', '--private'], { exitOverride: true })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli.test.ts`
Expected: FAIL — cannot find `./cli.js`.

- [ ] **Step 3: Write `src/cli.ts`**

```typescript
import { Command, Option } from 'commander';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// At runtime this file is dist/bin.js's bundle; package.json sits one level up.
const pkg = require('../package.json') as { version: string };

export interface CliFlags {
  public?: boolean;
  private?: boolean;
  dryRun?: boolean;
  includeArchived?: boolean;
  forks: boolean;
}

export function parseArgs(
  userArgv?: string[],
  opts: { exitOverride?: boolean } = {},
): CliFlags {
  const program = new Command();

  program
    .name('vizzy')
    .description('Bulk-change the visibility of your personal GitHub repos')
    .version(pkg.version, '-v, --version', 'output the current version')
    .addOption(new Option('--public', 'target visibility: public').conflicts('private'))
    .addOption(new Option('--private', 'target visibility: private').conflicts('public'))
    .option('--dry-run', 'preview changes without applying them')
    .option('--include-archived', 'include archived repositories')
    .option('--no-forks', 'exclude forked repositories');

  if (opts.exitOverride) program.exitOverride();

  if (userArgv) program.parse(userArgv, { from: 'user' });
  else program.parse(process.argv);

  return program.opts<CliFlags>();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/cli.test.ts`
Expected: PASS, 4 tests. (`createRequire('../package.json')` resolves from `src/` during tests because vitest runs from source; at build time tsup bundles to `dist/bin.js`, so `../package.json` resolves correctly from `dist/` too.)

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "feat: add CLI flag parsing with commander"
```

---

## Task 8: Test utilities + `TargetSelect` component

**Files:**
- Create: `src/test-utils.ts`, `src/ui/TargetSelect.tsx`
- Test: `src/ui/TargetSelect.test.tsx`

**Interfaces:**
- Consumes: `Visibility` from `../types.js`.
- Produces:
  - `test-utils.ts`: `const delay: (ms?: number) => Promise<void>`; `const KEY: { up: string; down: string; left: string; right: string; enter: string; space: string }`.
  - `TargetSelect.tsx`: `function TargetSelect({ onSelect }: { onSelect: (target: Visibility) => void }): JSX.Element`.

- [ ] **Step 1: Write `src/test-utils.ts`**

```typescript
export const delay = (ms = 25): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const KEY = {
  up: '[A',
  down: '[B',
  left: '[D',
  right: '[C',
  enter: '\r',
  space: ' ',
} as const;
```

- [ ] **Step 2: Write the failing test `src/ui/TargetSelect.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { TargetSelect } from './TargetSelect.js';
import { delay, KEY } from '../test-utils.js';

describe('TargetSelect', () => {
  it('renders both options with the cursor on Private', () => {
    const { lastFrame, unmount } = render(<TargetSelect onSelect={() => {}} />);
    expect(lastFrame()).toContain('Private');
    expect(lastFrame()).toContain('Public');
    unmount();
  });

  it('selects Private by default on Enter', async () => {
    const onSelect = vi.fn();
    const { stdin, unmount } = render(<TargetSelect onSelect={onSelect} />);
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onSelect).toHaveBeenCalledWith('private');
    unmount();
  });

  it('moves to Public and selects it', async () => {
    const onSelect = vi.fn();
    const { stdin, unmount } = render(<TargetSelect onSelect={onSelect} />);
    await delay();
    stdin.write(KEY.down);
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onSelect).toHaveBeenCalledWith('public');
    unmount();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/ui/TargetSelect.test.tsx`
Expected: FAIL — cannot find `./TargetSelect.js`.

- [ ] **Step 4: Write `src/ui/TargetSelect.tsx`**

```tsx
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Visibility } from '../types.js';

const OPTIONS: Visibility[] = ['private', 'public'];

export function TargetSelect({
  onSelect,
}: {
  onSelect: (target: Visibility) => void;
}): JSX.Element {
  const [cursor, setCursor] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) setCursor((c) => (c > 0 ? c - 1 : OPTIONS.length - 1));
    else if (key.downArrow) setCursor((c) => (c < OPTIONS.length - 1 ? c + 1 : 0));
    else if (key.return) onSelect(OPTIONS[cursor]!);
  });

  return (
    <Box flexDirection="column">
      <Text bold>Set selected repos to:</Text>
      {OPTIONS.map((opt, i) => (
        <Text key={opt} color={i === cursor ? 'cyan' : undefined}>
          {i === cursor ? '❯ ' : '  '}
          {opt === 'public' ? 'Public' : 'Private'}
        </Text>
      ))}
      <Box marginTop={1}>
        <Text dimColor>↑↓ move · enter select</Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/ui/TargetSelect.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/test-utils.ts src/ui/TargetSelect.tsx src/ui/TargetSelect.test.tsx
git commit -m "feat: add TargetSelect step and ink test utilities"
```

---

## Task 9: `RepoList` multi-select component

**Files:**
- Create: `src/ui/RepoList.tsx`
- Test: `src/ui/RepoList.test.tsx`

**Interfaces:**
- Consumes: `Repo`, `Visibility` from `../types.js`; `delay`, `KEY` from `../test-utils.js` (tests).
- Produces: `function RepoList({ repos, target, onSubmit, limit }: { repos: Repo[]; target: Visibility; onSubmit: (selected: Repo[]) => void; limit?: number }): JSX.Element`.
- Keys: ↑/↓ move (wrap), space toggle current, `a` toggle all, enter submit selected.

- [ ] **Step 1: Write the failing test `src/ui/RepoList.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { RepoList } from './RepoList.js';
import { delay, KEY } from '../test-utils.js';
import type { Repo } from '../types.js';

const repo = (name: string): Repo => ({
  name,
  owner: 'me',
  visibility: 'public',
  isFork: false,
  isArchived: false,
  stars: 1,
  pushedAt: '2024-01-01T00:00:00Z',
});

const repos = [repo('alpha'), repo('beta'), repo('gamma')];

describe('RepoList', () => {
  it('renders all repos with empty checkboxes', () => {
    const { lastFrame, unmount } = render(
      <RepoList repos={repos} target="private" onSubmit={() => {}} />,
    );
    expect(lastFrame()).toContain('alpha');
    expect(lastFrame()).toContain('beta');
    expect(lastFrame()).toContain('gamma');
    unmount();
  });

  it('selects with space and submits with enter', async () => {
    const onSubmit = vi.fn();
    const { stdin, unmount } = render(
      <RepoList repos={repos} target="private" onSubmit={onSubmit} />,
    );
    await delay();
    stdin.write(KEY.space); // select alpha
    await delay();
    stdin.write(KEY.down);
    await delay();
    stdin.write(KEY.down);
    await delay();
    stdin.write(KEY.space); // select gamma
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].map((r: Repo) => r.name)).toEqual(['alpha', 'gamma']);
    unmount();
  });

  it("selects all with 'a' then submits everything", async () => {
    const onSubmit = vi.fn();
    const { stdin, unmount } = render(
      <RepoList repos={repos} target="private" onSubmit={onSubmit} />,
    );
    await delay();
    stdin.write('a');
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onSubmit.mock.calls[0][0]).toHaveLength(3);
    unmount();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/RepoList.test.tsx`
Expected: FAIL — cannot find `./RepoList.js`.

- [ ] **Step 3: Write `src/ui/RepoList.tsx`**

```tsx
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Repo, Visibility } from '../types.js';

export function RepoList({
  repos,
  target,
  onSubmit,
  limit = 12,
}: {
  repos: Repo[];
  target: Visibility;
  onSubmit: (selected: Repo[]) => void;
  limit?: number;
}): JSX.Element {
  const [cursor, setCursor] = useState(0);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [offset, setOffset] = useState(0);

  const reframe = (next: number) => {
    if (next < offset) setOffset(next);
    else if (next > offset + limit - 1) setOffset(next - limit + 1);
  };

  useInput((input, key) => {
    if (key.upArrow) {
      const next = cursor > 0 ? cursor - 1 : repos.length - 1;
      setCursor(next);
      reframe(next);
    } else if (key.downArrow) {
      const next = cursor < repos.length - 1 ? cursor + 1 : 0;
      setCursor(next);
      reframe(next);
    } else if (input === ' ') {
      setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(cursor)) next.delete(cursor);
        else next.add(cursor);
        return next;
      });
    } else if (input === 'a') {
      setChecked((prev) =>
        prev.size === repos.length ? new Set() : new Set(repos.map((_, i) => i)),
      );
    } else if (key.return) {
      onSubmit(repos.filter((_, i) => checked.has(i)));
    }
  });

  const nameWidth = Math.max(4, ...repos.map((r) => r.name.length));
  const visible = repos.slice(offset, offset + limit);

  return (
    <Box flexDirection="column">
      <Text bold>{`Choose repos to make ${target.toUpperCase()}:`}</Text>
      {visible.map((repo, i) => {
        const index = offset + i;
        const isCursor = index === cursor;
        const isChecked = checked.has(index);
        return (
          <Box key={repo.name}>
            <Text color={isCursor ? 'cyan' : undefined}>{isCursor ? '❯ ' : '  '}</Text>
            <Text color={isChecked ? 'green' : undefined}>{isChecked ? '◉ ' : '◯ '}</Text>
            <Text color={isCursor ? 'cyan' : undefined}>{repo.name.padEnd(nameWidth)}</Text>
            <Text dimColor>{`   ${repo.visibility}   ★ ${repo.stars}`}</Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>{`↑↓ move · space toggle · a all · enter confirm (${checked.size} selected)`}</Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ui/RepoList.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/RepoList.tsx src/ui/RepoList.test.tsx
git commit -m "feat: add scrollable spacebar multi-select RepoList"
```

---

## Task 10: `Confirm` component

**Files:**
- Create: `src/ui/Confirm.tsx`
- Test: `src/ui/Confirm.test.tsx`

**Interfaces:**
- Consumes: `ChangePlan` from `../core/plan.js`; `formatSummary` from `../core/plan.js`; `delay` from `../test-utils.js` (tests).
- Produces: `function Confirm({ plan, dryRun, onConfirm }: { plan: ChangePlan; dryRun?: boolean; onConfirm: (yes: boolean) => void }): JSX.Element`.
- Keys: `y`/`Y` → `onConfirm(true)`; anything else (`n`, Enter, Esc) → `onConfirm(false)`.

- [ ] **Step 1: Write the failing test `src/ui/Confirm.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Confirm } from './Confirm.js';
import { buildPlan } from '../core/plan.js';
import { delay } from '../test-utils.js';
import type { Repo } from '../types.js';

const repo = (name: string, v: Repo['visibility']): Repo => ({
  name,
  owner: 'me',
  visibility: v,
  isFork: false,
  isArchived: false,
  stars: 0,
  pushedAt: '2024-01-01T00:00:00Z',
});

describe('Confirm', () => {
  it('shows the summary and a dry-run notice', () => {
    const plan = buildPlan('private', [repo('a', 'public')]);
    const { lastFrame, unmount } = render(
      <Confirm plan={plan} dryRun onConfirm={() => {}} />,
    );
    expect(lastFrame()).toContain('PRIVATE');
    expect(lastFrame()!.toLowerCase()).toContain('dry');
    unmount();
  });

  it('confirms on y', async () => {
    const onConfirm = vi.fn();
    const plan = buildPlan('public', [repo('s', 'private')]);
    const { stdin, unmount } = render(<Confirm plan={plan} onConfirm={onConfirm} />);
    await delay();
    stdin.write('y');
    await delay();
    expect(onConfirm).toHaveBeenCalledWith(true);
    unmount();
  });

  it('declines on n', async () => {
    const onConfirm = vi.fn();
    const plan = buildPlan('private', [repo('a', 'public')]);
    const { stdin, unmount } = render(<Confirm plan={plan} onConfirm={onConfirm} />);
    await delay();
    stdin.write('n');
    await delay();
    expect(onConfirm).toHaveBeenCalledWith(false);
    unmount();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/Confirm.test.tsx`
Expected: FAIL — cannot find `./Confirm.js`.

- [ ] **Step 3: Write `src/ui/Confirm.tsx`**

```tsx
import { Box, Text, useInput } from 'ink';
import { formatSummary, type ChangePlan } from '../core/plan.js';

export function Confirm({
  plan,
  dryRun,
  onConfirm,
}: {
  plan: ChangePlan;
  dryRun?: boolean;
  onConfirm: (yes: boolean) => void;
}): JSX.Element {
  useInput((input) => {
    onConfirm(input.toLowerCase() === 'y');
  });

  const loud = plan.target === 'public';
  return (
    <Box flexDirection="column">
      <Text color={loud ? 'red' : undefined}>{formatSummary(plan)}</Text>
      <Box marginTop={1}>
        <Text>
          {dryRun ? '[dry-run] ' : ''}
          Proceed? (y/N)
        </Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ui/Confirm.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/Confirm.tsx src/ui/Confirm.test.tsx
git commit -m "feat: add Confirm step with loud public warning"
```

---

## Task 11: `ApplyProgress` component

**Files:**
- Create: `src/ui/ApplyProgress.tsx`
- Test: `src/ui/ApplyProgress.test.tsx`

**Interfaces:**
- Consumes: `Visibility`, `RowStatus` from `../types.js`.
- Produces: `interface ProgressRow { name: string; status: RowStatus; error?: string }`; `function ApplyProgress({ rows, target }: { rows: ProgressRow[]; target: Visibility }): JSX.Element`.
- Presentational only — parent owns the row state.

- [ ] **Step 1: Write the failing test `src/ui/ApplyProgress.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { ApplyProgress } from './ApplyProgress.js';

describe('ApplyProgress', () => {
  it('renders a marker and name per row', () => {
    const { lastFrame, unmount } = render(
      <ApplyProgress
        target="private"
        rows={[
          { name: 'done-one', status: 'done' },
          { name: 'failed-one', status: 'error', error: 'denied' },
          { name: 'waiting-one', status: 'pending' },
        ]}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('done-one');
    expect(frame).toContain('failed-one');
    expect(frame).toContain('denied');
    expect(frame).toContain('waiting-one');
    unmount();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/ApplyProgress.test.tsx`
Expected: FAIL — cannot find `./ApplyProgress.js`.

- [ ] **Step 3: Write `src/ui/ApplyProgress.tsx`**

```tsx
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { Visibility, RowStatus } from '../types.js';

export interface ProgressRow {
  name: string;
  status: RowStatus;
  error?: string;
}

function Marker({ status }: { status: RowStatus }): JSX.Element {
  if (status === 'applying')
    return (
      <Text color="yellow">
        <Spinner type="dots" />
      </Text>
    );
  if (status === 'done') return <Text color="green">✔</Text>;
  if (status === 'error') return <Text color="red">✖</Text>;
  return <Text dimColor>·</Text>;
}

export function ApplyProgress({
  rows,
  target,
}: {
  rows: ProgressRow[];
  target: Visibility;
}): JSX.Element {
  return (
    <Box flexDirection="column">
      {rows.map((row) => (
        <Box key={row.name}>
          <Box width={3}>
            <Marker status={row.status} />
          </Box>
          <Text>{row.name}</Text>
          <Text dimColor>{`  → ${target}`}</Text>
          {row.error ? <Text color="red">{`  ${row.error}`}</Text> : null}
        </Box>
      ))}
    </Box>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ui/ApplyProgress.test.tsx`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/ui/ApplyProgress.tsx src/ui/ApplyProgress.test.tsx
git commit -m "feat: add ApplyProgress per-row status component"
```

---

## Task 12: `App` state machine

**Files:**
- Create: `src/ui/App.tsx`
- Test: `src/ui/App.test.tsx`

**Interfaces:**
- Consumes: `CliFlags` from `../cli.js`; `Repo`, `Visibility`, `VisibilitySetter`, `RowStatus` from `../types.js`; `eligibleRepos` from `../core/filter.js`; `buildPlan` from `../core/plan.js`; `applyChanges` from `../apply.js`; the four UI components; `useApp` from `ink`.
- Produces: `interface AppProps { flags: CliFlags; loadRepos: () => Promise<Repo[]>; setter: VisibilitySetter }`; `function App(props: AppProps): JSX.Element`.
- Behavior: if `flags.public`/`flags.private` set, skip the target step. Stages: `target → loading → (empty | error | select) → confirm → (dry-run done | applying → done)`. On `done`, set `process.exitCode = 1` if any failure, then `useApp().exit()`.

- [ ] **Step 1: Write the failing test `src/ui/App.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import { delay, KEY } from '../test-utils.js';
import type { Repo } from '../types.js';
import type { CliFlags } from '../cli.js';

const repo = (name: string, v: Repo['visibility']): Repo => ({
  name,
  owner: 'me',
  visibility: v,
  isFork: false,
  isArchived: false,
  stars: 0,
  pushedAt: '2024-01-01T00:00:00Z',
});

const flags = (over: Partial<CliFlags> = {}): CliFlags => ({ forks: true, ...over });

describe('App', () => {
  it('runs the full private flow and applies the selection', async () => {
    const setter = vi.fn().mockResolvedValue(undefined);
    const loadRepos = vi.fn().mockResolvedValue([repo('pub-a', 'public'), repo('already', 'private')]);
    const { stdin, lastFrame, unmount } = render(
      <App flags={flags({ private: true })} loadRepos={loadRepos} setter={setter} />,
    );
    await delay(40); // skip target (flag set) + finish loading
    expect(lastFrame()).toContain('pub-a');
    expect(lastFrame()).not.toContain('already'); // filtered: already private
    stdin.write(KEY.space); // select pub-a
    await delay();
    stdin.write(KEY.enter); // submit
    await delay();
    expect(lastFrame()).toContain('Proceed?');
    stdin.write('y');
    await delay(40);
    expect(setter).toHaveBeenCalledWith('me', 'pub-a', 'private');
    expect(lastFrame()!.toLowerCase()).toContain('done');
    unmount();
  });

  it('shows a friendly message when nothing is eligible', async () => {
    const loadRepos = vi.fn().mockResolvedValue([repo('already', 'private')]);
    const { lastFrame, unmount } = render(
      <App flags={flags({ private: true })} loadRepos={loadRepos} setter={vi.fn()} />,
    );
    await delay(40);
    expect(lastFrame()!.toLowerCase()).toContain('nothing');
    unmount();
  });

  it('dry-run does not call the setter', async () => {
    const setter = vi.fn().mockResolvedValue(undefined);
    const loadRepos = vi.fn().mockResolvedValue([repo('pub-a', 'public')]);
    const { stdin, lastFrame, unmount } = render(
      <App flags={flags({ private: true, dryRun: true })} loadRepos={loadRepos} setter={setter} />,
    );
    await delay(40);
    stdin.write('a'); // select all
    await delay();
    stdin.write(KEY.enter);
    await delay();
    stdin.write('y');
    await delay(40);
    expect(setter).not.toHaveBeenCalled();
    expect(lastFrame()!.toLowerCase()).toContain('dry');
    unmount();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/App.test.tsx`
Expected: FAIL — cannot find `./App.js`.

- [ ] **Step 3: Write `src/ui/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import type { CliFlags } from '../cli.js';
import type { Repo, Visibility, VisibilitySetter, RowStatus } from '../types.js';
import { eligibleRepos } from '../core/filter.js';
import { buildPlan } from '../core/plan.js';
import { applyChanges } from '../apply.js';
import { TargetSelect } from './TargetSelect.js';
import { RepoList } from './RepoList.js';
import { Confirm } from './Confirm.js';
import { ApplyProgress, type ProgressRow } from './ApplyProgress.js';

export interface AppProps {
  flags: CliFlags;
  loadRepos: () => Promise<Repo[]>;
  setter: VisibilitySetter;
}

type Stage = 'target' | 'loading' | 'error' | 'empty' | 'select' | 'confirm' | 'applying' | 'done';

function initialTarget(flags: CliFlags): Visibility | null {
  if (flags.private) return 'private';
  if (flags.public) return 'public';
  return null;
}

export function App({ flags, loadRepos, setter }: AppProps): JSX.Element {
  const { exit } = useApp();
  const preset = initialTarget(flags);

  const [stage, setStage] = useState<Stage>(preset ? 'loading' : 'target');
  const [target, setTarget] = useState<Visibility | null>(preset);
  const [candidates, setCandidates] = useState<Repo[]>([]);
  const [selected, setSelected] = useState<Repo[]>([]);
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [summary, setSummary] = useState('');

  // Load + filter once a target exists.
  useEffect(() => {
    if (stage !== 'loading' || !target) return;
    let cancelled = false;
    loadRepos()
      .then((repos) => {
        if (cancelled) return;
        const eligible = eligibleRepos(repos, target, {
          includeForks: flags.forks,
          includeArchived: Boolean(flags.includeArchived),
        });
        if (eligible.length === 0) {
          setStage('empty');
          setTimeout(exit, 0);
        } else {
          setCandidates(eligible);
          setStage('select');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
        setStage('error');
        setTimeout(exit, 0);
      });
    return () => {
      cancelled = true;
    };
  }, [stage, target, flags, loadRepos, exit]);

  // Apply once confirmed.
  useEffect(() => {
    if (stage !== 'applying' || !target) return;
    setRows(selected.map((r) => ({ name: r.name, status: 'pending' as RowStatus })));
    applyChanges(selected, target, setter, {
      onProgress: (name, status, error) => {
        setRows((prev) =>
          prev.map((row) => (row.name === name ? { ...row, status, error } : row)),
        );
      },
    }).then((results) => {
      const failed = results.filter((r) => !r.ok).length;
      if (failed > 0) process.exitCode = 1;
      setSummary(`Done: ${results.length - failed} changed, ${failed} failed.`);
      setStage('done');
      setTimeout(exit, 0);
    });
  }, [stage, target, selected, setter, exit]);

  if (stage === 'target')
    return (
      <TargetSelect
        onSelect={(t) => {
          setTarget(t);
          setStage('loading');
        }}
      />
    );

  if (stage === 'loading') return <Text>Loading your repositories…</Text>;
  if (stage === 'error') return <Text color="red">{errorMsg}</Text>;
  if (stage === 'empty')
    return <Text>Nothing to do — no repos need to change to {target}.</Text>;

  if (stage === 'select' && target)
    return (
      <RepoList
        repos={candidates}
        target={target}
        onSubmit={(sel) => {
          if (sel.length === 0) {
            setStage('done');
            setSummary('No repos selected.');
            setTimeout(exit, 0);
            return;
          }
          setSelected(sel);
          setStage('confirm');
        }}
      />
    );

  if (stage === 'confirm' && target)
    return (
      <Confirm
        plan={buildPlan(target, selected)}
        dryRun={flags.dryRun}
        onConfirm={(yes) => {
          if (!yes) {
            setSummary('Cancelled.');
            setStage('done');
            setTimeout(exit, 0);
          } else if (flags.dryRun) {
            setSummary(`[dry-run] Would change ${selected.length} repo(s) to ${target}.`);
            setStage('done');
            setTimeout(exit, 0);
          } else {
            setStage('applying');
          }
        }}
      />
    );

  if (stage === 'applying' && target)
    return (
      <Box flexDirection="column">
        <ApplyProgress rows={rows} target={target} />
      </Box>
    );

  // done
  return <Text>{summary}</Text>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ui/App.test.tsx`
Expected: PASS, 3 tests. If a flow assertion flakes, increase the `await delay(40)` after `y`/loading to `delay(60)` — React effect + apply need a tick (real timers only).

- [ ] **Step 5: Run the entire suite**

Run: `npm test`
Expected: PASS — all tasks' tests green.

- [ ] **Step 6: Commit**

```bash
git add src/ui/App.tsx src/ui/App.test.tsx
git commit -m "feat: wire App state machine (target->select->confirm->apply)"
```

---

## Task 13: Real entry (`bin.tsx`) + end-to-end build

**Files:**
- Modify: `src/bin.tsx` (replace placeholder)

**Interfaces:**
- Consumes: `parseArgs` from `./cli.js`; `getToken`, `TokenError` from `./auth.js`; `makeOctokit`, `listOwnerRepos`, `makeSetter` from `./github.js`; `App` from `./ui/App.js`; `render` from `ink`.
- Produces: the executable CLI.

- [ ] **Step 1: Replace `src/bin.tsx` with the real wiring**

```tsx
#!/usr/bin/env node
import { render } from 'ink';
import { parseArgs } from './cli.js';
import { getToken } from './auth.js';
import { makeOctokit, listOwnerRepos, makeSetter } from './github.js';
import { App } from './ui/App.js';

const flags = parseArgs();

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.stderr.write('vizzy is interactive and must be run in a terminal (TTY).\n');
  process.exit(1);
}

let token: string;
try {
  token = await getToken();
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

const octokit = makeOctokit(token);
const { waitUntilExit } = render(
  <App flags={flags} loadRepos={() => listOwnerRepos(octokit)} setter={makeSetter(octokit)} />,
);
await waitUntilExit();
```

- [ ] **Step 2: Typecheck the whole project**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Build and confirm the executable**

Run: `npm run build && test -x dist/bin.js && head -1 dist/bin.js`
Expected: build succeeds; `test -x` exits 0; first line is `#!/usr/bin/env node`.

- [ ] **Step 4: Smoke `--help` and `--version` against the built bin**

Run: `node dist/bin.js --help && node dist/bin.js --version`
Expected: help text lists `--public`, `--private`, `--dry-run`, `--include-archived`, `--no-forks`; version prints `0.1.0`. (These exit before the TTY guard because commander handles them during `parseArgs`.)

- [ ] **Step 5: Manual interactive smoke (real GitHub, dry-run — requires `gh auth login`)**

Run: `node dist/bin.js --dry-run`
Expected: target step → repo list of your real repos → select a couple → confirm → `[dry-run]` summary, **no changes made**. (Skip if not authenticated; note it as skipped.)

- [ ] **Step 6: Commit**

```bash
git add src/bin.tsx
git commit -m "feat: wire real CLI entry (token -> octokit -> Ink app)"
```

---

## Task 14: Packaging polish (README, LICENSE, CI)

**Files:**
- Create: `README.md`, `LICENSE`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: publishable repo metadata + CI.

- [ ] **Step 1: Write `LICENSE`** (MIT, current year, author `Jake Castillo`)

```
MIT License

Copyright (c) 2026 Jake Castillo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Write `README.md`**

````markdown
# vizzy

Bulk-change the visibility of your **personal** GitHub repositories from an
interactive terminal UI — pick a target (public/private), check off the repos,
confirm, done.

## Requirements

- Node.js ≥ 20
- A GitHub token. The easiest path is the [GitHub CLI](https://cli.github.com):
  run `gh auth login` once and vizzy reuses its token. Or set `GITHUB_TOKEN` /
  `GH_TOKEN` (needs the classic `repo` scope, or a fine-grained PAT with
  repository **Administration: Read and write**).

## Usage

```bash
npx vizzy-cli          # run without installing
# or
npm i -g vizzy-cli && vizzy
```

1. Choose the target visibility (Private or Public).
2. vizzy lists the personal repos **not already** in that state.
3. `↑/↓` move · `space` toggle · `a` all · `enter` confirm.
4. Review the summary and confirm. Making repos **public** shows a loud warning.

### Flags

| Flag | Effect |
|---|---|
| `--private` / `--public` | Preselect the target and skip step 1 |
| `--dry-run` | Preview changes without applying them |
| `--include-archived` | Include archived repos (GitHub may reject the change) |
| `--no-forks` | Exclude forked repos (forks are included by default) |
| `-h, --help` / `-v, --version` | Standard |

## Development

```bash
npm install
npm test        # vitest
npm run build   # tsup -> dist/bin.js
```

## License

MIT
````

- [ ] **Step 3: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 4: Verify the full local gate mirrors CI**

Run: `npm run lint; npm run typecheck && npm test && npm run build`
Expected: typecheck, test, and build pass. (`lint` should pass; if eslint flat-config resolution fails in this environment, fix the config or drop `npm run lint` from CI — it must not block the build.)

- [ ] **Step 5: Commit**

```bash
git add README.md LICENSE .github/workflows/ci.yml
git commit -m "docs: add README, LICENSE, and CI workflow"
```

---

## Self-review (completed by plan author)

**Spec coverage:**
- Auth (gh → env) → Task 4. ✓
- List owner repos, forks-in/archived-out, both directions → Tasks 2, 5. ✓
- Target-first flow, pre-filtered list → Tasks 8, 9, 12. ✓
- Multi-select (space/a/enter, scroll, columns) → Task 9. ✓
- Confirm summary + loud public + dry-run → Tasks 3, 10, 12. ✓
- Apply with concurrency 5, per-repo results → Task 6. ✓
- Per-row live status → Tasks 11, 12. ✓
- Error handling (no token, 403 scope, rate limit, 422, empty, non-TTY) → Tasks 4, 5, 12, 13. ✓
- CLI flags → Task 7. ✓
- Build/dist/bin/engines/ESM → Tasks 1, 13. ✓
- Tests across core/client/UI → every task. ✓
- README/LICENSE/CI → Task 14. ✓
- Out-of-scope items (org repos, internal, secret-scan, config files, unarchive) → not implemented, by design. ✓

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `Visibility`/`Target`/`Repo`/`ApplyResult`/`VisibilitySetter`/`RowStatus` defined once in `types.ts` (Task 2) and consumed unchanged. `eligibleRepos`, `buildPlan`/`formatSummary`/`ChangePlan`, `getToken`, `listOwnerRepos`/`setVisibility`/`makeSetter`/`explainError`/`RawRepo`, `applyChanges`/`ApplyOptions`, `parseArgs`/`CliFlags`, and the four component prop shapes match across producer and consumer tasks. `ProgressRow` defined in Task 11, imported by Task 12.

**Known environment caveats flagged for the executor:**
- `RequestError` runtime constructor signature may vary; `explainError` only reads `.status` / `.response.headers`, and the github test builds errors structurally.
- Ink tests require the post-`render()` settle delay (Global Constraints); bump `delay()` if a flow test flakes.
- eslint flat config is a nice-to-have; it must never block test/build.
