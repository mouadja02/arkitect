### Fixed

- **A broken icon payload can no longer pass every check** (#33). gRPC and
  Memcached shipped as images Draw.io could not paint, and the suite,
  `build-packs.mjs --verify` and the Desktop export job all passed (#29). Every
  SVG payload is now parsed as XML by a strict, dependency-free checker
  (`scripts/lib/xml-check.mjs`): a mismatched or unclosed tag, a raw `&`, an
  undefined entity, a namespace prefix used outside its scope, bytes that are
  not UTF-8, or a root that is not `<svg>` in the SVG namespace is refused.
  `build-packs` refuses to write a pack holding one and names every bad entry;
  `--verify` parses every committed payload; the suite's Draw.io-strict loader
  uses the same check and now lists every broken entry by pack, index and
  catalog id in one run, instead of stopping at the first. The Draw.io Desktop
  job exports all 4,793 committed marks, 400 to a page, instead of 23, and
  fails a mark with under 1% ink in its own tile, so one blank mark cannot hide
  among drawn ones; the ten sparsest are printed for a look. A mark that draws
  the wrong artwork validly is still a matter for the contact sheets (#18).
