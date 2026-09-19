#!/usr/bin/env node
// Assemble a native, editable .excalidraw scene from a compact JSON spec.
//
//   node build-diagram.mjs spec.json --out architecture.excalidraw
//
// The spec is a column/row grid: nodes name a column and a row, boundaries wrap
// whatever sits inside them, and arrows are bound to real elements so dragging a
// box in the app keeps the wiring. Everything the generator emits uses
// Excalidraw's own vocabulary - default palette, its four font sizes, its three
// stroke widths, real frames, real bound labels - so the result is a scene
// somebody could plausibly have drawn by hand, not an import.
//
// An existing target is never overwritten silently; a timestamped sibling
// backup is written first.
//
// The style is this install's (#90): the shipped tokens in lib/style-tokens.mjs,
// with the person's own override merged in by the CLI. buildDiagram() never
// reads the override itself.
//
//   node build-diagram.mjs spec.json --out a.excalidraw --defaults   the house style, ignoring the override
//   node build-diagram.mjs --print-style                             what a build would use

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  emptyScene, writeScene, backupExisting, pruneBackups, DEFAULT_KEEP_BACKUPS, reindex,
  rectangle, ellipse, diamond, line, arrow, text, frame, image as imageEl,
  bindLabel, bindArrow, cloneElements, bbox, elementBox, translate, scaleElements,
  addFile, newId, newSeed, measureText, wrapText,
  PALETTE, CANVAS_BG, FONT, FONT_FAMILY, STROKE_WIDTH, ROUGHNESS, ROUND, EDGE_POINT,
  normalizeName, parseCliOrExit, exitUsage, readProblem, withSeed, parseSeed,
} from './lib/excalidraw-core.mjs';
import { resolveIcon } from './find-icon.mjs';
import { connectorCrossings } from './validate-excalidraw.mjs';
import { engineStore } from '../../arkitect-drawio/scripts/lib/store.mjs';
import {
  numberProblems, defaulted, gridProblems, nonFiniteBoxes,
  FINITE, POSITIVE, NON_NEGATIVE, SPAN,
} from '../../arkitect-drawio/scripts/lib/spec-numbers.mjs';
import { HOUSE_ACCENTS, resolveStyle, loadStyleOrWarn, styleSummary } from './lib/style-tokens.mjs';

// ---------------------------------------------------------------- style

// STYLE, HOUSE_ACCENTS and the connector kinds live in lib/style-tokens.mjs,
// with the rules an override must meet.
export { STYLE, T, HOUSE_ACCENTS, EDGE_KINDS, resolveStyle, loadStyle, validateOverrides } from './lib/style-tokens.mjs';

// Node kinds the builder draws. Any other kind still draws, as a plain
// rectangle, and is named in the build report so a typo cannot silently change
// the diagram (#48).
export const NODE_KINDS = ['box', 'round', 'ellipse', 'diamond', 'cylinder', 'actor', 'note', 'text', 'icon', 'placeholder'];

function accentOf(name) {
  if (!name) return { stroke: PALETTE.black.stroke, bg: 'transparent' };
  if (typeof name === 'object') return { stroke: name.stroke ?? PALETTE.black.stroke, bg: name.bg ?? 'transparent' };
  if (PALETTE[name]) return PALETTE[name];
  if (HOUSE_ACCENTS[name]) return HOUSE_ACCENTS[name];
  if (/^#[0-9a-fA-F]{6}$/.test(name)) return { stroke: name, bg: 'transparent' };
  return { stroke: PALETTE.black.stroke, bg: 'transparent' };
}

// ---------------------------------------------------------------- geometry

function anchorOn(box, towards, gap) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = towards.x - cx;
  const dy = towards.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const halfW = box.width / 2 + gap;
  const halfH = box.height / 2 + gap;
  const scale = Math.min(
    Math.abs(dx) > 1e-6 ? halfW / Math.abs(dx) : Infinity,
    Math.abs(dy) > 1e-6 ? halfH / Math.abs(dy) : Infinity,
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

// The point half way along a polyline by length, and the direction of the
// segment it lands on. Taking the middle vertex instead puts an edge caption at
// the end of the first leg, which on an L-shaped route is up against the source.
function polylineMidpoint(pts) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    seg.push(len);
    total += len;
  }
  if (!total) return { x: pts[0].x, y: pts[0].y, horizontal: true };
  let walked = 0;
  for (let i = 0; i < seg.length; i++) {
    if (walked + seg[i] >= total / 2) {
      const t = seg[i] ? (total / 2 - walked) / seg[i] : 0;
      const a = pts[i];
      const b = pts[i + 1];
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        horizontal: Math.abs(b.x - a.x) >= Math.abs(b.y - a.y),
      };
    }
    walked += seg[i];
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y, horizontal: true };
}

// Which edge of each shape an elbow arrow should leave from and arrive at,
// as the normalised [u, v] pair Excalidraw stores on the binding.
function edgePointsBetween(a, b) {
  const dx = (b.x + b.width / 2) - (a.x + a.width / 2);
  const dy = (b.y + b.height / 2) - (a.y + a.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? [EDGE_POINT.right, EDGE_POINT.left]
      : [EDGE_POINT.left, EDGE_POINT.right];
  }
  return dy >= 0
    ? [EDGE_POINT.bottom, EDGE_POINT.top]
    : [EDGE_POINT.top, EDGE_POINT.bottom];
}

