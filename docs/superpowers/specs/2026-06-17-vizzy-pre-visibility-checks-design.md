# vizzy — Pre-visibility double-check (design spec)

> Date: 2026-06-17 · Status: approved (brainstorm) · Builds on
> [`2026-06-16-vizzy-repo-visibility-design.md`](./2026-06-16-vizzy-repo-visibility-design.md).
> Target version: **0.2.0**.

## Context

vizzy bulk-changes the visibility of personal GitHub repos through an interactive
Ink TUI: `TargetSelect → RepoList → Confirm → ApplyProgress` (`src/ui/App.tsx`).
Today the only guard before exposing code is a loud red summary in `Confirm.tsx`
plus a single `y/N` keystroke, and `--dry-run`. Going public is effectively a
one-way door — once a repo is cloned, forked, or indexed you cannot truly recall
it. This spec hardens that going-public moment with real, per-repo signal.

**Everything in this spec keys off `target === 'public'`. Private switches are
untouched.** The existing private flow, tests, and UX must not regress.

## Goal

Before a public switch is applied, give the user actionable double-checks:

1. **Sensitive-file pre-flight scan** — fetch each selected repo's file tree and
   flag expose-risk files (`.env`, private keys, credentials…).
2. **Per-repo risk signals** — no LICENSE, stale, high-profile, archived.
3. **Escalating typed confirmation** — friction scales with risk.
4. **Protected-repos guard (`.vizzyignore`)** + **`--audit` report mode**.

## Non-goals

- Org repos, `internal` visibility, archived-repo changes (already out of scope).
- Deep content secret scanning (entropy/regex over file *contents*). v1 is
  **filename-based** — high signal, bounded cost, no code download. A later
  iteration may add content scanning behind a flag.
- GitHub Advanced Security / secret-scanning-alerts API (not available on most
  personal private repos). Not used.
- Auto-remediation (removing files, editing .gitignore). vizzy only *reports*.

## Architecture

vizzy's pattern is **pure `core/` logic + thin Ink UI + one test file per
module**. This design follows it exactly: all decision logic lives in pure,
table-tested core modules; the UI and network layers stay thin. New code is
ESM TypeScript, Node ≥ 20, `.js` import specifiers (NodeNext), no new runtime
dependencies (reuse `p-limit`, `@octokit/rest`, `ink`).

### Data model (`src/core/checks.ts` — the shared contract)

```ts
export type Severity = 'clean' | 'caution' | 'danger';
export type ConfirmLevel = 'y' | 'phrase' | 'name';

export interface Finding {
  kind:
    | 'secret-file'      // danger: a likely secret/credential file
    | 'no-license'       // caution
    | 'stale'            // caution
    | 'high-profile'     // caution
    | 'archived'         // caution
    | 'scan-incomplete'; // caution: tree was truncated; absence ≠ all-clear
  severity: 'caution' | 'danger';
  label: string;         // short human label, e.g. ".env tracked"
  detail?: string;       // e.g. the offending path
}

export interface RepoAssessment {
  repo: Repo;
  findings: Finding[];
  severity: Severity;          // 'danger' if any danger finding, else
                               // 'caution' if any caution finding, else 'clean'
  requiredConfirm: ConfirmLevel; // danger→'name', caution→'phrase', clean→'y'
}
```

`assess(repo: Repo, paths: string[] | null, opts: AssessOptions): RepoAssessment`
is pure. `paths === null` means "tree unavailable" (fetch failed) → emit a
`scan-incomplete` caution. `opts` carries thresholds (injected, not hard-coded,
so tests are deterministic): `{ staleMonths: 12, highProfileStars: 10, now: Date }`.

### Sensitive-file classifier (`src/core/sensitive.ts` — pure)

```ts
export interface SensitiveHit { path: string; rule: string; }
export function classifyPath(path: string): SensitiveHit | null;
export function scanPaths(paths: string[]): SensitiveHit[];
```

**Danger rules** (basename unless noted; case-insensitive; match anywhere in tree):

- `.env` and `.env.*` — EXCEPT suffixes `.example`, `.sample`, `.template`,
  `.dist`, `.defaults` (these are conventional, non-secret).
- Private keys: `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519` (no `.pub`),
  `*.pem`, `*.key` (EXCEPT `*.pub.key`, `*.public.key`), `*.ppk`, `*.p12`,
  `*.pfx`, `*.keystore`, `*.jks`.
- Credentials: `credentials`, `credentials.json`, `.npmrc`, `.pypirc`,
  `service-account*.json`, `*-service-account.json`, `gcloud-*.json`,
  `.aws/credentials` (path), `*.kdbx`, `secrets.*` (EXCEPT `secrets.example.*`).

