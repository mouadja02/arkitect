### Fixed

- **The agent contract no longer contradicts the skills it points at.**
  `AGENTS.md` still told Draw.io agents to search the AWS palette first and
  fetch a real logo for every non-AWS product, while `arkitect-drawio/SKILL.md`
  had long since moved to searching all 18 bundled packs first — Snowflake,
  Grafana, Databricks and Postgres included. `AGENTS.md` also said both engines
  build only from a JSON spec while both `SKILL.md` files said hand-written
  XML/JSON was equally fine, and said "never commit renders" while
  `docs/maintenance.md` requires refreshing the committed template PNGs.
  `AGENTS.md` and both `SKILL.md` files now agree: bundled packs first
  regardless of vendor, hand-written source as a narrow exception for edits or
  what a spec cannot express, and a clear line between a private render (never
  committed) and the committed template/contact-sheet PNGs (refreshed, not
  banned).
- **The Draw.io icon resolver's own hints stopped nudging base64 into an
  agent's context.** A confident `find-icon.mjs` search suggested
  `--cell <id> …`, which prints a full `<mxCell>` with the embedded icon data
  URI — exactly what the metadata-only search was supposed to avoid. It now
  suggests the spec fragment (`{ "kind": "icon", "icon": "<id>" }`) instead;
  `--cell`/`--style`/`--data` remain for the hand-written-XML exception, now
  documented as redirecting to a file rather than into the conversation.
- **`references/pack-index.md` and `assets/libraries/ATTRIBUTION.md`
  regenerated from the current catalog.** Both say "do not edit by hand -
  rebuild and rerun" at the top, but neither had been regenerated since several
  icon-adding changes landed: the on-demand count alone was quoted as 158, 75,
  69 and 66 in different files, and the generated docs still showed the old
  4,880/75 catalog instead of the current 5,001/158. Re-running
  `write-pack-docs.mjs` fixed both; the remaining hand-written mentions in
  `docs/drawio-icons.md`, `docs/icons.md` and `arkitect-drawio/SKILL.md` no
  longer hard-code a number that only the generator actually knows.
- **The bundled-icon count no longer drifts independently across four files.**
  `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`,
  `package.json` and `bin/lib/install-agent.mjs`'s rendered adapter body each
  quoted a different, stale figure (1,400+, 1,400+, 5,900+, and "243 AWS
  Architecture Icons" respectively, the last also carrying the same AWS-only
  framing as the `AGENTS.md` fix above). All four now say the same rounded
  `6,000+`, and a new `tests/toolkit.mjs` check keeps them from drifting apart
  again. `docs/maintenance.md`'s "Adding an icon library" section now covers
  Draw.io packs (including the `write-pack-docs.mjs` step above) alongside
  Excalidraw libraries, and names every file that quotes an icon count.
- **`learn-excalidraw-style/SKILL.md` no longer contradicts itself in
  consecutive sentences** about whether a fresh install's style record is an
  empty version 0 or the shipped version-1, nine-scene corpus. It is the
  latter; the doc now says so plainly and explains when version 0 would apply.
