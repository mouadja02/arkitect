# Editing an existing scene

Read this before changing an `.excalidraw` file you did not just build, or
before writing any scene JSON by hand. Paths are relative to the skill; scripts
are in `scripts/`.

## Never load the whole file

A scene with embedded images runs to megabytes of base64. Summarize it instead:

```bash
node scripts/analyze-excalidraw.mjs "<file>"            # structure and style tokens
node scripts/analyze-excalidraw.mjs "<file>" --cells    # geometry table, no text
node scripts/analyze-excalidraw.mjs "<file>" --images   # embedded image inventory
```

Then make a targeted edit and re-validate with `validate-excalidraw.mjs`.

## Back it up first

`build-diagram.mjs` backs up for you. Any other route means calling
`backupExisting()` from `scripts/lib/excalidraw-core.mjs` or copying the file
yourself before the first write.

## Keep bindings two-sided

An arrow and the shape it binds to each list the other. `repairBindings()` in
the core library fixes imported content; the validator fails a scene where one
side is missing.

## Match the scene, not the guide

If the existing diagram uses `roughness: 0` and sharp corners, so does your
addition. Say in the report that you followed the file rather than the guide.

## Hand-written JSON

A narrow exception: only when the spec format genuinely cannot express what you
need, or for a targeted edit like this one — never the way a new scene gets
built. Read `excalidraw-format.md` first, particularly the parts about relative
arrow points and two-sided bindings.
