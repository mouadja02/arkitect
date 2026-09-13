### Added

- **The 123 products a modern data, ML and platform stack uses now all have an
  answer** (#20). Every product the issue names — across `ai-frameworks`,
  `data-platforms`, `security-identity`, `devops`, `streaming-orchestration`,
  `saas-collab`, `ml-training`, `observability`, `databases` and
  `languages-runtimes` — ends with a recorded outcome in `sources.json`: 38 ship
  their artwork and the rest are catalogued on-demand with the licence or policy
  that blocked them. `find-icon.mjs` answers all 142 by name where it used to
  return nothing. The packs now ship 4,843 marks and catalogue 158 without bytes.

  Shipped, each committed byte-for-byte from a pinned commit with its LICENSE
  linked at that commit: DSPy, Guardrails AI, llama.cpp, LocalAI, Mem0,
  Pydantic AI, TRL, Axolotl and whylogs; Lightdash, Evidence, DataHub and
  OpenMetadata; Flagsmith; Apache Hamilton, marimo and statsmodels; Move, Hatch
  and tox; Hatchet, Trigger.dev, Restate, Meltano and SQLMesh; Sysdig, Checkov,
  tfsec, Infisical and ZITADEL; LanceDB, Marqo and OrientDB; Okteto, Tilt,
  Colima and Dokku. Apache APISIX joins the existing `asf-logos` source, since
  the ASF licenses every logo in its originals index on the same terms.

- **Two products needed no sourcing decision at all** (#20). AWS renamed
  QuickSight — it became Amazon Quick Suite in 2025 and Amazon Quick in 2026 —
  so the architecture package has shipped the mark all along under a name nobody
  searches for; `quicksight` now resolves to `aws/amazon-quick`. Aqua Security
  also already shipped, stranded in the rank-90 catch-all, and is promoted into
  `security-identity` beside Trivy.

### Changed

- **The licence bar now says what copyleft means for artwork** (#20). This
  repository ships permissive artwork only: MIT, Apache-2.0, BSD and ISC ship,
  while MPL-2.0, LGPL, GPL, AGPL, SSPL and the Business Source Licence do not,
  because redistributing the file would put this repository's users under
  copyleft terms for it. That decides Vector, Semgrep, Windmill, Grafana Mimir,
  Unleash, Tyk, Garden, Earthly, Inngest and RavenDB. Two findings run the other
  way: llama.cpp's brand repository grants redistribution *notwithstanding* its
  CC BY-NC licence, and ZITADEL's brand policy names architecture diagrams as
  fair use — so a published policy can admit a mark its licence alone would not.

- **A published logo policy is checked before the repository licence** (#20).
  Logz.io and Telegraf both keep an official mark inside a permissively licensed
  repository, and both stay on-demand because the vendor separately requires
  written permission for logo use. The reverse case is recorded too: OrientDB's
  `REUSE.toml` annotates its logo file with Apache-2.0 specifically, which is
  stronger evidence than the repository licence alone.

- **`tests/icon-queries.json` grew to 492 rows.** Every product the issue names
  has a row, and the eleven that asserted "in no source (#20)" now assert an id.
  Precision at rank 1 is 96.4%, up from 94.5%, with no confidently wrong answer
  and every refusal held. Five rows are deliberate refusals: `mode`, `craft`,
  `trigger`, `triton` and the pre-existing `delta` each name two real products,
  and the resolver flags them rather than guessing.

### Fixed

- **Titling a mark can break an unrelated lookup** (#20). Lambda, the GPU cloud,
  brands itself with the bare word; titling it that way outranked **AWS Lambda**
  and stopped `lambda` resolving at all. It ships as `Lambda Labs`, and the
  answer key now pins `lambda` to AWS Lambda so the regression cannot return.

- **Two marks were the wrong artwork, caught by rendering them** (#20). The file
  that looked like OpenObserve's logo in its own MIT-licensed website repository
  is still the **ZincSearch** mark from before the product was renamed, so
  OpenObserve is on-demand instead. Apache Hamilton's only vector asset is the
  pre-donation **DAGWorks** wordmark; it ships the project's own podling logo
  instead, downscaled from the 644 KB raster the project publishes. A third,
  Mem0, shipped a white-on-transparent mark that was invisible on a white
  canvas, and now ships its square variant.
