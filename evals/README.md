# Eval cases

Twelve cases, six for each engine, covering what matters
most: that a plain request fires the right skill and produces valid, styled,
native output; that a missing product icon is reported or built honestly rather
than substituted; that an edit follows the file in front of it; and that the
learning and apply skills never fire on their own.

```
evals/
  drawio/
    generate-architecture/          a plain request produces a valid styled .drawio
    missing-icon-honesty/           a found icon is named honestly, never substituted
    edit-existing-diagram/          an edit analyzes, backs up, and follows the file
    engine-choice-is-explained/     no engine named: pick one and say why
    learning-skill-stays-manual/    reading a diagram must not trigger learning
    apply-skill-stays-manual/       talking about style must not apply it
  excalidraw/
    generate-architecture/          a valid scene with every arrow bound at both ends
    icon-from-logo/                 "proper icons" get each real mark, honestly sourced
    unknown-product-placeholder/    a name with no mark gets a placeholder, not a lie
    native-not-mermaid/             "for the README" still hands over a real scene
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
  Optional, for renders: `xvfb` and Draw.io Desktop for `.drawio`, and Chrome,
  Edge or Chromium for Excalidraw PNGs - without a browser Excalidraw still
  renders SVG.
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
