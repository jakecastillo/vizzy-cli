# vizzy demo — core flow with safety-skip leading
# Record with: vhs demo/vizzy.tape  (or: bash scripts/render-demo.sh)
# Requires: vhs (https://github.com/charmbracelet/vhs) + a live GITHUB_TOKEN

Output demo/vizzy.gif

Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 600
Set Theme "Dracula"

# ---------------------------------------------------------------------------
# Scene 1: safety skip — a DANGER repo is detected and left private
# ---------------------------------------------------------------------------
# Comment shown as title card
Type "# vizzy safety: DANGER repos are skipped automatically"
Sleep 1s

# Run vizzy in headless audit mode to show the danger finding
Type "GITHUB_TOKEN=$GITHUB_TOKEN vizzy --audit --format text"
Enter
Sleep 3s

# ---------------------------------------------------------------------------
# Scene 2: headless apply — clean repos go public, danger repo is skipped
# ---------------------------------------------------------------------------
Sleep 1s
Type "# Run headless: safe repos go public; DANGER repo stays private (skipped)"
Sleep 500ms
Enter
Sleep 500ms

Type "GITHUB_TOKEN=$GITHUB_TOKEN vizzy --public --all-eligible --yes"
Enter
Sleep 4s

# ---------------------------------------------------------------------------
# Scene 3: interactive TUI — standard usage
# ---------------------------------------------------------------------------
Sleep 1s
Type "# Interactive TUI — choose target, pick repos, confirm"
Sleep 500ms
Enter
Sleep 500ms

Type "GITHUB_TOKEN=$GITHUB_TOKEN vizzy --private"
Enter
Sleep 2s

# Navigate and confirm
Key Down
Sleep 300ms
Key Space
Sleep 300ms
Key Enter
Sleep 1s
Type "y"
Enter
Sleep 2s

Sleep 1s
