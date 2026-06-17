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
