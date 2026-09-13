### Fixed

- **An unknown node or edge `kind` is named in the build report** (#48). A
  misspelt kind silently changed what the diagram claims: `"kind": "asnyc"` drew
  a primary flow where an asynchronous link was meant, and `"kind": "cylinder"`
  in a Draw.io spec drew a plain box, with exit 0 and nothing in the report.
  Both builders still draw the fallback, and now list every such kind under
  `unknownKinds` in the report and the CLI output, with the field
  (`edges[2].kind`), the value, what it was drawn as and the valid kinds. The
  Excalidraw builder looked kinds up through the prototype, so
  `"kind": "constructor"` drew an arrow with no stroke colour, width or style;
  only its own kinds count now. Both `SKILL.md` files and `AGENTS.md` tell
  agents to treat a non-empty `unknownKinds` like an unresolved icon.
