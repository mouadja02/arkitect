# Project status

Snapshot of 2026-10-01, at 2.2.1. The live record is the
[issue tracker](https://github.com/mouadja02/arkitect/issues) and the
[releases](https://github.com/mouadja02/arkitect/releases); what each release
changed is in [CHANGELOG.md](../CHANGELOG.md).

## Where it stands

- **2.2.1** is on GitHub and npm.
- **Ten issues are open.** #295 (Draw.io boundaries sized to their children)
  changes layout and #302 (a portable report check) adds a command, so neither
  went into a patch. #325 is the scheduled note that three pinned icon sources
  have moved on. #326 to #332 are the eval reds below.
- The suite passes on Ubuntu 24.04 and 26.04, Windows and macOS, Node 20 to
  24. The last full eval batch (17 cases, 49 runs, Haiku under test, Sonnet
  judging, at a1bc464) scored 0.94. Nothing it failed touches what 2.2.1
  fixed. A wrong grader was fixed; the rest is agent behaviour, filed as
  #326 to #332. The three judge reds that repeated on a re-run were run
  against 2.2.0 as a control: the same replies are there, so they predate it.

## What 2.2.1 changed

- **Excalidraw connectors.** Arrows bind only to elements the app can bind;
  edges spread along a shared side, clear their own node's caption, and keep
  their labels off other lines. `validate` warns when an arrow runs through
  text. `"route": "avoid"` finds its way past a full-width band.
- **doctor.** It exits 1 when Node or a bundled asset is broken, parses the
  assets instead of checking they exist, and reports what each render route,
  the local Excalidraw app, the style override and the project's adapters
  actually need.
- **Agents other than Claude.** `install gemini` writes `GEMINI.md`; the Codex
  skill reads one engine guide, not all of `AGENTS.md` first; the entry
  routes teach the compact icon search.
- **Reports.** The report check runs after a build by `arkitect` or
  `npx arkitect` too, and both builders name an unknown boundary `kind`.

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
