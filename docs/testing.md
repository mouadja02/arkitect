# Testing

```bash
node tests/run-tests.mjs                # all three suites
node tests/run-tests.mjs drawio         # one of them
node tests/run-tests.mjs excalidraw
node tests/run-tests.mjs toolkit
```

Offline, deterministic, no network, no Docker, no dependencies. Roughly two
seconds.

On a fresh clone expect about `176 passed, 0 failed, 7 skipped`. The skips are
the tests that need reference diagrams of your own — a clone has none. That is
the correct result, not a problem. Point them at your files with
`.analysis/sources.local.json`
([getting-started.md](getting-started.md#the-local-source-list)) and they run.

Each suite writes its scratch to `tests/output/<engine>/` and is a separate
process, so they cannot tread on each other.

## What is covered

### Both engines

| area | checks |
|---|---|
| Generation | valid native output; unique ids; every edge connected at both ends; no overlaps; learned style tokens applied; a legend only when earned |
| Spec checks | a spec naming a missing node, parent or boundary, a cycle, or a missing, repeated or reserved id is refused before any backup or write, every problem listed; the CLI exits 1 and leaves the target untouched; nested boundaries still build; Draw.io automatic edge ids skip taken ids and an unknown edge kind draws as a flow (#36) |
| Update safety | a timestamped backup is written before an existing file is replaced; repeated updates in the same second, with a backup name already taken, each keep their own version (#35) |
| Honesty | an unresolvable icon degrades to a named placeholder or labelled box and is reported, never substituted |
| Analysis | structure and style emitted; labels, element text and image payloads never |
| Plugin shape | the manifest is valid, all four skills are well formed, the learning skills are user-invoked only, no hard-coded install paths |
| Packaging | the real `npm pack` tarball, with a sentinel planted in every local-only location, ships every bundled asset and none of the caches, cached logos, built icons, downloaded libraries, contact-sheet HTML, browser profiles or backups, and unpacks under 60 MB; extracted outside the checkout its CLI runs `version`, `doctor`, both icon searches and a build and validate per engine, and `test` exits 2. Uses the npm beside Node, offline; skips only if there is none (#38) |
| Redaction | no sensitive string from a reference diagram appears anywhere in the repository |

### Draw.io

| area | checks |
|---|---|
| Library parsing | entry counts and file digests for every pack, SVG and PNG dimension decoding |
| Library loading | every committed `.drawio` library loads the way Draw.io's `EditorUi.loadLibrary` reads one — a strict XML parse with an `<mxlibrary>` root, then `JSON.parse` of its text — using a loader that shares no code with `readLibrary`; every SVG payload declares each namespace prefix it uses; a mis-escaped library is proven to fail it |
| Desktop export (opt-in) | one icon from every pack, and the five GCP marks with masks and filters, exported by Draw.io Desktop; every page must carry ink. Runs with `ARKITECT_DRAWIO_SMOKE=1` |
| File-type bands | band text on a file sheet never renders under 8px: a ten- or eight-letter band and an empty `band` are refused, a short `band` replaces the extension at 9px; every committed file-types entry meets the floor, `.dockerfile` and `.excalidraw` show `DOCKER` and `EXCALI`, and both are still found by their full extension (#14) |
| Contact sheets | with a fake Chrome that fills its profile with cookies and history: the profile and the page it renders live outside the repository and are removed, and only `<pack>.png` is added; a crash, a timeout, no screenshot, an empty one or a non-PNG is reported and leaves the previous sheet untouched; the HTML stays only without `--png`, with `--keep-html`, or when there is no Chrome; a legacy `.shot/` profile is reported, never deleted (#44) |
| Duplicate titles | both Compute Optimizer variants retained, disambiguated by index, size and payload hash |
| AWS pack | built from Amazon's pinned package; every one of the 243 palette ids still present; AgentCore as one official SVG plus five 156px feature rasters matching their pinned digest; the PNG codec round-trips, area-averages and never enlarges; icon cells fit their image instead of stretching square |
| Catalog | no base64 payloads, required fields present |
| Icon lookup | exact and fuzzy matches; an ambiguous query returns every variant; an unknown service returns no match; a fragment of a different product's name (`tempo`, `cube`) is flagged, not resolved; the 66 products promoted from the catch-all resolve from their curated packs with no copy left in `brands` |
| Resolution accuracy | the 362-query answer key in `tests/icon-queries.json`: zero confident wrong answers, precision at rank 1 above its floor, and the numbers printed on every run |
| Cell styles | the comma-only data URI form; the embedded payload matches the catalog hash |
| Logos | transparency read from the IHDR; an opaque PNG flagged; sizing fits the longest side and preserves aspect; non-images refused |
| Validator | rejects duplicate ids, missing parents, broken edge endpoints; `--page 0` through the dispatcher validates that page, before or after the files, and `--strict` still fails on a warning; a page the file lacks fails, in the CLI and the API, without claiming a page was checked; a missing, negative, fractional, exponent, empty or non-numeric page value, a repeated `--page` and an unknown flag exit 2 with no stack trace; the API throws on a malformed index (#37) |
| Command lines | `build --out <file> <spec>` builds the spec and never writes to it; a malformed, missing or second spec, a missing `--out` or value, or an unknown flag exits 2 in one line with nothing written; `analyze --page` is checked the same way, a page the file lacks exits 1, and `--page` without `--cells`/`--images` or `--cells` over two files is refused (#37) |
| The record | carries no diagram content, no page names, no modification times |

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
| Rendering | the SVG covers the whole scene and is stable across runs |
| Shipped knowledge | the record claims no evidence it lacks; the style guide says out loud which rules are defaults |
| Docker | the compose file pins the official image and publishes container port 80 |
| Templates | both committed examples are valid and still match their specs |

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

Expect `✔ Validation passed` and `Skills (4)`.

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

`evals/` holds six cases — three per engine: that a plain request fires the
skill and yields valid, styled output; that a missing icon is reported rather
than substituted (and, for Excalidraw, that an icon can be built from a real
logo); and that the learning skills never fire on their own.

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
