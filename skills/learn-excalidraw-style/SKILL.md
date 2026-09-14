---
name: learn-excalidraw-style
description: Teach the arkitect-excalidraw skill from additional .excalidraw examples the user explicitly designates. Builds this install's own style record and notes outside the plugin, where an update cannot wipe them. User-invoked only.
disable-model-invocation: true
---

# Learn from your own Excalidraw scenes

Folds user-designated `.excalidraw` files into this install's own style
knowledge. It only ever runs when the user asks for it — never learn from a
scene just because you happened to read one.

Plugin root: `${CLAUDE_PLUGIN_ROOT}`. Work from
`${CLAUDE_PLUGIN_ROOT}/skills/arkitect-excalidraw`.

The shipped house style already carries real evidence: version 1, 9 scenes,
3,270 elements, learned 2026-09-08. (Before that first learning run,
`source-analysis.json` was version 0 with an empty corpus and every convention
marked `default` — that state shipped in older releases and would reappear if
the file were deleted, but it is not what a fresh install of this repository has
today.) This skill does not change that record. It builds the **user's own**,
and a further run merges into theirs.

**Where it goes.** Everything this skill writes lives in the user's store,
`~/.arkitect/excalidraw/` (`$ARKITECT_HOME/excalidraw/` when that is set) —
outside the plugin, so a plugin update or reinstall never wipes it:

| file | what |
|---|---|
| `source-analysis.json` | the evidence record, built from the designated scenes only |
| `sources.json` | the designated paths, written by `build-knowledge.mjs` |
| `style-notes.md` | prose: only where these scenes differ from the shipped guide |
| `patterns.md` | prose: recurring layouts the shipped catalog lacks |
| `renders/` | scratch renders of the examples |

The drawing skill reads `style-notes.md` and `patterns.md` after the shipped
guides, and they win where the two conflict — that is how what is learned here
reaches the next scene. Excalidraw has no apply step yet (a follow-up to #89),
so nothing here changes the generator's tokens.

## Rules

- **Read-only.** Never modify, rename, move or reformat an example. Record its
  SHA-256 before and after and confirm they match.
- **Explicit designation only.** The user names the files. Do not scan
  directories for candidates.
- **Nothing confidential enters the plugin.** Element text, file names, paths,
  frame names, links and image payloads stay out of it. `build-knowledge.mjs`
  enforces this for the record — structural statistics, style-token counts and
  digests only.
- **Learning never edits the plugin.** Not `references/`, not a script, not a
  committed example. That is maintenance, below.
- **Preserve prior knowledge.** Use `--merge` so the record keeps its version
  history instead of being replaced.
- **Contradiction is data.** If a new example disagrees with an existing rule,
  record both readings and lower the confidence. Do not quietly rewrite history
  to make the corpus look consistent.

## Steps

0. **Earlier designations.** If the store has no `sources.json` but
   `${CLAUDE_PLUGIN_ROOT}/.analysis/sources.local.json` exists, it lists scenes
   designated before the store existed. Offer to include its `excalidraw` paths
   in this run. Only copy the paths — never move or delete that file: in a git
   checkout it is also the test suite's corpus.

1. Confirm each path exists and record hashes:
   ```bash
   sha256sum "<example.excalidraw>"
   ```
   If the files live under OneDrive they may be cloud-only placeholders, and
   every read fails with *"the cloud file provider is not running"* or *"the
   cloud operation failed"* — the bytes are not on the disk. Check with
   `Get-ChildItem … | Select Attributes`: bit `0x400000` set means cloud-only.
   Start `OneDrive.exe`, then open each file once to pull it down; retry a few
   times, since the provider refuses requests while it is still waking up.

2. Summarize each one without pulling the JSON into context:
   ```bash
   node scripts/analyze-excalidraw.mjs "<example.excalidraw>" --out /tmp/new-example.json
   ```
   A scene with embedded images is megabytes of base64; reading one whole would
   blow up the context and put diagram text into it.

3. **Look at it.** Render and inspect the image before drawing any conclusion
   about layout — the numbers say how far apart things are, not whether it
   reads well:
   ```bash
   node scripts/render-excalidraw.mjs "<example.excalidraw>" --out-dir "$HOME/.arkitect/excalidraw/renders"
   ```

4. Rebuild the record over the whole corpus — every designated scene, including
   the ones already in `sources.json`:
   ```bash
   node scripts/build-knowledge.mjs --sources <every example path> --merge
   ```
   This writes `source-analysis.json` and `sources.json` in the store, bumps
   `version`, appends to `history`, and recomputes every convention's evidence
   count and confidence level.

   Read the `roles` tallies, not the whole-scene ones. A scene's raw style
   counts are dominated by the line segments inside library icons; `roles`
   separates arrows, authored text, authored shapes and boundary boxes.

5. Update the user's prose where the evidence actually moved:
   - `style-notes.md` — only rules where these scenes differ from
     `references/style-guide.md`, with the new counts and confidence.
   - `patterns.md` — a genuinely new recurring layout.

   Do not restate a convention whose confidence did not change.

   Things worth looking for that the tallies alone will not tell you: whether
   boundaries are frames, scope rectangles or just proximity; whether icons are
   traced, embedded or library items; whether arrows are bound or free; whether
   labels are bound to shapes or floating; whether the canvas is on a grid.

6. Report: what was learned, which conventions changed confidence, which
   contradicted the house style or earlier evidence, and anything the corpus
   does that the generator cannot yet produce.

## Maintaining the shipped house style

Only for a maintainer changing this repository in a reviewed pull request —
never part of a user's learning run. The shipped record is rebuilt from the
maintainer's corpus, listed in the checkout's gitignored
`.analysis/sources.local.json`, with an explicit `--out`:

```bash
node scripts/build-knowledge.mjs --sources <every example path> --merge --out references/source-analysis.json
```

Then:

1. **Change the generator, not just the prose.** A convention that moved and is
   not reflected in `STYLE` / `EDGE_KINDS` in `build-diagram.mjs` has been noted
   and not learned; the next diagram will still come out in the old style. Where
   the corpus needs a field the core does not emit, add it — and verify the field
   set against an element the app itself wrote, which the corpus is full of.
   That is the only in-repo check available for a format detail.

2. Update `references/style-guide.md` with the new counts (**remove the "these
   are defaults" banner once there is a real corpus**, and replace each `default`
   basis with its evidence), `references/pattern-catalog.md` for a new layout, and
   `arkitect-excalidraw/SKILL.md` only for findings that change what the agent
   must do.

3. Rebuild **both** committed worked examples, so the shipped examples are in
   the learned style rather than the previous one:
   ```powershell
   foreach ($n in 'starter-architecture', 'aws-data-platform') {
     node scripts/build-diagram.mjs "assets/templates/$n.spec.json" `
       --out "assets/templates/$n.excalidraw" --force
     ./scripts/render-excalidraw.ps1 -Path "assets/templates/$n.excalidraw" -OutDir assets/templates
   }
   ```
   Delete the `*.backup-*.excalidraw` siblings they leave behind. Look at both
   PNGs afterwards: a style change that makes the small example look fine can
   still break the large one, where regions are narrow and edges are crowded.

4. Re-run the suite — the redaction check regenerates from the corpus:
   ```bash
   node tests/run-tests.mjs
   ```
