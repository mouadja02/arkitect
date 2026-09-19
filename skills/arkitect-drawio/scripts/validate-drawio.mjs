#!/usr/bin/env node
// Structural and layout validation for generated .drawio files.
//
//   node validate-drawio.mjs <file> [--page N] [--json] [--strict]
//
// Errors block delivery; warnings are judgement calls to look at in the render.
// Nothing here prints cell labels - only ids, counts and geometry.

import { readFileSync } from 'node:fs';
import {
  readMxfile, extractCells, parseStyle, parseDataUri, graphModelAttrs,
  parseCliOrExit, exitUsage, pageIndexArg, pageRangeError,
} from './lib/drawio-core.mjs';
import { checkXml } from './lib/xml-check.mjs';

const USAGE = 'usage: validate-drawio.mjs <file...> [--page N] [--json] [--strict]';

const MAX_COORD = 20000;      // draw.io stays usable well below this
const MIN_GAP = 8;            // px of clear space expected between siblings

function absoluteGeometry(cells) {
  const byId = new Map(cells.map((c) => [c.id, c]));
  const abs = new Map();
  const resolve = (c, seen = new Set()) => {
    if (abs.has(c.id)) return abs.get(c.id);
    if (seen.has(c.id)) return null;         // parent cycle
    seen.add(c.id);
    const g = c.geometry;
    if (!g || g.x == null || g.relative) return null;
    const parent = byId.get(c.parent);
    let ox = 0; let oy = 0;
    if (parent && parent.id !== '0' && parent.id !== '1') {
      const p = resolve(parent, seen);
      if (p) { ox = p.x; oy = p.y; }
    }
    const box = { x: g.x + ox, y: g.y + oy, width: g.width ?? 0, height: g.height ?? 0 };
    abs.set(c.id, box);
    return box;
  };
  for (const c of cells) if (c.vertex) resolve(c);
  return abs;
}

const isContainerish = (style) => {
  const s = parseStyle(style);
  return s.container === '1' || s.swimlane !== undefined || s.group !== undefined
    || String(s.shape ?? '').includes('group') || s.childLayout !== undefined;
};

