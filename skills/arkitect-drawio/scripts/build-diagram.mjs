#!/usr/bin/env node
// Assemble a native, editable .drawio file from a compact JSON spec, applying
// the style tokens derived in references/style-guide.md and embedding custom
// icons from the bundled libraries so the result is portable.
//
//   node build-diagram.mjs spec.json --out diagram.drawio
//   node build-diagram.mjs spec.json --out diagram.drawio --defaults   house style only
//   node build-diagram.mjs --print-style                              what a build would use
//
// A person's own conventions, chosen with apply-style.mjs, are merged in from
// <ARKITECT_HOME>/drawio/style-overrides.json on every CLI build (#89).
// Anything that rebuilds a committed example passes --defaults, so the example
// builds the same on every machine.
//
// An existing target is never overwritten silently: a timestamped sibling
// backup is written first (see backupExisting), and once the new file is
// written the oldest and the newest five backups of it are kept (see
// pruneBackups; --keep-backups N, 0 keeps all).
//
// Placement is on a column/row grid using the observed pitch, which keeps
// generated output collision-free and readable. See the style guide's note on
// grid snapping - the reference diagrams are placed free-hand, so this is a
// deliberate normalisation, not an observed convention.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { backupExisting, pruneBackups, DEFAULT_KEEP_BACKUPS } from './lib/backups.mjs';
export { backupExisting, pruneBackups, DEFAULT_KEEP_BACKUPS } from './lib/backups.mjs';
import { resolve, recommendedSize, styleSafeDataUri, loadCatalog } from './find-icon.mjs';
import { getLogo, logoStyle, logoBox, DEFAULT_LOGO_SIZE } from './fetch-logo.mjs';
import { parseCliOrExit, exitUsage } from './lib/drawio-core.mjs';
import { engineStore } from './lib/store.mjs';
import { resolveStyle, loadStyleOrWarn, styleSummary } from './lib/style-tokens.mjs';

// ---------------------------------------------------------------- tokens

// The house style's tokens (`T`) and connector kinds (`EDGE_KINDS`) live in
// lib/style-tokens.mjs, beside the per-install override layer that can restyle
// them (#89).
export { T, EDGE_KINDS, resolveStyle, loadStyle, validateOverrides } from './lib/style-tokens.mjs';

// Icon captions render below the cell; boundaries must leave room for them.
const CAPTION_ROOM = 34;
// Height of one caption line at the body font size, for captions that wrap onto
// several lines (#45).
const CAPTION_LINE = 15;

