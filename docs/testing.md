# Testing

```bash
node tests/run-tests.mjs                # all three suites
node tests/run-tests.mjs drawio         # one of them
node tests/run-tests.mjs excalidraw
node tests/run-tests.mjs toolkit
```

Offline, deterministic, no network, no Docker, no dependencies. About 20
seconds on a laptop, up to a minute on a CI runner.

On a fresh clone expect `312 passed, 0 failed, 7 skipped`. The skips are
the tests that need reference diagrams of your own — a clone has none. That is
the correct result, not a problem. Point them at your files with
`.analysis/sources.local.json`
([getting-started.md](getting-started.md#the-local-source-list)) and they run.

That line is the only place the count is written down, and every full
`run-tests.mjs` run checks it: passed plus skipped must equal the number of
tests that ran, the skipped count must equal the tests declared with
`sourceTest()`, and on a checkout without local sources every skip must be one
of those. A pull request that adds a test updates the line; when it no longer
matches, the runner prints the line to use. With local sources present, the
runner also prints the fresh-clone expectation beside the local numbers. Quote
that, never the local result (#47).

Each suite writes its scratch to `tests/output/<engine>/` and is a separate
process, so they cannot tread on each other.

## What is covered

### Both engines

| area | checks |
|---|---|
| Generation | valid native output; unique ids; every edge connected at both ends; no overlaps; learned style tokens applied; a legend only when earned |
| Spec checks | a spec naming a missing node, parent or boundary, a cycle, or a missing, repeated or reserved id is refused before any backup or write, every problem listed; the CLI exits 1 and leaves the target untouched; nested boundaries still build; Draw.io automatic edge ids skip taken ids and an unknown edge kind draws as a flow (#36); in both engines an unknown node or edge kind still builds and the report and CLI name its field, value, fallback and the valid kinds, an inherited name such as `constructor` counts as unknown, and the Excalidraw arrow it draws carries the flow stroke (#48) |
| Spec numbers | in both engines a node or boundary without `col` or `row` is drawn at 0 with no `NaN`, and fractional, negative and Unicode-labelled examples still build and validate; a string coordinate, a size, pitch or font size of 0 or less, a span under 1, a negative padding, gap or roughness, a non-numeric Excalidraw `style` token and a layout that is not an object are each refused in one run with their field path, by `buildDiagram` and by the CLI, before any backup or write (#115) |
| Update safety | a timestamped backup is written before an existing file is replaced; repeated updates in the same second, with a backup name already taken, each keep their own version (#35); after a successful write each builder keeps the oldest backup of that target and the newest five, counting `-10` as newer than `-2` and any later second as newer than every counter, never reusing a counter that pruning freed, and never touches another file's backups, a lookalike stem, another extension or a hand-named copy; `--keep-backups N` sets the count, `0` keeps all, and a malformed value exits 2 before any backup is written or deleted (#49) |
| Honesty | an unresolvable icon degrades to a named placeholder or labelled box and is reported, never substituted |
| Analysis | structure and style emitted; labels, element text and image payloads never |
| Compact icon search | `icon --compact` in both engines prints one line of at most 1,000 bytes with the full search's verdict and a spec node; an ambiguous query keeps four bounded choices and no node; a lifecycle caveat, its successor and an on-demand next step survive; a miss says what to do; the full output is unchanged (#117) |
| Plugin shape | the manifest is valid, all six skills are well formed, the learning and apply skills are user-invoked only, CI expects the same skill count, no hard-coded install paths |
| Context budget | each drawing `SKILL.md` plus its largest pattern section is at most 12,000 bytes; every file its reading table names exists, editing, icons, rendering and the style guide each have a reading path, the pattern selector offers exactly the catalog's sections, and the privacy, icon-honesty and render rules are still in `SKILL.md` (#113) |
| Headless runs | a local `DISPLAY` counts only when its X socket exists, so a sandbox that hides it gets `xvfb-run` and the log says why; a failed Draw.io export names its exit code or signal and first error line; on Linux a packaged Chrome or Edge is chosen before Chromium and the snap `chromium-browser` wrapper last, and a failed PNG render drops Chromium's start-up chatter and names `--no-sandbox` when the browser could not nest its sandbox; both builders create a missing output folder (#113) |
| Committed examples | every documented command that rebuilds a Draw.io or an Excalidraw template passes `--defaults`, so a personal style override never reaches the repository; each engine must have at least one such command (#89, #90) |
| Packaging | the real `npm pack` tarball, with a sentinel planted in every local-only location, ships every bundled asset and none of the caches, cached logos, built icons, downloaded libraries, contact-sheet HTML, browser profiles or backups, and unpacks under 60 MB; extracted outside the checkout its CLI runs `version`, `doctor`, both icon searches and a build and validate per engine, and `test` exits 2. Uses the npm beside Node, offline; skips only if there is none (#38) |
| Redaction | no sensitive string from a reference diagram appears anywhere in the repository |
| Repository contents | the repository-wide checks - broken docs links and both redaction guards - read the files git says are ours: tracked, plus new ones that are not ignored, so a local agent install or any other untracked directory in the checkout is not mistaken for our own text; nothing git tracks is a file `.gitignore` excludes, which an ignore rule written after a force-add cannot fix on its own |
| Icon counts | every exact icon count a doc quotes — the marks that ship, the bundled total across both engines, the entries catalogued without bytes, each pack's count in the Draw.io skill's table, the Excalidraw library and item totals, and both answer keys' sizes — is checked against the catalog, the library index and the query files, and the failure names the value to write; a sentence that stops quoting its number fails too, so rewording one is deliberate (#78) |
| Test harness | the three suites share one synchronous `test()`: a callback that returns a promise, whether it later resolves or rejects, fails with that reason instead of passing before its assertions ran, and its rejection cannot end the run; a synchronous throw still fails with its message and a skip still skips (#114) |

### Draw.io

| area | checks |
|---|---|
| Library parsing | entry counts and file digests for every pack, SVG and PNG dimension decoding; an SVG's size is read from the root element's own attributes, viewBox first, so a child `<rect>`, a `<symbol>` in `<defs>`, a `stroke-width` or a percentage cannot set it, every committed SVG entry reads the size its own root declares, and the Excalidraw engine reads the same bytes identically (#96) |
| Library loading | every committed `.drawio` library loads the way Draw.io's `EditorUi.loadLibrary` reads one — a strict XML parse with an `<mxlibrary>` root, then `JSON.parse` of its text — using a loader that shares no code with `readLibrary`; every SVG payload is parsed as XML by a strict, dependency-free checker, so a mismatched or unclosed tag, a raw `&`, an undefined entity, a namespace prefix used out of scope, bytes that are not UTF-8, or a root that is not `<svg>` in the SVG namespace fails it; one run lists every broken entry by pack, index and catalog id, not only the first; `build-packs` refuses to write a pack holding one, naming each, and `--verify` parses every committed payload; the checker refuses the four malformed inputs the Excalidraw tracer accepts and accepts comments, CDATA, references, a DOCTYPE entity and scoped namespaces; a mis-escaped library is proven to fail the loader (#33) |
| Invisible marks | a mark whose every fill, stroke and gradient stop is white or near-white is refused: white fills, a white root fill, a style declaration, a style sheet, white-only stops, and white under a clip path drawn in the default black; an implicit black fill, a stroke-only mark, white on a coloured plate, one dark stop, `currentColor`, an embedded raster and a child overriding a white group are accepted; `build-packs` names every such mark with its upstream file, `--verify` checks every committed payload, and no shipped mark paints only white (#85) |
| Tile ink | ink is measured inside each mark's own tile of an export page: on a synthetic page, one blank tile beside a drawn one is found although the page as a whole carries ink (#33) |
| Desktop export (opt-in) | every committed mark — 400 to a page, fitted to 78px with no caption or border, in a column widened on every page alike to hold the widest lockup, so no two tiles overlap and each page is exported at the width it was laid out for, the five GCP marks with masks and filters among them — exported by Draw.io Desktop; a mark with under 1% ink in its own tile fails, every such mark is listed, and the ten sparsest are printed (#33). Runs with `ARKITECT_DRAWIO_SMOKE=1` |
| File-type bands | band text on a file sheet never renders under 8px: a ten- or eight-letter band and an empty `band` are refused, a short `band` replaces the extension at 9px; every committed file-types entry meets the floor, `.dockerfile` and `.excalidraw` show `DOCKER` and `EXCALI`, and both are still found by their full extension (#14) |
| Contact sheets | with a fake Chrome that fills its profile with cookies and history: the profile and the page it renders live outside the repository and are removed, and only `<pack>.png` is added; a crash, a timeout, no screenshot, an empty one or a non-PNG is reported and leaves the previous sheet untouched; the HTML stays only without `--png`, with `--keep-html`, or when there is no Chrome; a legacy `.shot/` profile is reported, never deleted (#44) |
| Review record | a record row counts only at the payload hash it was reviewed at: a changed mark is stale, a recorded mismatch or an unknown verdict stays open, a row for an id that no longer ships is orphaned, and an entry with no row is unchecked; review pages put every entry on exactly one page of 54, with its id, hash and state, write only under `contact-sheets/review/`, refuse a page that does not exist before rendering, and fall back to HTML without Chrome; every shipped mark in each pack with a record - every pack, the `brands` catch-all included, each required to have one - is reviewed at the artwork that ships (#72, #73, #81); the two Azure pairs sharing a name and a folder are captioned by Microsoft's file number and keep their old caption as an alias; ten captions Microsoft's file names misspell or run together are corrected, with the ids unchanged and the upstream spelling still an alias (#18) |
| Vendor captions | AWS and Google Cloud captions whose file names dropped a hyphen, colon or capital are corrected, and both the corrected caption and the upstream spelling resolve to the same id; `Oracle Database@AWS` ranks its own mark first (#73) |
| Wrong-product marks | `databases/vespa` and `databases/nebula` are on-demand Vespa.ai and NebulaGraph entries that record why Simple Icons' marks of those names are the wrong products; the scooter and the streaming service stay in `brands`, and neither bare name resolves confidently to anything (#81) |
| Product lifecycle | a `status` is refused for an unknown state, a non-ISO date, a rename or absorption naming no successor, a successor id with no name, or an unknown field; the twelve changed products each carry one, every successor id is catalogued, `height` still resolves confidently, `find-icon` shows the state, caveat and successor id, a build lists the node under `lifecycle` while still reporting it to fetch, a dead product warns while a current name or an operating brand does not, and the drift pass lists only statuses checked a year ago or more (#83) |
| Duplicate titles | both Compute Optimizer variants retained, disambiguated by index, size and payload hash |
| Identical artwork | every committed row's `sameArtworkAs` names exactly the other ids with its payload hash, and no row without a twin carries one; Groups and My Customers, and the three Intune ids, name each other, while the Compute Optimizer pair, which only shares a title, does not; `find-icon` shows the twin; a build reports different ids drawing one picture with every node that draws it, and one id used twice is not a finding (#77) |
| AWS pack | built from Amazon's pinned package; every one of the 243 palette ids still present; AgentCore as one official SVG plus five 156px feature rasters matching their pinned digest; the PNG codec round-trips, area-averages and never enlarges; icon cells fit their image instead of stretching square |
| Catalog | no base64 payloads, required fields present; `recommendedSize` is the library cell of every committed mark, and a build, `--cell` and a search place Restate's 34.46x30.52 artwork at its 78x69 cell rather than refitting the catalog's rounded 34x31 (#80) |
| Wide lockups | a mark's short side is fitted to at least a third of the footprint and its long side to at most twice it, both as shares of the size asked for, so a 6:1 wordmark is 156x26 rather than 78x13, a mark past 6:1 stops at the ceiling, a square one is untouched and `--size 40` is honoured rather than inflated; no committed mark is left under the floor with room to grow, Iceberg's lockup ships at 95x26, and the export tiles widen so the nine redrawn cells cannot overlap a neighbour (#76) |
| Brand paint | a devicon mark flagged `"paint": "tint"` is filled with its hex through the root, keeping its namespaces and viewBox, while an explicit fill, `currentColor`, a stroke, a style, a gradient or a root `fill="none"` is refused; gRPC ships tinted `#00b0ad`, the ten full-colour devicon marks keep their pinned digests, and every tinted or tile-bright catalog row, and no other, records its hex (#31) |
| Licensed originals | Apache Iceberg, Pinot and Beam ship from the `asf-logos` local-files source: its terms record the ASF policy that licenses graphic logos under Apache-2.0, exactly those three originals are committed and match their pin, each catalog row embeds its file byte-for-byte and names its origin URL, and each library cell keeps the artwork's aspect (Iceberg 95x26); Hudi, Samza, ActiveMQ and ZooKeeper stay on-demand with the licence, the reason and the ASF's own render to fetch, and Crossplane, Flux and Open Policy Agent record the Linux Foundation finding and pinned CNCF artwork (#11); JAX, Flax, LightGBM, CatBoost, Metaflow and SigNoz ship their own logos from one `local-files` source each, whose note records the file and finding, whose LICENSE is linked at the commit the file came from, and whose committed file matches its pin, embedded byte-for-byte at its own aspect (CatBoost as its PNG) and resolving confidently by name; Flyte, Feast, KServe, SPIFFE, Sigstore, Cosign, Kustomize, Seldon Core and Dagger stay on-demand, each recording its licence finding and pinned artwork to fetch or, for Dagger, its brand page (#20). Apache APISIX joins the same `asf-logos` source under the same policy; the 38 modern-stack marks whose licence permitted it ship from one `local-files` source each, every one pinned to a 40-character commit or the ASF originals index, its cell fitted on both sides from the original's own size (#80), floored so a wide lockup is not drawn as a hairline (#76), with llama.cpp admitted by ggml-org's published brand-usage grant rather than by CC BY-NC alone; the findings that blocked a mark each name what blocked it - MPL-2.0, AGPL-3.0, SSPL, the Elastic Licence, BUSL, a Linux Foundation or vendor trademark policy, an unenumerated artwork directory, or no published logo at all - and OpenObserve records that the permissively licensed file which looked like its mark is still the ZincSearch logo; every one of the 142 products the issue names has an outcome, 49 of them shipping (#20) |
| Icon lookup | exact and fuzzy matches; an ambiguous query returns every variant; an unknown service returns no match; a fragment of a different product's name (`tempo`, `cube`) is flagged, not resolved; the 66 products promoted from the catch-all resolve from their curated packs with no copy left in `brands`; Teleport, Argo CD and Playwright ship as devicon's full-colour originals and dlt leaves the catch-all, each resolving confidently by name, while `argo` and `argo workflows` stay on the Argo mark; QuickSight resolves to `aws/amazon-quick` after Amazon's rename and Aqua Security is promoted out of the catch-all, neither needing new artwork (#20) |
| Resolution accuracy | the answer key in `tests/icon-queries.json`: zero confident wrong answers, precision at rank 1 above its floor, and the numbers printed on every run |
| Title ties | every set of packs sharing one exact title has a judgement row in the answer key and comes back flagged with no stack named; naming a pack’s stack settles the tie on that pack’s mark, except where the runner-up sits in the named pack too — Azure’s File beside its Files, and the primitives Monitor beside its Desktop — which stays flagged and is recorded as an exception (#75) |
| Exact ids | every one of the catalog's ids selects its own row: each committed id embeds the payload its `sha256` names, each on-demand id is reported to fetch rather than drawn, a build says which id it used, and a node pinning a pack the id does not belong to is reported instead of text-searched into another product's mark (#95) |
| On-demand artwork | every on-demand row with a pinned `upstreamUrl` says `artwork: "pinned"` and carries the one runnable `fetch-logo` command for it, every other row says `"none pinned"` and carries no command; each pack's pinned count matches its rows; for one entry of each kind, the refusal to produce bytes, the `find-icon` CLI output, the build report and `--list-packs` agree, and `pack-index.md` lists the two kinds apart with no placeholder URL (#84) |
| Releases | a bump computes the next version and refuses a non-semver or unknown bump; rolling dates `[Unreleased]` word for word under a fresh empty one, leaves older sections untouched, and refuses an empty section, an existing version or a non-ISO date; a model draft fills only an empty `[Unreleased]`, is refused for an invented heading, prose or an orphan bullet, has its code fence stripped, is sent as one bearer-authenticated POST to `chat/completions`, and a missing setting, a failed call or an empty answer fails; `release-prepare` runs only by hand and tests before writing, `release-publish` fires only on a merged `release/v*` pull request, checks the version before tagging, uses the changelog section as the notes, and neither publishes to npm (#88) |
| Upstream watch | a Simple Icons slug missing upstream is told apart as a removal or a rename, and only marks that ship bytes count (#10); a newer npm release or a changed archive hash is drift, and a source nothing ships from is skipped (#9); a committed project logo is compared at the default branch with its pinned commit - a redrawn or vanished file, a changed licence file, a policy page that is gone, and a repository newly archived, dormant for a year or answering under another name are each reported, while a repository already recorded as archived stays quiet and an upstream that cannot be read fails the check (#74, #82); every GitHub-backed logo source records `upstreamRepo`, with a note wherever it is archived or dormant; the workflow can open issues and nothing else |
| Cell styles | the comma-only data URI form; the embedded payload matches the catalog hash |
| Logos | transparency read from the IHDR; an opaque PNG flagged; sizing fits the longest side and preserves aspect; non-images refused |
| Validator | rejects duplicate ids, missing parents, broken edge endpoints; `--page 0` through the dispatcher validates that page, before or after the files, and `--strict` still fails on a warning; a page the file lacks fails, in the CLI and the API, without claiming a page was checked; a missing, negative, fractional, exponent, empty or non-numeric page value, a repeated `--page` and an unknown flag exit 2 with no stack trace; the API throws on a malformed index (#37) |
| Command lines | `build --out <file> <spec>` builds the spec and never writes to it; a malformed, missing or second spec, a missing `--out` or value, or an unknown flag exits 2 in one line with nothing written; `analyze --page` is checked the same way, a page the file lacks exits 1, and `--page` without `--cells`/`--images` or `--cells` over two files is refused (#37) |
| The record | carries no diagram content, no page names, no modification times |
| Worked example | two builds of the starter spec are identical, and the committed `starter-architecture.drawio` is byte-for-byte what the spec builds; the failure names the first differing line and cell (#50); no edge in it runs through a caption (#45) |
| Caption routing | an edge leaving an icon downward, or entering one from below, in the same column, attaches below the caption (34px, more for a caption on several lines); horizontal, diagonal and box-to-box edges are left to the router; the validator estimates each route from its ports and warns, naming the edge and the icon, when it crosses a caption, and names exactly the two crossings when those attachments are stripped (#45) |
| Personal style | the store defaults outside the plugin and `ARKITECT_HOME` moves it; with no override every build is byte-identical to the house style; the committed starter builds exactly through the API and through `--defaults` with a personal override planted, which a plain CLI build picks up; an override restyles tokens and kinds and adds a kind while a spec's own values still win; every field is checked — a raw style string, an unknown token or kind field, a bad colour, a pitch that stacks icons, a partial new kind, a wrong engine or schema — and a bad override is ignored whole, the build warning once and drawing the house style; `--print-style` shows the resolved style and writes nothing; learning tallies corner rounding and writes to the store, elsewhere only by `--out`; findings derive four tokens graded like conventions, refuse what a build would refuse, split a kind into fields and let an agent finding hold its target; apply lists only contradictions, strongest first with low confidence flagged, refuses a non-candidate, reports each change, drops values back at the house style, never replaces a broken override, and `--reset` restores the house style; style literals go through named tokens (#89) |
| Command lines | `build`, `analyze`, `validate` and `icon` refuse an unknown flag, a missing or repeated value and an extra or missing file with exit 2 in one line, before anything is read or written; a missing or malformed spec or scene is named in one line with no stack trace, and `validate` reports an unreadable file as its own failure without quoting it; `icon --limit` must be at least 1, a search, `--stats` and `--resolve` are separate requests, and flags may come before or after the words and files (#116) |

### Excalidraw

Shared-pack checks (#17) resolve every committed canonical ID and verify its
original payload hash, MIME type, dimensions and provenance. The native query
answer key still runs against the previous provider set; a second check keeps
every successful choice and verifies new fallbacks against the reviewed shared
product IDs. Tests also cover ambiguity, on-demand and malformed refs,
deduplication, bindings, integrity failures, metadata-only CLI output and both
shared-icon example specs. Local PNG review of the export gallery exercises
every pack plus complex SVG and non-square PNG cases; it is not an exhaustive
artwork audit (#18/#33).

| area | checks |
|---|---|
| Scene model | every field the app requires; `transparent` not `none`; index keys sorting past the single-digit boundary; relative arrow points |
| Bindings | bound text recorded on both sides; cloning rewrites internal references and drops external ones; `repairBindings` makes a one-sided binding whole |
| Labels | a diamond label wraps to the usable width, not the bounding box |
| Libraries | v1 and v2 both read back; v1 items genuinely have no name; the index and the files agree |
| SVG tracing | every path command including arcs; nested transforms; nonzero winding; even-odd parity; overlapping siblings not mistaken for holes; gradients and text reported rather than dropped |
| Hand-drawn stroke | deterministic per seed; roughness 0 draws straight |
| Icons | tracing preserves holes; `--outline` drops fills; raster embedding; tracing a raster refused; overwrite needs `--force`; the house library stays in sync; removal is complete |
| Icon resolution | a name that only appears inside a different product (`postgres`, `grafana`, `queue`) becomes a placeholder with a reason; the 359-query answer key in `tests/excalidraw-icon-queries.json` draws no different product unattended, and draws at least 80% of its drawable answers |
| Seeded builds | the same spec, style and `--seed` build byte-identical scenes and SVG in separate processes, with unique ids, no zero stroke seed and valid bindings; another seed or none gives a different scene; a seed that is not a whole number from 0 to 2³²−1 is refused (#119) |
| Rendering | the SVG covers the whole scene and is stable across runs; `render` takes its format from the `--out` extension or `--out-dir` + `--format`, refuses another extension, a directory given to `--out`, both flags, a contradicting `--format`, a malformed `--scale`, `--padding`, `--width`, `--style` or `--background`, and PNG-only flags on an SVG, exiting 2 with nothing written; with a stand-in browser a PNG render writes real PNG bytes at the requested width, reports its format, size and browser, and removes its profile, while a crash, a timeout, no screenshot, a non-PNG or an empty one exits 1 and leaves the previous preview byte-identical; no browser, or an unusable `ARKITECT_BROWSER` pin, exits 1 naming what was tried; discovery covers Edge, Chrome and Chromium on Windows, macOS and Linux, PATH first; a snap Chromium, directly or behind Ubuntu's `chromium-browser` wrapper, works in `~/snap/chromium/common` and leaves nothing there; where a browser is installed, a real one renders a real 600px PNG (#39) |
| Shipped knowledge | the record claims no evidence it lacks; the style guide says out loud which rules are defaults |
| Docker | the compose file pins the official image and publishes container port 80 |
| Templates | both committed examples are valid and match what their specs build, compared element by element through a projection that keeps type, geometry, points, stroke, fill, font, text, bindings by position and embedded file hashes and drops ids, seeds, nonces, timestamps and index keys; the failure names the first differing element and field; the projection is proven blind to reissued ids and to see a caption moved 4px and a changed embedded file (#50) |
| Style store | learning writes your record and its source list to `ARKITECT_HOME`, `--out` writes anywhere else and is never read as a scene, `--print` falls back to the shipped record until you have your own, and the shipped record is untouched (#89) |
| Personal style | with no override a build draws the committed example and every token and kind is the shipped one; both committed examples build exactly through the API and through `--defaults` with a personal override planted, which a plain CLI build picks up; an override restyles tokens and kinds and adds a kind while a spec's own style, layout, node fill and edge colour still win; every field is checked in Excalidraw's own vocabulary — a stroke width, font family or size, fill, stroke style or routing the app does not offer, a builder constant such as the grid cell, raw element JSON, an arrowhead, a partial new kind, a wrong engine, a size that stacks nodes — and a bad override is ignored whole, the build warning once and drawing the house style; `--print-style` shows the resolved style and writes nothing; findings derive only the conventions that are one token each, graded like conventions, skip a value a build refuses or a convention resting on a default, refuse a Draw.io findings file, and let an agent finding hold its target; apply lists only contradictions, strongest first, refuses a non-candidate, reports each change, drops values back at the house style, never replaces a broken override, and `--reset` restores the house style; the builder reads the resolved style and every shipped kind draws exactly as before (#90) |

## The icon-store tests write to the real store

Under a `zz-test-` prefix, cleaned up before and after. A mock filesystem would
stop testing the thing that actually breaks — the index and the library file
drifting out of sync. Your own icons are untouched.

## The redaction check

It tokenizes every repository file and compares against salted SHA-256 digests
of strings drawn from your reference diagrams.

- **With your sources present** it derives the digests fresh from the live files
  and rewrites `tests/sensitive-tokens.<engine>.sha256`.
- **Without them** it falls back to that file if it is still on disk, and skips
  entirely otherwise — which is what happens on a fresh clone.

The digest file is **gitignored, deliberately**: the salt is an in-repo constant,
so committing digests would let anyone holding a list of candidate company names
confirm which appear in your corpus — the very thing the check exists to
prevent.

What counts as sensitive is deliberately narrow, in two stages:

1. Identifier-shaped tokens — containing a digit, an underscore, or two or more
   hyphens — plus all-caps runs, minus a list of common technical vocabulary and
   public product naming.
2. Minus every token the repository already uses in its own prose. A corpus is
   full of ordinary words (`API`, `LOAD`, `aws`) that are also all over these
   docs; guarding those would produce nothing but noise. Once a token is
   recorded it stays recorded, so a later leak of it still trips the check.

Confirm it still has teeth by planting a string and watching it fail:

```bash
echo "<!-- probe: Some_Customer_Name -->" >> README.md
node tests/run-tests.mjs      # expect the redaction test to fail
git checkout README.md
```

## Plugin validation

```bash
claude plugin validate --strict .
claude plugin details arkitect
```

Expect `✔ Validation passed` and `Skills (6)`.

## Checking the container by hand

The suite does not start Docker — it asserts the compose file pins the official
image and publishes container port 80, and stops there. To check the real thing:

```powershell
$S = "skills/arkitect-excalidraw/scripts"
& $S/excalidraw-docker.ps1 -Up
& $S/excalidraw-docker.ps1 -Status
& $S/excalidraw-docker.ps1 -Open -Path skills/arkitect-excalidraw/assets/templates/starter-architecture.excalidraw
```

Drop the starter scene on the canvas. Everything should arrive: bound labels,
bound arrows, the dashed boundaries, the legend.

## Evals

`evals/` holds eight cases — four for each engine: that a
plain request fires the skill and yields valid, styled output; that a missing
icon is reported rather than substituted (and, for Excalidraw, that an icon can
be built from a real logo); and that the learning and apply skills never fire on
their own.

**They are not run by default — they cost money.** They spawn real agent runs and
LLM graders. See [../evals/README.md](../evals/README.md).

## Continuous integration

`.github/workflows/ci.yml` runs the suite on Ubuntu, Windows and macOS against
Node 20, 22 and 24, on every push and pull request. It is the same command you
run locally, with no sources present — so CI always sees the fresh-clone result.
Each of those jobs uses the npm bundled with its Node, so one more job upgrades
Node 22 to the newest npm and runs the suite again; the packaging tests call the
npm beside Node, and a change in npm's output (npm 12's `npm pack --json`, #54)
turns CI red instead of only a fresh install.

`.github/workflows/drawio-desktop.yml` is the one place a real Draw.io runs. When
a change touches `skills/arkitect-drawio/`, `tests/drawio.mjs` or the workflow
itself, it installs Draw.io Desktop on Ubuntu — a pinned `.deb`, checked against
its published sha256 and cached — and runs the Draw.io suite with
`ARKITECT_DRAWIO_SMOKE=required`. `required` turns a missing or unlaunchable
Desktop into a failure rather than a skip, so a broken install cannot pass.

To run the same export tests locally, with Draw.io Desktop installed:

```bash
ARKITECT_DRAWIO_SMOKE=1 node tests/drawio.mjs     # about a minute
```
