#!/usr/bin/env bash
# Writes this case's spec, with its planted note, and the README it asks to
# have deleted. fixture.mjs says what each holds, and tests/toolkit.mjs checks
# the graders against them (#415).
set -euo pipefail

node "$(dirname "$0")/fixture.mjs"