export function validateFile(path, { pageIndex = null } = {}) {
  // A malformed index is the caller's bug; a page the file lacks is the file's.
  if (pageIndex !== null && !(Number.isSafeInteger(pageIndex) && pageIndex >= 0)) {
    const shown = typeof pageIndex === 'string' ? JSON.stringify(pageIndex) : String(pageIndex);
    throw new TypeError(`pageIndex must be a non-negative integer or null, got ${shown}`);
  }
  const errors = [];
  const warnings = [];
  const info = {};
  const text = readFileSync(path, 'utf8');

  // A forgiving tag scanner is what extractCells needs - it has to keep going
  // through a page it only half understands - but it cannot tell a native
  // Draw.io file from a malformed one, so a mismatched closing tag used to get
  // a clean PASS (#155). The strict reader the packs check their SVG payloads
  // with answers that question, here over the wrapper and then over each page
  // that had to be decoded first. It is dependency-free, reads the text once,
  // and reports element and attribute names and a position - never an attribute
  // value - so no label or image payload reaches the output.
  const wrapper = checkXml(text);
  if (!wrapper.ok) {
    errors.push(`not well-formed XML at line ${wrapper.line}, column ${wrapper.column}: ${wrapper.reason}`);
    return { path, ok: false, errors, warnings, info };
  }
  // The wrapper string checks this replaces could not see a declaration or a
  // comment around the root, both of which XML allows; the parse can.
  if (wrapper.root.name !== 'mxfile') {
    errors.push(`the root element is <${wrapper.root.name}>, not <mxfile>`);
    return { path, ok: false, errors, warnings, info };
  }

  let mx;
  try {
    mx = readMxfile(path);
  } catch (e) {
    return { path, ok: false, errors: [`unparseable: ${e.message}`], warnings, info };
  }
  if (!mx.pages.length) errors.push('no <diagram> pages found');
  // Selecting a page that is not there must fail, never pass having checked nothing.
  else if (pageIndex !== null && pageIndex >= mx.pages.length) errors.push(pageRangeError(path, pageIndex, mx.pages.length));

  const pageIds = new Set();
  const pageNames = new Set();
  const pages = [];

  mx.pages.forEach((page, idx) => {
    if (pageIndex !== null && idx !== pageIndex) return;
    const label = `page ${idx}`;
    if (!page.id) errors.push(`${label}: missing id`);
    else if (pageIds.has(page.id)) errors.push(`${label}: duplicate page id`);
    pageIds.add(page.id);
    if (!page.name) warnings.push(`${label}: unnamed page`);
    else if (pageNames.has(page.name)) warnings.push(`${label}: duplicate page name`);
    pageNames.add(page.name);

    let xml;
    try {
      xml = page.xml;
    } catch (e) {
      errors.push(`${label}: cannot decode page (${e.message})`);
      return;
    }
    // An uncompressed page sits inside the wrapper the check above already
    // read; a compressed one is base64 there and is only XML once decoded.
    if (page.compressed) {
      const decoded = checkXml(xml);
      if (!decoded.ok) {
        errors.push(`${label}: not well-formed XML at line ${decoded.line}, column ${decoded.column}: ${decoded.reason}`);
        return;
      }
    }
    if (!/<mxGraphModel\b/.test(xml)) { errors.push(`${label}: no <mxGraphModel>`); return; }
    if (!/<root>/.test(xml)) errors.push(`${label}: no <root> element`);

    const cells = extractCells(xml);
    const ids = new Set();
    const dupes = new Set();
    for (const c of cells) {
      if (!c.id) errors.push(`${label}: cell with empty id`);
      else if (ids.has(c.id)) dupes.add(c.id);
      ids.add(c.id);
    }
    for (const d of dupes) errors.push(`${label}: duplicate cell id "${d}"`);

    if (!ids.has('0') || !ids.has('1')) errors.push(`${label}: missing root cells 0 and 1`);

    for (const c of cells) {
      if (c.id === '0') continue;
      if (!c.parent) { errors.push(`${label}: cell "${c.id}" has no parent`); continue; }
      if (!ids.has(c.parent)) errors.push(`${label}: cell "${c.id}" references missing parent "${c.parent}"`);
    }

    let dangling = 0;
    for (const c of cells) {
      if (!c.edge) continue;
      for (const [end, ref] of [['source', c.source], ['target', c.target]]) {
        if (!ref) { dangling++; warnings.push(`${label}: edge "${c.id}" has no ${end} (floating endpoint)`); continue; }
        if (!ids.has(ref)) errors.push(`${label}: edge "${c.id}" ${end} "${ref}" does not exist`);
      }
    }

    let embedded = 0; let remote = 0;
    for (const c of cells) {
      const s = parseStyle(c.style);
      if (!s.image) continue;
      const v = String(s.image);
      if (v.startsWith('data:')) {
        const d = parseDataUri(v);
        if (!d || !d.bytes.length) errors.push(`${label}: cell "${c.id}" has an unreadable embedded image`);
        else embedded++;
      } else {
        remote++;
        warnings.push(`${label}: cell "${c.id}" points at an external image; the diagram will not be portable`);
      }
    }

    const abs = absoluteGeometry(cells);
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const [id, b] of abs) {
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) { errors.push(`${label}: cell "${id}" has non-numeric geometry`); continue; }
      if (b.width <= 0 || b.height <= 0) warnings.push(`${label}: cell "${id}" has zero or negative size`);
      if (Math.abs(b.x) > MAX_COORD || Math.abs(b.y) > MAX_COORD) {
        warnings.push(`${label}: cell "${id}" sits outside +/-${MAX_COORD}px`);
      }
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
    }

    // Overlap check: only leaf vertices sharing a parent. Containers enclose
    // their children by design, and transparent text cells are routinely laid
    // over icons as captions, so neither counts as a collision.
    const isTransparentLabel = (style) => {
      const s = parseStyle(style);
      if (s.text !== undefined) return true;
      const noFill = s.fillColor === 'none' || s.fillColor === undefined;
      const noStroke = s.strokeColor === 'none';
      return noFill && noStroke && s.image === undefined && s.shape === undefined;
    };
    const leaves = cells.filter((c) => c.vertex && abs.has(c.id) && !isContainerish(c.style)
      && !isTransparentLabel(c.style)
      && !cells.some((k) => k.parent === c.id));
    let overlaps = 0;
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        const A = leaves[i]; const B = leaves[j];
        if (A.parent !== B.parent) continue;
        const a = abs.get(A.id); const b = abs.get(B.id);
        const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (ox > 0 && oy > 0) {
          overlaps++;
          if (overlaps <= 10) warnings.push(`${label}: cells "${A.id}" and "${B.id}" overlap by ${Math.round(ox)}x${Math.round(oy)}px`);
        } else if (ox > -MIN_GAP && oy > 0 && ox <= 0) {
          // touching but not overlapping - only interesting when flush
        }
      }
    }

    // Clipped-label heuristic. Captions rendered below an icon may legally
    // overflow the cell, so only in-box labels are checked.
    let clipped = 0;
    for (const c of cells) {
      if (!c.vertex || !c.value) continue;
      const s = parseStyle(c.style);
      if (s.verticalLabelPosition === 'bottom' || s.verticalLabelPosition === 'top') continue;
      if (isContainerish(c.style)) continue;
      const g = abs.get(c.id);
      if (!g || !g.width) continue;
      const plain = c.value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
      const longest = Math.max(...plain.split('\n').map((l) => l.trim().length), 0);
      const size = Number(s.fontSize ?? 12);
      const wrap = s.whiteSpace === 'wrap';
      const estimated = longest * size * 0.55;
      if (!wrap && estimated > g.width + 4) {
        clipped++;
        if (clipped <= 10) warnings.push(`${label}: cell "${c.id}" label needs ~${Math.round(estimated)}px but the box is ${Math.round(g.width)}px and does not wrap`);
      }
    }

    // Caption crossings (#45). A caption hangs below its icon, where an
    // orthogonal edge attached to the icon's bottom runs straight through it.
    // Routes are estimated from each end's port - an explicit exit/entry
    // constraint, else the side facing the other end - as a straight line or a
    // Z, so this is a warning to check in the render. Edges with waypoints are
    // skipped rather than guessed.
    const captions = [];
    for (const c of cells) {
      if (!c.vertex || !c.value) continue;
      const s = parseStyle(c.style);
      if (s.verticalLabelPosition !== 'bottom') continue;
      const g = abs.get(c.id);
      if (!g) continue;
      const lines = c.value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').split('\n');
      const size = Number(s.fontSize ?? 12);
      const width = Math.max(...lines.map((l) => l.trim().length)) * size * 0.55;
      captions.push({ id: c.id, x: g.x + g.width / 2 - width / 2, y: g.y + g.height + 2, width, height: lines.length * size * 1.25 });
    }
    const port = (box, style, end, other) => {
      const s = parseStyle(style);
      if (s[`${end}X`] !== undefined && s[`${end}Y`] !== undefined) {
        const ry = Number(s[`${end}Y`]);
        return {
          x: box.x + Number(s[`${end}X`]) * box.width + Number(s[`${end}Dx`] ?? 0),
          y: box.y + ry * box.height + Number(s[`${end}Dy`] ?? 0),
          vertical: ry === 0 || ry === 1,
        };
      }
      const cx = box.x + box.width / 2; const cy = box.y + box.height / 2;
      const ox = other.x + other.width / 2; const oy = other.y + other.height / 2;
      return Math.abs(oy - cy) > Math.abs(ox - cx)
        ? { x: cx, y: oy > cy ? box.y + box.height : box.y, vertical: true }
        : { x: ox > cx ? box.x + box.width : box.x, y: cy, vertical: false };
    };
    const route = (p, q) => {
      if (Math.abs(p.x - q.x) < 1 || Math.abs(p.y - q.y) < 1) return [[p, q]];
      if (p.vertical) {
        const my = (p.y + q.y) / 2;
        return [[p, { x: p.x, y: my }], [{ x: p.x, y: my }, { x: q.x, y: my }], [{ x: q.x, y: my }, q]];
      }
      const mx = (p.x + q.x) / 2;
      return [[p, { x: mx, y: p.y }], [{ x: mx, y: p.y }, { x: mx, y: q.y }], [{ x: mx, y: q.y }, q]];
    };
    const crosses = ([p, q], r) => Math.max(p.x, q.x) > r.x + 1 && Math.min(p.x, q.x) < r.x + r.width - 1
      && Math.max(p.y, q.y) > r.y + 1 && Math.min(p.y, q.y) < r.y + r.height - 1;
    let captionCrossings = 0;
    for (const c of cells) {
      if (!c.edge || c.waypoints) continue;
      const a = abs.get(c.source); const b = abs.get(c.target);
      if (!a || !b) continue;
      const segments = route(port(a, c.style, 'exit', b), port(b, c.style, 'entry', a));
      const hit = captions.find((cap) => segments.some((segment) => crosses(segment, cap)));
      if (!hit) continue;
      captionCrossings++;
      if (captionCrossings <= 10) warnings.push(`${label}: edge "${c.id}" runs through the caption of "${hit.id}"`);
    }

    const model = graphModelAttrs(xml);
    pages.push({
      index: idx, name: page.name, compressed: page.compressed,
      cells: cells.length,
      vertices: cells.filter((c) => c.vertex).length,
      edges: cells.filter((c) => c.edge).length,
      danglingEdges: dangling, embeddedImages: embedded, externalImages: remote,
      overlaps, clippedLabels: clipped, captionCrossings,
      bounds: Number.isFinite(minX)
        ? { minX: Math.round(minX), minY: Math.round(minY), width: Math.round(maxX - minX), height: Math.round(maxY - minY) }
        : null,
      pageSize: model.pageWidth && model.pageHeight ? `${model.pageWidth}x${model.pageHeight}` : null,
    });
  });

  info.bytes = Buffer.byteLength(text);
  info.pages = pages;
  return { path, ok: errors.length === 0, errors, warnings, info };
}

