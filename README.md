# vizzy

[![npm version](https://img.shields.io/npm/v/vizzy-cli.svg)](https://www.npmjs.com/package/vizzy-cli)
[![CI](https://github.com/jakecastillo/vizzy-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/jakecastillo/vizzy-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

Bulk-change the visibility of your **personal** GitHub repositories from an
interactive terminal UI — pick a target (public/private), check off the repos,
confirm, done. Inspired by the feel of `yarn upgrade-interactive`.

> ⚠️ Making a repository **public exposes its code**. vizzy always shows a loud
> confirmation before going public, and `--dry-run` lets you preview any change
> first.

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

## How it works

vizzy reads the repos you **own** (via `affiliation: owner`), filters to those
not already in your chosen state, and changes visibility through the GitHub REST
API (`PATCH /repos/{owner}/{repo}`), applying changes a few at a time. Your token
is read from the `gh` CLI (or the env vars) and is never logged or written to
disk. Organization repos, the `internal` visibility level, and archived-repo
changes are out of scope.

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
