#!/usr/bin/env bash
# Builds this case's fixture with the real builder, then saves it the way
# Draw.io Desktop does. fixture.mjs says what it holds, and tests/toolkit.mjs
# checks the graders against it (#415).
set -euo pipefail

node "$(dirname "$0")/fixture.mjs"
