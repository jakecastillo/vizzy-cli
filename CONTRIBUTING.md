# Contributing to vizzy

Thanks for your interest in improving vizzy! This project is a small, focused
TypeScript CLI, and contributions of all sizes are welcome — bug reports, docs,
tests, and features.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- 🐛 **Report a bug** — open an issue with the *Bug report* template.
- 💡 **Request a feature** — open an issue with the *Feature request* template.
- 📖 **Improve docs** — typo fixes and clarifications are great first PRs.
- 🧪 **Add tests** — coverage for edge cases is always welcome.
- 🔧 **Fix or build** — grab an open issue (look for `good first issue`).

If you're planning a large change, please open an issue first so we can agree on
the approach before you invest the time.

## Development setup

Requires **Node.js ≥ 20**.

```bash
git clone https://github.com/jakecastillo/vizzy-cli.git
cd vizzy-cli
npm install
```

### Common commands

| Command | What it does |
|---|---|
| `npm test` | Run the test suite (Vitest) |
| `npm run test:watch` | Tests in watch mode |
| `npm run typecheck` | Type-check with `tsc --noEmit` |
| `npm run lint` | Lint with ESLint |
| `npm run build` | Bundle to `dist/bin.js` (tsup) |
| `node dist/bin.js --dry-run` | Run the built CLI locally (use a real terminal) |

vizzy is an interactive TUI, so run it in a real terminal. Always test with
`--dry-run` first — a real run changes repository visibility.

## Project structure

```
src/
  types.ts            Shared domain types
  auth.ts             Token resolution (gh CLI -> env)
  github.ts           Octokit wrapper (list, set visibility, error mapping)
  apply.ts            Concurrency-limited apply step
  cli.ts              Flag parsing (commander)
  core/               Pure logic: filter.ts, plan.ts (no I/O — fully unit-tested)
  ui/                 Ink components + App state machine
  bin.tsx             Executable entry point
```

The pure logic in `core/` and the I/O modules are dependency-injected, so most
behavior is testable without the network or a terminal.

## Workflow

1. **Fork** the repo and create a branch off `main`:
   `git checkout -b feat/short-description`
2. **Write a test first.** This project is test-driven — add a failing test that
   encodes the behavior, then make it pass.
3. **Keep the gate green** before pushing:
   ```bash
   npm run lint && npm run typecheck && npm test && npm run build
   ```
4. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` a new feature
   - `fix:` a bug fix
   - `docs:` documentation only
   - `test:` adding or fixing tests
   - `chore:` / `build:` / `refactor:` tooling and internals
5. **Open a Pull Request** against `main`. Fill in the PR template, link any
   related issue, and describe what you changed and how you verified it.

CI runs lint, typecheck, tests, and build on Node 20 and 22 — your PR needs all
of them green to merge.

## Code style

- TypeScript, ESM (`"type": "module"`). Relative imports use a `.js` extension.
- Keep modules small and single-purpose; keep pure logic in `core/` free of I/O.
- Match the style of the surrounding code; let ESLint and the formatter guide you.

## Reporting security issues

Please do **not** open public issues for security vulnerabilities — see
[SECURITY.md](SECURITY.md) for private reporting.

## License

By contributing, you agree that your contributions will be licensed under the
project's [MIT License](LICENSE).
