#!/usr/bin/env bash
# Run the Arkitect eval suite, with the workarounds a run needs on this kind of
# machine already applied. Linux and macOS; on Windows, run it from WSL.
#
#   scripts/eval.sh --check                          prerequisites only, no spend
#   scripts/eval.sh --tag generation --runs 1 --model haiku
#   scripts/eval.sh --case 'drawio-*' --runs 2
#   scripts/eval.sh --tier 2 --baseline evals/scoreboard.json
#   scripts/eval.sh -- --keep-temp                   anything after -- goes to claude
#
# Results, the JSON, a one-screen summary with its scorecard, a scoreboard and
# each run's trace.jsonl land under evals/results/<stamp>/.
#
# They cost money: real agent runs and real LLM graders. Nothing here runs by
# default and every run is capped by --max-cost-usd.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

TAGS=(); CASE=""; RUNS=""; MODEL="haiku"; JUDGE="sonnet"; EFFORT="medium"
MAX_COST="5"; CONCURRENCY=2; SCAFFOLD=1; PREFLIGHT=1; OUT=""; CHECK_ONLY=0; PASSTHROUGH=()
BASELINE=""; TOLERANCE=""

die() { echo "error: $*" >&2; exit 2; }

usage() {
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'USAGE'

Options:
  --tag <tag>          only cases with this tag (repeatable)
  --tier <n>           only tier-<n> cases; the same as --tag tier-<n>
  --case <glob>        only cases whose name matches
  --runs <n>           runs per case (default: each case's own runs:)
  --model <model>      model under test (default haiku)
  --effort <level>     low, medium, high, xhigh or max (default medium; see below)
  --judge-model <m>    LLM-grader model (default sonnet; see below)
  --max-cost-usd <n>   hard ceiling, aborts past it (default 5)
  -j, --concurrency <n>  parallel agent runs (default 2)
  --no-scaffold        skip the cases' scaffold scripts
  --no-preflight       skip the one-case check that a case can write (see below)
  --out <dir>         results directory (default evals/results/<stamp>)
  --baseline <file>    compare with a scoreboard (evals/scoreboard.json) or a
                       result.json; a case further below it than the tolerance fails
  --tolerance <n>      how far below its baseline a case may score (default 0.2)
  --check              check prerequisites and exit
  -h, --help           this
  --                   pass everything after it to `claude plugin eval`

The judge defaults to sonnet deliberately. A haiku judge disagrees with itself
and with sonnet on identical output, in both directions - see #135.

The effort is medium unless told otherwise: Claude Code's own default on
Haiku, Sonnet and Opus, and the one a user gets. It is set, not left to the
default, so a default that moves or a CLAUDE_CODE_EFFORT_LEVEL in your shell
cannot move a score unseen; the summary and the scoreboard name it.

Before the suite, one haiku run of scripts/eval-preflight writes a file in its
working directory, for about a cent. If it cannot, nothing else runs and the
script exits 2: Claude Code 2.1.308 ran every case read-only, and a full run
then measured the sandbox, not the plugin.

The run fails if a tier-1 case scores below 1, a run errors, or a case falls
below its baseline; tiers 2 and 3 are expected below 1 (evals/README.md).
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --tag) [ $# -ge 2 ] || die "--tag needs a value"; TAGS+=("$2"); shift 2 ;;
    --tier) [ $# -ge 2 ] || die "--tier needs a value"; TAGS+=("tier-$2"); shift 2 ;;
    --case) [ $# -ge 2 ] || die "--case needs a value"; CASE="$2"; shift 2 ;;
    --runs) [ $# -ge 2 ] || die "--runs needs a value"; RUNS="$2"; shift 2 ;;
    --model) [ $# -ge 2 ] || die "--model needs a value"; MODEL="$2"; shift 2 ;;
    --effort) [ $# -ge 2 ] || die "--effort needs a value"; EFFORT="$2"; shift 2 ;;
    --judge-model) [ $# -ge 2 ] || die "--judge-model needs a value"; JUDGE="$2"; shift 2 ;;
    --max-cost-usd) [ $# -ge 2 ] || die "--max-cost-usd needs a value"; MAX_COST="$2"; shift 2 ;;
    -j|--concurrency) [ $# -ge 2 ] || die "--concurrency needs a value"; CONCURRENCY="$2"; shift 2 ;;
    --no-scaffold) SCAFFOLD=0; shift ;;
    --no-preflight) PREFLIGHT=0; shift ;;
    --out) [ $# -ge 2 ] || die "--out needs a value"; OUT="$2"; shift 2 ;;
    --baseline) [ $# -ge 2 ] || die "--baseline needs a value"; BASELINE="$2"; shift 2 ;;
    --tolerance) [ $# -ge 2 ] || die "--tolerance needs a value"; TOLERANCE="$2"; shift 2 ;;
    --check) CHECK_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; PASSTHROUGH=("$@"); break ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done
