#!/usr/bin/env bash
# Writes this case's spec, which the builder refuses. fixture.mjs says why,
# and tests/toolkit.mjs checks the refusal and the graders (#415).
set -euo pipefail

node "$(dirname "$0")/fixture.mjs"
