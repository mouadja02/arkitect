# Arkitect — agent contract

You have Arkitect available. It draws **native, editable architecture diagrams**:
`.drawio` (Draw.io / diagrams.net) and `.excalidraw` (Excalidraw). Both are real
source files the human can open and keep editing — never a screenshot, and never
Mermaid handed over as the final artifact.

This file is the whole contract for agents that read `AGENTS.md` (Codex,
OpenCode, Cursor, Copilot, Antigravity, Pi, and most others). Claude Code loads
the same knowledge as skills; see `skills/*/SKILL.md`, which go deeper.

`ARKITECT_ROOT` below means this repository's directory. Every path is relative
to it, and every command is Node 20+ with **no dependencies to install**.

---

## What Arkitect optimises for — this does not get traded away

Two constraints govern every change, and they outrank any feature:

1. **Stay functional and lightweight.** No dependencies, no services, no build
   step — Node 20+ and the files in this repository.
2. **Work with whatever model is driving.** A small local model must get a good
   diagram out of this, not only a frontier one.

What follows from them, and why:

- **Context is the scarce resource.** Every byte a skill makes an agent read
  competes with the user's own architecture for the same window. A sentence
  earns its place only if it changes what gets drawn. The per-skill reading
  budget is measured and enforced, not aspirational — see `docs/maintenance.md`.
- **The scripts do the thinking that needs no model.** Layout, icon resolution,
  validation, backups and pruning are code, so the model spends its budget on
  the user's system rather than on geometry it would get wrong.
- **Deterministic beats clever.** A check a script can make is never left to the
  model, and never left to an LLM judge.
- **Every capability the docs promise must be reachable** by the documented
  route, or the promise comes out of the docs.

A change that adds weight, adds a dependency, or works only because a large
model papers over it does not ship — however good the output looks.

---

## 1. Pick the engine

| | Draw.io (`.drawio`) | Excalidraw (`.excalidraw`) |
|---|---|---|
| looks like | crisp, formal, vendor icons | hand-drawn, sketchy |
| best for | solution architecture for a client or a review board, AWS-heavy designs, multi-page decks, as-is/to-be comparisons | system design, whiteboard-style architecture, component and block diagrams, flows and decision paths, anything for a README |
| icons | 18 packs, 4,843 marks — 311 AWS Architecture Icons, Azure, Google Cloud and curated product packs — + built-in `mxgraph.aws4.*` + real product logos fetched from the web | 1,162 native items across 36 bundled libraries plus the 4,843 shared marks as embedded original artwork |
| edit later in | Draw.io Desktop or the VS Code extension, never the hosted editor | the Excalidraw container this repo ships, or excalidraw.com |

If the person did not say which, ask once in a single line, or infer: "solution
architecture", "for the client", "AWS" → Draw.io. "system design", "quick",
"sketch", "for the README" → Excalidraw. Say which you chose and why.

## 2. The loop, both engines

1. **Interview until you both mean the same thing.** A diagram is a claim about
   someone's system, and a wrong claim drawn beautifully gets believed. Ask one
   question at a time, each carrying your recommended answer, walking the design
   tree in dependency order: purpose and audience, scope boundary, level of
   abstraction, as-is or to-be, the components by their real product names, the
   flows worth drawing, the trust boundaries, what must be visible, pages, and
   how to treat what the user does not know. Stop when the remaining unknowns
   could not change the drawing — a three-box flowchart needs two questions, a
   review-board architecture needs the ladder. When the request already names
   the components and flows, or nobody is there to answer, do not ask: draw,
   and state every assumption. Never interrogate anyone about
   styling; that is what Arkitect is for. The full ladder is in each engine's
   SKILL.md under "Interview first".
2. **Pick a pattern.** `skills/arkitect-<engine>/references/pattern-catalog.md`
   holds the reusable layouts. State every architectural assumption you make;
   they go into your report and, where they matter, into a note on the canvas.
3. **Resolve icons before laying out.** A diagram of grey boxes is not worth
   drawing. See §4.
4. **Write a spec, then build.** Both engines generate from a small JSON spec —
   the normal route for every new diagram. This is what applies the style,
   keeps the layout collision-free and keeps base64 out of your context.
   Hand-written XML/JSON is a narrow exception — only when the spec format
   genuinely cannot express what you need, or for a targeted edit to an
   existing file (§5) — never how a new diagram gets built. A spec whose
   edges or parents name something that does not exist, or whose numbers are
   not numbers (a string `col`, a size of 0 or less), is refused before
   anything is written, every problem listed; fix the spec, never drop the edge.
   A missing `col` or `row` is 0.
   A `kind` the builder does not know still builds, drawn as a default, and is
   listed under `unknownKinds` in the report; treat a non-empty list like an
   unresolved icon: fix the spec, or report it. Run `drawio build --print-style`
   or `excalidraw build --print-style` before writing the spec: an install can
   carry the user's own applied style, where an edge `kind` may mean something
   else or extra kinds exist — pick kinds by their `meaning` there.