function main(argv) {
  const { options, positionals: files } = parseCliOrExit(argv,
    { values: { '--page': pageIndexArg }, switches: ['--json', '--strict'] }, USAGE);
  if (!files.length) exitUsage('expected at least one .drawio file', USAGE);
  const pageIndex = options.page ?? null;

  let bad = 0;
  for (const f of files) {
    const r = validateFile(f, { pageIndex });
    if (options.json) { console.log(JSON.stringify(r, null, 2)); }
    else {
      console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${f}`);
      for (const p of r.info.pages ?? []) {
        console.log(`   page ${p.index} "${p.name}": ${p.vertices} vertices, ${p.edges} edges, ` +
          `${p.embeddedImages} embedded images, bounds ${p.bounds ? `${p.bounds.width}x${p.bounds.height}` : 'n/a'}` +
          `${p.overlaps ? `, ${p.overlaps} overlaps` : ''}${p.clippedLabels ? `, ${p.clippedLabels} tight labels` : ''}`
          + `${p.captionCrossings ? `, ${p.captionCrossings} caption crossings` : ''}`);
      }
      for (const e of r.errors) console.log(`   ERROR  ${e}`);
      for (const w of r.warnings) console.log(`   warn   ${w}`);
    }
    if (!r.ok || (options.strict && r.warnings.length)) bad++;
  }
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && process.argv[1].endsWith('validate-drawio.mjs')) main(process.argv.slice(2));
