# Draw.io icons

Where a `.drawio` diagram's marks come from, in resolution order:

1. **The bundled icon packs** — eighteen libraries, ~4,800 marks, searched together
   by product name.
2. **Draw.io's own `mxgraph.aws4.*` shapes** — every AWS service the built-in
   set covers, no embedding needed.
3. **The MCP `search_shapes` tool**, if the Draw.io MCP server is connected.
4. **A real product logo**, fetched and embedded, for anything the packs miss.

If none of those fits, the answer is a labelled box *and a note in the report*
saying the icon is missing. Never a different product's icon.

```bash
node bin/arkitect.mjs drawio icon "bedrock"
node bin/arkitect.mjs drawio icon "cloud run" --context gcp
node bin/arkitect.mjs drawio icon --cell node1 --label "Amazon Bedrock" --x 0 --y 0
node bin/arkitect.mjs drawio logo --url https://.../acme.svg --name acme
```

## The packs

One file per pack in `skills/arkitect-drawio/assets/libraries/`, one row per pack in
`references/pack-index.md`, one contact sheet per pack in `contact-sheets/`.

| Tier | Packs | Where the artwork comes from |
|---|---|---|
| Vendor | `aws` `azure` `gcp` | The vendors' own published icon sets, embedded verbatim |
| Curated | `data-platforms` `databases` `ai-frameworks` `ml-training` `streaming-orchestration` `observability` `devops` `security-identity` `github` `saas-collab` `languages-runtimes` | Simple Icons painted in the brand's own colour; devicon's full-colour marks verbatim, and a devicon mark with no paint of its own tinted where `sources.json` says `"paint": "tint"` |
| Generated | `agents` `primitives` `file-types` | Lucide and Octicon glyphs composed into tiles and document sheets |
| Catch-all | `brands` | Every remaining Simple Icons mark, ranked last |

`node bin/arkitect.mjs drawio icon --list-packs` prints the live counts.

## Resolution is ranked, and refuses to guess

Search runs across every pack at once. A pack's `rank` breaks ties — vendor packs at 10,
curated at 20, the catch-all at 90 — so `docker` resolves to `devops/docker` rather than
to whichever Simple Icons entry happened to match first.

Two knobs steer it, and one gate stops it:

```json
{ "context": { "packs": ["gcp", "devops"] },
  "nodes": [{ "id": "q", "icon": "kafka", "pack": "streaming-orchestration" }] }
```

`context.packs` biases ties toward the stack being drawn. A node's own `pack` pins it.
And when the leader is not strong, not clearly ahead, or matched only by a fragment of
its name, the result comes back `confident: false` with the reason and the alternatives —
`build-diagram.mjs` still draws its best guess, but lists it under `ambiguous` in the
report with the fix. That is what stops a GCP diagram quietly receiving an Azure icon.

### A fragment of a name is not a name

A prefix counts only when what it leaves off is a generic tail: `postgres` names
PostgreSQL (`ql`), `rabbit` names RabbitMQ (`mq`), `envoy` names Envoy Proxy. It does
not count when it is the start of a different word — `tempo` ranks Temporal first, and
comes back flagged, because Grafana Tempo is a different product. A plural the builder
generated for a one-word vendor title is treated the same way: Azure's `Cubes` answers to
`cube`, but a bare common noun is not a product name, so it is never used unattended.

Neither rule changes a score, only whether the top result may be used without asking.
Lowering the score instead would widen the margin over the runner-up and hand confidence
to a *different* wrong answer — `delta` would become the airline.

This is measured, not asserted. `tests/icon-queries.json` is an answer key of 375
queries — the vocabulary of data, ML, platform and cloud engineers, plus 28 that must
come back flagged — and the suite fails on any confident wrong answer, or if precision
at rank 1 drops below its floor. Change a judgement row deliberately, never to make a
tuning change pass.

## What ships, and what deliberately does not

Vendor artwork is embedded **byte-for-byte**. Microsoft and Google grant permission to
use their icons in architecture diagrams and forbid altering the icon shape, so there is
no optimisation pass — and the untouched bytes keep the recorded SHA-256 meaningful.

158 products (`node scripts/find-icon.mjs --stats` has the live count) are
catalogued with a licence note but **no bytes**. For most, no permissively
licensed mark exists. Seven were removed from Simple Icons 16 at the brand
owner's request; shipping them from an older pin would have made the rest of
`ATTRIBUTION.md` dishonest. A few Apache projects have a licensed logo whose
official artwork does not draw correctly at icon size, and each entry says why.
`build-diagram` refuses to draw any of them.

