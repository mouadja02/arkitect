#!/usr/bin/env node
// Deterministic, offline test suite.
//
//   node tests/run-tests.mjs
//
// No network, no npm dependencies, no Docker. Tests that need real reference
// scenes read their paths from .analysis/sources.local.json (gitignored);
// without that file they skip rather than fail, so the suite runs on a clean
// checkout.
//
// The icon-store tests write into the real store under a `zz-test-` prefix and
// clean up after themselves, because the alternative - a mock filesystem -
// would stop testing the thing that actually breaks.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { repoFiles } from './repo-files.mjs';
import * as xml from '../skills/arkitect-drawio/scripts/lib/xml-check.mjs';
import { createHarness, settle } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SKILL = join(ROOT, 'skills', 'arkitect-excalidraw');
const SCRIPTS = join(SKILL, 'scripts');
const TMP = join(HERE, 'output', 'excalidraw');
const SOURCES_FILE = join(ROOT, '.analysis', 'sources.local.json');

// The suite never reads or writes the style store of the person running it
// (#89); every process a test spawns inherits this.
process.env.ARKITECT_HOME = join(TMP, 'arkitect-home');

// test() is synchronous; a callback that returns a promise fails (#114).
const { test, sourceTest, finish } = createHarness();

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`); }

const mod = (p) => import(`file://${join(SCRIPTS, p).replace(/\\/g, '/')}`);
const node = (script, args) =>
  execFileSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const core = await mod('lib/excalidraw-core.mjs');
const svgPath = await mod('lib/svg-path.mjs');
const rough = await mod('lib/rough.mjs');
const builder = await mod('build-diagram.mjs');
const validator = await mod('validate-excalidraw.mjs');
const renderer = await mod('render-excalidraw.mjs');
const browserLib = await mod('lib/browser.mjs');
const analyzer = await mod('analyze-excalidraw.mjs');
const icons = await mod('make-icon.mjs');
const finder = await mod('find-icon.mjs');
const libIndex = await mod('index-libraries.mjs');
const browse = await mod('browse-libraries.mjs');
const styleTokens = await mod('lib/style-tokens.mjs');
const findingsTool = await mod('style-findings.mjs');
const applyTool = await mod('apply-style.mjs');

const sources = existsSync(SOURCES_FILE) ? JSON.parse(readFileSync(SOURCES_FILE, 'utf8')) : null;
const sourceList = sources ? (sources.excalidraw ?? sources.files ?? sources.scenes ?? []) : [];
// An empty list must not count as "have sources": every reference test would
// then loop over nothing and report a pass it never earned.
const haveSources = sourceList.length > 0 && sourceList.every((p) => existsSync(p));

// ------------------------------------------------------------- fixtures

// A real PNG, built here rather than committed, so transparency detection is
// tested against actual IHDR bytes.
function makePng({ alpha, w = 4, h = 4 }) {
  const colorType = alpha ? 6 : 2;
  const channels = alpha ? 4 : 3;
  const raw = Buffer.alloc(h * (1 + w * channels));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * channels);
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      const p = off + 1 + x * channels;
      raw[p] = 0x22; raw[p + 1] = 0x88; raw[p + 2] = 0xcc;
      if (alpha) raw[p + 3] = 0x80;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

// A ring with a hole: outer square wound one way, inner square the other.
const DONUT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
  + '<path fill="#1971c2" d="M0 0 H100 V100 H0 Z M30 30 V70 H70 V30 Z"/></svg>';

const TEST_PREFIX = 'zz-test-';
function cleanTestIcons() {
  for (const name of Object.keys(icons.loadIndex())) {
    if (name.startsWith(TEST_PREFIX)) { try { icons.removeIcon(name); } catch { /* already gone */ } }
  }
}
cleanTestIcons();

// ------------------------------------------------------------- core

test('element factories produce the fields Excalidraw requires', () => {
  const r = core.rectangle({ x: 0, y: 0, width: 10, height: 10 });
  for (const k of ['id', 'type', 'x', 'y', 'width', 'height', 'angle', 'strokeColor', 'backgroundColor',
    'fillStyle', 'strokeWidth', 'strokeStyle', 'roughness', 'opacity', 'groupIds', 'seed', 'versionNonce',
    'isDeleted', 'updated', 'locked']) {
    assert(r[k] !== undefined, `rectangle is missing ${k}`);
  }
  eq(r.type, 'rectangle', 'type');
  eq(r.backgroundColor, 'transparent', 'unfilled shapes use "transparent", not "none"');
  eq(core.newId().length, 21, 'id length');
  assert(core.newId() !== core.newId(), 'ids must be unique');
});

test('index keys sort in element order past the single-digit boundary', () => {
  const keys = Array.from({ length: 4000 }, (_, i) => core.indexKey(i));
  const sorted = [...keys].sort();
  eq(keys.join(','), sorted.join(','), 'lexicographic order must match numeric order');
  eq(new Set(keys).size, keys.length, 'keys must be unique');
  // fractional-indexing format: the head says how many digits follow, so
  // Excalidraw can generate a key after the last one instead of rejecting the
  // whole set and regenerating every index.
  for (const k of [keys[0], keys[61], keys[62], keys[3905], keys[3906]]) {
    const width = k.charCodeAt(0) - 'a'.charCodeAt(0) + 1;
    assert(width >= 1 && k.length === width + 1, `"${k}" does not match its declared integer length`);
    assert([...k.slice(1)].every((c) => /[0-9A-Za-z]/.test(c)), `"${k}" has a non-base62 digit`);
  }
  eq(core.indexKey(0), 'a0', 'first key');
  eq(core.indexKey(62), 'b00', 'the first key past a single digit widens the head');
});

test('arrow points are relative and the first is the origin', () => {
  const a = core.arrow({ x: 100, y: 50, points: [[0, 0], [80, 0], [80, 40]] });
  eq(a.points[0][0], 0, 'first point x');
  eq(a.width, 80, 'width from points');
  const box = core.elementBox(a);
  eq(box.x, 100, 'absolute x');
  eq(box.width, 80, 'absolute width');
});

test('bound text records the link on both sides', () => {
  const r = core.rectangle({ x: 0, y: 0, width: 200, height: 80 });
  const t = core.bindLabel(r, 'Ingest API');
  eq(t.containerId, r.id, 'text names its container');
  assert(r.boundElements.some((b) => b.id === t.id && b.type === 'text'), 'container lists its text');
});

test('a label wraps to the usable width of a diamond, not its bounding box', () => {
  const d = core.diamond({ x: 0, y: 0, width: 200, height: 140 });
  const t = core.bindLabel(d, 'schema validation decision point');
  const widest = Math.max(...t.text.split('\n').map((l) => core.measureLine(l, t.fontSize, t.fontFamily)));
  assert(widest <= 200 * 0.5, `diamond label ${Math.round(widest)}px exceeds the 100px usable width`);
  assert(t.text.includes('\n'), 'a long diamond label has to wrap');
});

test('cloning rewrites internal references and drops external ones', () => {
  const r = core.rectangle({ x: 0, y: 0, width: 100, height: 50 });
  const t = core.bindLabel(r, 'label');
  r.boundElements.push({ id: 'not-in-this-set', type: 'arrow' });
  const copies = core.cloneElements([r, t]);
  const [cr, ct] = copies;
  assert(cr.id !== r.id && ct.id !== t.id, 'ids are fresh');
  eq(ct.containerId, cr.id, 'containerId is remapped');
  eq(cr.boundElements.length, 1, 'the dangling reference is dropped');
  eq(cr.boundElements[0].id, ct.id, 'the surviving reference points at the copy');
});

test('repairBindings makes a one-sided binding two-sided', () => {
  const a = core.rectangle({ x: 0, y: 0, width: 50, height: 50 });
  const b = core.rectangle({ x: 200, y: 0, width: 50, height: 50 });
  const arr = core.arrow({ x: 50, y: 25, points: [[0, 0], [150, 0]] });
  arr.startBinding = { elementId: a.id, focus: 0, gap: 4 };
  arr.endBinding = { elementId: b.id, focus: 0, gap: 4 };
  core.repairBindings([a, b, arr]);
  assert(a.boundElements?.some((x) => x.id === arr.id), 'source lists the arrow');
  assert(b.boundElements?.some((x) => x.id === arr.id), 'target lists the arrow');
});

test('libraries in both v1 and v2 shapes read back the same way', () => {
  const els = [core.rectangle({ x: 0, y: 0, width: 10, height: 10 })];
  const v1 = join(TMP, 'v1.excalidrawlib');
  const v2 = join(TMP, 'v2.excalidrawlib');
  writeFileSync(v1, JSON.stringify({ type: 'excalidrawlib', version: 1, library: [els, els] }));
  core.writeLibrary(v2, [{ name: 'one', elements: els }, { name: 'two', elements: els }]);
  eq(core.readLibrary(v1).length, 2, 'v1 item count');
  eq(core.readLibrary(v2).length, 2, 'v2 item count');
  eq(core.readLibrary(v2)[1].name, 'two', 'v2 items keep their names');
  eq(core.readLibrary(v1)[0].name, '', 'v1 items have no name of their own');
});

// ------------------------------------------------------------- svg tracing

test('path flattening handles absolute, relative, curve and arc commands', () => {
  const sub = svgPath.flattenPath('M10 10 h30 v30 C40 60 20 60 10 40 A10 10 0 0 1 10 10 Z');
  eq(sub.length, 1, 'one subpath');
  assert(sub[0].closed, 'Z closes it');
  assert(sub[0].points.length > 20, 'the curve and the arc are both flattened to points');
  assert(sub[0].points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), 'no NaN coordinates');
  // h/v are relative: the corner they produce has to land at 40,10 and 40,40.
  const has = (x, y) => sub[0].points.some(([px, py]) => Math.abs(px - x) < 0.01 && Math.abs(py - y) < 0.01);
  assert(has(40, 10) && has(40, 40), 'relative h and v commands land where they should');
  // The arc ends back on the start point, which is what makes Z a no-op here.
  const last = sub[0].points[sub[0].points.length - 1];
  assert(Math.hypot(last[0] - 10, last[1] - 10) < 0.5, `arc should end at its stated endpoint, got ${last}`);
});

test('transforms compose down the group stack', () => {
  const { shapes } = svgPath.parseSvg(
    '<svg viewBox="0 0 100 100"><g transform="translate(10,10)">'
    + '<g transform="scale(2)"><rect x="0" y="0" width="5" height="5" fill="#000"/></g></g></svg>');
  eq(shapes.length, 1, 'one shape');
  const xs = shapes[0].points.map((p) => p[0]);
  eq(Math.min(...xs), 10, 'translate applied');
  eq(Math.max(...xs), 20, 'scale applied inside the translate');
});

test('a nested counter-wound ring is detected as a hole', () => {
  const { shapes } = svgPath.parseSvg(DONUT_SVG);
  eq(shapes.length, 2, 'outer and inner ring');
  eq(shapes[0].hole, false, 'the outer ring is filled');
  eq(shapes[1].hole, true, 'the inner ring is a hole');
});

test('overlapping sibling shapes are not mistaken for holes', () => {
  // Two same-wound squares that cross: under nonzero both stay filled.
  const svg = '<svg viewBox="0 0 100 100"><path fill="#000" d="M0 0 H50 V50 H0 Z M25 25 H75 V75 H25 Z"/></svg>';
  const { shapes } = svgPath.parseSvg(svg);
  eq(shapes.length, 2, 'two rings');
  assert(!shapes[0].hole && !shapes[1].hole, 'crossing rings are both filled');
});

test('even-odd fill uses nesting parity instead of winding', () => {
  const svg = '<svg viewBox="0 0 100 100"><path fill-rule="evenodd" fill="#000" '
    + 'd="M0 0 H100 V100 H0 Z M30 30 H70 V70 H30 Z"/></svg>';
  const { shapes } = svgPath.parseSvg(svg);
  eq(shapes[1].hole, true, 'the inner ring is cut out under even-odd even when wound the same way');
});

test('what the tracer cannot do is reported, not silently dropped', () => {
  const svg = '<svg viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs>'
    + '<text x="0" y="5">hi</text><rect width="10" height="10" fill="url(#g)"/></svg>';
  const { skipped } = svgPath.parseSvg(svg);
  assert(skipped.includes('linearGradient'), 'gradients reported');
  assert(skipped.includes('text'), 'text reported');
});

// ------------------------------------------------------------- rough

test('the hand-drawn stroke is deterministic for a given seed', () => {
  const pts = [[0, 0], [100, 0], [100, 60]];
  eq(rough.roughPath(pts, { seed: 42 }), rough.roughPath(pts, { seed: 42 }), 'same seed, same path');
  assert(rough.roughPath(pts, { seed: 42 }) !== rough.roughPath(pts, { seed: 7 }), 'different seed, different path');
  assert(!rough.roughPath(pts, { seed: 1, roughness: 0 }).includes('C'), 'roughness 0 draws straight lines');
});

// ------------------------------------------------------------- icon store

test('an SVG traces into native elements with its holes preserved', () => {
  const r = icons.storeIcon(`${TEST_PREFIX}donut`, Buffer.from(DONUT_SVG, 'utf8'), { trace: true, size: 80 });
  eq(r.entry.kind, 'traced', 'kind');
  eq(r.traceReport.holes, 1, 'one hole detected');
  const item = core.readLibrary(join(icons.ITEM_DIR, `${TEST_PREFIX}donut.excalidrawlib`))[0];
  eq(item.elements.length, 2, 'two line elements');
  assert(item.elements.every((el) => el.type === 'line'), 'traced icons are native lines, not images');
  const box = core.bbox(item.elements);
  assert(Math.abs(Math.max(box.width, box.height) - 80) <= 2, `scaled to 80px, got ${Math.round(box.width)}`);
});

test('--outline drops every fill', () => {
  const r = icons.storeIcon(`${TEST_PREFIX}outline`, Buffer.from(DONUT_SVG, 'utf8'), { trace: true, outline: true });
  assert(r.entry.outline, 'recorded as outline');
  const item = core.readLibrary(join(icons.ITEM_DIR, `${TEST_PREFIX}outline.excalidrawlib`))[0];
  assert(item.elements.every((el) => el.backgroundColor === 'transparent'), 'no fills');
});

test('a raster logo is embedded and its transparency is read from the file', () => {
  const opaque = icons.storeIcon(`${TEST_PREFIX}opaque`, makePng({ alpha: false }));
  eq(opaque.entry.kind, 'embedded', 'kind');
  eq(opaque.entry.transparent, false, 'RGB PNG is opaque');
  const clear = icons.storeIcon(`${TEST_PREFIX}clear`, makePng({ alpha: true }));
  eq(clear.entry.transparent, true, 'RGBA PNG has alpha');
  eq(clear.entry.width, 4, 'dimensions decoded from IHDR');
});

test('tracing a raster is refused rather than producing nonsense', () => {
  let threw = null;
  try { icons.storeIcon(`${TEST_PREFIX}nope`, makePng({ alpha: true }), { trace: true }); }
  catch (e) { threw = e.message; }
  assert(threw && /SVG/i.test(threw), `expected an SVG-required error, got ${threw}`);
});

test('storing the same name twice needs --force', () => {
  let threw = null;
  try { icons.storeIcon(`${TEST_PREFIX}donut`, Buffer.from(DONUT_SVG, 'utf8'), { trace: true }); }
  catch (e) { threw = e.message; }
  assert(threw && /force/.test(threw), `expected a force hint, got ${threw}`);
  const again = icons.storeIcon(`${TEST_PREFIX}donut`, Buffer.from(DONUT_SVG, 'utf8'), { trace: true, force: true, size: 120 });
  eq(again.entry.size, 120, 'restyled size');
});

test('the house library holds every stored icon', () => {
  const items = core.readLibrary(icons.HOUSE_LIB);
  const names = new Set(Object.keys(icons.loadIndex()));
  assert(items.length >= names.size, `house library has ${items.length} items for ${names.size} icons`);
});

test('find-icon resolves an exact name and refuses a weak match', () => {
  assert(finder.resolveIcon(`${TEST_PREFIX}donut`), 'exact reference resolves');
  eq(finder.resolveIcon('a-product-that-does-not-exist-anywhere'), null, 'no weak substitution');
});

test('without shared packs a name inside a different product still gets a placeholder (#22)', () => {
  // Each of these drew the wrong product, silently: a managed service for the
  // open-source project, or an unrelated item that merely contains the word.
  for (const q of ['postgres', 'redis', 'grafana', 'prometheus', 'vault', 'queue', 'nifi', 'ray', '.net', 'llm',
    'memory', 'api management']) {
    const drawn = finder.resolveIcon(q, { shared: false });
    assert(!drawn, `"${q}" drew ${drawn?.name}`);
    assert(finder.unattended(q, { entries: finder.catalog({ shared: false }) }).reason, `"${q}" gives no reason for its placeholder`);
  }
  // The product by name still draws, with or without its vendor word.
  for (const [q, name] of [['kafka', 'Kafka'], ['lambda', 'Lambda'], ['data factory', 'Azure Data Factory'],
    ['cosmos', 'Azure Cosmos DB'], ['bedrock', 'Amazon Bedrock']]) {
    eq(finder.resolveIcon(q)?.name, name, `"${q}"`);
  }
});

test('icon resolution answer key: never draws a different product unattended (#22)', () => {
  const key = JSON.parse(readFileSync(join(HERE, 'excalidraw-icon-queries.json'), 'utf8'));
  const entries = finder.catalog({ shared: false });
  let right = 0; let placeholders = 0; let drawable = 0;
  const wrong = [];
  for (const [q, accept] of key.queries) {
    if (accept) drawable++;
    const { entry } = finder.unattended(q, { entries });
    if (!entry) { placeholders++; continue; }
    // A placeholder is honest and only counted; a different product is a failure.
    if (accept && accept.some((n) => core.normalizeName(n) === core.normalizeName(entry.name))) right++;
    else wrong.push(`${q} -> ${entry.name}`);
  }
  console.log(`        answer key: ${right} drawn right, ${wrong.length} wrong, ${placeholders} placeholders `
    + `(${key.queries.length} queries, ${drawable} with a drawable answer)`);
  assert(!wrong.length, `drew a different product: ${wrong.join('; ')}`);
  assert(right / drawable >= key.drawFloor, `drew ${right} of ${drawable} drawable answers, below the ${key.drawFloor * 100}% floor`);
});

test('shared fallback preserves every existing choice and uses the reviewed product IDs (#17)', () => {
  const nativeKey = JSON.parse(readFileSync(join(HERE, 'excalidraw-icon-queries.json'), 'utf8'));
  const sharedKey = JSON.parse(readFileSync(join(HERE, 'icon-queries.json'), 'utf8'));
  const expected = new Map(sharedKey.queries.filter(([, , context]) => !context).map(([q, accept]) => [q, accept]));
  const oldEntries = finder.catalog({ shared: false });
  const entries = finder.catalog();
  let preserved = 0; let added = 0;
  for (const [query] of nativeKey.queries) {
    const before = finder.unattended(query, { entries: oldEntries });
    const after = finder.unattended(query, { entries });
    if (before.entry) {
      eq(after.entry?.ref, before.entry.ref, `existing choice for ${query}`);
      preserved++;
    } else if (after.entry) {
      eq(after.entry.provider, 'drawio', `new provider for ${query}`);
      const accept = expected.get(query);
      const ids = Array.isArray(accept) ? accept : [accept];
      assert(ids.some((id) => id && after.entry.ref === `drawio:${id}`), `${query} drew wrong product ${after.entry.ref}`);
      added++;
    }
  }
  assert(added >= 100, `expected substantial new coverage, got ${added}`);
  console.log(`        shared fallback: ${preserved} existing choices preserved, ${added} new correct answers`);
  for (const [query, id] of [['postgres', 'databases/postgresql'], ['grafana', 'observability/grafana'],
    ['prometheus', 'observability/prometheus'], ['vault', 'security-identity/vault'], ['redis', 'databases/redis']]) {
    eq(finder.resolveIcon(query)?.source, `drawio:${id}`, `actual resolver for ${query}`);
  }
  for (const query of ['tempo', 'cube', 'microsoft fabric', 'compute optimizer', 'a-product-that-does-not-exist-anywhere']) {
    eq(finder.resolveIcon(query), null, `unsafe query ${query}`);
  }
});

