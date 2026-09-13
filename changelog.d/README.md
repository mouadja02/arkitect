# Changelog fragments

Every change records its release note here, in a file of its own, instead of
editing `CHANGELOG.md`. Pull requests used to edit the same lines at the top of
`[Unreleased]`, so each merge after the first conflicted there (#32).

## Writing one

Name it after the issue: `changelog.d/<issue>-<slug>.md`, lower-case and
hyphenated, for example `46-doctor-drawio-discovery.md`. A change with no issue
uses `nopr-<slug>.md`.

Write it the way the entry will read in `CHANGELOG.md`: one or more of
`### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed` and
`### Security`, each followed by bullets. A numbered fragment mentions its issue.

```markdown
### Fixed

- **`doctor` finds Draw.io Desktop where `render` does** (#46). It checked four
  hard-coded paths, so ...
```

Check it:

```bash
node scripts/changelog.mjs --check
```

The suite runs the same check. On a pull request, the `changelog` workflow fails
when `bin/`, `skills/` or `docs/` change and no fragment is added. Label the pull
request `skip-changelog` when the change needs no entry: a test, a CI tweak, a
typo.

## Cutting a release

```bash
node scripts/changelog.mjs --assemble --dry-run   # print the result, change nothing
node scripts/changelog.mjs --assemble             # fold into [Unreleased], delete the fragments
```

Each entry lands under its heading, after the entries already there, in issue
order; a missing heading is created in Keep a Changelog order. Then rename
`[Unreleased]` to the version, as described in
[docs/maintenance.md](../docs/maintenance.md#version-bumps).