Each entry says whether there is anything to fetch (#84). `artwork: "pinned"`
means the file is pinned, and `find-icon` hands back the `fetch-logo` command
that downloads it, for someone with their own permission to use the mark.
`artwork: "none pinned"` means the vendor publishes nothing a command can
download: a press kit, a request form or no logo at all. Those draw as a named
placeholder.

A licence that covers the artwork, or a trademark policy that explicitly allows
identifying use, is what lets a mark ship; a repository holding the file is not. The
Apache Software Foundation licenses its project graphic logos under the Apache
License, so Apache Iceberg, Pinot and Beam ship the official originals byte-for-byte,
at their own aspect. CNCF artwork is published only under the Linux Foundation
trademark guidelines, which allow a logo as a link to its project and nothing broader,
so Crossplane, Flux and Open Policy Agent stay on-demand (#11).

A project's own repository licence counts when the project authored the logo and
ships it there, and nothing else governs it: JAX, Flax, LightGBM, CatBoost,
Metaflow and SigNoz ship the logo committed in their own repositories, each under
that repository's Apache-2.0 or MIT licence, byte-for-byte from a pinned commit. A
published logo or trademark policy overrides the repository licence. So Flyte and
Feast (LF AI & Data), KServe and SPIFFE (CNCF), and Sigstore and Cosign (their
brand guide) stay on-demand under the Linux Foundation guidelines, as does Dagger,
whose guidelines require written permission. Seldon Core's repository is under the
Business Source License, which is not an open-source licence, and Kustomize
publishes no logo at all (#20).

See `assets/libraries/ATTRIBUTION.md` for per-source terms and
`references/pack-index.md` for the full on-demand list.

## Duplicate titles are kept, not deduplicated

Amazon files `AWS Compute Optimizer` under two categories with different artwork; both
survive, as `aws/aws-compute-optimizer` and `aws/aws-compute-optimizer-2`.
`aws/amazon-bedrock-agentcore-2` was once a PNG copy of the AgentCore service; it now
carries the same official SVG as `aws/amazon-bedrock-agentcore`, so a spec pinned to
either id still draws. All four are flagged `ambiguousTitle`. Lookups disambiguate by id
and decoded-image hash, never by title alone:

```bash
node skills/arkitect-drawio/scripts/find-icon.mjs "compute optimizer"
```

## Identical artwork is flagged, not merged

Vendors sometimes ship one file under several names: `azure/groups` and
`azure/my-customers` draw the same picture, and so do three Intune ids. Every id
stays, so a spec naming either still draws, but each catalog row lists the others
under `sameArtworkAs`, `find-icon` shows them, and `build-diagram` reports any
nodes that use different ids for the same picture under `sameArtwork`, so two
concepts are never drawn with one icon unnoticed (#77).

## The catalog

`references/icon-catalog.json` holds metadata only — namespaced id, pack, title,
aliases, source, licence, dimensions, and the SHA-256 of the decoded image. Image
payloads are **not** duplicated there; they are read from the pack library by
`libraryIndex` when a style is actually requested, so a search never drags base64 into
context. The dimensions are the artwork's own, rounded to integers, so the size a
search, `--cell` or a build recommends at the 78px footprint is read from the mark's
library cell instead, which was fitted from the artwork's exact size.

## Rebuilding

`assets/libraries/sources.json` is the pinned manifest: every upstream carries an exact
version or a recorded sha256. The builder is rerunnable and offline after the first
fetch — archives cache in a gitignored `.cache/`.

```bash
S=skills/arkitect-drawio/scripts
node $S/build-packs.mjs --list              # what the manifest declares
node $S/build-packs.mjs --all               # rebuild every pack and the catalog
node $S/build-packs.mjs --pack azure        # just one
node $S/build-packs.mjs --refresh azure-v24 # re-download, report hash drift
node $S/build-packs.mjs --check-upstream    # has Simple Icons removed a mark we ship?
node $S/build-packs.mjs --check-drift       # have the pinned sources moved on?
node $S/build-packs.mjs --downscale-png in.png out.png --max 156   # shrink a raster, aspect kept
node $S/write-pack-docs.mjs                 # regenerate pack-index.md + ATTRIBUTION.md
node $S/contact-sheet.mjs --all --png       # regenerate the review sheets
```

A source whose bytes no longer match its pin **fails the build** rather than quietly
absorbing the change. Re-pin deliberately, after looking at what changed.

## Integrity

```bash
node skills/arkitect-drawio/scripts/build-packs.mjs --verify
```

Ninety-four checks: every committed library matches the sha256 the catalog recorded,
every pack has the entry count the catalog claims, every catalog index still points at
the title it names, every SVG payload in every pack is well-formed XML with an `<svg>`
root in the SVG namespace, no mark paints only in white, every id is unique, and
nothing marked on-demand carries bytes. `build-packs` refuses to write a pack holding a
malformed payload in the first place, and names every one (#33). It refuses a mark
whose every fill, stroke and gradient stop is white or nearly so the same way: that is
the dark-background half of a light/dark logo pair, and it draws an empty tile on
Draw.io's white canvas (#85).

None of that proves Draw.io can open the file, so the suite checks that too. Every
library is loaded the way Draw.io's own `EditorUi.loadLibrary` reads one — a strict XML
parse, an `<mxlibrary>` root, `JSON.parse` of its text, then a strict parse of every SVG
payload — by a loader that shares no code with `readLibrary`, so an escaping bug in
`writeLibrary` cannot hide behind a reader just as lenient, and one run lists every
broken entry. And `.github/workflows/drawio-desktop.yml` has Draw.io Desktop export
every committed mark, 400 to a page, the GCP marks drawn with luminance masks and
filters among them, and fails any mark with under 1% ink in its own tile.

`.gitattributes` marks every `.drawio`/`.xml` as binary so line-ending normalisation
cannot rewrite them — without that, a checkout on Windows would break every hash.

## Seeing what you shipped

Structural checks cannot notice that "Cloud Run" is wearing Cloud Scheduler's artwork.
Contact sheets can. Every pack is rendered as a labelled grid and committed as a PNG in
`assets/libraries/contact-sheets/`, so a reviewer can look rather than trust.

`contact-sheet.mjs --png` runs headless Chrome with a throwaway profile in the system
temp directory and removes it afterwards, whether the shot worked or not. The only file
it adds is `<pack>.png`, and only once the screenshot is a real PNG; a failed pack is
reported as `FAILED` and keeps its previous sheet. Add `--keep-html` to keep the page
it rendered; without `--png` that HTML is the output. Older versions left the profile
(cookies, history, login data) in `contact-sheets/.shot/` — if you have that
directory, delete it.

A sheet shows what shipped, not who looked or what they concluded. For that there is a
review record, `assets/libraries/reviews/<pack>.json`: one row per shipped id, with the
sha256 of the payload that was looked at, a verdict (`ok` or `mismatch`), the reviewer,
the date and an optional note. A row counts only while the artwork still has that hash,
so a rebuild that changes a mark re-opens exactly that entry, and an entry with no row
is `unchecked` rather than implied by a sheet someone glanced at.

```bash
node $S/contact-sheet.mjs --pack azure --review           # status, and every page
node $S/contact-sheet.mjs --pack azure --review --page 3  # one page
```

Review pages show 54 marks at 120px, each captioned with its title, id, upstream file,
library index, short hash and review state, with unchecked and stale tiles highlighted.
They are written to the gitignored `contact-sheets/review/`. The suite fails if any
shipped Azure mark is unchecked, stale, recorded as a mismatch or carries an unknown
verdict, or if the record names an id that no longer ships (#18).

Two Azure pairs share a name *and* a folder — Microsoft ships two different `Workspaces`
marks in `compute` and two `Load Balancer Hub` marks in `networking`. The second of each
is captioned with Microsoft's file number, `Workspaces (00400)` and
`Load Balancer Hub (029029174)`, because a folder suffix would tell them apart from
nothing. Their ids are unchanged, and the old captions still resolve.

Ten Azure captions are corrected from Microsoft's file names, which misspell a service
(`Promethus`, `Entra Privleged Identity Management`, `Defender Programable Board`), drop a
capital (`Azure a`, the Azure logo) or run the words together (`AzureAttestation`,
`ExtendedSecurityUpdates`, `MachinesAzureArc`, `VPNClientWindows`, `Windows10 Core
Services`, `Web Application Firewall Policies(WAF)`). The corrections live in the azure
pack's `titles` map in `sources.json`; ids are unchanged and the upstream spelling stays
a search alias.

## Coverage, honestly

Across the five reference diagrams, only 20 of 97 embedded image placements — 9 distinct
icons — came from the original AWS library. Most AWS services are drawn with built-in
`mxgraph.aws4.*` shapes. The remaining 77 were pasted third-party vendor logos, which is
exactly the gap these packs close: the products those diagrams reached for by hand —
Snowflake, Grafana, Databricks, Datadog, GitHub — now resolve from bundled bytes.

The AWS pack is built from Amazon's own AWS Architecture Icons package (July 2026): every
service icon at 64px, embedded verbatim and pinned by sha256. Every id the original
243-entry palette used still resolves, and its captions stay searchable. Five Amazon
Bedrock AgentCore feature marks exist only as ~1024px rasters Amazon published outside
the package; they ship proportionally shrunk to 156px, twice the size they are drawn
at, from committed files under `assets/libraries/local/` — which took the pack from
7.3 MB to 1.5 MB.

## Third-party product logos

The packs cover most of a real architecture. Everything else — a niche vendor, an
internal product, one of the marks catalogued without artwork (`--stats` for the
live count) — gets its actual logo, downloaded and embedded.

This is not a nice-to-have: in the five reference diagrams, **77 of 97 embedded images
were third-party logos**, not AWS icons. A grey box labelled "Snowflake" is a
regression against how these diagrams are actually drawn.

### The flow

```bash
S=skills/arkitect-drawio/scripts

node $S/fetch-logo.mjs --url https://.../snowflake-logo.png --name snowflake
node $S/fetch-logo.mjs --list
node $S/fetch-logo.mjs --inspect snowflake
```

Already downloaded it by hand? Adopt the file instead of re-fetching:

```bash
node $S/fetch-logo.mjs --file ~/Downloads/snowflake.png --name snowflake
```

Then use it in a spec by name:

```json
{ "id": "sf", "kind": "logo", "logo": "snowflake", "label": "Snowflake", "col": 3, "row": 1 }
```

Or emit a single cell:

```bash
node $S/fetch-logo.mjs --cell snowflake --label "Snowflake" --x 200 --y 120
```

### Transparent background

A logo baked onto a white rectangle looks wrong on the canvas and worse inside a
coloured boundary. Every cached file is checked and the result recorded:

- **PNG** — read from the IHDR colour type. Types 6 and 4 carry an alpha channel; type 3
  counts only when a `tRNS` chunk is present; types 2 and 0 are opaque.
- **SVG** — flagged when a full-canvas `<rect>` or a painted `background` is present.
- **JPEG / WebP** — treated as opaque; JPEG has no alpha at all.

An opaque file still caches, but the tool warns and `build-diagram.mjs` repeats the
warning in its report. Treat that as a prompt to find a better source, not as noise.
"transparent png" or "logo svg" in the search usually gets you there; SVG is ideal.

### Where to look

In rough order of reliability:

1. the vendor's own press-kit or brand page
2. their GitHub organisation avatar, or assets under `docs/` in their repo
3. Wikimedia Commons

Prefer a page offering a downloadable asset over scraping an `<img>` out of marketing
HTML. Use WebSearch/WebFetch to *find* the URL; hand the URL to the script, which does
the binary download.

**Then look at the file.** Brand searches return old logos, fan art and lookalikes. Read
the cached image back before shipping it.

### Sizing

The longest side is fitted to **64px** by default, preserving aspect — so a wide
wordmark stays wide and short instead of being squashed into a square. That is smaller
than the 78px AWS service icons, matching the reference corpus, where vendor logos
cluster at 60–64px.

Override per node with `"size"`, or pin exact dimensions with `"width"`/`"height"`.

Several vendors together belong in an *external systems column* (pattern 6): a bordered
box outside the cloud boundary, bold heading, logos stacked vertically at ~60px, with
one arrow leaving the column as a whole rather than one per logo.

### Privacy

Only the logo URL is ever requested — a public asset download leaks nothing.

What would leak is the **query**. Search the product name alone. Never put a customer
name, project codename, hostname, or anything else from the diagram into a search term
or URL.

### The cache

Files live in `skills/arkitect-drawio/assets/logos/`, with an `index.json` recording file
name, MIME type, dimensions, transparency, SHA-256 and source URL.

The directory is **gitignored**. Logos carry their own trademark and licensing terms,
and generated diagrams embed the image anyway, so a diagram stays portable whether or
not the cache travels with it. If a particular logo belongs in the repo, force-add it:

```bash
git add -f skills/arkitect-drawio/assets/logos/snowflake.png
```

Because the cache is local, a `kind: "logo"` node **embeds** the bytes rather than
linking. A remote URL in a cell would break for everyone else, and
`validate-drawio.mjs` flags it.
