# CLI and spec format

Every Arkitect command is a Node script behind one dispatcher. `arkitect` below
means the npm install, or `node bin/arkitect.mjs` from a clone
([install.md](install.md)).

```bash
arkitect                     # every command, one screen
arkitect doctor              # what is installed, what is optional
arkitect where               # the install path
arkitect install --all       # agent adapters for this project
arkitect test                # the offline suite (clone only)
arkitect version
```

A command's own help is one level down: `arkitect drawio icon --help`.

## Draw.io

```bash
arkitect drawio icon "bedrock"                         # search all 18 packs
arkitect drawio icon "bedrock" --compact               # verdict and a spec node, one line
arkitect drawio icon "cloud run" --context gcp         # settle ties toward a stack
arkitect drawio icon --list-packs
arkitect drawio logo --url https://.../logo.svg --name snowflake
arkitect drawio build spec.json --out docs/arch.drawio
arkitect drawio build spec.json --out docs/arch.drawio --defaults   # house style, ignoring yours
arkitect drawio build --print-style                    # the style a build would use
arkitect drawio validate docs/arch.drawio              # --page N, --strict, --json
arkitect drawio render docs/arch.drawio --all --out-dir .analysis/renders
arkitect drawio analyze docs/arch.drawio --page 0 --cells
arkitect drawio analyze docs/arch.drawio --find "Checkout API"
arkitect drawio backup docs/arch.drawio                # before an edit the builder doesn't make
arkitect drawio packs --verify                         # committed packs against their pins
arkitect drawio sheets --pack azure                    # a pack as a labelled grid
arkitect drawio learn --sources <files> --merge        # your style record
arkitect drawio findings --derive
arkitect drawio apply --list                           # --accept <ids>, --reset
```

## Excalidraw

```bash
arkitect excalidraw icon "postgres"                    # libraries, then shared packs
arkitect excalidraw icon --resolve gcp-icons:37        # what a spec node would draw
arkitect excalidraw libraries --unnamed                # items to find on a contact sheet
arkitect excalidraw browse --search "kubernetes"       # the public catalogue
arkitect excalidraw make-icon --url https://.../dbt.svg --name dbt --trace
arkitect excalidraw build spec.json --out docs/arch.excalidraw
arkitect excalidraw build spec.json --out docs/arch.excalidraw --seed 7   # same bytes every time
arkitect excalidraw build --print-style
arkitect excalidraw validate docs/arch.excalidraw
arkitect excalidraw render docs/arch.excalidraw --out-dir .analysis/renders
arkitect excalidraw analyze docs/arch.excalidraw --cells
arkitect excalidraw backup docs/arch.excalidraw
arkitect excalidraw learn --sources <files> --merge
arkitect excalidraw findings --derive
arkitect excalidraw apply --list
```

## Behaviour both engines share

- **Arguments are strict.** An unknown flag, a missing value, a repeated flag or
  a stray file exits `2` with one line, before anything is read or written.
  Flags may come before or after files.
- **A bad spec is refused whole.** An edge or `parent` naming something that
  doesn't exist, a missing, repeated or reserved id, a string where a number
  goes, a size of 0 or less: every problem is listed at once, exit `1`, nothing
  written.
- **An unknown kind or field still builds,** and the report lists it under
  `unknownKinds` or `unknownFields`. Treat a non-empty list as something to fix.
- **Backups.** A build copies an existing target to
  `<name>.backup-YYYYMMDD-HHMMSS.<ext>` first, then keeps the oldest backup and
  the newest five (`--keep-backups N`, `0` keeps all). `arkitect <engine>
  backup <file>` does the same for any other edit. Add `*.backup-*` to your
  `.gitignore`, and `.$*.bkp`: the autosave Draw.io Desktop leaves beside a
  file it has open.
- **Your style.** A build merges your override from `~/.arkitect/<engine>/`
  and says so under `style`. `--defaults` ignores it; use it for anything
  committed. A broken override is ignored whole, with one warning.
- **Pages are 0-based** everywhere: `--page`, the analyzer, renders' `.pN`
  names.
- A JSON file may start with a UTF-8 byte order mark.

## The build report

Both builders print a JSON report. Beyond the file written and its backup:

