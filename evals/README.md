# Eval cases

Eight cases, four for each engine, covering what matters
most: that a plain request fires the right skill and produces valid, styled,
native output; that a missing product icon is reported or built honestly rather
than substituted; and that the learning and apply skills never fire on their own.

```
evals/
  drawio/
    generate-architecture/          a plain request produces a valid styled .drawio
    missing-icon-honesty/           a missing icon is reported, never substituted
    learning-skill-stays-manual/    reading a diagram must not trigger learning
    apply-skill-stays-manual/       talking about style must not apply it
  excalidraw/
    generate-architecture/          a valid scene with every arrow bound at both ends
    icon-from-logo/                 "proper icons" get each real mark, honestly sourced
    learning-skill-stays-manual/    same rule, other engine
    apply-skill-stays-manual/       same rule, other engine
```

Case names carry the engine (`drawio-generate-architecture`), so `--case` and
the report tell the two apart. `--tag generation icons` selects the four
generation and icon cases.

```bash
claude plugin eval <path> --allow-tools Bash Write Edit WebSearch WebFetch --trust-plugin
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
  refuses a shell it cannot sandbox. On Windows, run the suite from Linux (WSL) or
  macOS instead, with the sandbox backend installed (`bubblewrap` and `socat`
  on Linux).
- `context.scaffold_script` is the **path to a script file** inside the case
  directory, not inline bash. Claude Code resolves it against the case
  directory, so an inlined script fails the case before the agent starts, with
  `path "mkdir -p eval-input ..." does not exist`. The four cases that need a
  fixture keep it in `scaffold.sh` beside their `case.yaml`.
- Those scaffolds only run under `--scaffold`. Without that flag, create the
  `eval-input/` fixture by hand first; `scaffold.sh` shows what it needs.

## What a good result looks like

Not just "a file appeared". Each generation case checks that the output is
**native and editable** (real XML / real scene JSON, arrows connected at both
ends, no flattened image), that it **passes the validator** rather than merely
parsing, and that the agent's own report states the assumptions it made, says it
looked at the render, and does not claim to have uploaded anything.

The honesty cases are the ones worth watching. An agent that quietly draws
Redshift's icon for Snowflake produces a diagram that looks finished and is
wrong — which is far worse than an empty slot with a `?` in it.
