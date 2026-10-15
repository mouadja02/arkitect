# Project status

How work is done here, and the decisions that can look unfinished. Where the
project stands lives in the [issue tracker](https://github.com/mouadja02/arkitect/issues)
and the [releases](https://github.com/mouadja02/arkitect/releases); what each release
changed is in [CHANGELOG.md](../CHANGELOG.md), so nothing here goes stale.

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
