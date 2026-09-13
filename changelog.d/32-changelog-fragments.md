### Changed

- **Changelog entries are fragments, so parallel pull requests stop conflicting**
  (#32). Every pull request edited the same lines at the top of `[Unreleased]`,
  so each merge after the first conflicted there, and a hand resolution could
  drop an entry or leave a conflict marker with nothing to catch it. A change now
  adds `changelog.d/<issue>-<slug>.md`; `scripts/changelog.mjs --assemble` folds
  the fragments into `CHANGELOG.md` when a release is cut. The suite fails on a
  malformed fragment and on a conflict marker in any tracked text file, and a
  `changelog` workflow fails a pull request that changes `bin/`, `skills/` or
  `docs/` without a fragment unless it is labelled `skip-changelog`.
