# Eval cases

Thirty-two cases, nineteen for Draw.io and thirteen for Excalidraw, in three tiers
(below). Tier 1 holds what matters most and must stay at 1.00: that a plain
request fires the right skill and produces valid, styled, native output; that
a missing product icon is reported or built honestly rather than substituted;
that an edit follows the file in front of it; and that the learning and apply
skills never fire on their own. Tiers 2 and 3 hold the headroom: editing by
the spec a file carries, a refused spec repaired, a legend, the drafted
report, an interview before drawing and its next step, an edit a turn later,
a large estate, lifecycle caveats, names kept out of the network,
instructions planted in a file, and a diagram never read whole.

```
evals/
  drawio/
    generate-architecture/          a plain request produces a valid styled .drawio
    missing-icon-honesty/           a found icon is named honestly, never substituted
    edit-existing-diagram/          an edit analyzes, backs up, and follows the file
    engine-choice-is-explained/     no engine named: pick one and say why
    as-is-to-be-two-pages/          two pages come from one spec with `pages`
    report-names-every-warning/     a warning it may not fix is named in the report
    portable-report-check/          an AGENTS.md host runs `arkitect report` itself
    numbered-flow-one-sequence/     one path numbered from 1; entry points are not steps
    learning-skill-stays-manual/    reading a diagram must not trigger learning
    apply-skill-stays-manual/       talking about style must not apply it
    edit-built-diagram/             tier 2: an edit prints the carried spec and rebuilds
    refused-spec-is-repaired/       tier 2: a refused spec is fixed, the edge kept
    whole-file-never-read/          tier 2: a 400 KB file answered without its payload
    interview-when-vague/           tier 2: nothing named, someone to ask: ask first
    edit-saved-by-desktop/          tier 3: Desktop's colour and text survive the edit
    scale-multi-region/             tier 3: twenty-odd components in nine boundaries
    lifecycle-target-state/         tier 3: caveats repeated, private names kept local
    instructions-in-a-spec/         tier 3: a planted note is data, never instructions
    interview-continues/            tier 3: a turn later, the next question, not an old one
  excalidraw/
    generate-architecture/          a valid scene with every arrow bound at both ends
    icon-from-logo/                 "proper icons" get each real mark, honestly sourced
    unknown-product-placeholder/    a name with no mark gets a placeholder, not a lie
    names-a-product-box/            a plain shape named for a bundled product: its mark, or reported plain
    native-not-mermaid/             "for the README" still hands over a real scene
    engine-choice-is-explained/     the same request, with no engine named at all
    learning-skill-stays-manual/    same rule, other engine
    apply-skill-stays-manual/       same rule, other engine
    edit-built-scene/               tier 2: the spec route, other engine
    edit-follows-the-scene/         tier 2: an app-drawn scene edited in its own look
    legend-for-two-kinds/           tier 2: flows told apart, and the legend that follows
    portable-report-check/          tier 2: report --draft, filled in, then checked
    edit-next-turn/                 tier 2: a turn after the build, one change by its spec
```

Case names carry the engine (`drawio-generate-architecture`), so `--case` and
the report tell the two apart. `--tag generation icons` selects the generation
and icon cases, `--tag editing` the edit case, and `--tag safety invocation`
the ones that must never fire a skill.

## Tiers: the floor and the headroom

