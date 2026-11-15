// Which engine a file belongs to, for the commands that read a diagram file in
// both engines: validate, analyze, render and spec (#493). One word of slip in
// a command, `excalidraw validate x.drawio`, used to answer with a message about
// something else: "an SVG with no scene", "page 0 is out of range", "not built by
// Arkitect". Here the file is told apart from its own bytes, and the answer names
// the engine it belongs to and the command to run instead.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPng, textChunk } from './png-chunks.mjs';
import { diagramInImage } from './drawio-core.mjs';
import { parseJson } from './read-json.mjs';

// excalidraw-core's SCENE_MIME, which a Draw.io install may not import from;
// tests/toolkit.mjs checks the two agree.
export const EXCALIDRAW_MIME = 'application/vnd.excalidraw+json';

const NAMES = { drawio: 'a Draw.io file', excalidraw: 'an Excalidraw scene' };
// Declarations and comments may come before the root, as in XML anywhere.
const MX_ROOT = /^\s*(?:(?:<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*<(?:mxfile|mxGraphModel)[\s>/]/;
const SVG_ROOT = /^\s*(?:(?:<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*<svg\b/;

// 'drawio', 'excalidraw', or null for a file that is neither's or cannot be read:
// the command then answers as it always did. A .excalidrawlib is the Excalidraw
// validator's own file, so it is not named here.
export function engineOfFile(path) {
  let bytes;
  try { bytes = readFileSync(path); } catch { return null; }
  try {
    if (isPng(bytes)) {
      if (textChunk(bytes, 'zTXt', 'mxGraphModel')) return 'drawio';
      return textChunk(bytes, 'tEXt', EXCALIDRAW_MIME) ? 'excalidraw' : null;
    }
    const head = bytes.subarray(0, 4096).toString('utf8');
    if (SVG_ROOT.test(head)) {
      if (diagramInImage(bytes) != null) return 'drawio';
      return bytes.toString('utf8').includes(`payload-type:${EXCALIDRAW_MIME}`) ? 'excalidraw' : null;
    }
    if (MX_ROOT.test(head)) return 'drawio';
    if (/^﻿?\s*\{/.test(head)) return parseJson(bytes.toString('utf8'))?.type === 'excalidraw' ? 'excalidraw' : null;
  } catch { /* not a file of either engine */ }
  return null;
}

// The command that runs from any folder, as the adapters print it.
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'bin', 'arkitect.mjs');
const shown = (path) => (/^[\w./\\:@%+=,-]+$/.test(path) ? path : JSON.stringify(path));

// One line per file that belongs to the other engine; empty when every file is
// this engine's, or neither's.
export function otherEngineLines(files, engine, verb) {
  const lines = [];
  for (const file of files) {
    const owner = engineOfFile(file);
    if (owner && owner !== engine) lines.push(`${file} is ${NAMES[owner]}: run \`node "${CLI}" ${owner} ${verb} ${shown(file)}\``);
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
