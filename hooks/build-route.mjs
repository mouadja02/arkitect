#!/usr/bin/env node
// Asked to build orders.spec.json into orders.excalidraw, an agent loaded no
// skill, wrote its own build-excalidraw.js and reported "valid JSON" as the
// validation (#327). A Draw.io control at 2.2.0 did the same. Every Arkitect
// guarantee rides on the skill, and description wording can't reach an agent
// that loads nothing (#265); context added at the prompt does.
//
// So a prompt that names a .drawio or .excalidraw file or an Arkitect spec gets
// one line naming the skill to load. A style question gets the style rule
// instead, and every other prompt gets nothing.

import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ruleFor } from './style-question.mjs';

const DRAWIO = /\.drawio\b/i;
const EXCALIDRAW = /\.excalidraw\b/i;
const SPEC = /[^\s"'`()<>[\]]*\.spec\.json\b/gi;
const DIAGRAM = /\b(diagram|arkitect|draw\.?io|excalidraw)\b/i;
const COMMAND = /\/(arkitect:)?(learn|apply)-(drawio|excalidraw)-style\b/i;

// The plugin is installed per user, not per project, so an OpenAPI or Vega
// *.spec.json was routed too (#355). A spec is Arkitect's when the file holds
// nodes or pages, or, before it exists, when the prompt says it is a diagram.
function arkitectSpec(path, cwd) {
  try {
    const file = resolve(cwd, path);
    if (statSync(file).size > 4 * 1024 * 1024) return false;
    const spec = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
    return Array.isArray(spec?.nodes) || Array.isArray(spec?.pages);
  } catch {
    return false;
  }
}

export function routeFor(prompt, cwd = process.cwd()) {
  const text = String(prompt ?? '');
  if (COMMAND.test(text) || ruleFor(text)) return null;
  const engines = [DRAWIO.test(text) && 'drawio', EXCALIDRAW.test(text) && 'excalidraw'].filter(Boolean);
  if (!engines.length) {
    const specs = text.match(SPEC) ?? [];
    if (!specs.length || !(DIAGRAM.test(text) || specs.some((s) => arkitectSpec(s, cwd)))) return null;
  }
  const skills = (engines.length ? engines : ['drawio', 'excalidraw']).map((e) => `arkitect-${e}`);
  const which = skills.length > 1 ? `the ${skills.join(' or ')} skill, whichever the output is` : `the ${skills[0]} skill`;
  return `Arkitect: this prompt names a diagram file or spec. Load ${which} before you touch it, and build, edit `
    + 'and validate with its scripts, never with a builder or checker of your own.';
}

export function respond(input) {
  return input.hook_event_name === 'UserPromptSubmit' ? routeFor(input.prompt, input.cwd || process.cwd()) : null;
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try { input = JSON.parse(raw) ?? {}; } catch { /* not ours to fail */ }
  const out = respond(input);
  if (out) process.stdout.write(`${out}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('build-route.mjs')) main().catch(() => {});