5. **Never overwrite blind.** Both builders write a timestamped sibling backup
   before replacing an existing file, then keep the oldest backup and the newest
   five of that file and delete the rest, listed under `pruned` in the report
   (`--keep-backups N`; `0` keeps all). Suggest `*.backup-*` for the project's
   `.gitignore`. Any other edit route means `arkitect <engine> backup <file>`
   before the first write.
6. **Validate.** Errors block delivery. Warnings about overlap and tight labels
   are judgement calls — check them against the render.
7. **Render it and actually look at the PNG.** Read the image back. Iterate on
   spacing, hierarchy, routing and label legibility. A diagram that validates
   but reads badly is not done.
8. **Report.** File path, assumptions, validation and render results, which
   icons came from where, anything unresolved, and any deliberate deviation
   from the style guide.

## 3. Commands

One dispatcher covers both engines:

```bash
node bin/arkitect.mjs                              # every command, one screen
node bin/arkitect.mjs doctor                       # what is installed, what is optional

# Draw.io
node bin/arkitect.mjs drawio icon "bedrock"                     # search the AWS palette
node bin/arkitect.mjs drawio logo --url <https url> --name snowflake
node bin/arkitect.mjs drawio build --print-style                 # the style this install draws with
node bin/arkitect.mjs drawio build spec.json --out docs/arch.drawio
node bin/arkitect.mjs drawio validate docs/arch.drawio
node bin/arkitect.mjs drawio analyze docs/arch.drawio --page 0 --cells

# Excalidraw
node bin/arkitect.mjs excalidraw icon "postgres"                # native libraries + shared packs
node bin/arkitect.mjs excalidraw libraries --unnamed
node bin/arkitect.mjs excalidraw build --print-style             # the style this install draws with
node bin/arkitect.mjs excalidraw build spec.json --out docs/arch.excalidraw
node bin/arkitect.mjs excalidraw validate docs/arch.excalidraw
node bin/arkitect.mjs excalidraw render docs/arch.excalidraw --out-dir .analysis/renders   # PNG
```

Rendering a `.drawio` to PNG uses local Draw.io Desktop on Linux/macOS/Windows:

```bash
node bin/arkitect.mjs drawio render docs/arch.drawio --all --out-dir .analysis/renders
```

