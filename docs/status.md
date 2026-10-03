# Project status

Snapshot of 2026-10-03, at 2.3.0. The live record is the
[issue tracker](https://github.com/mouadja02/arkitect/issues) and the
[releases](https://github.com/mouadja02/arkitect/releases); what each release
changed is in [CHANGELOG.md](../CHANGELOG.md).

## Where it stands

- **2.3.0** is on GitHub and npm.
- **Seven issues are open.** #295 (Draw.io boundaries sized to their
  children) changes layout and #302 (a portable report check) adds a command.
  #325 is the scheduled note that three pinned icon sources have moved on.
  #339 to #342 are agent behaviour the 2.3.0 eval found on paths this release
  didn't touch: a rebuild in place of an edit, a hosted-editor link, an
  ignored `looksLikeBoundary` entry and a whole-file read.
- The suite passes on Ubuntu 24.04 and 26.04, Windows and macOS, Node 20 to
  24. The full eval batch after the fixes merged (17 cases, 49 runs, Haiku
  under test, Sonnet judging, at def24b8) scored 0.97. Its reds on #326,
  #329 and #331 were new wordings of the same misses, fixed in #343 and
  re-run green on the branch: names-a-product 3/3, numbered flow 3/3, the
  Excalidraw style question 3/3.

## What 2.3.0 changed

- **Routing.** A third hook names the skill to load when a prompt names a
  `.drawio` or `.excalidraw` file or a spec; an agent asked to build a spec
  had loaded none and written its own builder.
- **Validate, read last.** Excalidraw warns on a plain shape named for one
  product with a bundled mark; Draw.io warns on entry points numbered as
  steps, and the build notes them.
- **Reports.** The report check sends back a Render section describing an
  unseen picture in other words, or not saying nothing saw it, and a
  validate warning called intentional. The style hook catches more promises
  and says learning records while applying changes the build.
- **Evals.** The learning case checks facts by regex and judges one claim;
  the names-a-product case passes either honest outcome.

## How work gets done here

Changes are measured before they're trusted. A skill wording change gets an
eval run on its branch before merge; where wording didn't move an agent, the
check moved into code ([maintenance.md](maintenance.md), invariant 2b). Eval
spend is batched: one PR for a round of fixes, then one batch after merge.

## Decisions that can look unfinished

- **Changelog fragments** were tried (#32) and removed; entries go straight
  under `[Unreleased]`.
- **Catalog performance** (#16) was measured and the in-process cache kept.
- **On-demand marks** stay without bytes until a licence or trademark policy
  allows them; a closed coverage issue doesn't mean every logo is bundled
  (#11, #20).
- **Excalidraw routing** stays opt-in (`avoid`): the default route is the one
  the app re-routes itself when a node moves.
- **The package size** (about 18 MB packed) is bundled artwork, and stays: no
  mark moves from bundled to fetched to save space (#126).