// Node kinds the builder draws. Any other kind still draws, as a box, and is
// named in the build report so a typo cannot silently change the diagram (#48).
const NODE_KINDS = ['box', 'icon', 'aws4', 'logo', 'note', 'text'];

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Every style string the builder writes, from one resolved set of tokens and
// kinds. Literals that used to be baked in here - corner rounding, the note
// colours, the scope stroke, the edge-label size - go through named tokens now
// (#89); with the shipped tokens each string is exactly what it always was.
const stylesFor = (T, EDGE_KINDS) => ({
  icon: (uri) => `shape=image;html=1;verticalLabelPosition=bottom;verticalAlign=top;`
    + `labelBackgroundColor=none;imageAspect=0;aspect=fixed;fontSize=${T.fontBody};fontColor=${T.text};image=${uri};`,
  aws4: (resIcon, fill) => `sketch=0;points=[[0,0,0],[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0,0],[0,1,0],[0.25,1,0],[0.5,1,0],`
    + `[0.75,1,0],[1,1,0],[0,0.25,0],[0,0.5,0],[0,0.75,0],[1,0.25,0],[1,0.5,0],[1,0.75,0]];outlineConnect=0;`
    + `fontColor=${T.text};gradientColor=none;fillColor=${fill};strokeColor=#ffffff;dashed=0;`
    + `verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=${T.fontBody};fontStyle=0;`
    + `aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=${resIcon};`,
  box: `rounded=${T.rounded};whiteSpace=wrap;html=1;fillColor=none;strokeColor=${T.text};fontColor=${T.text};fontSize=${T.fontBody};`,
  note: `rounded=${T.rounded};whiteSpace=wrap;html=1;fillColor=${T.noteFill};strokeColor=${T.noteStroke};fontColor=${T.noteText};`
    + `fontSize=${T.fontBody};align=left;verticalAlign=top;spacing=6;`,
  text: (size, color, bold, align = 'center') =>
    `text;html=1;whiteSpace=wrap;align=${align};verticalAlign=middle;rounded=${T.rounded};fillColor=none;strokeColor=none;`
    + `fontSize=${size};fontColor=${color};${bold ? 'fontStyle=1;' : ''}`,
  // Copied from the reference corpus verbatim apart from grIcon/colour.
  awsGroup: (grIcon, color) => 'points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],'
    + '[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;gradientColor=none;html=1;'
    + `whiteSpace=wrap;fontSize=${T.fontBody};fontStyle=0;container=1;pointerEvents=0;collapsible=0;recursiveResize=0;`
    + `shape=mxgraph.aws4.group;grIcon=${grIcon};strokeColor=${color};fillColor=none;verticalAlign=top;align=left;`
    + `spacingLeft=30;fontColor=${color};dashed=0;`,
  scope: (color, dashed) => `rounded=${T.rounded};whiteSpace=wrap;html=1;fillColor=none;strokeColor=${color};strokeWidth=${T.scopeStrokeWidth};`
    + `${dashed ? `dashed=1;dashPattern=${T.scopeDashPattern};` : 'dashed=0;'}fontColor=${color};fontSize=${T.fontBody};`
    + 'verticalAlign=top;align=left;spacingLeft=8;spacingTop=2;container=1;collapsible=0;pointerEvents=0;',
  lane: `swimlane;html=1;whiteSpace=wrap;rounded=${T.rounded};fillColor=none;strokeColor=${T.text};fontColor=${T.text};`
    + `fontSize=${T.fontHeading};fontStyle=1;startSize=34;horizontal=1;collapsible=0;container=1;`,
  edge: (k) => {
    const e = Object.hasOwn(EDGE_KINDS, k) ? EDGE_KINDS[k] : EDGE_KINDS.flow;
    return `edgeStyle=orthogonalEdgeStyle;rounded=${T.edgeRounded};html=1;jettySize=auto;orthogonalLoop=1;`
      + `strokeColor=${e.stroke};strokeWidth=${e.width};dashed=${e.dashed};endArrow=classic;endFill=1;`;
  },
  edgeLabel: (color) => `edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;`
    + `labelBackgroundColor=${T.labelBg};fontSize=${T.fontEdgeLabel};fontColor=${color ?? T.text};`,
});

// ---------------------------------------------------------------- helpers

// Resolution never guesses. `spec.context.packs` biases the search toward the
// stack being drawn, a node's own `pack` pins it outright, and anything the
// resolver is not confident about is reported rather than silently drawn - a
// GCP diagram must not quietly receive an Azure icon.
function resolveIcon(node, catalog, report, contextPacks) {
  const query = typeof node === 'string' ? node : node.icon;
  if (!query) return null;
  const pinned = typeof node === 'object' ? node.pack ?? null : null;

  const r = resolve(query, { catalog, limit: 3, packs: contextPacks, pack: pinned });
  if (!r.groups.length) {
    report.missing.push({ query, ...(pinned ? { pack: pinned } : {}) });
    return null;
  }

  const g = r.groups[0];
  const chosen = g.variants[0];

  if (!r.confident) {
    report.ambiguous.push({
      query,
      reason: r.reason,
      chose: chosen.id,
      alternatives: r.groups.slice(0, 4).flatMap((x) => x.variants.slice(0, 2)).map((v) => v.id)
        .filter((id) => id !== chosen.id),
      fix: 'pin it with "pack": "<id>" on the node, or name the product more precisely',
    });
  }

  if (chosen.bytes === 'on-demand') {
    report.needsFetch.push({
      query, id: chosen.id, licence: chosen.licence, reason: chosen.reason, fetch: chosen.fetch,
    });
    return null;
  }

  report.used.push({ query, title: chosen.title, id: chosen.id, pack: chosen.pack });
  return chosen;
}

// ---------------------------------------------------------------- spec checks

