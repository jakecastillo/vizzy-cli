# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/jakecastillo/vizzy-cli/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jakecastillo/vizzy-cli/releases/tag/v0.1.0
