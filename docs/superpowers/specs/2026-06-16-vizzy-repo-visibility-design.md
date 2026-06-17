# vizzy — interactive GitHub repo visibility manager

**Date:** 2026-06-16
**Status:** Approved design (pre-implementation)
**Package:** `vizzy-cli` (npm) · **Command:** `vizzy`

## Summary

`vizzy` is an npm-installable CLI that lets a user view their personal
GitHub repositories and change their visibility (public ↔ private) in
bulk, through an interactive terminal UI modeled on
`yarn upgrade-interactive --latest`. The user picks a target visibility,
sees the repos eligible to change, multi-selects them with the spacebar,
confirms, and the tool applies the change to each.

## Goals

- View repositories **owned by the authenticated user** (personal, not org).
- Change visibility for many repos at once via a polished interactive list.
- Be safe by default: a clear confirmation summary and a `--dry-run` mode,
  with the "make public" direction treated as the dangerous one.
- Install and run with zero configuration for anyone who already uses the
  `gh` CLI.

## Non-goals (YAGNI — explicitly out of scope)

- Organization repositories (even where the user has admin rights).
- The `internal` visibility level (org-only; N/A for personal accounts).
- Secret-scanning a repo before making it public.
- Persistent config files / saved preferences.
- Unarchiving archived repos as part of a visibility change.

These are deferrable; none are required for the first release.

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Authentication | `gh auth token`, fall back to `GH_TOKEN` / `GITHUB_TOKEN` | Zero setup for `gh` users; no OAuth app to host or token store to manage. Env order mirrors `gh`'s own precedence. |
| Action model | Pick a **target state** for the batch | Avoids ambiguity of toggling a mixed selection. |
| Flow order | **Target first**, then a pre-filtered list | List shows only repos *not already* in the target state — directly eligible to change. |
| Repo scope | Owner repos; **include forks**; **exclude archived** | Matches user intent; GitHub blocks visibility changes on archived repos anyway. |
| Safety gate | Summary confirm + `--dry-run`; public is the loud confirm | Bulk exposure risk is the thing to guard; private direction needs less friction. |
| TUI stack | **Ink** (React for CLIs) + TypeScript | Closest to the `yarn upgrade-interactive` feel: aligned columns, colors, per-row live status. |
| GitHub client | Octokit (`@octokit/rest`) | Standard, paginated, typed. |
| Node floor | **`node >= 20`** (was `>= 18`) | Resolved during planning research — see below. Node 18 is EOL (Apr 2025); current deps require ≥20. |

## Dependency stack (resolved during planning)

Planning research found the spec's original `node >= 18` floor incompatible with
current libraries, and that the latest Ink (7) needs Node ≥22 + React 19 while
its only test library (`ink-testing-library@4`) is verified against **Ink 5 +
React 18**. To keep the TDD harness on a verified combination while dropping the
EOL Node 18 floor, the project targets **Node ≥20** with this stack:

| Package | Version | Notes |
|---|---|---|
| `ink` | `^5.2.1` | Last line supporting React 18; verified with the test library. |
| `react` / `@types/react` | `^18.3.1` / `^18.3` | Pairs with Ink 5. |
| `ink-spinner` | `^5.0.0` | Per-row apply status. |
| `ink-testing-library` | `^4.0.0` | Verified passing against Ink 5 + React 18. |
| `@octokit/rest` | `^22.0.1` | ESM; needs Node ≥20. |
| `commander` | `^14.0.3` | Flag parsing; zero runtime deps; Node ≥20. |
| `p-limit` | `^7.3.0` | Concurrency cap (5) for the apply step. |
| `tsup` | `^8.5.1` | Bundles ESM; preserves shebang + sets executable bit. |
| `typescript` | `^5.7` | TS 6 deferred (eslint/plugin lag). |
| `vitest` | `^4.1.9` | Test runner. |

## User flow

```
$ npx vizzy            # or: vizzy   (after global install)

Step 1 — Set selected repos to:   ❯ Private     Public
         (target chosen first)

   ↓ fetch owner repos, filter to those NOT already Private

Step 2 — space: select · a: toggle all · ↑↓: move · ⏎: continue
   [x] my-secret-app     public   ★ 12   pushed 3d ago
   [ ] old-fork          public   ★  0   pushed 1y ago      (forks included)
   [x] notes             public   ★  1   pushed 2w ago

   ↓

Step 3 — confirm
   ⚠ Making 2 repos PRIVATE:  my-secret-app, notes
     Proceed? (y/N)

   ↓ applying (per-row live status, concurrency-limited)
   ✓ my-secret-app → private
   ✓ notes → private
   Done: 2 changed, 0 failed.
```

When the target is **Public**, the same flow runs but Step 3 is the loud
confirmation: it lists exactly which repos are about to be exposed.
`--dry-run` performs every step *except* the final write, printing what
*would* change.

## Architecture