// A spec is checked before anything is built, backed up or written (#36). A typo
// in an edge endpoint used to produce a successful build with a dangling edge.
// Every problem is collected, so one run lists them all, each naming its field.
export class SpecError extends Error {
  constructor(errors) {
    super(`invalid spec:\n  ${errors.join('\n  ')}`);
    this.name = 'SpecError';
    this.errors = errors;
  }
}

// Ids the builder writes cells under itself. Automatic edge ids (`e1`, `e2`, ...)
// are not listed: they skip any id the spec already uses instead.
const RESERVED_IDS = /^(?:0|1|title|legend|legend-[abet]\d+)$|-lbl$/;

export function validateSpec(spec) {
  const isObject = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  if (!isObject(spec)) return ['spec: expected a JSON object'];
  const errors = [];
  const show = (v) => JSON.stringify(v);
  const listOf = (key) => {
    if (spec[key] === undefined) return [];
    if (Array.isArray(spec[key])) return spec[key];
    errors.push(`${key}: expected an array`);
    return [];
  };
  const boundaries = listOf('boundaries');
  const nodes = listOf('nodes');
  const edges = listOf('edges');

  // Boundaries, nodes and named edges all become cells, so they share one id space.
  const declaredBy = new Map();
  const declare = (field, item, required) => {
    if (!isObject(item)) { errors.push(`${field}: expected an object`); return; }
    if (item.id === undefined && !required) return;
    if (typeof item.id !== 'string' || !item.id) { errors.push(`${field}.id: expected a non-empty string`); return; }
    if (RESERVED_IDS.test(item.id)) errors.push(`${field}.id: ${show(item.id)} is reserved for a cell the builder generates`);
    if (declaredBy.has(item.id)) errors.push(`${field}.id: ${show(item.id)} is already used by ${declaredBy.get(item.id)}`);
    else declaredBy.set(item.id, field);
  };
  boundaries.forEach((b, i) => declare(`boundaries[${i}]`, b, true));
  nodes.forEach((n, i) => declare(`nodes[${i}]`, n, true));
  edges.forEach((e, i) => declare(`edges[${i}]`, e, false));

  const idsOf = (list) => new Set(list.filter(isObject).map((x) => x.id).filter((id) => typeof id === 'string' && id));
  const boundaryIds = idsOf(boundaries);
  const nodeIds = idsOf(nodes);

  // Coordinates are laid out relative to a boundary, so a parent must be one.
  const checkParent = (field, item) => {
    if (item.parent === undefined || item.parent === null) return;
    if (!boundaryIds.has(item.parent)) errors.push(`${field}.parent: ${show(item.parent)} is not a boundary id`);
  };
  boundaries.forEach((b, i) => { if (isObject(b)) checkParent(`boundaries[${i}]`, b); });
  nodes.forEach((n, i) => { if (isObject(n)) checkParent(`nodes[${i}]`, n); });

  const parentOf = new Map(boundaries.filter(isObject).map((b) => [b.id, b.parent]));
  boundaries.forEach((b, i) => {
    if (!isObject(b) || !boundaryIds.has(b.id)) return;
    const chain = [b.id];
    const seen = new Set(chain);
    for (let p = parentOf.get(b.id); boundaryIds.has(p); p = parentOf.get(p)) {
      chain.push(p);
      if (p === b.id) {
        errors.push(`boundaries[${i}].parent: boundary ${show(b.id)} is nested inside itself (${chain.join(' -> ')})`);
        break;
      }
      if (seen.has(p)) break;
      seen.add(p);
    }
  });

  // Draw.io can connect an edge to a container, so a boundary is a valid end.
  edges.forEach((e, i) => {
    if (!isObject(e)) return;
    for (const end of ['from', 'to']) {
      const ref = e[end];
      if (ref === undefined || ref === null || ref === '') errors.push(`edges[${i}].${end}: missing`);
      else if (!nodeIds.has(ref) && !boundaryIds.has(ref)) errors.push(`edges[${i}].${end}: ${show(ref)} is not a node or boundary id`);
    }
  });

  return errors;
}

// ---------------------------------------------------------------- build

