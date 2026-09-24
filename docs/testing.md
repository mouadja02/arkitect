# Testing

```bash
node tests/run-tests.mjs                # all three suites
node tests/run-tests.mjs drawio         # or one: drawio, excalidraw, toolkit
```

Offline and deterministic: no network, no Docker, no dependencies. About 20
seconds on a laptop, up to a minute on a CI runner. It needs a clone; the npm
package doesn't carry it.

On a fresh clone expect `400 passed, 0 failed, 7 skipped`. The skips need
reference diagrams of your own, listed in `.analysis/sources.local.json`
([getting-started.md](getting-started.md#the-local-source-list)).

That line is the only place the count is written. A full run checks it: passed
plus skipped must equal what ran, and the skips must be exactly the tests
declared with `sourceTest()`. A pull request that adds a test updates the line,
and the runner prints the one to use. With local sources present it prints the
fresh-clone expectation beside the local numbers; quote that one (#47).

Each suite writes scratch to `tests/output/<engine>/` in its own process. The
icon-store tests write to your real store under a `zz-test-` prefix and clean
up before and after; the suite points `ARKITECT_HOME` into `tests/output/`
otherwise.

## What is covered

Every test is named for the case it covers, with the issue it came from, so
`tests/*.mjs` is the full inventory. By area:

| area | holds |
|---|---|
| generation | native, valid output in both engines; every edge bound at both ends; committed templates rebuild byte for byte (Draw.io) or element for element (Excalidraw) from their specs (#50) |
| specs | a spec naming what doesn't exist, or with a bad number, is refused before any write, every problem listed; unknown kinds and fields build and are reported (#36, #48, #115, #205, #221) |
| layout | Draw.io sides, spread ends, waypoints round obstacles, label and title placement (#237, #241, #239); Excalidraw boundaries hold every caption, text is measured as the app draws it, `route: "avoid"` keeps clear and writes fixed segments (#191, #222, #124) |
| validation | Draw.io `validate` sees edges through icons, text over containers, shared trunks, dense pages; the Excalidraw validator sees one-sided bindings and crossings (#242–#247, #125) |
| icons | search and resolution in both engines against the answer keys; generic words, vendor names, title ties, exact ids, on-demand entries, lifecycle, identical artwork (#75, #77, #83, #95, #231, #283, #285) |
| icon packs | every library loads the way Draw.io reads one; every payload is well-formed; no mark paints only white; every shipped mark is reviewed at the artwork that ships (#33, #72, #73, #81, #85) |
| icon counts | every count a doc quotes matches the catalog, the library index and the answer keys; the failure names the number to write (#78) |
| style | an override restyles tokens and kinds, a bad one is ignored whole, `--defaults` ignores it, the shipped record holds no diagram content (#89, #90) |
| safety | backups before every overwrite and retention of six (#35, #49); the style record carries no labels; the redaction check |
| CLI | strict arguments, one-line errors, every documented command dispatchable, rendering failures never reported as renders (#37, #116, #157) |
| packaging | the real `npm pack` tarball ships every bundled asset and no cache, and its CLI runs from outside the checkout (#38) |
| plugin | manifests agree, six skills, the learning and apply skills user-invoked only, each `SKILL.md` plus its pattern section within 12,000 bytes (#113), both hooks |
| releases | version bumps, changelog rolling, the release workflows gated on a merged `release/v*` PR, npm only after the Release (#88, #126) |
| evals | each case's graders pass a good report and fail the known bad ones (#248, #251) |

The Excalidraw answer key is the 359-query answer key in `tests/excalidraw-icon-queries.json`:
no different product drawn unattended, and at least 80% of drawable answers
drawn.

## The redaction check

The suite tokenizes every repository file and compares it against salted
SHA-256 digests of strings drawn from your reference diagrams.

- With your sources present it derives the digests fresh and rewrites
  `tests/sensitive-tokens.<engine>.sha256`.
- Without them it uses that file if it's on disk, and skips otherwise, as on a
  fresh clone.

The digest file is gitignored: the salt is an in-repo constant, so publishing
digests would let anyone with a list of company names confirm which appear in
your corpus. What counts as sensitive is narrow on purpose: identifier-shaped
tokens (a digit, an underscore, two hyphens) and all-caps runs, minus common
technical words and minus every token the repository already uses. A token once
recorded stays recorded.

Check it still has teeth:

```bash
echo "<!-- probe: Some_Customer_Name -->" >> README.md
node tests/run-tests.mjs      # the redaction test fails
git checkout README.md
```

## Draw.io Desktop

The suite doesn't need Desktop. With it installed, the export tests render
every committed mark and fail any with under 1% ink in its own tile:

```bash
ARKITECT_DRAWIO_SMOKE=1 node tests/drawio.mjs     # about a minute
```

## Plugin validation

```bash
claude plugin validate --strict .
claude plugin details arkitect        # expect Skills (6)
```

## Evals

`evals/` holds 17 agent cases, nine for Draw.io and eight for Excalidraw. They
run real agent sessions and LLM graders, so they cost money and never run by
default. How to run them, and what each case checks:
[evals/README.md](../evals/README.md).

## CI

`.github/workflows/ci.yml` runs the suite on Ubuntu 24.04 and 26.04, Windows
and macOS against Node 20, 22 and 24, with no local sources, so CI always sees
the fresh-clone result. No job uses `ubuntu-latest`: its switch to Ubuntu 26
would change the image without anyone choosing it (#122). One more job runs
the newest npm, for the packaging tests, and dry-runs `npm publish` on a
prerelease version (#54, #126).

`.github/workflows/drawio-desktop.yml` installs a pinned Draw.io Desktop on
both Ubuntu images when a change touches the Draw.io skill, and runs its suite
with `ARKITECT_DRAWIO_SMOKE=required`, which fails rather than skips when
Desktop won't start.
