---
name: arkitect-excalidraw
description: Create or edit editable Excalidraw (.excalidraw) diagrams — system and solution architectures for any cloud or stack, software component and block diagrams, data pipelines, agentic/LLM systems, network and deployment views, flows and decision paths — in a hand-drawn house style, using Excalidraw's own default libraries plus custom icons built from real product logos. Use whenever the request involves an Excalidraw scene or library, an architecture or block diagram wanted in a sketchy style, an icon built from a product logo, or an edit to an existing .excalidraw file.
---

# Architecture diagrams in Excalidraw

Produces native, editable `.excalidraw` JSON — never a flattened image, never
Mermaid as the final artifact. Any cloud, any stack. The builder applies the
house style, binds the arrows and embeds the icons; you write a small JSON spec.
Scripts live in `${CLAUDE_PLUGIN_ROOT}/skills/arkitect-excalidraw/scripts`.

## What to read

Read only what the task needs. Every path is relative to this skill.

| Task | Read |
|---|---|
| Draw a new scene | this file, the one pattern you pick in step 2, and one worked example (step 4) |
| Edit an existing `.excalidraw` | `references/editing.md` |
| An item the search cannot find, an unnamed library item, a logo, a public library | `references/icons.md` |
| Rendering fails, or the user wants the real app | `references/rendering.md` |
| Hand-written scene JSON | `references/excalidraw-format.md` |
| A deliberate deviation from the house style, or its evidence | `references/style-guide.md` |

If `~/.arkitect/excalidraw/style-notes.md` or `patterns.md` exist
(`$ARKITECT_HOME/excalidraw/` when set), read them too: they are what
`/learn-excalidraw-style` found in the user's own scenes, and they win over the
shipped guide. Say so in the report.

The builder already draws what the corpus does and a generator would not:
elbow arrows at stroke width 4, edge captions as free text beside the line,
regions as dashed rectangles rather than frames, and captions below the shape.
Do not undo them by hand.

## Workflow

1. **Interview first** (below). Do not draw while a branch that would change the
   drawing is unresolved.

2. **Pick a pattern and state assumptions.** Choose the nearest row, then read
   only that `## N.` section of `references/pattern-catalog.md`:

   | # | Use for | # | Use for |
   |---|---|---|---|
   | 1 | a source → sink pipeline | 10 | legend and annotation |
   | 2 | a scope, trust or bounded-context box | 11 | several sources converging on one store |
   | 3 | tiered frames: frontend / backend / data | 12 | tables or topics inside one product |
   | 4 | a request path with a decision | 13 | two or three big phases (CI and CD) |
   | 5 | current vs proposed | 14 | one tool fanning out to many artefacts |
   | 6 | external systems you do not own | 15 | a naming convention beside the architecture |
   | 7 | the inside of one service, block diagram | 16 | two diagrams sharing one canvas |
   | 8 | an agentic or LLM system | 17 | components collected, not yet wired |
   | 9 | a protocol where order is the point | | |

   Patterns 11–17 are the shapes the reference corpus repeats: prefer one when
   the system fits it. Spec fragments are in `assets/templates/patterns.json`.
   Write every architectural assumption down; it goes in the report and, where
   it matters, in a note on the canvas.

3. **Resolve icons — bundled libraries first.**
   ```bash
   node scripts/find-icon.mjs "postgres"
   ```
   Put the ref from a match in the spec: `"icon": "data-platform:9"`. A node
   that only names its component is resolved by product name alone, never by a
   name that merely appears inside another product's; the search says up front
   what a node would draw (`"draws"`) or why it gets a placeholder. Shared packs
   fill gaps with embedded original artwork (`"icon": "drawio:databases/postgresql"`).
   Still short? Some library items carry no name — `references/icons.md` says how
   to find them. **Otherwise use a placeholder and move on**: `kind: "placeholder"`,
   or an unresolvable `icon`, draws a dotted `?` slot captioned with the
   component and listed under `placeholders` in the build report. Do not fetch a
   logo unless the user asks, and **never** use one product's mark for another.

