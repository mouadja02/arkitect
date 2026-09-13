### Fixed

- **`doctor` finds Draw.io Desktop wherever `render` does** (#46). It checked
  four hard-coded paths, so with Draw.io in `/opt/drawio` (where the official
  Linux `.deb` installs it), on `PATH`, or pinned with `DRAWIO_EXE`, it reported
  Desktop missing while `arkitect drawio render` worked, and an agent could drop
  visual verification because of it. `render-drawio.mjs` now exports
  `locateDrawio()`, which returns the path, how it was found (`DRAWIO_EXE`,
  `PATH` or an install location) and every path tried; `discoverDrawio()` is
  built on it and `doctor` reports it. `doctor` names the source; when nothing
  is found it says how many PATH directories it searched and lists every install
  location it tried; and it warns when `DRAWIO_EXE` points at something `render`
  would refuse.
