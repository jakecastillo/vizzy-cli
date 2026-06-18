# vizzy

[![npm version](https://img.shields.io/npm/v/vizzy-cli.svg)](https://www.npmjs.com/package/vizzy-cli)
[![CI](https://github.com/jakecastillo/vizzy-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/jakecastillo/vizzy-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

**Flip the visibility of your GitHub repos in bulk, right from your terminal —
and scan every repo for exposed secrets _before_ it goes public.** Pick a target
(public/private), check off the repos, confirm, done — with the feel of `yarn
upgrade-interactive`.

One careless "make public" can leak an API key forever. So before vizzy switches a
repo to public it runs [pre-visibility checks](#pre-visibility-checks) — a
sensitive-file scan plus risk signals — and scales the confirmation friction to
what it finds. It also audits what you've **already** exposed and runs headless in
CI. `--dry-run` previews any change first.

## Demo

vizzy leads with the safety story — it automatically **skips a DANGER repo**
(a detected secret) before going public, then drops into the interactive TUI to
flip the rest.

_To generate the animated demo locally, run `bash scripts/render-demo.sh` (requires
[vhs](https://github.com/charmbracelet/vhs)); it renders `demo/vizzy.gif` from
[`demo/vizzy.tape`](demo/vizzy.tape)._

## Install

| Method | Command |
|---|---|
| **npx** (no install) | `npx vizzy-cli` |
| **npm global** | `npm i -g vizzy-cli` |

> **Planned, not yet published:** a `gh` extension
> (`gh extension install jakecastillo/gh-vizzy`) and a Homebrew formula
> (`brew install vizzy-cli`). Until those land, install via **npx** or **npm**
> above — see [Install as a gh extension](#install-as-a-gh-extension) for status.

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

**Target & selection**

| Flag | Effect |
|---|---|
| `--private` / `--public` | Preselect the target and skip step 1 |
| `--include-archived` | Include archived repos (GitHub may reject the change) |
| `--no-forks` | Exclude forked repos (forks are included by default) |
| `--no-protect` | Ignore the `.vizzyignore` protected-repos list |
| `--dry-run` | Preview changes without applying them (conflicts with `--audit`) |
| `--force-public` | Pre-arm danger repos so you skip per-repo name-typing (you still type `public`) |

**Headless / scripting** (run without the TUI; see [Scripting](#scripting--ci))

| Flag | Effect |
|---|---|
| `--repos <list>` | Target repos by name: `a,b,c`, `@file` (one name per line), or `-` for stdin |
| `--all-eligible` | Select every eligible repo |
| `--yes` | Apply caution-level repos without interactive confirmation |
| `--allow-danger` | Also apply danger repos (bypass the skip-and-report guard) |

**Audit & exposure** (read-only)

| Flag | Effect |
|---|---|
| `--audit` | Report exposure risk over your currently-public repos and exit (conflicts with `--dry-run`) |
| `--org <name>` | Audit a GitHub org instead of your personal repos (read-only; conflicts with `--public`/`--private`) |
| `--fail-on-new` | With `--audit`: exit non-zero only on NEW exposure vs the last `.vizzy/state.json` snapshot |
| `--format <text\|json\|sarif>` | `--audit` output format (default `text`); `sarif` is GitHub Code Scanning-compatible (upload it via the [Action](#github-action) or `upload-sarif`) |
| `--json` | Shorthand for `--format json` |
| `--check [owner/repo]` | Pre-publish readiness for ONE repo (secrets in tree + content + history, LICENSE, docs, large files); infers the repo from the cwd git remote if omitted |

**Archive**

| Flag | Effect |
|---|---|
| `--archive` / `--unarchive` | Bulk archive / unarchive selected repos (no exposure scan; conflicts with `--public`/`--private`) |

**Output**

| Flag | Effect |
|---|---|
| `--plain` | Accessible plain mode: no ANSI color, static text instead of spinners (also honored via `NO_COLOR`) |
| `-h, --help` / `-v, --version` | Standard |

**Exit codes:** `0` ok/clean · `1` a danger finding or an apply failure · `2` usage error · `3` auth/network error. `--audit`, `--check`, and headless apply all honor this contract, so they slot into CI.

## Scripting & CI

vizzy runs headless (no TUI) when you pass a selector — handy for cron jobs,
pre-publish gates, and onboarding scripts. The exposure scan still runs: clean
repos apply, but a repo with a **detected secret is skipped and reported** unless
you explicitly pass `--allow-danger` (or `--force-public`).

```bash
# Make a named set public, non-interactively (danger repos are skipped + reported):
vizzy --public --repos api,docs,site --yes

# Everything eligible, from a file, with machine-readable output:
vizzy --private --repos @repos.txt --yes --json

# "What have I already exposed?" — exits non-zero on a danger finding:
vizzy --audit --format sarif > results.sarif

# Pre-publish readiness for the repo in the current directory:
vizzy --check
```

For a ready-made GitHub Action, see [GitHub Action](#github-action).

## How it works

vizzy reads the repos you **own** (via `affiliation: owner`), filters to those
not already in your chosen state, and changes visibility through the GitHub REST
API (`PATCH /repos/{owner}/{repo}`), applying changes a few at a time. Your token
is read from the `gh` CLI (or the env vars) and is never logged or written to
disk. Organization repos, the `internal` visibility level, and archived-repo
changes are out of scope.

## Pre-visibility checks

Making a repo **public is a one-way door** — once it's cloned, forked, or indexed
you can't truly take it back. So before vizzy applies a _public_ switch, it runs a
read-only pre-flight on the repos you selected and scales the confirmation friction
to what it finds:

- **Sensitive-file scan.** vizzy fetches each repo's file tree (no code is
  downloaded) and flags expose-risk files — `.env`, private keys (`*.pem`,
  `id_rsa`, `*.key`…), `credentials*`, `.npmrc`, `service-account*.json`, and the
  like. Conventional samples such as `.env.example` are ignored.
- **Risk signals.** It also surfaces "are you sure about _this_ one?" context: no
  `LICENSE` (public without a license is all-rights-reserved), a repo not pushed to
  in over a year, a high-profile repo (lots of stars), or an archived repo.
- **Escalating confirmation.** Friction matches the risk:
  - **clean** repo → a single `y`.
  - **caution** (risk signals) → type `public` to confirm.
  - **danger** (a likely secret) → type the repo's **name** to arm it; unarmed
    danger repos are skipped and left private. `--force-public` pre-arms danger
    repos so you don't type each name — you still type `public` to confirm the batch.
- A failed or truncated scan never silently green-lights a repo — it's marked
  _caution_ (scan-incomplete), so a network blip can't lower your guard.

### `.vizzyignore`

Repos that must **never** be made public can be pinned in a `.vizzyignore` file in
the directory you run vizzy from — one glob per line (`#` comments allowed):

```
# never expose these
dotfiles
*-secrets
client-*
```

Matching repos are hidden from the public selection (you can still make them
private). Pass `--no-protect` to ignore the file for a run.

### Audit mode

```bash
vizzy --audit
```

Runs the same checks non-interactively over your **currently-public** repos — a
"what have I already exposed?" report — and exits non-zero if any repo has a
danger-level finding, so you can wire it into CI or a pre-publish check. It makes
no changes on GitHub (it writes only a local `.vizzy/state.json` snapshot for
drift detection — add it to `.gitignore` if you don't want it tracked).

## Install as a gh extension

[gh extensions](https://cli.github.com/manual/gh_extension) let you run vizzy
directly through the `gh` CLI:

```bash
# After the gh-vizzy repo is published (manual step — see note below):
gh extension install jakecastillo/gh-vizzy

# Then run:
gh vizzy --audit
gh vizzy --public
```

> **Note:** The `gh-extension/gh-vizzy` shim lives in this repo, but gh
> extensions require a *separate* public repository named `gh-vizzy`.
> Splitting and publishing that repo is a manual remote step left for a human
> operator; the shim file itself is committed here for review.

## GitHub Action

Use vizzy as a [composite GitHub Action](action.yml) to run an exposure audit
in CI and upload SARIF results to GitHub Code Scanning:

```yaml
# .github/workflows/exposure-audit.yml
name: Exposure audit
on:
  schedule:
    - cron: '0 8 * * 1'   # every Monday

permissions:
  contents: read
  security-events: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: jakecastillo/vizzy-cli@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          format: sarif        # default — uploads to Code Scanning
```

See [`examples/exposure-audit.yml`](examples/exposure-audit.yml) for the full
sample workflow including the schedule + PR triggers.

**Inputs**

| Input | Required | Default | Description |
|---|---|---|---|
| `github-token` | yes | — | Token used to list repositories |
| `format` | no | `sarif` | Output format: `sarif`, `json`, or `text` |

The action exits non-zero when any danger-level finding is detected, so it
slots naturally into branch protection or required status checks.

## Development

Requires **Node.js ≥ 20**.

```bash
git clone https://github.com/jakecastillo/vizzy-cli.git
cd vizzy-cli
npm install

npm test          # run the suite (Vitest)
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npm run build     # tsup -> dist/bin.js
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the project layout and workflow.

## Contributing

Contributions are welcome — bugs, docs, tests, and features alike! Start with
the [contributing guide](CONTRIBUTING.md), and please open an issue before large
changes. Good first issues are labeled
[`good first issue`](https://github.com/jakecastillo/vizzy-cli/labels/good%20first%20issue).

- 🐛 [Report a bug](https://github.com/jakecastillo/vizzy-cli/issues/new?template=bug_report.yml)
- 💡 [Request a feature](https://github.com/jakecastillo/vizzy-cli/issues/new?template=feature_request.yml)
- 💬 [Ask in Discussions](https://github.com/jakecastillo/vizzy-cli/discussions)

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By participating,
you agree to uphold it.

## Trust & safety

**License.** vizzy-cli is [MIT licensed](LICENSE). Use it, fork it, ship it.

**Token handling.** Your GitHub token is read from the `gh` CLI (`gh auth token`)
or the `GH_TOKEN` / `GITHUB_TOKEN` environment variables. It is passed directly to
the Octokit client and is never logged, written to disk, or included in any
output. You can verify this in [`src/auth.ts`](src/auth.ts) and
[`src/github.ts`](src/github.ts).

**No telemetry.** vizzy makes no analytics or telemetry calls. The only network
traffic is to `api.github.com` via the official Octokit REST client.

**Safe-by-default flags.**
- `--dry-run` previews every change without touching GitHub — nothing is applied.
- `--audit` and `--check` make **no changes on GitHub** — they only fetch repo
  metadata and file trees. (`--audit` does write a local `.vizzy/state.json`
  snapshot for drift detection; nothing is sent anywhere.)

### Least-privilege PAT

**Already using the `gh` CLI?** Run `gh auth login` once and you are done —
vizzy reuses the token the `gh` CLI already holds. No PAT needed.

If you prefer a dedicated PAT, use a **fine-grained personal access token** scoped
to only the repositories you want to manage:

| Permission | Level |
|---|---|
| **Administration** | Read and write |

That is the only permission required. Scoping it to selected repositories limits
the blast radius further.

_Contrast with the classic `repo` scope_, which grants broad read/write access to
**all** of your repositories (code, issues, PRs, secrets). The fine-grained path
is strictly narrower.

## Security

Found a vulnerability? Please report it privately — see
[SECURITY.md](SECURITY.md). Do not open a public issue for security problems.

## License

[MIT](LICENSE) © Jake Castillo
