### Fixed

- **The documented test count is checked, and written down once** (#47). Four
  files quoted the fresh-clone result by hand, and it drifted twice: copied from
  a checkout whose local sources ran extra tests, and left behind as tests were
  added. Nothing failed either time. `docs/testing.md` now states it once, the
  other files link to it, and `node tests/run-tests.mjs` checks it on every full
  run: passed plus skipped must equal the number of tests that ran, the skipped
  count must equal the tests declared with `sourceTest()`, and on a checkout
  without local sources every skip must be one of those. With local sources
  present, the runner prints the fresh-clone expectation beside the local
  result. The "about two seconds" claims, which were off by an order of
  magnitude, are replaced by a measured figure.