case "$EFFORT" in
  low|medium|high|xhigh|max) ;;
  *) die "--effort takes low, medium, high, xhigh or max, not $EFFORT" ;;
esac

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
# Under WSL a Windows install of Claude Code is on PATH from /mnt/c, and a shell
# that has not read ~/.profile finds it before ~/.local/bin. It cannot run a
# Linux sandbox: every scaffold failed on a \\wsl.localhost path (#369).
case "$(command -v claude 2>/dev/null)" in
  /mnt/[a-zA-Z]/*)
    printf 'MISSING %-20s %s\n' "linux claude" "found the Windows one at $(command -v claude); install Claude Code inside WSL (curl -fsSL https://claude.ai/install.sh | bash) and put ~/.local/bin first on PATH"
    missing=1 ;;
esac
need node "Node 22 or newer"
if have node; then
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "${major:-0}" -ge 22 ] || { printf 'MISSING %-20s %s\n' "node >= 22" "found $(node --version)"; missing=1; }
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
# Each run's trace.jsonl lives in a temp dir that `claude plugin eval` deletes
# unless told --keep-temp, so a reply a grader failed could not be read after
# the run (#374). The run keeps them in a TMPDIR of its own, the summary copies
# the traces out, and this removes the rest, a copy of the Claude config
# included. Its dirs are read-only, so they are made writable first. With
# --keep-temp passed after --, the kept dirs stay where they always did.
RUN_TMP="$SANDBOX_HOME/tmp"
mkdir -p "$RUN_TMP"
# Resuming a case's history.jsonl writes the continued session beside it, in
# the case folder, named for its session id (#418); that goes too.
cleanup() {
  chmod -R u+rwx "$RUN_TMP" 2>/dev/null; rm -rf "$SANDBOX_HOME"
  for h in "$ROOT"/evals/*/*/history.jsonl; do
    [ -e "$h" ] && find "$(dirname "$h")" -maxdepth 1 -name '????????-????-????-????-????????????.jsonl' -delete
  done
}
trap cleanup EXIT INT TERM
[ -e "$HOME/.claude" ] && ln -s "$HOME/.claude" "$SANDBOX_HOME/.claude"
[ -e "$HOME/.claude.json" ] && ln -s "$HOME/.claude.json" "$SANDBOX_HOME/.claude.json"
KEEP=0
for a in ${PASSTHROUGH+"${PASSTHROUGH[@]}"}; do [ "$a" = "--keep-temp" ] && KEEP=1; done

# ---------------------------------------------------------------- run

STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OUT="${OUT:-$ROOT/evals/results/$STAMP}"
mkdir -p "$OUT" || die "cannot create $OUT"