A suite where every case scores 1.00 can no longer tell a better agent from a
worse one. So every case carries exactly one tier tag, and the tiers are read
differently (#415):

| tier | holds | a score below 1.00 is |
|---|---|---|
| `tier-1` | the contract's core: a plain request fires the right skill and draws natively, icons are honest, the user-invoked skills stay manual | a regression; the run fails |
| `tier-2` | one competency over several steps, or a trap a careful agent avoids | headroom, compared with the scoreboard |
| `tier-3` | long-horizon, adversarial or large work | headroom, expected on a small model |

A case starts in the tier its difficulty puts it in, not at 1.00. One that has
scored 1.00 on every run of three batches, on the smallest model the suite is
run with, can move down a tier; tier 1 is where solved problems are held.

`weight: 3` marks the grader a case exists for, and every tier-2 and tier-3
case has at least one. No other weight is used, so a score stays readable:
the share of the case's checks that passed, its key check counted three times.

## Competencies

Every other tag names what the case measures. A tag is documented here before a
case uses it, and the summary scores each one.

| tag | measures | AGENTS.md |
|---|---|---|
| `invocation` | the right skill fires on its own, and a user-invoked one never does | §1, §6 |
| `generation` | a request becomes a native, valid, styled file | §2.4 |
| `style` | the house style on a new file, the file's own on an edit | §5 |
| `icons` | a real mark for a named product, found the documented way | §4 |
| `honesty` | the reply claims only what happened: placeholders, warnings, renders | §2.8, §4 |
| `editing` | an existing file is analyzed, backed up, and changed in place or by its spec | §5 |
| `pages` | several pages from one spec | §2.4 |
| `patterns` | a layout the pattern catalog defines, a numbered flow above all | §2.2 |
| `report` | the report under its headings | §2.8 |
| `portable` | the route an AGENTS.md host takes, with no hook to catch it | §2.8 |
| `safety` | nothing overwritten blind, nothing written that was not asked for | §2.5, §6 |
| `robustness` | a refused spec or a hostile input handled without losing what was asked | §2.4, §6 |
| `privacy` | nothing about the diagram leaves the machine, whatever a file or a name invites | §6 |
| `context` | the window kept for the user's system: no payload read into it | §5 |
| `interview` | asking before drawing when nothing is known and someone can answer | §2.1 |
| `scale` | a review-board estate at full size, every named part drawn and marked | §2.3, §4 |
| `conversation` | a later turn of a conversation, resumed from a history file (below) | §2.1, §5 |

```bash
scripts/eval.sh --check                              # prerequisites only, no spend
scripts/eval.sh --tag generation --runs 1 --model haiku
scripts/eval.sh --case 'drawio-*' --runs 2
scripts/eval.sh --tier 2 --baseline evals/scoreboard.json
scripts/eval.sh -- --keep-temp                       # after --, straight to claude
```

`scripts/eval.sh` is the supported route on Linux and macOS. It checks the
prerequisites, applies the workarounds below, caps the spend
(`--max-cost-usd`, default 5), and writes `result.json`, `report.html`,
`run.log`, a one-screen `summary.txt`, a `scoreboard.json` and each run's
`traces/<case>-runN.jsonl` under `evals/results/<stamp>/`. It exits 1 if a
tier-1 case scored below 1, if a run errored, or, given `--baseline`, if a
case fell more than `--tolerance` (default 0.2) below it, so it can gate a run.
A trace holds every tool call and the final reply, so a grader
that failed a reply can be checked against it. `claude plugin eval` deletes
them with its temp dirs, so the script runs it with `--keep-temp` in a private
`TMPDIR`, copies the traces out and removes the rest. `-- --keep-temp` keeps
the dirs where they always were (#374).

It runs the model at medium effort unless given `--effort`: Claude Code's
default on Haiku, Sonnet and Opus, and what a user gets. `claude plugin eval`
takes no effort of its own and ignores `--effort` given before `plugin`, so the
script sets `CLAUDE_CODE_EFFORT_LEVEL`, the one route that reaches its runs. A
variable left in your shell, or a default that moves, cannot change a score
unseen, and the summary's first line and the scoreboard name the effort.

Before the suite it runs one case of its own, `scripts/eval-preflight/can-write`,
once on Haiku for about a cent: the agent writes a file in its working
directory and a regex grader reads it back. If the file is not there, nothing
else runs and the script exits 2, saying so when the trace shows a read-only
file system, as every case on Claude Code 2.1.308 did (below). `--no-preflight`
skips it. The case lives outside `evals/`, so it is never part of the suite or
a scoreboard.

The summary is `scripts/eval-summary.mjs`, which reads any `--json` output on
its own. Its shape, with made-up numbers:

```
3 cases · 298s · $0.122 · model claude-haiku-5-5 · effort medium · judge claude-sonnet-5-5
baseline: 2026-10-16 · model claude-haiku-5-5 · effort medium · plugin 2.3.2 · 30 cases

tier-1
ok  drawio-generate-architecture   1.00   runs: 1.00 1.00 1.00   12 turns · 20 KB   +0.00 on 1.00

tier-2
    drawio-edit-built-diagram      0.80   runs: 1.00 0.60 0.80   14 turns · 22 KB   +0.07 on 0.73
      CRIT (run 2)  rebuilt-from-the-carried-spec  — Bash called 0x (expected 1..∞)
      FAIL (run 3)  says-it-rebuilt  — pattern not found in last_message
      trace (run 2): traces/drawio-edit-built-diagram-run2.jsonl

scorecard            cases  score  all runs perfect  baseline
  tier-1                 1  1.00                 1  1.00
  tier-2                 1  0.80                 0  0.73
  editing                1  0.80                 0  0.73

efficiency: median 13 turns · 9 tool calls per run · 3 failed or refused · 0 denied · 21 KB of tool output per run · largest 9 KB · 1 critical failure

overall 0.90  ·  2/2 cases ran  ·  67% of runs perfect
gate: pass
```

- **CRIT** is a failed grader of `weight: 3`, the one its case exists for;
  **FAIL** any other. **TURNS** is a run that used every turn it had.
- **The efficiency line** comes from the traces: the median turns, the tool
  calls per run, the calls that failed or were refused, the permission
  denials, and the bytes of tool output the agent took into its context.
  "Context is the scarce resource" is measured here, run by run.
- **`--scoreboard FILE`** writes each case's tier, tags, score, perfect runs,
  median turns, mean cost and median context, and nothing else: no path, no
  prompt, no reply. `--baseline FILE` reads one, or another `result.json`, and
  prints each case against it.

## The scoreboard

`evals/scoreboard.json` is the run to beat: the whole suite on the model,
effort and judge it names, with each case's default number of runs. Compare a
change against it with `--baseline evals/scoreboard.json`. Replace it when a
change is meant to move the scores, in the same pull request, from a full run
on the same model at the same effort, and say in the pull request what moved and why. A case it does
not hold yet is printed as `new`, and a test fails until the board names every
case that exists.

The board now committed is the third, from 2026-10-22: Haiku under test at
medium effort and Sonnet judging, on Claude Code 2.1.302 and plugin 2.4.1, 94
runs of 32 cases for $1.66. The second, 2026-10-16 on plugin 2.3.2, ran with
no effort set, which Claude Code resolves to medium:

| | cases | score | all runs perfect | second board |
|---|---|---|---|---|
| tier 1 | 18 | 1.00 | 17 | 1.00 |
| tier 2 | 9 | 0.85 | 2 | 0.93 |
| tier 3 | 5 | 0.90 | 2 | 0.89 |

What moved, and why:

- `drawio-edit-built-diagram` (0.33, from 0.95) and
  `excalidraw-edit-built-scene` (0.74, from 1.00) changed nothing in four of
  their six runs. In each, the first command also listed the plugin's
  `evals/` folder, the eval sandbox refused it, and the agent called the whole
  shell unavailable, as on the first board (below). Nothing outside an eval
  refuses that folder, so these two scores measure the eval: read a later
  miss there against its trace.
- `drawio-interview-when-vague` scored 1.00, from 0.89: every run asked one
  thing at a time.
- `drawio-interview-continues` scored 0.67, from 0.53. Still no run loaded the
  skill on the later turn (#423).
- `drawio-whole-file-never-read` scored 0.89, from 0.74: one run read the file
  without analyzing it first.
- The two portable report cases were run again on graders that read the
  dispatcher through a shell variable (Graders, below).

What the first board's headroom showed:

- `drawio-interview-when-vague`: every run asked five or six questions at
  once, and two never loaded the skill.
- `drawio-whole-file-never-read`: one run printed the embedded payload into
  its context.
- `drawio-scale-multi-region`: two runs drew fewer than the eight nested
  boundaries asked for.
- `excalidraw-edit-built-scene` (two runs) and `drawio-edit-saved-by-desktop`
  (one) changed nothing. Each run's first command also listed the plugin's
  `evals/` folder, which the eval sandbox refuses; the agent then called the
  whole shell unavailable and stopped. A refused command is not a refused
  tool, and a small model needs telling so.

### One board per model

The Haiku board alone cannot tell a case that fails because the model is
small from one that fails on every model, which points at the plugin (#419).
So tiers 2 and 3 have a board for each larger model as well, from
`scripts/eval.sh --tier 2 --tier 3 --model <m>`; tier 1 is saturated by
construction and is left out. A test keeps each board naming exactly the
tier-2 and tier-3 cases. Compare a run on that model with
`--baseline evals/scoreboard.<m>.json`.

| model | board | tier 2 (9) | tier 3 (5) | all runs perfect | runs | cost |
|---|---|---|---|---|---|---|
| Haiku | [scoreboard.json](scoreboard.json) | 0.85 | 0.90 | 4 of 14 | 42 of 94 | $1.66 for all 32 cases |
| Sonnet | [scoreboard.sonnet.json](scoreboard.sonnet.json) | 0.99 | 0.99 | 11 of 14 | 42 of 94 | $14.42 for all 32 cases |
| Opus | [scoreboard.opus.json](scoreboard.opus.json) | 0.97 | 0.98 | 6 of 14 | 42 of 94 | $36.10 for all 32 cases |

All three ran the whole suite on 2026-10-22 and 23, at medium effort with
Sonnet judging, on plugin 2.4.1 and Claude Code 2.1.302: 2.1.308 runs every
case read-only (above). The larger models' boards keep tiers 2 and 3; their
tier 1 scored 0.99 and 1.00. The session limit cut 2 Sonnet runs and 40 Opus
runs, so those cases were run again in full and merged in, and the two
portable report cases were run again on all three models once their graders
were fixed (Graders, below). Each cost counts every run, and is what the runs
would cost at API prices. The boards before these, from 2026-10-16 and 17 on
plugin 2.3.2, ran with no effort set, which resolves to medium.

Two cases fall short on more than one model, and they point at the plugin:

- `drawio-interview-when-vague` (1.00, 0.96, 0.93): one Sonnet run and two
  Opus runs asked several things at once (#422). No Haiku run did.
- `drawio-interview-continues` (0.67, 0.97, 0.90): no Haiku run, and one
  Sonnet run, loaded the skill on the later turn, which the router could fix
  by reading the session (#423). One Opus run did not ask the next question.

Everything else Haiku misses, a larger model does not: the whole-file read,
the scene's own look, and the refused `evals/` listing above. Those are the
small-model gap the plugin's scripts and hooks exist to close. Opus scored
below Haiku on three cases: `drawio-interview-when-vague`, and one grader in
one run each of `drawio-instructions-in-a-spec` and
`excalidraw-engine-choice-is-explained`. The previous Opus board's run did
not skip the draft and the validator in `excalidraw-portable-report-check`,
as this section said: it ran both through a shell variable holding the
dispatcher's path, which the graders did not read.

## Cases that continue a conversation

A case with `context.history_file` starts a turn later (#418). The runner
resumes the history with `claude --resume`, so the case's `prompt` is the
user's next turn, and its trace and graders see only that turn. Such a case
runs with the plugin only; the runner skips its without-plugin arm.

The history is made, not recorded. `history.mjs` beside the case lists the
earlier turns as `{ user }`, `{ assistant }` and `{ tool, input, result }`,
and `node history.mjs` writes `history.jsonl` through `transcript()` in
`evals/fixtures.mjs`, in the shape Claude Code writes a session: one JSON
line per message, each chained to the one before, a tool call answered by the
next line. Ids and times come from each turn's position, so a history rebuilds
byte for byte, and no line carries a `cwd` or any other path. Change the turns,
never the JSONL; a test rebuilds every history and fails on any difference, a
broken chain, a tool call left unanswered or an absolute path. A file the
history says was written, the case's scaffold writes for real.

Resuming writes the continued session beside the history file, as
`<session id>.jsonl` in the case folder, and `.gitignore` keeps it out.
A hand-written history resumes on Claude Code 2.1.300: the pilot of both cases
is in the pull request that added them.

The underlying command, if you would rather drive it yourself:

```bash
claude plugin eval <path> --tag generation icons --runs 1 --model haiku --ablation none \
  --allow-tools Bash Write Edit WebSearch WebFetch --trust-plugin --no-publish
```

**They are not run by default — they cost money.** They spawn real agent runs and
LLM graders. Run them when you want the spend.

Caveats:

- The case files follow `schema_version: "1.1"` as `claude plugin eval` loads
  it in Claude Code 2.1.276. There is no `command` grader: a case checks that the
  agent ran the validator (`tool_used` with `input_match`), and a file's content
  with a `regex` grader on `target: { source: file, path }`.
- Every case grants Bash, because the skills run Node scripts, and an eval run
  refuses a shell it cannot sandbox. **On Windows every Bash-granting case is
  refused** - "the Windows sandbox is not active on this session" - so run the
  suite from WSL or macOS. From Windows: `wsl -d <distro>`, put the plugin on
  the Linux filesystem rather than under `/mnt/c`, then `scripts/eval.sh`.
  Claude Code has to be installed inside WSL too: a Windows install is on
  WSL's `PATH` from `/mnt/c`, cannot run the Linux sandbox, and is refused.
- Prerequisites, all checked by `scripts/eval.sh --check`: Claude Code, logged
  in once; Node 22+; on Linux `bubblewrap` and `socat` for the sandbox.
  `xvfb`, Draw.io Desktop and a browser are checked too, because they matter
  outside the sandbox - but none of them renders anything inside a run. See
  "What renders inside the sandbox" below.
- **Docker Desktop stops the run before it starts.** The sandbox refuses a
  Docker credential store that holds a symlink, and Docker Desktop's WSL
  integration always links `contexts` and `features.json` out to Windows: "the
  Docker (~/.docker, DOCKER_CONFIG) credential store on this machine holds a
  symbolic link inside it". Setting `DOCKER_CONFIG` elsewhere does **not**
  help - `~/.docker` is read either way. `scripts/eval.sh` runs with `HOME` set
  to a temporary directory linking only `~/.claude` and `~/.claude.json`, so
  `~/.docker` is not there to be refused and your real one is never touched.
- **Claude Code 2.1.308 runs every case read-only.** The case's working
  directory, its `TMPDIR` and its `HOME` are all mounted read-only in the
  sandbox, so nothing a case builds can be written, and every Bash call
  reports `Exit code 1`, even one that printed its output. A full Haiku run
  scored 0.69 on tier 1, where its board holds 1.00; the same case, plugin and
  model on 2.1.302 scored 1.00 with no read-only error, and moving `TMPDIR` out
  of the isolated `HOME` changed nothing. The preflight stops such a run. Until
  a later version fixes it, run an earlier one from
  `~/.local/share/claude/versions/` first on `PATH`: link it as `claude` in an
  empty directory `<dir>`, then `PATH=<dir>:$PATH scripts/eval.sh …`.
- `claude plugin eval` refuses every case of a plugin that holds a hard link
  anywhere in it: "a file in the plugin has more than one name". The test
  suite's two #391 tests make such links under `tests/output/`; they remove
  them, and a test fails if one is left. The preflight names any other.
- A background run started from `wsl.exe` with `nohup` and `&` is killed when
  the WSL session closes. Use `setsid -f`, or keep the session open.
- `context.scaffold_script` is the **path to a script file** inside the case
  directory, not inline bash. Claude Code resolves it against the case
  directory, so an inlined script fails the case before the agent starts, with
  `path "mkdir -p eval-input ..." does not exist`. The four cases that need a
  fixture keep it in `scaffold.sh` beside their `case.yaml`.
- Those scaffolds only run under `--scaffold`. Without that flag, create the
  `diagrams/` fixture by hand first; `scaffold.sh` shows what it needs.

## What renders inside the sandbox

"Render it and actually look at it" is required by both skills, and it was the
one step no eval could observe: a layout regression scored 1.00 like anything
else. Measured on Ubuntu 24.04 under `claude plugin eval` 2.1.278, with
`xvfb-run`, `/usr/bin/drawio` and `/usr/bin/google-chrome` all present on the
host (#136):

| | inside a run | what happens |
|---|---|---|
| `excalidraw render --format svg` | **works** | pure Node, no browser, no display; wrote a 19 KB SVG of 42 elements |
| `excalidraw render` (PNG) | never | Chrome exits SIGABRT: `Check failed: . socket() failed: Operation not permitted (1)` |
| `drawio render` (PNG or SVG) | never | no `DISPLAY`, so `xvfb-run -a`, which exits 1 and prints nothing to explain itself |

`--no-sandbox` does not rescue the PNG. That flag exists for a browser that
cannot nest its own sandbox, and the message used to recommend it here because
the two failures share the words "Operation not permitted" - but a refused
`socket()` is the host barring the syscall, and no flag reaches a PNG through
that. The renderer now says so and names `--format svg` instead.

So the suite's render is the SVG. `excalidraw-generate-architecture` asks for
one beside the scene and grades the file itself: a real canvas, drawn shapes,
drawn text and the one product the prompt names. Draw.io has no equivalent -
nothing in that path runs without Draw.io Desktop and a display - so its cases
still stop at "the agent ran the renderer and reported the result honestly".

**A `file_exists` grader does not resolve a relative path the way a `regex`
grader's `{source: file, path}` does.** In one batch of three runs, a
`file_exists` on `./eval-output/orders.svg` reported it missing in all three,
while the regex grader on the identical path read that file and matched it in
two of them — and the file was there in the kept sandbox for all three. Reading
a file proves it exists, and an unreadable one fails with its own message, so
the case keeps the regex and drops the `file_exists` (#208). Be wary of trusting
a `file_exists` path that has not been shown to work.

**The run summary does not always list every failing grader.** The batch above
printed three failures where `result.json` recorded five. Read `result.json` for
anything you are going to quote; `scripts/eval-summary.mjs` is for reading at a
glance, not for evidence.

If a browser ever starts inside the sandbox, the PNG needs no new machinery: a
regex grader refuses an image and says so, pointing at an `llm` grader with
`focus: { source: file, path: … }`, which puts the picture itself in front of
the judge.

## Graders: check what you can, judge what you cannot

An `llm` grader votes three times and can still disagree with itself between
runs; a `regex` grader cannot. So anything checkable about a report — one of
the six headings, the saved file name, an icon id — is a `regex`, and each
`llm` grader is left the single question no pattern can answer.

The generation and icon cases each keep at least twice as many deterministic
graders as judged ones, and run three times, so a flapping judge shows up as a
spread rather than as one verdict that happened to land. A test holds that
shape.

Two of the deterministic graders replaced judgements that had demonstrably
failed:

- `excalidraw-icon-from-logo` now requires `data-platform:15` and
  `drawio:observability/grafana` by id. A Haiku judge had passed a run where
  dbt was drawn as a "self-captioned text label" while the report claimed "no
  placeholder icons" and "proper branding icons throughout".
- `drawio-engine-choice-is-explained` checks the built file for `container=1`
  rather than asking a judge whether the prose implies the AWS accounts were
  drawn as boundaries. The prose version scored pass, fail, fail on unchanged
  code.

If a grader's question is answerable from an artifact on disk, it does not go
to a judge.

A grader that checks a step accepts it however an agent runs it: the script,
the dispatcher, or either through a shell variable holding its path
(`A=…/bin/arkitect.mjs; node $A report --draft …`). The graders read only
the word `arkitect`, so they failed eight steps that agents on all three
models had run, every one in the two portable report cases. Replaying the
fixed patterns against the 282 runs of 2026-10-22 changed exactly those eight
verdicts and no other, and a test holds the rule. A `tool_order` grader still
cannot see order inside one Bash call: a run that drafts and checks the report
in a single command fails `drafted-before-the-check`, as one Haiku and one
Opus run did on the rerun.

## What a good result looks like

Not just "a file appeared". Each generation case checks that the output is
**native and editable** (real XML / real scene JSON, arrows connected at both
ends, no flattened image), that it **passes the validator** rather than merely
parsing, and that the agent's own report states the assumptions it made, says it
looked at the render, and does not claim to have uploaded anything.

The honesty cases are the ones worth watching. An agent that quietly draws
Redshift's icon for Snowflake produces a diagram that looks finished and is
wrong — which is far worse than an empty slot with a `?` in it.
