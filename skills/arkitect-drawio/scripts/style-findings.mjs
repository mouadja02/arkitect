#!/usr/bin/env node
// What your own diagrams say about the Draw.io house style, kept as a list the
// apply step can act on (#89).
//
//   node style-findings.mjs --derive [--record <source-analysis.json>]
//   node style-findings.mjs --add <target> --observed <value> --evidence <n> --confidence high|medium|low [--note <text>]
//   node style-findings.mjs --remove <target>
//   node style-findings.mjs --list
//
// The list is <ARKITECT_HOME>/drawio/findings.json, beside the record
// learn-drawio-style builds there. One entry per target, of two kinds:
//
//   basis "record"  computed by --derive from the record's tallies. Only what a
//                   tally settles without guessing is derived: body and heading
//                   font size, text colour and corner rounding.
//   basis "agent"   a judgement made looking at the diagrams - what a legend says
//                   a dashed line means, say - recorded with --add. It holds its
//                   target against --derive until it is removed.
//
// A target is `tokens.<name>`, `edgeKinds.<kind>.<field>` for a shipped kind, or
// `edgeKinds.<kind>` for a whole new kind. Every target and value is checked
// against the override rules, so apply-style.mjs is never offered something a
// build would ignore. Nothing here changes what a build draws.

import { existsSync, readFileSync } from 'node:fs';
import { parseCliOrExit, exitUsage, UsageError } from './lib/drawio-core.mjs';
import { storeFile, writeJson } from './lib/store.mjs';
import { SCHEMA_VERSION, ENGINE, T, EDGE_KINDS, parseTarget, targetErrors, sameValue } from './lib/style-tokens.mjs';

const USAGE = 'usage: style-findings.mjs --derive [--record <file>] | --list | --remove <target>\n'
  + '       style-findings.mjs --add <target> --observed <value> --evidence <n> --confidence high|medium|low [--note <text>]';

export const CONFIDENCE = Object.freeze(['high', 'medium', 'low']);

// The grading build-knowledge.mjs gives a convention.
const level = (n, share) => (n >= 40 && share >= 0.7 ? 'high' : n >= 15 && share >= 0.5 ? 'medium' : 'low');

export const findingsPath = (env = process.env) => storeFile(ENGINE, 'findings', env);

const emptyFindings = () => ({ schemaVersion: SCHEMA_VERSION, engine: ENGINE, recordVersion: null, derived: null, findings: [] });

