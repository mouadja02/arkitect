# The audit prompt

Paste this to an agent when you want the next round of bugs, useful features
and product improvements found, diagnosed and filed. It is written to be run
whole. It scores against user value and the two constraints in `AGENTS.md`
under "What Arkitect optimises for", not against taste.

Run it on a clean checkout of `main`, level with `origin/main`. Give the agent
`Read`, `Glob`, `Grep` and `Bash`: `Bash` because it runs the suite and files
issues with `gh`, which must be logged in with write access to issues. It files
issues and comments, edits only its own issues, and closes exactly one, its
record of what it rejected. It never writes code.

Use `$creative-ideation` for opportunity discovery when the skill is available.
The self-contained fallback below keeps this prompt usable on other hosts;
no extra skill installation is required.

Issues carry no release. Fixes land under `[Unreleased]` as they merge, and
the bump is picked when a release is prepared, from the changelog
(`docs/maintenance.md`, "Version bumps").

A duplicate costs a maintainer more than a missed finding, and a finding nobody
can reproduce costs more than either.

---

You are auditing **Arkitect**, a zero-dependency Node 22+ plugin that makes a
coding agent draw editable `.drawio` and `.excalidraw` architecture diagrams.
Everything runs locally. The repository and its issue tracker are public.

Your job is to discover what would make Arkitect more useful, reliable, easy
to use, maintainable and easy to adopt. Audit the implementation and the
product: features, system design, repository structure, performance, user
experience, security, documentation, README, demos and samples. Do not stop
after finding bugs or wait for the maintainer to suggest features.

## What you are scoring against

Two constraints outrank every feature:

1. **Functional and lightweight.** No dependencies, no services, no build step.
2. **Good output on whatever model is driving**, a small local model included,
   and on whatever host runs it: Claude Code, Codex, Cursor, Copilot, OpenCode.

`docs/maintenance.md` turns them into invariants. Read 0, 2, 2a and 2b before
anything else; every proposal below must respect them.

## The audit areas: sweep every one

