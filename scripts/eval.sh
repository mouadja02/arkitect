#!/usr/bin/env bash
# Run the Arkitect eval suite, with the workarounds a run needs on this kind of
# machine already applied. Linux and macOS; on Windows, run it from WSL.
#
#   scripts/eval.sh --check                          prerequisites only, no spend
#   scripts/eval.sh --tag generation --runs 1 --model haiku
#   scripts/eval.sh --case 'drawio-*' --runs 2
#   scripts/eval.sh -- --keep-temp                   anything after -- goes to claude
#
# Results, the JSON and a one-screen summary land under evals/results/<stamp>/.
#
# They cost money: real agent runs and real LLM graders. Nothing here runs by
# default and every run is capped by --max-cost-usd.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

TAGS=(); CASE=""; RUNS=""; MODEL="haiku"; JUDGE="sonnet"
MAX_COST="5"; CONCURRENCY=2; SCAFFOLD=1; OUT=""; CHECK_ONLY=0; PASSTHROUGH=()

die() { echo "error: $*" >&2; exit 2; }

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'USAGE'

Options:
  --tag <tag>          only cases with this tag (repeatable)
  --case <glob>        only cases whose name matches
  --runs <n>           runs per case (default: each case's own runs:)
  --model <model>      model under test (default haiku)
  --judge-model <m>    LLM-grader model (default sonnet; see below)
  --max-cost-usd <n>   hard ceiling, aborts past it (default 5)
  -j, --concurrency <n>  parallel agent runs (default 2)
  --no-scaffold        skip the cases' scaffold scripts
  --out <dir>          results directory (default evals/results/<stamp>)
  --check              check prerequisites and exit
  -h, --help           this
  --                   pass everything after it to `claude plugin eval`

The judge defaults to sonnet deliberately. A haiku judge disagrees with itself
and with sonnet on identical output, in both directions - see #135.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --tag) [ $# -ge 2 ] || die "--tag needs a value"; TAGS+=("$2"); shift 2 ;;
    --case) [ $# -ge 2 ] || die "--case needs a value"; CASE="$2"; shift 2 ;;
    --runs) [ $# -ge 2 ] || die "--runs needs a value"; RUNS="$2"; shift 2 ;;
    --model) [ $# -ge 2 ] || die "--model needs a value"; MODEL="$2"; shift 2 ;;
    --judge-model) [ $# -ge 2 ] || die "--judge-model needs a value"; JUDGE="$2"; shift 2 ;;
    --max-cost-usd) [ $# -ge 2 ] || die "--max-cost-usd needs a value"; MAX_COST="$2"; shift 2 ;;
    -j|--concurrency) [ $# -ge 2 ] || die "--concurrency needs a value"; CONCURRENCY="$2"; shift 2 ;;
    --no-scaffold) SCAFFOLD=0; shift ;;
    --out) [ $# -ge 2 ] || die "--out needs a value"; OUT="$2"; shift 2 ;;
    --check) CHECK_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; PASSTHROUGH=("$@"); break ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

# ---------------------------------------------------------------- prerequisites

missing=0
have() { command -v "$1" >/dev/null 2>&1; }
need() {
  if have "$1"; then printf 'ok    %-22s %s\n' "$1" "$(command -v "$1")"
  else printf 'MISSING %-20s %s\n' "$1" "$2"; missing=1; fi
}
optional() {
  if have "$1"; then printf 'ok    %-22s %s\n' "$1" "$(command -v "$1")"
  else printf 'warn  %-22s %s\n' "$1" "$2"; fi
}

case "$(uname -s)" in
  Linux|Darwin) ;;
  *) die "this runs on Linux or macOS. On Windows use WSL: every Bash-granting
       case is refused there with \"the Windows sandbox is not active on this
       session\". See evals/README.md." ;;
esac