Core decision logic is kept as pure functions, separate from the Ink UI,
so the heart of the tool is unit-testable with no mocking.

```
src/
  bin.ts              # shebang entry: parse flags → render <App/>
  auth.ts             # getToken(): gh auth token → GITHUB_TOKEN/GH_TOKEN → friendly error
  github.ts           # Octokit wrapper: listOwnerRepos(), setVisibility()
  core/
    filter.ts         # pure: eligibleRepos(repos, target, opts)
    plan.ts           # pure: build/format the change plan + confirmation summary
  ui/
    App.tsx           # state machine: Target → Loading → Select → Confirm → Apply → Done
    TargetSelect.tsx  # choose Private | Public
    RepoList.tsx      # scrollable multi-select with columns
    Confirm.tsx       # summary + y/N (loud when going public)
    ApplyProgress.tsx # per-row spinner / success / fail
```

### Module responsibilities

- **`auth.ts`** — `getToken(): Promise<string>`. Resolution order:
  1. `gh auth token` (spawned subprocess; trim output).
  2. `GH_TOKEN` then `GITHUB_TOKEN` environment variables (mirrors `gh`'s own
     precedence; the env fallback mainly matters when `gh` is absent).
  3. Throw a friendly error instructing the user to run `gh auth login`
     or set `GITHUB_TOKEN`.
- **`github.ts`** — thin Octokit wrapper.
  - `listOwnerRepos(opts)` → `GET /user/repos?affiliation=owner&per_page=100`,
    fully paginated. `affiliation: 'owner'` already restricts results to repos
    owned by the authenticated user, so an explicit `owner.login` comparison is
    redundant and omitted. Drops archived; keeps forks. Returns a normalized
    `Repo` shape.
  - `setVisibility(owner, repo, visibility)` →
    `PATCH /repos/{owner}/{repo}` with `{ visibility }`.
- **`core/filter.ts`** — `eligibleRepos(repos, target)` returns repos whose
  current visibility differs from `target`, sorted by `pushedAt` descending
  (most recently pushed first) for a stable, useful default order (pure).
- **`core/plan.ts`** — builds the change plan from the user's selection and
  formats the confirmation summary string (pure).
- **`ui/App.tsx`** — owns the state machine and orchestrates the modules;
  child components are thin and presentational.

### Data flow

```
gh token ─▶ Octokit ─▶ listOwnerRepos ─▶ eligibleRepos(target)
   ─▶ user multi-selects ─▶ plan ─▶ confirm
   ─▶ apply with concurrency limit (5) ─▶ collect results ─▶ summary
```

### Domain types (indicative)

```ts
type Visibility = 'public' | 'private';

interface Repo {
  name: string;
  owner: string;
  visibility: Visibility;
  isFork: boolean;
  isArchived: boolean;
  stars: number;
  pushedAt: string; // ISO
}

interface ApplyResult {
  repo: string;
  ok: boolean;
  error?: string;
}
```

## CLI flags

- `--dry-run` — run everything except the final PATCH; print intended changes.
- `--public` / `--private` — preselect the target and skip Step 1.
- `--include-archived` — opt archived repos back in. They appear as normal
  selectable rows; GitHub blocks visibility changes on archived repos, so any
  selected archived repo is reported as a per-repo failure during apply.
  (Rendering archived rows as visually disabled/non-selectable is deferred.)
- `--no-forks` — exclude forks (forks are included by default).
- `--help`, `--version`.

## Error handling

- **No token** → message: run `gh auth login` or set `GITHUB_TOKEN`.
- **403 / missing scope** → explain the `repo` scope is required to change
  visibility. A genuine 404 gets a distinct "not found / not accessible" message.
- **Rate limited** → show the reset time (when to retry).
- **Per-repo failure during apply** → mark that row failed, continue with the
  rest, and exit with a non-zero code if any failed.
- **No eligible repos** → friendly "nothing to do" and exit 0.
- **Non-TTY environment** → detect and exit with a hint that `vizzy` is an
  interactive tool.

## Testing

- **Vitest** unit tests on `core/` (`filter`, `plan`) — pure, no mocks.
- Mocked-Octokit tests on `github.ts` (pagination, filtering, PATCH payload).
- `ink-testing-library` tests for list navigation and selection.
- Token-resolution tests for `auth.ts` (gh present / absent, env fallback).

## Build & distribution

- TypeScript, bundled with **tsup** to ESM `dist/`.
- `bin` field mapping `vizzy` → `dist/bin.js` with a `#!/usr/bin/env node`
  shebang; `engines.node >= 20`.
- Runnable via `npx vizzy-cli` with no global install.
- MIT license; README with an asciinema/GIF demo.
- CI: GitHub Actions running lint + test + build on push/PR.

## Open questions / future work

- Optional `gh` extension packaging (`gh vizzy`) once the CLI is stable.
- Optional secret-scan warning before exposing a repo publicly.
- Optional saved preferences (default forks/archived behavior).
