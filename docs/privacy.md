# Privacy

Architecture diagrams name systems, vendors, environments and often a
customer. Using an agent to draw one shouldn't mean shipping it anywhere.

- **Your diagrams never leave the machine.** No upload, no telemetry, no
  hosted step, no account.
- **Two things reach the network**, both public and both free of anything about
  your architecture: a product logo you asked for by URL, and the public
  Excalidraw library catalogue.
- **No query carries content from your diagram.** Product names only.
- **Nothing derived from your diagrams is committed:** not renders, labels,
  paths or redaction digests.

## What runs where

| | runs | network |
|---|---|---|
| building, validating, analyzing | your machine | none |
| rendering | Draw.io Desktop, or a headless local browser | none |
| the Excalidraw container | your machine; the static app, no backend | none |
| the Draw.io MCP server, as Arkitect uses it | your machine, over stdio | none |
| the two hooks | your machine; they read the prompt, the last reply and the session's tool calls | none |
| fetching a logo | your machine | one HTTPS GET to the URL you named |
| the library catalogue | your machine | HTTPS GET to `libraries.excalidraw.com` |

There are no npm dependencies, so no dependency tree calls out either.
Installing Arkitect itself from npm, and `npx @drawio/mcp` for the MCP server,
are fetches from the registry you choose to make.

## The hosted-editor rule

Three Draw.io MCP tools, `open_drawio_xml`, `open_drawio_csv` and
`open_drawio_mermaid`, open app.diagrams.net with the content in the URL. Both
skills and `AGENTS.md` forbid them on your content; Arkitect uses only
`list_pages`, `get_page`, `set_page` and `search_shapes`. If your tool reads
none of those files, state the rule in your own instructions. A reply that
points you at the hosted editor breaks the same rule, and an eval checks it.

## Searching for a logo

The download is harmless. The query is the risk.

```
ok     snowflake logo svg
ok     grafana brand assets
never  <customer> data platform architecture
never  <internal codename> logo
```

## The style record

The learning skills read diagrams you name and record structural statistics
and digests only: shape and edge counts, style-token distributions, geometry
quantiles, a SHA-256 per file. No labels, page names, file names, paths,
hostnames, URLs or image payloads; a test holds this on every run. Your files
are opened read-only and hashed before and after.

What you teach Arkitect lives in `~/.arkitect/<engine>/` (or
`$ARKITECT_HOME/<engine>/`), outside the plugin and every repository. The
paths in `sources.json` and anything a note says are yours: treat the folder
like `.analysis/`.

## Deliberately not committed

| | why |
|---|---|
| `.analysis/` | renders of your diagrams, and `sources.local.json`, whose paths can name a customer |
| `tests/output/` | suite scratch |
| `tests/sensitive-tokens.*.sha256` | salted digests derived from your corpus |
| `skills/*/assets/logos/`, `assets/icons/` | third-party marks under their own terms |
| `skills/arkitect-excalidraw/assets/libraries/*` (non-bundled) | other people's libraries, re-installable |
| `*.backup-*.drawio`, `*.backup-*.excalidraw` | the copies taken before an in-place edit |
| `.$*.bkp` | Draw.io Desktop's autosave: a full copy of an open diagram, images included |

## The redaction check

The suite compares every repository file against salted digests of strings
from your reference diagrams, and fails if one appears. The digests are
gitignored: the salt is in the repository, so publishing them would let anyone
with a list of company names test which appear in your corpus.
[testing.md](testing.md#the-redaction-check) has the detail.

## Reporting a problem

A way for Arkitect to send diagram content anywhere is a security issue:
report it privately through [SECURITY.md](../SECURITY.md).
