### Added

- **`excalidraw render` writes a real PNG on any OS** (#39), using a locally
  installed Edge, Chrome or Chromium found on `PATH` or where each OS installs
  it. `--out-dir DIR` writes `DIR/<scene>.png` like `drawio render`, `--width`
  sets its size, and `--browser` or `ARKITECT_BROWSER` pins a browser (an
  unusable pin fails rather than falling back). The page is a local SVG in a
  throwaway profile that is removed afterwards; nothing is downloaded. Ubuntu's
  snap-packaged Chromium, which cannot see the host's `/tmp`, is staged in its
  own `~/snap/chromium/common` instead.

### Fixed

- **`excalidraw render` no longer writes SVG under a `.png` name** (#39).
  `--out preview.png` exited 0 with XML inside, `--out .analysis/renders` (the
  example in `AGENTS.md`) created a file called `renders`, and `--scale nope`
  drew NaN dimensions. The `--out` extension now decides the format and any
  other extension or a directory exits 2; `--scale`, `--padding`, `--width`,
  `--style` and `--background` are checked before anything is drawn. A PNG
  replaces the previous preview only once it is a real PNG, so a crashed,
  timed-out or empty screenshot, or a missing browser, exits 1 and leaves the
  old file as it was. The report states the format written.
