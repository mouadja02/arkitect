#!/usr/bin/env bash
# Builds the fixture this case reads. `scaffold_script` names a file inside the
# case directory, so this must stay a real script, not inline YAML.
set -euo pipefail

# The workspace cwd is the plugin root under `claude plugin eval`; fall back to
# the plugin root derived from this script's own location if it ever is not.
root="$PWD"
[ -d "$root/skills/arkitect-excalidraw" ] || root="$(cd "$(dirname "$0")/../../.." && pwd)"

mkdir -p eval-input
cp "$root/skills/arkitect-excalidraw/assets/templates/starter-architecture.excalidraw" eval-input/existing.excalidraw
cp "$root/skills/arkitect-excalidraw/references/source-analysis.json" eval-input/source-analysis.before.json