test('all shared IDs resolve to the exact committed SVG or PNG bytes (#17)', () => {
  const cat = JSON.parse(readFileSync(join(ROOT, 'skills/arkitect-drawio/references/icon-catalog.json'), 'utf8'));
  const shared = finder.catalog().filter((e) => e.provider === 'drawio');
  eq(shared.length, cat.icons.filter((i) => i.bytes === 'committed').length, 'all committed icons searchable');
  const refs = new Set(shared.map((e) => e.ref));
  const failures = [];
  for (const icon of cat.icons) {
    try {
      const ref = `drawio:${icon.id}`;
      const result = finder.resolveIcon(ref);
      if (icon.bytes !== 'committed') {
        eq(result, null, `${icon.id} has no bytes`);
        assert(!refs.has(ref), `${icon.id} advertised as drawable`);
        continue;
      }
      assert(refs.has(ref), `${icon.id} not searchable`);
      eq(result.kind, 'embedded', 'representation');
      eq(result.source, ref, 'exact ID');
      eq(core.sha256(result.entry.bytes), icon.sha256, 'original byte hash');
      eq(result.entry.mime, icon.mime, 'mime');
      eq(result.entry.width, icon.width, 'width');
      eq(result.entry.height, icon.height, 'height');
      eq(result.provenance.source, icon.source, 'source attribution');
      eq(result.provenance.licence, icon.licence, 'licence attribution');
    } catch (e) { failures.push(`${icon.id}: ${e.message}`); }
  }
  assert(!failures.length, failures.join('\n'));
  assert(!JSON.stringify(shared).includes('base64'), 'catalog must remain metadata-only');
});

test('shared refs reject typos, indices and paths without substituting artwork (#17)', () => {
  for (const ref of ['drawio:', 'drawio:0', 'drawio:databases/0', 'drawio:postgres',
    'drawio:databases/postgresql:0', 'drawio:databases/PostgreSQL', 'drawio:../databases/postgresql',
    'drawio:databases/postgresql/extra', 'drawio:brands/not-a-product']) {
    eq(finder.resolveIcon(ref), null, ref);
  }
  const result = builder.buildDiagram({ nodes: [
    { id: 'x', kind: 'icon', icon: 'drawio:brands/not-a-product', label: 'Missing' },
    { id: 'y', kind: 'icon', icon: 'drawio:streaming-orchestration/fivetran', label: 'Fivetran', col: 1 },
  ] });
  eq(result.report.missingIcons.length, 2, 'unknown and on-demand both reported');
  eq(Object.keys(result.scene.files).length, 0, 'no substitute file');
  assert(validator.validateScene(result.scene).ok, 'placeholders remain valid');
});

test('shared fallback cannot bypass ambiguity in the existing provider set (#17)', () => {
  const native = ['Postgres service A', 'Postgres service B'].map((name, i) => ({
    ref: `custom:${i}`, name, provider: 'bundled', aliases: ['postgres'],
  }));
  const entries = [...native, ...finder.catalog().filter((e) => e.provider === 'drawio')];
  const result = finder.unattended('postgres', { entries });
  eq(result.entry, null, 'ambiguous native result stays unresolved');
  assert(result.ambiguous, 'reason distinguishes ambiguity from missing coverage');
});

test('shared example specs build valid scenes and the gallery covers every pack (#17)', () => {
  for (const name of ['shared-icon-packs', 'shared-icon-gallery']) {
    const spec = JSON.parse(readFileSync(join(SKILL, 'assets/templates', `${name}.spec.json`), 'utf8'));
    const built = builder.buildDiagram(spec);
    const validation = validator.validateScene(built.scene);
    assert(validation.ok, `${name}: ${validation.errors.join('; ')}`);
    eq(validation.info.overlaps, 0, `${name}: overlapping nodes`);
    eq(built.report.missingIcons.length, 0, `${name}: missing icons`);
    if (name === 'shared-icon-gallery') {
      eq(new Set(built.report.icons.map((i) => i.provenance.pack)).size, 18, 'gallery pack coverage');
      eq(built.scene.elements.filter((e) => e.type === 'image').length, spec.nodes.length, 'every gallery icon embedded');
      const svg = renderer.sceneToSvg(built.scene);
      for (const file of Object.values(built.scene.files)) assert(svg.includes(file.dataURL), 'SVG keeps gallery payloads');
      assert(built.report.opaqueIcons.some((s) => s.includes('agentcore-identity')), 'opaque PNG reported');
    }
  }
});

test('shared images deduplicate bytes, preserve aspect and bind connections on both sides (#17)', () => {
  const cat = JSON.parse(readFileSync(join(ROOT, 'skills/arkitect-drawio/references/icon-catalog.json'), 'utf8'));
  const raster = cat.icons.find((i) => i.mime === 'image/png' && i.width !== i.height && i.bytes === 'committed');
  assert(raster, 'non-square raster fixture exists');
  const ids = ['databases/postgresql', 'databases/postgresql', raster.id];
  const built = builder.buildDiagram({ nodes: ids.map((id, col) => (
    { id: `n${col}`, kind: 'icon', icon: `drawio:${id}`, label: `Icon ${col}`, col, size: 100 }
  )), edges: [{ from: 'n0', to: 'n1' }, { from: 'n1', to: 'n2' }] });
  assert(validator.validateScene(built.scene).ok, 'scene validates');
  const images = built.scene.elements.filter((e) => e.type === 'image');
  eq(images.length, 3, 'independent image elements');
  eq(Object.keys(built.scene.files).length, 2, 'one file per distinct payload');
  eq(images[0].fileId, images[1].fileId, 'repeated icon file');
  const scale = 100 / Math.max(raster.width, raster.height);
  eq(images[2].width, Math.round(raster.width * scale), 'raster width');
  eq(images[2].height, Math.round(raster.height * scale), 'raster height');
  for (const arrow of built.scene.elements.filter((e) => e.type === 'arrow')) {
    for (const binding of [arrow.startBinding, arrow.endBinding]) {
      const anchor = images.find((e) => e.id === binding?.elementId);
      assert(anchor?.boundElements?.some((e) => e.id === arrow.id), 'two-sided image binding');
    }
  }
  const svg = renderer.sceneToSvg(built.scene);
  for (const file of Object.values(built.scene.files)) {
    assert(svg.includes(file.dataURL), 'preview embeds original data URL');
  }
  assert(built.report.icons.every((i) => i.provenance?.sha256), 'build reports shared provenance');
});

test('shared catalog corruption stops resolution instead of silently substituting (#17)', () => {
  // Alter only a child process's in-memory catalog, never the shipped files.
  const drawioUrl = new URL('../skills/arkitect-drawio/scripts/find-icon.mjs', import.meta.url).href;
  const finderUrl = new URL('../skills/arkitect-excalidraw/scripts/find-icon.mjs', import.meta.url).href;
  const source = `import {loadCatalog} from ${JSON.stringify(drawioUrl)};
    import {resolveIcon} from ${JSON.stringify(finderUrl)};
    const icon = loadCatalog().icons.find(i => i.id === 'databases/postgresql');
    icon.sha256 = 'wrong';
    try { resolveIcon('drawio:databases/postgresql'); process.exit(1); }
    catch (e) { if (!e.message.includes('catalog/library mismatch')) throw e; }`;
  execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' });
});

test('Excalidraw CLI emits one metadata-only response when importing the Draw.io resolver (#17)', () => {
  const search = JSON.parse(node('find-icon.mjs', ['postgres']));
  eq(search.draws, 'drawio:databases/postgresql', 'CLI fallback');
  assert(search.matches.some((m) => m.provider === 'drawio'), 'shared search results');
  assert(!JSON.stringify(search).includes('base64'), 'no payload in CLI search');
  const resolved = JSON.parse(node('find-icon.mjs', ['--resolve', 'drawio:databases/postgresql']));
  eq(resolved.provenance.pack, 'databases', 'CLI provenance');
  const stats = JSON.parse(node('find-icon.mjs', ['--stats']));
  eq(stats.sharedPacks, 18, 'shared pack count');
  assert(stats.sharedIcons > 4700, 'shared icon count');
});

test('removing an icon takes its item and index entry with it', () => {
  icons.storeIcon(`${TEST_PREFIX}gone`, Buffer.from(DONUT_SVG, 'utf8'), { trace: true });
  icons.removeIcon(`${TEST_PREFIX}gone`);
  assert(!icons.loadIndex()[`${TEST_PREFIX}gone`], 'index entry removed');
  assert(!existsSync(join(icons.ITEM_DIR, `${TEST_PREFIX}gone.excalidrawlib`)), 'library item removed');
});

// ------------------------------------------------------------- generation

const SPEC = {
  title: 'Test architecture',
  boundaries: [{ id: 'scope', kind: 'scope', label: 'Boundary', color: 'blue' }],
  nodes: [
    { id: 'a', kind: 'box', label: 'Source', col: 0, row: 0 },
    { id: 'b', kind: 'round', label: 'Process', accent: 'green', col: 1, row: 0, parent: 'scope' },
    { id: 'c', kind: 'cylinder', label: 'Store', accent: 'blue', col: 2, row: 0, parent: 'scope', width: 150, height: 120 },
    { id: 'd', kind: 'diamond', label: 'OK?', accent: 'orange', col: 3, row: 0, width: 150, height: 110 },
    { id: 'e', kind: 'actor', label: 'Operator', col: 0, row: 1 },
    { id: 'f', kind: 'icon', icon: `${TEST_PREFIX}donut`, label: 'Traced', col: 1, row: 1 },
    { id: 'g', kind: 'icon', icon: `${TEST_PREFIX}clear`, label: 'Embedded', col: 2, row: 1 },
    { id: 'h', kind: 'note', label: 'Assumption: everything is idempotent.', col: 3, row: 1, width: 260 },
  ],
  edges: [
    { from: 'a', to: 'b', kind: 'flow', label: 'events' },
    { from: 'b', to: 'c', kind: 'flow' },
    { from: 'c', to: 'd', kind: 'async' },
    { from: 'd', to: 'e', kind: 'error', label: 'no' },
  ],
};

const built = builder.buildDiagram(SPEC);

test('a generated scene is valid Excalidraw', () => {
  const r = validator.validateScene(built.scene);
  assert(r.ok, `errors: ${r.errors.join('; ')}`);
  eq(built.scene.type, 'excalidraw', 'scene type');
  eq(new Set(built.scene.elements.map((e) => e.id)).size, built.scene.elements.length, 'unique ids');
});

test('every connector is bound at both ends', () => {
  const arrows = built.scene.elements.filter((e) => e.type === 'arrow' && !(e.groupIds ?? []).length);
  assert(arrows.length >= 4, `expected the spec's arrows, got ${arrows.length}`);
  for (const a of arrows) {
    assert(a.startBinding && a.endBinding, `arrow ${a.id} is not bound at both ends`);
  }
});

test('generated output has no overlapping nodes', () => {
  const r = validator.validateScene(built.scene);
  eq(r.info.overlaps, 0, 'overlaps');
});

test('a boundary is sized from its contents, captions included', () => {
  const scope = built.scene.elements.find((e) => e.type === 'rectangle' && e.strokeStyle === 'dashed');
  assert(scope, 'the scope rectangle exists');
  const kids = ['b', 'c'].map((id) => SPEC.nodes.find((n) => n.id === id));
  for (const kid of kids) {
    const label = built.scene.elements.find((e) => e.type === 'text' && e.text === kid.label);
    if (!label) continue;
    assert(label.x >= scope.x && label.x + label.width <= scope.x + scope.width,
      `label for ${kid.id} pokes out of its boundary`);
    assert(label.y + label.height <= scope.y + scope.height, `caption for ${kid.id} hangs below its boundary`);
  }
});

test('the learned style tokens are applied', () => {
  const shapes = built.scene.elements.filter((e) => ['rectangle', 'ellipse', 'diamond'].includes(e.type));
  assert(shapes.every((s) => s.roughness === 1), 'hand-drawn roughness');
  const strokes = new Set(built.scene.elements.map((e) => e.strokeColor));
  const allowed = new Set([...Object.values(core.PALETTE).map((p) => p.stroke), '#ffffff', '#bbb', '#1971c2']);
  for (const s of strokes) assert(allowed.has(s), `off-palette stroke ${s}`);
  const sizes = new Set(built.scene.elements.filter((e) => e.type === 'text').map((e) => e.fontSize));
  for (const s of sizes) assert(Object.values(core.FONT).includes(s), `off-scale font size ${s}`);
});

test('a legend appears once more than one connector kind is used', () => {
  assert(built.scene.elements.some((e) => e.type === 'text' && e.text === 'Legend'), 'legend title');
  const single = builder.buildDiagram({ ...SPEC, edges: [{ from: 'a', to: 'b', kind: 'flow' }] });
  assert(!single.scene.elements.some((e) => e.type === 'text' && e.text === 'Legend'),
    'a single-kind diagram needs no legend');
});

test('an embedded icon travels with the scene', () => {
  eq(Object.keys(built.scene.files).length, 1, 'one embedded file');
  const img = built.scene.elements.find((e) => e.type === 'image');
  assert(img && built.scene.files[img.fileId], 'the image element points at an embedded file');
  assert(built.scene.files[img.fileId].dataURL.startsWith('data:'), 'embedded, not linked');
});

test('a traced icon becomes native geometry, not a picture', () => {
  const lines = built.scene.elements.filter((e) => e.type === 'line' && (e.groupIds ?? []).length);
  assert(lines.length >= 2, 'the traced icon contributed line elements');
});

test('an unresolvable icon becomes an obvious placeholder, and is reported', () => {
  const r = builder.buildDiagram({
    nodes: [{ id: 'x', kind: 'icon', icon: 'no-such-product-anywhere', label: 'Mystery', col: 0, row: 0 }],
  });
  eq(r.report.missingIcons.length, 1, 'reported as missing');
  eq(r.scene.elements.filter((e) => e.type === 'image').length, 0, 'no substituted image');

  // It has to be impossible to mistake for a finished node, or an unfilled slot
  // ships. Dotted stroke, the placeholder colour, and a "?" drawn in it.
  const slot = r.scene.elements.find((e) => e.type === 'rectangle' && e.strokeStyle === 'dotted');
  assert(slot, 'a dotted slot was drawn');
  eq(slot.strokeColor, builder.PLACEHOLDER.stroke, 'placeholder stroke colour');
  assert(r.scene.elements.some((e) => e.type === 'text' && e.text === '?'), 'marked with a question mark');
  // And it still says which product belongs there.
  assert(r.scene.elements.some((e) => e.type === 'text' && e.text === 'Mystery'), 'captioned');
});

test('kind "placeholder" asks for a slot without pretending to search', () => {
  const r = builder.buildDiagram({
    nodes: [{ id: 'x', kind: 'placeholder', label: 'Vault', col: 0, row: 0 }],
  });
  eq(r.report.missingIcons.length, 1, 'listed for the report');
  assert(r.scene.elements.some((e) => e.type === 'rectangle' && e.strokeStyle === 'dotted'), 'slot drawn');
});

test('an unknown node or edge kind is named in the report, and constructor is not a kind (#48)', () => {
  const spec = {
    nodes: [{ id: 'a', kind: 'box', label: 'A', col: 0, row: 0 }, { id: 'b', kind: 'cilinder', label: 'B', col: 1, row: 0 },
      { id: 'c', kind: 'constructor', label: 'C', col: 2, row: 0 }],
    edges: [{ from: 'a', to: 'b', kind: 'asnyc' }, { from: 'b', to: 'c', kind: 'constructor' }, { from: 'a', to: 'c', kind: 'async' }],
  };
  const r = builder.buildDiagram(spec);
  eq(JSON.stringify(r.report.unknownKinds.map((u) => [u.field, u.value, u.drawnAs])), JSON.stringify([
    ['nodes[1].kind', 'cilinder', 'round'], ['nodes[2].kind', 'constructor', 'round'],
    ['edges[0].kind', 'asnyc', 'flow'], ['edges[1].kind', 'constructor', 'flow'],
  ]), 'every unknown kind, in spec order, with its fallback');
  for (const u of r.report.unknownKinds) {
    assert(u.valid.includes(u.field.startsWith('nodes') ? 'cylinder' : 'async') && !u.valid.includes(u.value), `${u.field} lists the valid kinds`);
  }
  eq(builder.buildDiagram({ ...spec, style: { rounded: false } }).report.unknownKinds[0].drawnAs, 'box', 'the node fallback follows the style');

  // The constructor edge used to look its kind up through the prototype and
  // draw an arrow with no stroke colour, width or style.
  const flow = builder.EDGE_KINDS.flow;
  const arrows = r.scene.elements.filter((e) => e.type === 'arrow' && e.startBinding);
  eq(arrows.length, 3, 'every edge drawn');
  for (const [i, a] of arrows.slice(0, 2).entries()) {
    eq(JSON.stringify([a.strokeColor, a.strokeWidth, a.strokeStyle]), JSON.stringify([flow.color, flow.width, flow.strokeStyle]),
      `edge ${i} is drawn as a flow`);
  }
  assert(!r.scene.elements.some((e) => e.type === 'text' && /undefined/.test(e.text ?? '')), 'the legend names no undefined kind');
  eq(builder.buildDiagram({
    nodes: [spec.nodes[0], { id: 'd', kind: 'cylinder', label: 'D', col: 1, row: 0 }],
    edges: [{ from: 'a', to: 'd', kind: 'data' }, { from: 'd', to: 'a' }],
  }).report.unknownKinds.length, 0, 'known and omitted kinds report nothing');

  const specPath = join(TMP, 'unknown-kinds.spec.json');
  writeFileSync(specPath, JSON.stringify(spec));
  const out = JSON.parse(execFileSync(process.execPath,
    [join(SCRIPTS, 'build-diagram.mjs'), specPath, '--out', join(TMP, 'unknown-kinds.excalidraw')], { encoding: 'utf8' }));
  eq(JSON.stringify(out.unknownKinds.map((u) => u.value)), JSON.stringify(['cilinder', 'constructor', 'asnyc', 'constructor']),
    'the CLI prints them and the build still succeeds');
});

// ------------------------------------------------------------- bundled libraries

test('the bundled index matches the libraries on disk', () => {
  const index = libIndex.loadIndex();
  assert(index.libraries.length > 0, 'libraries are indexed');
  const onDisk = readdirSync(libIndex.BUNDLED_DIR).filter((n) => n.endsWith('.excalidrawlib')).sort();
  eq(index.libraries.map((l) => l.file).sort().join(','), onDisk.join(','),
    'index is stale - run: node index-libraries.mjs --build');
  eq(index.items.length, index.libraries.reduce((n, l) => n + l.items, 0), 'item count adds up');
  for (const l of index.libraries) {
    assert(existsSync(join(libIndex.BUNDLED_DIR, l.file)), `${l.slug} file is present`);
  }
});

test('the bundled libraries ship compact, and the index records their real sizes (#118)', () => {
  const index = libIndex.loadIndex();
  let total = 0;
  for (const l of index.libraries) {
    const path = join(libIndex.BUNDLED_DIR, l.file);
    const raw = readFileSync(path, 'utf8');
    eq(libIndex.compactLibrary(raw), raw, `${l.file} carries formatting whitespace - run: node index-libraries.mjs --build`);
    eq(l.bytes, Buffer.byteLength(raw), `${l.file} size in the index`);
    total += l.bytes;
  }
  eq(index.totals.bytes, total, 'the index total');
  assert(total <= 11.2e6, `the bundled libraries grew to ${total} bytes`);
  // Compacting keeps every parsed value, item order included, or declines.
  const pretty = JSON.stringify({ type: 'excalidrawlib', libraryItems: [{ id: 'b' }, { id: 'a', n: 1.5e-7 }] }, null, 2);
  eq(libIndex.compactLibrary(pretty), '{"type":"excalidrawlib","libraryItems":[{"id":"b"},{"id":"a","n":1.5e-7}]}\n', 'compact form');
  eq(libIndex.compactLibrary('{"x": -0}'), null, 'a -0 would print as 0, so the file is left alone');
});

