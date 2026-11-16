# Getting started

Install first ([install.md](install.md)). Nothing needs building or
downloading: the style guides, pattern catalogs, icon packs and 36 icon
libraries are all committed.

## 1. Ask for a diagram

There's no command. Describe the system and say where the file goes:

> Draw an architecture for an event-driven order system: a web app posts to an
> API gateway, orders land on a queue, a worker validates them and writes to
> Postgres, failures go to a dead-letter queue, and a nightly job reconciles
> against the warehouse. Save it to `docs/orders.excalidraw`.

The extension picks the engine. Name none and the agent picks, and says why:

- **Draw.io** when a client, a review board or an RFC will see it, when the
  design is AWS-heavy, or when it needs several pages.
- **Excalidraw** for system design, block diagrams, flows, and anything going
  into a README.

The agent asks what it needs to (purpose, scope, the real product names, the
flows) unless the request already says, then picks a layout, resolves an icon
for every product, writes a spec, builds, validates, renders and looks at the
PNG. The report names the file, the engine, its assumptions, where each icon
came from, the validation result, what the render showed, and any deviation
from the style guide.

By hand:

```bash
arkitect excalidraw build my-spec.json --out docs/orders.excalidraw
arkitect excalidraw validate docs/orders.excalidraw
arkitect excalidraw render docs/orders.excalidraw --out-dir .analysis/renders
```

Start from a worked spec, and look at its PNG first:

| | |
|---|---|
| `skills/arkitect-excalidraw/assets/templates/starter-architecture.spec.json` | every node kind, every connector kind, a generated legend |
| `skills/arkitect-excalidraw/assets/templates/aws-data-platform.spec.json` | a real-sized answer: 43 nodes, phase regions, an error lane |
| `skills/arkitect-drawio/assets/templates/starter-architecture.spec.json` | the same tour in Draw.io |
| `skills/arkitect-drawio/assets/templates/as-is-to-be.spec.json` | two pages in one file |

The spec format is in [cli.md](cli.md#drawio-spec).

## 2. Open it

Excalidraw: start the local app and drag the file onto the canvas.

```bash
docker compose -f docker/docker-compose.yml up -d      # http://localhost:3000
```

Draw.io: open the file in Draw.io Desktop or the VS Code extension, never the
hosted editor. [apps.md](apps.md) covers both, and the MCP server for editing
existing Draw.io files.

## 3. Change it later

Ask the agent for the change and name the existing file. An Arkitect-built
diagram carries its spec, so the agent can change that and rebuild the file;
the builder backs up the existing file before replacing it.

By hand:

```bash
arkitect excalidraw spec docs/orders.excalidraw > edit.json
# edit edit.json
arkitect excalidraw build edit.json --out docs/orders.excalidraw
```

Use `drawio` and a `.drawio` file for the other engine. A rebuild reports
shapes moved, restyled or added in an editor and keeps their backup, but those
editor changes are not part of the carried spec. [cli.md](cli.md#excalidraw)
has the complete editing behaviour for both engines.

## 4. Put it in a README

GitHub does not display `.drawio` or `.excalidraw` files directly. Render an
embedded SVG, then link the image from the README:

```bash
arkitect excalidraw render docs/orders.excalidraw --embed --format svg --out-dir docs
```

In the README, use standard Markdown image syntax with
`docs/orders.excalidraw.svg` as the image target. GitHub shows the picture,
while Draw.io or Excalidraw can open that same SVG back as the editable source.
Re-render it after the next build. The
[rendering reference](cli.md#rendering) covers both engines and multi-page
Draw.io files.

## 5. Get the icons right

6,012 marks ship with Arkitect: 4,850 across 18 Draw.io packs, AWS, Azure and
Google Cloud among them, and 1,162 items across 36 Excalidraw libraries.
Search before reaching for anything else:

```bash
arkitect drawio icon "snowflake"
arkitect excalidraw icon "postgres"
```

When nothing matches, there are three honest answers: a placeholder (the
default), a fetched logo, or an icon built from one. Another product's mark is
never one of them. [icons.md](icons.md).

## 6. Make the style yours

What ships is a house style with the evidence for each rule. Teach Arkitect
yours from diagrams you've already drawn:

```
/learn-excalidraw-style

Learn the style from these:
  C:\path\to\first.excalidraw
  C:\path\to\second.excalidraw
```

Learning records evidence and changes nothing. `/apply-excalidraw-style` (or
the Draw.io one) then offers each place your diagrams disagree with the house
style, one at a time, and later builds draw with what you accept. Your record
and choices live in `~/.arkitect/`, so an update keeps them. The four style
commands only run when you type them. [style.md](style.md).

### The local source list

`.analysis/sources.local.json` (gitignored) lists reference diagrams for a
clone's own tests and for rebuilding the shipped house style. With it present,
the tests that read a corpus run instead of skipping:

```json
{
  "drawio":     ["/absolute/path/to/first.drawio"],
  "excalidraw": ["/absolute/path/to/first.excalidraw"]
}
```