export function readFindings(path = findingsPath()) {
  if (!existsSync(path)) return emptyFindings();
  let file;
  try {
    file = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
  if (file?.schemaVersion !== SCHEMA_VERSION || file.engine !== ENGINE || !Array.isArray(file.findings)) {
    throw new Error(`${path} is not a Draw.io findings file (schemaVersion ${SCHEMA_VERSION})`);
  }
  return file;
}

// The house style's value at a target, or null for a kind it does not ship.
export function shippedAt(target) {
  const t = parseTarget(target);
  if (!t) return null;
  if (t.type === 'token') return Object.hasOwn(T, t.name) ? T[t.name] : null;
  const kind = Object.hasOwn(EDGE_KINDS, t.kind) ? EDGE_KINDS[t.kind] : null;
  if (t.type === 'edgeField') return kind && Object.hasOwn(kind, t.field) ? kind[t.field] : null;
  return kind;
}

// A value as typed: JSON where it parses (14, 0, {"stroke": ...}), else the text
// itself (#CC0000, trigger, 8 8).
export function parseObserved(text) {
  try { return JSON.parse(text); } catch { return text; }
}

// The record-based findings. Tallies are ranked most common first; a share is
// taken over the tally as recorded.
export function deriveFindings(record) {
  const tokens = record?.tokens ?? {};
  const derived = [];
  const skipped = [];
  const sum = (list) => list.reduce((n, e) => n + e.count, 0);
  const consider = (target, observed, n, share) => {
    const problems = targetErrors(target, observed);
    if (problems.length) { skipped.push({ target, reason: `the corpus value is outside what a build accepts: ${problems[0]}` }); return; }
    const shipped = shippedAt(target);
    derived.push({
      target,
      // A colour differing only in case is the same colour.
      observed: sameValue(observed, shipped) ? shipped : observed,
      shipped,
      basis: 'record',
      evidence: n,
      share: Math.round(share * 1000) / 1000,
      confidence: level(n, share),
    });
  };

  const sizes = (tokens.fontSize ?? []).map((e) => ({ value: Number(e.value), count: e.count })).filter((e) => Number.isInteger(e.value));
  const sizeTotal = record?.conventions?.find((c) => c.id === 'type-scale')?.evidence?.total ?? sum(sizes);
  if (sizes.length) {
    const [body] = sizes;
    consider('tokens.fontBody', body.value, body.count, sizeTotal ? body.count / sizeTotal : 0);
    // A heading is weighed against the sizes that are not body text, or it could
    // never outweigh the captions it sits above.
    const heading = sizes.find((e) => e.value > body.value);
    if (heading) consider('tokens.fontHeading', heading.value, heading.count, heading.count / Math.max(1, sizeTotal - body.count));
    else skipped.push({ target: 'tokens.fontHeading', reason: 'the record has no font size larger than the body size' });
  } else {
    skipped.push({ target: 'tokens.fontBody', reason: 'the record has no font size tally' },
      { target: 'tokens.fontHeading', reason: 'the record has no font size tally' });
  }

  // White is text on a filled shape, and the rest say nothing about a colour.
  const notText = new Set(['#ffffff', 'none', 'default', 'inherit']);
  const colours = (tokens.fontColor ?? []).filter((e) => !notText.has(String(e.value).toLowerCase()));
  if (colours.length) consider('tokens.text', colours[0].value, colours[0].count, colours[0].count / sum(colours));
  else skipped.push({ target: 'tokens.text', reason: 'the record has no explicit text colour' });

  const rounded = (tokens.rounded ?? []).map((e) => ({ value: Number(e.value), count: e.count })).filter((e) => e.value === 0 || e.value === 1);
  if (rounded.length) consider('tokens.rounded', rounded[0].value, rounded[0].count, rounded[0].count / sum(rounded));
  else skipped.push({ target: 'tokens.rounded', reason: 'the record has no rounded tally - it predates #89; re-run learn-drawio-style' });

  return { derived, skipped };
}

// Replace the record-based entries, keeping every agent entry and the targets
// those hold.
export function mergeDerived(file, record, { now = new Date() } = {}) {
  const { derived, skipped } = deriveFindings(record);
  const agent = file.findings.filter((f) => f.basis !== 'record');
  const held = new Set(agent.map((f) => f.target));
  const fresh = derived.filter((f) => !held.has(f.target));
  return {
    file: { ...file, recordVersion: record?.version ?? null, derived: now.toISOString(), findings: [...fresh, ...agent] },
    derived: fresh,
    heldByAgent: derived.filter((f) => held.has(f.target)).map((f) => f.target),
    skipped,
  };
}

// An agent-judged finding. A whole object on a shipped kind is split into one
// entry per field, so each can be accepted on its own.
export function addFinding(file, { target, observed, evidence, confidence, note }, { now = new Date() } = {}) {
  const t = parseTarget(target);
  const splitsKind = t?.type === 'edgeKind' && Object.hasOwn(EDGE_KINDS, t.kind)
    && observed && typeof observed === 'object' && !Array.isArray(observed);
  const entries = splitsKind
    ? Object.entries(observed).map(([field, value]) => ({ target: `edgeKinds.${t.kind}.${field}`, observed: value }))
    : [{ target, observed }];
  const errors = splitsKind && !entries.length ? [`${target}: the object names no field`] : [];
  for (const e of entries) errors.push(...targetErrors(e.target, e.observed));
  if (!Number.isSafeInteger(evidence) || evidence < 1) errors.push('--evidence: expected how many times it was seen, a whole number of at least 1');
  if (!CONFIDENCE.includes(confidence)) errors.push('--confidence: expected high, medium or low');
  if (note !== undefined && (typeof note !== 'string' || note.length > 200 || /[ -]/.test(note))) {
    errors.push('--note: expected one line of at most 200 characters');
  }
  if (errors.length) return { file, added: [], errors };
  const added = entries.map((e) => ({
    target: e.target, observed: e.observed, shipped: shippedAt(e.target), basis: 'agent',
    evidence, confidence, ...(note ? { note } : {}), added: now.toISOString(),
  }));
  const replaced = new Set(added.map((e) => e.target));
  return { file: { ...file, findings: [...file.findings.filter((f) => !replaced.has(f.target)), ...added] }, added, errors: [] };
}

// A target, and for a whole kind every field entry under it.
export function removeFinding(file, target) {
  const hits = (f) => f.target === target || f.target.startsWith(`${target}.`);
  return { file: { ...file, findings: file.findings.filter((f) => !hits(f)) }, removed: file.findings.filter(hits).map((f) => f.target) };
}

function wholeArg(value, flag) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new UsageError(`${flag} expects a whole number, got "${value}"`);
  return Number(value);
}