// Straight when the two shapes share a centre line, elbowed otherwise. An
// architecture reads better with square corners; a diagonal across three
// columns reads as noise.
function routePoints(a, b, mode, gap) {
  const ca = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const cb = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const alignedY = Math.abs(ca.y - cb.y) < 12;
  const alignedX = Math.abs(ca.x - cb.x) < 12;
  const effective = mode === 'auto' || !mode
    ? (alignedX || alignedY ? 'straight' : 'elbow')
    : mode;

  if (effective === 'straight') {
    return [anchorOn(a, cb, gap), anchorOn(b, ca, gap)];
  }

  const horizontalFirst = Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y);
  if (horizontalFirst) {
    const midX = (ca.x + cb.x) / 2;
    const start = anchorOn(a, { x: cb.x, y: ca.y }, gap);
    const end = anchorOn(b, { x: ca.x, y: cb.y }, gap);
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  }
  const midY = (ca.y + cb.y) / 2;
  const start = anchorOn(a, { x: ca.x, y: cb.y }, gap);
  const end = anchorOn(b, { x: cb.x, y: ca.y }, gap);
  return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
}

// ---------------------------------------------------------------- node shapes

// An empty slot where a product's mark should go, for a component no bundled
// library covers. Deliberately loud: a dotted violet square with a "?" in it,
// grouped so it can be selected and deleted in one click once the real icon has
// been dropped on top. Borrowing a different product's mark instead, or quietly
// drawing a grey box, is how a wrong diagram gets shipped.
export const PLACEHOLDER = { stroke: '#6741d9', bg: '#f3f0ff' };

export function iconPlaceholder(x, y, size = 100) {
  const group = newId();
  const r = rectangle({
    x, y, width: size, height: size,
    strokeColor: PLACEHOLDER.stroke,
    backgroundColor: PLACEHOLDER.bg,
    fillStyle: 'solid',
    strokeWidth: STROKE_WIDTH.bold,
    strokeStyle: 'dotted',
    roughness: ROUGHNESS.artist,
    roundness: ROUND,
    groupIds: [group],
  });
  const mark = '?';
  const fontSize = Math.round(size * 0.42);
  const m = measureText(mark, fontSize, FONT_FAMILY.hand);
  const q = text({
    text: mark, fontSize, fontFamily: FONT_FAMILY.hand, textAlign: 'center',
    strokeColor: PLACEHOLDER.stroke,
    width: m.width, height: m.height,
    x: Math.round(x + (size - m.width) / 2),
    y: Math.round(y + (size - m.height) / 2),
    groupIds: [group],
  });
  return { elements: [r, q], anchor: r, group };
}

// ---------------------------------------------------------------- shapes

// Excalidraw has no cylinder primitive and cannot clip, so a stack of rectangle
// and ellipses leaves the back half of the bottom ellipse drawn across the body.
// The silhouette is traced as one closed polygon instead, with the lid on top.
function cylinder(x, y, w, h, look) {
  const capH = Math.min(h * 0.28, 34);
  const group = newId();
  const common = {
    strokeColor: look.stroke, backgroundColor: look.bg, fillStyle: look.fillStyle,
    strokeWidth: look.strokeWidth, roughness: look.roughness, groupIds: [group],
  };

  const arc = (cx, cy, rx, ry, from, to, steps = 14) => {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = from + ((to - from) * i) / steps;
      pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
    }
    return pts;
  };

  const rx = w / 2;
  const ry = capH / 2;
  // Left side down, bottom arc bulging down, right side up, top arc bulging up
  // back to the start. Each arc already begins on the previous point, so its
  // first sample is dropped.
  const silhouette = [
    [0, ry],
    [0, h - ry],
    ...arc(rx, h - ry, rx, ry, Math.PI, 0).slice(1),
    [w, ry],
    ...arc(rx, ry, rx, ry, 0, -Math.PI).slice(1),
  ];
  const body = line({ ...common, x, y, points: silhouette });
  const lid = ellipse({ ...common, x, y, width: w, height: capH });
  return { elements: [body, lid], labelHost: lid, group };
}

function actor(x, y, w, h, look) {
  const group = newId();
  const headR = Math.min(w, h) * 0.3;
  const common = {
    strokeColor: look.stroke, backgroundColor: look.bg, fillStyle: look.fillStyle,
    strokeWidth: look.strokeWidth, roughness: look.roughness, groupIds: [group],
  };
  const cx = x + w / 2;
  const head = ellipse({ ...common, x: cx - headR / 2, y, width: headR, height: headR });
  const spine = line({ ...common, backgroundColor: 'transparent', x: cx, y: y + headR, points: [[0, 0], [0, h * 0.4]] });
  const arms = line({ ...common, backgroundColor: 'transparent', x: cx - w * 0.28, y: y + headR + h * 0.12, points: [[0, 0], [w * 0.56, 0]] });
  const legs = line({
    ...common, backgroundColor: 'transparent',
    x: cx - w * 0.24, y: y + headR + h * 0.4,
    points: [[w * 0.24, -h * 0.02], [0, h * 0.3], [w * 0.24, -h * 0.02], [w * 0.48, h * 0.3]],
  });
  return { elements: [head, spine, arms, legs], labelHost: null, group };
}

// ---------------------------------------------------------------- spec checks

// A spec is checked before anything is built, backed up or written (#36). A typo
// in an edge endpoint used to drop the connection and still produce a scene that
// validated. Every problem is collected, so one run lists them all, each naming
// its field.
export class SpecError extends Error {
  constructor(errors) {
    super(`invalid spec:\n  ${errors.join('\n  ')}`);
    this.name = 'SpecError';
    this.errors = errors;
  }
}