The Node helper discovers the app and uses Xvfb on headless Linux when available.
Page numbers are always 0-based. The portable Node helper validates the page
number, copies that page verbatim into a temporary single-page file with the
original mxfile attributes, exports without Desktop's unstable `--page-index`,
and deletes the temporary file. Compressed page bytes stay unchanged; no
platform/version guesses or probing. `--page-index-passthrough` is an explicit
debugging escape hatch, not the normal rendering path.
The Windows original `skills/arkitect-drawio/scripts/render-drawio.ps1`
remains supported, with its parameters unchanged, as a thin adapter over the
Node renderer, so a failed export can never be reported as a render (#157). See `docs/cli.md` for overrides and troubleshooting.
Excalidraw renders with `arkitect excalidraw render`, no app required: `--out-dir DIR`
writes `<name>.png` using a local Edge, Chrome or Chromium (pin one with
`--browser` or `ARKITECT_BROWSER`), `--out FILE.svg|FILE.png` picks the format
by extension, and `--format svg` needs no browser at all.

Draw.io generator changes must be built, validated, rendered and visually
inspected before a PR. A render of a real or user diagram stays local — never
commit it, never attach it to a PR; real architecture stays local, full stop.
The deliberate exception is the committed template PNGs and contact sheets
under `skills/*/assets/` — refresh those in the same PR whenever generator
output changes, and only those public, template-derived renders may be
attached to or referenced from a PR (see `docs/maintenance.md`). If a host
update breaks rendering, report 🔴 and explicitly fall back to validate-only
until repaired; do not silently omit visual verification.

Every script also runs directly out of `skills/*/scripts/` if you prefer.
Full reference: `docs/cli.md`.

## 4. Icons — the rule that matters most

**Draw.io:** search the bundled packs first (`drawio icon "<product>"` — one
search across all 18 packs: AWS, Azure, Google Cloud and curated packs for
data platforms, databases, AI frameworks, DevOps, security, GitHub, SaaS,
languages, file types and agent concepts, not AWS alone). Most named
products — Snowflake, Grafana, Databricks, Postgres included — are already
bundled. Only for the minority the search reports as on-demand or unmatched,
fetch the **real logo** and embed it (`drawio logo --url …`, or the exact
`fetch-logo` command the search names for an on-demand mark with
`artwork: "pinned"`; one with `artwork: "none pinned"` has nothing to fetch and
stays a named placeholder). Last resort, and only then: a
built-in `mxgraph.aws4.*` shape, the Draw.io MCP `search_shapes` tool, or a
plain labelled box named in the report. A grey box labelled "Snowflake" when a
bundled mark existed is a regression, not a safe default. A match that carries
`lifecycle` names a product that was discontinued, renamed, absorbed or acquired:
draw it if that is what the system runs, and repeat its caveat in your report.

**Excalidraw:** the 36 bundled libraries first (`excalidraw icon`). 239 items
carry no name; find those by reading the numbered contact sheets in
`skills/arkitect-excalidraw/assets/libraries/bundled/sheets/` and referencing
`<slug>:<n>`. Shared packs fill gaps using original embedded SVG/PNG artwork;
select an exact mark with `drawio:<pack>/<slug>`. Existing successful native
choices keep their precedence. The image, caption and connections stay editable,
but the logo's paths are not native strokes. No tracing or download is involved;
on-demand marks remain unavailable. See `docs/shared-icons.md` for terms.
If nothing matches, use an honest **placeholder** — a dotted slot
with a `?`, named in the build report — and say so. Only build an icon from a
logo (`excalidraw make-icon --url … --trace`) when asked.

**Never substitute one product's mark for another.** A placeholder is honest; a
wrong logo is a lie that survives into someone's slide deck.

## 5. Editing an existing diagram

Never read a whole diagram into context. Both formats embed images as base64 and
run to megabytes; one file can blow your entire window.

```bash
node bin/arkitect.mjs drawio analyze <file> --page 0 --cells     # geometry, no labels
node bin/arkitect.mjs excalidraw analyze <file> --cells
node bin/arkitect.mjs drawio backup <file>                       # before the first write
```

Then make a targeted, backup-protected edit and re-validate. **Match the file
you are editing, not the style guide** — if the existing diagram uses sharp
corners and no roughness, so does your addition. Say in the report that you
followed the file.

## 6. Privacy — non-negotiable

- Diagrams stay on the machine. Nothing is uploaded, ever.
- With the Draw.io MCP server connected, use only `list_pages`, `get_page`,
  `set_page`, `search_shapes`. **Never** call `open_drawio_xml`,
  `open_drawio_csv` or `open_drawio_mermaid` on anything derived from the user's
  content — those open the hosted editor and would send private architecture off
  the machine.
- Only two things ever reach the network, both public: a product logo you were
  asked to fetch, and the public Excalidraw library catalogue. Search the
  **product name alone**. Never put a customer name, project codename, hostname
  or anything else from the diagram into a query or a URL.
- The learning skills (`learn-drawio-style`, `learn-excalidraw-style`) and the
  apply skills (`apply-drawio-style`, `apply-excalidraw-style`) are user-invoked
  only. Never learn from a diagram just
  because you read one, and never apply learned style unasked.

## 7. Non-negotiables

- Editable `.drawio` XML / `.excalidraw` JSON is the deliverable.
- Icons and images **embed in the file**, never link, so it opens for anyone.
- Real icons for named products; an obvious placeholder where none exists.
- Every Excalidraw arrow bound at both ends, so the scene survives being dragged
  around. Draw.io edges connected at both ends, orthogonal routing.
- A legend whenever more than one connector kind is used.
- Assumptions written on the canvas, not only in chat.
- Look at the render before you call it done.

## 8. Deeper reading

| | |
|---|---|
| `skills/arkitect-drawio/SKILL.md` | the full Draw.io workflow |
| `skills/arkitect-excalidraw/SKILL.md` | the full Excalidraw workflow |
| `skills/*/references/{editing,icons,rendering}.md` | editing an existing file, icons beyond the first search, render troubleshooting |
| `skills/*/references/style-guide.md` | the style rules and the evidence behind each |
| `skills/*/references/pattern-catalog.md` | the reusable layouts |
| `skills/arkitect-excalidraw/references/excalidraw-format.md` | the scene format, for hand-editing |
| `skills/*/assets/templates/*.spec.json` | worked spec examples, with the PNG beside them |
| `docs/` | install, agent setup, MCP, Docker, CLI, icons, testing |

**Look at the example PNGs before writing your first spec.** It is faster than
reasoning about the rules, and it is what the output is supposed to look like.
