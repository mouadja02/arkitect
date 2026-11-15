// Which engine a file belongs to, for the commands that read a diagram file in
// both engines: validate, analyze, render and spec (#493). One word of slip in
// a command, `excalidraw validate x.drawio`, used to answer with a message about
// something else: "an SVG with no scene", "page 0 is out of range", "not built by
// Arkitect". Here the file is told apart from its own bytes, and the answer names
// the engine it belongs to and the command to run instead.

import { readFileSync } from 'node:fs';
import { isPng, textChunk } from './png-chunks.mjs';
import { diagramInImage } from './drawio-core.mjs';
import { parseJson } from './read-json.mjs';
import { command } from './command.mjs';

// excalidraw-core's SCENE_MIME, which a Draw.io install may not import from;
// tests/toolkit.mjs checks the two agree.
export const EXCALIDRAW_MIME = 'application/vnd.excalidraw+json';

const NAMES = { drawio: 'a Draw.io file', excalidraw: 'an Excalidraw scene' };
// Declarations and comments may come before the root, as in XML anywhere.
const MX_ROOT = /^\s*(?:(?:<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*<(?:mxfile|mxGraphModel)[\s>/]/;
const SVG_ROOT = /^\s*(?:(?:<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*<svg\b/;
const JSON_START = /^﻿?\s*\{/;

// True when the bytes are a file of `engine`, image or not. A file of neither is
// nobody's: the command then answers as it always did, and a .excalidrawlib is
// the Excalidraw validator's own, so it is not named here. Only the signature of
// the engine NOT being run is tested, so a command handed its own engine's file
// costs a head test and never a second parse of the scene.
function holds(bytes, engine) {
  if (isPng(bytes)) {
    return engine === 'drawio' ? !!textChunk(bytes, 'zTXt', 'mxGraphModel') : !!textChunk(bytes, 'tEXt', EXCALIDRAW_MIME);
  }
  const head = bytes.subarray(0, 4096).toString('utf8');
  if (SVG_ROOT.test(head)) {
    return engine === 'drawio' ? diagramInImage(bytes) != null : bytes.toString('utf8').includes(`payload-type:${EXCALIDRAW_MIME}`);
  }
  if (engine === 'drawio') return MX_ROOT.test(head);
  return JSON_START.test(head) && parseJson(bytes.toString('utf8'))?.type === 'excalidraw';
}

// One line per file that belongs to the other engine; empty when every file is
// this engine's, or neither's, or cannot be read. The line carries the file and
// the verb, not the flags typed: the other engine's flags are its own.
export function otherEngineLines(files, engine, verb) {
  const owner = engine === 'drawio' ? 'excalidraw' : 'drawio';
  const lines = [];
  for (const file of files) {
    let found = false;
    try { found = holds(readFileSync(file), owner); } catch { /* unreadable, or not that engine's */ }
    if (found) lines.push(`${file} is ${NAMES[owner]}: run \`${command(owner, verb, file)}\``);
  }
  return lines;
}

// For a script's main(): say so and exit 2, the way a usage error does.
export function refuseOtherEngine(files, engine, verb) {
  const lines = otherEngineLines(files, engine, verb);
  if (!lines.length) return;
  console.error(lines.join('\n'));
  process.exit(2);
}
