### Fixed

- **The committed worked examples match what the generators build, and a test
  keeps them honest** (#50). Agents read the examples and their PNGs before
  writing a spec, but nothing compared the Draw.io starter with a rebuild, and
  the Excalidraw check compared only element counts. Both had drifted: the
  Draw.io starter still carried the project's pre-rename agent name and the
  palette artwork for all seven of its icons from before the official AWS pack
  (#8), and five elements of the Excalidraw starter sat where an older
  generator put them. Both starters are rebuilt and their PNGs re-rendered;
  `aws-data-platform` already matched and is unchanged. The Draw.io suite now
  requires the committed starter to be byte-identical to a fresh build, and the
  Excalidraw suite compares each example through a projection that ignores ids,
  seeds, nonces, timestamps and index keys but sees geometry, style, text,
  bindings and embedded files. Either failure names the first difference and how
  to rebuild. `docs/maintenance.md` says a generator change refreshes the
  examples and their PNGs in the same pull request.
