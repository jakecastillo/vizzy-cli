# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-06-17

### Added

- **Pre-visibility checks** before any _public_ switch — making a repo public is a
  one-way door, so vizzy now runs a read-only pre-flight and scales the
  confirmation friction to the risk:
  - **Sensitive-file scan** of each selected repo's file tree (no code downloaded)
    flags expose-risk files — `.env`, private keys, `credentials*`, `.npmrc`,
    `service-account*.json`, etc. — while ignoring conventional samples like
    `.env.example`.
  - **Per-repo risk signals**: no `LICENSE`, stale (>1y since last push),
    high-profile (many stars), or archived.
  - **Escalating typed confirmation**: clean → `y`; caution → type `public`;
    danger (a likely secret) → type the repo's **name** to arm it, else it's
    skipped and left private. A failed/truncated scan degrades to _caution_
    (scan-incomplete), never a silent all-clear.
- **`.vizzyignore`** — a glob list of repos that may never be made public
  (hidden from the public selection); `--no-protect` ignores it for a run.
- **`--audit`** — non-interactive "what have I already exposed?" report over your
  currently-public repos; exits non-zero on any danger finding (CI-friendly).
- **`--force-public`** — pre-arm danger repos so you skip per-repo name-typing
  (you still type `public` to confirm the batch).

## [0.1.0] - 2026-06-17

### Added

- Initial release.
- Interactive TUI (Ink) to bulk-change the visibility of your personal GitHub
  repositories.
- Target-first flow: pick Private or Public, then choose from the repos that
  aren't already in that state.
- Multi-select list: `↑/↓` move, `space` toggle, `a` select-all, `enter` confirm.
- Loud confirmation when making repositories public; `--dry-run` to preview
  without applying.
- Flags: `--private`, `--public`, `--dry-run`, `--include-archived`,
  `--no-forks`, `--help`, `--version`.
- Auth via the `gh` CLI token, with `GH_TOKEN` / `GITHUB_TOKEN` fallback.
- Concurrency-limited apply step with per-repo success/failure reporting.

[Unreleased]: https://github.com/jakecastillo/vizzy-cli/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/jakecastillo/vizzy-cli/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jakecastillo/vizzy-cli/releases/tag/v0.1.0