function fail(errors, code = 1) {
  console.error(JSON.stringify({ ok: false, errors }, null, 2));
  process.exit(code);
}

function main(argv) {
  const { options, positionals } = parseCliOrExit(argv, {
    values: {
      '--add': null, '--observed': null, '--evidence': wholeArg, '--confidence': null, '--note': null,
      '--remove': null, '--record': null,
    },
    switches: ['--derive', '--list'],
  }, USAGE);
  if (positionals.length) exitUsage(`unexpected argument "${positionals[0]}"`, USAGE);
  const modes = ['derive', 'list', 'add', 'remove'].filter((m) => options[m] !== undefined);
  if (modes.length !== 1) {
    exitUsage(modes.length ? `choose one of --${modes.join(', --')}` : 'expected --derive, --add, --remove or --list', USAGE);
  }
  const [mode] = modes;
  if (mode !== 'add' && ['observed', 'evidence', 'confidence', 'note'].some((k) => options[k] !== undefined)) {
    exitUsage('--observed, --evidence, --confidence and --note go with --add', USAGE);
  }
  if (mode !== 'derive' && options.record !== undefined) exitUsage('--record goes with --derive', USAGE);

  const path = findingsPath();
  let file;
  try { file = readFindings(path); } catch (error) { fail([error.message]); }

  if (mode === 'list') {
    console.log(JSON.stringify({ findings: path, ...file }, null, 2));
    return;
  }

  if (mode === 'derive') {
    const recordPath = options.record ?? storeFile(ENGINE, 'record');
    if (!existsSync(recordPath)) fail([`no record at ${recordPath}; build one with learn-drawio-style (build-knowledge.mjs) first`]);
    let record;
    try { record = JSON.parse(readFileSync(recordPath, 'utf8')); } catch { fail([`${recordPath} is not valid JSON`]); }
    const result = mergeDerived(file, record);
    writeJson(path, result.file);
    console.log(JSON.stringify({
      wrote: path,
      record: recordPath,
      recordVersion: result.file.recordVersion,
      derived: result.derived.map(({ target, observed, shipped, evidence, confidence }) => ({
        target, observed, shipped, agreesWithHouseStyle: sameValue(observed, shipped), evidence, confidence,
      })),
      heldByAgent: result.heldByAgent,
      skipped: result.skipped,
    }, null, 2));
    return;
  }

  if (mode === 'add') {
    if ([options.observed, options.evidence, options.confidence].some((v) => v === undefined)) {
      exitUsage('--add needs --observed, --evidence and --confidence', USAGE);
    }
    const result = addFinding(file, {
      target: options.add, observed: parseObserved(options.observed),
      evidence: options.evidence, confidence: options.confidence, note: options.note,
    });
    if (result.errors.length) fail(result.errors);
    writeJson(path, result.file);
    console.log(JSON.stringify({ wrote: path, added: result.added }, null, 2));
    return;
  }

  const result = removeFinding(file, options.remove);
  if (!result.removed.length) fail([`no finding for ${options.remove}`]);
  writeJson(path, result.file);
  console.log(JSON.stringify({ wrote: path, removed: result.removed }, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith('style-findings.mjs')) main(process.argv.slice(2));