**Exclusions** (never flagged): anything under `node_modules/`, `.git/`,
`vendor/`, `dist/`, `build/`; the `.example/.sample/.template/.dist` suffixes
above; `*.lock`. Rules live in one ordered table so adding a rule is one line and
every rule has a name surfaced in `rule` for the UI/tests.

### GitHub layer (`src/github.ts` — extend)

```ts
// New fields on the existing types (both present in the list response — no extra calls):
interface RawRepo { /* …existing… */ default_branch: string;
                    license: { spdx_id: string | null } | null; }
interface Repo    { /* …existing… */ defaultBranch: string;
                    license: string | null; } // spdx_id or null

export async function listRepoTree(
  octokit: Pick<Octokit, 'rest'>, owner: string, repo: string, ref: string,
): Promise<{ paths: string[]; truncated: boolean }>;
// GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1 ; ref = defaultBranch.
// Returns blob paths only (type==='blob'). On 404/409 (empty repo) → { paths: [], truncated: false }.
// Network/permission errors propagate to the caller (the scan stage records them as scan-incomplete).
```

`normalizeRepo` populates `defaultBranch` (fallback `'HEAD'` if absent) and
`license` (`raw.license?.spdx_id ?? null`). Existing tests updated for the two
new fields; no behavior change to existing call sites.

### Scan orchestration (`src/core/scan.ts` — pure-ish, injectable)

```ts
export type TreeFetcher = (repo: Repo) => Promise<{ paths: string[]; truncated: boolean }>;
export async function assessRepos(
  repos: Repo[], fetch: TreeFetcher, opts: AssessOptions & { concurrency?: number },
): Promise<RepoAssessment[]>; // p-limit(concurrency ?? 5); per-repo failure → assess(repo, null)
```

The `TreeFetcher` is injected (real one wraps `listRepoTree`; tests pass a stub),
keeping `scan.ts` deterministic and unit-testable with no network.

### Protected list (`src/core/protected.ts` — pure)

```ts
export function loadProtected(fileText: string): string[]; // trims, drops blanks + '#' comments
export function isProtected(repoName: string, patterns: string[]): boolean; // glob: '*' and '?'
export function partitionProtected(
  repos: Repo[], patterns: string[],
): { allowed: Repo[]; protectedOut: Repo[] };
```

`.vizzyignore` is read from the current working directory (and, if present,
`$XDG_CONFIG_HOME/vizzy/ignore` or `~/.config/vizzy/ignore` — cwd wins, union of
both). Glob match on the **repo name** only. Protected repos are removed from the
candidate set **only when target === 'public'** (they may still be made private);
the UI shows "N repo(s) protected by .vizzyignore — hidden from public." Missing
file → empty list (no-op). A `--no-protect` flag bypasses the guard.

### UI: App stage (`src/ui/App.tsx` — extend)

New stage `'scanning'` inserted **only for public target**, between `select` and
`confirm`:

```
select → (target==='public') ? scanning → confirm  :  confirm
```

`scanning` renders an `ink-spinner` line ("Checking N repo(s) for exposure
risk…"), runs `assessRepos` over the **selected** repos (protected ones already
filtered out), stores `RepoAssessment[]`, then advances to `confirm`. A scan
fetch failure does not abort — it becomes a `scan-incomplete` caution for that
repo. Private target skips scanning entirely (unchanged path).

### UI: escalating confirm (`src/ui/Confirm.tsx` — rework public branch)

Private target: **unchanged** (`formatSummary` + `y/N`). Public target renders a
per-repo review list (name · severity glyph · findings) and an input whose
required token is the batch's max severity:

- **clean batch** → `y/N` (one keystroke, as today).
- **caution batch** (no danger) → type `public` + Enter; bare `y` does nothing.
- **danger batch** → each danger repo must be **armed** by typing its exact name;
  unarmed danger repos are **excluded** from the apply set and shown as
  "skipped — likely secret". `--force-public` drops the name-typing requirement
  (danger repos included, batch confirmed by typing `public`).

Typed input is hand-rolled with Ink `useInput` (accumulate a buffer, Backspace,
Enter submits) — no new dependency. `onConfirm` is generalized to return the
**armed subset** to apply, not just a boolean: `onConfirm(reposToApply: Repo[])`
(empty array = cancel). `App.tsx` applies exactly that subset. Glyphs: `✓` clean,
`⚠` caution, `✗` danger (respect existing color usage; `loud` red stays).

### CLI (`src/cli.ts` — extend)

