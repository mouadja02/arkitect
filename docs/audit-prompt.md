# The audit prompt

Paste this to an agent when you want the next round of work found, diagnosed
and filed. It is written to be run whole. It scores against the two
constraints in `AGENTS.md` under "What Arkitect optimises for", not against
taste.

Run it on a clean checkout of `main`, level with `origin/main`. Give the agent
`Read`, `Glob`, `Grep` and `Bash`: `Bash` because it runs the suite and files
issues with `gh`, which must be logged in with write access to issues. It files
issues and comments, edits only its own issues, and closes exactly one, its
record of what it rejected. It never writes code.

Issues carry no release. Fixes land under `[Unreleased]` as they merge, and
the bump is picked when a release is prepared, from the changelog
(`docs/maintenance.md`, "Version bumps").

A duplicate costs a maintainer more than a missed finding, and a finding nobody
can reproduce costs more than either.

---

You are auditing **Arkitect**, a zero-dependency Node 20+ plugin that makes a
coding agent draw editable `.drawio` and `.excalidraw` architecture diagrams.
Everything runs locally. The repository and its issue tracker are public.

## What you are scoring against

Two constraints outrank every feature:

1. **Functional and lightweight.** No dependencies, no services, no build step.
2. **Good output on whatever model is driving**, a small local model included,
   and on whatever host runs it: Claude Code, Codex, Cursor, Copilot, OpenCode.

`docs/maintenance.md` turns them into invariants. Read 0, 2, 2a and 2b before
anything else; the defect classes below come from them.

## The defect classes: sweep every one

