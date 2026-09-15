# Project status

Status reviewed on 2026-09-15, after [PR #97](https://github.com/mouadja02/arkitect/pull/97) merged into main.
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
| Recent corrections | Library-cell sizing, broken documentation links, accurate preview prerequisites | [#80](https://github.com/mouadja02/arkitect/issues/80), [#87](https://github.com/mouadja02/arkitect/issues/87), [PR #97](https://github.com/mouadja02/arkitect/pull/97) |

PR #97 passed the full cross-platform CI matrix and the Draw.io Desktop export
check. See [testing.md](testing.md) for the maintained test baseline and local
verification commands. Passing those checks does not resolve the known bugs below.

## In progress

No implementation PR remains open at this snapshot. The repository and issue
status reconciliation is recorded in this update. The next two items below are
recommended priorities, not work already started or assigned.

## Remaining work

| Issue | Order | Remaining outcome |
|---|---|---|
| [#95](https://github.com/mouadja02/arkitect/issues/95) | Next | Exact catalog IDs must select their own artwork. |
| [#96](https://github.com/mouadja02/arkitect/issues/96) | Next | Read fetched SVG dimensions from the root element. |
| [#85](https://github.com/mouadja02/arkitect/issues/85) | Then | Detect artwork invisible on a light canvas during pack building. |
| [#84](https://github.com/mouadja02/arkitect/issues/84) | Then | Distinguish fetchable on-demand artwork from manual discovery. |
| [#75](https://github.com/mouadja02/arkitect/issues/75) | Then | Cover title ties in the resolver answer key; keep separate from exact IDs. |
| [#78](https://github.com/mouadja02/arkitect/issues/78) | Then | Generate, check or reduce exact icon counts repeated across docs. |
| [#76](https://github.com/mouadja02/arkitect/issues/76) | Then | Make wide wordmarks legible while preserving aspect and layout. |
| [#77](https://github.com/mouadja02/arkitect/issues/77) | Then | Report distinct IDs that share identical artwork. |
| [#81](https://github.com/mouadja02/arkitect/issues/81) | Review backlog | Record curated-pack reviews at the exact shipped payload hashes. |
| [#73](https://github.com/mouadja02/arkitect/issues/73) | Review backlog | Record AWS/GCP reviews and audit captions. |
| [#72](https://github.com/mouadja02/arkitect/issues/72) | Review backlog | Complete the brands review split from the Azure work. |
| [#74](https://github.com/mouadja02/arkitect/issues/74) | Maintenance backlog | Extend upstream drift coverage to local-files artwork and licences. |
| [#82](https://github.com/mouadja02/arkitect/issues/82) | Maintenance backlog | Add repository-health signals using the same upstream checking path. |
| [#83](https://github.com/mouadja02/arkitect/issues/83) | Maintenance backlog | Surface product lifecycle metadata; reverify historical research first. |
| [#88](https://github.com/mouadja02/arkitect/issues/88) | Release backlog | Implement release preparation and publication; no npm publishing. |

The first two issues affect diagram correctness. Exact Draw.io catalog IDs are
currently passed through text search ([#95](https://github.com/mouadja02/arkitect/issues/95)), and SVG dimensions may come
from a child element ([#96](https://github.com/mouadja02/arkitect/issues/96)). Review icon selections and fetched-logo aspect
ratios until those fixes land. PR #97 did not change either path.

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