| key | lists |
|---|---|
| `icons` | what resolved and from where; Draw.io adds `missing`, `ambiguous`, `needsFetch`, `sameArtwork` and `lifecycle`, Excalidraw `selfCaptioned` and `opaqueBackground` |
| `placeholders` | Excalidraw: each empty slot drawn, and why |
| `logos` | Draw.io: the fetched logos a build embedded |
| `namesAProduct` | a plain box whose label names a bundled product; `replace` is the icon node to paste over it, when the product is the whole label or a line of it (#287) |
| `looksLikeBoundary` | a box laid over nodes it doesn't own, sized in grid cells, or named like an account or a VPC; `boundary` is the entry to paste (#204, #203) |
| `crossings` | Excalidraw: an edge through a node it doesn't connect |
| `notes` | an icon no edge touches, and similar things worth a look |

`validate` ends its warnings with the rule: each is a defect to fix, or to
quote in a report with every id it names (#248).

## Draw.io spec

```json
{
  "title": "Log ingestion",
  "subtitle": "Hourly, one region",
  "context": { "packs": ["aws"] },
  "boundaries": [ { "id": "cloud", "kind": "aws-cloud", "label": "AWS Cloud", "cols": 3, "rows": 1 } ],
  "nodes": [
    { "id": "eb", "kind": "icon", "icon": "eventbridge", "label": "EventBridge", "col": 0, "row": 0, "parent": "cloud" },
    { "id": "fn", "kind": "icon", "icon": "lambda", "label": "Processor", "col": 1, "row": 0, "parent": "cloud" },
    { "id": "sf", "kind": "logo", "logo": "snowflake", "label": "Snowflake", "col": 3, "row": 0 },
    { "id": "n1", "kind": "note", "label": "Assumes one account per environment", "col": 0, "row": 1 }
  ],
  "edges": [ { "from": "eb", "to": "fn", "kind": "flow", "label": "event" } ]
}
```

| part | fields |
|---|---|
| spec | `title`, `subtitle`, `context.packs`, `layout`, `pages`, `legend`, `legendX`, `legendY` |
| node `kind` | `icon` (a bundled mark, by name or id), `logo` (a fetched logo), `aws4` (a built-in shape), `box`, `note`, `text` |
| node | `col`, `row` (missing is 0; fractions are fine), `parent`, `pack`, `size`, `width`, `height`, `label` (`\n` breaks a line) |
| boundary `kind` | `aws-cloud`, `aws-group` (with `grIcon`), `lane`, or a plain scope; `cols`, `rows`, `labelAlign` |
| edge `kind` | `flow`, `async`, `error`, `success`, `light`, plus any your override adds; a legend appears once two are used |
| edge | `label`, `labelPos` (-1 at the source to 1 at the target), `exit`, `entry` |

The builder chooses every edge's sides from the grid: between columns an edge
leaves and enters sideways, within a column it runs vertically below the
caption, and ends that would share a point are spread apart. Only a route that
would cross a node or a caption gets waypoints, round it through the free
space, or over the top when that takes fewer turns. Each label sits on the
longest clear stretch of its route, at least 30px before the arrowhead (#237,
#241). When the grid gets a side wrong, set it:

```json
{ "from": "a", "to": "b", "exit": "bottom", "entry": { "side": "left", "at": 0.25 } }
```

More than one page is `pages`: each carries its own `name`, `title`,
`boundaries`, `nodes`, `edges` and `legend`; `layout` and `context` are shared,
ids are per page, and an edge can't cross pages.

Worked examples: `skills/arkitect-drawio/assets/templates/starter-architecture.spec.json`
and `as-is-to-be.spec.json` (two pages), each with its PNG. Pattern fragments:
`assets/templates/patterns.json`.

## Excalidraw spec

```json
{
  "title": "Event-driven data platform",
  "layout": { "colPitch": 300, "rowPitch": 230, "route": "avoid" },
  "boundaries": [ { "id": "platform", "kind": "scope", "label": "Data platform", "color": "blue" } ],
  "nodes": [
    { "id": "api", "kind": "round", "label": "Ingest API", "accent": "blue", "col": 1, "row": 1, "parent": "platform" },
    { "id": "db", "kind": "icon", "icon": "postgres", "label": "Postgres", "col": 2, "row": 1 }
  ],
  "edges": [ { "from": "api", "to": "db", "kind": "flow", "label": "writes" } ]
}
```

| node `kind` | drawn as |
|---|---|
| `box`, `round` | a rectangle; `round` is the default for a service |
| `ellipse`, `diamond` | a start or end state; a decision |
| `cylinder` | a datastore |
| `actor` | a person or external role |
| `icon` | a library item, a shared mark (`drawio:<pack>/<slug>`) or an icon you built, captioned below |
| `placeholder` | an empty slot for a mark to drop in later |
| `note`, `text` | a sticky note; bare text |

Also `accent`, `sublabel`, `width`, `height`, `size`, `fontSize`,
`strokeStyle`, `fillStyle`.

**Boundaries** are `scope` (a dashed rectangle, nestable) or `frame` (an
Excalidraw frame, top level). Both are sized from everything their nodes draw,
captions included.

**Edges** take `kind` (`flow`, `async`, `branch`, `error`, `success`, `data`,
`light`), `label`, and a route:

| `route` | path |
|---|---|
| `auto` (default) | straight when the ends line up, an elbow otherwise |
| `straight`, `elbow` | as named |
| `avoid` | round any other node, caption, boundary name or unrelated boundary in the way, off lanes other edges use; written as fixed segments the app keeps through a drag (#124) |

`layout.route` sets the route for every edge. An edge already clear draws the
same with or without `avoid`. `routing` is `elbow` (the app re-routes the
arrow when a node moves) or `points`. An edge from a node to itself loops over
a corner.

Worked examples: `skills/arkitect-excalidraw/assets/templates/starter-architecture.spec.json`
(one of every kind) and `aws-data-platform.spec.json` (48 nodes). Look at the
PNG beside each before writing your first spec.

## Rendering

```bash
arkitect drawio render docs/arch.drawio --page-index 0 --width 2200 --out-dir .analysis/renders
arkitect drawio render docs/arch.drawio --all --format pdf
arkitect excalidraw render docs/arch.excalidraw --out-dir .analysis/renders --width 2200
arkitect excalidraw render docs/arch.excalidraw --out preview.svg
```

| | Draw.io | Excalidraw |
|---|---|---|
| needs | Draw.io Desktop; Xvfb on headless Linux | nothing for SVG; Edge, Chrome or Chromium for PNG |
| output | `<base>.p<N>.png` or `.pdf` per page | `<scene>.png`, or the `--out` file |
| fidelity | exact | geometry exact; fonts substituted, fills flat |

**Draw.io.** `--padding` defaults to 20px. Desktop's own `--page-index`
counts from 0 on some builds and from 1 on others, so Arkitect never passes
it: it copies the chosen page verbatim into a temporary one-page file and
exports that. The executable is `--drawio-exe` or `DRAWIO_EXE` if set (a pin
that fails rather than falls back), otherwise found on `PATH` or in the usual
install locations; `arkitect doctor` shows which. On Linux without a usable
`DISPLAY` it runs under `xvfb-run -a`. A failed page names its exit code and
Desktop's first error line. `render-drawio.ps1` keeps its parameters and wraps
the same renderer.

**Excalidraw.** `--out FILE.svg|.png` picks the format by extension;
`--out-dir` with `--format svg` writes an SVG there. The browser is found on
`PATH` or where each OS installs it; `--browser` or `ARKITECT_BROWSER` pins
one. With no browser the PNG render exits 1 and names what it tried. An SVG is
markup: it can't show an agent the diagram, and the render says so.

Every render is written only once it succeeded, so a failure leaves the
previous file untouched and is never reported as a render (#157).

## Traps in the formats

- **Draw.io data URIs are comma-only.** A style string splits on `;`, so
  `data:image/svg+xml;base64,…` cuts the icon in half. Draw.io's own files use
  `data:image/svg+xml,<base64>`; the scripts do too.
- **Excalidraw arrow points are relative** to the arrow's `x`/`y`, and
  `points[0]` is `[0,0]`.
- **Excalidraw bindings are stored twice:** the arrow names its shapes and each
  shape lists the arrow. `validate` treats a one-sided binding as an error.

Scene format notes for hand-editing:
`skills/arkitect-excalidraw/references/excalidraw-format.md`.

## Repository layout

```
bin/arkitect.mjs               the dispatcher; bin/lib/install-agent.mjs writes adapters
.claude-plugin/                plugin and marketplace manifests
hooks/                         the two Claude Code hooks
docker/                        the local Excalidraw app
skills/arkitect-drawio/        SKILL.md, references/, assets/ (packs, templates), scripts/
skills/arkitect-excalidraw/    SKILL.md, references/, assets/ (36 libraries, templates), scripts/
skills/{learn,apply}-{drawio,excalidraw}-style/   user-invoked only
docs/                          these pages
tests/                         run-tests.mjs and the three suites
evals/                         agent eval cases; not run by default, they cost money
AGENTS.md                      the agent contract
```

Scripts resolve their own paths and run from any directory. Inside a
`SKILL.md` they are addressed through `${CLAUDE_PLUGIN_ROOT}`.