test('no bundled item is given a name nobody gave it', () => {
  const index = libIndex.loadIndex();
  for (const it of index.items) {
    if (it.name === null) { eq(it.nameFrom, null, `${it.ref} has no name and claims no source`); continue; }
    assert(it.nameFrom === 'library' || it.nameFrom === 'caption',
      `${it.ref} must say where its name came from, not invent one`);
  }
  // An unnamed item must not be searchable, or a query would resolve to it by
  // its slug and draw the wrong product.
  const named = new Set(finder.catalog().filter((e) => e.provider === 'bundled').map((e) => e.ref));
  for (const it of index.items) {
    if (!it.name) assert(!named.has(it.ref), `${it.ref} is unnamed and must stay out of search`);
  }
});

test('a bundled item resolves by name and by index', () => {
  const index = libIndex.loadIndex();
  const sample = index.items.find((it) => it.name && it.elements > 0);
  assert(sample, 'the bundled set has at least one named item');

  const byRef = finder.resolveIcon(sample.ref);
  assert(byRef && byRef.elements.length === sample.elements, `${sample.ref} resolves by index`);
  eq(byRef.kind, 'bundled', 'reported as bundled');

  const byName = finder.resolveIcon(sample.name);
  assert(byName && byName.elements.length > 0, `"${sample.name}" resolves by name`);
});

test('the bundled set is preferred over a house icon of the same name', () => {
  const bundled = { provider: 'bundled', name: 'x', aliases: ['acme'] };
  const house = { provider: 'house', name: 'x', aliases: ['acme'] };
  const cached = { provider: 'some-library', name: 'x', aliases: ['acme'] };
  assert(finder.score(bundled, 'acme') > finder.score(house, 'acme'), 'bundled beats house');
  assert(finder.score(house, 'acme') > finder.score(cached, 'acme'), 'house beats the download cache');
});

test('every library with unnamed items has a contact sheet to read', () => {
  const index = libIndex.loadIndex();
  const sheets = join(libIndex.BUNDLED_DIR, 'sheets');
  for (const l of index.libraries) {
    if (!l.unnamed) continue;
    assert(existsSync(join(sheets, `${l.slug}.png`)),
      `${l.slug} has ${l.unnamed} unnamed items and no sheet - run: index-libraries.mjs --sheet ${l.slug}`);
  }
});

test('every bundled library is credited', () => {
  const index = libIndex.loadIndex();
  const attribution = readFileSync(join(libIndex.BUNDLED_DIR, 'ATTRIBUTION.md'), 'utf8');
  for (const l of index.libraries) {
    assert(l.authors.length > 0, `${l.slug} has no author recorded in authors.json`);
    assert(attribution.includes(l.slug), `${l.slug} is missing from ATTRIBUTION.md`);
  }
});

test('an item that draws its own name is not captioned twice', () => {
  const index = libIndex.loadIndex();
  // A caption-named item carries its name as text, which is exactly the case
  // that used to print the product name twice, one line under the other.
  const selfNamed = index.items.find((it) => it.nameFrom === 'caption');
  if (!selfNamed) return 'skip';
  const r = builder.buildDiagram({
    nodes: [{ id: 'x', kind: 'icon', icon: selfNamed.ref, label: selfNamed.name, col: 0, row: 0 }],
  });
  const captions = r.scene.elements.filter((e) => e.type === 'text'
    && core.normalizeName(e.text ?? '') === core.normalizeName(selfNamed.name));
  eq(captions.length, 1, `"${selfNamed.name}" appears once, not twice`);
  eq(r.report.selfCaptioned.length, 1, 'reported as self-captioned');
});

test('an existing file is backed up before it is replaced', () => {
  const out = join(TMP, 'backup-check.excalidraw');
  writeFileSync(out, JSON.stringify(core.emptyScene()));
  node('build-diagram.mjs', [writeSpec('backup.json', SPEC), '--out', out]);
  const backups = readdirSync(TMP).filter((f) => f.includes('.backup-'));
  eq(backups.length, 1, 'exactly one backup');
});

test('rapid updates in the same second never overwrite an earlier backup (#35)', () => {
  const dir = join(TMP, 'rapid-backups');
  mkdirSync(dir, { recursive: true });
  const target = join(dir, 'rapid.excalidraw');
  const now = new Date('2026-09-13T10:15:00.000Z');
  // Someone else's backup already holds the first name for this second.
  const taken = join(dir, 'rapid.backup-20260913-101500.excalidraw');
  writeFileSync(taken, 'pre-existing');
  const versions = ['original', 'first revision', 'second revision'];
  const backups = versions.map((v) => { writeFileSync(target, v); return core.backupExisting(target, { now }); });
  eq(new Set(backups).size, versions.length, 'every call wrote its own backup');
  eq(readFileSync(taken, 'utf8'), 'pre-existing', 'a pre-existing backup was overwritten');
  versions.forEach((v, i) => eq(readFileSync(backups[i], 'utf8'), v, `backup ${i} lost its version`));
  assert(backups[0].endsWith('rapid.backup-20260913-101500-1.excalidraw'), `unexpected collision name: ${backups[0]}`);
  assert(backups[2].endsWith('rapid.backup-20260913-101500-3.excalidraw'), `unexpected collision name: ${backups[2]}`);
});

test('retention keeps the oldest backup and the newest five, and touches nothing else (#49)', () => {
  const dir = join(TMP, 'retention');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const target = join(dir, 'arch.excalidraw');
  const name = (p) => p.split(/[\\/]/).pop();
  // Not backups of this target: a hand-named copy, another scene's, the other
  // engine's extension, a lookalike stem, a counter the builder never writes.
  const foreign = ['arch.backup-old.excalidraw', 'other.backup-20260913-101500.excalidraw', 'arch.backup-20260913-101500.drawio',
    'arch.v2.backup-20260913-101500.excalidraw', 'arch.backup-20260913-101500-0.excalidraw'];
  for (const f of foreign) writeFileSync(join(dir, f), 'not ours');
  const now = new Date('2026-09-13T10:15:00.000Z');
  const made = [];
  for (let i = 0; i < 12; i++) {
    writeFileSync(target, `version ${i}`);
    made.push(core.backupExisting(target, { now }));
    core.pruneBackups(target);
  }
  eq(new Set(made).size, made.length, 'a counter freed by pruning is never reused, so the newest backup is never pruned');
  const ours = () => readdirSync(dir).filter((f) => f !== 'arch.excalidraw' && !foreign.includes(f)).sort();
  eq(JSON.stringify(ours()), JSON.stringify([made[0], ...made.slice(7)].map(name).sort()),
    'the oldest and the newest five, with -10 and -11 counted as newer than -2');
  eq(readFileSync(made[0], 'utf8'), 'version 0', 'the oldest backup still holds the first version');
  for (const f of foreign) eq(readFileSync(join(dir, f), 'utf8'), 'not ours', `${f} was touched`);

  core.backupExisting(target, { now: new Date('2026-09-13T10:15:01.000Z') });
  eq(JSON.stringify(core.pruneBackups(target).map(name)), JSON.stringify([name(made[7])]),
    'a later second is newer than every counter of an earlier one');
  eq(JSON.stringify(core.pruneBackups(target, { keep: 1 }).map(name)), JSON.stringify(made.slice(8).map(name)),
    'keep 1 leaves the oldest and the newest');
  core.backupExisting(target, { now });
  eq(core.pruneBackups(target, { keep: 0 }).length, 0, 'keep 0 deletes nothing');
  for (const bad of [-1, 1.5, NaN, '5']) {
    let threw = false;
    try { core.pruneBackups(target, { keep: bad }); } catch { threw = true; }
    assert(threw, `keep ${JSON.stringify(bad)} was accepted`);
  }
  eq(core.pruneBackups(join(dir, 'no-such-dir', 'arch.excalidraw')).length, 0, 'a missing directory prunes nothing');
});

test('build prunes old backups only after writing, and --keep-backups sets how many (#49)', () => {
  const dir = join(TMP, 'retention-cli');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'arch.excalidraw');
  const specPath = join(dir, 'spec.json');
  writeFileSync(specPath, JSON.stringify({ nodes: [{ id: 'a', kind: 'box', label: 'A', col: 0, row: 0 }] }));
  const build = (...extra) => {
    try {
      return { status: 0, stdout: execFileSync(process.execPath, [join(SCRIPTS, 'build-diagram.mjs'), specPath, '--out', out, ...extra], { encoding: 'utf8', stdio: 'pipe' }) };
    } catch (error) {
      return { status: error.status, stdout: String(error.stdout ?? '') };
    }
  };
  const backupsOf = () => readdirSync(dir).filter((f) => f.startsWith('arch.backup-'));
  let report;
  for (let i = 0; i < 8; i++) {
    const r = build();
    eq(r.status, 0, `build ${i}`);
    report = JSON.parse(r.stdout);
  }
  eq(backupsOf().length, 6, 'seven rebuilds leave the oldest backup and the newest five');
  eq(report.pruned.length, 1, 'the last build reports the backup it pruned');
  assert(!existsSync(report.pruned[0]) && existsSync(report.backup), 'the pruned backup is gone and the new one stays');
  const two = JSON.parse(build('--keep-backups', '2').stdout);
  eq(two.pruned.length, 4, '--keep-backups 2 reports the four it removed');
  eq(backupsOf().length, 3, 'and leaves the oldest and the newest two');
  eq(JSON.parse(build('--keep-backups', '0').stdout).pruned.length, 0, '--keep-backups 0 removes nothing');
  eq(backupsOf().length, 4, 'and keeps the new backup');
  for (const bad of [['--keep-backups', '-1'], ['--keep-backups', 'two'], ['--keep-backups', '1.5'], ['--keep-backups']]) {
    eq(build(...bad).status, 2, `${bad.join(' ')} exits 2`);
  }
  eq(backupsOf().length, 4, 'a refused flag writes no backup and deletes none');
});

// ------------------------------------------------------------- spec checks (#36)

test('a spec naming a missing node is refused before anything is backed up or written (#36)', () => {
  const dir = join(TMP, 'spec-refused');
  mkdirSync(dir, { recursive: true });
  const specPath = join(dir, 'bad.spec.json');
  writeFileSync(specPath, JSON.stringify({
    nodes: [{ id: 'api', label: 'API', kind: 'box', col: 0, row: 0 }],
    edges: [{ from: 'api', to: 'missing' }],
  }));
  const out = join(dir, 'bad.excalidraw');
  writeFileSync(out, 'original');
  let status = 0; let stderr = '';
  try {
    execFileSync(process.execPath, [join(ROOT, 'bin', 'arkitect.mjs'), 'excalidraw', 'build', specPath, '--out', out],
      { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) { status = e.status; stderr = e.stderr; }
  eq(status, 1, 'exit status');
  const body = JSON.parse(stderr);
  eq(body.ok, false, 'reported as not ok');
  assert(body.errors.some((e) => e.startsWith('edges[0].to: "missing"')), `errors: ${body.errors.join('; ')}`);
  eq(readFileSync(out, 'utf8'), 'original', 'the existing target was changed');
  eq(readdirSync(dir).filter((f) => f.includes('.backup-')).length, 0, 'a refused build wrote a backup');
});

test('spec checks list every broken reference, id clash and cycle in one run (#36)', () => {
  const spec = {
    boundaries: [
      { id: 'outer', parent: 'inner' },
      { id: 'inner', parent: 'outer' },
      { id: 'vpc' },
    ],
    nodes: [
      { id: 'a', col: 0, row: 0, parent: 'nowhere' },
      { id: 'vpc', col: 1, row: 0 },
      { label: 'no id', col: 2, row: 0 },
    ],
    edges: [
      { from: 'a', to: 'ghost' },
      { from: 'a', to: 'outer' },
      { to: 'a' },
    ],
  };
  const errors = builder.validateSpec(spec);
  for (const expected of [
    'nodes[0].parent: "nowhere" is not a boundary id',
    'nodes[1].id: "vpc" is already used by boundaries[2]',
    'nodes[2].id: expected a non-empty string',
    'boundaries[0].parent: boundary "outer" is nested inside itself',
    'boundaries[1].parent: boundary "inner" is nested inside itself',
    'edges[0].to: "ghost" is not a node id',
    'edges[1].to: "outer" is a boundary; Excalidraw connects nodes only',
    'edges[2].from: missing',
  ]) {
    assert(errors.some((e) => e.startsWith(expected)), `missing "${expected}" in:\n        ${errors.join('\n        ')}`);
  }
  let thrown = null;
  try { builder.buildDiagram(spec); } catch (e) { thrown = e; }
  assert(thrown instanceof builder.SpecError, 'buildDiagram did not refuse the spec');
  eq(thrown.errors.length, errors.length, 'the thrown error carries every problem');
});

// ------------------------------------------------------------- spec numbers (#115)

test('numeric spec fields are checked in one run, each problem naming its field (#115)', () => {
  const problems = builder.validateSpec({
    layout: { cell: -100 },
    style: { roughness: -1, iconSize: '100', strokeWidth: 0, edgeColor: '#000' },
    legendX: 'right',
    boundaries: [{ id: 'z', label: 'Z', col: 0, row: 0, rows: 0, padLeft: -5, fontSize: 0 }],
    nodes: [
      { id: 'a', label: 'A', col: 'oops', row: 0 },
      { id: 'b', label: 'B', col: 1, row: 0, size: -1, fontFamily: 'Virgil', roughness: -2 },
    ],
    edges: [{ from: 'a', to: 'b', gap: -3, labelSize: '11', strokeWidth: -1 }],
  });
  const expected = [
    'layout.cell: expected a number greater than 0, got -100',
    'style.iconSize: expected a number greater than 0, got "100"',
    'style.strokeWidth: expected a number greater than 0, got 0',
    'style.roughness: expected a number of at least 0, got -1',
    'spec.legendX: expected a finite number, got "right"',
    'boundaries[0].rows: expected a number of at least 1, got 0',
    'boundaries[0].padLeft: expected a number of at least 0, got -5',
    'boundaries[0].fontSize: expected a number greater than 0, got 0',
    'nodes[0].col: expected a finite number, got "oops"',
    'nodes[1].size: expected a number greater than 0, got -1',
    'nodes[1].fontFamily: expected a number greater than 0, got "Virgil"',
    'nodes[1].roughness: expected a number of at least 0, got -2',
    'edges[0].gap: expected a number of at least 0, got -3',
    'edges[0].labelSize: expected a number greater than 0, got "11"',
    'edges[0].strokeWidth: expected a number greater than 0, got -1',
  ];
  eq(problems.join('\n'), expected.join('\n'), 'every numeric problem; a string style token is left to the style checks');
  eq(builder.validateSpec({ style: [] }).join(), 'style: expected an object', 'a style that is not an object');

  // The issue's case: a string column used to build a scene that then failed validation.
  let thrown;
  try { builder.buildDiagram({ nodes: [{ id: 'a', label: 'A', col: 'oops', row: 0 }] }); } catch (e) { thrown = e; }
  assert(thrown instanceof builder.SpecError, 'buildDiagram refuses the spec instead of drawing at NaN');

  // What stays valid: no col or row (0), fractional and negative coordinates, Unicode.
  const { scene } = builder.buildDiagram({ nodes: [
    { id: 'a', kind: 'box', label: 'A' },
    { id: 'b', kind: 'box', label: 'Zürich — 東京', col: 1.5, row: -0.5 },
  ], edges: [{ from: 'a', to: 'b' }] });
  const v = validator.validateScene(scene);
  assert(v.ok, `the scene validates: ${v.errors.join('; ')}`);
});

test('a spec with a bad number is refused on the command line before any backup or write (#115)', () => {
  const dir = join(TMP, 'spec-numbers');
  mkdirSync(dir, { recursive: true });
  const specPath = join(dir, 'bad.spec.json');
  writeFileSync(specPath, JSON.stringify({ nodes: [{ id: 'a', kind: 'box', label: 'A', col: 'oops', row: 0, width: -10 }] }));
  const out = join(dir, 'bad.excalidraw');
  writeFileSync(out, 'original');
  const r = spawnSync(process.execPath, [join(SCRIPTS, 'build-diagram.mjs'), specPath, '--out', out], { encoding: 'utf8' });
  eq(r.status, 1, 'exit status');
  eq(JSON.parse(r.stderr).errors.join(' | '),
    'nodes[0].col: expected a finite number, got "oops" | nodes[0].width: expected a number greater than 0, got -10', 'both fields named');
  eq(readFileSync(out, 'utf8'), 'original', 'the existing target is untouched');
  eq(readdirSync(dir).filter((f) => f.includes('.backup-')).length, 0, 'no backup was written');
});

test('a nested-boundary spec builds with every requested arrow bound (#36)', () => {
  const spec = {
    boundaries: [
      { id: 'outer', label: 'Outer' },
      { id: 'inner', label: 'Inner', parent: 'outer' },
    ],
    nodes: [
      { id: 'a', kind: 'box', label: 'A', col: 0, row: 0, parent: 'outer' },
      { id: 'b', kind: 'box', label: 'B', col: 1, row: 0, parent: 'inner' },
      { id: 'c', kind: 'box', label: 'C', col: 2, row: 0, parent: 'inner' },
    ],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', kind: 'async' }],
  };
  eq(builder.validateSpec(spec).length, 0, 'a valid nested spec was refused');
  const r = builder.buildDiagram(spec);
  const v = validator.validateScene(r.scene);
  assert(v.ok, `errors: ${v.errors.join('; ')}`);
  const arrows = r.scene.elements.filter((e) => e.type === 'arrow' && !(e.groupIds ?? []).length);
  eq(arrows.length, 2, 'every requested connection was drawn');
  for (const a of arrows) assert(a.startBinding && a.endBinding, `arrow ${a.id} is not bound at both ends`);
  eq(r.report.notes.length, 0, 'nothing was skipped');
});

function writeSpec(name, spec) {
  const p = join(TMP, name);
  writeFileSync(p, JSON.stringify(spec));
  return p;
}

// ------------------------------------------------------------- validation

test('the validator rejects duplicate ids', () => {
  const scene = core.emptyScene();
  const a = core.rectangle({ x: 0, y: 0, width: 10, height: 10 });
  scene.elements = [a, { ...a }];
  assert(!validator.validateScene(scene).ok, 'duplicate ids must fail');
});

test('the validator rejects a one-sided binding', () => {
  const scene = core.emptyScene();
  const a = core.rectangle({ x: 0, y: 0, width: 50, height: 50 });
  const arr = core.arrow({ x: 50, y: 25, points: [[0, 0], [100, 0]] });
  arr.endBinding = { elementId: a.id, focus: 0, gap: 4 };
  scene.elements = [a, arr];
  const r = validator.validateScene(scene);
  assert(!r.ok && r.errors.some((e) => /does not list it back/.test(e)), 'one-sided binding must fail');
});

test('a grouped one-ended arrow is composition and is not warned about', () => {
  const scene = core.emptyScene();
  const dot = core.ellipse({ x: 0, y: 0, width: 6, height: 6 });
  const arr = core.arrow({ x: 0, y: 0, points: [[0, 0], [0, -20]] });
  arr.startBinding = { elementId: dot.id, focus: 0, gap: 4 };
  dot.boundElements = [{ id: arr.id, type: 'arrow' }];
  dot.groupIds = ['glyph'];
  arr.groupIds = ['glyph'];
  scene.elements = [dot, arr];
  const r = validator.validateScene(scene);
  assert(r.ok, 'a consistent grouped glyph must validate cleanly');
  assert(!r.warnings.some((w) => /bound at only one end/.test(w)), 'a grouped glyph arrow must not be flagged');
});

test('a standalone one-ended arrow is still warned about', () => {
  const scene = core.emptyScene();
  const box = core.rectangle({ x: 0, y: 0, width: 50, height: 50 });
  const arr = core.arrow({ x: 0, y: 25, points: [[0, 0], [100, 0]] });
  arr.endBinding = { elementId: box.id, focus: 0, gap: 4 };
  box.boundElements = [{ id: arr.id, type: 'arrow' }];
  scene.elements = [box, arr];
  const r = validator.validateScene(scene);
  assert(r.warnings.some((w) => /bound at only one end/.test(w)), 'a real one-ended arrow must still be flagged');
});

test('the validator rejects an image with no embedded file', () => {
  const scene = core.emptyScene();
  scene.elements = [core.image({ fileId: 'missing', x: 0, y: 0, width: 10, height: 10 })];
  assert(!validator.validateScene(scene).ok, 'missing file must fail');
});

test('the validator rejects out-of-order index keys', () => {
  const scene = core.emptyScene();
  scene.elements = [
    core.rectangle({ x: 0, y: 0, width: 10, height: 10, index: 'a5' }),
    core.rectangle({ x: 40, y: 0, width: 10, height: 10, index: 'a2' }),
  ];
  const r = validator.validateScene(scene);
  assert(!r.ok && r.errors.some((e) => /index keys/.test(e)), 'z-order must be increasing');
});

test('the validator accepts a library file', () => {
  const p = join(TMP, 'lib-check.excalidrawlib');
  core.writeLibrary(p, [{ name: 'x', elements: [core.rectangle({ x: 0, y: 0, width: 10, height: 10 })] }]);
  assert(validator.validateFile(p).ok, 'a well-formed library should pass');
});

// A scene the app would never have written used to reach the geometry helpers
// and throw, so the caller got a stack trace and no result, and a batch stopped
// at that file; other malformed numbers passed as ok (#154). Every shape below
// must come back as an ordinary structured failure naming the field.
const MALFORMED_SCENES = [
  ['a null document', null, /the scene is null/],
  ['a document that is an array', [], /the scene is an array/],
  ['a null element', { type: 'excalidraw', elements: [null] }, /element at index 0 is null/],
  ['an element that is a string', { type: 'excalidraw', elements: ['rect'] }, /element at index 0 is a string/],
  ['null arrow points', { type: 'excalidraw', elements: [{ id: 'a', type: 'arrow', x: 0, y: 0, points: [null, null] }] },
    /point 0 is not a pair of numbers/],
  ['a point that is one number', { type: 'excalidraw', elements: [{ id: 'a', type: 'arrow', x: 0, y: 0, points: [[0], [1, 1]] }] },
    /point 0 is not a pair of numbers/],
  ['points that are not an array', { type: 'excalidraw', elements: [{ id: 'a', type: 'line', x: 0, y: 0, points: 'straight' }] },
    /non-array points/],
  ['a string width', { type: 'excalidraw', elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 'oops', height: 10 }] },
    /has non-numeric width/],
  ['a null height', { type: 'excalidraw', elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: null }] },
    /has non-numeric height/],
  ['a non-finite x', { type: 'excalidraw', elements: [{ id: 'a', type: 'rectangle', x: 'left', y: 0, width: 10, height: 10 }] },
    /has non-numeric x/],
  ['a null boundElements entry',
    { type: 'excalidraw', elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, boundElements: [null] }] },
    /boundElements 0 does not name an element id/],
  ['boundElements that is not an array',
    { type: 'excalidraw', elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, boundElements: 'b' }] },
    /non-array boundElements/],
  ['a binding that is a bare string',
    { type: 'excalidraw', elements: [{ id: 'a', type: 'arrow', x: 0, y: 0, points: [[0, 0], [1, 1]], startBinding: 'b' }] },
    /startBinding that does not name an element/],
  ['groupIds that are not strings',
    { type: 'excalidraw', elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, groupIds: [7] }] },
    /groupIds that are not a list of strings/],
  ['a numeric frameId',
    { type: 'excalidraw', elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, frameId: 3 }] },
    /non-string frameId/],
  ['a deleted element with a broken boundElements',
    { type: 'excalidraw', elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, isDeleted: true, boundElements: 'b' }] },
    /non-array boundElements/],
  ['files that is not an object', { type: 'excalidraw', elements: [], files: [] }, /files is not an object/],
  ['a file entry that is a string',
    { type: 'excalidraw', elements: [], files: { f: 'data:image/png;base64,AA==' } }, /file "f" is a string/],
];

