# Maintaining Arkitect

This page is the contract for anyone — a person or an automated maintainer —
who changes this repository. It exists so that "improve it" never turns into
"break it".

Read it before opening a pull request. If a change conflicts with anything here,
the change is wrong until this page is deliberately changed first, in its own
pull request, with a reason.

## The verification ritual

Every change, however small, is verified the same way. Run all of it, from a
clean checkout, before opening a pull request.

```bash
node tests/run-tests.mjs
```

The bar is **0 failed**, and no test that used to pass may start skipping. The
result to expect on a clone with no reference diagrams of your own is stated
once, in [testing.md](testing.md), and the runner fails when it no longer matches
what ran; the skips are the tests that need a local corpus. A pull request that
adds a test updates that line. A drop in the passing count is a regression even
if nothing says FAIL.

```bash
node bin/arkitect.mjs doctor
node bin/arkitect.mjs drawio icon "bedrock"
node bin/arkitect.mjs excalidraw icon "postgres"
```

Then prove both engines still produce a real diagram end to end:

```bash
node bin/arkitect.mjs drawio build \
  skills/arkitect-drawio/assets/templates/starter-architecture.spec.json --out /tmp/a.drawio --defaults
node bin/arkitect.mjs drawio validate /tmp/a.drawio

node bin/arkitect.mjs excalidraw build \
  skills/arkitect-excalidraw/assets/templates/aws-data-platform.spec.json --out /tmp/b.excalidraw --defaults
node bin/arkitect.mjs excalidraw validate /tmp/b.excalidraw
node bin/arkitect.mjs excalidraw render /tmp/b.excalidraw --out /tmp/b.svg
```

And, if you touched a manifest or a skill:

```bash
claude plugin validate --strict .
```

## Invariants

These do not bend for convenience.

**1. Zero runtime dependencies.** Node 20+ and nothing else. No `npm install`,
no `package-lock.json`, no vendored `node_modules`. If a change needs a library,
it is written out longhand in `skills/*/scripts/lib/` or it does not happen.
This is what makes the toolkit auditable and installable by `git clone`.

**2. Both engines keep working.** A change to shared thinking must be applied to
both `skills/arkitect-drawio` and `skills/arkitect-excalidraw`, or explicitly
scoped to one and said so. Neither engine may lose a capability listed in its
`SKILL.md` or in a reference it sends the agent to.