Add to `CliFlags` and commander:

- `--force-public` — skip per-repo name-typing for danger repos (still shows them).
- `--no-protect` — ignore `.vizzyignore`.
- `--audit` — non-interactive audit mode (below). Conflicts with `--dry-run`.

### `--audit` mode (`src/audit.ts` — new; wired in `bin.tsx`)

Non-interactive. Loads owned repos, selects the **currently-public** ones, fetches
each tree, runs `assess`, prints a per-repo report to stdout (repo · severity ·
findings), makes **no** changes. This is the "what have I already exposed?" view.
**Exit code: non-zero (1) if any repo has a `danger` finding**, else 0 — so it is
usable in CI / pre-publish checks. `bin.tsx` routes to `runAudit()` before
rendering the Ink app when `flags.audit` is set. Honors `--no-protect` (audit
ignores the protected list by default — you want to see everything that's public).

## Error handling

- Per-repo tree-fetch failure is isolated (the batch completes): the repo gets a
  `scan-incomplete` caution, never a silent all-clear. Truncated trees
  (`truncated === true`, huge repos) also yield `scan-incomplete`.
- Existing Octokit `explainError` handling (rate limit / 403 / 404 / 422) is
  reused for the tree calls.
- A crash in scanning must not strand the TUI: on unexpected scan error, surface
  the message and let the user proceed to confirm with all repos marked
  `scan-incomplete` (caution) — fail toward *more* friction, never less.

## Testing strategy

Every new module gets a `*.test.ts` (vitest), matching vizzy's culture:

- `sensitive.test.ts` — table of paths → expected hit/null, incl. every exclusion
  (`.env.example`, `*.pub.key`, `node_modules/**`, `secrets.example.json`).
- `checks.test.ts` — each finding kind; severity precedence (danger > caution >
  clean); `requiredConfirm` mapping; `paths===null` → scan-incomplete; injected
  `now`/thresholds.
- `protected.test.ts` — comment/blank stripping, glob matching, partition, the
  public-only application.
- `scan.test.ts` — stub `TreeFetcher`: concurrency, per-repo failure isolation,
  truncated → scan-incomplete.
- `github.test.ts` — `listRepoTree` (blob filtering, empty-repo 404→[]) via a
  mocked octokit; `normalizeRepo` new fields.
- `audit.test.ts` — report content + exit code 1 on danger, 0 when clean (inject
  a fake repo loader + tree fetcher).
- `Confirm.test.tsx` / `App.test.tsx` (ink-testing-library) — clean→y, caution→
  phrase, danger→arm-by-name + skip, `--force-public`, private unchanged.

**Gate (authoritative, from CI):** `npm run lint && npm run typecheck &&
npm test && npm run build`. No task is done on red. Tests are written first (TDD):
a failing test that encodes the acceptance, then the implementation.

## Bead breakdown (epic + 9, dependency-ordered)

1. `core/sensitive.ts` classifier + tests. *(no deps)*
2. `github.ts`: `listRepoTree` + `Repo`/`RawRepo` enrichment (`license`,
   `defaultBranch`) + tests. *(no deps)*
3. `core/checks.ts`: `assess` + `RepoAssessment` model + tests. *(deps 1, 2)*
4. `core/protected.ts`: `.vizzyignore` loader/matcher + tests. *(no deps)*
5. `core/scan.ts`: `assessRepos` orchestration (injectable fetcher, p-limit) +
   tests. *(deps 2, 3)*
6. `cli.ts`: `--force-public`, `--no-protect`, `--audit` parsing + help + README
   flag table. *(no deps)*
7. `ui/App.tsx`: `scanning` stage + protected filtering + thread assessments.
   *(deps 4, 5)*
8. `ui/Confirm.tsx`: escalating typed confirm; `onConfirm(reposToApply)`;
   per-repo findings. *(deps 3, 7)*
9. `audit.ts` + `bin.tsx` wiring: `--audit` report path + exit code. *(deps 5, 6)*

Plus a closing **docs/release** step: README "Pre-visibility checks" section,
`.vizzyignore` example, CHANGELOG entry, `0.1.0 → 0.2.0` version bump (staged,
**not** published — npm publish stays gated / pending account).

## Rollout / safety

- All work on a dedicated shift branch; `main` is never touched without sign-off.
- Reversible throughout (code + git). No GitHub writes happen during scan/audit —
  only reads (`GET …/git/trees`). The only write path remains the existing
  `setVisibility`, now applied to the **armed subset** the user confirmed.
- Version bump is staged in-repo; publishing/tagging to the registry is an
  irreversible outward action and is left for a human.
