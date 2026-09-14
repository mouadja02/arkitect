# The house style, and replacing it with yours

Arkitect does not ask you what colour the boxes should be. It applies a style,
and it can tell you where every rule came from.

## What ships

Each engine carries three reference files:

| | |
|---|---|
| `references/style-guide.md` | the rules in prose, each with its evidence count and a confidence level |
| `references/pattern-catalog.md` | the reusable layouts — what to reach for and when |
| `references/source-analysis.json` | the machine-readable record: full distributions, per-rule confidence, corpus digests |

Confidence is **high** (dominant and consistent), **medium** (a clear preference
with real variation), **low** (a weak signal — treat it as a hint), or
**default** (the corpus does not settle it; the rule rests on the tool's own
defaults and ordinary practice).

That last one matters. A rule marked `default` is not an observation dressed up
as one, and the agent is instructed to say which is which if you ask.

## What the record does *not* contain

No labels. No page names. No file names, paths, hostnames or URLs. No image
payloads. Nothing from any diagram's content.

What it holds is structural: counts of shapes and edges, style-token
distributions (`fontSize`, `strokeColor`, `fillStyle`, routing kinds), geometry
quantiles, and a SHA-256 per source file as an integrity anchor. A test asserts
this on every run, and the analyzers are written so that element text never
reaches the record in the first place.

```bash
node -e "const r=require('./skills/arkitect-drawio/references/source-analysis.json'); \
console.log('v'+r.version, r.corpus.files+' files,', r.conventions.length+' conventions'); \
for (const c of r.conventions) console.log(' ', c.confidence.padEnd(7), c.id)"

node bin/arkitect.mjs excalidraw learn --print
```

## Some findings contradict what a generator would do

That is the point of learning a style instead of inventing one. In the
Excalidraw record, four of them change the output the most, and they are already
the generator's defaults — do not undo them by hand:

- **Connectors are elbow arrows** at stroke width 4.
- **Edge captions are free text beside the line**, not labels bound to the arrow.
- **Regions are dashed rectangles, not frames** — 21 of them, zero frames.
- **Captions sit below the shape** as free text at size 20.

On the Draw.io side the equivalents are orthogonal routing, square corners, no
shadows, captions under icons, `#232F3E` text, and a two-size type scale (12px
body, 16px headings) that does all the work.

## Making it yours

Up to three steps, each one only when you ask for it.

**1. Learn.** Point a learning skill at diagrams you have already drawn:

```
/learn-drawio-style

Learn the style from these:
  C:\path\to\first.drawio
  C:\path\to\second.drawio
```

```
/learn-excalidraw-style

Learn the style from these:
  C:\path\to\first.excalidraw
```

What they do, in order: hash each file; summarize it *without* loading the
XML/JSON into context; render it and look at the image; build your own record
across the whole corpus; then write down where your diagrams differ from the
house style. Your files are read-only throughout — hashes are checked before and
after.

**2. Nothing has changed yet.** Learning records evidence. For Draw.io it also
records *findings*: each place your corpus contradicts the house style, with its
confidence and evidence count. For both engines, your prose notes are read by
the drawing skill after the shipped guide.

**3. Apply (Draw.io).** Choose which findings this install draws with:

```
/apply-drawio-style
```

It offers only the findings that contradict what is drawn now, strongest first,
walks you through them one at a time, writes the ones you pick and reports
exactly what changed. From then on every build picks them up. `node
bin/arkitect.mjs drawio apply --reset` goes back to the house style, and
`--defaults` on a single build ignores your choices.

All three skills carry `disable-model-invocation: true` — they change what your
install knows or draws, so they never fire on their own. Reading or discussing a
diagram never triggers one.

## Where your style lives

In `~/.arkitect/<engine>/` — set `ARKITECT_HOME` to move `~/.arkitect` — outside
the plugin, so updating or reinstalling Arkitect never wipes it:

| file | what |
|---|---|
| `source-analysis.json` | your record: structural statistics from your corpus only |
| `sources.json` | the files you designated — paths, so it stays local |
| `findings.json` | Draw.io: where your corpus contradicts the house style |
| `style-notes.md`, `patterns.md` | prose the drawing skills read after the shipped guides; yours win |
| `style-overrides.json` | Draw.io: what you chose with `/apply-drawio-style` |

None of this touches the shipped `references/` files.

By hand:

```bash
node bin/arkitect.mjs drawio learn     --sources "C:\a.drawio" "C:\b.drawio" --merge
node bin/arkitect.mjs drawio findings  --derive
node bin/arkitect.mjs drawio apply     --list
node bin/arkitect.mjs drawio build     --print-style
node bin/arkitect.mjs excalidraw learn --sources "C:\a.excalidraw" --merge
```

**`--merge` is what preserves prior knowledge.** It bumps `version`, appends to
`history`, and recomputes every convention's evidence count and confidence.
Omit it and you replace the record instead of extending it.

## What an override can change

Draw.io only, for now; Excalidraw's apply step is a follow-up. An override is
named values, never a raw style string, so a bad one cannot produce a broken
cell — it is ignored whole, with a one-line warning, and the build uses the
house style.

- **Tokens** — text and semantic colours, body, heading and edge-label font
  sizes, icon size and grid pitch, corner rounding, note colours, scope stroke
  width and dash pattern.
- **Edge kinds** — the colour, dash, width and legend meaning of `flow`,
  `async`, `error`, `success` and `light`, and new kinds of your own. A shipped
  kind can be restyled but never removed, so every spec keeps building.

Never: which icon or logo stands for a product, AWS shape internals, orthogonal
routing or arrowheads. Anything a spec sets itself still wins over an override.

## Contradiction is data

If a new example disagrees with an existing rule, the record keeps **both
readings and lowers the confidence**. It does not quietly rewrite history to make
the corpus look consistent. A rule that drops from `high` to `medium` because
your diagrams do something different is the system working.

## Changing the house style itself

That is a pull request, not a learning run. A convention that moved and is not
reflected in the generator has been *noted*, not *learned* — the next diagram
still comes out in the old style. The shipped tokens live in `STYLE` and
`EDGE_KINDS` in Excalidraw's `build-diagram.mjs`, and in `T` and `EDGE_KINDS` in
Draw.io's `scripts/lib/style-tokens.mjs`. See [maintenance.md](maintenance.md).

After a style change, rebuild the committed worked examples — Draw.io with
`--defaults` — so the shipped templates are in the new style, and look at both
PNGs. A change that makes the
small example look fine can still break the large one, where regions are narrow
and edges crowded.

## Patterns

`pattern-catalog.md` is the other half. It holds the layouts that recur —
left-to-right pipeline, phase columns, external systems column, error lane with
a recovery loop, cross-cutting band, as-is/to-be comparison — with the spec
fragments to build them in `assets/templates/patterns.json`.

Pick the nearest pattern before laying anything out. It is the difference
between a diagram that reads and a diagram that merely contains the right boxes.
