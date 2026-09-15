# Changelog

All notable changes to Arkitect are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/spec/v2.0.0.html).

A change adds its own one-line bullet under `### Added` / `### Changed` /
`### Removed` / `### Fixed` in `[Unreleased]` below, in the same pull request
that makes it — naming the issue or PR it came from where one exists. No
separate file, no naming scheme, no required format beyond that.

## [Unreleased]

### Added

- Learned Draw.io style can change what gets drawn: `/apply-drawio-style` turns
  findings into a per-install override of named tokens and edge kinds that
  every CLI build merges in, `--defaults` ignores and `--print-style` shows (#89)
- Learned Excalidraw style can change what gets drawn too:
  `/apply-excalidraw-style`, `excalidraw findings`/`apply`, and `excalidraw
  build --defaults`/`--print-style` work as Draw.io's do, on one override layer
  both engines share (#90)
- Excalidraw can use all shared Draw.io marks via `drawio:<pack>/<slug>` or as
  a name-match fallback, embedded with provenance (#17)
- A 362-query icon-resolution answer key guards against confident wrong
  matches and rank-1 precision regressions (#15)
- Weekly/quarterly checks catch a removed or drifted upstream icon source and
  open an issue (#10, #9)
- Every committed Draw.io library is proven to load the way Draw.io itself
  reads one; GCP's masked/filtered legacy marks render correctly (#12, #13)
- Apache Iceberg, Pinot and Beam ship real icons from the ASF's own licensed
  originals (#11)
- Every shipped Azure mark is reviewed against its caption, with the review on
  record (#18)
- JAX, Flax, LightGBM, CatBoost, Metaflow and SigNoz ship their own
  project-licensed logos; nine more products catalogued on-demand with a
  recorded licence finding (#20)
- 123 products a modern data/ML/platform stack uses now all resolve — 38 ship
  their artwork, the rest are catalogued on-demand with the blocking licence
  named (#20)
- QuickSight resolves under the name AWS renamed it to; Aqua Security promoted
  out of the catch-all (#20)
- Teleport, Argo CD, Playwright and dlt get icons from sources already pinned
  in the repo, no new licence needed (#20)
- `excalidraw render` writes a real PNG on any OS using a local Edge, Chrome or
  Chromium (#39)

### Changed

- `docs/status.md` records what is done on main, what is left and in what
  order, dated, with every issue outcome reconciled against the repository
- Both engines share one backup and retention implementation, keeping their
  existing imports and generated output (#97)
- The AWS pack is rebuilt from Amazon's official July 2026 icon package: 311
  icons, up from 243, embedded verbatim and pinned by sha256 (#8)
- The AgentCore icon's five raster-only feature marks shrink from 4.65 MB to
  73 KB via a dependency-free area-average resampler (#7)
- 66 products are promoted from the generic `brands` catch-all into their
  proper curated packs (#19)
- Seven on-demand marks (Hudi, Samza, ActiveMQ, ZooKeeper, Crossplane, Flux,
  Open Policy Agent) now record why their official artwork can't ship (#11)
- The artwork licence bar is explicit: permissive licences ship, copyleft
  (MPL/LGPL/GPL/AGPL/SSPL/BUSL) does not, with two named brand-policy
  exceptions (#20)
- A vendor's published logo policy is checked ahead of the repository licence
  it happens to live in, in both directions (#20)
- `tests/icon-queries.json` grew to 492 rows; rank-1 precision is 96.4%, up
  from 94.5% (#20)
- Rebuilding a diagram no longer piles up unlimited backups — both builders
  keep the newest five plus the oldest and prune the rest, `--keep-backups N`
  (#49)

### Removed

- The `changelog.d/` fragment system, its CI gate and the `skip-changelog`
  label (#32) — entries are written directly into this file's `[Unreleased]`
  section again, as before #32. The fragment mechanism solved real PR
  conflicts, but the folder, naming scheme, issue-linking regex and assembly
  tool were more apparatus than a project this size needs.

### Fixed

- The repository-wide checks read the files git says are ours - tracked, plus
  new ones that are not ignored - instead of walking the working tree past
  three hand-written skip lists, so a local agent install in the repository
  root no longer fails the docs-link and redaction guards on a stranger's
  Markdown
- The 12 Azure review contact sheets are untracked: 6.3 MB that `.gitignore`,
  `package.json` and two docs all described as not being in the repository,
  and a check now fails on any tracked file gitignore excludes
- `icon-build.mjs` no longer carries a raw NUL byte, which made every diff and
  grep treat the file as binary; the two tar type bytes it compared against
  were unreachable anyway
- A spec naming an icon by its exact catalog id now draws that id's own mark:
  `<pack>/<slug>` is looked up as an id, not passed through text search, which
  drew another product's mark for 752 of the 4,843 committed ids (#95)
- A fetched logo is sized from the root `<svg>` element's own attributes, so a
  child `<rect>` or a `stroke-width` can no longer set its aspect, and both
  engines now read the same bytes the same way (#96)
- An invalid installer argument is refused before any adapter is written, a
  prototype-key command is a usage error rather than a crash, and an unknown
  test suite or flag is rejected (#97)
- The docs no longer show stale CLI examples or overstate what a preview
  needs, and the README introduction is shorter (#97)
- The Excalidraw library README links to `docs/excalidraw-libraries.md`
  instead of a page that no longer exists, and the docs link check now reads
  first-party Markdown inside library folders (#87)
- A plugin update no longer wipes what the learning skills learned: records,
  source lists and notes live in `~/.arkitect/` (`ARKITECT_HOME`), outside the
  plugin (#89)
- Long file-type extensions render readably instead of shrinking to 5.65px
  (#14)
- Draw.io `validate`/`build`/`analyze` no longer misread a flag's value as a
  file, or silently skip an unchecked page (#37)
- `contact-sheet.mjs --png` no longer leaves a Chrome profile (cookies,
  history) behind in the skill directory (#44)
- The npm package is trimmed from 106 MB/153 MB to 16 MB/47 MB packed/unpacked
  by excluding local-only caches and profiles (#38)
- A spec naming a missing node, parent or edge endpoint is refused before
  anything is written, in both engines (#36)
- Two rebuilds in the same second no longer overwrite each other's backup
  (#35)
- A name fragment (`tempo`, `cube`, `active directory`) no longer resolves
  confidently to an unrelated product (#21)
- A non-square icon no longer stretches to a square cell; size now fits the
  longest side
- Excalidraw's name-only fallback no longer draws an unrelated product;
  unresolved names become a reported placeholder instead (#22)
- gRPC and Memcached icons render again after their embedded SVG's dropped
  namespace declarations were restored
- A broken SVG icon payload can no longer pass validation; every payload is
  now parsed by a strict XML checker (#33)
- gRPC renders in its brand colour instead of black, via a new `paint: tint`
  flag for single-colour devicon marks (#31)
- Draw.io edges no longer route straight through an icon's caption; `validate`
  warns on any route that still crosses one (#45)
- `doctor` finds Draw.io Desktop the same way `render` does, instead of
  checking 4 hard-coded paths (#46)
- The documented fresh-clone test count is checked by the suite itself instead
  of drifting silently across 4 files (#47)
- An unknown node/edge `kind` (a typo) is named in the build report instead of
  silently drawing a fallback with no trace (#48)
- The committed worked examples are proven byte-identical to a fresh build
  from their spec (#50)
- `AGENTS.md` and both engine `SKILL.md` files no longer contradict each other
  on icon-search order, spec-vs-hand-written-XML, or the render/commit policy
- The Draw.io icon search's own hint no longer suggests a command that prints
  base64 icon bytes into an agent's context
- `pack-index.md` and `ATTRIBUTION.md` are regenerated after drifting out of
  sync with the current icon catalog
- The bundled-icon count no longer drifts independently across `plugin.json`,
  `marketplace.json`, `package.json` and the installer's adapter text
- `learn-excalidraw-style/SKILL.md` no longer contradicts itself about whether
  the shipped style record already carries real evidence
- A Draw.io search, `--cell` and a build size a shipped mark at its library
  cell, so Restate is placed at 78x69 instead of 78x71 (#80)

## [1.1.0] — 2026-09-12

Eighteen Draw.io icon packs instead of one AWS palette, and a resolver that says
when it is not sure.

### Added

- **Seventeen new icon packs**, ~4,500 new marks, built by `build-packs.mjs`
  from `assets/libraries/sources.json` — a pinned manifest where every upstream
  carries an exact version or a recorded sha256.
  - Vendor sets, embedded verbatim: `azure` (638), `gcp` (249).
  - Curated: `data-platforms`, `databases`, `ai-frameworks`, `ml-training`,
    `streaming-orchestration`, `observability`, `devops`, `security-identity`,
    `github`, `saas-collab`, `languages-runtimes`.
  - Generated from Lucide and Octicon glyphs: `agents` (33 agent-architecture
    concepts), `primitives` (43 generic concepts), `file-types` (35 document
    sheets badged with an extension).
  - `brands` (3,158) as a catch-all, ranked strictly below every curated pack.
- **Pack-aware resolution.** `find-icon.mjs` ranks across every pack, gains
  `--list-packs`, `--pack` and `--context`, and returns a confidence verdict
  with alternatives instead of always handing back its best guess.
- **Spec-level icon steering.** `context.packs` on a spec biases ties toward the
  stack being drawn; `pack` on a node pins it outright.
- **On-demand catalogue entries.** 69 products whose marks carry no
  redistribution licence are catalogued with a URL, a licence note and the exact
  `fetch-logo` command — and no bytes. `build-diagram.mjs` refuses to draw them
  rather than substituting another product's mark.
- **Contact sheets** for every pack, committed as PNGs, because no structural
  check can notice that a service is wearing the wrong artwork.
- `contact-sheet.mjs` and `write-pack-docs.mjs`; `arkitect drawio packs` and
  `arkitect drawio sheets`.
- `references/pack-index.md` and `assets/libraries/ATTRIBUTION.md`, both
  generated from the catalog so they cannot drift from what shipped.

### Changed

- **Icon titles are readable.** `Arch Amazon-Route-53 64` is now
  `Amazon Route 53`. The old palette captions, plural forms and acronyms are all
  kept as aliases, so `s3`, `data factory` and
  `Arch Amazon-Simple-Storage-Service 64` all still resolve.
- `icon-catalog.json` is pack-aware: namespaced ids, per-icon licence and
  source, and `bytes: committed | on-demand`. Still metadata only.
- `arkitect drawio library` is now `arkitect drawio packs`.

### Removed

- `AWS-v1.drawio` and `AWS-icons.merged.drawio` were content-identical, and
  `AWS-icons.drawio.xml` was a 237-entry subset missing the six AgentCore
  icons. One survives as `aws.drawio` with its artwork untouched; deleting the
  other two reclaims 8.8 MB, which nearly pays for everything added above.
- `extract-library.mjs`, which verified that two AWS palettes byte-matched.
  `build-packs.mjs --verify` checks what matters now: that every committed
  library still matches the manifest it was built from.

### Fixed

- Simple Icons lists "Terraform" as an alias of OpenTofu, which put a fork one
  point behind the real product. The catch-all no longer carries names a curated
  pack already owns.

## [1.0.0] — 2026-09-08

First public release. Two diagram engines, one contract, no dependencies.

### Draw.io

- Native `.drawio` generation from a JSON spec: grid layout, boundaries,
  five connector kinds, an auto-generated legend, collision-free placement.
- A 243-entry AWS Architecture Icons palette, searchable by product name, with
  duplicate titles disambiguated by index, dimensions and payload hash.
- Real product logos for non-AWS components: fetched from a URL you name,
  transparency-checked, embedded in the cell rather than linked.
- A structural validator and a page-scoped analyzer that never pulls XML or
  labels into context.
- PNG rendering through Draw.io Desktop, with the 1-based `--page-index`
  off-by-one corrected.

### Excalidraw

- Native `.excalidraw` generation with every arrow bound at both ends,
  boundaries sized from their contents, and seven connector kinds.
- 36 bundled icon libraries — 1,162 items, all native vector geometry — covering
  AWS, Azure, GCP, Snowflake, the data-platform stack, DevOps tooling and
  general IT logos, with numbered contact sheets for the 239 unnamed items.
- Icons built from real logos: `--trace` converts a flat SVG into native
  Excalidraw geometry, holes and fill rules included.
- The public library catalogue, searchable and installable from the command
  line.
- An honest placeholder for anything unresolvable, named in the build report.
- A dependency-free SVG renderer that reproduces the hand-drawn stroke, plus PNG
  rasterisation through headless Edge or Chrome.
- Excalidraw in Docker: the official image, read-only, no backend, nothing
  uploaded.

### Both

- A learned house style per engine, every rule carrying its evidence count and
  confidence, with defaults marked as defaults.
- Two user-invoked learning skills that fold your own diagrams into the record —
  merging rather than replacing, and lowering confidence on contradiction.
- Structural-statistics-only style records: no labels, page names, paths or image
  payloads, enforced by a test.
- `bin/arkitect.mjs`: one command surface over both engines, plus `doctor` and
  `install`.
- Agent adapters for Claude Code (a 4-skill plugin), Codex, Cursor, OpenCode,
  GitHub Copilot, Antigravity and Pi, generated with the install path baked in.
- An offline test suite of 118 checks across both engines and the toolkit,
  including a redaction check that fails the build if anything from a
  reference diagram leaks into the repository.
