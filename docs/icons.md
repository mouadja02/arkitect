# Icons

A box labelled "Snowflake" is a wireframe of your system, not a diagram of it.
Arkitect ships 6,005 marks and refuses to fake the rest.

```bash
arkitect drawio icon "bedrock"          # 4,843 marks in 18 packs
arkitect drawio icon --list-packs       # what each pack holds, live counts
arkitect excalidraw icon "postgres"     # native libraries, then the shared packs
arkitect excalidraw icon --stats
```

## What ships

| | Draw.io | Excalidraw |
|---|---|---|
| bundled | 4,843 marks across 18 packs | 1,162 native items across 36 libraries plus 4,843 shared marks |
| coverage | AWS (311), Azure (638), Google Cloud (249), plus curated packs for data platforms, databases, AI frameworks, ML, streaming, observability, DevOps, security, GitHub, SaaS, languages and file types; agent and architecture concepts as tiles; 3,092 more brands as a catch-all | AWS (249), Azure (86), GCP (83), Google products (139), Snowflake (54), data platform (33), DevOps (29), IT logos (38), plus system-design components, forms, network topology, sticky notes |
| beyond that | Draw.io's built-in `mxgraph.aws4.*` shapes; a fetched logo | a library from the public catalogue; an icon built from a logo |
| per-pack detail | [pack index](../skills/arkitect-drawio/references/pack-index.md) | [library credits](../skills/arkitect-excalidraw/assets/libraries/bundled/ATTRIBUTION.md) |

## The rule

**Never draw one product's mark for another.** Not a similar service, not the
same vendor's other product, not a generic glyph standing in for a named thing.
A wrong logo ends up in someone's slide deck and gets believed.

The honest answers, in order:

1. A bundled mark, found by product name, when the search is confident.
2. An unnamed Excalidraw item, found on its numbered contact sheet
   ([below](#items-with-no-name)).
3. The real logo, fetched from a URL you name (Draw.io), or built into an icon
   (Excalidraw).
4. A placeholder: a dotted slot with a `?`, captioned, grouped, listed in the
   build report. Nothing else looks like it, so it can't pass for a finished
   node. In Excalidraw it's the default for a product nothing covers.

## How search decides

Both engines search by product name and say whether the top result may be
drawn unattended. A result that isn't confident is a question, not an answer.

- **Ranked.** Vendor packs rank 10, curated packs 20, the `brands` catch-all 90,
  so `docker` resolves to `devops/docker`, not to whichever brand matched first.
- **Steered.** A spec's `context.packs` (`["gcp", "devops"]`) settles ties
  toward the stack being drawn; a node's own `pack` pins it.
- **A fragment isn't a name.** `postgres` names PostgreSQL, `rabbit` names
  RabbitMQ. `tempo` doesn't name Grafana Tempo, so it comes back flagged.
- **A generic word isn't a vendor's product.** `service`, `storage`, `function`
  never take an AWS, Azure or GCP mark unattended; the node gets a labelled box
  or a placeholder (#231). Azure's App Service is named entirely in generic
  words, so it needs `context.packs` or its exact id.
- **The product before the vendor.** "HashiCorp Vault" draws Vault, not
  HashiCorp's company logo (#285). "Redis cache" draws Redis, and ElastiCache
  only when the spec names AWS (#283).
- **Ties stay open.** Two packs with the same exact title, Azure and
  `primitives` both calling one mark **Monitor**, both come back flagged until
  `context.packs` names one (#75).

Searches never print image payloads. `--compact` prints one line: the verdict
and a spec node to paste. The rules are held to account by answer keys: for
Draw.io, `tests/icon-queries.json` is an answer key of 471
queries, plus 43 that must
come back flagged, and the suite fails on any confident wrong answer.

Search results also carry:

| key | means |
|---|---|
| `lifecycle` | the product was discontinued, renamed, absorbed, acquired or archived; the entry still resolves, with a one-line caveat and the successor's id (#83) |
| `sameArtworkAs` | other ids that draw the identical picture; a build reports two of them used together (#77) |
| `artwork: "pinned"` | an on-demand mark with a file to fetch, and the `fetch-logo` command |

The 160 on-demand entries are catalogued with a licence finding and no bytes:
most have no permissively licensed mark, some were removed from Simple Icons at
the brand owner's request, and a few official logos don't draw at icon size.
Each says why, and a build won't draw one. What lets a mark ship is a licence
covering the artwork, or a trademark policy allowing identifying use; a
repository holding the file is not enough (#11, #20).

## Draw.io

| tier | packs | artwork |
|---|---|---|
| vendor | `aws` `azure` `gcp` | the vendors' own icon sets, byte for byte |
| curated | `data-platforms` `databases` `ai-frameworks` `ml-training` `streaming-orchestration` `observability` `devops` `security-identity` `github` `saas-collab` `languages-runtimes` | Simple Icons in the brand's colour, devicon originals, and project logos licensed for it |
| generated | `agents` `primitives` `file-types` | Lucide and Octicons glyphs composed into tiles |
| catch-all | `brands` | every other Simple Icons mark, ranked last |

A mark is drawn at a 78px footprint. A wide wordmark keeps its aspect: its
short side is at least a third of the footprint and its long side at most
twice it, so the text stays legible (#76, #254).

### Logos

For a product the packs miss:

```bash
arkitect drawio logo --url https://.../snowflake.svg --name snowflake
arkitect drawio logo --file ~/Downloads/snowflake.png --name snowflake   # adopt a file
arkitect drawio logo --list
arkitect drawio logo --inspect snowflake
```

```json
{ "id": "sf", "kind": "logo", "logo": "snowflake", "label": "Snowflake", "col": 3, "row": 1 }
```

Look in the vendor's press kit or brand page first, then their GitHub
organisation, then Wikimedia Commons. Prefer SVG. Read the cached file back
before using it: brand searches return old logos and lookalikes.

A logo is embedded, never linked; `validate` flags a remote URL. Its longest
side fits 64px by default, with the same wordmark floor as the packs;
`"size"`, or `"width"` and `"height"`, override it per node.

## Excalidraw

### Bundled libraries

36 libraries, 1,162 items, committed and searched first. All native geometry:
every mark takes the hand-drawn stroke and can be recoloured or pulled apart
in the app.

```bash
arkitect excalidraw libraries                    # one line per library
arkitect excalidraw libraries --items gcp-icons
arkitect excalidraw icon --resolve data-platform:9
```

A node that names a product without a ref draws a library item only when the
hit **is** that product; anything less is a placeholder with the reason. The
Excalidraw answer key is `tests/excalidraw-icon-queries.json`.

Two things to know: most AWS, Azure and data-platform items draw their own
name, so the builder skips its caption and lists them under
`icons.selfCaptioned`; and libraries differ in style (hachured AWS squares,
flat GCP line art, black IT glyphs), so keep to one library per diagram where
you can.

### Items with no name

239 items carry no name, mostly the GCP, DevOps and technology-logo libraries.
Search can't find them and the index won't invent a name. Each such library has
a numbered contact sheet in
`skills/arkitect-excalidraw/assets/libraries/bundled/sheets/`: find the mark,
use its number.

```json
{ "kind": "icon", "icon": "gcp-icons:37", "label": "Pub/Sub", "col": 1, "row": 0 }
```

### Shared packs

When no library item is confident, the 4,843 Draw.io marks fill the gap as
embedded original SVG or PNG. Caption, size and connections stay editable; the
logo's paths are not Excalidraw strokes. Pick one exactly with its Draw.io id:

```json
{ "id": "db", "kind": "icon", "icon": "drawio:databases/postgresql", "label": "PostgreSQL", "col": 0, "row": 0 }
```

A library choice that already worked keeps its precedence: `kafka` still draws
the native Kafka item. Artwork is embedded under its source's existing terms,
never traced or recoloured, and its digest is checked first; a mismatch stops
the build. On-demand marks aren't available here. The
[shared-pack example](../skills/arkitect-excalidraw/assets/templates/shared-icon-packs.spec.json)
mixes the two.

### Building an icon from a logo

Only when you ask for one. A traced SVG becomes native Excalidraw lines and
takes the hand-drawn stroke; anything else is embedded as an image.

```bash
arkitect excalidraw make-icon --url https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/dbt.svg --name dbt --trace --label "dbt"
arkitect excalidraw make-icon --file ~/Downloads/logo.png --name acme
arkitect excalidraw make-icon --restyle dbt --trace --monochrome --size 96
arkitect excalidraw make-icon --list            # also --inspect, --remove
```

The tracer handles paths (arcs included), basic shapes, nested transforms,
`viewBox` and both fill rules, painting holes in the canvas colour. It reports
what it skips (gradients, masks, filters, text, `<use>`) instead of dropping it
silently: when `skipped` isn't empty, look at the render. Simple Icons SVGs
trace cleanly.

| flag | effect |
|---|---|
| `--size N` | longest side; default 80 |
| `--monochrome`, `--outline` | one colour; strokes only |
| `--stroke #hex`, `--stroke-width N`, `--roughness N` | line style |
| `--hole-color #hex` | for a canvas that isn't white |
| `--force` | replace an icon of the same name |

### The public catalogue

[libraries.excalidraw.com](https://libraries.excalidraw.com), from the CLI:

```bash
arkitect excalidraw browse --search "kubernetes"
arkitect excalidraw browse --install slobodan/aws-serverless.excalidrawlib
arkitect excalidraw browse --preview aws-serverless --out sheet.excalidraw
```

Installed libraries are searched after the bundled set and your built icons.
Most published libraries are format v1, with no item names: render the preview
sheet and read the numbers instead of guessing. Authors keep their licences,
recorded in `installed.json`.

## Transparency

A logo on a white rectangle looks wrong inside a coloured boundary. Every
fetched or built file is checked (PNG from its colour type, SVG for a
full-canvas background, JPEG and WebP counted as opaque), and an opaque one is
warned about at fetch time and again in the build report. A traced SVG has no
background at all.

## Where things live

```
~/.arkitect/drawio/logos/            fetched logos, index.json
~/.arkitect/excalidraw/icons/        built icons, items/, house.excalidrawlib
~/.arkitect/excalidraw/libraries/    libraries installed from the catalogue
```

`$ARKITECT_HOME` replaces `~/.arkitect`. They sit outside the plugin, so an
update keeps them, and a diagram embeds what it uses, so it opens without
them. Caches from before 2.1.0 under `skills/*/assets/` are still read.

Only the URL you name is fetched. What would leak is the query: search the
product name alone, never a customer, codename or hostname
([privacy.md](privacy.md)).