Report a measured result for each class, even when it is "nothing found". An
empty class counts only if you say what you measured. The audit at 2.2.0
(#294–#297) filed four geometry bugs and measured none of the other classes;
this rule is why.

**1. Wrong output that passes.** A builder draws something the spec did not
say, or something the editor will not honour, and `validate` returns clean.
The worst are the ones a reader would believe: a lost or misrouted edge, a
child outside its boundary, a binding the app drops. #294, #295 and #297 show
the shape of the evidence: an in-memory reproduction through the exported
builder, the validator's `ok: true`, and the line that causes it.

**2. Context weight.** Every byte an agent reads before the user's
architecture competes with it for the window. Measure each route in bytes:

- Claude Code: `SKILL.md`, the pattern section it picks, the worked example,
  and what the default-path commands print (`--print-style`,
  `find-icon --compact`, the build report, `validate`).
- Every other host: the adapter body in `bin/lib/install-agent.mjs` sends the
  agent to `AGENTS.md` whole, and the Codex skill then to a `SKILL.md` as well.
- The hooks, which add text to the context on some prompts.

The budget test in `tests/toolkit.mjs` covers the first two items of the first
route and nothing else. It is the floor. Report what grew without changing
what gets drawn: a rule stated twice, an example that teaches nothing the one
above it did, a file read on every task to serve one branch.

**3. Work a script should be doing.** Anything the model computes, remembers
or is asked to be careful about that code could do instead: layout arithmetic,
padding, icon disambiguation, ids, style strings, which report keys need
acting on. Each one degrades first on a small model.

**4. Rules a small model will not follow.** Invariant 2b: a rule lands in the
step that performs it, or in code. Check it as a table, not by impression. For
each numbered step of each drawing `SKILL.md`, and of `AGENTS.md` §2, list the
rules that step needs, where each is stated (that step, elsewhere in the file,
a reference, `AGENTS.md` only), and what enforces it (a builder refusal, a
report key, `validate`, a hook, an eval grader, nothing). A rule far from its
step with nothing behind it is a finding. So is a rule whose only backstop is
a hook: `hooks/hooks.json` runs in Claude Code and on no other host. 2b lists
the precedents.

**5. Promises the code cannot keep.** A capability the docs offer that the
documented route cannot produce. Check the interview ladder in `AGENTS.md` §2
and in each `SKILL.md` against what the builders accept, and the commands and
flags the docs quote against the CLI's own usage. An agent told to ask about
something it cannot then draw is a defect in both places (#184); so is the
reverse, a skill denying what the code does (#256). `doctor` makes a promise
too: that what it reports ok works. It has to look for each optional tool a
documented route needs, through the discovery that route uses (#46).

**6. Checks left to a judge.** An eval grader that asks an LLM what a file on
disk could answer, or a step that relies on the model's care where a script
could check. `evals/README.md` under "Graders" records what already moved.

**7. Engine parity.** Invariant 2: a check, a report key or a fix that one
engine has and the other lacks, with no stated reason. #191 made Excalidraw
boundaries hold all of their children's text; #295 found Draw.io's are still
sized from the grid alone.

## Method

1. Record what you audit: `git rev-parse HEAD`, `node --version`, the OS.
   `git fetch && git status -sb` must show a clean tree level with
   `origin/main`. If it doesn't, stop and say so.
2. Read `AGENTS.md`, `docs/maintenance.md`, `docs/status.md`,
   `evals/README.md`, then both drawing `SKILL.md` files.
3. Find the last audit: the newest issue labelled `audit`, or with
   `Audited commit:` in its body. Read `git log --stat <that commit>..HEAD`
   and start where the code moved since; then cover the rest.
4. Inventory `bin/`, `hooks/`, `skills/*/scripts/`, `tests/`, `evals/`,
   `scripts/`, `.github/workflows/` and `.claude-plugin/` with `Glob` and
   `Grep`, and read only what matches. Never read bundled artwork or its
   indexes: `skills/*/assets/libraries/`, `references/icon-catalog.json`,
   `references/pack-index.md`, and the `.drawio`, `.excalidraw` and PNG files
   under `assets/`. They run to megabytes and tell you nothing.
5. Run what is cheap: `node bin/arkitect.mjs doctor`,
   `node tests/run-tests.mjs` (about a minute), and
   `node bin/arkitect.mjs <engine> build --print-style`. Never run the eval
   suite; it costs money and needs a sandbox.
6. Diagnose every candidate, as below, before you classify it.

## Diagnose each candidate

A finding is six facts. Get all of them, or say which you could not get.

1. **The smallest reproduction.** Invented input, in memory through the
   exported functions or in the OS temp directory. Cut it down until removing
   anything more makes the defect go away.
2. **A control.** The nearest input that works: a box where the cylinder
   fails, 0° where 90° clips. It shows the reproduction isolates the defect.
3. **The cause**, as `path:line`, not only the symptom. When the two are in
   different files, give both.
4. **The reach.** Which engines, and whether a committed template or eval
   fixture triggers it: build `skills/*/assets/templates/*.spec.json` with
   `--defaults` into the temp directory and validate. A defect the templates
   hit is one every new user meets.
5. **Since when.** `git log -S '<symbol>'` on the line at fault, or
   `git bisect run` with the reproduction in a `git worktree` under the temp
   directory, never in the checkout. A defect a closed issue's fix introduced
   or undid is **regressed**.
6. **The test that missed it.** The file in `tests/` that covers that code,
   and why it passed. That names the test the fix adds.

Then say how sure you are: reproduced; reproduced, with its effect in the
editor unverified; or read from the code only. A finding in the last group
says so in its Evidence. One only an eval run could confirm, such as whether
a small model follows a rule, puts the eval case in Done when and never
claims a behaviour nobody observed.

## Privacy

The tracker is public, and some machines this runs on hold real diagrams.

- Read only tracked files (`git ls-files`). Never open `.analysis/`, anything
  `.analysis/sources.local.json` lists, `~/.arkitect/` or `$ARKITECT_HOME`, or
  an ignored file such as a local `*PLAN*.md`.
- The suite runs extra tests when a local corpus is present. Quote its counts,
  never its content.
- A reproduction uses invented names (`a`, `Orders`, `Worker`). Nothing from a
  real diagram goes into an issue: invariant 5 holds for the tracker as much
  as for the repository.

## Read the tracker before writing anything

Dump it to files and search them; don't pipe it into your context. At 2.2.0
the issues alone came to 600 KB.

```bash
T="${TMPDIR:-/tmp}"
gh issue list --state all --limit 1000 \
  --json number,title,state,stateReason,labels,body,comments > "$T/issues.json"
gh pr list --state all --limit 1000 --json number,title,state,body > "$T/prs.json"
gh label list --limit 100
```

Read every title, then grep the bodies for each candidate's file, function and
symptom; `gh issue list --state all --search "<words>"` works too. Check
`CHANGELOG.md` `[Unreleased]`, which holds fixes no closed issue shows yet,
and `docs/status.md` under "Decisions that can look unfinished".

Classify every candidate, and say which it is:

- **new**: nothing covers it. File it.
- **covered**: an open issue or open PR describes it. Don't file. Comment only
  with evidence the issue lacks: a second site, a smaller reproduction, the
  commit that introduced it. Never a +1.
- **fixed**: closed as completed, or in the changelog. Drop it.
- **rejected**: closed as not planned, listed in `docs/status.md`, or in an
  earlier "Audit: considered and rejected" issue. Drop it and don't comment;
  re-filing argues with a decision already made.
- **regressed**: a completed issue whose fix no longer holds. File it as new,
  link the old issue, and name the commit that broke it.

## Rank

File **worst first**, so the numbers run in severity order:

1. Harm the user would not see: data lost or overwritten without a backup,
   anything leaving the machine, a wrong product's mark, a component invented
   or dropped.
2. Output that validates and is wrong (class 1).
3. A rule a small model misses, with nothing mechanical behind it.
4. Context weight, and work the model does that code could.
5. Docs drift and maintainer tooling.

Within a group, what the committed templates hit goes before what they don't.

## Write each issue

The body, in this order:

```markdown
## What
One or two sentences. Specific.

## Evidence
Audited commit: `<sha>` · Node <version> · <OS>

- Cause: path:line (and the symptom's path:line, if elsewhere).
- Reproduction, and the output you got.
- Control: the nearest input that works, and its output.
- Reach: drawio, excalidraw or both; which templates or eval fixtures hit it.
- Since: the commit, or "before <sha>" if you did not bisect.
- Missed by: the test file that covers the code, and why it passed.
- Confidence: reproduced | editor effect unverified | from the code only.

Classification: new. <The nearest closed issues, and why none covers it.>

## Why it matters
Tied to one of the two constraints, not to taste.

## Fix
The smallest change that resolves it; what it costs in bytes, dependencies or
model burden; and whether an existing spec, saved diagram or command behaves
differently afterwards. If it adds weight, say so. Give the options you
weighed when the choice isn't obvious.

## Done when
- [ ] A checkable condition.
- [ ] A test in `tests/*.mjs` that fails at the audited commit, for a code change.

Effort: XS | S | M | L · Scope: drawio | excalidraw | both · Depends on: #n, or none
```

Done when also names the eval case for a change to skill wording (2b: an eval
run is what tells a fix from a restatement), and the rebuilt templates and a
render someone looked at for a change to generated output.

Name no version and no bump. What the fix changes for existing users goes in
Fix as a fact; the release is picked later, from the changelog.

Title the issue as the change, not the complaint: "Size Draw.io boundaries to
contain their declared children", not "Boundaries are broken".

Labels, only ones `gh label list` shows: `audit` on every issue this run
files, and the kinds that apply: `fix`, `enhancement`, `docs`, `test`,
`maintenance`, `performance`, `icons`, `licensing`, `accessibility`,
`upstream`. Use `fix` and `docs`, not the older `bug` and `documentation`.

## Publish

1. Write each issue to a file in the temp directory, and check it against the
   list below.
2. Re-run every reproduction from a fresh shell at the audited commit, and
   make the draft quote the output you got, not the output you expected. One
   that no longer reproduces is dropped.
3. Just before each `gh issue create`, search the tracker again by the
   title's key words: someone may have filed it since you read it.
4. File worst first, always from the file:

   ```bash
   gh issue create --title "<title>" --body-file "$T/issue-1.md" \
     --label audit --label fix --label test
   ```

   Never pass a body inline with `--body`: the shell eats backslashes and
   backticks, and the code blocks arrive broken.
5. Read each one back with `gh issue view <n> --json body,labels` and compare
   it with its file. Fix a mangled one with `gh issue edit <n> --body-file`.
6. Comments on covered issues go the same way, with
   `gh issue comment <n> --body-file`.

A draft is ready when:

- every section is there, in order;
- Evidence opens with the audited commit, and has a `path:line` and output you
  got, not output you predicted;
- the classification names the nearest closed issues;
- Done when has at least one box a test or a script can decide;
- every name in it is invented or already in the repository;
- it names no version and no bump.

## Record what you rejected

What you weighed and turned down matters as much as the findings: it stops
the next audit walking the same ground. File one issue titled
"Audit: considered and rejected at `<short sha>`", labelled `audit` only, one
line per idea with the reason and, where it applies, the cost ("adds 900
bytes to every drawing path for one rare branch"). Then close it:

```bash
gh issue close <n> --reason "not planned"
```

The next audit finds it among the closed issues and reads it as **rejected**.

## Then report back, briefly

In the chat:

- the audited commit;
- one line per defect class: what you measured, what you found, which issues;
- the issues filed, with numbers and titles;
- the issues you commented on, and what you added;
- what you dropped, and the issue or changelog entry you deferred to;
- findings left out to stay under the cap;
- the number of the rejected-ideas issue.

## Rules for the audit itself

- **File issues and comments, nothing else.** No code, no pull requests, no
  commits, no edits to tracked files. A one-line obvious fix still goes in an
  issue; the maintainer decides what ships.
- **Leave the checkout as you found it.** Scratch files and worktrees go in the
  OS temp directory, and `git status` is clean when you finish.
- **Edit only your own issues, and close only the rejected-ideas one.** Never
  close, relabel or edit anyone else's.
- **Never file a duplicate.** If you are unsure whether something is covered,
  comment on the nearest issue instead.
- **Don't propose a dependency.** If a fix seems to need one, it goes in the
  rejected-ideas issue with what it would cost.
- **Don't fix an ignored rule with more prose** unless you say what comes out
  to make room, or what mechanical check backs it. Adding words is the failure
  mode this project is most prone to.
- **Prefer deleting to adding.** A finding that takes bytes off a reading path
  and loses nothing beats a new feature.
- **Say when you are unsure.** "I could not verify this without running the
  evals" is useful; a confident guess is not.
- **At most 15 issues**, the rejected-ideas one aside. More than that means
  you stopped ranking: leave the smallest out and name them in the chat.
- **One fix per issue.** Findings that share one fix are one issue; a bundle
  of five fixes cannot be closed.
