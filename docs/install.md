# Install

Arkitect is one set of files that works three ways: a Claude Code plugin, a
toolkit any other agent drives, and a CLI. Pick the route your tool needs.

| route | for | command |
|---|---|---|
| [Plugin](#claude-code) | Claude Code | `claude plugin install arkitect@arkitect` |
| [npm](#npm) | the CLI, and adapters for other agents | `npm install -g arkitect` |
| [npx](#npm) | one command, nothing installed | `npx arkitect <engine> <command>` |
| [Clone](#clone) | contributing, running the tests | `git clone https://github.com/mouadja02/arkitect.git` |

## Requirements

Node.js 20 or newer. There are no npm dependencies to install. Everything else
is optional and only widens what the agent can see:

| | needed for |
|---|---|
| [Draw.io Desktop](https://github.com/jgraph/drawio-desktop/releases) | rendering `.drawio` to PNG or PDF; `--drawio-exe` or `DRAWIO_EXE` pins a build |
| Xvfb | Draw.io rendering on headless Linux (`sudo apt install -y xvfb`) |
| Edge, Chrome or Chromium | rendering `.excalidraw` to PNG; SVG needs nothing |
| Docker | the local Excalidraw app ([apps.md](apps.md)) |

`arkitect doctor` says which of these it found.

## Claude Code

```bash
claude plugin marketplace add mouadja02/arkitect
claude plugin install arkitect@arkitect
claude plugin details arkitect          # expect: Skills (6)
```

Or clone into the skills directory, which is the same plugin without the
marketplace. Keep the folder name `arkitect`: it becomes the plugin id. Don't
do both.

```bash
git clone https://github.com/mouadja02/arkitect.git ~/.claude/skills/arkitect
```

It loads next session as `arkitect@skills-dir`; `/reload-plugins` picks it up
now.

| skill | runs |
|---|---|
| `arkitect-drawio`, `arkitect-excalidraw` | on their own, when a diagram is asked for |
| `learn-drawio-style`, `learn-excalidraw-style` | only when you type the command |
| `apply-drawio-style`, `apply-excalidraw-style` | only when you type the command |

The plugin also carries two hooks:

- `hooks/style-question.mjs`: when a prompt asks about a diagram's style, it
  adds one sentence saying a style carries over only through
  `/learn-*-style`, and sends a reply that promises to remember it back once
  (#265).
- `hooks/report-check.mjs`: after a build, it sends a report back once when it
  is missing one of its headings, or when its Render section describes a
  picture and no PNG was opened (#215).

Neither reads anything but the prompt, the last reply and, after a build, the
session's tool calls. Neither blocks a prompt.

## npm

Each release is published to npm with provenance, from 2.2.0 on.

```bash
npm install -g arkitect
arkitect doctor
arkitect excalidraw icon "postgres"
arkitect drawio build spec.json --out docs/arch.drawio
```

Or without installing anything:

```bash
npx arkitect drawio icon "snowflake"
npx arkitect excalidraw build spec.json --out docs/arch.excalidraw
```

The package carries the CLI, the six skills, every bundled icon pack and
library, the plugin manifest, the hooks and these docs (about 18 MB packed). It
does not carry the test suite, so `arkitect test` says to clone the repository.
It is a CLI and toolkit distribution: Claude Code installs the plugin through
the marketplace, not through npm.

Use a global install, not `npx`, for the agent adapters below: `install`
writes the absolute path of the package into each adapter, and `npx` runs from
a cache that can be cleared.

## Other agents

From the project you want diagrams in:

```bash
cd ~/my-project
arkitect install --all                 # every adapter
arkitect install cursor                # just one
arkitect install agents --print        # print the block, write nothing
```

Without npm, `node ~/arkitect/bin/arkitect.mjs install --all` does the same
from a clone.

| agent | writes | command |
|---|---|---|
| Codex | `AGENTS.md`, `.agents/skills/arkitect/SKILL.md` | `arkitect install codex` |
| Cursor | `.cursor/rules/arkitect.mdc`, `.cursor/commands/diagram.md` | `arkitect install cursor cursor-command` |
| OpenCode | `AGENTS.md`, `.opencode/command/diagram.md` | `arkitect install opencode agents` |
| GitHub Copilot | `.github/copilot-instructions.md` | `arkitect install copilot` |
| Antigravity | `AGENTS.md` | `arkitect install antigravity` |
| Pi | `AGENTS.md` | `arkitect install pi` |
| anything else | `AGENTS.md` | `arkitect install agents` |

Each adapter is a short block pointing at [`AGENTS.md`](../AGENTS.md), the full
contract, with the absolute path of your install. A rerun replaces the fenced
`arkitect:begin … arkitect:end` block in place and leaves the rest of the file
alone. An unknown adapter or option exits 2 before anything is written;
`arkitect install --help` lists them.

### Codex

`install codex` also writes a skill. Codex picks it when a request matches, or
run it yourself: `$arkitect draw the ingestion pipeline as excalidraw`, or pick
it from `/skills`. Its paths are absolute, so it works from any folder. For
every project on the machine, install it in your user scope:

```bash
arkitect install codex-skill --dir ~
```

A rerun leaves an existing skill alone; `--force` replaces it after an
update. Arkitect no longer ships a custom prompt; one copied into
`~/.codex/prompts` by an older version still runs as `/prompts:diagram`.

### Cursor, Copilot

Cursor's rule has `alwaysApply: false`, so it loads only when the conversation
is about diagrams. Recent Cursor and VS Code builds also read `AGENTS.md`, so
adding `agents` to either command is harmless.

### Checking it took

Ask for something small:

> Draw a three-box flow (API gateway, worker, Postgres) as Excalidraw and save
> it to `docs/smoke.excalidraw`.

A working setup builds, validates and renders the file and lists its
assumptions. Mermaid, or an apology, means the adapter is missing or points at
the wrong path.

## Clone

```bash
git clone https://github.com/mouadja02/arkitect.git
cd arkitect
node bin/arkitect.mjs doctor
node tests/run-tests.mjs               # offline; expected counts in testing.md
```

`npm link` from the clone puts `arkitect` on your `PATH`. A fresh clone skips a
few tests that need reference diagrams of your own; [testing.md](testing.md)
has the numbers to expect.

## MCP

The Draw.io MCP server is for editing existing files over pages; generation
does not need it. [apps.md](apps.md#drawio-mcp) has the per-host config and
the tools Arkitect allows.

## Update and remove

| route | update | remove |
|---|---|---|
| plugin | `claude plugin update arkitect` | `claude plugin uninstall arkitect` |
| skills folder | `git -C ~/.claude/skills/arkitect pull` | delete the folder |
| npm | `npm install -g arkitect@latest` | `npm uninstall -g arkitect` |
| adapters | `arkitect install --all --force` | delete the `arkitect:begin`…`arkitect:end` block |

Your learned style, fetched logos, built icons and installed libraries live in
`~/.arkitect/` (or `$ARKITECT_HOME`), outside every route, so no update or
removal touches them. Delete that folder to forget them. Anything cached under
`skills/*/assets/` before 2.1.0 is still read from there, and goes with the
plugin.
