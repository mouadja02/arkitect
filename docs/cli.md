# CLI and spec format

Every Arkitect command is a Node script behind one dispatcher. `arkitect` below
means the npm install, or `node bin/arkitect.mjs` from a clone
([install.md](install.md)).

```bash
arkitect                     # every command, one screen
arkitect doctor              # what is installed, what is optional
arkitect where               # the install path
arkitect install --all       # agent adapters for this project
arkitect report --draft docs/arch.drawio --spec spec.json   # draft one
arkitect report report.md    # check a saved diagram report
arkitect test                # the offline suite (clone only)
arkitect version
```

A command's own help is one level down: `arkitect drawio icon --help`.

`doctor` exits 1 when Node is older than 22 or a bundled asset is missing or
does not parse, and 0 otherwise: a missing renderer, browser or Docker, an
ignored style override or an adapter pointing at another install is a
warning. It reads files and asks programs their version; it never starts a
renderer, a browser or a container, and never contacts a remote Docker engine.

`report <file|->` runs the check Claude Code's Stop hook makes, on any host: the
seven headings, a Render section that describes only a picture someone looked
at, no validate warning called intentional, no hosted-editor link. It sees only
the text, so `--png-viewed` is the agent's word that it opened the PNG, never an
observed fact. Exit 0 clean, 1 with problems, each named, 2 on a usage error
(#302).

`report --draft <diagram> [--spec <spec>] [--defaults]` prints the seven headings with what
a script knows filled in: **File** from the diagram, **Validation** with every
error, warning and note `validate` prints, word for word, and **Icons** from
the spec, resolved as the build resolves it without writing anything: each
icon node's id and pack, or ref and library, and every placeholder, missing,
ambiguous or on-demand mark and product named in a plain box, each by its
node (#409). The build report's unknown kinds, unknown fields and notes go
under Validation, replayed in the style the build loads from the same store,
or the house style with `--defaults`, and say which; an applied style the
build ignores is named there (#429). Engine,
Assumptions, Render and Deviations each hold one `<!-- fill in: … -->` line,
and the check fails while one is left. Without `--spec` it reads the spec the
diagram carries (#388); with neither, Icons is a fill-in too (#387).

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
arkitect drawio analyze docs/arch.drawio --page 0 --cells   # a row per cell; --all, every key
arkitect drawio analyze docs/arch.drawio --find "Checkout API"
arkitect drawio backup docs/arch.drawio                # before an edit the builder doesn't make
arkitect drawio spec docs/arch.drawio > edit.json      # the spec it was built from
arkitect drawio pattern 1                              # one section of the pattern catalog; no N lists them
arkitect drawio packs --verify                         # committed packs against their pins
arkitect drawio sheets --pack azure                    # a pack as a labelled grid
arkitect drawio learn --sources <files> --merge        # your style record
arkitect drawio findings --derive
arkitect drawio apply --list                           # --accept <ids>, --reset
```

Every build writes its spec, minified and XML-escaped, as `arkitect-spec` on
`<mxfile>`; Draw.io Desktop keeps the attribute when it saves. `spec` prints it
as indented JSON, and building that over the file reproduces it byte for byte
with the same style. It exits 1 when the file carries none, and says on stderr
when an editor has saved the file since (its `agent` is no longer Arkitect's):
a colour or position changed there is not in the spec. A file that carries the
spec still counts as Arkitect's, so a rebuild names cells added since in
`notes` and keeps their backup (#376, #388). Beside it, `arkitect-built` holds
a short hash of each cell's style, label, ends and geometry as built, so a
rebuild names a cell restyled, moved or relabelled since the same way; what a
save only spells differently, such as attribute or style-key order, does not
count (#403).

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
arkitect excalidraw analyze docs/arch.excalidraw --cells   # a row per spec entry; --all, per element
arkitect excalidraw backup docs/arch.excalidraw
arkitect excalidraw spec docs/arch.excalidraw > edit.json   # the spec it was built from
arkitect excalidraw pattern 6                          # one section of the pattern catalog
arkitect excalidraw learn --sources <files> --merge
arkitect excalidraw findings --derive
arkitect excalidraw apply --list
```

Every build writes its spec under `customData.arkitectSpec` of the first
element the first spec node drew, and a copy on the title or legend, or else
another node's element, so deleting the first node keeps it (#408). Each
carries `arkitectBuilt`, the element count and version sum the build wrote.
The app keeps an element's `customData` through a save; a key at the top of
the scene or in `appState` it does not know, it drops. `spec` prints the
spec, and building it with the same `--seed` and style reproduces the scene
byte for byte. It exits 1 when the scene carries none, saying so when the
scene is Arkitect's but both carriers were deleted, and says on stderr when
the scene no longer matches `arkitectBuilt`: the app moves an element's
`version` whenever it changes one (#388). Every element the build stamps
also records `customData.arkitect.built`, a short hash of how it looked, so a
rebuild names the spec entry of an element restyled, moved or retitled since.
What the app recomputes when it opens a scene is left out: versions, indices,
a text's size and place, an arrow's route (#403).

## Behaviour both engines share

- **Arguments are strict.** An unknown flag, a missing value, a repeated flag or
  a stray file exits `2` with one line, before anything is read or written.
  Flags may come before or after files.
- **`--out` never names an input.** `build` and `analyze` refuse an `--out`
  that is the file they read, exit `2`. `build` writes only `.drawio`, `.dio`
  or `.xml` (Draw.io) and `.excalidraw` or `.json` (Excalidraw); `analyze`
  writes its summary anywhere but over a diagram.
- **A bad spec is refused whole.** An edge or `parent` naming something that
  doesn't exist, a missing, repeated or reserved id, a string where a number
  goes, a size of 0 or less, a spec with neither a node nor a boundary (an
  Excalidraw spec whose nodes sit under `pages` is one): every problem is
  listed at once, exit `1`, nothing written.
- **An unknown kind or field still builds,** and the report lists it under
  `unknownKinds` or `unknownFields`. Treat a non-empty list as something to fix.
- **Backups.** A build copies an existing target to
  `<name>.backup-YYYYMMDD-HHMMSS.<ext>` first, then keeps the oldest backup and
  the newest five (`--keep-backups N`, `0` keeps all). When the target holds
  shapes the build does not draw, added by hand since it was built, or shapes
  it drew that were restyled, moved or relabelled since, `notes` names them
  and the backup is `<name>.backup-YYYYMMDD-HHMMSS-kept.<ext>`, which
  retention never deletes (#376, #403). `arkitect <engine>
  backup <file>` does the same for any other edit. Add `*.backup-*` to your
  `.gitignore`, and `.$*.bkp`: the autosave Draw.io Desktop leaves beside a
  file it has open.
- **Your style.** A build merges your override from `~/.arkitect/<engine>/`
  and says so under `style`, with what each edge kind means on this install.
  `--defaults` ignores it; use it for anything
  committed. A broken override is ignored whole, with one warning.
- **Pages are 0-based** everywhere: `--page`, the analyzer, renders' `.pN`
  names.
- A JSON file may start with a UTF-8 byte order mark.

## The build report

Both builders print a JSON report. Beyond the file written and its backup:

| key | lists |
|---|---|
| `icons` | what resolved and from where; Draw.io adds `missing`, `ambiguous`, `needsFetch`, `sameArtwork` and `lifecycle`, Excalidraw `selfCaptioned` and `opaqueBackground`. A Draw.io search the resolver is unsure of draws a labelled box, listed under `missing` with its `reason` and `alternatives`; `ambiguous` holds only one product's same-title variants, whose leader draws (#432). Each Draw.io entry names its `node` (#409). Each shared mark is named by `ref` and `pack`; `--verbose` adds `icons.sources`, its source, licence and hash once per ref (#386) |
| `placeholders` | Excalidraw: each empty slot drawn, and why |
| `logos` | Draw.io: the fetched logos a build embedded |
| `namesAProduct` | a plain box whose label names a bundled product with artwork to draw, never an on-demand one (#434); `replace` is the icon node to paste over it, when the product is the whole label or a line of it (#287). Both engines' `validate` warn on each such shape until it is replaced (#326, #341); Draw.io only on a page that already draws an icon, and a page of plain boxes gets a note instead, since an edit follows the file (#366). A concept glyph, an agent's "Memory" or a "Process" icon, is not a product (#352) |
| `looksLikeBoundary` | a box laid over nodes it doesn't own, sized in grid cells, or named like an account or a VPC; `boundary` is the entry to paste (#204, #203). `validate` warns on a box named like one (#341) |
| `crossings` | Excalidraw: an edge through a node it doesn't connect |
| `notes` | an icon no edge touches, and similar things worth a look: a diagram of more than three nodes with edges and no `note` to hold the assumptions, or a legend turned off over two or more connector kinds (#384). First, when `--out` replaced a file with no sign of an Arkitect build (Draw.io's `agent="arkitect-drawio"`, Excalidraw's `customData.arkitect`): what was lost, and the backup holding the original (#339) |

`validate` ends its warnings with the rule: each is a defect to fix, or to
quote in a report with every id it names (#248). Excalidraw names the spec
node, boundary or edge after each element's id, from the `customData.arkitect`
the builder stamps on everything it draws (#353).

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
| spec | `title`, `subtitle`, `titleColor` (the title's colour), `context.packs`, `layout`, `pages`, `legend`, `legendX`, `legendY`; a one-page spec also takes `page` (its tab's name, `Architecture` by default) and `pageId` |
| `layout` | `originX`, `originY` (where column 0, row 0 sits: 80, 100), `colPitch`, `rowPitch` (320, 190) |
| node `kind` | `icon` (a bundled mark, by name or id), `logo` (a fetched logo), `aws4` (a built-in shape), `box`, `note`, `text` |
| node | `id`, `col`, `row` (missing is 0; fractions are fine), `parent`, `pack`, `size`, `width`, `height`, `label` (`\n` breaks a line); a `text` node takes `color`, `fontSize`, `bold` and `align`, an `aws4` node `resIcon` (its `mxgraph.aws4.*` shape) and `color` (its fill) |
| boundary `kind` | `aws-cloud`, `aws-group` (with `grIcon`), `lane`, or a plain scope; `id`, `label`, `parent`, `col`, `row`, `cols`, `rows`, `padLeft`/`padTop`/`padRight`/`padBottom`, `labelAlign`, `color` (the outline), and `dashed`, which `false` draws solid on a scope. A boundary grows to hold every node and boundary naming it as `parent`, captions included; a span it asks for is the minimum, and one that asks for none is as big as what it holds (#295) |
| edge `kind` | `flow`, `async`, `error`, `success`, `light`, plus any your override adds; a legend appears once two are used; `legend: false` turns it off, and the report notes it (#384) |
| edge | `id`, `from`, `to`, `label`, `labelPos` (-1 at the source to 1 at the target), `exit`, `entry` |

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

More than one page is `pages`: each carries its own `name`, `id`, `title`,
`subtitle`, `titleColor`, `boundaries`, `nodes`, `edges`, `legend`, `legendX`
and `legendY`; `layout` and `context` are shared,
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
| `icon` | a library item, a shared mark (`drawio:<pack>/<slug>`, or Draw.io's `<pack>/<slug>`) or an icon you built, captioned below |
| `placeholder` | an empty slot for a mark to drop in later |
| `note`, `text` | a sticky note; bare text |

| part | fields |
|---|---|
| spec | `title`, `layout`, `boundaries`, `nodes`, `edges`, `legend` (`false` turns it off), `legendX`, `legendY`, `canvasBackground` (`white`, `grey`, `blue`, `yellow`, `pink` or a `#rrggbb`), and `style`, which takes the tokens `build --print-style` lists, for this scene alone |
| `layout` | `originX`, `originY` (0, 0), `colPitch`, `rowPitch` (320, 200), `cell` (the square a node is centred in, 100), `route` |
| node | `id`, `kind`, `label`, `col`, `row` (missing is 0), `parent`, `width`, `height`, `size` (an icon's), `icon`, `sublabel`, `accent` (a palette name or a `#rrggbb`), `fill` (a colour, or `false` for none), `fillStyle`, `strokeStyle`, `strokeWidth`, `roughness`, `fontSize`, `fontFamily`, `labelColor`; a `text` node also takes `align` |
| boundary | `id`, `kind`, `label`, `parent`, `col`, `row`, `cols`, `rows`, `padLeft`/`padTop`/`padRight`/`padBottom`, `color` or `accent`, `fill`, `dashed` (`false` draws it solid), `strokeStyle`, `strokeWidth`, `roughness`, `labelPlacement` (`inside`, or `outside`: a large name above the top-left corner), `fontSize` |
| edge | `id`, `from`, `to`, `kind`, `label`, `route`, `routing`, `color`, `strokeStyle`, `strokeWidth`, `roughness`, `startArrowhead` (none by default), `endArrowhead` (`arrow`; `null` for none), `gap` (between an end and its node, 8), `labelColor`, `labelSize` (16), `labelBound` (`true` binds the label to the arrow). An edge whose `color`, `strokeStyle` or `strokeWidth` differs from its kind's is named in `notes`, since the legend no longer matches it |

**Boundaries** are `scope` (a dashed rectangle, nestable) or `frame` (an
Excalidraw frame, top level). Both are sized from everything their nodes draw,
captions included. A scope's top inset is never less than its inside label
needs, at any size and on any number of lines, whatever `padTop` asks (#428),
and a frame holds the edges between its own members, loops and detours and
their labels included (#427).

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
(one of every kind) and `aws-data-platform.spec.json` (43 nodes). Look at the
PNG beside each before writing your first spec.

## Rendering

```bash
arkitect drawio render docs/arch.drawio --page-index 0 --width 2200 --out-dir .analysis/renders
arkitect drawio render docs/arch.drawio --all --format pdf
arkitect excalidraw render docs/arch.excalidraw --out-dir .analysis/renders --width 2200
arkitect excalidraw render docs/arch.excalidraw --out preview.svg
arkitect drawio render docs/arch.drawio --embed --format svg --out-dir docs        # docs/arch.drawio.svg
arkitect excalidraw render docs/arch.excalidraw --embed --format svg --out-dir docs  # docs/arch.excalidraw.svg
```

**For a README**, `--embed` writes an SVG or PNG that holds its source: the
whole `.drawio` in the SVG root's `content` attribute or a PNG `zTXt` chunk,
as Draw.io's `-e` export does, or the scene in the SVG's `<metadata>` or a PNG
`tEXt` chunk, as Excalidraw's "Embed scene" does. GitHub shows the picture;
Draw.io, its VS Code extension or the Excalidraw app opens it as the diagram;
`spec`, `analyze` and `validate` read it, and say so. Draw.io's is named
`<base>.drawio.svg` (`<base>.p<N>.drawio.svg` for a file of several pages, each
holding them all), Excalidraw's `<scene>.excalidraw.svg`. Either holds the
source byte for byte; a re-render after the next build replaces it.

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
- **An Excalidraw arrow binds to a rectangle, ellipse, diamond, image, frame
  or free text, nothing else.** Bound to a line it loads, keeps the binding and
  stays behind when the line is dragged; `validate` refuses it (#294).

Scene format notes for hand-editing:
`skills/arkitect-excalidraw/references/excalidraw-format.md`.

## Repository layout

```
bin/arkitect.mjs               the dispatcher; bin/lib/install-agent.mjs writes adapters
.claude-plugin/                plugin and marketplace manifests
hooks/                         the five Claude Code hooks
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
