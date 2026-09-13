### Added

- **Apache Iceberg, Apache Pinot and Apache Beam ship real icons** (#11). The
  Apache Software Foundation licenses its project graphic logos under the
  Apache License, so the official originals from
  `https://www.apache.org/logos/originals/` are committed byte-for-byte in a new
  `asf-logos` source, pinned by digest, with the policy recorded in
  `sources.json`, `ATTRIBUTION.md` and `NOTICE`. They draw at their own aspect
  rather than squashed square, so the Iceberg lockup is 78 by 21. The packs now
  ship 4,796 marks, and 66 entries are catalogued without artwork.

### Changed

- **Seven marks that stay on-demand now say why** (#11). Apache Hudi, Samza,
  ActiveMQ and ZooKeeper have a licensed logo, but the official artwork does not
  draw correctly at icon size: a 246 KB raster wrapped in SVG, a wordmark in
  live Myriad Pro text, a wordmark that renders as "MQ" without its font, and a
  725 KB mascot illustration. Their fetch command now points at the ASF's own
  PNG render. Crossplane, Flux and Open Policy Agent are CNCF artwork, published
  only under the Linux Foundation trademark guidelines, which allow a logo as a
  link to its project and nothing broader. Their entries record that finding and
  point at the pinned CNCF artwork. Every on-demand entry with a licence link
  now carries it into the catalog as `licenceUrl`.
