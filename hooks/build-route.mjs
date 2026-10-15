#!/usr/bin/env node
// Asked to build orders.spec.json into orders.excalidraw, an agent loaded no
// skill, wrote its own build-excalidraw.js and reported "valid JSON" as the
// validation (#327). A Draw.io control at 2.2.0 did the same. Every Arkitect
// guarantee rides on the skill, and description wording can't reach an agent
// that loads nothing (#265); context added at the prompt does.
//
// So a prompt that names a .drawio or .excalidraw file or an Arkitect spec gets
// one line naming the skill to load. A style question gets the style rule
// instead.
//
// A request that names no file got nothing: asked for "a diagram" for a
// README, 2 runs of 3 loaded no skill and handed over hand-written SVG or
// Mermaid (#371). So a prompt that asks for a diagram gets a line too, naming
// both skills and the engine rule. Only a drawing verb with a diagram noun, or
// "a diagram" asked for, counts; a prompt naming another format (Mermaid,
// PlantUML, SVG ...) and no engine asked for that, and every other prompt gets
// nothing.

import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ruleFor } from './style-question.mjs';

const DRAWIO = /\.drawio\b/i;
const EXCALIDRAW = /\.excalidraw\b/i;
const SPEC = /[^\s"'`()<>[\]]*\.spec\.json\b/gi;
const DIAGRAM = /\b(diagram|arkitect|draw\.?io|excalidraw)\b/i;
const COMMAND = /\/(arkitect:)?(learn|apply)-(drawio|excalidraw)-style\b/i;
// "... architecture review board next week ... Draw it": the noun can sit a
// sentence away from the verb. "doesn't draw" is a bug report, not a request.
const DRAW = /(?<!(\bnot|n't|\bcannot|\bnever)\b[^.?!\n]{0,40})\b(draw|sketch|visuali[sz]e|map out|lay out)\b/i;
const NOUN = /\b(diagrams?|flow ?charts?|architecture|topology|system design)\b/i;
const ASK =/\b(create|make|produce|generate|want|need|give me|add|draw|sketch)\b[^.?!\n]{0,40}?\b(a|an)\b[^.?!\n]{0,40}?\b(diagram|flow ?chart)\b/i;
const OTHER = /\b(mermaid|plantuml|graphviz|d2|ascii|tikz|svg|png|jpe?g|lucid(chart)?|figma|visio|miro|canvas|matplotlib|plotly)\b|\.(mmd|puml|dot)\b/i;
const NAMED = { drawio: /\bdraw\.?io\b|diagrams\.net/i, excalidraw: /\bexcalidraw\b/i };

// A request for a new diagram, in a prompt that names no file (#371).
const draws = (text) => (DRAW.test(text) && NOUN.test(text)) || ASK.test(text);
export function asksForDiagram(text) {
  if (!draws(text)) return false;
  if (!OTHER.test(text)) return true;
  // "... in Draw.io and give me a PNG for the slides" asked for the engine it
  // named; Arkitect renders the PNG and the SVG itself (#383). The engine's own
  // name is no drawing verb: "convert our draw.io diagram to Mermaid" isn't one.
  return Object.values(NAMED).some((re) => re.test(text)) && draws(text.replace(new RegExp(NAMED.drawio.source, 'gi'), ' '));
}

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
  if (!engines.length && !text.match(SPEC) && asksForDiagram(text)) {
    const named = Object.keys(NAMED).filter((e) => NAMED[e].test(text));
    const which = named.length === 1 ? `the arkitect-${named[0]} skill`
      : 'the arkitect-drawio or arkitect-excalidraw skill (AGENTS.md §1: for a client, a review board or AWS, Draw.io; '
        + 'for a README, a sketch or system design, Excalidraw)';
    return `Arkitect: this prompt asks for a diagram. Load ${which} before you draw, and deliver the native file it `
      + 'builds and validates, never Mermaid or a hand-written SVG.';
  }
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