4. **Build from a spec.** First see which style this install draws with:
   ```bash
   node scripts/build-diagram.mjs --print-style
   node scripts/build-diagram.mjs my-spec.json --out "path/to/architecture.excalidraw"
   ```
   With `"source": "override"` the user applied their own conventions: pick each
   edge `kind` by its `meaning` there, and do not fight the tokens it changed. A
   non-empty `style.errors` in the build report means the override was ignored:
   tell the user. Never pass `--defaults` for a user's scene.

   **Look at one worked example's PNG before writing a spec**, then read its spec:
   `assets/templates/starter-architecture.spec.json` for the vocabulary (every
   node and connector kind), or `assets/templates/aws-data-platform.spec.json`
   for the shape of a large real answer (regions per phase, sublabels, an error
   lane, assumptions on the canvas, fractional `col`/`row`).

   The build refuses, before writing anything and listing every problem
   (exit 1), a spec whose edges or parents name something that does not exist,
   or whose numbers are not numbers (a string `col`, a size of 0 or less). Edges
   connect nodes, not boundaries. Fix the spec; never drop the edge. A missing
   `col` or `row` is 0. An unknown node or edge `kind` still builds and is listed
   under `unknownKinds`: fix it or report it. Hand-written JSON is only for what
   the spec cannot express — see `references/editing.md`.

5. **Never overwrite blind.** The builder backs up an existing file first and
   keeps the oldest backup plus the newest five (`--keep-backups N`; `0` keeps
   all). Suggest `*.backup-*` for the user's `.gitignore`.

6. **Validate.**
   ```bash
   node scripts/validate-excalidraw.mjs "path/to/architecture.excalidraw"
   ```
   Errors block delivery. Overlap and tight-label warnings are judgement calls:
   check them against the render.

7. **Render and look at it.**
   ```bash
   node scripts/render-excalidraw.mjs "path/to/architecture.excalidraw" --out-dir .analysis/renders --width 2200
   ```
   Needs a local Edge, Chrome or Chromium; with none it exits 1 — fall back to
   `--format svg` and say you could not look at a PNG. Read the PNG back and
   iterate; a scene that validates but reads badly is not done. The preview is
   geometry-faithful, not font-faithful: judge layout, not typography. Three
   things the first render nearly always shows, each fixed in the spec:
   - a one-column region's long label runs into the next: name it in one or two
     words and let sublabels carry detail;
   - an elbow route drawn straight through a third icon: `"route": "straight"`
     on that edge;
   - adjacent elbows stacking into one phantom line: `"route": "straight"` on
     one of them.

8. **Open it in the real app** when the user wants to see or edit it, and before
   claiming it looks right in Excalidraw itself: `references/rendering.md`.

9. **Report.** File path, assumptions made, validation and render results,
   which icons came from where, every placeholder, anything unresolved, and any
   deliberate deviation from the style guide.

## Interview first

A diagram is a claim about someone's system; a wrong claim drawn well gets
believed. Ask **one question at a time**, each with your **recommended answer**
and a one-line reason, in dependency order, feeding answers forward. **Never ask
about styling** — that is this skill's job. Skip a branch the request already
answers or that cannot change the drawing:

1. **Purpose and audience** — who reads it, what decision it supports. Everything below depends on it.
2. **Scope** — what is inside, and what is deliberately outside.
3. **Level** — one box per service, container or team; never mixed.
4. **State** — as-is, to-be, or both (two pages or one comparison).
5. **Components by real product name** — "Snowflake", not "the warehouse"; this decides the icons.
6. **Flows** — what moves, which way, sync or event-driven; only those worth an arrow.
7. **Boundaries** — trust, network, ownership, account; they become the containers.
8. **What must be visible** — failure paths, multi-region, HA/DR, a control under review.
9. **Pages** — split by lifecycle stage or audience, not by how much fits.
10. **Unknowns** — agree up front: a stated assumption or a labelled placeholder, never invention.

**Stop when** the remaining unknowns could not change the drawing: a three-box
flow needs two questions, a review-board architecture needs the ladder. Write
the answers down; they are the report's assumptions and the canvas note.

## Safety — always

- The user's scenes stay on the machine. Nothing is uploaded; the local
  Excalidraw container has no backend.
- The only network requests are public logos and the public library catalogue,
  and only when asked. Search the product name alone — never a customer,
  codename, hostname or anything else from the diagram.
- Never read a whole existing scene into context; embedded images run to
  megabytes of base64. `references/editing.md` says how to work on one.

## Non-negotiables

- Editable `.excalidraw` JSON is the deliverable; images embed in the scene's
  `files`, never linked.
- Every arrow bound at both ends, so the diagram survives being dragged around.
- Real icons for named products, bundled libraries first; where none exists, an
  obviously empty placeholder, named in the report — never another product's
  mark, never a grey box passed off as finished.
- Excalidraw's font-size steps and stroke widths; its palette plus the house
  accents, and a product's own brand colour where the diagram is about it.
- A legend whenever more than one connector kind is used; assumptions on the
  canvas.
- Connector meanings, colours, routing, strokes, fills and corners follow the
  house style unless this install's applied override (`--print-style`) says
  otherwise.