# Claude Code 2.1.308 ran every case in a sandbox whose working directory and
# TMPDIR were read-only: nothing a case built could be written, every Bash call
# reported exit 1, and a full Haiku run scored 0.69 on tier 1, where its board
# holds 1.00. One case that writes a file goes first, so a sandbox like that stops
# the run in a minute instead of after its spend. It always keeps its temp dir
# in RUN_TMP, where the summary finds the trace and cleanup removes it.
if [ "$PREFLIGHT" -eq 1 ]; then
  PRE="$OUT/preflight"
  mkdir -p "$PRE" || die "cannot create $PRE"
  pre=(plugin eval "$ROOT" --eval-dir scripts/eval-preflight
      --model haiku --ablation none --threshold 0 --runs 1 --max-cost-usd 0.25
      --allow-tools Bash --trust-plugin --no-publish --keep-temp
      --output-dir "$PRE" --json "$PRE/result.json" --report "$PRE/report.html")
  echo
  echo "preflight: can a case write its working directory? one haiku run, in $PRE"
  ( cd "$ROOT" && HOME="$SANDBOX_HOME" TMPDIR="$RUN_TMP" CLAUDE_CODE_EFFORT_LEVEL="$EFFORT" claude "${pre[@]}" ) > "$PRE/run.log" 2>&1
  if node "$HERE/eval-summary.mjs" "$PRE/result.json" --traces "$PRE/traces" --effort "$EFFORT" > "$PRE/summary.txt" 2>&1; then
    echo "preflight: ok"
  elif grep -qs 'Read-only file system' "$PRE"/traces/*.jsonl; then
    die "a case cannot write its own working directory: this Claude Code runs eval cases read-only (2.1.308 does, 2.1.302 does not; evals/README.md), so every case that builds a file would fail for that. The suite was not run; the check is in $PRE"
  else
    why="$(grep -m1 -E '^ +(ERROR|CRIT|FAIL)' "$PRE/summary.txt" 2>/dev/null | sed 's/^ *//')"
    die "the preflight case did not pass, so the suite was not run${why:+: $why}. See $PRE/summary.txt and run.log, or skip it with --no-preflight"
  fi
fi

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
if [ "$KEEP" -eq 0 ]; then args+=(--keep-temp); run_tmp="$RUN_TMP"; else run_tmp="${TMPDIR:-/tmp}"; fi

# `claude plugin eval` takes no --effort, and ignores one given before
# `plugin`: the variable is the one route that reaches its runs.
echo
echo "running: CLAUDE_CODE_EFFORT_LEVEL=$EFFORT claude ${args[*]}"
echo "results: $OUT"
echo
( cd "$ROOT" && HOME="$SANDBOX_HOME" TMPDIR="$run_tmp" CLAUDE_CODE_EFFORT_LEVEL="$EFFORT" claude "${args[@]}" ) 2>&1 | tee "$OUT/run.log"
status=${PIPESTATUS[0]}

# ---------------------------------------------------------------- summary

# The run is passed --threshold 0, so its own status says only whether it ran.
# Whether it passed is the summary's: 1 for a tier-1 case below 1, an errored
# run or a case below its baseline, 2 for a result it cannot read. Exiting with the run's status reported 0 for a
# batch whose every run errored (#369).
# A missing baseline is a typo, not a reason to throw the run's spend away.
if [ -n "$BASELINE" ] && [ ! -f "$BASELINE" ]; then echo "no baseline at $BASELINE; summarising without one" >&2; BASELINE=""; fi
summary=("$OUT/result.json" --traces "$OUT/traces" --scoreboard "$OUT/scoreboard.json" --effort "$EFFORT")
[ -n "$BASELINE" ] && summary+=(--baseline "$BASELINE")
[ -n "$TOLERANCE" ] && summary+=(--tolerance "$TOLERANCE")
if [ -f "$OUT/result.json" ]; then
  node "$HERE/eval-summary.mjs" "${summary[@]}" | tee "$OUT/summary.txt"
  verdict=${PIPESTATUS[0]}
else
  echo "no result.json was written; see $OUT/run.log" >&2
  verdict=2
fi
[ "$verdict" -ne 0 ] || verdict=$status

echo
echo "eval exit status: $verdict (claude plugin eval exited $status)"
exit $verdict