// `style` is what to draw with: the shipped house style unless the caller hands
// over another (resolveStyle(override) or loadStyle()). This never reads an
// install's override itself - main() does - so an example built through here is
// the same on every machine (#89).
export function buildDiagram(spec, { style = resolveStyle() } = {}) {
  const problems = validateSpec(spec);
  if (problems.length) throw new SpecError(problems);
  // The resolved tokens and kinds, under the names the drawing code has always used.
  const T = style.tokens;
  const EDGE_KINDS = style.edgeKinds;
  const STYLE = stylesFor(T, EDGE_KINDS);
  const catalog = loadCatalog();
  const report = {
    used: [], missing: [], ambiguous: [], needsFetch: [], logos: [], missingLogos: [], opaqueLogos: [], unknownKinds: [],
    style: { source: style.source, reason: style.reason, file: style.file, overridden: style.overridden, errors: style.errors },
  };
  // Packs named by the spec win ties, so a diagram declared as GCP resolves
  // "cloud run" inside GCP rather than wherever the string happens to match.
  const contextPacks = spec.context?.packs ?? null;
  const L = { originX: 80, originY: 100, colPitch: T.colPitch, rowPitch: T.rowPitch, ...(spec.layout ?? {}) };
  const cells = [];
  const push = (xml) => cells.push(xml);

  const colX = (c) => L.originX + c * L.colPitch;
  const rowY = (r) => L.originY + r * L.rowPitch;

  let pageW = 0; let pageH = 0;
  const track = (x, y, w, h) => { pageW = Math.max(pageW, x + w); pageH = Math.max(pageH, y + h); };

  if (spec.title) {
    push(`<mxCell id="title" value="${esc(spec.title)}" style="${STYLE.text(T.fontHeading, spec.titleColor ?? T.text, true, 'left')}" vertex="1" parent="1">`
      + `<mxGeometry x="${L.originX}" y="${L.originY - 70}" width="900" height="30" as="geometry" /></mxCell>`);
  }

  // A boundary spans whole grid cells. Its box runs from the left edge of its
  // first column to the right edge of its last, with room under the bottom row
  // for the icon captions that hang below their cells.
  const boundaries = spec.boundaries ?? [];
  const byBoundaryId = new Map(boundaries.map((b) => [b.id, b]));
  const boxOf = (b) => {
    const left = colX(b.col) - (b.padLeft ?? 40);
    const top = rowY(b.row) - (b.padTop ?? 55);
    const right = colX(b.col + (b.cols ?? 1) - 1) + T.iconSize + (b.padRight ?? 40);
    const bottom = rowY(b.row + (b.rows ?? 1) - 1) + T.iconSize + CAPTION_ROOM + (b.padBottom ?? 25);
    return { x: left, y: top, width: right - left, height: bottom - top };
  };
  // Origin a child's coordinates are relative to. boxOf already returns
  // absolute page coordinates, so this is the parent's own box - not a sum up
  // the chain, which would count every ancestor twice.
  const originOf = (parentId) => {
    const b = byBoundaryId.get(parentId);
    return b ? boxOf(b) : { x: 0, y: 0 };
  };

  for (const b of boundaries) {
    const abs = boxOf(b);
    const origin = originOf(b.parent);
    let style;
    if (b.kind === 'aws-cloud') style = STYLE.awsGroup('mxgraph.aws4.group_aws_cloud_alt', b.color ?? T.text);
    else if (b.kind === 'aws-group') style = STYLE.awsGroup(b.grIcon, b.color ?? T.text);
    else if (b.kind === 'lane') style = STYLE.lane;
    else style = STYLE.scope(b.color ?? T.neutralStroke, b.dashed !== false);
    push(`<mxCell id="${esc(b.id)}" value="${esc(b.label ?? '')}" style="${style}" vertex="1" parent="${esc(b.parent ?? '1')}">`
      + `<mxGeometry x="${Math.round(abs.x - origin.x)}" y="${Math.round(abs.y - origin.y)}" `
      + `width="${Math.round(abs.width)}" height="${Math.round(abs.height)}" as="geometry" /></mxCell>`);
    track(abs.x, abs.y, abs.width, abs.height);
  }

  const nodeBox = new Map();
  // Where each node landed on the page, and whether a caption hangs below it.
  const placed = new Map();
  for (const [i, n] of (spec.nodes ?? []).entries()) {
    const parent = n.parent ?? '1';
    if (n.kind != null && !NODE_KINDS.includes(n.kind)) {
      report.unknownKinds.push({ field: `nodes[${i}].kind`, value: n.kind, drawnAs: 'box', valid: NODE_KINDS });
    }
    const w = n.width ?? (n.kind === 'icon' ? T.iconSize : 190);
    const h = n.height ?? (n.kind === 'icon' ? T.iconSize : 60);
    // Shapes bigger than an icon are centred on their grid cell in both axes,
    // so a box and an icon on the same row share a centre line and connectors
    // between them run straight instead of stepping.
    const origin = originOf(parent);
    const x = colX(n.col) + (T.iconSize - w) / 2 - origin.x;
    const y = rowY(n.row) + (T.iconSize - h) / 2 - origin.y;

    let style;
    if (n.kind === 'note') style = STYLE.note;
    else if (n.kind === 'text') style = STYLE.text(n.fontSize ?? T.fontBody, n.color ?? T.text, n.bold ?? false, n.align ?? 'center');
    else if (n.kind === 'aws4') style = STYLE.aws4(n.resIcon, n.color ?? '#ED7100');
    else if (n.kind === 'icon') {
      const icon = resolveIcon(n.icon ? n : { ...n, icon: n.label }, catalog, report, contextPacks);
      if (icon) {
        const dim = recommendedSize(icon, n.width ?? T.iconSize);
        style = STYLE.icon(styleSafeDataUri(icon));
        nodeBox.set(n.id, { w: dim.width, h: dim.height });
      } else {
        style = STYLE.box;
      }
    } else if (n.kind === 'logo') {
      // Third-party product logo from the local cache (see fetch-logo.mjs).
      const entry = getLogo(n.logo ?? n.label);
      if (entry) {
        const box = logoBox(entry, n.size ?? DEFAULT_LOGO_SIZE);
        style = logoStyle(entry);
        nodeBox.set(n.id, { w: n.width ?? box.width, h: n.height ?? box.height });
        report.logos.push({ name: entry.name, transparent: entry.transparent });
        if (!entry.transparent) {
          report.opaqueLogos.push(`${entry.name} (${entry.transparencyNote}) — renders as a solid box`);
        }
      } else {
        report.missingLogos.push(n.logo ?? n.label);
        style = STYLE.box;
      }
    } else style = STYLE.box;

    const box = nodeBox.get(n.id) ?? { w, h };
    placed.set(n.id, {
      x: x + origin.x, y: y + origin.y, w: box.w, h: box.h,
      caption: Boolean(n.label) && style.includes('verticalLabelPosition=bottom'),
      lines: String(n.label ?? '').split('\n').length,
    });
    push(`<mxCell id="${esc(n.id)}" value="${esc(n.label ?? '')}" style="${style}" vertex="1" parent="${esc(parent)}">`
      + `<mxGeometry x="${Math.round(x)}" y="${Math.round(y)}" width="${box.w}" height="${box.h}" as="geometry" /></mxCell>`);
    if (parent === '1') track(x, y, box.w, box.h);
  }

  // An unknown kind draws as a plain flow. It used to crash on the edge label.
  const kindOf = (e) => (Object.hasOwn(EDGE_KINDS, e.kind ?? '') ? e.kind : 'flow');

  // A caption hangs below its icon, so an edge that leaves an icon downward, or
  // enters one from below, ran straight through it (#45). Such an edge is
  // attached below the caption instead: still connected, and it still moves
  // with the icon in the editor. Only nodes sharing a column are affected;
  // horizontal and diagonal routes stay with Draw.io's router.
  const attachment = (from, to) => {
    const a = placed.get(from);
    const b = placed.get(to);
    if (!a || !b) return '';
    const dx = (b.x + b.w / 2) - (a.x + a.w / 2);
    const dy = (b.y + b.h / 2) - (a.y + a.h / 2);
    if (Math.abs(dx) > Math.min(a.w, b.w) / 2 || Math.abs(dy) <= Math.abs(dx)) return '';
    const belowCaption = (end, node) => `${end}X=0.5;${end}Y=1;${end}Dx=0;`
      + `${end}Dy=${Math.max(CAPTION_ROOM, node.lines * CAPTION_LINE + 4)};${end}Perimeter=0;`;
    if (dy > 0 && a.caption) return belowCaption('exit', a);
    if (dy < 0 && b.caption) return belowCaption('entry', b);
    return '';
  };
  // An automatic edge id skips any id the spec already uses, so a node called
  // `e1` never shares its id with the first unnamed edge (#36).
  const taken = new Set([...boundaries, ...(spec.nodes ?? []), ...(spec.edges ?? [])].map((x) => x.id));
  let edgeSeq = 0;
  for (const [i, e] of (spec.edges ?? []).entries()) {
    if (e.kind != null && !Object.hasOwn(EDGE_KINDS, e.kind)) {
      report.unknownKinds.push({ field: `edges[${i}].kind`, value: e.kind, drawnAs: 'flow', valid: Object.keys(EDGE_KINDS) });
    }
    let id = e.id;
    while (id === undefined) {
      const next = `e${++edgeSeq}`;
      if (!taken.has(next)) id = next;
    }
    const kind = kindOf(e);
    push(`<mxCell id="${esc(id)}" style="${STYLE.edge(kind)}${attachment(e.from, e.to)}" edge="1" parent="1" `
      + `source="${esc(e.from)}" target="${esc(e.to)}"><mxGeometry relative="1" as="geometry" /></mxCell>`);
    if (e.label) {
      const color = EDGE_KINDS[kind].stroke === T.flow ? T.text : EDGE_KINDS[kind].stroke;
      push(`<mxCell id="${esc(id)}-lbl" value="${esc(e.label)}" style="${STYLE.edgeLabel(color)}" vertex="1" connectable="0" parent="${esc(id)}">`
        + `<mxGeometry x="${e.labelPos ?? -0.1}" relative="1" as="geometry"><mxPoint as="offset" /></mxGeometry></mxCell>`);
    }
  }

  // Legend: the reference corpus documents line semantics explicitly, so any
  // diagram using more than one connector kind gets one.
  const kinds = [...new Set((spec.edges ?? []).map(kindOf))];
  if (spec.legend !== false && kinds.length > 1) {
    const lx = spec.legendX ?? pageW + 120;
    const ly = spec.legendY ?? L.originY;
    push(`<mxCell id="legend" value="Legend" style="${STYLE.text(T.fontHeading, T.text, true, 'left')}" vertex="1" parent="1">`
      + `<mxGeometry x="${Math.round(lx)}" y="${Math.round(ly - 40)}" width="200" height="26" as="geometry" /></mxCell>`);
    kinds.forEach((k, i) => {
      const e = EDGE_KINDS[k] ?? EDGE_KINDS.flow;
      const y = ly + i * 40;
      push(`<mxCell id="legend-a${i}" value="" style="${STYLE.text(1, T.text, false)}" vertex="1" parent="1">`
        + `<mxGeometry x="${Math.round(lx)}" y="${Math.round(y)}" width="1" height="1" as="geometry" /></mxCell>`);
      push(`<mxCell id="legend-b${i}" value="" style="${STYLE.text(1, T.text, false)}" vertex="1" parent="1">`
        + `<mxGeometry x="${Math.round(lx + 70)}" y="${Math.round(y)}" width="1" height="1" as="geometry" /></mxCell>`);
      push(`<mxCell id="legend-e${i}" style="${STYLE.edge(k)}" edge="1" parent="1" source="legend-a${i}" target="legend-b${i}">`
        + '<mxGeometry relative="1" as="geometry" /></mxCell>');
      push(`<mxCell id="legend-t${i}" value="${esc(e.meaning)}" style="${STYLE.text(T.fontBody, T.text, false, 'left')}" vertex="1" parent="1">`
        + `<mxGeometry x="${Math.round(lx + 86)}" y="${Math.round(y - 15)}" width="230" height="30" as="geometry" /></mxCell>`);
      track(lx + 86, y - 15, 230, 30);
    });
  }

  const model = `<mxGraphModel dx="1400" dy="800" grid="0" gridSize="10" guides="1" tooltips="1" `
    + `connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="${Math.max(850, Math.round(pageW + 120))}" `
    + `pageHeight="${Math.max(1100, Math.round(pageH + 120))}" math="0" shadow="0">\n`
    + `    <root>\n      <mxCell id="0" />\n      <mxCell id="1" parent="0" />\n      `
    + cells.join('\n      ') + '\n    </root>\n  </mxGraphModel>';

  const xml = `<mxfile host="Electron" agent="arkitect-drawio" version="29.0.3">\n`
    + `  <diagram name="${esc(spec.page ?? 'Architecture')}" id="${esc(spec.pageId ?? 'generated-page-1')}">\n    `
    + model + '\n  </diagram>\n</mxfile>\n';

  return { xml, report };
}