test('malformed scene structures fail with a named field and never throw (#154)', () => {
  for (const [what, doc, expected] of MALFORMED_SCENES) {
    let r;
    try {
      r = validator.validateScene(doc);
    } catch (error) {
      throw new Error(`${what} threw instead of reporting: ${error.message}`);
    }
    eq(r.ok, false, `${what} must fail`);
    assert(r.errors.some((e) => expected.test(e)),
      `${what} must name the field, got: ${r.errors.join('; ')}`);
    assert(!r.errors.some((e) => /could not be validated/.test(e)),
      `${what} must be caught by the shape pass, not the backstop`);
  }
});

// Excalidraw stores a connector's shape in points, so an arrow drawn straight
// down has width 0 and is perfectly legal; only a dimension that is not a
// number is malformed (#154).
test('a zero-dimensional arrow is legal where a non-numeric one is not (#154)', () => {
  const scene = core.emptyScene();
  const box = core.rectangle({ x: 0, y: 0, width: 60, height: 40 });
  const arr = core.arrow({ x: 30, y: 40, points: [[0, 0], [0, 80]] });
  arr.startBinding = { elementId: box.id, focus: 0, gap: 4 };
  box.boundElements = [{ id: arr.id, type: 'arrow' }];
  scene.elements = [box, arr];
  eq(core.elementBox(arr).width, 0, 'the arrow really is zero-width');
  const r = validator.validateScene(scene);
  eq(r.ok, true, `a straight vertical arrow must still validate: ${r.errors.join('; ')}`);
  assert(!r.warnings.some((w) => /zero or negative size/.test(w)), 'and must not be warned about for its width');

  const bad = core.emptyScene();
  bad.elements = [{ ...core.rectangle({ x: 0, y: 0, width: 10, height: 10 }), width: '10' }];
  assert(!validator.validateScene(bad).ok, 'a rectangle whose width is a string must fail');
});

test('malformed library structures fail without throwing, item by item (#154)', () => {
  const good = [core.rectangle({ x: 0, y: 0, width: 10, height: 10 })];
  const cases = [
    ['a null document', null, /the library is null/],
    ['an item that is null', { type: 'excalidrawlib', libraryItems: [null] }, /item 0 is null/],
    ['an item whose elements are a string', { type: 'excalidrawlib', libraryItems: [{ elements: 'rect' }] },
      /item 0 is a string/],
    ['a v1 entry that is not a list', { type: 'excalidrawlib', library: [42] }, /item 0 is a number/],
    ['a malformed element inside an item', { type: 'excalidrawlib', libraryItems: [{ elements: [null] }] },
      /item 0: element at index 0 is null/],
  ];
  for (const [what, doc, expected] of cases) {
    let r;
    try {
      r = validator.validateLibrary(doc);
    } catch (error) {
      throw new Error(`${what} threw instead of reporting: ${error.message}`);
    }
    eq(r.ok, false, `${what} must fail`);
    assert(r.errors.some((e) => expected.test(e)), `${what} must say which item, got: ${r.errors.join('; ')}`);
  }

  // One bad item must not hide the ones after it.
  const mixed = validator.validateLibrary({ type: 'excalidrawlib', libraryItems: [null, { elements: [] }, { elements: good }] });
  assert(mixed.errors.some((e) => /item 0 is null/.test(e)), 'item 0 is reported');
  assert(mixed.errors.some((e) => /item 1 has no elements/.test(e)), 'and item 1 is still reached');
});

// The gate is a command, not only a function: batch tooling reads its stdout.
test('a malformed file does not cost the batch the files after it (#154)', () => {
  const badPath = join(TMP, 'batch-malformed.excalidraw');
  const goodPath = join(TMP, 'batch-fine.excalidraw');
  writeFileSync(badPath, 'null');
  const scene = core.emptyScene();
  scene.elements = [core.rectangle({ x: 0, y: 0, width: 40, height: 20 })];
  writeFileSync(goodPath, JSON.stringify(scene));

  const r = spawnSync(process.execPath, [join(SCRIPTS, 'validate-excalidraw.mjs'), badPath, goodPath, '--json'], { encoding: 'utf8' });
  eq(r.status, 1, 'the run fails because one file is malformed');
  eq(r.stderr.trim(), '', `nothing is written to stderr, got: ${r.stderr.trim()}`);
  const reports = r.stdout.trim().split(/(?=^\{$)/m).map((chunk) => JSON.parse(chunk));
  eq(reports.length, 2, 'both files are reported');
  eq(reports[0].ok, false, 'the malformed file fails');
  eq(reports[1].ok, true, `the file after it is still checked: ${reports[1].errors.join('; ')}`);
});

// ------------------------------------------------------------- render

test('the renderer produces an SVG covering every element', () => {
  const svg = renderer.sceneToSvg(built.scene);
  assert(svg.startsWith('<?xml'), 'is an SVG document');
  assert(svg.includes('<image'), 'embedded images are drawn');
  assert(svg.includes('Test architecture'), 'the title is drawn');
  const m = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg);
  assert(m, 'has a viewBox');
  const box = core.bbox(built.scene.elements);
  assert(Number(m[3]) >= box.width && Number(m[4]) >= box.height, 'the viewBox covers the scene');
});

test('the render is stable across runs', () => {
  eq(renderer.sceneToSvg(built.scene), renderer.sceneToSvg(built.scene), 'same scene, same SVG');
});

