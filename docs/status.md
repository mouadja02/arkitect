# Project status

Snapshot of 2026-09-24, at 2.2.0. The live record is the
[issue tracker](https://github.com/mouadja02/arkitect/issues) and the
[releases](https://github.com/mouadja02/arkitect/releases); what each release
changed is in [CHANGELOG.md](../CHANGELOG.md).

## Where it stands

- **2.2.0** is on GitHub and, for the first time, on npm with provenance
  (`npm install -g arkitect`).
- **No issue is open.**
- The suite passes on Ubuntu 24.04 and 26.04, Windows and macOS, Node 20 to
  24. The last full eval batch (17 cases, Haiku under test) scored 1.00 on 15;
  the two misses were judge calls on correct replies, since fixed in the cases.

## What 2.2.0 added

- **Layout.** Draw.io edges take their sides from the grid and get waypoints
  only round what is in the way; labels, titles and wordmarks are placed from
  measurements. Excalidraw takes `"route": "avoid"`. Desktop 29.0.3 and the
  local Excalidraw app both keep the builder's routes through a drag.
- **Icons.** A vendor's name no longer draws the vendor's logo in place of its
  product, and a box named for a product, or like an account, is handed the
  node or boundary to paste.
- **Reports.** A Claude Code hook sends back a report missing its headings, or
  one describing a render nobody opened.
- **Release.** Publishing to npm.

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