echo "prerequisites"
need claude "install Claude Code, and log in once"
need node "Node 20 or newer"
if have node; then
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "${major:-0}" -ge 20 ] || { printf 'MISSING %-20s %s\n' "node >= 20" "found $(node --version)"; missing=1; }
fi
if [ "$(uname -s)" = "Linux" ]; then
  need bwrap "the sandbox backend: apt install bubblewrap"
  need socat "the sandbox needs it too: apt install socat"
fi
optional xvfb-run "Draw.io renders headless through it: apt install xvfb"
optional drawio "Draw.io Desktop, for .drawio PNG renders"
if have google-chrome || have chromium || have chromium-browser || have microsoft-edge; then
  printf 'ok    %-22s %s\n' "chrome/chromium" "for Excalidraw PNG renders"
else
  printf 'warn  %-22s %s\n' "chrome/chromium" "Excalidraw falls back to SVG without one"
fi

# The sandbox refuses to start when the Docker credential store holds a symlink
# inside it, which Docker Desktop's WSL integration always creates (contexts,
# features.json). Setting DOCKER_CONFIG elsewhere does not help: ~/.docker is
# read either way. An isolated HOME sidesteps it without touching the real one.
if [ -d "$HOME/.docker" ] && [ -n "$(find "$HOME/.docker" -maxdepth 2 -type l 2>/dev/null)" ]; then
  echo "note  ~/.docker holds a symlink (Docker Desktop); the run uses an isolated HOME"
fi

[ "$missing" -eq 0 ] || die "install what is missing above, then re-run"
if [ "$CHECK_ONLY" -eq 1 ]; then echo; echo "all required prerequisites are present"; exit 0; fi

# ---------------------------------------------------------------- isolated HOME

# Only the two paths Claude Code needs to know who you are. Nothing else from
# the real home is visible, so ~/.docker is simply not there to be refused.
SANDBOX_HOME="$(mktemp -d "${TMPDIR:-/tmp}/arkitect-eval-home.XXXXXX")"
cleanup() { rm -rf "$SANDBOX_HOME"; }
trap cleanup EXIT INT TERM
[ -e "$HOME/.claude" ] && ln -s "$HOME/.claude" "$SANDBOX_HOME/.claude"
[ -e "$HOME/.claude.json" ] && ln -s "$HOME/.claude.json" "$SANDBOX_HOME/.claude.json"

# ---------------------------------------------------------------- run

STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OUT="${OUT:-$ROOT/evals/results/$STAMP}"
mkdir -p "$OUT" || die "cannot create $OUT"

args=(plugin eval "$ROOT"
  --model "$MODEL" --judge-model "$JUDGE"
  --ablation none --threshold 0
  --max-cost-usd "$MAX_COST" -j "$CONCURRENCY"
  --allow-tools Bash Write Edit WebSearch WebFetch
  --trust-plugin --no-publish
  --json "$OUT/result.json" --report "$OUT/report.html")
# Without --runs each case keeps its own `runs:`. Forcing a default here would
# silently flatten the generation and icon cases' three runs to one, which is
# the spread #135 relies on to show a flapping judge.
[ -n "$RUNS" ] && args+=(--runs "$RUNS")
[ "$SCAFFOLD" -eq 1 ] && args+=(--scaffold)
[ -n "$CASE" ] && args+=(--case "$CASE")
for t in ${TAGS+"${TAGS[@]}"}; do args+=(--tag "$t"); done
args+=(${PASSTHROUGH+"${PASSTHROUGH[@]}"})

echo
echo "running: claude ${args[*]}"
echo "results: $OUT"
echo
( cd "$ROOT" && HOME="$SANDBOX_HOME" claude "${args[@]}" ) 2>&1 | tee "$OUT/run.log"
status=${PIPESTATUS[0]}

# ---------------------------------------------------------------- summary

if [ -f "$OUT/result.json" ]; then
  node "$HERE/eval-summary.mjs" "$OUT/result.json" | tee "$OUT/summary.txt"
else
  echo "no result.json was written; see $OUT/run.log" >&2
fi

echo
echo "eval exit status: $status"
exit $status
