### Fixed

- **gRPC draws in its brand colour instead of black** (#31). Since #29 the
  gRPC icon is devicon's `plain` variant: one path with no fill, which a
  browser paints black. It had no contrast on a dark canvas, and the catalog
  still described it as full-colour artwork. A devicon mark can now be flagged
  `"paint": "tint"` in `sources.json`, and gRPC is the only one that is. A
  flagged mark is filled with its manifest hex through the root, keeping every
  namespace and its viewBox. Artwork that already carries paint is refused
  rather than guessed at: an explicit fill or stroke, `currentColor`, a style,
  a gradient, pattern, image, mask or filter. gRPC now draws in `#00b0ad`, the
  single-colour convention every Simple Icons mark follows; the official
  two-colour wordmark sets its text in `#244b5a`. The seven full-colour devicon
  marks are byte-for-byte unchanged. Every painted catalog row, Simple Icons or
  devicon, tinted or on a bright tile, now records the `hex` it was painted
  with.
