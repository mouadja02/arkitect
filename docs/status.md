# Project status

Status reviewed on 2026-09-21, at the 2.0.0 release.
This is a dated snapshot. [Open issues](https://github.com/mouadja02/arkitect/issues?q=is%3Aissue+is%3Aopen)
and [open PRs](https://github.com/mouadja02/arkitect/pulls?q=is%3Apr+is%3Aopen) show live status.

## Completed on main

| Area | Delivered | Evidence |
|---|---|---|
| CLI reliability | Validate installer requests before writes, safe help, useful command errors, strict test selection | [PR #97](https://github.com/mouadja02/arkitect/pull/97) |
| Backups | Collision-safe naming and retention, now shared by both engines | [#35](https://github.com/mouadja02/arkitect/issues/35), [#49](https://github.com/mouadja02/arkitect/issues/49), [PR #97](https://github.com/mouadja02/arkitect/pull/97) |
| Personal style | Persistent per-user storage, findings/apply workflows, overrides, defaults and style inspection for both engines | [#89](https://github.com/mouadja02/arkitect/issues/89), [#90](https://github.com/mouadja02/arkitect/issues/90) |
| Packaging and previews | Package-content checks, portable Excalidraw PNG output, Draw.io Desktop export checks | [#38](https://github.com/mouadja02/arkitect/issues/38), [#39](https://github.com/mouadja02/arkitect/issues/39), [#33](https://github.com/mouadja02/arkitect/issues/33) |
| Diagram checks | Invalid-reference rejection, unknown-kind reports, caption routing and example freshness | [#36](https://github.com/mouadja02/arkitect/issues/36), [#48](https://github.com/mouadja02/arkitect/issues/48), [#45](https://github.com/mouadja02/arkitect/issues/45), [#50](https://github.com/mouadja02/arkitect/issues/50) |
| Icon maintenance | Shared packs in Excalidraw, source pins, scheduled upstream checks, Azure review records | [#17](https://github.com/mouadja02/arkitect/issues/17), [#9](https://github.com/mouadja02/arkitect/issues/9), [#10](https://github.com/mouadja02/arkitect/issues/10), [#18](https://github.com/mouadja02/arkitect/issues/18) |
| Icon correctness | An exact catalog id selects its own artwork; a fetched SVG is sized from its root element, identically in both engines | [#95](https://github.com/mouadja02/arkitect/issues/95), [#96](https://github.com/mouadja02/arkitect/issues/96), [PR #98](https://github.com/mouadja02/arkitect/pull/98) |
| Icon validation | A mark that paints only in white is refused when a pack is built and reported by `--verify` | [#85](https://github.com/mouadja02/arkitect/issues/85), [PR #99](https://github.com/mouadja02/arkitect/pull/99) |
| On-demand artwork | An on-demand entry says whether a pinned artwork file exists; only those carry a fetch command, the rest draw as a named placeholder | [#84](https://github.com/mouadja02/arkitect/issues/84), [PR #100](https://github.com/mouadja02/arkitect/pull/100) |
| Identical artwork | Ids that draw the same picture name each other in the catalog and search, and a build reports two such ids used together | [#77](https://github.com/mouadja02/arkitect/issues/77) |
| Documentation counts | Every exact icon count a doc quotes is checked against the catalog, the Excalidraw library index and the two answer keys, and the failure names the value to write | [#78](https://github.com/mouadja02/arkitect/issues/78), [PR #102](https://github.com/mouadja02/arkitect/pull/102) |
| Wordmark legibility | A wide lockup's short side is floored at a third of the icon footprint and its long side held to twice it, so a 6:1 wordmark is drawn 156x26 rather than 78x13, with no artwork byte changed | [#76](https://github.com/mouadja02/arkitect/issues/76), [PR #103](https://github.com/mouadja02/arkitect/pull/103) |
| Title ties | Every set of packs sharing one exact icon title carries a judgement row, a stack named in the spec settles the tie, and a test fails when a new tie appears that no row covers | [#75](https://github.com/mouadja02/arkitect/issues/75), [PR #104](https://github.com/mouadja02/arkitect/pull/104) |
| Logo upstream watch | The quarterly drift check compares every committed project logo's artwork, licence file and repository state with its pin, and each GitHub-backed source records the repository state it was reviewed at | [#74](https://github.com/mouadja02/arkitect/issues/74), [#82](https://github.com/mouadja02/arkitect/issues/82), [PR #105](https://github.com/mouadja02/arkitect/pull/105) |
| Vendor reviews | Every AWS and Google Cloud mark is reviewed on record at the payload that ships, the review test covers every pack with a record, and twenty-two captions whose file names dropped punctuation are corrected | [#73](https://github.com/mouadja02/arkitect/issues/73), [PR #106](https://github.com/mouadja02/arkitect/pull/106) |
| Curated reviews | Every mark in the 14 curated packs is reviewed on record, every pack but `brands` must carry a record, and the two marks promoted by slug that drew the wrong product (Vespa, Nebula) are on-demand entries for Vespa.ai and NebulaGraph | [#81](https://github.com/mouadja02/arkitect/issues/81), [PR #107](https://github.com/mouadja02/arkitect/pull/107) |
| Product lifecycle | Twelve discontinued, renamed, absorbed, acquired or archived products carry a verified `status` that search and build reports surface as a caveat with a successor, and the drift check lists statuses due for a re-check | [#83](https://github.com/mouadja02/arkitect/issues/83), [PR #108](https://github.com/mouadja02/arkitect/pull/108) |
| Brands review | All 3,092 catch-all marks are reviewed on record against their captions and Simple Icons source domains, and every pack now requires a review record | [#72](https://github.com/mouadja02/arkitect/issues/72), [PR #109](https://github.com/mouadja02/arkitect/pull/109) |
| Release tooling | `release prepare` bumps both manifests and dates the changelog on a reviewed `release/vX.Y.Z` pull request, drafting an empty section with a model only as a flagged draft; merging it tags and publishes a GitHub Release; no npm publish. Used for v1.2.0, v1.2.1 and v1.3.0 | [#88](https://github.com/mouadja02/arkitect/issues/88), [PR #110](https://github.com/mouadja02/arkitect/pull/110), [v1.3.0](https://github.com/mouadja02/arkitect/releases/tag/v1.3.0) |
| Agent behaviour, from evals | The one editing route with no backup got a command (`arkitect <engine> backup`); a reply no longer points at the hosted draw.io editor; an assumption no longer covers for changing a count the user stated | [#179](https://github.com/mouadja02/arkitect/issues/179), [#186](https://github.com/mouadja02/arkitect/issues/186), [#183](https://github.com/mouadja02/arkitect/issues/183), [PR #194](https://github.com/mouadja02/arkitect/pull/194), [PR #195](https://github.com/mouadja02/arkitect/pull/195), [PR #196](https://github.com/mouadja02/arkitect/pull/196), [PR #197](https://github.com/mouadja02/arkitect/pull/197) |
| Engine choice, from evals | A report with no slot for the engine choice never carried one, four runs out of four; the report shape now has one and says what counts as a reason. A README request drew Draw.io twice out of two, because a skill is selected on its description before the routing rule is read; each description now carries its own signals, parsed out of `AGENTS.md` §1 by a test | [#180](https://github.com/mouadja02/arkitect/issues/180), [#201](https://github.com/mouadja02/arkitect/issues/201), [PR #199](https://github.com/mouadja02/arkitect/pull/199), [PR #200](https://github.com/mouadja02/arkitect/pull/200), [PR #202](https://github.com/mouadja02/arkitect/pull/202) |
| Renders, from evals | No render survives the eval sandbox — Chrome is refused a socket whatever the flags, and Draw.io's `xvfb-run` exits 1 — but `--format svg` needs no browser, so the Excalidraw generation case now grades the SVG it asked for, and the wording that let a report describe a picture nobody saw is gone from the renderer and both skills | [#136](https://github.com/mouadja02/arkitect/issues/136), [PR #207](https://github.com/mouadja02/arkitect/pull/207), [#208](https://github.com/mouadja02/arkitect/issues/208) |
| CI images | Every action declares Node 24, and no job rides `ubuntu-latest`: the matrix names Ubuntu 24.04 and 26.04, so the October image switch is a decision rather than a date | [#122](https://github.com/mouadja02/arkitect/issues/122), [PR #210](https://github.com/mouadja02/arkitect/pull/210) |
| Builder reports | A spec field neither builder knows is named under `unknownFields`, and `style` is answered rather than dropped; the numbered-flow pattern builds from edge labels instead of needing hand-written XML | [#205](https://github.com/mouadja02/arkitect/issues/205), [#193](https://github.com/mouadja02/arkitect/issues/193), [PR #211](https://github.com/mouadja02/arkitect/pull/211), [PR #212](https://github.com/mouadja02/arkitect/pull/212) |
| Release resume | Either release workflow can be re-run after a partial failure, and resumes only a remote state that matches; 1.6.3 is the first release cut with it | [#120](https://github.com/mouadja02/arkitect/issues/120), [PR #213](https://github.com/mouadja02/arkitect/pull/213) |
| Report graders | Two render graders that failed correct runs are fixed: a `file_exists` that could not see a file that was there, and a pattern that never matched "PostgreSQL". The report step writes its headings out first | [#208](https://github.com/mouadja02/arkitect/issues/208), [PR #214](https://github.com/mouadja02/arkitect/pull/214) |
| Fake boundaries | A plain box laid over nodes it does not own, or a node sized in grid cells rather than pixels, is named under `looksLikeBoundary` in both builders' reports, with a hint pointing at `boundaries` | [#204](https://github.com/mouadja02/arkitect/issues/204), [PR #217](https://github.com/mouadja02/arkitect/pull/217) |
| Draw.io pages | A spec builds several pages with `pages`, ids per page, an edge across pages refused; an as-is/to-be template with a PNG per page. Proved by an eval case whose control on main showed agents stitching single-page builds with their own scripts | [#184](https://github.com/mouadja02/arkitect/issues/184), [PR #218](https://github.com/mouadja02/arkitect/pull/218) |
| Codex | `install codex` also writes a Codex skill with absolute paths that works from any project; the deprecated custom prompt is gone | [#127](https://github.com/mouadja02/arkitect/issues/127), [PR #219](https://github.com/mouadja02/arkitect/pull/219) |
| Excalidraw geometry | Boundaries are sized from everything their nodes draw, captions and sublabels in both axes; text is measured as wide as the app draws it, from the app's own fonts, where it ran 18% narrow and the app clipped it; an edge from a node to itself is a loop over a corner, not a bare arrowhead; each frame comes after its own members. Found and checked in the local Excalidraw app | [#191](https://github.com/mouadja02/arkitect/issues/191), [#222](https://github.com/mouadja02/arkitect/issues/222), [#159](https://github.com/mouadja02/arkitect/issues/159), [#192](https://github.com/mouadja02/arkitect/issues/192), [PR #223](https://github.com/mouadja02/arkitect/pull/223), [PR #224](https://github.com/mouadja02/arkitect/pull/224), [PR #225](https://github.com/mouadja02/arkitect/pull/225), [PR #226](https://github.com/mouadja02/arkitect/pull/226) |
| Icon nodes | A node with an `icon` and no `kind` draws its icon in both builders, where it drew a plain box and nobody was told; found by the 2.0.0 eval batch, where an agent reported three icons over a file with none | [#228](https://github.com/mouadja02/arkitect/issues/228), [PR #229](https://github.com/mouadja02/arkitect/pull/229) |
| Generic words | A component named only in generic words (`service`, `storage`, `function`) no longer draws an AWS, Azure or GCP mark in either search; it comes back flagged, and the builder draws a placeholder. Found by the same batch: an internal service drawn with AWS's Service glyph, twice | [#231](https://github.com/mouadja02/arkitect/issues/231), [PR #232](https://github.com/mouadja02/arkitect/pull/232) |
| Recent corrections | Library-cell sizing, broken documentation links, accurate preview prerequisites | [#80](https://github.com/mouadja02/arkitect/issues/80), [#87](https://github.com/mouadja02/arkitect/issues/87), [PR #97](https://github.com/mouadja02/arkitect/pull/97) |

PR #97 and PR #98 passed the full cross-platform CI matrix and the Draw.io
Desktop export check. See [testing.md](testing.md) for the maintained test
baseline and local verification commands. Passing those checks does not close
the work listed below.

## In progress

No implementation PR is open at this snapshot. Next are two patches, a
misspelled top-level spec key reported instead of ignored
([#221](https://github.com/mouadja02/arkitect/issues/221)) and icon captions grouped with
their artwork ([#190](https://github.com/mouadja02/arkitect/issues/190)), then opt-in
obstacle-avoiding routing for Excalidraw connectors
([#124](https://github.com/mouadja02/arkitect/issues/124)), which can now route around
real caption bounds and corner loops.

2.0.0 changed generated output, Excalidraw's four ways and both engines' two -
an `icon` with no `kind`, and a generic word that drew a vendor's mark - so
specs have to be rebuilt to pick it up; saved files are untouched.

The eval suite is the other open thread. Its blind spot is closed: an eval run
now reads a render. No PNG can be made inside `claude plugin eval`'s sandbox —
Chrome exits SIGABRT on `socket() failed: Operation not permitted`, whatever
the flags, and Draw.io's `xvfb-run` exits 1 without saying why — but
`--format svg` needs no browser, so the Excalidraw generation case asks for one
beside the scene and grades the file itself
([#136](https://github.com/mouadja02/arkitect/issues/136)). Making the render
succeed showed what nothing had been watching: three reports in three described
a picture they had never seen, quoting the renderer's own "geometry-faithful
preview" as the warrant. That phrase, and the two skill sentences that told
their reader to judge layout from "the preview", are gone. Two graders that
failed correct runs are fixed in 1.6.3
([#208](https://github.com/mouadja02/arkitect/issues/208)); a report that
abandons its seven headings, and a render claim still red one run in three,
are [#215](https://github.com/mouadja02/arkitect/issues/215).

The landing-zone case fails about a third of its runs
([#203](https://github.com/mouadja02/arkitect/issues/203)),
and reading a kept run showed why: an agent can draw five account boundaries as
plain boxes that contain nothing, and neither builder says a word
([#204](https://github.com/mouadja02/arkitect/issues/204), fixed in 1.7.0), nor did
either mention a spec field it ignored ([#205](https://github.com/mouadja02/arkitect/issues/205),
fixed in 1.6.3). Both are arithmetic the builder can do, so neither costs a
paragraph of skill prose.

## Remaining work

Every issue this page listed is closed on main: the upstream checks (#74, #82, #83),
the visual reviews of every pack (#72, #73, #81) and the release workflows (#88).
New work starts from the [open issues](https://github.com/mouadja02/arkitect/issues?q=is%3Aissue+is%3Aopen).

The two issues that made a diagram draw the wrong thing are fixed: an exact
Draw.io catalog ID is now looked up as an ID rather than passed through text
search ([#95](https://github.com/mouadja02/arkitect/issues/95)), and an SVG's size is read from its root element in both
engines ([#96](https://github.com/mouadja02/arkitect/issues/96)). Diagrams built before PR #98 may still carry a wrong mark
or a stretched logo; rebuild them rather than trusting the old output. What
remains is legibility rather than identity. A mark invisible on a light canvas is now
refused at build time ([#85](https://github.com/mouadja02/arkitect/issues/85)), and a wordmark once drawn too
short to read ([#76](https://github.com/mouadja02/arkitect/issues/76)) is now grown until its text carries.

The visual-review issues cover different packs; they are not duplicates. The
upstream drift pass from #74 and #82 is the one monitor, and #83's lifecycle re-check runs in it. Large test files and the Excalidraw builder
remain refactoring candidates, with no implementation scheduled in this snapshot.

## Decisions that can look like unfinished work

- **Changelog fragments:** [#32](https://github.com/mouadja02/arkitect/issues/32) originally landed as [PR #55](https://github.com/mouadja02/arkitect/pull/55). Commit
  [5ad8eb0](https://github.com/mouadja02/arkitect/commit/5ad8eb0) deliberately removed the fragment system.
  Current policy is one-line edits to CHANGELOG.md under Unreleased, with a
  conflict-marker guard. The release workflow dates that section; it does not
  collect fragments.
- **Catalog performance:** [#16](https://github.com/mouadja02/arkitect/issues/16) was closed after measurements supported
  keeping the existing in-process cache. A new index or per-pack split was not built.
- **Visual reviews:** [#18](https://github.com/mouadja02/arkitect/issues/18) completed Azure. Brands, AWS/GCP and curated-pack
  review records remain [#72](https://github.com/mouadja02/arkitect/issues/72), [#73](https://github.com/mouadja02/arkitect/issues/73) and [#81](https://github.com/mouadja02/arkitect/issues/81) respectively.
- **Product coverage:** [#11](https://github.com/mouadja02/arkitect/issues/11) and [#20](https://github.com/mouadja02/arkitect/issues/20) resolved source/licensing
  decisions. Some products remain on-demand; closed coverage issues do not mean
  every requested logo is bundled or directly fetchable.
- **Style storage:** the implemented location is ~/.arkitect/<engine>/, or
  ARKITECT_HOME, using sources.json and style-overrides.json. Earlier proposed
  locations in [#89](https://github.com/mouadja02/arkitect/issues/89) are historical.
- **Releases:** merged work is available on main, but is not automatically a tagged
  release. A person starts the release workflow; v1.2.0 (2026-09-18) was the
  first tagged GitHub Release and v2.0.0 the latest at this snapshot. Nothing is
  published to npm.

## Keeping this accurate

After merging work, link its PR from the issue, check only verified acceptance
criteria, and name any remaining scope in a follow-up issue. Retain the original
report as history and put current status above it. Update this snapshot when the
work order changes; use issue and PR state for day-to-day tracking.
