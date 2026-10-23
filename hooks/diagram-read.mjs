#!/usr/bin/env node
// Editing a .drawio, an agent read the whole file with Read straight after
// references/editing.md told it to run the analyzer (#342). A diagram with
// embedded icons runs to megabytes, and one Read of it fills the window;
// wording has not held this before (#265), so the rule is held here.
//
// So before a Read of a .drawio, .dio or .excalidraw with no line range, the
// file must have been analyzed in this session, and a large one is never read
// whole. Either refusal names the analyze command to run. A Read with `limit`
// (a line range) and every other file pass through untouched.

import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIAGRAM = /\.(drawio|dio|excalidraw)$/i;
// A file this size is a few hundred lines of XML or JSON with nothing embedded;
// anything with one icon in it is past it.
export const LARGE = 64 * 1024;
const SHELLS = ['Bash', 'PowerShell'];
// The edit eval's `analyzed-instead-of-reading` grader matches the same (#368).
// A shell variable holding the dispatcher's path is the dispatcher:
// `A=…/bin/arkitect.mjs; node $A drawio analyze …` analyzed the file.
export const ANALYZE = /analyze-(drawio|excalidraw)\.mjs|(\barkitect(@[\w.-]+|\.mjs)?|\$\{?\w+\}?)["']?\s+(drawio|draw\.io|dio|excalidraw|excali|ex)\s+analyze\b/;

export function analyzeCommand(file) {
  const engine = /\.excalidraw$/i.test(file) ? 'excalidraw' : 'drawio';
  const script = join(ROOT, 'skills', `arkitect-${engine}`, 'scripts', `analyze-${engine}.mjs`);
  return `node "${script}" "${file}"${engine === 'drawio' ? ' --page 0' : ''} --cells`;
}

// Whether a shell command in this session analyzed a file with this name.
export function analyzedIn(transcriptPath, file) {
  const name = basename(String(file));
  try {
    for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
      if (!line.includes('"tool_use"')) continue;
      try {
        const e = JSON.parse(line);
        for (const part of (e.message ?? e).content ?? []) {
          const command = String(part?.input?.command ?? '');
          if (part?.type === 'tool_use' && SHELLS.includes(part.name) && ANALYZE.test(command) && command.includes(name)) return true;
        }
      } catch { /* one bad line is not ours to fail */ }
    }
  } catch { /* no transcript: nothing analyzed */ }
  return false;
}

// The refusal, as a sentence, or null to let the Read through.
export function refusalFor(input) {
  if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Read') return null;
  const file = String(input.tool_input?.file_path ?? '');
  if (!DIAGRAM.test(file) || input.tool_input?.limit) return null;
  let size;
  try { size = statSync(resolve(input.cwd || process.cwd(), file)).size; } catch { return null; }
  const run = analyzeCommand(file);
  if (size > LARGE) {
    return `Arkitect: ${basename(file)} is ${Math.round(size / 1024)} KB, and a whole Read of it would fill the context with `
      + `embedded artwork. Run \`${run}\` for its geometry and ids instead, then make a targeted, backed-up edit; read a `
      + 'line range with offset and limit only for the lines you edit.';
  }
  if (!analyzedIn(input.transcript_path, file)) {
    return `Arkitect: analyze ${basename(file)} before reading it. Run \`${run}\` first (references/editing.md); after `
      + 'that, a file this small may be read whole.';
  }
  return null;
}

export function respond(input) {
  const reason = refusalFor(input);
  return reason ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }) : null;
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try { input = JSON.parse(raw) ?? {}; } catch { /* not ours to fail */ }
  const out = respond(input);
  if (out) process.stdout.write(`${out}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('diagram-read.mjs')) main().catch(() => {});