// A scene file is user input, and the preview is meant to be opened. A
// strokeColor of `#1e1e1e"><script>` used to close the attribute, close the
// element and write its own script, which ran on open - reaching the network
// from a file:// page with the diagram in hand (#150).
test('no scene field can write an attribute or an element into the preview (#150)', () => {
  const payload = '#1e1e1e" /><script>window.PROBE=1</script><path d="';
  // Every field the renderer interpolates, poisoned, beside the benign twin
  // the output is compared against.
  const poison = {
    strokeColor: payload,
    backgroundColor: payload,
    fillStyle: `hachure" x="${payload}`,
    strokeWidth: '1" onload="PROBE',
    strokeStyle: `dashed" onmouseover="PROBE`,
    fontSize: '20" onload="PROBE',
    opacity: '100" onload="PROBE',
    angle: '0.1" onload="PROBE',
    lineHeight: '1.25" onload="PROBE',
  };
  const benign = {
    strokeColor: '#1e1e1e', backgroundColor: '#ffec99', fillStyle: 'hachure',
    strokeWidth: 1, strokeStyle: 'dashed', fontSize: 20, opacity: 100,
    angle: 0.1, lineHeight: 1.25,
  };
  const build = (v) => ({
    type: 'excalidraw',
    version: 2,
    source: 'test',
    appState: { viewBackgroundColor: v === poison ? payload : '#ffffff' },
    elements: [
      { id: 'r', type: 'rectangle', x: 0, y: 0, width: 120, height: 60, seed: 1, ...v },
      { id: 'd', type: 'diamond', x: 0, y: 80, width: 120, height: 60, seed: 2, ...v },
      { id: 'e', type: 'ellipse', x: 0, y: 160, width: 120, height: 60, seed: 3, ...v },
      { id: 'a', type: 'arrow', x: 0, y: 240, width: 100, height: 0, seed: 4,
        points: [[0, 0], [100, 0]], startArrowhead: 'dot', endArrowhead: 'triangle', ...v },
      { id: 't', type: 'text', x: 0, y: 260, width: 120, height: 25, text: 'PROBE_TEXT', seed: 5, ...v },
      { id: 'f', type: 'frame', x: 0, y: 300, width: 200, height: 80, seed: 6, name: payload, ...v },
      { id: 'i', type: 'image', x: 0, y: 400, width: 40, height: 40, fileId: 'one', seed: 7, ...v },
      { id: 'b', type: 'embeddable', x: 0, y: 460, width: 40, height: 40, seed: 8, ...v },
    ],
    files: { one: { dataURL: 'data:image/svg+xml;base64,<script>window.PROBE=1</script>' } },
  });

  const svg = renderer.sceneToSvg(build(poison));
  assert(!/<script/i.test(svg), 'no script element reaches the preview');
  assert(!/\son[a-z]+\s*=/i.test(svg), 'no event-handler attribute reaches the preview');
  // A frame name is a label: it is drawn, escaped, and that is correct. What
  // must never appear is the payload copied through as markup.
  assert(!svg.includes(payload), 'the payload is never written verbatim');
  assert(!/<\/?(script|foreignObject|iframe|use|a)/i.test(svg), 'and no element that could carry behaviour');
  assert(!/(NaN|Infinity)/.test(svg), 'and no nonfinite number is written');
  eq(xml.checkXml(svg).ok, true, 'the preview is well-formed XML');

  // The strict check: a rejected value may draw less - no hachure pattern, no
  // rotation - but it must never add one tag or one attribute name the same
  // scene with valid values does not have.
  const skeleton = (text) => {
    const names = new Set();
    for (const [, tag, attrs] of text.matchAll(/<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)/g)) {
      names.add(`<${tag}`);
      for (const [, attr] of attrs.matchAll(/\s([\w:-]+)="/g)) names.add(`${tag}@${attr}`);
    }
    return names;
  };
  const allowed = skeleton(renderer.sceneToSvg(build(benign)));
  const added = [...skeleton(svg)].filter((name) => !allowed.has(name));
  eq(added.join(' '), '', 'no tag or attribute the benign scene does not also have');

  // An image the renderer will not draw is said to be undrawn, not dropped.
  assert(svg.includes('unsupported image'), 'a non-image data URL is refused, visibly');
  assert(renderer.sceneToSvg(build(benign)).includes('PROBE_TEXT'), 'ordinary text still renders');

  // Valid colours in every spelling Excalidraw writes still pass through.
  for (const good of ['#fff', '#1e1e1e', '#1e1e1eff', 'transparent', 'red', 'rgb(30, 30, 30)', 'rgba(30,30,30,.5)']) {
    const one = renderer.sceneToSvg({
      type: 'excalidraw',
      elements: [{ id: 'r', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, seed: 1, strokeColor: good }],
    });
    assert(one.includes(`stroke="${good}"`), `${good} is drawn as given`);
  }
});

// `render --out preview.png` used to exit 0 having written SVG bytes, `--out
// renders` became a file, and `--scale nope` drew NaN dimensions (#39).
test('render checks its arguments before writing, and the extension decides the format (#39)', () => {
  const scenePath = join(TMP, 'render-args.excalidraw');
  core.writeScene(scenePath, built.scene);
  const dir = join(TMP, 'render-args');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const parse = (...args) => renderer.parseRenderArgs([scenePath, ...args]);
  const shape = (o) => JSON.stringify([o.out, o.format]);
  eq(shape(parse()), JSON.stringify([join(TMP, 'render-args.svg'), 'svg']), 'no output flag: <scene>.svg beside the scene');
  eq(shape(parse('--out', join(dir, 'p.png'))), JSON.stringify([join(dir, 'p.png'), 'png']), '--out FILE.png');
  eq(shape(parse('--out', join(dir, 'p.SVG'))), JSON.stringify([join(dir, 'p.SVG'), 'svg']), '--out FILE.SVG');
  eq(shape(parse('--out-dir', dir)), JSON.stringify([join(dir, 'render-args.png'), 'png']), '--out-dir defaults to PNG, like drawio render');
  eq(shape(parse('--out-dir', dir, '--format', 'svg')), JSON.stringify([join(dir, 'render-args.svg'), 'svg']), '--out-dir with --format svg');
  const tuned = parse('--out', 'x.png', '--width', '800', '--scale', '2', '--padding', '0', '--style', 'clean', '--no-sandbox');
  eq(JSON.stringify([tuned.width, tuned.scale, tuned.padding, tuned.style, tuned.noSandbox]), JSON.stringify([800, 2, 0, 'clean', true]), 'values parsed');

  for (const [args, why] of [
    [[], /expected a \.excalidraw scene/],
    [[scenePath, scenePath], /expected one scene, got 2/],
    [[scenePath, '--bogus'], /unknown option --bogus/],
    [[scenePath, '--out'], /--out needs a value/],
    [[scenePath, '--out', 'a.png', '--out', 'b.png'], /--out given twice/],
    [[scenePath, '--out', 'preview.jpg'], /must end in \.svg or \.png/],
    [[scenePath, '--out', 'renders'], /must end in \.svg or \.png/],
    [[scenePath, '--out', dir], /is a directory; use --out-dir/],
    [[scenePath, '--out', 'renders/'], /is a directory; use --out-dir/],
    [[scenePath, '--out', 'a.png', '--out-dir', dir], /not both/],
    [[scenePath, '--format', 'gif'], /--format expects png or svg/],
    [[scenePath, '--out', 'a.png', '--format', 'svg'], /contradicts/],
    [[scenePath, '--scale', 'nope'], /--scale expects a positive number/],
    [[scenePath, '--scale', '0'], /--scale expects a positive number/],
    [[scenePath, '--scale', '-1'], /--scale expects a positive number/],
    [[scenePath, '--padding', '-5'], /--padding expects a non-negative number/],
    [[scenePath, '--out', 'a.png', '--width', '0'], /--width expects/],
    [[scenePath, '--out', 'a.png', '--width', '1.5'], /--width expects/],
    [[scenePath, '--out', 'a.png', '--width', '20000'], /--width expects/],
    [[scenePath, '--style', 'fancy'], /--style expects rough or clean/],
    [[scenePath, '--out', 'a.svg', '--width', '800'], /--width only applies to PNG/],
    [[scenePath, '--out', 'a.svg', '--browser', '/usr/bin/chromium'], /--browser only applies to PNG/],
    [[scenePath, '--background', '"><script>'], /--background expects a colour/],
  ]) {
    let message = '';
    try { renderer.parseRenderArgs(args); } catch (error) { message = error.message; }
    assert(why.test(message), `${JSON.stringify(args.slice(1))} should be refused with ${why}; got: ${message || 'accepted'}`);
  }

  const cli = (...args) => {
    try {
      return { status: 0, stdout: execFileSync(process.execPath, [join(SCRIPTS, 'render-excalidraw.mjs'), ...args], { encoding: 'utf8', stdio: 'pipe' }) };
    } catch (error) {
      return { status: error.status, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') };
    }
  };
  for (const [args, file] of [
    [['--out', join(dir, 'preview.png'), '--scale', 'nope'], 'preview.png'],
    [['--out', join(dir, 'preview.jpg')], 'preview.jpg'],
    [['--out', join(dir, 'renders')], 'renders'],
  ]) {
    const r = cli(scenePath, ...args);
    eq(r.status, 2, `${args.join(' ')} exits 2`);
    assert(!existsSync(join(dir, file)), `${args.join(' ')} wrote nothing`);
    assert(/usage: render-excalidraw\.mjs/.test(r.stderr), 'and prints the usage');
  }
  const missing = cli(join(dir, 'no-such.excalidraw'));
  eq(missing.status, 2, 'a missing scene exits 2');
  assert(missing.stderr.includes('no scene at'), `a missing scene is named: ${missing.stderr}`);
  const svg = cli(scenePath, '--out', join(dir, 'preview.svg'));
  eq(svg.status, 0, 'an SVG render succeeds');
  eq(JSON.parse(svg.stdout).format, 'svg', 'and reports its format');
  assert(readFileSync(join(dir, 'preview.svg'), 'utf8').startsWith('<?xml'), 'an SVG is written');
});

test('a PNG render proves a real PNG before replacing the previous preview (#39)', () => {
  const scenePath = join(TMP, 'render-png.excalidraw');
  core.writeScene(scenePath, built.scene);
  const dir = join(TMP, 'render-png');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'preview.png');
  const fakePng = (w, h) => makePng({ alpha: false, w, h });
  const shotOf = (args) => args.find((a) => a.startsWith('--screenshot=')).slice('--screenshot='.length);
  const lines = []; const errors = [];
  let seen = null;
  const good = (exe, args) => {
    seen = { exe, args, page: readFileSync(fileURLToPath(args.at(-1)), 'utf8') };
    writeFileSync(shotOf(args), fakePng(800, 311));
  };
  const deps = (runner, extra = {}) => ({
    runner, platform: 'linux', env: { PATH: '' }, isExecutable: (p) => p === '/usr/bin/chromium',
    log: (s) => lines.push(s), error: (s) => errors.push(s), ...extra,
  });

  eq(renderer.run([scenePath, '--out', out, '--width', '800'], deps(good)), 0, `renders: ${errors.join(' | ')}`);
  assert(readFileSync(out).subarray(0, 8).equals(browserLib.PNG_SIGNATURE), 'a PNG is written under the .png name');
  const report = JSON.parse(lines.at(-1));
  eq(JSON.stringify([report.format, report.width, report.height]), JSON.stringify(['png', 800, 311]), 'the report says what was written');
  eq(JSON.stringify(report.browser), JSON.stringify({ path: '/usr/bin/chromium', source: 'install location' }), 'and with which browser');
  eq(seen.exe, '/usr/bin/chromium', 'the located browser is the one run');
  assert(seen.args.includes('--headless=new') && !seen.args.includes('--no-sandbox'), 'headless, with the sandbox kept unless asked');
  const svgSize = /<svg\b[^>]*?\swidth="([\d.]+)"[^>]*?\sheight="([\d.]+)"/.exec(renderer.sceneToSvg(built.scene));
  const tall = Math.round((Math.ceil(Number(svgSize[2])) * 800) / Math.ceil(Number(svgSize[1])));
  assert(seen.args.includes(`--window-size=800,${tall}`) && seen.args.includes('--force-device-scale-factor=1'),
    `the window is the output size at scale factor 1: ${seen.args.join(' ')}`);
  assert(seen.page.includes(`width="800" height="${tall}"`), 'and the SVG is drawn at that size, as vectors');
  const profile = seen.args.find((a) => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
  assert(!existsSync(profile) && !existsSync(dirname(profile)), 'the throwaway profile and page are removed');

  const previous = readFileSync(out);
  for (const [why, runner] of [
    ['the browser failed', () => { const e = new Error('crashed'); e.status = 1; throw e; }],
    ['timed out', () => { const e = new Error('spawnSync ETIMEDOUT'); e.code = 'ETIMEDOUT'; throw e; }],
    ['without writing a screenshot', () => {}],
    ['empty or not a PNG', (exe, args) => writeFileSync(shotOf(args), '<?xml version="1.0"?><svg/>')],
    ['empty or not a PNG', (exe, args) => writeFileSync(shotOf(args), '')],
    ['incomplete', (exe, args) => writeFileSync(shotOf(args), fakePng(800, 311).subarray(0, 33))],
    // What the browser printed reaches the message, so a failure on a host
    // nobody can log into still says why.
    ['browser said: no usable sandbox', (exe, args, { log }) => {
      writeFileSync(log, 'no usable sandbox\n');
      const e = new Error('crashed');
      e.status = 1;
      throw e;
    }],
    // Chromium's start-up chatter is dropped, so the reason stays in view, and
    // a sandbox that cannot nest gets the specific way out (#113).
    ['browser said: setuid sandbox: clone() failed: Operation not permitted', (exe, args, { log }) => {
      writeFileSync(log, 'setuid sandbox: clone() failed: Operation not permitted\n'
        + '[0918/203806.293876:ERROR:third_party/crashpad/crashpad/util/file/file_io_posix.cc:145] open /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq: No such file or directory (2)\n'
        + '[0918/203806.293940:ERROR:third_party/crashpad/crashpad/util/file/file_io_posix.cc:145] open /sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq: No such file or directory (2)\n');
      const e = new Error('crashed');
      e.status = 1;
      throw e;
    }],
  ]) {
    errors.length = 0;
    eq(renderer.run([scenePath, '--out', out], deps(runner)), 1, `"${why}" exits 1`);
    assert(errors.join(' ').includes(why), `says "${why}": ${errors.join(' | ')}`);
    assert(readFileSync(out).equals(previous), `"${why}" left the previous preview untouched`);
    if (why.includes('Operation not permitted')) {
      assert(!errors.join(' ').includes('cpufreq'), `start-up chatter is dropped: ${errors.join(' | ')}`);
      assert(errors.join(' ').includes('could not start its own sandbox') && errors.join(' ').includes('retry with --no-sandbox'),
        `a sandbox that cannot nest is named, with the way out: ${errors.join(' | ')}`);
    }
  }
  eq(readdirSync(dir).join(','), 'preview.png', 'no temporary file is left beside the preview');

  errors.length = 0;
  const never = join(dir, 'never.png');
  eq(renderer.run([scenePath, '--out', never], deps(good, { env: { PATH: '/tools' }, isExecutable: () => false })), 1, 'no browser exits 1');
  assert(!existsSync(never), 'and writes nothing');
  const said = errors.join('\n');
  assert(said.includes('tried /tools/chromium') && said.includes('tried /snap/bin/chromium'), `every path tried is listed:\n${said}`);
  assert(said.includes('--format svg') && said.includes('ARKITECT_BROWSER'), `and the ways out are named:\n${said}`);

  errors.length = 0;
  let probes = 0;
  const pinned = deps(good, { env: { ARKITECT_BROWSER: '/pinned/chrome' }, isExecutable: (p) => { probes++; return p === '/usr/bin/chromium'; } });
  eq(renderer.run([scenePath, '--out', never], pinned), 1, 'an unusable pin exits 1');
  eq(probes, 1, 'the pin is probed once and never swapped for another browser');
  assert(errors.join(' ').includes('ARKITECT_BROWSER /pinned/chrome is not executable'), `the pin is named: ${errors.join(' | ')}`);

  eq(renderer.run([scenePath, '--out', out, '--no-sandbox'], deps(good)), 0, '--no-sandbox renders');
  assert(seen.args.includes('--no-sandbox'), '--no-sandbox reaches the browser only when asked');
});

test('browser discovery covers Edge, Chrome and Chromium on every platform, PATH first (#39)', () => {
  const at = (platform, env, winner) => browserLib.locateBrowser(undefined, { platform, env, isExecutable: (p) => p === winner });
  const win = { PATH: 'C:\\Tools', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
  for (const p of ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe']) {
    eq(at('win32', win, p).path, p, `Windows finds ${p}`);
  }
  eq(JSON.stringify(at('win32', win, 'C:\\Tools\\msedge.exe')), JSON.stringify({ path: 'C:\\Tools\\msedge.exe', source: 'PATH', tried: ['C:\\Tools\\msedge.exe'] }), 'PATH is tried first');
  eq(at('darwin', { PATH: '' }, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome').source, 'install location', 'macOS Chrome');
  eq(at('darwin', { PATH: '' }, '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge').source, 'install location', 'macOS Edge');
  eq(at('linux', { PATH: '/usr/local/bin' }, '/usr/local/bin/google-chrome').source, 'PATH', 'a Chrome on the Linux PATH');
  eq(at('linux', { PATH: '' }, '/snap/bin/chromium').path, '/snap/bin/chromium', 'snap Chromium');
  // A packaged Chrome or Edge beats Chromium, and Ubuntu's snap wrapper comes
  // last: the snap cannot start inside a sandbox or container (#113).
  const both = (...present) => browserLib.locateBrowser(undefined, { platform: 'linux', env: { PATH: '/usr/bin' }, isExecutable: (p) => present.includes(p) }).path;
  eq(both('/usr/bin/chromium-browser', '/usr/bin/google-chrome'), '/usr/bin/google-chrome', 'Chrome before the chromium-browser wrapper');
  eq(both('/usr/bin/chromium', '/usr/bin/microsoft-edge'), '/usr/bin/microsoft-edge', 'Edge before Chromium');
  eq(both('/usr/bin/chromium-browser', '/usr/bin/chromium'), '/usr/bin/chromium', 'a real Chromium before the snap wrapper');
  const none = at('linux', { PATH: '/a' }, null);
  eq(JSON.stringify([none.path, none.source]), JSON.stringify([null, null]), 'nothing found');
  assert(none.tried.includes('/a/chromium') && none.tried.includes('/opt/google/chrome/chrome'), 'every candidate tried');
  const flag = browserLib.locateBrowser('/flag/chrome', { platform: 'linux', env: { ARKITECT_BROWSER: '/env/chrome' }, isExecutable: (p) => p === '/flag/chrome' });
  eq(JSON.stringify([flag.path, flag.source]), JSON.stringify(['/flag/chrome', '--browser']), '--browser wins over ARKITECT_BROWSER');

  // A snap Chromium has a private /tmp, so it works in its own data directory.
  const home = { HOME: '/home/u' };
  const wrapper = () => '#!/bin/sh\n# transitional package\nexec /snap/bin/chromium "$@"\n';
  const binary = () => '\x7fELF\x02\x01\x01';
  eq(browserLib.workRootFor('/snap/bin/chromium', { platform: 'linux', env: home }), join('/home/u', 'snap', 'chromium', 'common'), 'a snap binary');
  eq(browserLib.workRootFor('/usr/bin/chromium-browser', { platform: 'linux', env: home, readHead: wrapper }), join('/home/u', 'snap', 'chromium', 'common'),
    'an Ubuntu wrapper that execs the snap');
  eq(browserLib.workRootFor('/usr/bin/google-chrome', { platform: 'linux', env: home, readHead: binary }), tmpdir(), 'a real binary uses the temp dir');
  eq(browserLib.workRootFor('/usr/bin/missing', { platform: 'linux', env: home, readHead: () => { throw new Error('ENOENT'); } }), tmpdir(), 'an unreadable path uses the temp dir');
  eq(browserLib.workRootFor('/snap/bin/chromium', { platform: 'darwin', env: home }), tmpdir(), 'only Linux has snaps');

  // The page, profile and screenshot live in that directory and are removed from it.
  const root = join(TMP, 'render-work-root');
  rmSync(root, { recursive: true, force: true });
  let seenArgs = [];
  const svg = renderer.sceneToSvg(built.scene);
  browserLib.rasteriseSvg(svg, { browser: '/snap/bin/chromium', width: 300, workRoot: root, runner: (exe, args) => {
    seenArgs = args;
    const shot = args.find((a) => a.startsWith('--screenshot=')).slice('--screenshot='.length);
    writeFileSync(shot, makePng({ alpha: false }));
  } });
  const profile = seenArgs.find((a) => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
  assert(profile.startsWith(root), `the profile is inside the work root: ${profile}`);
  eq(readdirSync(root).length, 0, 'and nothing is left there afterwards');

  let tooTall = '';
  try {
    browserLib.rasteriseSvg('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="1000"></svg>',
      { browser: '/snap/bin/chromium', width: 1600, workRoot: root, runner: () => { throw new Error('the browser must not start'); } });
  } catch (error) { tooTall = error.message; }
  assert(/past Chromium's 16000px limit; use a smaller --width/.test(tooTall), `an impossible screenshot is refused before the browser starts: ${tooTall}`);

  // A profile a helper will not let go of never fails a render that already has
  // its PNG; on CI this surfaced as ENOTEMPTY from the cleanup.
  const kept = browserLib.rasteriseSvg(svg, {
    browser: '/snap/bin/chromium', width: 300, workRoot: root,
    runner: (exe, args) => {
      const shot = args.find((a) => a.startsWith('--screenshot=')).slice('--screenshot='.length);
      writeFileSync(shot, makePng({ alpha: false }));
    },
    remove: () => { const e = new Error("ENOTEMPTY: directory not empty, rmdir 'profile/Default'"); e.code = 'ENOTEMPTY'; throw e; },
  });
  assert(kept.bytes.subarray(0, 8).equals(browserLib.PNG_SIGNATURE), 'the PNG is returned even when its work directory will not delete');
  rmSync(root, { recursive: true, force: true });
});

test('browser supervision finishes a complete screenshot without waiting for browser shutdown (#39)', () => {
  const dir = join(TMP, 'browser-process');
  mkdirSync(dir, { recursive: true });
  const png = join(dir, 'input.png');
  const screenshot = join(dir, 'shot.png');
  const log = join(dir, 'browser.log');
  const pidFile = join(dir, 'browser.pid');
  const fixture = join(dir, 'browser.mjs');
  writeFileSync(png, makePng({ alpha: false }));
  writeFileSync(fixture, `
    import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
    const [mode, input, shot, pidFile] = process.argv.slice(2);
    writeFileSync(pidFile, String(process.pid));
    const bytes = readFileSync(input);
    if (mode === 'crash') process.exit(7);
    if (mode === 'exit') { writeFileSync(shot, bytes); process.exit(0); }
    if (mode === 'complete') writeFileSync(shot, bytes);
    if (mode === 'partial' || mode === 'chunks') writeFileSync(shot, bytes.subarray(0, 33));
    if (mode === 'chunks') setTimeout(() => appendFileSync(shot, bytes.subarray(33)), 400);
    setInterval(() => {}, 1000);
  `);
  for (const mode of ['complete', 'chunks', 'exit', 'partial', 'missing', 'crash']) {
    rmSync(screenshot, { force: true });
    let error;
    try {
      browserLib.runBrowser(process.execPath, [fixture, mode, png, screenshot, pidFile], { timeout: 2000, log, screenshot });
    } catch (e) { error = e; }
    if (mode === 'partial' || mode === 'missing') eq(error?.code, 'ETIMEDOUT', `${mode} cannot finish a render`);
    else if (mode === 'crash') eq(error?.status, 7, 'a crash still fails');
    else {
      assert(!error, `${mode} completes without a timeout: ${error?.message}`);
      assert(readFileSync(screenshot).equals(readFileSync(png)), `${mode} keeps all PNG bytes`);
    }
    const pid = Number(readFileSync(pidFile, 'utf8'));
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { /* exited */ }
    assert(!alive, `${mode} leaves no browser process running`);
  }
});

// Runs wherever a Chromium-based browser is installed, which includes every CI
// runner; elsewhere it says so and passes, so the skip count stays exact.
test('a real local browser renders a real PNG where one is installed (#39)', () => {
  const found = browserLib.locateBrowser();
  if (!found.path) {
    console.log(`      (no Edge, Chrome or Chromium here; tried ${found.tried.length} paths)`);
    return;
  }
  const scenePath = join(TMP, 'render-real.excalidraw');
  core.writeScene(scenePath, built.scene);
  const out = join(TMP, 'render-real', 'preview.png');
  const lines = []; const errors = [];
  const sandbox = process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : [];
  eq(renderer.run([scenePath, '--out', out, '--width', '600', ...sandbox], { log: (s) => lines.push(s), error: (s) => errors.push(s) }), 0,
    `render with ${found.path}: ${errors.join(' | ')}`);
  const bytes = readFileSync(out);
  assert(bytes.subarray(0, 8).equals(browserLib.PNG_SIGNATURE), 'a real PNG signature');
  assert(Math.abs(bytes.readUInt32BE(16) - 600) <= 2, `600px wide, got ${bytes.readUInt32BE(16)}`);
  assert(bytes.length > 2000, `a drawing, not a blank page (${bytes.length} bytes)`);
});

// ------------------------------------------------------------- analysis

test('analysis emits structure and style but never element text', () => {
  const a = analyzer.analyzeScene(built.scene);
  const raw = JSON.stringify(a);
  for (const el of built.scene.elements) {
    if (el.type !== 'text' || !el.text || el.text.length < 5) continue;
    assert(!raw.includes(el.text), `analysis leaked the label "${el.text}"`);
  }
  assert(!raw.includes('data:image'), 'analysis leaked an image payload');
  assert(a.counts.elements > 0 && a.style.strokeColor && a.geometry.canvas, 'analysis is populated');
});

test('every convention says what it rests on, and claims no evidence it lacks', () => {
  const rec = JSON.parse(readFileSync(join(SKILL, 'references', 'source-analysis.json'), 'utf8'));
  assert(rec.conventions.length > 0, 'conventions listed');
  for (const c of rec.conventions) {
    if (c.confidence === 'default') {
      assert(c.basis, `${c.id} must say what it rests on`);
      eq(c.evidence.n, 0, `${c.id} must not claim evidence`);
    } else {
      assert(c.evidence.n > 0 && c.evidence.total >= c.evidence.n,
        `${c.id} claims confidence ${c.confidence} but its counts do not support it`);
      assert(c.observed !== null && c.observed !== undefined, `${c.id} must name what was observed`);
    }
  }
  eq(rec.corpus.files, rec.sources.length, 'one digest per source file');
});

// The guide must not describe defaults as learned style, and must not keep
// calling itself a default once a corpus exists. The record decides which.
test('the style guide matches the state of the corpus', () => {
  const rec = JSON.parse(readFileSync(join(SKILL, 'references', 'source-analysis.json'), 'utf8'));
  const guide = readFileSync(join(SKILL, 'references', 'style-guide.md'), 'utf8');
  const banner = /defaults, not observations/i.test(guide);
  if (rec.corpus.files === 0) {
    assert(banner, 'with no corpus the guide must say it is a default');
  } else {
    assert(!banner, 'the corpus is not empty, so the defaults banner is now false');
    assert(guide.includes(String(rec.corpus.files)), 'the guide should cite the corpus size');
  }
});

// Elbow arrows are routed by the app, which is fussy about the fields it finds.
// The reference corpus contains arrows the app itself wrote; compare against
// those rather than guessing.
sourceTest('generated elbow arrows carry the fields the app writes', () => {
  if (!haveSources) return 'skip';
  let reference = null;
  for (const p of sourceList) {
    const scene = JSON.parse(readFileSync(p, 'utf8'));
    reference = scene.elements.find((el) => el.type === 'arrow' && el.elbowed && !el.isDeleted);
    if (reference) break;
  }
  if (!reference) return 'skip';

  const mine = core.arrow({ points: [[0, 0], [80, 0]], elbowed: true });
  // `index` is the fractional z-order key, assigned by reindex() at write time
  // once the element's position in the scene is known.
  const assignedOnWrite = new Set(['index']);
  for (const key of Object.keys(reference)) {
    if (assignedOnWrite.has(key)) continue;
    assert(key in mine, `an app-written elbow arrow has "${key}" and ours does not`);
  }
  eq(mine.roundness, null, 'an elbow arrow must have roundness null');
  eq(mine.elbowed, true, 'elbowed flag');
  for (const key of ['fixedSegments', 'startIsSpecial', 'endIsSpecial']) {
    eq(mine[key], null, `${key} defaults to null`);
  }
});

test('a bound elbow arrow names the edge it leaves from', () => {
  const a = core.rectangle({ x: 0, y: 0, width: 100, height: 60 });
  const b = core.rectangle({ x: 300, y: 0, width: 100, height: 60 });
  const arr = core.arrow({ points: [[0, 0], [200, 0]], elbowed: true });
  core.bindArrow(arr, a, b, { fixedPoints: [core.EDGE_POINT.right, core.EDGE_POINT.left] });
  eq(JSON.stringify(arr.startBinding.fixedPoint), '[1,0.5]', 'start edge point');
  eq(JSON.stringify(arr.endBinding.fixedPoint), '[0,0.5]', 'end edge point');
  // Without fixedPoints the key must be absent, not null: a straight arrow
  // that carries the field is treated as elbowed by the app.
  const plain = core.arrow({ points: [[0, 0], [200, 0]] });
  core.bindArrow(plain, a, b);
  assert(!('fixedPoint' in plain.startBinding), 'a plain arrow carries no fixedPoint');
});

sourceTest('reference scenes summarize without their text reaching the record', () => {
  if (!haveSources) return 'skip';
  for (const p of sourceList) {
    const before = createHash('sha256').update(readFileSync(p)).digest('hex');
    const a = analyzer.analyzeScene(JSON.parse(readFileSync(p, 'utf8')), { name: 'x' });
    assert(a.counts.elements > 0, `${'<source>'} produced no elements`);
    const after = createHash('sha256').update(readFileSync(p)).digest('hex');
    eq(after, before, 'analysis must not modify the source');
  }
});

// ------------------------------------------------------------- redaction

const COMMON = new Set(('the a an and or of to in for with from by on at is are be this that it as excalidraw '
  + 'archkit icon icons library libraries scene scenes element elements node nodes edge edges arrow arrows text '
  + 'label labels style styles colour color stroke fill font size width height diagram diagrams architecture '
  + 'system systems service services data flow flows store storage process boundary frame group build render '
  + 'validate analyze docker container skill skills plugin script scripts test tests true false null json svg png '
  + 'http https localhost node npm git').split(' '));

function tokenize(s) {
  return String(s).toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [];
}

// Identifier-shaped tokens only: a digit, an underscore, or two or more hyphens.
// Guarding every English word that appears in a label would flag ordinary prose
// and make the check useless.
function sensitiveTokens(s) {
  const out = new Set();
  for (const t of tokenize(s)) {
    if (COMMON.has(t)) continue;
    if (/\d/.test(t) || t.includes('_') || (t.match(/-/g) ?? []).length >= 2) out.add(t);
  }
  for (const m of String(s).matchAll(/\b[A-Z]{3,}\b/g)) out.add(m[0].toLowerCase());
  return out;
}

// The salt is a constant, not a secret: it only stops an accidental collision
// with some other digest list. That is also why sensitive-tokens.sha256 is
// gitignored - with the salt in the open, committing the digests would let
// anyone confirm a guessed name against a local reference corpus.
const SALT = 'arkitect-excalidraw-redaction-v1';
const hashToken = (t) => createHash('sha256').update(SALT + t).digest('hex').slice(0, 16);

// The icon and library folders are other people's bytes, verified by digest
// elsewhere, and too heavy to tokenize.
const repoTextFiles = () => repoFiles(ROOT, ({ rel, name }) => {
  const dirs = rel.split('/');
  return !dirs.includes('icons') && !dirs.includes('libraries')
    && /\.(md|json|mjs|ps1|yaml|yml|txt|excalidraw|excalidrawlib)$/.test(name);
});

sourceTest('no string from a reference scene leaks into the repository', () => {
  const hashFile = join(HERE, 'sensitive-tokens.excalidraw.sha256');
  let digests;

  if (haveSources) {
    const sensitive = new Set();
    for (const p of sourceList) {
      const scene = JSON.parse(readFileSync(p, 'utf8'));
      for (const el of scene.elements ?? []) {
        if (el.text) for (const t of sensitiveTokens(el.text)) sensitive.add(t);
        if (el.name) for (const t of sensitiveTokens(el.name)) sensitive.add(t);
        if (el.link) for (const t of sensitiveTokens(el.link)) sensitive.add(t);
      }
      // Path components carry customer and project names. Split on separators as
      // well as slashes, so a hyphenated directory yields its codename alone.
      for (const t of sensitiveTokens(p.replace(/[\\/]/g, ' '))) sensitive.add(t);
      for (const t of sensitiveTokens(p.replace(/[\\/.\-_]/g, ' '))) sensitive.add(t);
    }
    assert(sensitive.size > 0, 'derived sensitive-token set is empty - the tokenizer is broken');

    // Subtract whatever the repository already says. The corpus is full of
    // ordinary technical vocabulary - API, LOAD, TRANSFORM, aws - which is also
    // all over the docs, and guarding those would only produce noise. What this
    // check is for is a distinctive string arriving later: a customer name, a
    // codename, a hostname. So baseline against the repo as it stands, and
    // union with the digests already recorded, so a token once judged sensitive
    // stays guarded even if it turns up in the repo on a later run.
    const alreadyPublic = new Set();
    for (const f of repoTextFiles()) {
      if (f === hashFile) continue;
      for (const t of tokenize(readFileSync(f, 'utf8'))) alreadyPublic.add(t);
    }
    const previous = existsSync(hashFile)
      ? readFileSync(hashFile, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
      : [];
    const fresh = [...sensitive].filter((t) => !alreadyPublic.has(t)).map(hashToken);
    const union = [...new Set([...previous, ...fresh])].sort();
    writeFileSync(hashFile,
      '# Salted SHA-256 prefixes of tokens that must never appear in this repo.\n'
      + '# Regenerated by tests/run-tests.mjs when local reference sources are present:\n'
      + `# ${sensitive.size} identifier-shaped tokens seen in the corpus, ${union.length} guarded\n`
      + '# (the rest are words the repository already uses in its own prose).\n'
      + union.join('\n') + '\n');
  } else if (!existsSync(hashFile)) {
    return 'skip';
  }

  digests = new Set(readFileSync(hashFile, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')));
  if (!digests.size) return 'skip';

  const hits = [];
  for (const f of repoTextFiles()) {
    if (f === hashFile) continue;
    for (const t of new Set(tokenize(readFileSync(f, 'utf8')))) {
      if (digests.has(hashToken(t))) hits.push(`${relative(ROOT, f)}: "${t}"`);
    }
  }
  assert(hits.length === 0, `sensitive strings leaked into the repo:\n        ${hits.slice(0, 20).join('\n        ')}`);
});

// ------------------------------------------------------------- plugin shape

test('plugin manifest and the three Excalidraw skills are well formed', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  eq(manifest.name, 'arkitect', 'plugin name');
  assert(manifest.description && manifest.description.length > 20, 'plugin description');

  const main = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');
  const learn = readFileSync(join(ROOT, 'skills', 'learn-excalidraw-style', 'SKILL.md'), 'utf8');
  const apply = readFileSync(join(ROOT, 'skills', 'apply-excalidraw-style', 'SKILL.md'), 'utf8');
  assert([main, learn, apply].every((md) => /^---\r?\n/.test(md)), 'skills need YAML frontmatter');
  assert(main.includes('name: arkitect-excalidraw'), 'main skill name');
  assert(learn.includes('name: learn-excalidraw-style'), 'learning skill name');
  assert(apply.includes('name: apply-excalidraw-style'), 'apply skill name');
  assert(learn.includes('disable-model-invocation: true'), 'learning skill must be user-invoked only');
  assert(apply.includes('disable-model-invocation: true'), 'apply skill must be user-invoked only');
  assert(!main.includes('disable-model-invocation'), 'main skill must stay model-invocable');
  assert(main.includes('${CLAUDE_PLUGIN_ROOT}'), 'main skill should use ${CLAUDE_PLUGIN_ROOT}');
  assert(![main, learn, apply].some((md) => /C:\\Users/i.test(md)), 'skills must not hard-code install paths');
});

test('scripts avoid hard-coded absolute paths', () => {
  const files = readdirSync(SCRIPTS).filter((n) => n.endsWith('.mjs') || n.endsWith('.ps1'));
  for (const f of files) {
    const s = readFileSync(join(SCRIPTS, f), 'utf8');
    assert(!/C:[\\/]Users/i.test(s), `${f} hard-codes a user path`);
  }
  const lib = readdirSync(join(SCRIPTS, 'lib'));
  for (const f of lib) {
    assert(!/C:[\\/]Users/i.test(readFileSync(join(SCRIPTS, 'lib', f), 'utf8')), `lib/${f} hard-codes a user path`);
  }
});

// A committed example and a rebuild of its spec are compared through a
// projection (#50). Excalidraw draws fresh ids, seeds, nonces and timestamps on
// every build, so those are dropped; everything that shows is kept: type,
// geometry, points, stroke, fill, font, text, bindings and containers resolved to
// element positions, groups by first appearance, and embedded files by hash.
const VOLATILE_FIELDS = new Set(['id', 'seed', 'versionNonce', 'updated', 'index']);
const roundDeep = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100
  : Array.isArray(v) ? v.map(roundDeep)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, roundDeep(v[k])])) : v);
const payloadHash = (f) => `${f.mimeType}:${createHash('sha256').update(String(f.dataURL)).digest('hex').slice(0, 16)}`;

function projectScene(scene) {
  const elements = scene.elements ?? [];
  const position = new Map(elements.map((e, i) => [e.id, `@${i}`]));
  const groups = new Map();
  const group = (g) => { if (!groups.has(g)) groups.set(g, `g${groups.size}`); return groups.get(g); };
  const ref = (id) => (id == null ? id : position.get(id) ?? 'dangling');
  const file = (id) => (scene.files?.[id] ? payloadHash(scene.files[id]) : 'missing');
  return {
    type: scene.type,
    version: scene.version,
    appState: roundDeep(scene.appState ?? {}),
    files: Object.values(scene.files ?? {}).map(payloadHash).sort(),
    elements: elements.map((e) => Object.fromEntries(Object.keys(e).sort().filter((k) => !VOLATILE_FIELDS.has(k)).map((k) => {
      const v = e[k];
      if (k === 'containerId' || k === 'frameId') return [k, ref(v)];
      if (k === 'groupIds') return [k, v.map(group)];
      if (k === 'boundElements') return [k, v && v.map((b) => ({ type: b.type, id: ref(b.id) }))];
      if (k === 'startBinding' || k === 'endBinding') return [k, v && { ...roundDeep(v), elementId: ref(v.elementId) }];
      if (k === 'fileId') return [k, file(v)];
      return [k, roundDeep(v)];
    }))),
  };
}

// The first thing that differs, named precisely enough to act on, or null.
function firstDifference(committed, rebuilt) {
  for (const key of ['type', 'version', 'appState', 'files']) {
    if (JSON.stringify(committed[key]) !== JSON.stringify(rebuilt[key])) {
      return `${key}: ${JSON.stringify(committed[key]).slice(0, 80)} in the committed scene, ${JSON.stringify(rebuilt[key]).slice(0, 80)} rebuilt`;
    }
  }
  const count = Math.max(committed.elements.length, rebuilt.elements.length);
  for (let i = 0; i < count; i++) {
    const a = committed.elements[i];
    const b = rebuilt.elements[i];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (!a || !b) return `element ${i}: only in the ${a ? 'committed scene' : 'rebuild'}`;
    const key = [...new Set([...Object.keys(a), ...Object.keys(b)])].find((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    const label = a.text ? ` "${String(a.text).slice(0, 30)}"` : '';
    return `element ${i} (${a.type}${label}): ${key} ${JSON.stringify(a[key])?.slice(0, 80)} in the committed scene, ${JSON.stringify(b[key])?.slice(0, 80)} rebuilt`;
  }
  return null;
}

test('the example freshness check sees a moved caption or a changed mark, not new ids (#50)', () => {
  const scene = JSON.parse(readFileSync(join(SKILL, 'assets', 'templates', 'aws-data-platform.excalidraw'), 'utf8'));
  const base = projectScene(scene);
  const copy = () => JSON.parse(JSON.stringify(scene));

  // Every random field redrawn and every id renamed consistently: nothing shows.
  const reissued = copy();
  const renamed = (id) => `renamed-${id}`;
  for (const e of reissued.elements) {
    e.id = renamed(e.id);
    e.seed += 1;
    e.versionNonce += 1;
    e.updated += 1000;
    if (e.index) e.index = `${e.index}0`;
    e.groupIds = (e.groupIds ?? []).map(renamed);
    if (e.containerId) e.containerId = renamed(e.containerId);
    if (e.frameId) e.frameId = renamed(e.frameId);
    if (e.boundElements) e.boundElements = e.boundElements.map((bound) => ({ ...bound, id: renamed(bound.id) }));
    for (const end of ['startBinding', 'endBinding']) if (e[end]) e[end] = { ...e[end], elementId: renamed(e[end].elementId) };
  }
  eq(firstDifference(base, projectScene(reissued)), null, 'new ids, seeds, nonces, timestamps and index keys are not drift');

  // One caption four pixels lower: the element count is unchanged, and it is drift.
  const moved = copy();
  const caption = moved.elements.findIndex((e) => e.type === 'text');
  moved.elements[caption].y += 4;
  const found = firstDifference(base, projectScene(moved));
  assert(found?.startsWith(`element ${caption} (text`) && found.includes(': y '), `a moved caption was not named: ${found}`);

  // A different embedded mark behind the same element.
  const withFiles = builder.buildDiagram(JSON.parse(readFileSync(join(SKILL, 'assets', 'templates', 'shared-icon-packs.spec.json'), 'utf8'))).scene;
  const swapped = JSON.parse(JSON.stringify(withFiles));
  const [fileId] = Object.keys(swapped.files);
  assert(fileId, 'the shared-pack example embeds files');
  swapped.files[fileId].dataURL = swapped.files[fileId].dataURL.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  const swap = firstDifference(projectScene(withFiles), projectScene(swapped));
  assert(swap?.startsWith('files'), `a changed embedded file was not named: ${swap}`);
});

// Both shipped examples are read by the agent before it writes a spec, so a
// stale one teaches the wrong thing. The PNG matters as much as the JSON here:
// it is the thing that actually gets looked at.
for (const name of ['starter-architecture', 'aws-data-platform']) {
  test(`the ${name} example is committed, valid and matches its spec`, () => {
    const specPath = join(SKILL, 'assets', 'templates', `${name}.spec.json`);
    const scenePath = join(SKILL, 'assets', 'templates', `${name}.excalidraw`);
    const pngPath = join(SKILL, 'assets', 'templates', `${name}.png`);
    assert(existsSync(specPath) && existsSync(scenePath), 'both the spec and the built scene ship');
    assert(existsSync(pngPath), 'a rendered PNG ships beside the scene');
    const r = validator.validateFile(scenePath);
    assert(r.ok, `${name} scene errors: ${r.errors.join('; ')}`);
    const spec = JSON.parse(readFileSync(specPath, 'utf8'));
    const rebuilt = builder.buildDiagram(spec);
    const drift = firstDifference(projectScene(JSON.parse(readFileSync(scenePath, 'utf8'))), projectScene(rebuilt.scene));
    assert(!drift, `the committed ${name}.excalidraw is stale at ${drift}. Rebuild it (node bin/arkitect.mjs excalidraw build `
      + `skills/arkitect-excalidraw/assets/templates/${name}.spec.json --out <tmp> --defaults), copy it over, and re-render ${name}.png `
      + 'in the same pull request.');
    assert(!rebuilt.report.missingIcons.length,
      `${name} has unresolved icons: ${rebuilt.report.missingIcons.join(', ')}`);
    assert(!rebuilt.report.unknownKinds.length,
      `${name} uses kinds the builder does not know: ${rebuilt.report.unknownKinds.map((u) => `${u.field}=${u.value}`).join(', ')}`);
  });
}

// Learning builds this install's own record outside the plugin (#89). Only an
// explicit --out writes anywhere else, which is how a maintainer rebuilds the
// shipped record.
test('learning writes your record to the store, and elsewhere only by --out (#89)', () => {
  const home = process.env.ARKITECT_HOME;
  rmSync(home, { recursive: true, force: true });
  const shipped = join(SKILL, 'references', 'source-analysis.json');
  const before = readFileSync(shipped);
  const scene = join(SKILL, 'assets', 'templates', 'starter-architecture.excalidraw');
  eq(JSON.parse(node('build-knowledge.mjs', ['--print'])).record, shipped, 'with no record of your own, --print shows the shipped one');
  const elsewhere = join(TMP, 'maintainer', 'record.json');
  const wrote = JSON.parse(node('build-knowledge.mjs', ['--sources', scene, '--out', elsewhere]));
  eq(wrote.wrote, elsewhere, '--out after the sources is where the record goes');
  eq(wrote.corpus.files, 1, 'and its value is not read as a second scene');
  node('build-knowledge.mjs', ['--sources', scene]);
  const own = join(home, 'excalidraw', 'source-analysis.json');
  assert(existsSync(own), 'by default the record goes to the store');
  eq(JSON.parse(readFileSync(join(home, 'excalidraw', 'sources.json'), 'utf8')).files[0], scene, 'with the designated paths beside it');
  eq(JSON.parse(node('build-knowledge.mjs', ['--print'])).record, own, 'and --print shows it once it exists');
  assert(before.equals(readFileSync(shipped)), 'the shipped record is untouched');
  rmSync(home, { recursive: true, force: true });
});

// `learn --sources x --help` used to ignore the --help, do the learn, and
// replace a record the caller only meant to read the usage for (#151).
test('learning checks its arguments before it reads or writes anything (#151)', () => {
  const home = process.env.ARKITECT_HOME;
  const store = join(home, 'excalidraw');
  const scene = join(SKILL, 'assets', 'templates', 'starter-architecture.excalidraw');
  const learn = (...args) => spawnSync(process.execPath, [join(SCRIPTS, 'build-knowledge.mjs'), ...args], { encoding: 'utf8' });
  rmSync(home, { recursive: true, force: true });
  mkdirSync(store, { recursive: true });
  const record = join(store, 'source-analysis.json');
  const sources = join(store, 'sources.json');
  const sentinel = () => {
    writeFileSync(record, 'SENTINEL-RECORD');
    writeFileSync(sources, 'SENTINEL-SOURCES');
  };
  const untouched = (what) => {
    eq(readFileSync(record, 'utf8'), 'SENTINEL-RECORD', `${what}: the record is untouched`);
    eq(readFileSync(sources, 'utf8'), 'SENTINEL-SOURCES', `${what}: the source list is untouched`);
  };

  for (const args of [
    ['--sources', scene, '--help'],
    ['--help', '--sources', scene],
    ['--sources', scene, '--merge', '-h'],
  ]) {
    sentinel();
    const r = learn(...args);
    eq(r.status, 0, `${args.join(' ')} exits 0`);
    assert(r.stdout.includes('usage: build-knowledge.mjs'), `${args.join(' ')} prints the usage`);
    assert(!r.stdout.includes('"wrote"'), `${args.join(' ')} does not learn`);
    untouched(args.join(' '));
  }

  for (const [args, said] of [
    [['--sources', scene, '--nope'], 'unknown option --nope'],
    [['--sources', scene, '--out'], '--out needs a value'],
    [['--sources', scene, '--out', 'a', '--out', 'b'], '--out given more than once'],
    [['--sources', '--merge'], '--sources needs at least one value'],
    [['--merge'], '--sources needs at least one file'],
    [['stray.excalidraw', '--sources', scene], 'unexpected argument stray.excalidraw'],
    [['--sources', join(TMP, 'not-here.excalidraw')], 'no such file'],
    // Two modes at once had no answer; it used to pick one silently.
    [['--print', '--baseline'], '--print only reads a record'],
    [['--print', '--sources', scene], '--print only reads a record'],
    [['--baseline', '--sources', scene], '--baseline writes the defaults record'],
    [['--baseline', '--merge'], '--baseline writes the defaults record'],
  ]) {
    sentinel();
    const r = learn(...args);
    eq(r.status, 2, `${args.join(' ')} is a usage error`);
    assert(r.stderr.includes(said), `${args.join(' ')} says "${said}", got "${r.stderr.trim()}"`);
    untouched(args.join(' '));
  }

  // The three supported modes still do what they did.
  rmSync(home, { recursive: true, force: true });
  eq(learn('--sources', scene).status, 0, 'a plain learn still works');
  eq(learn('--sources', scene, '--merge').status, 0, 'and --merge still works');
  eq(JSON.parse(readFileSync(join(store, 'source-analysis.json'), 'utf8')).version, 2, 'the merge counted as a second version');
  eq(learn('--print').status, 0, '--print still reads the record');
  const baseline = learn('--baseline');
  eq(baseline.status, 0, '--baseline still writes the defaults record');
  eq(JSON.parse(readFileSync(join(store, 'source-analysis.json'), 'utf8')).version, 0, 'as version 0');
  rmSync(home, { recursive: true, force: true });
});

// ------------------------------------------------------------- per-install style (#90)

const OWN_STORE = join(process.env.ARKITECT_HOME, 'excalidraw');
const OVERRIDES = join(OWN_STORE, 'style-overrides.json');
const TEMPLATES = join(SKILL, 'assets', 'templates');
const STARTER_SPEC = join(TEMPLATES, 'starter-architecture.spec.json');
const STARTER = join(TEMPLATES, 'starter-architecture.excalidraw');
const clearStore = () => rmSync(process.env.ARKITECT_HOME, { recursive: true, force: true });
const plantOverride = (value) => {
  mkdirSync(OWN_STORE, { recursive: true });
  writeFileSync(OVERRIDES, typeof value === 'string' ? value : JSON.stringify(value));
};
const buildCli = (...args) => spawnSync(process.execPath, [join(SCRIPTS, 'build-diagram.mjs'), ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const toolCli = (script, ...args) => spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: 'utf8' });
// The first projected difference from a committed scene, or null (#50).
const driftFrom = (committedPath, scene) => firstDifference(projectScene(JSON.parse(readFileSync(committedPath, 'utf8'))), projectScene(scene));
const readScene = (path) => JSON.parse(readFileSync(path, 'utf8'));
const QUERY = { color: '#f08c00', strokeStyle: 'solid', width: 2, meaning: 'SQL query' };
const PERSONAL = {
  schemaVersion: 1,
  engine: 'excalidraw',
  tokens: { rounded: false, fillStyle: 'hachure', boundaryStroke: 'dotted', edgeColor: '#343a40' },
  edgeKinds: { flow: { meaning: 'trigger' }, query: QUERY },
};
const convention = (id, observed, n, total) => ({ id, observed, evidence: { n, total, share: n / total }, confidence: 'recorded' });

test('without an override a build draws the shipped Excalidraw house style (#90)', () => {
  clearStore();
  eq(styleTokens.overridesPath({ ARKITECT_HOME: TMP }), join(TMP, 'excalidraw', 'style-overrides.json'), 'the override sits in the excalidraw store');
  const style = styleTokens.loadStyle();
  eq(style.source, 'defaults', 'an empty store means the house style');
  eq(JSON.stringify(style.tokens), JSON.stringify(builder.STYLE), 'every token is the shipped one');
  eq(JSON.stringify(style.edgeKinds), JSON.stringify(builder.EDGE_KINDS), 'and every kind');
  eq(driftFrom(STARTER, builder.buildDiagram(readScene(STARTER_SPEC), { style }).scene), null, 'the resolved house style draws the committed example');
  const out = join(TMP, 'no-override.excalidraw');
  const r = buildCli(STARTER_SPEC, '--out', out);
  eq(r.status, 0, `build: ${r.stderr}`);
  eq(r.stderr, '', 'no warning');
  eq(driftFrom(STARTER, readScene(out)), null, 'the CLI with no override draws the committed example');
  const report = JSON.parse(r.stdout);
  eq(report.style.source, 'defaults', 'the report says the house style drew it');
  eq(report.style.edgeKinds.flow, 'primary flow', 'and names each kind by its meaning');
});

// A committed example is shared: it must build the same on a maintainer's
// machine with a personal override as on CI with none (#50). buildDiagram()
// never reads the store, and the CLI's --defaults skips it.
test('both committed Excalidraw examples build exactly even with a personal override on the machine (#50, #90)', () => {
  clearStore();
  plantOverride(PERSONAL);
  for (const name of ['starter-architecture', 'aws-data-platform']) {
    const specPath = join(TEMPLATES, `${name}.spec.json`);
    const committed = join(TEMPLATES, `${name}.excalidraw`);
    eq(driftFrom(committed, builder.buildDiagram(readScene(specPath)).scene), null, `${name}: buildDiagram() ignores the store`);
    const forced = join(TMP, `${name}.forced-defaults.excalidraw`);
    const r = buildCli(specPath, '--out', forced, '--defaults');
    eq(r.status, 0, `${name}: --defaults build: ${r.stderr}`);
    eq(driftFrom(committed, readScene(forced)), null, `${name}: --defaults draws the committed example although an override is present`);
    eq(JSON.parse(r.stdout).style.reason, '--defaults', `${name}: and says why`);
  }
  const personal = join(TMP, 'personal.excalidraw');
  const p = buildCli(STARTER_SPEC, '--out', personal);
  eq(p.status, 0, `personal build: ${p.stderr}`);
  assert(driftFrom(STARTER, readScene(personal)), 'without --defaults the override is picked up automatically');
  eq(JSON.parse(p.stdout).style.source, 'override', 'and the report says so');
  clearStore();
});

test('an Excalidraw override restyles tokens and kinds, adds a kind, and never outranks the spec (#90)', () => {
  const style = styleTokens.resolveStyle({ ...PERSONAL, tokens: { ...PERSONAL.tokens, edgeRouting: 'points', colPitch: 600 } });
  eq(style.source, 'override', 'a valid override applies');
  eq(style.overridden.join(','),
    'tokens.rounded,tokens.fillStyle,tokens.boundaryStroke,tokens.edgeColor,tokens.edgeRouting,tokens.colPitch,edgeKinds.flow.meaning,edgeKinds.query',
    'overridden names every value it changed');
  eq(style.edgeKinds.async.color, '#343a40', 'a kind whose colour follows a token takes the override');
  eq(style.edgeKinds.error.color, builder.EDGE_KINDS.error.color, 'and a kind with its own colour keeps it');
  const spec = {
    style: { boundaryStroke: 'dashed' },
    layout: { colPitch: 400 },
    boundaries: [{ id: 'zone', label: 'Zone' }],
    nodes: [
      { id: 'a', kind: 'box', label: 'A', accent: 'blue', col: 0, row: 0, parent: 'zone' },
      { id: 'b', kind: 'round', label: 'B', accent: 'green', fillStyle: 'solid', col: 1, row: 0, parent: 'zone' },
      { id: 'c', label: 'C', col: 2, row: 0 },
    ],
    edges: [
      { from: 'a', to: 'b', kind: 'flow' },
      { from: 'b', to: 'c', kind: 'query' },
      { from: 'a', to: 'c', kind: 'error', color: '#0b7285' },
    ],
  };
  const { scene, report } = builder.buildDiagram(spec, { style });
  const house = builder.buildDiagram(spec).scene;
  const shape = (s, label) => s.elements.find((e) => e.id === s.elements.find((t) => t.type === 'text' && t.text === label)?.containerId);
  eq(report.unknownKinds.length, 0, 'a kind the override adds is a known kind');
  eq(report.style.source, 'override', 'the report names the style');
  eq(shape(scene, 'A').fillStyle, 'hachure', 'nodes take the fill style token');
  eq(shape(scene, 'B').fillStyle, 'solid', 'a fill style the node sets still wins');
  eq(shape(scene, 'C').roundness, null, 'corners follow the rounded token');
  eq(JSON.stringify(shape(house, 'C').roundness), JSON.stringify(core.ROUND), 'where the house style rounds them');
  eq(shape(scene, 'B').x, shape(house, 'B').x, 'the spec layout pitch still wins over an overridden pitch');
  const arrows = scene.elements.filter((e) => e.type === 'arrow' && e.startBinding);
  eq(JSON.stringify(arrows.map((a) => [a.strokeColor, a.strokeWidth])), JSON.stringify([['#343a40', 4], ['#f08c00', 2], ['#0b7285', 4]]),
    'flow takes the connector colour token, the new kind its own colour and width, and a colour the edge sets still wins');
  assert(arrows.every((a) => !a.elbowed), 'the routing token turns elbow arrows off');
  const texts = scene.elements.filter((e) => e.type === 'text').map((e) => e.text);
  assert(['trigger', 'SQL query', 'failure path'].every((t) => texts.includes(t)),
    'the legend gives flow its overridden meaning, adds the new kind, and error keeps its own');
  const boundary = (s) => {
    const label = s.elements.find((e) => e.type === 'text' && e.text === 'Zone');
    return s.elements.find((e) => e.type === 'rectangle' && e.groupIds?.includes(label.groupIds[0]));
  };
  eq(boundary(scene).strokeStyle, 'dashed', 'a boundary stroke the spec style sets still wins');
  const { style: _, ...unstyled } = spec;
  eq(boundary(builder.buildDiagram(unstyled, { style }).scene).strokeStyle, 'dotted', 'and without it the override draws the boundary');
});

// An override is named values in Excalidraw's own vocabulary; raw element JSON,
// a value the app does not offer, or a builder constant is refused - and a
// legend's free text is never echoed. Icon choice is not a token (invariant 4).
test('an Excalidraw override is checked field by field, and a bad one is ignored whole (#90)', () => {
  const base = { schemaVersion: 1, engine: 'excalidraw' };
  const cases = [
    [{ ...base, tokens: { strokeWidth: 3 } }, 'tokens.strokeWidth: expected one of 1, 2 or 4'],
    [{ ...base, tokens: { fontFamily: 8 } }, 'tokens.fontFamily: expected one of 1, 2, 3, 5 or 6'],
    [{ ...base, tokens: { captionSize: 24 } }, 'tokens.captionSize: expected one of 16, 20, 28 or 36'],
    [{ ...base, tokens: { rounded: 1 } }, 'tokens.rounded: expected true or false'],
    [{ ...base, tokens: { fillStyle: 'zigzag' } }, 'tokens.fillStyle: expected one of "solid", "hachure" or "cross-hatch"'],
    [{ ...base, tokens: { edgeRouting: 'curved' } }, 'tokens.edgeRouting: expected "elbow" or "points"'],
    [{ ...base, tokens: { edgeColor: 'black' } }, 'tokens.edgeColor: expected a #RRGGBB colour'],
    [{ ...base, tokens: { cell: 50 } }, 'tokens.cell: fixed by the builder'],
    [{ ...base, tokens: { icon: 'aws-serverless:0' } }, 'tokens.icon: not a style token'],
    [{ ...base, tokens: { nodeWidth: 300 } }, 'tokens.colPitch: 320 leaves less than 40px between 300px-wide nodes'],
    [{ ...base, edgeKinds: { flow: { strokeStyle: 'wavy' } } }, 'edgeKinds.flow.strokeStyle: expected one of "solid", "dashed" or "dotted"'],
    [{ ...base, edgeKinds: { flow: { element: { type: 'arrow', roundness: null } } } }, 'edgeKinds.flow.element: not an edge kind field (color, strokeStyle, width, meaning)'],
    [{ ...base, edgeKinds: { flow: { endArrowhead: 'dot' } } }, 'edgeKinds.flow.endArrowhead: not an edge kind field'],
    [{ ...base, edgeKinds: { query: { color: '#f08c00' } } }, 'a new kind needs all of color, strokeStyle, width and meaning'],
    [{ ...base, edgeKinds: { flow: { meaning: 'x'.repeat(61) } } }, 'edgeKinds.flow.meaning: expected one line of 1 to 60 characters'],
    [{ schemaVersion: 1, engine: 'drawio' }, 'engine: expected "excalidraw"'],
  ];
  for (const [raw, expected] of cases) {
    const errors = styleTokens.validateOverrides(raw);
    assert(errors.some((e) => e.includes(expected)), `expected "${expected}", got: ${errors.join('; ')}`);
    const resolved = styleTokens.resolveStyle(raw);
    assert(resolved.source === 'defaults' && resolved.errors.length && resolved.overridden.length === 0,
      `a bad override is ignored whole: ${expected}`);
    eq(JSON.stringify(resolved.tokens), JSON.stringify(builder.STYLE), `and every token is the house style's: ${expected}`);
    assert(!errors.some((e) => e.includes('xxxxxxxxxx')), 'a legend meaning is never echoed');
  }
  const overridable = Object.fromEntries(Object.keys(styleTokens.TOKEN_RULES).map((k) => [k, builder.STYLE[k]]));
  eq(styleTokens.validateOverrides({ ...base, tokens: overridable, edgeKinds: { query: QUERY } }).length, 0,
    'every overridable shipped value, and a whole new kind, is itself a valid override');
});

test('a broken Excalidraw override warns once, and the build draws the house style (#90)', () => {
  for (const [label, content] of [
    ['bad JSON', '{"schemaVersion":1,'],
    ['bad value', JSON.stringify({ schemaVersion: 1, engine: 'excalidraw', tokens: { strokeWidth: 3 } })],
  ]) {
    clearStore();
    plantOverride(content);
    const out = join(TMP, `broken-override-${label.replace(' ', '-')}.excalidraw`);
    const r = buildCli(STARTER_SPEC, '--out', out);
    eq(r.status, 0, `${label}: the build still succeeds (${r.stderr})`);
    eq(r.stderr.trim().split('\n').length, 1, `${label}: one warning line`);
    assert(r.stderr.startsWith('warning: ignoring'), `${label}: the warning says what was ignored`);
    const report = JSON.parse(r.stdout);
    eq(report.style.source, 'defaults', `${label}: the house style drew it`);
    assert(report.style.errors.length > 0, `${label}: the report lists the problems`);
    eq(driftFrom(STARTER, readScene(out)), null, `${label}: exactly the house-style scene`);
  }
  clearStore();
});

test('Excalidraw --print-style shows the style a build would use, and writes nothing (#90)', () => {
  clearStore();
  plantOverride(`﻿${JSON.stringify(PERSONAL)}`);
  const r = buildCli('--print-style');
  eq(r.status, 0, `--print-style: ${r.stderr}`);
  const shown = JSON.parse(r.stdout);
  eq(shown.store, OWN_STORE, 'it names the store');
  eq(shown.source, 'override', 'a byte-order mark does not make the override unreadable');
  eq(shown.edgeKinds.query.meaning, 'SQL query', 'every active kind, in full');
  eq(shown.edgeKinds.error.meaning, 'failure path', 'shipped kinds included');
  eq(shown.tokens.fillStyle, 'hachure', 'every token');
  eq(JSON.parse(buildCli('--print-style', '--defaults').stdout).source, 'defaults', '--defaults shows the house style');
  const stray = join(TMP, 'print-style-stray.excalidraw');
  for (const bad of [[STARTER_SPEC, '--print-style'], ['--print-style', '--out', stray]]) {
    eq(buildCli(...bad).status, 2, `${bad.join(' ')} is a usage error`);
  }
  assert(!existsSync(stray), 'nothing was written');
  clearStore();
});

// A literal model must get a usage error for a mistyped option and one line
// naming the file for an unreadable one - never success, never a stack trace.
const firstLine = (r) => r.stderr.trim().split('\n')[0];
const hasStack = (r) => /\n\s+at /.test(r.stderr);

test('Excalidraw build refuses a bad command line in one line, before reading or writing (#116)', () => {
  const dir = join(TMP, 'build-args');
  mkdirSync(dir, { recursive: true });
  const malformed = join(dir, 'malformed.spec.json');
  writeFileSync(malformed, '{ "nodes": [ ');
  const target = join(dir, 'never.excalidraw');
  for (const [args, message] of [
    [['--print-style', '--typo'], /unknown option --typo/],
    [[malformed, '--out', target], /is not valid JSON$/],
    [[join(dir, 'absent.spec.json'), '--out', target], /^no spec file at /],
    [[STARTER_SPEC, STARTER_SPEC, '--out', target], /expected one spec file, got 2/],
    [['--out', target], /expected a spec file/],
    [[STARTER_SPEC], /--out <file.excalidraw> is required/],
    [[STARTER_SPEC, '--out'], /--out needs a value/],
    [[STARTER_SPEC, '--out', target, '--out', target], /--out given more than once/],
    [[STARTER_SPEC, '--out', target, '--verbose'], /unknown option --verbose/],
  ]) {
    const r = buildCli(...args);
    const shown = args.map((a) => a.split(/[\\/]/).pop()).join(' ');
    eq(r.status, 2, `${shown}: usage status`);
    assert(message.test(firstLine(r)), `${shown}: said "${firstLine(r)}"`);
    assert(!hasStack(r) && !existsSync(target), `${shown}: no stack trace and nothing written`);
  }
  eq(buildCli(malformed, '--out', target).stderr.trim().split('\n').length, 1, 'a malformed spec is one line');
  const flagFirst = buildCli('--out', target, '--defaults', STARTER_SPEC);
  eq(flagFirst.status, 0, `flags before the spec still build: ${firstLine(flagFirst)}`);
  eq(JSON.parse(flagFirst.stdout).wrote, target, 'reports the output it wrote');
});

test('Excalidraw analyze, validate and icon refuse a bad command line and name an unreadable file (#116)', () => {
  const dir = join(TMP, 'tool-args');
  mkdirSync(dir, { recursive: true });
  const malformed = join(dir, 'malformed.excalidraw');
  writeFileSync(malformed, '{ "type": "excalidraw", "elements": [ "secret label" ');
  const absent = join(dir, 'absent.excalidraw');
  const summary = join(dir, 'summary.json');
  for (const [script, args, message] of [
    ['analyze-excalidraw.mjs', [STARTER, '--typo'], /unknown option --typo/],
    ['analyze-excalidraw.mjs', [], /expected at least one .excalidraw file/],
    ['analyze-excalidraw.mjs', [STARTER, STARTER, '--cells'], /--cells and --images read one file/],
    ['analyze-excalidraw.mjs', [absent, '--out', summary], /^no scene at /],
    ['analyze-excalidraw.mjs', [malformed, '--cells'], /is not valid JSON$/],
    ['analyze-excalidraw.mjs', [STARTER, '--out'], /--out needs a value/],
    ['validate-excalidraw.mjs', [STARTER, '--verbose'], /unknown option --verbose/],
    ['validate-excalidraw.mjs', [], /expected at least one/],
    ['find-icon.mjs', ['postgres', '--fuzzy'], /unknown option --fuzzy/],
    ['find-icon.mjs', ['postgres', '--limit', '0'], /--limit expects .* at least 1, got 0/],
    ['find-icon.mjs', ['postgres', '--limit', 'three'], /--limit expects/],
    ['find-icon.mjs', ['--limit', '3'], /expected a component name/],
    ['find-icon.mjs', ['--stats', 'postgres'], /separate requests/],
    ['find-icon.mjs', ['--resolve'], /--resolve needs a value/],
  ]) {
    const r = toolCli(script, ...args);
    const shown = `${script} ${args.map((a) => a.split(/[\\/]/).pop()).join(' ')}`;
    eq(r.status, 2, `${shown}: usage status`);
    assert(message.test(firstLine(r)), `${shown}: said "${firstLine(r)}"`);
    assert(!hasStack(r) && !existsSync(summary), `${shown}: no stack trace and nothing written`);
  }

  // A file validate cannot read is its own FAIL, named, never quoting the file.
  const v = toolCli('validate-excalidraw.mjs', absent, malformed, '--json');
  eq(v.status, 1, 'unreadable files fail validation');
  assert(!v.stdout.includes('secret label') && !v.stderr.includes('secret label'), 'the JSON error never quotes the file');
  assert(v.stdout.includes(`no file at ${absent.replace(/\\/g, '\\\\')}`), `a missing file is named: ${v.stdout.slice(0, 200)}`);
  assert(v.stdout.includes('is not valid JSON'), 'a malformed file is named');

  // Flags anywhere, --stats and --resolve included.
  const search = toolCli('find-icon.mjs', '--limit', '2', 'aws', 'lambda');
  eq(search.status, 0, `--limit before the words: ${firstLine(search)}`);
  const found = JSON.parse(search.stdout);
  eq(found.query, 'aws lambda', 'every word is the query');
  assert(found.matches.length <= 2, '--limit is honoured');
  eq(toolCli('find-icon.mjs', '--resolve', 'drawio:databases/postgresql').status, 0, '--resolve still resolves');
  eq(toolCli('validate-excalidraw.mjs', '--strict', STARTER).status, 0, 'a flag before the file');
});

test('Excalidraw findings: --derive reads the conventions that are one token each, and an agent finding holds its target (#90)', () => {
  const record = {
    version: 4,
    conventions: [
      convention('stroke-roughness', '0', 90, 100),
      convention('stroke-width', '6', 50, 60),
      convention('font-family', '5', 35, 50),
      convention('arrow-routing', 'false', 20, 40),
      convention('zone-stroke-style', 'dotted', 5, 5),
      convention('arrow-color', '#1E1E1E', 70, 100),
      { id: 'canvas-background', observed: null, evidence: { n: 0, total: 0, share: null }, confidence: 'default' },
      convention('edges-rounded', 'sharp', 40, 100),
      convention('font-size', '28', 53, 173),
    ],
    tallies: { roles: { shape: { roundness: { sharp: 40, type3: 35, type2: 25 } } } },
  };
  const { derived, skipped } = findingsTool.deriveFindings(record);
  const at = (target) => derived.find((f) => f.target === target);
  eq(at('tokens.roughness').observed, 0, 'a value is read as the type its token takes');
  eq(at('tokens.roughness').confidence, 'high', 'graded like a convention: 90 of 100');
  eq(at('tokens.fontFamily').confidence, 'medium', '35 of 50');
  eq(at('tokens.edgeRouting').observed, 'points', 'an arrow that is not elbowed is the builder\'s points routing');
  eq(at('tokens.edgeRouting').confidence, 'low', '20 of 40');
  eq(at('tokens.boundaryStroke').confidence, 'low', 'five boundaries are a hint, whatever their share');
  eq(at('tokens.edgeColor').observed, '#1e1e1e', 'a colour differing only in case is the shipped colour');
  eq(at('tokens.rounded').observed, true, 'every roundness type counts as a rounded corner');
  eq(at('tokens.rounded').evidence, 60, 'so 60 rounded corners outweigh 40 sharp ones');
  assert(!derived.some((f) => /fontSize|captionSize/.test(f.target)), 'font size is not derived: its tally mixes labels, captions and titles');
  const why = Object.fromEntries(skipped.map((s) => [s.target, s.reason]));
  assert(why['tokens.strokeWidth']?.includes('outside what a build accepts'), `a stroke width Excalidraw does not offer is skipped: ${why['tokens.strokeWidth']}`);
  assert(why['tokens.canvasBackground']?.includes('no evidence'), 'a convention resting on a default is no finding');
  assert(why['tokens.fillStyle']?.includes('no fill-style convention'), 'a convention the record lacks is named');

  let file = findingsTool.mergeDerived(findingsTool.readFindings(join(TMP, 'no-such-findings.json')), record).file;
  eq(file.engine, 'excalidraw', 'the findings file is for this engine');
  const split = findingsTool.addFinding(file, {
    target: 'edgeKinds.async', observed: { meaning: 'file transfer', strokeStyle: 'dotted' }, evidence: 4, confidence: 'medium',
  });
  eq(split.added.map((f) => f.target).join(','), 'edgeKinds.async.meaning,edgeKinds.async.strokeStyle', 'a whole shipped kind splits into one finding per field');
  for (const [target, observed] of [
    ['tokens.icon', 'aws-serverless:0'], ['edgeKinds.flow.endArrowhead', 'dot'], ['edgeKinds.query.color', '#f08c00'], ['tokens.cell', 50],
  ]) {
    eq(findingsTool.addFinding(file, { target, observed, evidence: 2, confidence: 'low' }).added.length, 0, `${target} is refused`);
  }
  file = findingsTool.addFinding(split.file, { target: 'tokens.roughness', observed: 1, evidence: 3, confidence: 'low' }).file;
  const again = findingsTool.mergeDerived(file, record);
  eq(again.heldByAgent.join(','), 'tokens.roughness', 'a later --derive leaves a target the agent holds');
  eq(again.file.findings.filter((f) => f.target === 'tokens.roughness').length, 1, 'one entry per target');
  let refused = '';
  try { findingsTool.readFindings(writeSpec('drawio-findings.json', { schemaVersion: 1, engine: 'drawio', findings: [] })); } catch (e) { refused = e.message; }
  assert(refused.includes('not a findings file for Excalidraw'), `a Draw.io findings file is not read as this engine's: ${refused}`);
});

test('Excalidraw apply: --list offers only contradictions, --accept says what changed, --reset undoes it (#90)', () => {
  clearStore();
  mkdirSync(OWN_STORE, { recursive: true });
  writeFileSync(join(OWN_STORE, 'source-analysis.json'), JSON.stringify({
    version: 2,
    conventions: [
      convention('stroke-roughness', '1', 80, 100),
      convention('zone-stroke-style', 'dotted', 12, 13),
      convention('fill-style', 'hachure', 7, 10),
    ],
  }));
  const json = (r, what) => { eq(r.status, 0, `${what}: ${r.stderr}`); return JSON.parse(r.stdout); };
  json(toolCli('style-findings.mjs', '--derive'), 'derive');
  json(toolCli('style-findings.mjs', '--add', 'edgeKinds.flow.meaning', '--observed', 'trigger', '--evidence', '2', '--confidence', 'low'), 'add a meaning');
  json(toolCli('style-findings.mjs', '--add', 'edgeKinds.query', '--observed', JSON.stringify(QUERY), '--evidence', '3', '--confidence', 'medium'), 'add a kind');
  eq(toolCli('style-findings.mjs', '--add', 'tokens.strokeWidth', '--observed', '3', '--evidence', '1', '--confidence', 'low').status, 1,
    'a value a build would refuse is refused as a finding');

  const listed = json(toolCli('apply-style.mjs', '--list'), 'list');
  eq(listed.candidates.map((c) => c.id).join(','), 'tokens.boundaryStroke,tokens.fillStyle,edgeKinds.query,edgeKinds.flow.meaning',
    'only the contradictions, strongest first');
  assert(listed.alreadyInEffect.includes('tokens.roughness'), 'a finding that matches what is drawn is not offered');
  const meaning = listed.candidates.find((c) => c.id === 'edgeKinds.flow.meaning');
  assert(meaning.lowConfidence && meaning.shipped === 'primary flow' && meaning.current === 'primary flow' && meaning.proposed === 'trigger',
    'a low-confidence candidate is still offered, flagged, with shipped, current and proposed');

  eq(toolCli('apply-style.mjs', '--accept', 'tokens.roughness').status, 2, 'accepting what is not a candidate exits 2');
  assert(!existsSync(OVERRIDES), 'and writes nothing');

  const accepted = json(toolCli('apply-style.mjs', '--accept', 'edgeKinds.query,tokens.boundaryStroke'), 'accept');
  eq(JSON.stringify(accepted.changed), JSON.stringify([
    { target: 'edgeKinds.query', from: null, fromSource: 'house style', to: QUERY },
    { target: 'tokens.boundaryStroke', from: 'dashed', fromSource: 'house style', to: 'dotted' },
  ]), 'it reports each change against what was in effect');
  const written = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
  eq(Object.keys(written).join(','), 'schemaVersion,engine,updated,tokens,edgeKinds', 'the override carries named tokens and kinds only');
  eq(written.engine, 'excalidraw', 'for this engine');
  eq(styleTokens.validateOverrides(written).length, 0, 'and is valid');
  json(toolCli('apply-style.mjs', '--accept', 'edgeKinds.flow.meaning'), 'accept on top');
  eq(json(toolCli('apply-style.mjs', '--list'), 'list after').candidates.map((c) => c.id).join(','), 'tokens.fillStyle', 'nothing accepted is offered again');

  const specPath = writeSpec('applied.spec.json', {
    boundaries: [{ id: 'zone', label: 'Zone' }],
    nodes: [{ id: 'a', label: 'A', col: 0, row: 0, parent: 'zone' }, { id: 'b', label: 'B', col: 1, row: 0, parent: 'zone' }, { id: 'c', label: 'C', col: 2, row: 0 }],
    edges: [{ from: 'a', to: 'b', kind: 'query' }, { from: 'b', to: 'c', kind: 'flow' }],
  });
  const out = join(TMP, 'applied.excalidraw');
  const report = json(buildCli(specPath, '--out', out), 'build with the override');
  eq(report.style.edgeKinds.query, 'SQL query', 'the next build draws what was accepted');
  eq(report.unknownKinds.length, 0, 'and knows the new kind');
  const scene = readScene(out);
  assert(scene.elements.some((e) => e.type === 'rectangle' && e.strokeStyle === 'dotted'), 'the boundary is drawn dotted');
  assert(scene.elements.some((e) => e.type === 'text' && e.text === 'trigger'), 'and the legend says what flow means here');

  writeFileSync(OVERRIDES, '{');
  eq(toolCli('apply-style.mjs', '--accept', 'tokens.fillStyle').status, 1, 'a broken override is never quietly replaced');
  eq(json(toolCli('apply-style.mjs', '--reset'), 'reset').removed, OVERRIDES, '--reset removes the override');
  eq(json(buildCli('--print-style'), 'print-style after reset').source, 'defaults', 'and the house style is back');
  clearStore();
});

test('Excalidraw apply drops whatever equals the house style, a kind that follows a token included (#90)', () => {
  const next = applyTool.applyAccepted(
    { schemaVersion: 1, engine: 'excalidraw', tokens: { fillStyle: 'hachure', edgeColor: '#343a40' }, edgeKinds: { flow: { meaning: 'trigger' } } },
    [
      { id: 'tokens.fillStyle', proposed: 'solid' },
      { id: 'edgeKinds.flow.meaning', proposed: 'primary flow' },
      { id: 'edgeKinds.async.color', proposed: '#343A40' },
      { id: 'edgeKinds.data.width', proposed: 4 },
    ],
  );
  eq(JSON.stringify(next), JSON.stringify({ schemaVersion: 1, engine: 'excalidraw', tokens: { edgeColor: '#343a40' } }),
    'values back at the house style drop out, a kind colour or width that follows its token included');
});

test('the Excalidraw builder draws from the resolved style, not its own constants (#90)', () => {
  const src = readFileSync(join(SCRIPTS, 'build-diagram.mjs'), 'utf8');
  for (const literal of ['export const STYLE = {', 'export const EDGE_KINDS = {', 'STYLE.', "n.fillStyle ?? 'solid'", "backgroundColor: look.bg, fillStyle: 'solid'"]) {
    assert(!src.includes(literal), `build-diagram.mjs still hard-codes ${JSON.stringify(literal)}`);
  }
  eq(builder.STYLE.fillStyle, 'solid', 'the fill style token defaults to the literal it replaced');
  eq(builder.STYLE.edgeColor, core.PALETTE.black.stroke, 'the connector colour token defaults to the colour flow and async drew with');
  eq(JSON.stringify(Object.values(builder.EDGE_KINDS).map((k) => [k.color, k.strokeStyle, k.width])), JSON.stringify([
    ['#1e1e1e', 'solid', 4], ['#1e1e1e', 'dashed', 4], ['#1971c2', 'solid', 4], ['#e03131', 'solid', 4],
    ['#2f9e44', 'dashed', 4], ['#29b5e8', 'solid', 4], ['#495057', 'dotted', 1],
  ]), 'every shipped kind draws exactly as before');
});

test('a connector drawn through a node it does not connect is a warning that names both (#125)', () => {
  const row = (ids, extra = {}) => ids.map((id, col) => ({ id, label: id.toUpperCase(), col, row: 0, ...extra[id] }));
  const three = { nodes: row(['a', 'b', 'c']), edges: [{ from: 'a', to: 'c' }] };
  const built = builder.buildDiagram(three);
  const v = validator.validateScene(built.scene);
  assert(v.ok, `still valid: ${v.errors.join('; ')}`);
  const bBox = built.scene.elements.find((el) => el.type === 'rectangle' && el.x === 280);
  const crossing = v.warnings.filter((w) => w.includes('crosses'));
  eq(crossing.length, 1, 'one crossing warning');
  assert(crossing[0].includes(`"${bBox.id}"`), `the validator names node B's shape: ${crossing[0]}`);
  eq(v.info.crossings, 1, 'counted in info');
  eq(JSON.stringify(built.report.crossings), JSON.stringify(['edge a->c crosses node b; move b off the line or give the edge a route']),
    'the builder names the edge and the node from the spec');

  // Moved off the line, or a connector that only touches its own ends: nothing.
  eq(builder.buildDiagram({ ...three, nodes: row(['a', 'b', 'c'], { b: { row: 1 } }) }).report.crossings.length, 0, 'B moved down a row');
  eq(builder.buildDiagram({ ...three, edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] }).report.crossings.length, 0, 'a chain');
  // An arrow into a boundary crosses its edge on purpose.
  const scoped = builder.buildDiagram({ nodes: row(['a', 'b', 'c'], { b: { parent: 'g' } }),
    boundaries: [{ id: 'g', kind: 'scope', label: 'Group' }], edges: [{ from: 'a', to: 'b' }] });
  eq(scoped.scene.elements.filter((el) => el.type === 'rectangle').length, 4, 'the boundary was drawn');
  eq(scoped.report.crossings.length, 0, `a boundary is not an obstacle: ${scoped.report.crossings}`);
  // A grouped node - here an icon placeholder with its caption - is one obstacle.
  const icon = builder.buildDiagram({ ...three, nodes: row(['a', 'b', 'c'], { b: { kind: 'placeholder' } }) });
  eq(JSON.stringify(icon.report.crossings), JSON.stringify(['edge a->c crosses node b; move b off the line or give the edge a route']), 'a grouped node');

  for (const name of ['starter-architecture', 'aws-data-platform', 'shared-icon-packs', 'shared-icon-gallery']) {
    const spec = JSON.parse(readFileSync(join(SKILL, 'assets', 'templates', `${name}.spec.json`), 'utf8'));
    eq(builder.buildDiagram(spec).report.crossings.length, 0, `${name} template`);
  }
  for (const name of ['starter-architecture', 'aws-data-platform']) {
    const scene = JSON.parse(readFileSync(join(SKILL, 'assets', 'templates', `${name}.excalidraw`), 'utf8'));
    eq(validator.validateScene(scene).info.crossings, 0, `${name} committed scene`);
  }

  const specPath = join(TMP, 'crossing.spec.json');
  writeFileSync(specPath, JSON.stringify(three));
  const printed = JSON.parse(node('build-diagram.mjs', [specPath, '--out', join(TMP, 'crossing.excalidraw')]));
  eq(JSON.stringify(printed.crossings), JSON.stringify(built.report.crossings), 'build-diagram prints it');
});

test('a seeded build is byte-identical across processes, and unseeded builds stay random (#119)', () => {
  const dir = join(TMP, 'seeded');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // One template with library icons and embedded files, one plain.
  for (const name of ['aws-data-platform', 'starter-architecture']) {
    const spec = join(SKILL, 'assets', 'templates', `${name}.spec.json`);
    const out = (tag) => join(dir, `${name}-${tag}.excalidraw`);
    for (const tag of ['a', 'b']) {
      const r = buildCli(spec, '--out', out(tag), '--seed', '119', '--defaults');
      eq(r.status, 0, `${name} ${tag} builds: ${r.stderr}`);
      if (tag === 'a') eq(JSON.parse(r.stdout).seed, 119, 'the seed is printed');
    }
    const a = readFileSync(out('a'), 'utf8');
    eq(a, readFileSync(out('b'), 'utf8'), `${name}: same seed, same bytes`);
    const scene = JSON.parse(a);
    eq(renderer.sceneToSvg(scene), renderer.sceneToSvg(JSON.parse(readFileSync(out('b'), 'utf8'))), `${name}: same SVG`);
    const ids = scene.elements.map((el) => el.id);
    eq(new Set(ids).size, ids.length, `${name}: ids are unique`);
    assert(scene.elements.every((el) => el.seed > 0), `${name}: no zero seed, which would draw at random`);
    eq(validator.validateScene(scene).errors.length, 0, `${name}: bindings stay valid`);

    eq(buildCli(spec, '--out', out('c'), '--seed', '120', '--defaults').status, 0, 'another seed builds');
    assert(readFileSync(out('c'), 'utf8') !== a, `${name}: another seed, another scene`);
    eq(buildCli(spec, '--out', out('u'), '--defaults').status, 0, 'an unseeded build');
    assert(readFileSync(out('u'), 'utf8') !== a, `${name}: no seed, random as before`);
  }

  const spec = { nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }] };
  eq(JSON.stringify(builder.buildDiagram(spec, { seed: 7 }).scene), JSON.stringify(builder.buildDiagram(spec, { seed: 7 }).scene), 'the API takes a seed');
  assert(JSON.stringify(builder.buildDiagram(spec).scene) !== JSON.stringify(builder.buildDiagram(spec).scene), 'the API is random without one');
  eq(builder.buildDiagram(spec, { seed: 7 }).scene.elements[0].updated, core.SEEDED_TIME, 'a seeded build does not read the clock');
  assert(builder.buildDiagram(spec).scene.elements[0].updated > core.SEEDED_TIME, 'an unseeded one does');
  for (const bad of ['-1', 'abc', '4294967296', '1.5']) {
    const r = buildCli(join(dir, 'none.json'), '--out', join(dir, 'none.excalidraw'), '--seed', bad);
    eq(r.status, 2, `--seed ${bad} is a usage error`);
    assert(r.stderr.includes('--seed expects a whole number'), `--seed ${bad} says why`);
  }
  let threw = null;
  try { builder.buildDiagram(spec, { seed: -1 }); } catch (error) { threw = error; }
  assert(threw instanceof builder.SpecError, 'the API refuses a bad seed');
});

// #152: `browse --install --force` wrote the download over the installed
// library and only then parsed it, so a malformed replacement destroyed a
// working library while the registry still described the old one - and every
// icon search that enumerated it threw. Run offline against an injected fetch;
// nothing here reaches the network.
const install152 = await (async () => {
  const slug = 'arkitect-test-152';
  const source = `${slug}.excalidrawlib`;
  const file = join(browse.LIB_DIR, source);
  const registry = join(browse.LIB_DIR, 'installed.json');
  const library = (name) => JSON.stringify({
    type: 'excalidrawlib',
    version: 2,
    libraryItems: [{ id: name, name, elements: [core.rectangle({ x: 0, y: 0, width: 10, height: 10 })] }],
  });
  const realFetch = globalThis.fetch;
  const priorRegistry = existsSync(registry) ? readFileSync(registry) : null;
  const serve = (text) => { globalThis.fetch = async () => new Response(text); };
  const entry = () => (existsSync(registry) ? JSON.parse(readFileSync(registry, 'utf8'))[slug] : undefined);
  const out = {};
  try {
    // A first installation that does not parse.
    serve('not a library');
    out.firstFail = await settle(browse.installLibrary(source));
    out.fileAfterFirstFail = existsSync(file);
    out.entryAfterFirstFail = entry();

    // A good one.
    serve(library('one'));
    out.installed = await settle(browse.installLibrary(source, { force: true }));
    out.goodBytes = readFileSync(file);
    out.goodEntry = JSON.stringify(entry());

    // The reported case: a forced replacement that does not parse.
    serve('not a library');
    out.replaceFail = await settle(browse.installLibrary(source, { force: true }));
    out.bytesAfterFail = readFileSync(file);
    out.entryAfterFail = JSON.stringify(entry());
    out.itemsAfterFail = await settle((async () => browse.libraryItems(slug))());

    // And a forced replacement that does.
    serve(library('two'));
    out.replaceOk = await settle(browse.installLibrary(source, { force: true }));
    out.bytesAfterOk = readFileSync(file);
    out.entryAfterOk = JSON.stringify(entry());

    out.strays = readdirSync(browse.LIB_DIR).filter((f) => f.includes('.incoming-'));
  } finally {
    globalThis.fetch = realFetch;
    rmSync(file, { force: true });
    if (priorRegistry) writeFileSync(registry, priorRegistry);
    else rmSync(registry, { force: true });
  }
  return out;
})();

test('a library that does not parse never replaces the installed one (#152)', () => {
  const r = install152;
  assert(r.firstFail.error, 'a first installation that does not parse fails');
  eq(r.fileAfterFirstFail, false, 'and leaves no library behind');
  eq(r.entryAfterFirstFail, undefined, 'and no registry entry');

  assert(!r.installed.error, `a valid library installs: ${r.installed.error?.message}`);
  eq(r.installed.value.items, 1, 'with its item counted');

  assert(r.replaceFail.error, 'a forced replacement that does not parse fails');
  assert(r.goodBytes.equals(r.bytesAfterFail), 'and the installed library is byte-identical');
  eq(r.entryAfterFail, r.goodEntry, 'and its registry entry is unchanged');
  assert(!r.itemsAfterFail.error, 'so an icon search over it still works');
  eq(r.itemsAfterFail.value.length, 1, 'and still finds the item');

  assert(!r.replaceOk.error, 'a valid forced replacement still succeeds');
  assert(!r.goodBytes.equals(r.bytesAfterOk), 'and does replace the bytes');
  assert(r.entryAfterOk !== r.goodEntry, 'and updates the registry with it');

  eq(r.strays.join(' '), '', 'no staging file is left behind');
});

test('the docker compose file pins the official image and a port', () => {
  const compose = readFileSync(join(ROOT, 'docker', 'docker-compose.yml'), 'utf8');
  assert(/image:\s*excalidraw\/excalidraw/.test(compose), 'official image');
  assert(/:80"/.test(compose), 'container port 80 is published');
});

// -------------------------------------------------------------

cleanTestIcons();

finish(haveSources ? null : '(reference-scene tests skipped: .analysis/sources.local.json not present)');
