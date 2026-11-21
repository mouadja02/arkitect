// The Draw.io house style as named tokens and connector kinds, and the
// per-install override layer on top of them (#89).
//
// The shipped values are the ones references/style-guide.md gives evidence for.
// A person's own conventions, chosen with apply-style.mjs, live outside the
// plugin in <ARKITECT_HOME>/drawio/style-overrides.json. The CLI build merges
// them in; buildDiagram() itself never reads the disk, so a committed example
// builds the same on every machine.
//
// An override names tokens and edge kinds, never a raw style string. Every
// value is checked against the rules below, so a bad file cannot produce a
// malformed cell. Icon choice, AWS shape internals, orthogonal routing,
// arrowheads and the layout-safety constants are not tokens and cannot be
// overridden. How an override is validated, resolved and loaded is shared with
// Excalidraw, in style-layer.mjs.

import { styleLayer, COLOUR, MEANING, whole } from './style-layer.mjs';

export const T = Object.freeze({
  text: '#232F3E',
  onDark: '#ffffff',
  flow: '#000000',
  error: '#CC0000',
  success: '#009900',
  proposed: '#E7157B',
  info: '#0050ef',
  infoStroke: '#001DBC',
  neutralStroke: '#666666',
  labelBg: '#E6E6E6',
  fontBody: 12,
  fontHeading: 16,
  iconSize: 78,
  colPitch: 320,
  rowPitch: 190,
  // Literals the builder used to bake into its style strings. Each default is
  // exactly the old literal, so output without an override is unchanged.
  rounded: 0,              // corners on boxes, notes, text, scopes and lanes
  edgeRounded: 0,          // corners where an orthogonal connector turns
  fontEdgeLabel: 11,
  noteFill: '#F7F7F7',
  noteStroke: '#DFDFDF',
  noteText: '#333333',
  scopeStrokeWidth: 3,
  scopeDashPattern: '8 8',
});

// Connector kinds, drawn from the tokens so a restyled colour carries through.
export const edgeKindsFor = (t) => ({
  flow: { stroke: t.flow, dashed: 0, width: 2, meaning: 'primary data or control flow' },
  async: { stroke: t.flow, dashed: 1, width: 2, meaning: 'scheduled, asynchronous or reference link' },
  error: { stroke: t.error, dashed: 0, width: 2, meaning: 'failure or exception path' },
  success: { stroke: t.success, dashed: 1, width: 2, meaning: 'successful completion path' },
  light: { stroke: t.neutralStroke, dashed: 1, width: 1, meaning: 'weak association' },
});

// ---------------------------------------------------------------- rules

const FILL = { check: (v) => v === 'none' || COLOUR.check(v), expects: 'a #RRGGBB colour or "none"' };
const BIT = { check: (v) => v === 0 || v === 1, expects: '0 or 1' };
const DASH = { check: (v) => typeof v === 'string' && /^\d{1,2}(?: \d{1,2}){1,5}$/.test(v), expects: 'a dash pattern such as "8 8"' };

export const TOKEN_RULES = Object.freeze({
  text: COLOUR, onDark: COLOUR, flow: COLOUR, error: COLOUR, success: COLOUR, proposed: COLOUR,
  info: COLOUR, infoStroke: COLOUR, neutralStroke: COLOUR, labelBg: FILL,
  fontBody: whole(6, 72), fontHeading: whole(6, 72), iconSize: whole(24, 200),
  colPitch: whole(100, 2000), rowPitch: whole(100, 2000),
  rounded: BIT, edgeRounded: BIT, fontEdgeLabel: whole(6, 72),
  noteFill: FILL, noteStroke: FILL, noteText: COLOUR,
  scopeStrokeWidth: whole(1, 8), scopeDashPattern: DASH,
});

export const EDGE_FIELD_RULES = Object.freeze({ stroke: COLOUR, dashed: BIT, width: whole(1, 8), meaning: MEANING });

// Room between neighbouring icons, so a pitch override cannot stack them.
const MIN_GAP = 40;

export const LAYER = styleLayer({
  engine: 'drawio',
  label: 'Draw.io',
  tokens: T,
  tokenRules: TOKEN_RULES,
  edgeKindsFor,
  edgeFieldRules: EDGE_FIELD_RULES,
  crossCheck: (t) => ['colPitch', 'rowPitch'].filter((pitch) => t[pitch] < t.iconSize + MIN_GAP).map((pitch) =>
    `tokens.${pitch}: ${t[pitch]} leaves less than ${MIN_GAP}px between ${t.iconSize}px icons; use at least ${t.iconSize + MIN_GAP}`),
});

export const {
  SCHEMA_VERSION, ENGINE, EDGE_KINDS, validateOverrides, resolveStyle, overridesPath, loadStyle, loadStyleOrWarn,
  parseTarget, targetErrors, valueAt, shippedAt, sameValue, styleSummary, DEFAULT_STYLE,
} = LAYER;

export { EDGE_KIND_NAME, printedStyle } from './style-layer.mjs';
