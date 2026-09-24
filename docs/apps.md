# The local apps

Generation and validation need neither app. They are where you look at a
diagram and edit it by hand, and where an agent edits an existing Draw.io file
page by page.

## Excalidraw container

The official `excalidraw/excalidraw` image: the static app that runs
excalidraw.com, served by nginx, with no backend.

```bash
docker compose -f docker/docker-compose.yml up -d     # http://localhost:3000
docker compose -f docker/docker-compose.yml down
EXCALIDRAW_PORT=8080 docker compose -f docker/docker-compose.yml up -d
```

Or through the PowerShell helper, which waits until the app answers, opens the
browser and reveals a file to drag in:

```powershell
$S = "skills/arkitect-excalidraw/scripts"
& $S/excalidraw-docker.ps1 -Open -Path docs/architecture.excalidraw
& $S/excalidraw-docker.ps1 -Library        # reveal your built-icon library
& $S/excalidraw-docker.ps1 -Status         # also -Up, -Down, -Logs, -Port 8080
```

It runs read-only with `no-new-privileges`. The compose file replaces the
image's healthcheck, which asks `localhost`, gets `::1`, and reports
`unhealthy` forever against an nginx that listens on IPv4 only.

**What having no backend means:**

- The file on disk is the source of truth. Closing the tab saves nothing;
  export back over the original (File → Save to disk).
- The app can't open a file off your disk by itself, so drag it onto the
  canvas. A `.excalidraw` file replaces the canvas; a `.excalidrawlib` joins
  the library sidebar.
- Live collaboration needs `excalidraw-room`, which is left out on purpose.

**The app or the preview.** `arkitect excalidraw render` answers "does the
layout work?": instant, and an agent can read the PNG back. The app answers
"what does it look like?". Excalidraw's fonts aren't installed outside it, so
the preview's text runs slightly wide. Judge layout from the preview and
typography in the app.

The app's own **Browse libraries** button opens `libraries.excalidraw.com`, a
public catalogue that is sent nothing about your scene.
`arkitect excalidraw browse` reaches the same catalogue from the CLI
([icons.md](icons.md#the-public-catalogue)).

**Troubleshooting.** "Docker is not available": start Docker Desktop. Port in
use: `-Port 8080` or `EXCALIDRAW_PORT`. Slow first pull: `-Up -TimeoutSeconds
300`. An empty canvas after a drop: the app refused the scene; run
`arkitect excalidraw validate` on it.

## Draw.io Desktop

The only renderer for `.drawio`, and the editor to use. Never the hosted
editor at app.diagrams.net.

```powershell
& 'C:\Program Files\draw.io\draw.io.exe' "docs/architecture.drawio"
```

```bash
open -a draw.io docs/architecture.drawio      # macOS
drawio docs/architecture.drawio               # Linux
```

Rendering to PNG or PDF, and how Arkitect selects a page, is in
[cli.md](cli.md#rendering).

## Draw.io MCP

For editing an existing file: it gives an agent a file's page list, so it can
work on one page instead of pulling megabytes of XML into its context.

```bash
claude mcp add --scope user drawio -- npx --yes --ignore-scripts @drawio/mcp
claude mcp list                                  # expect: drawio ... Connected
```

`--ignore-scripts` blocks the package's install scripts. The same command in
other hosts:

| host | file | entry |
|---|---|---|
| Codex | `~/.codex/config.toml` | `[mcp_servers.drawio]` `command = "npx"`, `args = ["--yes", "--ignore-scripts", "@drawio/mcp"]` |
| Cursor | `.cursor/mcp.json` or `~/.cursor/mcp.json` | `"mcpServers": { "drawio": { "command": "npx", "args": [...] } }` |
| VS Code, Copilot | `.vscode/mcp.json` | `"servers": { "drawio": { "command": "npx", "args": [...] } }` |
| OpenCode | `opencode.json` | `"mcp": { "drawio": { "type": "local", "command": ["npx", "--yes", "--ignore-scripts", "@drawio/mcp"], "enabled": true } }` |
| Antigravity | its MCP settings | the same command and arguments |

| tool | Arkitect's rule |
|---|---|
| `list_pages` | use freely |
| `get_page` | only for a small page |
| `set_page` | only after `arkitect drawio backup <file>` |
| `search_shapes` | fine |
| `open_drawio_xml`, `open_drawio_csv`, `open_drawio_mermaid` | **never on your content**: they open the hosted editor with the diagram in the URL |

Real diagrams embed their icons as base64 and run to 4–7 MB, so the editing
route reads a summary first:

```bash
arkitect drawio analyze diagram.drawio                     # pages, no XML
arkitect drawio analyze diagram.drawio --page 0 --cells    # geometry, no labels
arkitect drawio analyze diagram.drawio --find "Checkout API"
```

**Troubleshooting.** "Failed to connect": `npx` couldn't fetch the package;
check the network or install `@drawio/mcp` globally. Tools missing: restart
the session. A page that won't load is compressed; the analyzer decodes it.
An agent reaching for the hosted editor: stop it, and put the rule in your own
instructions if your tool doesn't read `AGENTS.md`.
