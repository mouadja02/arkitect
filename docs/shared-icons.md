# Shared icon packs in Excalidraw

Excalidraw can use all 4,843 committed marks in the 18 Draw.io packs, alongside
its 1,162 native library items. The original SVG or PNG is embedded in the scene:
you can move and resize it and edit its caption and connections. The logo's
individual paths are not Excalidraw strokes. SVG remains vector artwork.

```bash
node bin/arkitect.mjs excalidraw icon postgres
node bin/arkitect.mjs excalidraw icon --resolve drawio:databases/postgresql
node bin/arkitect.mjs excalidraw icon --stats
```

Use the exact `drawio:<pack>/<slug>` reference from search to select shared
artwork deliberately:

```json
{ "id": "db", "kind": "icon", "icon": "drawio:databases/postgresql", "label": "PostgreSQL", "col": 0, "row": 0 }
```

The [shared-pack example](../skills/arkitect-excalidraw/assets/templates/shared-icon-packs.spec.json)
mixes a native Kafka icon with shared PostgreSQL and Grafana artwork. Build and
render it locally using the Excalidraw commands in [cli.md](cli.md).
The [export gallery](../skills/arkitect-excalidraw/assets/templates/shared-icon-gallery.spec.json)
covers every pack, the five masked GCP marks, gRPC, Memcached and a non-square
AgentCore PNG. It is a set of artwork checks, not an architecture proposal.

## Resolution and failures

Existing bundled, house and downloaded-library choices keep their precedence.
When none resolves confidently, the shared catalog supplies a fallback using
Draw.io's conservative name matching. For example, `postgres` now draws
PostgreSQL instead of a placeholder; `kafka` keeps its native library icon.
An ambiguity among existing icons stays unresolved. Explicit library refs and
explicit shared refs never fall back to a different mark.

Search lists shared candidates with their pack, source, licence, MIME type,
dimensions and digest. `--resolve` and build reports identify the embedded
representation and provenance. Searches never print image payloads.

The 160 on-demand entries have no committed artwork and cannot be used through
this path. Unknown, misspelled, ambiguous and on-demand references become the
usual reported placeholders. No download is attempted. A missing pack file,
malformed catalog or digest mismatch is an installation/integrity error and
stops the build before replacing its output. Use the complete Arkitect install;
the Excalidraw adapter reads the sibling Draw.io catalog and libraries.

## Artwork and source terms

This adapter reuses already-shipped bytes under their existing terms. It adds
no artwork, licence grant or network request, and neither traces nor recolours
the marks. Catalog digests are checked before embedding; duplicate images share
one file entry. Original aspect ratios are retained.

Source policy reviewed on 2026-09-13:

| Source | Existing terms and permitted use |
|---|---|
| AWS, including the AgentCore PNGs | [Architecture icons](https://aws.amazon.com/architecture/icons/) for architecture diagrams; AWS also describes use through third-party diagramming libraries. |
| Azure | [Microsoft's icon terms](https://learn.microsoft.com/en-us/azure/architecture/icons/) permit copying, distribution and display for architecture diagrams, training and documentation; do not distort, crop, flip or rotate the marks. |
| Google Cloud, including legacy icons | [Google's official library](https://cloud.google.com/icons) provides current and legacy artwork for diagrams and technical documentation. Reuse the committed originals for that purpose. |
| Simple Icons 16.30.0 | [CC0](https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md); trademarks remain with their owners. Removed/on-demand marks remain excluded. |
| Devicon 2.17.0 | [MIT](https://github.com/devicons/devicon/blob/master/LICENSE); retain attribution and notices. |
| Lucide 1.45.0 | [ISC, with MIT notices for inherited Feather icons](https://github.com/lucide-icons/lucide/blob/main/LICENSE); retain attribution and notices. |
| Octicons 19.36.0 | [MIT](https://github.com/primer/octicons/blob/main/LICENSE); retain attribution and notices. |

These are the source terms already recorded for the shipped packs, applied to
another diagram format; vendor permissions are not general artwork licences.
See the [pack attribution](../skills/arkitect-drawio/assets/libraries/ATTRIBUTION.md)
and [NOTICE](../NOTICE) for source pins, credits and trademark conditions.

## Repeated lookups

Import the module when resolving many icons in one process. Catalog metadata,
canonical IDs and parsed pack libraries are cached in process; image payloads
are read only when resolving an icon, not during search.

```js
import { resolveIcon } from '../skills/arkitect-excalidraw/scripts/find-icon.mjs';

const postgres = resolveIcon('postgres');
// To reproduce the previous provider set in a module integration:
const nativeOnly = resolveIcon('postgres', { shared: false });
```

`catalog({ shared: false })` also exposes the previous provider set for callers
that supply entries to search or unattended resolution. This option does not
change installed libraries or download anything.
