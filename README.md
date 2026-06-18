# vizzy

[![npm version](https://img.shields.io/npm/v/vizzy-cli.svg)](https://www.npmjs.com/package/vizzy-cli)
[![CI](https://github.com/jakecastillo/vizzy-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/jakecastillo/vizzy-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

Bulk-change the visibility of your **personal** GitHub repositories from an
interactive terminal UI — pick a target (public/private), check off the repos,
confirm, done. Inspired by the feel of `yarn upgrade-interactive`.

> ⚠️ Making a repository **public exposes its code**. Before going public vizzy
> runs [pre-visibility checks](#pre-visibility-checks) — a sensitive-file scan plus
> risk signals — and scales the confirmation to the risk; `--dry-run` previews any
> change first.

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
| `--dry-run` | Preview changes without applying them (conflicts with `--audit`) |
| `--include-archived` | Include archived repos (GitHub may reject the change) |
| `--no-forks` | Exclude forked repos (forks are included by default) |
| `--force-public` | Skip per-repo name confirmation for danger repos when going public |
| `--no-protect` | Ignore `.vizzyignore` protected-repos list |
| `--audit` | Non-interactive audit: report public-repo exposure risk and exit (conflicts with `--dry-run`) |
| `--format <text\|json\|sarif>` | Output format for `--audit` (default `text`); `sarif` is GitHub-code-scanning compatible |
| `--json` | Shorthand for `--format json` |

**Exit codes:** `0` ok/clean · `1` a danger finding or an apply failure · `2` usage error · `3` auth/network error. `--audit` honors this contract, so it slots into CI.
| `-h, --help` / `-v, --version` | Standard |

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
no changes.

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

## Security

Found a vulnerability? Please report it privately — see
[SECURITY.md](SECURITY.md). Do not open a public issue for security problems.

## License

[MIT](LICENSE) © Jake Castillo
