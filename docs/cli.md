# CLI and repository layout

Everything Arkitect does is a Node script. The dispatcher exists so you (or an
agent) need not memorise where they live.

```bash
node bin/arkitect.mjs                      # every command, one screen
node bin/arkitect.mjs doctor               # what is installed, what is optional
node bin/arkitect.mjs where                # the install path, for scripting
node bin/arkitect.mjs install --all        # write agent adapters into this project
node bin/arkitect.mjs test                 # the offline suite (git checkout only)
```

`npm link` from the repository root puts `arkitect` on your `PATH` (no
dependencies are installed). The rest of this page writes `arkitect` for
brevity. The npm package carries the CLI, the skills and their bundled assets,
but not the test suite: outside a checkout `arkitect test` exits `2` and says
where to find it.

## Draw.io

```bash
arkitect drawio icon "bedrock"                        # search the AWS palette
arkitect drawio icon "bedrock" --compact              # just the verdict and a spec node
arkitect drawio icon --cell aws/amazon-bedrock --label "Amazon Bedrock" --x 0 --y 0
arkitect drawio logo --url https://.../logo.svg --name snowflake
arkitect drawio logo --list
arkitect drawio logo --inspect snowflake              # size, transparency, source
arkitect drawio build spec.json --out docs/arch.drawio
arkitect drawio validate docs/arch.drawio
arkitect drawio render docs/arch.drawio --all --out-dir .analysis/renders
arkitect drawio analyze docs/arch.drawio --page 0 --cells
arkitect drawio analyze docs/arch.drawio --page 0 --images
arkitect drawio backup docs/arch.drawio                # before any edit the builder does not make
arkitect drawio packs --verify                        # verify committed packs against the manifest
arkitect drawio packs --all                           # rebuild packs and icon catalog from pinned sources
arkitect drawio build spec.json --out docs/arch.drawio --defaults   # the house style, ignoring your own
arkitect drawio build --print-style                   # the style a build uses, and where it came from
arkitect drawio learn --sources <files> --merge       # rebuild your style record
arkitect drawio findings --derive                     # what your record says, for apply
arkitect drawio apply --list                          # findings that differ from what is drawn
arkitect drawio apply --accept <id,id>                # draw with them from now on
arkitect drawio apply --reset                         # back to the house style
```

`build`, `validate` and `analyze` parse their arguments strictly. A flag takes
its value with it, so options may come before or after the files. An unknown
flag, a flag with no value, a `--page` that is not a non-negative integer, or a
spec that is missing or not valid JSON exits `2` with a one-line reason.
`validate --page N` checks page N only (0-based), and a page the file does not
have is a failure (exit `1`), never a pass over nothing; `analyze --page N` goes
with `--cells` or `--images` and exits `1` the same way.