**2a. The default path fits a small window.** Each drawing `SKILL.md` holds one
short ordered workflow; editing, icons beyond the first search, logos,
libraries, rendering internals and maintainer work live behind a named condition
in `references/`. `SKILL.md` plus the one pattern section it points to stays at
or under 12,000 bytes (#113), and `tests/toolkit.mjs` measures it:

| skill | `SKILL.md` | largest pattern section | total |
|---|---|---|---|
| `arkitect-drawio` | 9,395 | 862 | 10,257 |
| `arkitect-excalidraw` | 10,899 | 806 | 11,705 |

The chosen worked example comes on top: Draw.io's starter spec is 2,887 bytes;
Excalidraw's starter is 3,472 and the large AWS example 14,080. Before #113 the
mandatory reading was 34,621 bytes for Draw.io and 46,646 for Excalidraw. A
rule that has to hold on every drawing stays in `SKILL.md`; a rule that holds
for one situation moves beside that situation.

**3. Output stays native and editable.** `.drawio` XML and `.excalidraw` JSON,
with icons and images **embedded**, never linked. No change may make the
deliverable a flattened image, a Mermaid block, or a file that only opens on the
machine that made it.

**4. Icon honesty.** No change may make it easier for a generator to substitute
one product's mark for another. An unresolvable icon becomes a named
placeholder, listed in the build report. This is a feature, not a gap.

**5. Nothing derived from a real diagram enters the repository.** No renders, no
labels, no page names, no file paths, no `.analysis/`, no
`tests/sensitive-tokens.*.sha256`. The redaction test enforces it. If it fails,
the finding is real — never add an exception to make it pass.

**6. Nothing about a diagram reaches the network.** Exactly two network calls
exist: fetching a product logo from a URL the user named, and the public
Excalidraw library catalogue. A change that adds a third needs a very good
reason and its own pull request. The Draw.io MCP tools that open the hosted
editor stay forbidden on user content.

**7. Backups before overwrites.** Both builders write a timestamped sibling
backup before replacing an existing file. Do not remove that, and do not add a
write path that skips it. Retention (#49) deletes only the builder's own
exact-name backups of the file it just wrote, only after that write succeeded,
and always keeps the newest and the oldest; do not widen what it may delete.

**8. Style rules carry evidence.** A rule in `references/style-guide.md` states
its count and confidence. A rule marked `default` is one the corpus does not
settle, and must keep saying so. Never dress a preference up as an observation.

**9. A convention that moves must move in the generator.** Changing prose in
`style-guide.md` without changing the tokens and kinds that engine's generator
draws with (`STYLE` / `edgeKindsFor` in Excalidraw's `scripts/lib/style-tokens.mjs`;
`T` / `edgeKindsFor` in Draw.io's) means the rule was
noted, not learned — the next diagram still comes out the old way. After any
style change, rebuild both committed worked examples and look at the PNGs.
This governs the **shipped** house style, which changes only in a reviewed pull
request. A person's own style, applied with `/apply-drawio-style` or
`/apply-excalidraw-style`, is not a repository change at all: it lives in their
store outside the plugin and is never committed — see
[Personal style overrides](#personal-style-overrides).

**10. Line endings are load-bearing.** `.drawio`, `.excalidraw`,
`.excalidrawlib`, `.xml`, `.svg`, `.png` and `.json` are marked binary or
`-text` in `.gitattributes` because the suite compares them by digest. Never
reformat, re-indent or "clean up" those files.

## What a good change looks like

- **One concern per pull request.** A dependency bump, an icon library and a
  docs fix are three pull requests, not one.
- **Additive before destructive.** Add the new path, keep the old one working,
  deprecate in a later release.
- **Tested.** Anything fixed gets a test in `tests/drawio.mjs`,
  `tests/excalidraw.mjs` or `tests/toolkit.mjs`. Plain assertions, no framework;
  `test()` is synchronous, so settle a promise before asserting on it.
- **Described.** The pull request says what changed, why, what could break, and
  exactly what was run to verify it. If generated output changed, it shows the
  before and after render.
- **Examples stay fresh.** A change that alters what a generator builds rebuilds
  the committed worked examples in `skills/*/assets/templates/` and re-renders
  their PNGs in the same pull request, and says so. Agents copy those examples,
  so a stale one teaches the old output. The suite fails when a committed
  example no longer matches its spec (#50). Rebuild examples with
  `--defaults`, in either engine, so a personal style override on your machine
  never reaches them (#89, #90).
- **Reversible.** Say how to undo it in one line.

## Areas, and how much care each needs

| area | care |
|---|---|
| `docs/`, `README.md` | low — fix freely, keep links resolving |
| `bin/`, agent adapters in `bin/lib/install-agent.mjs` | low — covered by `tests/toolkit.mjs` |
| `tests/` | medium — add tests freely; never weaken one to make a change pass |
| `scripts/`, `CHANGELOG.md` | low — maintainer tooling and release notes; `scripts/` does not ship in the npm package |
| `skills/*/references/*.md` | medium — evidence rules apply (invariants 8 and 9) |
| `skills/*/scripts/` | high — the generators. Full ritual, plus a render you looked at |
| `skills/*/scripts/lib/` | high — the scene model, the tracer, the stroke generator. Small, surgical changes only |
| `skills/*/assets/libraries/` | high — third-party bytes under their own licences. See below |
| `.claude-plugin/`, `package.json` | high — version and name must stay in step (see below); `files` is the npm content policy, and the packaging test in `tests/toolkit.mjs` fails if a local cache ships or a bundled asset does not |
| `LICENSE`, `NOTICE`, `.gitattributes`, `.gitignore` | do not change without a stated reason |

## Personal style overrides

What one install learns is kept apart from what the repository ships (#89, #90):

| | shipped house style | one install's own style |
|---|---|---|
| lives in | `skills/*/references/`, the generators, each engine's `scripts/lib/style-tokens.mjs` | `~/.arkitect/<engine>/`, or `$ARKITECT_HOME/<engine>/` |
| changed by | a reviewed pull request (invariants 8 and 9) | `/learn-*-style` records it; `/apply-*-style` applies it |
| reaches | everyone who installs Arkitect | that install only; never committed |

- The store holds the person's record, source list, findings, prose notes and
  `style-overrides.json`. Only the learning, findings and apply tools write
  there, and only the CLI builds and the drawing skills read it.
- An override names tokens and edge kinds, never a raw style string or element
  JSON; each engine's `scripts/lib/style-tokens.mjs` holds its rules. It can
  never change which icon, library item or logo stands for a product
  (invariant 4), arrowheads, Draw.io's AWS shape internals and orthogonal
  routing, or Excalidraw's arrow binding and placeholder. A literal that becomes
  a token gets the old literal as its default, so output without an override is
  unchanged — byte for byte in Draw.io, through the #50 projection in Excalidraw.
- How an override is validated, resolved and loaded, and the findings and apply
  tools, are one implementation for both engines:
  `skills/arkitect-drawio/scripts/lib/style-layer.mjs` and `style-workflow.mjs`.
  An engine supplies only its tokens, kinds and rules, and how its record
  becomes findings. Change shared behaviour there, never in one engine alone.
- `buildDiagram()` never reads the store; only the CLI does, and `--defaults`
  skips it. **Committed examples always build with defaults**: every documented
  command that rebuilds one passes `--defaults`, the freshness checks build
  through the API, and both are tested with a personal override present.
- The suite points `ARKITECT_HOME` into `tests/output/`, so it never reads or
  writes the store of the person running it.

## Adding an icon library

### Draw.io packs

1. Confirm the licence or permission covers redistribution, and pin the source
   in `skills/arkitect-drawio/assets/libraries/sources.json`.
2. `node skills/arkitect-drawio/scripts/build-packs.mjs --all` — rebuilds every
   pack and `references/icon-catalog.json` from the pins.
3. `node skills/arkitect-drawio/scripts/write-pack-docs.mjs` — regenerates
   `references/pack-index.md` and `assets/libraries/ATTRIBUTION.md` from the
   catalog. **Always rerun this after `build-packs.mjs`** — both files say "do
   not edit by hand" for a reason, and a catalog change that skips this step is
   exactly how the pack counts and the "no bytes" figure quoted throughout the
   docs drifted (75, then 66, then 69 — the real, current number stayed 158 the
   whole time).
4. Search for a product in the new pack to prove it resolves.

### Excalidraw libraries

1. Confirm the licence permits redistribution, and who the author is.
2. Drop the `.excalidrawlib` into
   `skills/arkitect-excalidraw/assets/libraries/bundled/`.
3. `node bin/arkitect.mjs excalidraw libraries --build` — rebuilds `index.json`
   and `ATTRIBUTION.md`. A test fails if the index and the files disagree.
4. If the library has unnamed items, generate its contact sheet and commit the
   PNG; unnamed items are otherwise unfindable.
5. Search for a product in the new library to prove it resolves.

### Either engine

Never edit a bundled library's or a generated doc's bytes by hand — rerun the
generator instead. After either engine's icon count moves, check whether it is
quoted in `README.md`, `docs/icons.md`, `docs/drawio-icons.md` and each
engine's `references/icons.md`, and update it there. The exact-total figures in
`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`,
`package.json`'s description and `bin/lib/install-agent.mjs`'s adapter body
are deliberately a rounded `6,000+` instead — `tests/toolkit.mjs` checks that
phrase stays identical across all four, so update every one of them together
or none.

## Watching the upstreams

The Draw.io packs build from pins in `skills/arkitect-drawio/assets/libraries/sources.json`.
A pin stays honest only while someone checks it, so
`.github/workflows/upstream-watch.yml` does the checking:

| check | when | opens | why it matters |
|---|---|---|---|
| `build-packs.mjs --check-upstream` | weekly | `A mark we ship has been removed from Simple Icons` (`licensing`) | Simple Icons removes a brand when its owner asks; shipping it anyway redistributes a mark we were asked not to |
| `build-packs.mjs --check-drift` | quarterly | `Pinned icon sources have moved on upstream` (`upstream`) | vendors rev their sets without notice, and the packs fall behind; a project logo committed as a local file can be redrawn, relicensed or left in an archived repository; a product `status` confirmed a year ago may have moved again |

For a `local-files` source, the drift check looks at three things, each
against the pin. The **artwork**: the file at the pinned path on the default
branch, compared with the pinned commit (a URL that pins no commit, like the ASF
originals, is compared with the committed bytes). The **licence**: the licence
file on the default branch, compared with the one linked at the pinned commit;
a policy page that is not a file is only checked for still existing. The
**repository**: archived, dormant (no push in 365 days) or answering under
another name. It needs `GITHUB_TOKEN` set locally to stay inside the API's rate
limit.

A repository finding is a prompt to look, not proof of a wrong mark. Record what
you found in the source's `upstreamRepo` - `archived`, `dormant`, the
`checked` date, and a `note` saying why the mark still ships if it is either -
and the next run stays quiet until the state changes again. A new
`local-files` source records `upstreamRepo` when it is pinned; a test fails
without it. Prefer pinning into the repository the product is named after over
a website or UI subtree: both wrong-product marks #79 caught came from one.

A rename upstream is reported but opens nothing. A slug that moved is not a
licensing problem. If an issue is already open, the workflow comments on it
instead of opening a second one. A network failure turns the run red and opens nothing.

Both checks run locally too, and exit `0` clean, `1` with findings, `2` on error:

```bash
node skills/arkitect-drawio/scripts/build-packs.mjs --check-upstream
node skills/arkitect-drawio/scripts/build-packs.mjs --check-drift
```

The workflow only ever opens or comments on an issue. A removal is fixed by moving the mark
to its pack's `onDemand` list, the way the seven 15.x removals were. A drift is
fixed by re-pinning, rebuilding and looking at the contact sheets. Both are pull
requests a person reviews.

## Adding an agent adapter

1. Confirm which file that tool actually reads — do not guess a path.
2. Add an entry to `ADAPTERS` in `bin/lib/install-agent.mjs`, reusing the shared
   `body` renderer unless the host needs its own frontmatter.
3. Add the tool to the table in `docs/agents.md` and the one in `README.md`,
   with its MCP configuration if it supports MCP.
4. `node tests/run-tests.mjs toolkit` covers rendering, aliases, idempotency and
   the refusal to clobber.

## Changelog entries

A change records its release note in the same pull request: one bullet added
directly to `[Unreleased]` in `CHANGELOG.md`, under `### Added`, `### Changed`,
`### Removed` or `### Fixed`, as a single line naming what changed and, where
one exists, the issue or PR it came from. No separate file, no naming scheme,
no CI gate enforcing it — this used to be a `changelog.d/` fragment per
change, assembled by a script, specifically to stop parallel pull requests
conflicting on the same lines (#32); that problem was real, but the apparatus
it took to solve it (a folder, a naming convention, an issue-linking regex, an
assembly tool, a CI gate and a label) was more than this project's size
warrants. If parallel `[Unreleased]` edits start conflicting often enough to
matter again, revisit this — but as its own deliberate change, not a default.

The suite still fails on a conflict marker left in any tracked text file
(`tests/toolkit.mjs`).

## Issue and project status

After a merge, update the issue with the implementing PR and verify its acceptance
criteria before checking them off. If only part of the work landed, link the
remaining issue explicitly. Preserve the original report as history; put current
status above it. A decision to defer or replace a proposal is different from an
implementation. Keep the dated [project status](status.md) snapshot aligned with
main when priorities or completed scope change. GitHub issue and PR state remain
the live record.

## Version bumps

`package.json` `version` and `.claude-plugin/plugin.json` `version` move
together, always. [SemVer](https://semver.org): a new capability is a minor, a
fix is a patch, and anything that changes the shape of generated output or
removes a command is a major.

A release is two workflows and one merge (#88):

1. **Actions → release prepare → Run workflow**, choosing the bump. It runs the
   suite, then `scripts/release.mjs prepare`: both manifests move to the new
   version, `[Unreleased]` becomes `## [X.Y.Z] — <today, UTC>`, and a fresh empty
   `[Unreleased]` opens above it. The change goes to a `release/vX.Y.Z` branch and a
   pull request that runs CI like any other. A failing suite stops the run before
   anything is written.
2. **Review and merge that pull request.** Merging is the approval.
   `release publish` then checks that the branch name and both manifests agree, tags
   the merge commit `vX.Y.Z`, and publishes a GitHub Release whose body is that
   version's `CHANGELOG.md` section, verbatim. Closing it unmerged does nothing.

If `[Unreleased]` is empty when the release is prepared, one OpenAI-compatible chat
completion drafts it from the commit log since the last tag (or, before the first
tag, since the newest dated section). The draft must use the four headings and
bullets or it is refused. The pull request then opens as a **draft**, flagged as
model-written: correct `CHANGELOG.md` on the branch, then mark it ready. A missing
key or a failed call fails the run; nothing ships with an invented or empty section.

Nothing is published to npm. Setup, once, in the repository settings:

| name | kind | what |
|---|---|---|
| `RELEASE_TOKEN` | secret | fine-grained token for this repository with Contents and Pull requests write; a pull request opened with the default Actions token runs no CI, and this repository does not let Actions open one |
| `RELEASE_LLM_BASE_URL` | variable | e.g. `https://api.deepseek.com/v1` or `https://openrouter.ai/api/v1` |
| `RELEASE_LLM_MODEL` | variable | the model name that endpoint expects |
| `RELEASE_LLM_API_KEY` | secret | only needed when `[Unreleased]` can be empty |

The same steps run locally: `node scripts/release.mjs empty | draft | prepare <bump> | notes <X.Y.Z> | check <X.Y.Z>`.

## What is never automated

An automated maintainer may open pull requests and issues, and nothing else. It
must not:

- merge, approve or close a pull request, or push to `main`
- force-push, rewrite history, or delete a branch it did not create
- change the licence, the repository visibility, its settings or its topics
- publish a release or a package (the release workflows publish only when a
  person merges a `release/v*` pull request)
- add a runtime dependency, or commit a binary over 2 MB, without being asked
- weaken or delete a test to make a change pass
- commit anything derived from a real diagram

When it is unsure, it opens an issue describing the options instead of a pull
request choosing one.