// Coordinates may be fractional or negative; sizes, spans and pitches may not.
const LAYOUT_NUMBERS = { originX: FINITE, originY: FINITE, colPitch: POSITIVE, rowPitch: POSITIVE, cell: POSITIVE };
const STYLE_NUMBERS = {
  ...LAYOUT_NUMBERS, nodeWidth: POSITIVE, nodeHeight: POSITIVE, iconSize: POSITIVE,
  captionSize: POSITIVE, captionGap: NON_NEGATIVE, fontFamily: POSITIVE, bodyFontFamily: POSITIVE,
  strokeWidth: POSITIVE, edgeStrokeWidth: POSITIVE, boundaryStrokeWidth: POSITIVE, roughness: NON_NEGATIVE,
};
const BOUNDARY_NUMBERS = {
  col: FINITE, row: FINITE, cols: SPAN, rows: SPAN,
  padLeft: NON_NEGATIVE, padTop: NON_NEGATIVE, padRight: NON_NEGATIVE, padBottom: NON_NEGATIVE,
  fontSize: POSITIVE, strokeWidth: POSITIVE, roughness: NON_NEGATIVE,
};
const NODE_NUMBERS = {
  col: FINITE, row: FINITE, width: POSITIVE, height: POSITIVE, size: POSITIVE,
  fontSize: POSITIVE, fontFamily: POSITIVE, strokeWidth: POSITIVE, roughness: NON_NEGATIVE,
};
const EDGE_NUMBERS = { gap: NON_NEGATIVE, labelSize: POSITIVE, strokeWidth: POSITIVE, roughness: NON_NEGATIVE };

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

  // One id space: an edge or a parent naming an id must mean exactly one thing.
  const declaredBy = new Map();
  const declare = (field, item) => {
    if (!isObject(item)) { errors.push(`${field}: expected an object`); return; }
    if (typeof item.id !== 'string' || !item.id) { errors.push(`${field}.id: expected a non-empty string`); return; }
    if (declaredBy.has(item.id)) errors.push(`${field}.id: ${show(item.id)} is already used by ${declaredBy.get(item.id)}`);
    else declaredBy.set(item.id, field);
  };
  boundaries.forEach((b, i) => declare(`boundaries[${i}]`, b));
  nodes.forEach((n, i) => declare(`nodes[${i}]`, n));

  const idsOf = (list) => new Set(list.filter(isObject).map((x) => x.id).filter((id) => typeof id === 'string' && id));
  const boundaryIds = idsOf(boundaries);
  const nodeIds = idsOf(nodes);

  // A boundary is sized from its children, so a parent must be a boundary.
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

  // Arrows bind to a node's shape; a boundary is not something an arrow can end on.
  edges.forEach((e, i) => {
    if (!isObject(e)) { errors.push(`edges[${i}]: expected an object`); return; }
    for (const end of ['from', 'to']) {
      const ref = e[end];
      if (ref === undefined || ref === null || ref === '') errors.push(`edges[${i}].${end}: missing`);
      else if (boundaryIds.has(ref) && !nodeIds.has(ref)) errors.push(`edges[${i}].${end}: ${show(ref)} is a boundary; Excalidraw connects nodes only`);
      else if (!nodeIds.has(ref)) errors.push(`edges[${i}].${end}: ${show(ref)} is not a node id`);
    }
  });

  // Geometry and style numbers the builder lays out with; a missing col or row
  // is 0 (#115). The style block's vocabulary is the override validator's job.
  for (const [key, rules] of [['layout', LAYOUT_NUMBERS], ['style', STYLE_NUMBERS]]) {
    if (spec[key] != null && !isObject(spec[key])) errors.push(`${key}: expected an object`);
    else if (spec[key]) errors.push(...numberProblems(key, spec[key], rules));
  }
  errors.push(...numberProblems('spec', spec, { legendX: FINITE, legendY: FINITE }));
  boundaries.forEach((b, i) => { if (isObject(b)) errors.push(...numberProblems(`boundaries[${i}]`, b, BOUNDARY_NUMBERS)); });
  nodes.forEach((n, i) => { if (isObject(n)) errors.push(...numberProblems(`nodes[${i}]`, n, NODE_NUMBERS)); });
  edges.forEach((e, i) => { if (isObject(e)) errors.push(...numberProblems(`edges[${i}]`, e, EDGE_NUMBERS)); });

  return errors;
}

// ---------------------------------------------------------------- build

// `style` is a resolved style: the house style, or this install's override
// merged into it, which only the CLI loads. A spec's own `style`, `layout` and
// per-node values still win over either.
//
// With a `seed` (#119) the same spec, style and assets build the same scene
// byte for byte; without one, ids and stroke seeds are random as before.
export function buildDiagram(spec, { style = resolveStyle(), seed = null } = {}) {
  const problems = validateSpec(spec);
  if (problems.length) throw new SpecError(problems);
  if (seed != null && parseSeed(seed) === null) {
    throw new SpecError([`seed must be a whole number from 0 to 4294967295, got ${seed}`]);
  }
  return withSeed(seed, () => assemble(spec, style));
}

