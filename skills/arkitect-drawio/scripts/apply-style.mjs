#!/usr/bin/env node
// Turn what your own diagrams say into what this install draws (#89).
//
//   node apply-style.mjs --list                 findings that differ from the style in effect
//   node apply-style.mjs --accept <id>[,<id>]   write those into this install's override
//   node apply-style.mjs --reset                back to the shipped house style
//
// Reads <ARKITECT_HOME>/drawio/findings.json, which learn-drawio-style fills
// through style-findings.mjs, and writes <ARKITECT_HOME>/drawio/style-overrides.json,
// which every CLI build merges in unless it is given --defaults. It never edits
// the plugin, the shipped style guide or a committed example, and it runs only
// when the person asks (/apply-drawio-style).

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { parseCliOrExit, exitUsage } from './lib/drawio-core.mjs';
import { writeJson } from './lib/store.mjs';
import {
  SCHEMA_VERSION, ENGINE, T, edgeKindsFor, parseTarget, targetErrors, valueAt, sameValue,
  validateOverrides, resolveStyle, overridesPath,
} from './lib/style-tokens.mjs';
import { findingsPath, readFindings, shippedAt } from './style-findings.mjs';

const USAGE = 'usage: apply-style.mjs --list | --accept <id>[,<id>...] | --reset';

const RANK = { high: 0, medium: 1, low: 2 };

// Findings whose observed value differs from what a build draws now: the
// override's value where it sets the target, the house style's where it does
// not. A finding that already matches is no candidate, however strong its
// evidence - there is nothing to apply. Strongest first, low confidence flagged
// but still offered: the person decides.
export function listCandidates(findings, style) {
  const candidates = [];
  const alreadyInEffect = [];
  const invalid = [];
  for (const f of findings) {
    const problems = targetErrors(f.target, f.observed);
    if (problems.length) { invalid.push({ target: f.target, errors: problems }); continue; }
    const current = valueAt(style, f.target);
    if (sameValue(f.observed, current)) { alreadyInEffect.push(f.target); continue; }
    candidates.push({
      id: f.target,
      shipped: shippedAt(f.target),
      current,
      proposed: f.observed,
      confidence: f.confidence,
      lowConfidence: f.confidence === 'low',
      evidence: f.evidence,
      basis: f.basis,
      ...(f.note ? { note: f.note } : {}),
    });
  }
  candidates.sort((a, b) => (RANK[a.confidence] ?? 3) - (RANK[b.confidence] ?? 3)
    || b.evidence - a.evidence || a.id.localeCompare(b.id));
  return { candidates, alreadyInEffect, invalid };
}

// The override after accepting some candidates. Whatever now equals the house
// style is dropped, so the file only ever says where this install differs.
export function applyAccepted(raw, accepted) {
  const tokens = { ...(raw?.tokens ?? {}) };
  const edgeKinds = Object.fromEntries(Object.entries(raw?.edgeKinds ?? {}).map(([kind, entry]) => [kind, { ...entry }]));
  for (const c of accepted) {
    const t = parseTarget(c.id);
    if (t.type === 'token') tokens[t.name] = c.proposed;
    else if (t.type === 'edgeField') (edgeKinds[t.kind] ??= {})[t.field] = c.proposed;
    else edgeKinds[t.kind] = { ...c.proposed };
  }
  for (const [name, value] of Object.entries(tokens)) if (sameValue(value, T[name])) delete tokens[name];
  // A shipped kind's colour follows the tokens, so compare against those.
  const base = edgeKindsFor({ ...T, ...tokens });
  for (const [kind, entry] of Object.entries(edgeKinds)) {
    if (!Object.hasOwn(base, kind)) continue;
    for (const [field, value] of Object.entries(entry)) if (sameValue(value, base[kind][field])) delete entry[field];
    if (!Object.keys(entry).length) delete edgeKinds[kind];
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    engine: ENGINE,
    ...(Object.keys(tokens).length ? { tokens } : {}),
    ...(Object.keys(edgeKinds).length ? { edgeKinds } : {}),
  };
}

export function readOverride(path = overridesPath()) {
  if (!existsSync(path)) return { raw: null, errors: [] };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
    return { raw, errors: validateOverrides(raw) };
  } catch (error) {
    return { raw: null, errors: [error instanceof SyntaxError ? 'the file is not valid JSON' : `cannot read it: ${error.code ?? error.message}`] };
  }
}

function fail(errors, code = 1) {
  console.error(JSON.stringify({ ok: false, wrote: null, errors }, null, 2));
  process.exit(code);
}

function main(argv) {
  const { options, positionals } = parseCliOrExit(argv, { values: { '--accept': null }, switches: ['--list', '--reset'] }, USAGE);
  if (positionals.length) exitUsage(`unexpected argument "${positionals[0]}"`, USAGE);
  const modes = ['list', 'accept', 'reset'].filter((m) => options[m] !== undefined);
  if (modes.length !== 1) exitUsage(modes.length ? `choose one of --${modes.join(', --')}` : 'expected --list, --accept or --reset', USAGE);

  const file = overridesPath();
  const current = readOverride(file);

  if (options.reset) {
    if (!existsSync(file)) {
      console.log(JSON.stringify({ removed: null, note: 'no override: this install already draws the house style' }, null, 2));
      return;
    }
    unlinkSync(file);
    console.log(JSON.stringify({
      removed: file,
      ...(current.errors.length
        ? { note: 'the removed file had problems, so it was not in effect' }
        : { nowHouseStyle: resolveStyle(current.raw).overridden }),
    }, null, 2));
    return;
  }

  const findings = findingsPath();
  let record;
  try { record = readFindings(findings); } catch (error) { fail([error.message]); }
  const before = current.errors.length ? resolveStyle() : resolveStyle(current.raw, { file: current.raw ? file : null });
  const { candidates, alreadyInEffect, invalid } = listCandidates(record.findings, before);

  if (options.list) {
    console.log(JSON.stringify({
      findings,
      overrides: file,
      overrideInEffect: before.source === 'override',
      ...(current.errors.length ? { overrideProblems: current.errors } : {}),
      recordVersion: record.recordVersion,
      candidates,
      alreadyInEffect,
      invalid,
    }, null, 2));
    return;
  }

  // A broken override is never quietly replaced: fix it or reset it first.
  if (current.errors.length) fail([`${file} has problems and is not in effect; fix it or run --reset first`, ...current.errors]);
  const ids = [...new Set(options.accept.split(',').map((s) => s.trim()).filter(Boolean))];
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (!ids.length || unknown.length) {
    exitUsage(`${ids.length ? `not a current candidate: ${unknown.join(', ')}` : '--accept names no candidate'}; run --list for the candidates`, USAGE);
  }

  const next = applyAccepted(current.raw, ids.map((id) => byId.get(id)));
  const problems = validateOverrides(next);
  if (problems.length) fail(problems);
  const after = resolveStyle(next, { file });
  const empty = !next.tokens && !next.edgeKinds;
  const existed = existsSync(file);
  if (empty) { if (existed) unlinkSync(file); }
  else writeJson(file, { schemaVersion: next.schemaVersion, engine: next.engine, updated: new Date().toISOString(), ...next });

  console.log(JSON.stringify({
    ok: true,
    wrote: empty ? null : file,
    removed: empty && existed ? file : null,
    changed: ids.map((id) => ({
      target: id,
      from: valueAt(before, id),
      fromSource: before.overridden.includes(id) ? 'your override' : 'house style',
      to: valueAt(after, id),
    })),
    overridden: after.overridden,
  }, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith('apply-style.mjs')) main(process.argv.slice(2));
