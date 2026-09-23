# Install

Arkitect is one repository that works three ways: a **Claude Code plugin**, a
**toolkit any agent can drive**, and a **CLI you can run yourself**. All three
are the same files — you are only choosing how your tool finds them.

## Requirements

| | needed for | notes |
|---|---|---|
| **Node.js 20+** | everything | the only hard requirement. No npm install: there are no dependencies |
| Claude Code | the plugin route | not needed for any other agent |
| Docker | the local Excalidraw app | optional. Generation, validation and preview all work without it |
| [Draw.io Desktop](https://github.com/jgraph/drawio-desktop/releases) | rendering `.drawio` to PNG | optional, local only. `arkitect drawio render` discovers Linux/macOS/Windows installs; override with `--drawio-exe` or `DRAWIO_EXE` |
| Xvfb | headless Linux Draw.io rendering | `sudo apt install -y xvfb` when `xvfb-run` is missing; automatically used without a usable `DISPLAY` |
| PowerShell | legacy `.ps1` helpers | optional; Draw.io rendering also has a cross-platform Node helper |
| Edge or Chrome | rasterising the Excalidraw SVG preview to PNG | already present on Windows and macOS |

Check what you have:

```bash
node bin/arkitect.mjs doctor
```

Nothing in that list except Node is required. The rest only widens what the
agent can *see* — and seeing the render is what stops it shipping a diagram
that validates but reads badly.

## Route A — Claude Code plugin (marketplace)

```bash
claude plugin marketplace add mouadja02/arkitect
claude plugin install arkitect@arkitect
```

Verify:

```bash
claude plugin details arkitect
```

Expect `Skills (6)` — `arkitect-drawio`, `arkitect-excalidraw`,
`learn-drawio-style`, `learn-excalidraw-style`, `apply-drawio-style`,
`apply-excalidraw-style`.

## Route B — Claude Code plugin (clone into the skills directory)

The repository *is* the plugin, so placing it where Claude Code looks for
skills installs it.

```bash
git clone https://github.com/mouadja02/arkitect.git ~/.claude/skills/arkitect
```

```powershell
git clone https://github.com/mouadja02/arkitect.git "$env:USERPROFILE\.claude\skills\arkitect"
```

The directory name becomes the plugin id, so keep it as `arkitect`. It loads
next session as `arkitect@skills-dir`; run `/reload-plugins` to pick it up now.

Do **not** do both routes — that installs it twice.

## Route C — any other agent

Clone it anywhere, then write the adapter your agent reads into the project you
want to draw diagrams in:

```bash
git clone https://github.com/mouadja02/arkitect.git ~/arkitect

cd ~/my-project
node ~/arkitect/bin/arkitect.mjs install --all
```

`install` writes short pointer files — `AGENTS.md`, `.cursor/rules/`,
`.github/copilot-instructions.md`, `.opencode/command/` — each carrying the
absolute path of your Arkitect checkout. Re-running after an update refreshes
them in place; existing files are merged, not clobbered.

Per-tool detail, including Codex prompts and what to do when a tool reads none
of these files: **[agents.md](agents.md)**.

## Route D — no agent, just the CLI

```bash
git clone https://github.com/mouadja02/arkitect.git
cd arkitect
node bin/arkitect.mjs
```

Optionally put it on your `PATH`:

```bash
npm link          # from the repository root; no dependencies are installed
arkitect doctor
```

Everything the agent does, you can do by hand: write a spec, build, validate,
render. See **[cli.md](cli.md)**.

### The npm package

`package.json` is kept publishable, and its `files` list is the whole content
policy: the CLI, the six skills, their bundled icon packs, libraries and
attribution, the plugin manifest and the docs. It never carries the upstream
archive cache, cached logos, built icons, downloaded libraries, contact-sheet
HTML or browser profiles, or backups; a test packs the real tarball to prove it.
The test suite is not in the package, so `arkitect test` needs a clone. It is a
CLI distribution only: install the plugin through route A or B.

## Verify the install

```bash
node tests/run-tests.mjs
```

Offline, deterministic, about 20 seconds. A fresh clone reports some skipped
tests: they need reference diagrams of your own, which a clone does not have.
That is the correct result, not a problem. The exact numbers to expect are in
[testing.md](testing.md).

## The optional pieces

```bash
# Excalidraw, running locally, no backend, nothing uploaded
docker compose -f docker/docker-compose.yml up -d        # http://localhost:3000

# Draw.io editing over MCP (Claude Code shown; see agents.md for other hosts)
claude mcp add --scope user drawio -- npx --yes --ignore-scripts @drawio/mcp
```

→ [excalidraw-docker.md](excalidraw-docker.md) · [drawio-mcp.md](drawio-mcp.md)

## Update

```bash
git -C ~/.claude/skills/arkitect pull      # route B
claude plugin update arkitect              # route A
node ~/arkitect/bin/arkitect.mjs install --all --force   # route C, refresh adapters
```

Your learned style — record, findings, notes and override — your fetched
logos, made icons and installed libraries all live in `~/.arkitect/` (or
`$ARKITECT_HOME`), outside the plugin, so no route's update can wipe them.
Anything cached under `skills/*/assets/` before 2.1.0 is still read from there.

## Remove

| route | how |
|---|---|
| A | `claude plugin uninstall arkitect` |
| B | delete `~/.claude/skills/arkitect` |
| C | delete the adapter files, or just the fenced `arkitect:begin`…`arkitect:end` block |
| D | delete the clone (`npm unlink` first if you linked it) |

Your learned style and your caches in `~/.arkitect/` are not removed with the
plugin; delete that folder to forget them. Icons made before 2.1.0 sit in
`skills/arkitect-excalidraw/assets/icons/` and go with the plugin: copy that
folder first if you want to keep them.

Stop the container with `docker compose -f docker/docker-compose.yml down`.