function assemble(spec, style) {
  const EDGE_KINDS = style.edgeKinds;
  // defaulted, not a plain spread: an explicit null is documented as taking the
  // default, and a spread writes it over the default instead, which is how
  // style.nodeWidth: null drew a node of no width at all (#153).
  const S = { ...style.tokens, ...defaulted(spec.style) };
  const L = {
    originX: S.originX, originY: S.originY, colPitch: S.colPitch, rowPitch: S.rowPitch, cell: S.cell,
    ...defaulted(spec.layout),
  };
  const scene = emptyScene();
  scene.appState.viewBackgroundColor = CANVAS_BG[spec.canvasBackground] ?? spec.canvasBackground ?? S.canvasBackground;

  const report = {
    icons: [], missingIcons: [], opaqueIcons: [], selfCaptioned: [], notes: [], unknownKinds: [], crossings: [],
    style: { source: style.source, reason: style.reason, file: style.file, overridden: style.overridden, errors: style.errors },
  };
  const colX = (c) => L.originX + c * L.colPitch;
  const rowY = (r) => L.originY + r * L.rowPitch;

  // Finite operands, non-finite product: refused here, naming the field, rather
  // than serialized as the null JSON has to use for a number it cannot hold (#153).
  const grid = gridProblems(spec, { colX, rowY });
  if (grid.length) throw new SpecError(grid);

  const frames = [];      // real Excalidraw frames, drawn first
  const scopes = [];      // dashed group rectangles
  const nodeLayer = [];
  const edgeLayer = [];
  const chrome = [];      // title, legend

  const geom = new Map();          // node id -> box used for routing
  const anchorFor = new Map();     // node id -> element an arrow binds to
  const childrenOf = new Map();    // boundary id -> [boxes]
  const nodeOf = new Map();        // element id -> node id, to name a crossing
  const edgeOf = new Map();        // arrow id -> "from->to"
  // Who produced an element, for frame membership (#158). Every element a node,
  // a boundary or an edge draws is recorded, including the ones that fall
  // outside the box they belong to.
  const boundaryOf = new Map();    // element id -> boundary id
  const edgeEnds = new Map();      // element id -> [from node id, to node id]

  const noteChild = (parentId, box) => {
    if (!parentId) return;
    if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
    childrenOf.get(parentId).push(box);
  };

  const boundaries = spec.boundaries ?? [];
  const byBoundary = new Map(boundaries.map((b) => [b.id, b]));

  // ------------------------------------------------------------ nodes

  for (const [i, n] of (spec.nodes ?? []).entries()) {
    if (n.kind != null && !NODE_KINDS.includes(n.kind)) {
      report.unknownKinds.push({ field: `nodes[${i}].kind`, value: n.kind, drawnAs: S.rounded ? 'round' : 'box', valid: NODE_KINDS });
    }
    const look = {
      ...accentOf(n.accent),
      strokeWidth: n.strokeWidth ?? S.strokeWidth,
      roughness: n.roughness ?? S.roughness,
      fillStyle: n.fillStyle ?? S.fillStyle,
    };
    if (n.fill === false) look.bg = 'transparent';
    if (n.fill && typeof n.fill === 'string') look.bg = n.fill;

    const w = n.width ?? (n.kind === 'icon' ? (n.size ?? S.iconSize) : S.nodeWidth);
    const h = n.height ?? (n.kind === 'icon' ? (n.size ?? S.iconSize) : S.nodeHeight);
    const x = Math.round(colX(n.col ?? 0) + (L.cell - w) / 2);
    const y = Math.round(rowY(n.row ?? 0) + (L.cell - h) / 2);

    // A label bound inside a box has to fit the box, so it stays at 16. A free
    // caption under an icon has the whole gutter to itself and reads at 20 -
    // the size the reference corpus writes captions at.
    const labelOpts = {
      fontSize: n.fontSize ?? FONT.S,
      fontFamily: n.fontFamily ?? S.fontFamily,
      color: n.labelColor ?? look.stroke,
    };
    const captionOpts = { ...labelOpts, fontSize: n.fontSize ?? S.captionSize };
    const produced = [];
    let anchor = null;
    // `box` stays the shape itself, so arrows anchor on its centre line.
    // `extent` grows to cover captions, so a boundary drawn around this node
    // leaves room for them.
    let box = { x, y, width: w, height: h };
    let extent = null;
    const grow = (extraHeight) => {
      const cur = extent ?? box;
      extent = { ...cur, height: cur.height + extraHeight };
    };
    const bottom = () => { const cur = extent ?? box; return cur.y + cur.height; };

    if (n.kind === 'icon' || n.kind === 'placeholder') {
      const resolved = n.kind === 'placeholder' ? null : resolveIcon(n.icon ?? n.label);
      if (!resolved) {
        report.missingIcons.push(n.icon ?? n.label);
        // A slot to be filled in by hand, not a stand-in for the real mark. It
        // has to be impossible to mistake for a finished node, so a plain box
        // in the node's own colour is the wrong answer. Nothing else in the
        // vocabulary is a dotted violet square with a question mark in it.
        const slot = iconPlaceholder(x, y, n.size ?? S.iconSize);
        produced.push(...slot.elements);
        anchor = slot.anchor;
        box = bbox(slot.elements);
      } else if (resolved.kind === 'embedded') {
        const e = resolved.entry;
        const fileId = addFile(scene, e.mime, e.bytes);
        const longest = n.size ?? S.iconSize;
        const scaleF = longest / Math.max(e.width || longest, e.height || longest);
        const iw = Math.round((e.width || longest) * scaleF);
        const ih = Math.round((e.height || longest) * scaleF);
        const img = imageEl({ fileId, x: Math.round(colX(n.col ?? 0) + (L.cell - iw) / 2), y, width: iw, height: ih });
        produced.push(img);
        anchor = img;
        box = elementBox(img);
        report.icons.push({ node: n.id, ref: resolved.source, kind: 'embedded',
          ...(resolved.provenance ? { provenance: resolved.provenance } : {}) });
        if (e.transparent === false) report.opaqueIcons.push(`${resolved.source} (${e.transparencyNote})`);
      } else {
        const group = newId();
        const clone = cloneElements(resolved.elements, { groupId: group });
        const src = bbox(clone);
        const longest = n.size ?? S.iconSize;
        if (src.width > 0 && src.height > 0) {
          scaleElements(clone, longest / Math.max(src.width, src.height), src.x, src.y);
        }
        const after = bbox(clone);
        translate(clone, colX(n.col ?? 0) + (L.cell - after.width) / 2 - after.x, y - after.y);
        produced.push(...clone);
        box = bbox(clone);
        // An arrow binds to one element; the largest piece of the mark is the
        // most stable target when the group is dragged.
        anchor = clone.reduce((best, el) => {
          const b = elementBox(el);
          const bb = elementBox(best);
          return b.width * b.height > bb.width * bb.height ? el : best;
        }, clone[0]);
        report.icons.push({ node: n.id, ref: resolved.source, kind: resolved.kind, elements: clone.length });
      }

      // Every icon and every placeholder gets its caption underneath. A
      // placeholder needs it most of all: the caption is what says which
      // product's mark belongs in the empty slot.
      //
      // Except when the library item already carries its own name as text -
      // most of the bundled AWS, Azure and data-platform marks do - in which
      // case adding ours prints the product name twice, one under the other.
      const ownCaption = n.label && produced.some((el) => el.type === 'text' && el.text
        && normalizeName(el.text) === normalizeName(n.label));
      if (ownCaption) report.selfCaptioned.push(n.id ?? n.label);
      if (n.label && !ownCaption) {
        const m = measureText(n.label, captionOpts.fontSize, captionOpts.fontFamily);
        produced.push(text({
          text: n.label,
          fontSize: captionOpts.fontSize,
          fontFamily: captionOpts.fontFamily,
          textAlign: 'center',
          strokeColor: resolved ? captionOpts.color : PLACEHOLDER.stroke,
          width: m.width,
          height: m.height,
          x: Math.round(box.x + (box.width - m.width) / 2),
          y: Math.round(bottom() + S.captionGap),
        }));
        grow(S.captionGap + m.height);
      }
    } else if (n.kind === 'text') {
      const t = text({
        text: n.label ?? '',
        fontSize: n.fontSize ?? FONT.M,
        fontFamily: n.fontFamily ?? S.fontFamily,
        textAlign: n.align ?? 'left',
        strokeColor: n.labelColor ?? look.stroke,
        x, y,
      });
      produced.push(t);
      anchor = t;
      box = elementBox(t);
    } else if (n.kind === 'note') {
      const look2 = { ...accentOf(n.accent ?? 'orange') };
      const wrapped = wrapText(n.label ?? '', w - 24, FONT.S, S.fontFamily);
      const m = measureText(wrapped, FONT.S, S.fontFamily);
      const height = n.height ?? Math.max(h, m.height + 28);
      const r = rectangle({
        x, y, width: w, height,
        strokeColor: look2.stroke, backgroundColor: n.fill ?? look2.bg, fillStyle: 'solid',
        strokeWidth: STROKE_WIDTH.thin, roughness: n.roughness ?? S.roughness,
        roundness: S.rounded ? ROUND : null,
      });
      produced.push(r, bindLabel(r, wrapped, { ...labelOpts, color: PALETTE.black.stroke, verticalAlign: 'top', textAlign: 'left', padding: 12 }));
      anchor = r;
      box = elementBox(r);
    } else if (n.kind === 'cylinder') {
      const c = cylinder(x, y, w, h, look);
      produced.push(...c.elements);
      anchor = c.elements[0];
      box = bbox(c.elements);
      if (n.label) {
        const m = measureText(n.label, captionOpts.fontSize, captionOpts.fontFamily);
        produced.push(text({
          text: n.label, fontSize: captionOpts.fontSize, fontFamily: captionOpts.fontFamily,
          textAlign: 'center', strokeColor: captionOpts.color,
          width: m.width, height: m.height,
          x: Math.round(box.x + (box.width - m.width) / 2),
          y: Math.round(bottom() + S.captionGap),
          groupIds: [c.group],
        }));
        grow(S.captionGap + m.height);
      }
    } else if (n.kind === 'actor') {
      const a = actor(x, y, w, h, look);
      produced.push(...a.elements);
      anchor = a.elements[0];
      box = bbox(a.elements);
      if (n.label) {
        const m = measureText(n.label, captionOpts.fontSize, captionOpts.fontFamily);
        produced.push(text({
          text: n.label, fontSize: captionOpts.fontSize, fontFamily: captionOpts.fontFamily,
          textAlign: 'center', strokeColor: captionOpts.color,
          width: m.width, height: m.height,
          x: Math.round(box.x + (box.width - m.width) / 2),
          y: Math.round(bottom() + S.captionGap),
          groupIds: [a.group],
        }));
        grow(S.captionGap + m.height);
      }
    } else {
      const make = n.kind === 'ellipse' ? ellipse : n.kind === 'diamond' ? diamond : rectangle;
      const shape = make({
        x, y, width: w, height: h,
        strokeColor: look.stroke, backgroundColor: look.bg, fillStyle: look.fillStyle,
        strokeWidth: look.strokeWidth, roughness: look.roughness,
        strokeStyle: n.strokeStyle ?? 'solid',
        roundness: n.kind === 'box' ? null : (n.kind === 'round' || S.rounded) && n.kind !== 'diamond' && n.kind !== 'ellipse' ? ROUND : null,
      });
      produced.push(shape);
      if (n.label) produced.push(bindLabel(shape, n.label, labelOpts));
      anchor = shape;
      box = elementBox(shape);
    }

    if (n.sublabel) {
      const m = measureText(n.sublabel, FONT.S, S.fontFamily);
      produced.push(text({
        text: n.sublabel, fontSize: FONT.S, fontFamily: S.fontFamily,
        textAlign: 'center', strokeColor: PALETTE.grey.stroke,
        width: m.width, height: m.height,
        x: Math.round(box.x + (box.width - m.width) / 2),
        y: Math.round(bottom() + 4),
      }));
      grow(4 + m.height);
    }

    for (const el of produced) nodeOf.set(el.id, n.id);
    geom.set(n.id, box);
    if (anchor) anchorFor.set(n.id, anchor);
    noteChild(n.parent, extent ?? box);
    nodeLayer.push(...produced);
  }

  // ------------------------------------------------------------ boundaries
  //
  // A boundary is sized from what it actually contains, not from the grid, so a
  // wide box or a tall caption cannot poke out of its own scope.

  const boundaryBox = new Map();
  const resolveBoundary = (b, seen = new Set()) => {
    if (boundaryBox.has(b.id)) return boundaryBox.get(b.id);
    if (seen.has(b.id)) throw new Error(`boundary "${b.id}" is nested inside itself`);
    seen.add(b.id);
    const kids = [...(childrenOf.get(b.id) ?? [])];
    for (const other of boundaries) {
      if (other.parent === b.id) kids.push(resolveBoundary(other, seen));
    }
    const pad = {
      left: b.padLeft ?? 34, right: b.padRight ?? 34,
      top: b.padTop ?? 46, bottom: b.padBottom ?? 30,
    };
    let box;
    if (kids.length) {
      const u = bbox(kids.map((k) => ({ ...k, isDeleted: false, type: 'rectangle' })));
      box = {
        x: Math.round(u.x - pad.left), y: Math.round(u.y - pad.top),
        width: Math.round(u.width + pad.left + pad.right), height: Math.round(u.height + pad.top + pad.bottom),
      };
    } else {
      const left = colX(b.col ?? 0) - pad.left;
      const top = rowY(b.row ?? 0) - pad.top;
      box = {
        x: Math.round(left), y: Math.round(top),
        width: Math.round(colX((b.col ?? 0) + (b.cols ?? 1) - 1) + L.cell + pad.right - left),
        height: Math.round(rowY((b.row ?? 0) + (b.rows ?? 1) - 1) + L.cell + pad.bottom - top),
      };
    }
    boundaryBox.set(b.id, box);
    return box;
  };

  const frameIdFor = new Map();
  for (const b of boundaries) {
    const drawnScopes = scopes.length;
    const box = resolveBoundary(b);
    const look = accentOf(b.color ?? b.accent ?? 'grey');
    if (b.kind === 'frame') {
      const fr = frame({ name: b.label ?? null, x: box.x, y: box.y, width: box.width, height: box.height });
      frames.push(fr);
      frameIdFor.set(b.id, fr.id);
      continue;
    }
    const group = newId();
    const r = rectangle({
      x: box.x, y: box.y, width: box.width, height: box.height,
      strokeColor: look.stroke,
      backgroundColor: b.fill ?? 'transparent',
      fillStyle: 'solid',
      strokeWidth: b.strokeWidth ?? S.boundaryStrokeWidth,
      strokeStyle: b.dashed === false ? 'solid' : (b.strokeStyle ?? S.boundaryStroke),
      roughness: b.roughness ?? S.roughness,
      roundness: S.rounded ? ROUND : null,
      groupIds: [group],
    });
    scopes.push(r);
    if (b.label) {
      // Two placements, both from the corpus. `inside` tucks a small caption
      // into the top-left corner; `outside` sets a large coloured word clear of
      // the box, the way a CI or CD region gets named. Either way it is free
      // text - a bound label would centre itself over the contents.
      //
      // An outside label goes *above* the top-left corner rather than beside
      // the box. Beside is what the corpus does, but only because the space
      // there happened to be empty; above the top edge is the one strip that
      // is empty by construction, since boundaries are sized from contents.
      const outside = (b.labelPlacement ?? 'inside') === 'outside';
      const size = b.fontSize ?? (outside ? 48 : FONT.M);
      const m = measureText(b.label, size, S.fontFamily);
      scopes.push(text({
        text: b.label, fontSize: size, fontFamily: S.fontFamily,
        textAlign: 'left', strokeColor: look.stroke,
        width: m.width, height: m.height,
        x: Math.round(box.x + (outside ? 0 : 14)),
        y: Math.round(outside ? box.y - m.height - 10 : box.y + 12),
        groupIds: [group],
      }));
    }
    for (const el of scopes.slice(drawnScopes)) boundaryOf.set(el.id, b.id);
  }

  // ------------------------------------------------------------ edges

  const usedKinds = new Set();
  for (const [i, e] of (spec.edges ?? []).entries()) {
    const from = geom.get(e.from);
    const to = geom.get(e.to);
    // validateSpec has already refused an endpoint that is not a node, so a miss
    // here is a builder bug. Skipping the edge would hide it in a valid scene.
    if (!from || !to) throw new Error(`edge ${e.from} -> ${e.to}: a declared node has no geometry`);
    // Own properties only: `constructor` is Object's, not a connector kind, and
    // used to draw an arrow with no stroke at all (#48).
    const kind = Object.hasOwn(EDGE_KINDS, e.kind ?? 'flow') ? (e.kind ?? 'flow') : 'flow';
    if (kind !== (e.kind ?? 'flow')) {
      report.unknownKinds.push({ field: `edges[${i}].kind`, value: e.kind, drawnAs: 'flow', valid: Object.keys(EDGE_KINDS) });
    }
    usedKinds.add(kind);
    const k = EDGE_KINDS[kind];
    const gap = e.gap ?? 8;
    const pts = routePoints(from, to, e.route ?? 'auto', gap);
    const ox = pts[0].x;
    const oy = pts[0].y;

    // An elbow arrow hands routing to the app, which keeps the corners square
    // when a box moves. It only works on a bound arrow: without a shape at each
    // end there is nothing to route between, so fall back to fixed points.
    const startAnchor = anchorFor.get(e.from);
    const endAnchor = anchorFor.get(e.to);
    const routing = e.routing ?? S.edgeRouting;
    const elbowed = routing === 'elbow' && !!startAnchor && !!endAnchor
      && (e.route ?? 'auto') !== 'straight';

    const a = arrow({
      x: Math.round(ox),
      y: Math.round(oy),
      points: pts.map((p) => [Math.round(p.x - ox), Math.round(p.y - oy)]),
      strokeColor: e.color ?? k.color,
      strokeWidth: e.strokeWidth ?? k.width,
      strokeStyle: e.strokeStyle ?? k.strokeStyle,
      roughness: e.roughness ?? style.tokens.roughness,
      endArrowhead: e.endArrowhead === null ? null : (e.endArrowhead ?? 'arrow'),
      startArrowhead: e.startArrowhead ?? null,
      elbowed,
    });
    bindArrow(a, startAnchor, endAnchor, {
      gap,
      fixedPoints: elbowed ? edgePointsBetween(from, to) : null,
    });
    edgeLayer.push(a);
    edgeOf.set(a.id, `${e.from}->${e.to}`);
    edgeEnds.set(a.id, [e.from, e.to]);

    if (e.label) {
      // Free text alongside the line, not a bound label: that is what the
      // corpus does, and an elbow arrow will not carry a bound label at all.
      const bound = e.labelBound ?? (S.edgeLabelBound && !elbowed);
      const size = e.labelSize ?? FONT.S;
      const m = measureText(e.label, size, S.fontFamily);
      const mid = polylineMidpoint(pts);
      // Sit above a horizontal run, beside a vertical one, so the line stays
      // unbroken instead of being knocked out by the text.
      const t = text({
        text: e.label, fontSize: size, fontFamily: S.fontFamily,
        textAlign: 'center', verticalAlign: 'middle',
        strokeColor: e.labelColor ?? k.color,
        containerId: bound ? a.id : null,
        width: m.width, height: m.height,
        x: Math.round(mid.x - m.width / 2 + (bound || mid.horizontal ? 0 : m.width / 2 + 14)),
        y: Math.round(mid.y - m.height / 2 - (bound || !mid.horizontal ? 0 : m.height / 2 + 10)),
      });
      if (bound) a.boundElements = [...(a.boundElements ?? []), { id: t.id, type: 'text' }];
      edgeLayer.push(t);
      edgeEnds.set(t.id, [e.from, e.to]);
    }
  }

  // ------------------------------------------------------------ chrome

  const contentBox = bbox([...frames, ...scopes, ...nodeLayer, ...edgeLayer]);

  if (spec.title) {
    const m = measureText(spec.title, FONT.L, S.fontFamily);
    chrome.push(text({
      text: spec.title, fontSize: FONT.L, fontFamily: S.fontFamily,
      textAlign: 'left', strokeColor: PALETTE.black.stroke,
      width: m.width, height: m.height,
      x: Math.round(contentBox.x), y: Math.round(contentBox.y - m.height - 34),
    }));
  }

  if (spec.legend !== false && usedKinds.size > 1) {
    const lx = Math.round(spec.legendX ?? contentBox.x + contentBox.width + 90);
    const ly = Math.round(spec.legendY ?? contentBox.y);
    const group = newId();
    const title = measureText('Legend', FONT.M, S.fontFamily);
    chrome.push(text({
      text: 'Legend', fontSize: FONT.M, fontFamily: S.fontFamily, textAlign: 'left',
      strokeColor: PALETTE.black.stroke, width: title.width, height: title.height,
      x: lx, y: ly, groupIds: [group],
    }));
    [...usedKinds].forEach((kind, i) => {
      const k = EDGE_KINDS[kind];
      const y = ly + 44 + i * 40;
      chrome.push(arrow({
        x: lx, y,
        points: [[0, 0], [70, 0]],
        strokeColor: k.color, strokeWidth: k.width, strokeStyle: k.strokeStyle,
        roughness: S.roughness, groupIds: [group],
      }));
      const m = measureText(k.meaning, FONT.S, S.fontFamily);
      chrome.push(text({
        text: k.meaning, fontSize: FONT.S, fontFamily: S.fontFamily, textAlign: 'left',
        strokeColor: PALETTE.black.stroke, width: m.width, height: m.height,
        x: lx + 86, y: Math.round(y - m.height / 2), groupIds: [group],
      }));
    });
  }

  // Frame membership follows ownership, not geometry. It used to be inferred by
  // testing whether an element fitted inside its node's routing box, so a free
  // icon caption or a sublabel - which sit outside that box by construction -
  // lost the frame their node's parent declared, while an unrelated node that
  // merely overlapped the box could gain one (#158).
  if (frameIdFor.size) {
    const parentOfBoundary = new Map(boundaries.map((b) => [b.id, b.parent]));
    // The nearest frame at or above a boundary. A scope nested in a frame is a
    // member of it, or dragging the frame would leave the scope's own box and
    // caption behind. validateSpec refuses a boundary cycle; the seen set only
    // keeps a malformed call from spinning.
    const frameAbove = (id) => {
      const seen = new Set();
      for (let at = id; at !== undefined && at !== null && !seen.has(at); at = parentOfBoundary.get(at)) {
        seen.add(at);
        if (frameIdFor.has(at)) return frameIdFor.get(at);
      }
      return null;
    };

    // Excalidraw has no nested frames. The inner one is still drawn and still
    // owns what is parented to it; it is simply not a member of the outer one.
    for (const b of boundaries) {
      if (b.kind !== 'frame') continue;
      const outer = frameAbove(b.parent);
      if (outer) {
        report.notes.push(`boundary "${b.id}" is a frame inside a frame, which Excalidraw does not support; `
          + 'its contents are members of it and it is not a member of the outer frame');
      }
    }

    const frameOfNode = new Map((spec.nodes ?? []).map((n) => [n.id, frameAbove(n.parent)]));
    for (const el of [...scopes, ...nodeLayer, ...edgeLayer]) {
      if (nodeOf.has(el.id)) {
        const fid = frameOfNode.get(nodeOf.get(el.id));
        if (fid) el.frameId = fid;
      } else if (boundaryOf.has(el.id)) {
        const fid = frameAbove(boundaryOf.get(el.id));
        if (fid) el.frameId = fid;
      } else if (edgeEnds.has(el.id)) {
        // An edge that leaves the frame is not part of it: dragging the frame
        // would pull one end away from the shape it is bound to.
        const [from, to] = edgeEnds.get(el.id);
        const fid = frameOfNode.get(from);
        if (fid && fid === frameOfNode.get(to)) el.frameId = fid;
      }
    }
  }

  // Frames behind scopes behind nodes behind arrows: an arrow drawn under a
  // filled box disappears, and a scope drawn last hides its own contents.
  scene.elements = [...frames, ...scopes, ...nodeLayer, ...edgeLayer, ...chrome];
  reindex(scene.elements);
  // Reported, not rerouted: the fix is a layout change the spec's author makes (#125).
  for (const c of connectorCrossings(scene.elements)) {
    const node = c.members.map((id) => nodeOf.get(id)).find(Boolean);
    if (!edgeOf.has(c.arrow) || !node) continue;
    report.crossings.push(`edge ${edgeOf.get(c.arrow)} crosses node ${node}; move ${node} off the line or give the edge a route`);
  }
  // The last word before anything is written. main() backs up and writes only
  // after buildDiagram returns, so a throw here leaves the target untouched.
  const nonFinite = nonFiniteBoxes(scene.elements.map((el) => ({
    id: nodeOf.get(el.id) ?? el.id, x: el.x, y: el.y, width: el.width, height: el.height,
  })));
  if (nonFinite.length) throw new SpecError(nonFinite);

  return { scene, report };
}

