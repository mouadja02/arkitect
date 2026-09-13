### Added

- **JAX, Flax, LightGBM, CatBoost, Metaflow and SigNoz ship their own logos**
  (#20). Each project authored its logo and ships it in its own repository
  under that repository's open-source licence, with no separate logo or
  trademark policy governing it. Each file is committed byte-for-byte in its
  own `local-files` source, pinned by digest, with the LICENSE linked at the
  commit the file came from. They live in `ml-training`, and SigNoz in
  `observability`. CatBoost publishes its logo only as a PNG, so the builder's
  committed-artwork path now takes a raster at its own aspect.
- **Nine more products are catalogued on-demand, each with its licence
  finding** (#20):
  - **Linux Foundation trademark guidelines:** Flyte and Feast (LF AI & Data),
    KServe and SPIFFE (CNCF), Sigstore and Cosign (their brand guide).
  - **No published logo:** Kustomize has only its docs site's favicon.
  - **Business Source License:** Seldon Core.
  - **Written permission required:** Dagger's trademark guidelines.

  Each points at pinned artwork to fetch, or at the brand page.
