# Project status

Status reviewed on 2026-09-15, after [PR #98](https://github.com/mouadja02/arkitect/pull/98) merged into main.
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
| Recent corrections | Library-cell sizing, broken documentation links, accurate preview prerequisites | [#80](https://github.com/mouadja02/arkitect/issues/80), [#87](https://github.com/mouadja02/arkitect/issues/87), [PR #97](https://github.com/mouadja02/arkitect/pull/97) |

PR #97 and PR #98 passed the full cross-platform CI matrix and the Draw.io
Desktop export check. See [testing.md](testing.md) for the maintained test
baseline and local verification commands. Passing those checks does not close
the work listed below.

## In progress

No implementation PR remains open at this snapshot. The two diagram-correctness
bugs this page listed as next are fixed on main by PR #98. The items below are
recommended priorities, not work already started or assigned.

## Remaining work

| Issue | Order | Remaining outcome |
|---|---|---|
| [#75](https://github.com/mouadja02/arkitect/issues/75) | Then | Cover title ties in the resolver answer key; keep separate from exact IDs. |
| [#81](https://github.com/mouadja02/arkitect/issues/81) | Review backlog | Record curated-pack reviews at the exact shipped payload hashes. |
| [#73](https://github.com/mouadja02/arkitect/issues/73) | Review backlog | Record AWS/GCP reviews and audit captions. |
| [#72](https://github.com/mouadja02/arkitect/issues/72) | Review backlog | Complete the brands review split from the Azure work. |
| [#74](https://github.com/mouadja02/arkitect/issues/74) | Maintenance backlog | Extend upstream drift coverage to local-files artwork and licences. |
| [#82](https://github.com/mouadja02/arkitect/issues/82) | Maintenance backlog | Add repository-health signals using the same upstream checking path. |
| [#83](https://github.com/mouadja02/arkitect/issues/83) | Maintenance backlog | Surface product lifecycle metadata; reverify historical research first. |
| [#88](https://github.com/mouadja02/arkitect/issues/88) | Release backlog | Implement release preparation and publication; no npm publishing. |

The two issues that made a diagram draw the wrong thing are fixed: an exact
Draw.io catalog ID is now looked up as an ID rather than passed through text
search ([#95](https://github.com/mouadja02/arkitect/issues/95)), and an SVG's size is read from its root element in both
engines ([#96](https://github.com/mouadja02/arkitect/issues/96)). Diagrams built before PR #98 may still carry a wrong mark
or a stretched logo; rebuild them rather than trusting the old output. What
remains is legibility rather than identity. A mark invisible on a light canvas is now
refused at build time ([#85](https://github.com/mouadja02/arkitect/issues/85)), and a wordmark once drawn too
short to read ([#76](https://github.com/mouadja02/arkitect/issues/76)) is now grown until its text carries.

The visual-review issues cover different packs; they are not duplicates. The
upstream issues overlap in infrastructure: coordinate #74, #82 and #83 rather
than building three separate monitors. Large test files and the Excalidraw builder
remain refactoring candidates, with no implementation scheduled in this snapshot.

## Decisions that can look like unfinished work

- **Changelog fragments:** [#32](https://github.com/mouadja02/arkitect/issues/32) originally landed as [PR #55](https://github.com/mouadja02/arkitect/pull/55). Commit
  [5ad8eb0](https://github.com/mouadja02/arkitect/commit/5ad8eb0) deliberately removed the fragment system.
  Current policy is one-line edits to CHANGELOG.md under Unreleased, with a
  conflict-marker guard. Release tooling remains [#88](https://github.com/mouadja02/arkitect/issues/88).
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
  release. No tags or GitHub Releases existed at this snapshot; #88 remains planned.

## Keeping this accurate

After merging work, link its PR from the issue, check only verified acceptance
criteria, and name any remaining scope in a follow-up issue. Retain the original
report as history and put current status above it. Update this snapshot when the
work order changes; use issue and PR state for day-to-day tracking.