const USAGE = 'usage: build-diagram.mjs <spec.json> --out <file.excalidraw> [--seed N] [--keep-backups N] [--defaults]\n'
  + '       build-diagram.mjs --print-style [--defaults]';

function main(argv) {
  const { options, positionals } = parseCliOrExit(argv, {
    values: { '--out': null, '--keep-backups': null, '--seed': null }, switches: ['--defaults', '--print-style'],
  }, USAGE);
  const defaults = Boolean(options.defaults);
  if (options['print-style']) {
    if (positionals.length || options.out !== undefined || options['keep-backups'] !== undefined || options.seed !== undefined) {
      exitUsage('--print-style builds nothing, so it takes no spec, --out, --seed or --keep-backups', USAGE);
    }
    const style = loadStyleOrWarn(defaults);
    console.log(JSON.stringify({ store: engineStore('excalidraw'), ...styleSummary(style, { full: true }) }, null, 2));
    return;
  }
  if (positionals.length !== 1) {
    exitUsage(positionals.length ? `expected one spec file, got ${positionals.length}` : 'expected a spec file', USAGE);
  }
  if (!options.out) exitUsage('--out <file.excalidraw> is required', USAGE);
  const [specPath] = positionals;
  const { out } = options;
  const keep = options['keep-backups'] ?? String(DEFAULT_KEEP_BACKUPS);
  if (!/^\d+$/.test(keep) || !Number.isSafeInteger(Number(keep))) {
    exitUsage(`--keep-backups expects how many backups to keep, a whole number (0 keeps all), got ${keep}`, USAGE);
  }

  const seed = options.seed === undefined ? null : parseSeed(options.seed);
  if (options.seed !== undefined && seed === null) {
    exitUsage(`--seed expects a whole number from 0 to 4294967295, got ${options.seed}`, USAGE);
  }

  // One line, not a stack trace: the message never quotes the spec's content.
  let spec;
  try {
    spec = JSON.parse(readFileSync(specPath, 'utf8'));
  } catch (error) {
    exitUsage(readProblem(specPath, error, 'spec file'));
  }
  const style = loadStyleOrWarn(defaults);
  let built;
  try {
    built = buildDiagram(spec, { style, seed });
  } catch (error) {
    if (!(error instanceof SpecError)) throw error;
    // Refused before the backup and the write, so an existing file is untouched.
    console.error(JSON.stringify({ ok: false, spec: specPath, wrote: null, errors: error.errors }, null, 2));
    process.exit(1);
  }
  const { scene, report } = built;
  // A missing output folder is created, not reported as a stack trace (#113).
  mkdirSync(dirname(out), { recursive: true });
  const backup = backupExisting(out);
  writeScene(out, scene);
  // Only once the new file is written: a failed write keeps every backup (#49).
  const pruned = pruneBackups(out, { keep: Number(keep) });

  const view = bbox(scene.elements);
  console.log(JSON.stringify({
    wrote: out,
    backup,
    pruned,
    elements: scene.elements.length,
    embeddedFiles: Object.keys(scene.files).length,
    // Rebuilding with the same seed, spec, style and assets gives the same bytes.
    seed,
    canvas: `${Math.round(view.width)}x${Math.round(view.height)}`,
    icons: {
      resolved: report.icons.length,
      embedded: report.icons.filter((icon) => icon.kind === 'embedded'),
      opaqueBackground: report.opaqueIcons,
      // Items that already draw their own name, so no caption was added.
      selfCaptioned: report.selfCaptioned,
    },
    // Never quietly swallowed: an unfilled slot is visible in the scene and
    // named here, so it gets mentioned to the user rather than shipped.
    placeholders: report.missingIcons.length ? {
      count: report.missingIcons.length,
      forComponents: report.missingIcons,
      drawnAs: 'a dotted violet square with a "?", captioned, grouped',
      resolve: [
        'node find-icon.mjs "<component>"                    search the bundled libraries again',
        'node index-libraries.mjs --unnamed                  libraries whose items need looking at',
        'Then set "icon": "<library>:<n>" on the node and rebuild,',
        'or open the scene and drop the mark on top of the slot by hand.',
      ],
    } : null,
    // Drawn, but not as the spec said. Treat it like a placeholder: fix the kind
    // and rebuild, or say why it stays (#48).
    unknownKinds: report.unknownKinds,
    // A connector drawn through a node it does not connect (#125).
    crossings: report.crossings,
    notes: report.notes,
    // Which style drew this: the house style, or this install's override (#90).
    style: styleSummary(style),
  }, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith('build-diagram.mjs')) main(process.argv.slice(2));
