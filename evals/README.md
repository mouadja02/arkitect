# Eval cases

Seventeen cases, nine for Draw.io and eight for Excalidraw, covering what
matters most: that a plain request fires the right skill and produces valid,
styled, native output; that a missing product icon is reported or built honestly rather
than substituted; that an edit follows the file in front of it; and that the
learning and apply skills never fire on their own.

```
evals/
  drawio/
    generate-architecture/          a plain request produces a valid styled .drawio
    missing-icon-honesty/           a found icon is named honestly, never substituted
    edit-existing-diagram/          an edit analyzes, backs up, and follows the file
    engine-choice-is-explained/     no engine named: pick one and say why
    as-is-to-be-two-pages/          two pages come from one spec with `pages`
    report-names-every-warning/     a warning it may not fix is named in the report
    numbered-flow-one-sequence/     one path numbered from 1; entry points are not steps
    learning-skill-stays-manual/    reading a diagram must not trigger learning
    apply-skill-stays-manual/       talking about style must not apply it
  excalidraw/
    generate-architecture/          a valid scene with every arrow bound at both ends
    icon-from-logo/                 "proper icons" get each real mark, honestly sourced
    unknown-product-placeholder/    a name with no mark gets a placeholder, not a lie
    names-a-product-box/            a plain shape named for a bundled product gets its mark
    native-not-mermaid/             "for the README" still hands over a real scene
    engine-choice-is-explained/     the same request, with no engine named at all
    learning-skill-stays-manual/    same rule, other engine
    apply-skill-stays-manual/       same rule, other engine
```

Case names carry the engine (`drawio-generate-architecture`), so `--case` and
the report tell the two apart. `--tag generation icons` selects the generation
and icon cases, `--tag editing` the edit case, and `--tag safety invocation`
the ones that must never fire a skill.

```bash
scripts/eval.sh --check                              # prerequisites only, no spend
scripts/eval.sh --tag generation --runs 1 --model haiku
scripts/eval.sh --case 'drawio-*' --runs 2
scripts/eval.sh -- --keep-temp                       # after --, straight to claude
```

`scripts/eval.sh` is the supported route on Linux and macOS. It checks the
prerequisites, applies the workarounds below, caps the spend
(`--max-cost-usd`, default 5), and writes `result.json`, `report.html`,
`run.log` and a one-screen `summary.txt` under `evals/results/<stamp>/`. It
exits 1 if any case scored below 1, so it can gate a run.

The summary is `scripts/eval-summary.mjs`, which reads any `--json` output on
its own:

```
12 cases - 298s - $1.222 - model haiku - judge sonnet

    drawio-edit-existing-diagram            0.86
      FAIL  wrote-a-backup - pattern not found in files
ok  drawio-generate-architecture            1.00

overall 0.91  -  12/12 cases ran  -  42% of runs perfect
```

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
- Prerequisites, all checked by `scripts/eval.sh --check`: Claude Code, logged
  in once; Node 20+; on Linux `bubblewrap` and `socat` for the sandbox.
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
- A background run started from `wsl.exe` with `nohup` and `&` is killed when
  the WSL session closes. Use `setsid -f`, or keep the session open.
- `context.scaffold_script` is the **path to a script file** inside the case
  directory, not inline bash. Claude Code resolves it against the case
  directory, so an inlined script fails the case before the agent starts, with
  `path "mkdir -p eval-input ..." does not exist`. The four cases that need a
  fixture keep it in `scaffold.sh` beside their `case.yaml`.
- Those scaffolds only run under `--scaffold`. Without that flag, create the
  `eval-input/` fixture by hand first; `scaffold.sh` shows what it needs.

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

## What a good result looks like

Not just "a file appeared". Each generation case checks that the output is
**native and editable** (real XML / real scene JSON, arrows connected at both
ends, no flattened image), that it **passes the validator** rather than merely
parsing, and that the agent's own report states the assumptions it made, says it
looked at the render, and does not claim to have uploaded anything.

The honesty cases are the ones worth watching. An agent that quietly draws
Redshift's icon for Snowflake produces a diagram that looks finished and is
wrong — which is far worse than an empty slot with a `?` in it.