Every JSON file you write — a spec, a scene, a library, a style record — may
start with a UTF-8 byte order mark, which is what Windows PowerShell's
`Set-Content -Encoding UTF8` and several editors add. One leading mark is
ignored and nothing else about the text is touched (#156).

`validate` checks that the file is well-formed XML before it checks anything
else, over the wrapper and over each compressed page once decoded. A mismatched
or unclosed tag, a repeated attribute, an unquoted value or a raw `&` is a
failure that names the line and column, never a PASS recovered from. A
declaration, comments around the root and CDATA are XML, and pass.

`build` merges this install's style override, `~/.arkitect/drawio/style-overrides.json`
(`$ARKITECT_HOME/drawio/`), into every build and says so under `style` in its
report. `--defaults` draws the shipped house style regardless — use it for
anything that gets committed. An override with problems is ignored whole, with a
one-line warning, and never half applied. See [style.md](style.md#making-it-yours).

```powershell
./skills/arkitect-drawio/scripts/render-drawio.ps1 `
  -Path docs/arch.drawio -All -OutDir .analysis/renders -Width 2200
```

## Excalidraw

```bash
arkitect excalidraw icon "postgres"                   # native libraries + shared packs
arkitect excalidraw icon "postgres" --compact         # just the verdict and a spec node
arkitect excalidraw icon --resolve gcp-icons:37       # what a spec node would draw
arkitect excalidraw icon --stats
arkitect excalidraw libraries                         # one line per bundled library
arkitect excalidraw libraries --items gcp-icons
arkitect excalidraw libraries --unnamed               # the ones you must look at
arkitect excalidraw libraries --build                 # after adding a .excalidrawlib
arkitect excalidraw browse --search "kubernetes"      # the public catalogue
arkitect excalidraw browse --install <source>
arkitect excalidraw browse --preview <slug> --out sheet.excalidraw
arkitect excalidraw make-icon --url https://.../dbt.svg --name dbt --trace
arkitect excalidraw build spec.json --out docs/arch.excalidraw
arkitect excalidraw validate docs/arch.excalidraw
arkitect excalidraw analyze docs/arch.excalidraw --cells
arkitect excalidraw backup docs/arch.excalidraw        # before any edit the builder does not make
arkitect excalidraw render docs/arch.excalidraw --out preview.svg
arkitect excalidraw build spec.json --out docs/arch.excalidraw --defaults   # the house style, ignoring your own
arkitect excalidraw build spec.json --out docs/arch.excalidraw --seed 7     # the same bytes on every rebuild
arkitect excalidraw build --print-style               # the style a build uses, and where it came from
arkitect excalidraw learn --sources <files> --merge   # rebuild your style record
arkitect excalidraw findings --derive                 # what your record says, for apply
arkitect excalidraw apply --list                      # findings that differ from what is drawn
arkitect excalidraw apply --accept <id,id>            # draw with them from now on
arkitect excalidraw apply --reset                     # back to the house style
```

`icon`, `build`, `validate` and `analyze` parse their arguments strictly, as
Draw.io's do: an unknown flag, a flag with no value, a repeated flag or a stray
file exits `2` with a one-line reason before anything is read or written. A spec
or scene that is missing or not valid JSON is named in one line, never a stack
trace; `validate` reports such a file as its own `FAIL`. `icon --limit N` takes a
whole number of at least 1, and a search, `--stats` and `--resolve` are separate
requests.

`build --seed N` (a whole number from 0 to 4294967295) makes a rebuild
reproducible: ids, stroke seeds and timestamps come from the seed, so the same
spec, style, seed and icons write the same bytes and the same preview. Without
it they are random, as the app's own are (#119).

Excalidraw's `build` merges `~/.arkitect/excalidraw/style-overrides.json` exactly
as Draw.io's merges its own: reported under `style`, skipped by `--defaults`,
shown by `--print-style`, and ignored whole with a one-line warning when it has
problems.

Both `build` commands copy an existing target to
`<name>.backup-YYYYMMDD-HHMMSS[-n].<ext>` before replacing it. Once the new file
is written they keep the oldest of those backups and the newest five, delete the
rest and list them under `pruned` in the report. `--keep-backups N` changes how
many recent ones stay; `0` keeps all. Only that file's own backup names are ever
deleted. Add `*.backup-*` to your project's `.gitignore` so the ones kept stay
out of commits.

An edit the builder does not make — a hand edit, a script, MCP `set_page` — gets
the same protection from `arkitect <engine> backup <file>`, which writes that
sibling and prunes to the same retention. It prints each backup it wrote, exits
`1` naming any file that does not exist, and exits `2` on a malformed
`--keep-backups` before copying or deleting anything (#179).

The two `render-*.ps1` helpers keep their documented parameters and are thin
adapters over the renderers above, so they inherit staged output, backup and
restore, and the rule that only a freshly produced image counts as a render.
An export that fails exits non-zero and never says it rendered, over a stale
image or otherwise (#157); `render-excalidraw.ps1` leaves an SVG behind when
it is the PNG rasterisation that failed, and a run that finds no browser now
exits 1 saying so rather than 0.

```powershell
./skills/arkitect-excalidraw/scripts/render-excalidraw.ps1 `
  -Path docs/arch.excalidraw -OutDir .analysis/renders -Width 2200
./skills/arkitect-excalidraw/scripts/excalidraw-docker.ps1 -Open -Path docs/arch.excalidraw
```

Any command's own `--help` is one level down: `arkitect drawio icon --help`
passes straight through to the script.

## Layout

```
bin/
  arkitect.mjs          the dispatcher
  lib/install-agent.mjs the agent adapters
.claude-plugin/         plugin + marketplace manifests (Claude Code)
.cursor/ .opencode/ .github/
                        this repository's own agent adapters
docker/
  docker-compose.yml    the local Excalidraw app
skills/arkitect-drawio/
  SKILL.md              the Draw.io workflow contract, and which file to read when
  references/           editing.md, icons.md, rendering.md (read on condition),
                        style-guide.md, pattern-catalog.md, pack-index.md,
                        icon-catalog.json, source-analysis.json
  assets/libraries/     the AWS palette, the explicit export, the merge
  assets/templates/     starter spec, the built diagram, its PNG, pattern fragments
  assets/logos/         product logo cache (gitignored)
  scripts/              analysis, icon lookup, generation, validation, rendering
  scripts/lib/          the .drawio parsing core, style tokens, and what both engines
                        share: backups, the style store, override layer and findings/apply workflow
skills/arkitect-excalidraw/
  SKILL.md              the Excalidraw workflow contract, and which file to read when
  references/           editing.md, icons.md, rendering.md (read on condition),
                        style-guide.md, pattern-catalog.md, excalidraw-format.md,
                        source-analysis.json
  assets/libraries/bundled/   36 committed libraries, 1,162 items, contact sheets
  assets/icons/         icons built from logos (gitignored)
  assets/templates/     two worked specs, their scenes, their PNGs
  scripts/              generation, validation, rendering, icons, libraries
  scripts/lib/          scene model, SVG tracer, hand-drawn stroke generator, style tokens
skills/learn-drawio-style/        user-invoked only
skills/learn-excalidraw-style/    user-invoked only
skills/apply-drawio-style/        user-invoked only
skills/apply-excalidraw-style/    user-invoked only
docs/                   this documentation
tests/                  run-tests.mjs (all suites), drawio.mjs, excalidraw.mjs,
                        toolkit.mjs
evals/                  eval cases, not run by default - they cost money
AGENTS.md               the agent contract
```

Scripts resolve their own paths, so they work from any working directory and
under any install route. Inside a `SKILL.md` the same scripts are addressed via
`${CLAUDE_PLUGIN_ROOT}`.

---

# The spec format

Both builders take a small JSON spec rather than raw XML or scene JSON. That is
what keeps base64 out of your context, the layout collision-free, and the style
applied without you naming a single colour.

## Draw.io spec

```json
{
  "title": "Log ingestion",
  "nodes": [
    { "id": "eb",  "kind": "icon", "icon": "eventbridge", "label": "EventBridge", "col": 0, "row": 1 },
    { "id": "fn",  "kind": "aws4", "shape": "lambda",     "label": "Processor",   "col": 1, "row": 1 },
    { "id": "sf",  "kind": "logo", "logo": "snowflake",   "label": "Snowflake",   "col": 3, "row": 1 },
    { "id": "note","kind": "note", "label": "Assumes one account per environment" }
  ],
  "boundaries": [ { "id": "cloud", "label": "AWS Cloud", "kind": "cloud" } ],
  "edges": [ { "from": "eb", "to": "fn", "kind": "flow", "label": "event" } ]
}
```

Node `kind`: `icon` (the bundled AWS palette), `logo` (a cached product logo),
`aws4` (a built-in Draw.io shape), `box`, `note`, `text`. Nodes sit on a
column/row grid and name their boundary as `parent`; boundaries span whole grid
cells. Edge `kind` is `flow`, `async`, `error`, `success` or `light` — plus any
kind this install's style override adds, as `build --print-style` lists — and a
legend is generated once more than one is used; an unknown kind draws as `flow`.

More than one page is a `pages` array. Each page carries its own `name`, `id`,
`title`, `boundaries`, `nodes`, `edges` and `legend`; `layout` and `context`
stay at the top and are shared. Ids are per page, so a component drawn on both
pages keeps its id, and an edge cannot cross pages. A spec without `pages` is
one page, built exactly as before. Report paths name the page:
`pages[1].nodes[3].style`.

```json
{
  "context": { "packs": ["aws"] },
  "pages": [
    { "name": "As-is", "title": "Today", "nodes": [], "edges": [] },
    { "name": "To-be", "title": "Target", "boundaries": [], "nodes": [], "edges": [] }
  ]
}
```

The build refuses a spec that names something that does not exist, before it
backs up or writes anything, and lists every problem at once (exit `1`, JSON on
stderr): an edge `from`/`to` that is not a node or boundary id, a `parent` that
is not a boundary, a boundary nested inside itself, and a missing, repeated or
reserved id. `0`, `1`, `title`, `legend`, `legend-a0`-style ids and ids ending
in `-lbl` are reserved for cells the builder writes itself.

Numbers are checked the same way, each problem naming its field
(`nodes[2].col: expected a finite number, got "oops"`). A missing `col` or
`row` is `0`; coordinates may be fractional or negative. `width`, `height`,
`size`, `fontSize` and the layout pitches must be greater than 0, a boundary's
`cols`/`rows` at least 1 and its paddings at least 0. A number written as a
string is refused, not converted.

Worked examples:
`skills/arkitect-drawio/assets/templates/starter-architecture.spec.json`, and
`as-is-to-be.spec.json` beside it for two pages.
Fragments matching the pattern catalog: `assets/templates/patterns.json`.

## Excalidraw spec

```json
{
  "title": "Event-driven data platform",
  "canvasBackground": "white",
  "style": { "roughness": 1, "fontFamily": 1, "strokeWidth": 2, "rounded": true },
  "layout": { "colPitch": 300, "rowPitch": 230 },
  "boundaries": [
    { "id": "platform", "kind": "scope", "label": "Data platform", "color": "blue", "dashed": true }
  ],
  "nodes": [
    { "id": "api", "kind": "round", "label": "Ingest API", "accent": "blue", "col": 1, "row": 1, "parent": "platform" },
    { "id": "db",  "kind": "icon",  "icon": "postgres", "label": "Postgres", "col": 2, "row": 1 }
  ],
  "edges": [ { "from": "api", "to": "db", "kind": "flow", "label": "writes" } ]
}
```

| node `kind` | drawn as |
|---|---|
| `box` | sharp rectangle with a bound label |
| `round` | rounded rectangle — the default for a service |
| `ellipse` | start or end state |
| `diamond` | a decision |
| `cylinder` | a datastore, one closed silhouette plus a lid |
| `actor` | a person or external role |
| `icon` | a native library item, embedded shared mark, or one you built, captioned underneath |
| `placeholder` | an obviously empty slot for a mark you will drop in by hand |
| `note` | a sticky note for assumptions |
| `text` | bare text |

Also `accent` (a swatch name or hex), `label`, `sublabel`, `width`, `height`,
`size`, `fontSize`, `strokeStyle`, `fillStyle`.

Shared artwork uses `"icon": "drawio:databases/postgresql"`, or resolves by name
when existing libraries have no confident choice. `excalidraw icon --stats`
lists shared counts, and `--resolve <ref>` reports the representation and source.
See [shared-icons.md](shared-icons.md) for the matching and source policy.

**Boundaries** are `kind: "scope"` (a dashed rectangle, nestable via `parent`)
or `kind: "frame"` (a real Excalidraw frame, top level only). Both are sized
from their contents, captions included, so a wide node cannot poke out of its
own boundary.

**Edges** take `kind`: `flow`, `async`, `branch`, `error`, `success`, `data`,
`light` — plus any kind this install's style override adds, as
`build --print-style` lists. `routing` is `elbow` (default) or `points`; `route` shapes the path —
`auto`, `straight`, `elbow`. Labels are placed as free text beside the line.
An edge connects two node ids; a boundary cannot be an endpoint.

The build refuses a spec that names something that does not exist, before it
backs up or writes anything, and lists every problem at once (exit `1`, JSON on
stderr): an unknown edge endpoint, a `parent` that is not a boundary, a boundary
nested inside itself, and a missing or repeated id. Numbers follow the Draw.io
rules above, plus the numeric tokens of a spec-level `style` block and an
edge's `gap`, `labelSize` and `strokeWidth`; `roughness` may be 0.

Worked examples: `assets/templates/starter-architecture.spec.json` (small, one
of every kind) and `assets/templates/aws-data-platform.spec.json` (48 nodes,
what a real answer looks like). **Look at the PNG beside each before writing
your first spec.**

## Four things that will bite you

**Draw.io data URIs are comma-only.** A style string is semicolon-delimited, so
`data:image/svg+xml;base64,…` is cut in half by the style parser and the icon
silently disappears. Draw.io's own files use `data:image/svg+xml,<base64>`. The
scripts handle it; hand-written XML must too.

**Draw.io page indexing varies by build.** Linux arm64 Desktop 24.7.17 is
0-based; Windows x64 Desktop 29.0.3 is 1-based. The portable `.mjs` renderer
avoids that unstable interface: select a 0-based page, copy it verbatim to a
temporary single-page file, export without Desktop's `--page-index`, clean up.
There is no platform/version table. The `.ps1` is the Windows original and
retains its existing translation unchanged. See
[Page indexing across Draw.io builds](drawio-mcp.md#page-indexing-across-drawio-builds).

**Excalidraw arrow points are relative.** An arrow's `x`/`y` is its first point
and `points[0]` is `[0,0]`. Absolute coordinates in `points` move the arrow
twice.

**Excalidraw bindings are stored twice.** The arrow names its shapes and each
shape lists the arrow back. A one-sided binding drifts apart the first time
someone drags a box, so the validator treats it as an error;
`repairBindings()` fixes imported content.

Full format notes:
`skills/arkitect-excalidraw/references/excalidraw-format.md`.

## Rendering

```bash
arkitect drawio render docs/arch.drawio --page-index 0 --width 2200 --out-dir .analysis/renders --format png
arkitect drawio render docs/arch.drawio --all --drawio-exe /path/to/drawio
```

Options: `<file>` is required; `--page-index N` is 0-based (default `0`),
`--all` selects every `<diagram>`, `--width` defaults to `2200`, `--out-dir`
to `.`, and `--format` to `png`. Output names are `<base>.p<N>.<format>`.
The portable entry point is `skills/arkitect-drawio/scripts/render-drawio.mjs`.
The `.ps1` invocation above is the Windows original and remains unchanged.

For each selected page, the Node helper uses `readMxfile()` and copies the full
raw `<diagram>` element verbatim into a temporary `.drawio`, preserving the
original `<mxfile ...>` attributes. It exports without Desktop's `--page-index`
and deletes the temporary file. Compressed payloads are copied byte for byte,
not decoded/re-encoded. N is checked against the page count before any export.
One Electron launch per page; no version probing or platform-index heuristics.

`--page-index-passthrough` (boolean, default off) is a debugging escape hatch:
export the original file with Desktop's `--page-index N` unchanged, without
splitting or translation. N must still be in range, but which page Desktop
selects depends on the build. Do not use this switch for normal verification.

The normal suite tests parsing, discovery, verbatim splitting and export handling
without requiring Desktop. For the optional real two-page PNG smoke test, run
`ARKITECT_DRAWIO_SMOKE=1 node tests/drawio.mjs` (PowerShell:
`$env:ARKITECT_DRAWIO_SMOKE='1'; node tests/drawio.mjs`). This additional test
skips when Desktop is absent; no existing tests acquire new prerequisites.

Executable discovery: `--drawio-exe` (or `DRAWIO_EXE`) is a strict pin to the
build you mean, not a hint — if that path is set but not executable, the render
fails naming it instead of silently falling through to a different binary (page
indexing differs between builds). Only when neither is set does the helper
search `drawio` on PATH, then `/opt/drawio/drawio`, `/usr/bin/drawio`,
`/Applications/draw.io.app/Contents/MacOS/draw.io`,
`C:\Program Files\draw.io\draw.io.exe` and
`C:\Program Files (x86)\draw.io\draw.io.exe`, in that order. Missing-app errors
list the candidates tried. `arkitect doctor` runs the same discovery: it prints
the path and how it was found (`DRAWIO_EXE`, `PATH` or `install location`); when
nothing is found, how many PATH directories it searched and every install
location it tried; and a warning when `DRAWIO_EXE` is set to something `render`
would refuse. Rendering is local; never use the hosted editor.

On Linux without a usable `DISPLAY` — none set, or a local `:N` whose X socket
is not there, as inside a sandbox or container — the helper announces and uses
`xvfb-run -a` if available. A failed page names why: the exit code or signal
and Draw.io's first error line. Install Xvfb separately when needed, and set `HOME` under cron/ssh.
Only add `--disable-gpu` for observed GPU failures, or `--no-sandbox` for a
diagnosed sandbox/user-namespace failure; neither is enabled blindly.

**Calibration:** Ubuntu Raspberry Pi arm64, Draw.io Desktop 24.7.17: a
two-page copy of the committed starter template with a visible second-page
marker exported first/second/second for CLI indexes 0/1/2. Windows x64 29.0.3
instead exports the first page for both 0 and 1. These observations explain why
Arkitect splits instead of relying on Desktop indexing; they are not a version
or platform lookup table.

This Pi exports successfully without extra flags, but logs a GPU initialization
error. `--disable-gpu` suppresses it; `--no-sandbox` is not needed. This build
requires Electron flags **after the input filename** when called directly:

```bash
xvfb-run -a drawio -x -f png --width 2200 -o out.png single-page.drawio --disable-gpu
```

The helper handles that ordering. Chromium stderr warnings are noise; success
requires a fresh non-empty output. Existing outputs are backed up before
replacement. Read the PNG back before delivery. If rendering breaks after a
host update, report 🔴 and explicitly fall back to validate-only until fixed.
Never commit renders or upload real architecture; PR attachments must come
only from committed repository templates.

| | Draw.io | Excalidraw |
|---|---|---|
| command | `arkitect drawio render`, or `render-drawio.ps1` | `arkitect excalidraw render`, or `render-excalidraw.ps1` |
| needs | Draw.io Desktop; Xvfb for headless Linux | nothing (SVG) / a local Edge, Chrome or Chromium (PNG) |
| fidelity | exact | geometry exact; fonts substituted, fills flat |

`arkitect excalidraw render <scene>` writes `<scene>.svg` beside the scene.
`--out FILE.svg` or `--out FILE.png` chooses the file, and its extension
chooses the format; any other extension, or a directory, exits `2`.
`--out-dir DIR` writes `DIR/<scene>.png`, or `.svg` with `--format svg`, the way
`drawio render --out-dir` does. A PNG takes `--width` pixels (default 2200) and
uses a local Edge, Chrome or Chromium, found on `PATH` or where each OS installs
it — on Linux Chrome and Edge first, then Chromium, and Ubuntu's snap wrapper
last, since the snap cannot start inside a sandbox or container; `--browser PATH` or `ARKITECT_BROWSER` pins one, and an unusable pin fails
instead of falling back to another browser. Ubuntu's snap-packaged Chromium
(also behind `/usr/bin/chromium-browser`) cannot see the host's `/tmp`, so for a
snap the page and screenshot are staged in `~/snap/chromium/common` and removed
afterwards. With no browser, the command exits
`1`, lists every path it tried, and writes nothing. The PNG replaces the
previous file only once it is a real PNG, so a crashed, timed-out or empty
screenshot leaves the old preview as it was. `--scale`, `--padding`, `--style`
and `--background` are checked before anything is drawn. `--no-sandbox` is
opt-in, for a Linux host where Chromium cannot start its sandbox.

The Excalidraw preview is a preview, not an export: Excalidraw's fonts are not
installed outside the app, so text runs a little wide. `-Style clean` drops the
hand-drawn stroke and is easier to read when the question is whether something
collides. Judge layout from the preview; judge appearance in the container.
