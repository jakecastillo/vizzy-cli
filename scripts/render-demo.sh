#!/usr/bin/env bash
# render-demo.sh — render the vizzy demo GIF using VHS
#
# Usage (run from the repo root):
#   bash scripts/render-demo.sh
#
# Requires:
#   - vhs (https://github.com/charmbracelet/vhs) installed and on PATH
#   - A valid GITHUB_TOKEN (or gh CLI session) for the recording session
#
# Output:
#   demo/vizzy.gif  (overwritten if it already exists)
#
# This script is meant to be run manually or in a dedicated CI job that has
# vhs installed.  It is NOT executed during npm test / npm run build.
#
# Example CI usage (GitHub Actions):
#   - uses: charmbracelet/vhs-action@v2
#     with:
#       path: demo/vizzy.tape

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if ! command -v vhs &>/dev/null; then
  echo "ERROR: vhs is not installed or not on PATH." >&2
  echo "Install it from https://github.com/charmbracelet/vhs" >&2
  exit 1
fi

echo "Rendering demo/vizzy.tape -> demo/vizzy.gif"
vhs "${REPO_ROOT}/demo/vizzy.tape"
echo "Done. GIF written to demo/vizzy.gif"