const USAGE = 'usage: build-diagram.mjs <spec.json> --out <file.drawio> [--keep-backups N] [--defaults]\n'
  + '       build-diagram.mjs --print-style [--defaults]';

// styleSummary() says where the style came from and what it changed, and
// loadStyleOrWarn() warns once about an override it ignores; both are shared with
// Excalidraw's build, in lib/style-layer.mjs.
function main(argv) {
  const { options, positionals } = parseCliOrExit(argv, {
    values: { '--out': null, '--keep-backups': null }, switches: ['--defaults', '--print-style'],
  }, USAGE);
  if (options['print-style']) {
    if (positionals.length || options.out !== undefined || options['keep-backups'] !== undefined) {
      exitUsage('--print-style builds nothing, so it takes no spec, --out or --keep-backups', USAGE);
    }
    const style = loadStyleOrWarn(Boolean(options.defaults));
    console.log(JSON.stringify({ store: engineStore('drawio'), ...styleSummary(style, { full: true }) }, null, 2));
    return;
  }
  if (positionals.length !== 1) {
    exitUsage(positionals.length ? `expected one spec file, got ${positionals.length}` : 'expected a spec file', USAGE);
  }
  if (!options.out) exitUsage('--out <file.drawio> is required', USAGE);
  const [specPath] = positionals;
  const { out } = options;
  const keep = options['keep-backups'] ?? String(DEFAULT_KEEP_BACKUPS);
  if (!/^\d+$/.test(keep) || !Number.isSafeInteger(Number(keep))) {
    exitUsage(`--keep-backups expects how many backups to keep, a whole number (0 keeps all), got ${keep}`, USAGE);
  }

  // One line, not a stack trace: the message never quotes the spec's content.
  let spec;
  try {
    spec = JSON.parse(readFileSync(specPath, 'utf8'));
  } catch (error) {
    exitUsage(error.code === 'ENOENT' ? `no spec file at ${specPath}`
      : error instanceof SyntaxError ? `${specPath} is not valid JSON`
        : `cannot read spec ${specPath}: ${error.code ?? error.message}`);
  }
  const style = loadStyleOrWarn(Boolean(options.defaults));
  let built;
  try {
    built = buildDiagram(spec, { style });
  } catch (error) {
    if (!(error instanceof SpecError)) throw error;
    // Refused before the backup and the write, so an existing file is untouched.
    console.error(JSON.stringify({ ok: false, spec: specPath, wrote: null, errors: error.errors }, null, 2));
    process.exit(1);
  }
  const { xml, report } = built;
  const backup = backupExisting(out);
  writeFileSync(out, xml);
  // Only once the new file is written: a failed write keeps every backup (#49).
  const pruned = pruneBackups(out, { keep: Number(keep) });

  console.log(JSON.stringify({
    wrote: out, bytes: Buffer.byteLength(xml), backup, pruned,
    icons: {
      resolved: report.used.length,
      missing: report.missing,
      ambiguous: report.ambiguous,
      needsFetch: report.needsFetch,
      ...(spec.context?.packs ? { contextPacks: spec.context.packs } : {}),
    },
    logos: { embedded: report.logos.length, missing: report.missingLogos, opaqueBackground: report.opaqueLogos },
    // Drawn, but not as the spec said. Treat it like an unresolved icon: fix the
    // kind and rebuild, or say why it stays (#48).
    unknownKinds: report.unknownKinds,
    // Which style drew this: the house style, or this install's override (#89).
    style: styleSummary(style),
  }, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith('build-diagram.mjs')) main(process.argv.slice(2));
