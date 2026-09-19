# The audit prompt

Paste this to an agent with read access to the repository when you want the
next patch, minor and major work identified. It is written to be run whole; the
constraints in it are the ones from `AGENTS.md` under "What Arkitect optimises
for", and they are what the audit is scored against.

Run it on a clean checkout, and give the agent `Read`, `Glob`, `Grep` and
`Bash`. It writes issues, not code.

---

You are auditing **Arkitect**, a zero-dependency Node 20+ plugin that makes a
coding agent draw editable `.drawio` and `.excalidraw` architecture diagrams.
Everything runs locally. Read `AGENTS.md` first, then `docs/maintenance.md`.

## What this project optimises for, and what you are therefore looking for

Two constraints outrank every feature, and an audit that ignores them is worse
than no audit:

1. **Functional and lightweight.** No dependencies, no services, no build step.
2. **Good output on whatever model is driving** — a small local model, not only
   a frontier one.

So the defects that matter most here are not the ones a linter finds. They are:

- **Context weight.** Every byte a skill makes an agent read competes with the
  user's architecture for the same window. Measure the per-skill reading path
  (`SKILL.md` plus the one reference it sends the agent to) and report anything
  that grew without changing what gets drawn. Prose that restates a rule
  already stated, an example that teaches nothing the one above it did not, a
  reference file loaded on every task to serve a rare branch — these are
  defects, and the budget test in `tests/toolkit.mjs` is the floor, not the goal.
- **Work a script should be doing.** Anything the model is asked to compute,
  remember or be careful about that code could do instead: layout arithmetic,
  icon disambiguation, id generation, style strings, validation, backups. Each
  one is budget spent on geometry rather than on the user's system, and each
  one degrades first on a small model.
- **Instructions a small model will not follow.** A rule stated once, in a
  reference file, three levels from where the decision is made, is a rule that
  will be missed. Find rules whose compliance depends on the model being large:
  where they live, how far they are from the step that needs them, and whether
  anything mechanical enforces them. Known examples of this exact shape:
  issues #179, #180, #183, #186.
- **Promises the code cannot keep.** Any capability the docs offer that the
  documented route cannot produce. Check the interview ladder in `AGENTS.md` §2
  against what the builders accept: if the agent is told to ask about something
  it cannot then deliver, that is a defect in both places. #184 is one.
- **Checks left to a judge.** Anything verified by an LLM grader, or by the
  model's own care, that an artifact on disk could answer deterministically.

## Method

Work from evidence, not impression.

1. Read `AGENTS.md`, `docs/maintenance.md`, `evals/README.md`, then both
   `skills/*/SKILL.md`.
2. Inventory the code: `bin/`, `skills/*/scripts/`, `tests/`, `evals/`. Do not
   read bundled icon data or `.drawio`/`.excalidraw` assets — they are large and
   will tell you nothing. Use `Grep` and read only what matches.
3. Run what tells you something cheaply: `node bin/arkitect.mjs doctor`,
   `node tests/run-tests.mjs`, `node bin/arkitect.mjs <engine> build --print-style`.
   Do not run the eval suite; it costs money and needs a sandbox.
4. For each candidate defect, establish: the file and line, what breaks or is
   wasted, and how you know. A claim you cannot point at is not a finding.
5. Check each finding against the open issues before writing it up — do not
   re-file what is already tracked. List the issue number instead.

## What to produce

A single report, ordered by severity, with every finding in this shape:

- **What** — one sentence, specific.
- **Evidence** — path:line, a command's output, or a measured number. Required.
- **Why it matters** — tied to one of the two constraints above, not to taste.
- **Fix** — the smallest change that resolves it, and what it costs in bytes,
  dependencies or model burden. If the fix adds weight, say so plainly.
- **Release** — patch, minor or major, with the reason for that bucket:
  - **patch** — a defect with no interface change.
  - **minor** — new capability, or a doc promise made real.
  - **major** — a spec, file-format or CLI change that breaks an existing
    diagram, spec or script.

Then a short section, **Not worth doing**, naming what you considered and
rejected, with the reason. This matters as much as the findings: it stops the
same ground being re-audited, and it is where "this would add weight for little
gain" gets recorded.

## Rules for the audit itself

- **Do not write code, do not open PRs, do not edit files.** The deliverable is
  the report.
- **Do not propose a dependency.** If a fix seems to need one, write it as
  rejected, with what it would cost.
- **Do not propose more prose as a fix for a rule being ignored** unless you
  say what comes out to make room, or what mechanical check backs it up. Adding
  words is the failure mode this project is most prone to.
- **Prefer deleting to adding.** A finding that removes bytes from the reading
  path and loses nothing is worth more than a new feature.
- **Say when you are unsure.** "I could not verify this without running the
  evals" is a useful sentence; a confident guess is not.
- **No more than 15 findings.** If you have more, you have stopped ranking.