Report evidence for each area, even when it is "nothing found": what you
inspected or measured, what works, what is missing, and any limits on the
check. Mark an unverified area as unverified, never as clean. The audit at 2.2.0
(#294–#297) filed four geometry bugs and measured none of the other classes;
this rule is why. Coverage is mandatory; findings are not a quota. Look for
defects and opportunities in each area without inventing work to fill it.

**1. Bugs and wrong output that passes.** Check crashes, malformed input,
silent fallbacks, destructive writes, portability and compatibility failures,
as well as geometry. Pay particular attention when a builder draws something
the spec did not say, or the editor will not honour, and `validate` returns
clean. The worst are the ones a reader would believe: a lost or misrouted
edge, a child outside its boundary, a binding the app drops. #294, #295 and #297 show
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

**8. Security and privacy.** Map inputs and trust boundaries: specs, diagram
and SVG/XML parsing, logo URLs and redirects, archives, filesystem paths,
subprocess arguments, browser rendering, hooks, packaging and CI workflows.
Trace plausible paths to command injection, path traversal, arbitrary writes,
unsafe deletion, secret exposure, unintended network access, resource
exhaustion or excessive workflow permissions. State the attacker-controlled
input, prerequisites, reachable sink and impact; distinguish a vulnerability
from optional hardening. Use harmless local fixtures, never real secrets,
external targets or destructive payloads. Follow the private-disclosure rule
under Privacy before putting security evidence in the public tracker.

**9. Performance and resource use.** Measure cold and warm CLI startup, icon
lookup, build, validation, rendering and batch workflows where available.
Use small, representative and larger synthetic inputs; record input size,
environment, repeated timings and memory or output size when relevant.
Inspect repeated parsing, filesystem work, avoidable scans, algorithmic
growth and unnecessary output. Propose an optimization only with a measured
bottleneck or a demonstrated scaling problem, a target and a correctness
check. Do not repeat a rejected caching idea without new evidence.

**10. System design and repository structure.** Map entry points, shared
logic, engine-specific code, data flow and ownership before proposing changes.
Look for duplicated policy, divergent validation, fragile coupling, hidden
side effects, unclear module boundaries, dead routes and confusing file
placement. Identify a concrete change or failure that the current structure
makes harder. Prefer a small extraction, clearer interface or simpler flow;
give migration and compatibility costs. A new abstraction, framework or
directory tree is not an improvement without a demonstrated benefit.

**11. Useful features and functionality gaps.** Build a capability map from
CLI help, exported functions, specs, docs, templates and tracker requests:
what exists, what is hard to discover, what is incomplete and what is absent.
Walk realistic jobs: a first diagram, editing an existing one, comparing
options, resolving an icon, recovering from failure and using another host
or engine. Find repeated manual steps and unmet jobs that the current pieces
could serve. For each proposal name the user, trigger, current workaround,
desired result, supporting evidence and smallest useful scope. Compare
exposing an existing capability, simplifying its route and adding a feature.
Label inferred demand as a hypothesis; do not claim users requested it.
Do not limit discovery to parity fixes or deletion.

**12. User experience and accessibility.** Follow the journey from install
and engine selection to spec creation, errors, validation, rendering, editing
and sharing an editable file. Test help, defaults, command discoverability,
diagnostics, progress, recovery, platform differences and host consistency.
Check diagram legibility and accessibility as well as CLI clarity. Record
the exact step where a user gets stuck, unnecessary decisions or commands,
and the proposed before/after journey. Use command output or a viewed public
template render as evidence; do not infer editor behaviour from JSON alone.

**13. Documentation.** Check installation, quickstarts, CLI/spec references,
troubleshooting, contributor guidance and cross-links against working routes.
Look for missing task guides, unexplained concepts, stale examples,
contradictions and useful functionality absent from the docs. Run quoted
commands with synthetic inputs in temp where practical. Propose the exact
page and gap to fix, or a focused new guide; do not pad the default agent
reading path to solve an occasional human documentation need.

**14. Marketing and adoption.** Read the README as a prospective user: can
they tell who Arkitect helps, what it produces, why it is useful, how to try
it and where to go next? Inspect package metadata, demos, screenshots,
samples and template coverage for discoverability and credible proof of the
capabilities. Suggest concrete copy, a demo outline or a sample scenario
with its audience and next action. Prefer a short path to a first successful
diagram and public, reproducible examples. Never invent testimonials,
benchmarks, usage numbers or competitor claims. Do not change repository
settings, publish assets or start campaigns as part of this audit.

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
   `scripts/`, `.github/workflows/`, `.claude-plugin/`, `docs/`, README,
   package metadata and public sample/demo locations with `Glob` and `Grep`,
   and read only what matches. Make a compact capability and module map,
   then walk the user journeys in areas 11–14; do not let the code sweep
   consume the entire audit. Never read bundled artwork or its
   indexes: `skills/*/assets/libraries/`, `references/icon-catalog.json`,
   `references/pack-index.md`, and the `.drawio`, `.excalidraw` and PNG files
   under `assets/` wholesale. Read small template specs when needed and view
   selected committed template PNGs for UX/demo evidence; inspect generated
   files through the analyzer. Do not load embedded artwork into context.
5. Run what is cheap: `node bin/arkitect.mjs doctor`,
   `node tests/run-tests.mjs` (about a minute), and
   `node bin/arkitect.mjs <engine> build --print-style`. Never run the eval
   suite; it costs money and needs a sandbox.
6. Run the creative-opportunity pass below on the capability map and observed
   user friction, before ranking. Generate possibilities separately from
   deciding which ones deserve issues.
7. Maintain a coverage table for all 14 areas: checks, evidence, candidates
   and limitations. Diagnose every candidate using the appropriate track
   below before classifying and ranking it.

## Generate creative opportunities

Use `$creative-ideation` to turn the audit evidence into specific, non-obvious
improvements. Read its routing guidance and only the selected method reference,
not the whole library. Choose one primary method for this pass, based on the
task: discovering unmet user jobs, expanding an existing capability, resolving
an architectural tradeoff or improving adoption. Name the method and its
originator in the report. Do not stack methods to make the audit look thorough.

If the skill is unavailable, use **SCAMPER**, Bob Eberle's method building on
Alex Osborn's checklist, to expand an existing Arkitect workflow:

1. State the current workflow and desired user outcome in one precise sentence.
2. Try all seven transformations: **Substitute** a step; **Combine** existing
   capabilities; **Adapt** a mechanism from another context; **Modify** scale
   or granularity; **Put to another use** an existing capability; **Eliminate**
   a step; **Reverse or rearrange** the sequence. These generate possibilities,
   not obligations to add features.
3. Discard the first three speculative ideas as warm-ups, then generate beyond
   them. This applies to ideation only: never discard observed defects,
   security findings or supported user requests to satisfy a creativity rule.
4. Develop the strongest one to three ideas. For each, state the exact user
   situation, concrete mechanism, before/after example, honest failure mode
   or tradeoff and a first validation step. Mark at least one **grounded**:
   useful and feasible now under the project's constraints. If no candidate
   meets that bar, say so rather than manufacture a finding.

Apply the same quality bar when the skill supplies another method. Reject
generic suggestions such as "add AI", "improve onboarding" or "more demos"
without an Arkitect-specific mechanism. An idea that could fit another repo
by swapping its name needs more work. Consider features, design, UX and
marketing; a new presentation of an existing capability may be more useful
than new code. Novelty alone never establishes value or demand.

Keep exploration separate from publication: ideas enter Develop improvement
proposals, duplicate checks and ranking before any issue is filed. Preserve
the lightweight, local and editable-output constraints throughout. Do not
publish every SCAMPER cell or rejected warm-up as an issue; record only
substantive evaluated proposals under Record what you rejected.

## Diagnose defects

A defect finding is six facts. Get all of them, or say which you could not
get. Use the opportunity track below for proposed improvements that do not
claim existing behaviour is broken.

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

## Develop improvement proposals

A feature, architecture, optimization, UX, documentation or marketing
proposal needs evidence too, but not a fabricated bug reproduction. Record:

1. **User and job.** Who benefits, what triggers the need and what outcome
   improves. For internal design work, connect maintainer effort to a user
   benefit such as fewer regressions or a simpler future change.
2. **Current baseline.** Exact commands, steps, files or measurements showing
   the friction or missing capability. Cite repository paths and lines; use
   existing issues as demand evidence when available.
3. **Smallest useful change.** A concrete before/after example, proposed CLI
   usage, API boundary, documentation outline or demo storyboard. No code
   changes are made during this audit. For an ideation-derived proposal,
   include the mechanism, method, first step and likely failure mode.
4. **Alternatives and cost.** Existing workaround, reuse or simplification
   first; then the proposed addition. Include context bytes, runtime and
   maintenance cost, dependencies, compatibility and engine/host scope.
5. **Validation.** An observable acceptance condition: fewer steps, a measured
   performance target, a working example, a clearer recovery path or a
   reproducible demo. Separate what can be checked locally from adoption or
   usability hypotheses that need later user feedback.
6. **Confidence.** Observed friction | supported request | hypothesis. State
   what would validate or disprove the proposal. Do not invent an introducing
   commit or a missing regression test for a capability that never existed.

Reject vague work such as "improve UX", "refactor architecture" or "add more
examples" until it has a specific user problem and a checkable outcome.

## Privacy

The tracker is public, and some machines this runs on hold real diagrams.

- For repository discovery, read only tracked files (`git ls-files`). You
  may also read your own synthetic temp fixtures, generated outputs and
  tracker exports. Never open `.analysis/`, anything
  `.analysis/sources.local.json` lists, `~/.arkitect/` or `$ARKITECT_HOME`, or
  an ignored file such as a local `*PLAN*.md`.
- The suite runs extra tests when a local corpus is present. Quote its counts,
  never its content.
- A reproduction uses invented names (`a`, `Orders`, `Worker`). Nothing from a
  real diagram goes into an issue: invariant 5 holds for the tracker as much
  as for the repository.
- Do not publish exploitable security details, payloads or secrets in a
  public issue, comment or rejected-ideas record. Use the repository's private
  security reporting channel if available and authorized; otherwise report
  a sanitized finding to the maintainer in chat and mark it pending private
  disclosure. Lack of a private channel does not authorize public disclosure.

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
  earlier "Audit: considered and rejected" issue. Respect maintainer decisions:
  drop it and don't comment. An earlier auditor's hypothesis may be revisited
  only with materially new evidence that changes its stated rejection reason;
  link that record and explain what changed. Renaming an idea is not evidence.
- **regressed**: a completed issue whose fix no longer holds. File it as new,
  link the old issue, and name the commit that broke it.

## Rank

File **worst first**, so the numbers run in severity order:

1. Harm the user would not see: data lost or overwritten without a backup,
   anything leaving the machine, a wrong product's mark, a component invented
   or dropped; exploitable security vulnerabilities stay on the private route.
2. Output that validates and is wrong (class 1).
3. Common workflows that fail or block users, including installation and
   recovery; a rule a small model misses with nothing mechanical behind it.
4. High-value features, UX fixes and measured optimizations that remove
   recurring friction or unlock a supported user job.
5. Context weight, automation, architecture and repository improvements,
   documentation and marketing, ranked by their demonstrated user impact.

For each candidate record impact (high/medium/low), reach, evidence confidence,
effort and ongoing cost. Within a group prioritize common paths and committed
templates, stronger evidence and smaller changes with the same benefit.
Category is not destiny: a broken quickstart or misleading README can block
every new user and outrank a rare code defect. Keep useful opportunities in
the shortlist; do not fill the cap with minor bugs before comparing them.

## Write each issue

The body, in this order:

```markdown
## What
One or two sentences. Specific.

## Evidence
Audited commit: `<sha>` · Node <version> · <OS>

- Type: defect | opportunity. Audit area(s): <numbers and names>.
- For a defect only: cause at path:line, reproduction with actual output, working
  control, reach, since when, missed test and confidence from Diagnose defects.
- For an opportunity only: user/job, baseline at path:line with observed friction or
  request evidence, scope and confidence from Develop improvement proposals.
  Include benchmark details for a performance claim.

Classification: new. <The nearest closed issues, and why none covers it.>

## Why it matters
Concrete user benefit and impact/reach, consistent with the two constraints.
Separate observed harm or friction from expected benefits and assumptions.

## Fix
The smallest change that resolves it; what it costs in bytes, dependencies or
model burden; and whether an existing spec, saved diagram or command behaves
differently afterwards. If it adds weight, say so. Give the options you
weighed when the choice isn't obvious.

## Done when
- [ ] A checkable condition.
- [ ] For a reproduced code defect, a regression test in `tests/*.mjs` that
  fails at the audited commit; for new functionality, an acceptance test.

Impact: high | medium | low · Effort: XS | S | M | L
Scope: <engines, hosts or repository areas> · Depends on: #n, or none
```

Done when also names the eval case for a change to skill wording (2b: an eval
run is what tells a fix from a restatement), and the rebuilt templates and a
render someone looked at for a change to generated output.
For a new capability, name a meaningful acceptance test rather than a test
that must already fail. For docs, marketing or structure-only proposals, use
working commands, resolved links, discoverable routes or another observable
result; do not demand a synthetic regression test for copy edits.

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
2. Re-run every defect reproduction from a fresh shell at the audited commit.
   Make the draft quote the output you got, not the output you expected. One
   that no longer reproduces is dropped. For opportunities, recheck the
   baseline, demand evidence and proposed acceptance conditions instead.
3. Just before each `gh issue create`, search the tracker again by the
   title's key words: someone may have filed it since you read it.
4. File worst first, always from the file, selecting existing labels for its
   type (for example, `enhancement` for a feature or `docs` for a guide):

   ```bash
   gh issue create --title "<title>" --body-file "$T/issue-1.md" \
     --label audit --label "<applicable existing label>"
   ```

   Never pass a body inline with `--body`: the shell eats backslashes and
   backticks, and the code blocks arrive broken.
5. Read each one back with `gh issue view <n> --json body,labels` and compare
   it with its file. Fix a mangled one with `gh issue edit <n> --body-file`.
6. Comments on covered issues go the same way, with
   `gh issue comment <n> --body-file`.

A draft is ready when:

- every section is there, in order;
- Evidence opens with the audited commit, identifies defect or opportunity,
  and has a `path:line` and observed output or baseline, not a prediction;
- the classification names the nearest closed issues;
- Done when has at least one box a test or a script can decide;
- every name in it is invented or already in the repository;
- it names no version and no bump;
- security disclosure follows the private route when required.

## Record what you rejected

What you weighed and turned down matters as much as the findings: it stops
the next audit walking the same ground. File one issue titled
"Audit: considered and rejected at `<short sha>`", labelled `audit` only, one
line per idea with the reason, evidence and, where it applies, the cost ("adds
900 bytes to every drawing path for one rare branch"). Distinguish a
maintainer decision from your assessment. For a hypothesis, state what new
evidence could change that assessment. Do not record deferred or under-cap
candidates as rejected. Then close it:

```bash
gh issue close <n> --reason "not planned"
```

The next audit finds it among the closed issues and reads it as **rejected**.

## Then report back, briefly

In the chat:

- the audited commit;
- the coverage table for all 14 audit areas: evidence, findings and limits;
- the highest-value improvements, their expected user benefit and priority;
- the creative method used and its originator, with the strongest grounded
  idea and what would validate it (or why none qualified);
- the issues filed, with numbers and titles;
- the issues you commented on, and what you added;
- what you dropped, and the issue or changelog entry you deferred to;
- findings left out to stay under the cap;
- the number of the rejected-ideas issue.

## Rules for the audit itself

- **File issues and comments, nothing else.** No code, no pull requests, no
  commits, no edits to tracked files. A one-line obvious fix still goes in an
  issue; the maintainer decides what ships. Security findings follow the
  private-disclosure exception under Privacy.
- **Leave the checkout as you found it.** Scratch files and worktrees go in the
  OS temp directory, and `git status` is clean when you finish.
- **Edit only your own issues, and close only the rejected-ideas one.** Never
  close, relabel or edit anyone else's.
- **Never file a duplicate.** If you are unsure whether something is covered,
  keep it pending; comment on the nearest issue only with new evidence.
- **Don't propose a dependency.** If a fix seems to need one, it goes in the
  rejected-ideas issue with what it would cost.
- **Don't fix an ignored rule with more prose** unless you say what comes out
  to make room, or what mechanical check backs it. Adding words is the failure
  mode this project is most prone to.
- **Prefer the smallest useful change.** Remove waste and reuse existing
  capabilities first, but propose new functionality when its user benefit
  justifies its cost within the invariants. Minimalism is not a reason to
  ignore an unmet user job.
- **Say when you are unsure.** "I could not verify this without running the
  evals" is useful; a confident guess is not.
- **At most 15 issues**, the rejected-ideas one aside. More than that means
  you stopped ranking: leave the smallest out and name them in the chat.
- **One independently deliverable change per issue.** Findings that share one
  fix are one issue; split larger opportunities into useful increments with
  explicit dependencies. A bundle of five unrelated fixes cannot be closed.
