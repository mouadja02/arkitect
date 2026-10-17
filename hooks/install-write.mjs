#!/usr/bin/env node
// Agents `cd` into a skill folder to run its scripts, then write relative to
// it: in 11 runs of 15, Bash ran `cd <plugin>/skills/arkitect-drawio && ...`,
// and one `mkdir -p ./eval-output` from there put the deliverable inside the
// install, where the next plugin update deletes it (#404). #377 made the
// builders refuse an --out there; the agent's own mkdir, spec and report
// files were not covered, and wording has not moved the habit (#265).
//
// So a shell command or file edit that would write inside the plugin is
// refused, naming the path and the way to run it from the project instead.
// A sandboxed run showed a small model reading one refused command as a dead
// shell (#417), so the refusal says the shell still works. Running a script
// from the skill folder is left alone, and so is everything when the project
// itself is the plugin: that is a maintainer at work.

import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';

// One spelling per place: forward slashes, a Git Bash /c/ as C:/, the real
// path where it exists, and no case on Windows.
function norm(p) {
  let s = String(p).replace(/\\/g, '/');
  if (WIN) s = s.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:');
  try { s = realpathSync(s).replace(/\\/g, '/'); } catch { /* not there yet */ }
  s = posix.normalize(s).replace(/\/+$/, '') || '/';
  return WIN ? s.toLowerCase() : s;
}

export function inside(path, root = ROOT) {
  const p = norm(path);
  const r = norm(root);
  return p === r || p.startsWith(`${r}/`);
}

// A shell command as words and operators. Quotes group and are dropped; a
// heredoc's body is text, not commands. PowerShell has no backslash escapes,
// and bash has them inside double quotes only before $ ` " \ and a newline.
export function tokens(command, { powershell = false } = {}) {
  const out = [];
  const text = String(command).replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2[ \t]*(?=\n|$)/g, '<<$2$3');
  let word = null;
  const push = () => { if (word !== null) out.push({ word }); word = null; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") { const end = text.indexOf("'", i + 1); word = (word ?? '') + text.slice(i + 1, end < 0 ? undefined : end); i = end < 0 ? text.length : end; continue; }
    if (c === '"') {
      let j = i + 1; let s = '';
      for (; j < text.length && text[j] !== '"'; j++) s += !powershell && text[j] === '\\' && /[$`"\\\n]/.test(text[j + 1] ?? '') ? text[++j] : text[j];
      word = (word ?? '') + s; i = j; continue;
    }
    if (!powershell && c === '\\' && i + 1 < text.length) { word = (word ?? '') + text[++i]; continue; }
    if (/\s/.test(c) && c !== '\n') { push(); continue; }
    const op = text.slice(i).match(/^(&&|\|\||;|\||\n|&>>?|\d?>>?|<<|<|&)/);
    if (op) {
      // `2>` belongs to a redirection only straight after a space or the start.
      if (/^\d/.test(op[0]) && word !== null) { word += c; continue; }
      push(); out.push({ op: op[0] }); i += op[0].length - 1; continue;
    }
    word = (word ?? '') + c;
  }
  push();
  return out;
}

const SPLIT = new Set(['&&', '||', ';', '|', '\n', '&']);
const WRITERS = /^(mkdir|md|touch|rmdir|rm|tee|new-item|ni|set-content|add-content|out-file|remove-item|del|erase|rd|ri)$/i;
const LAST_ARG = /^(cp|mv|ln|install|copy-item|move-item|copy|move|cpi|mi)$/i;
const CD = /^(cd|pushd|set-location|sl|chdir|push-location)$/i;
const PS_PATH = /^-(path|literalpath|filepath|destination)$/i;
const PS_VALUE = /^-(itemtype|type|value|encoding|name|filter|include|exclude)$/i;

// Each place a command would write, resolved from the directory it starts in.
export function writesOf(command, cwd, { powershell = false } = {}) {
  const vars = { HOME: homedir(), CLAUDE_PLUGIN_ROOT: ROOT, USERPROFILE: homedir() };
  let dir = cwd;
  const at = (p) => {
    const s = String(p).replace(/^~(?=\/|\\|$)/, homedir())
      .replace(/\$\{?(\w+)\}?|\$env:(\w+)/gi, (m, a, b) => vars[a ?? b] ?? m);
    if (/\$/.test(s) || s === '-' || /^\/dev\//.test(s) || /^&\d$/.test(s)) return null;
    return isAbsolute(s) || /^[a-zA-Z]:/.test(s) || s.startsWith('/') ? s : join(dir, s);
  };
  const written = [];
  // One simple command: a cd moves `dir`, anything else may write.
  const run = (seg) => {
    const found = [];
    const words = seg.filter((t) => t.word !== undefined).map((t) => t.word);
    while (words.length && /^\w+=/.test(words[0])) words.shift();
    const [name, ...args] = words;
    // A PowerShell parameter's value is not a path unless the parameter names one.
    const valueOf = (i) => PS_VALUE.test(args[i - 1] ?? '') || PS_PATH.test(args[i - 1] ?? '');
    const positional = args.filter((a, i) => !a.startsWith('-') && !valueOf(i));
    if (name && CD.test(name)) {
      const next = at(positional[0] ?? homedir());
      if (next) dir = next;
      return;
    }
    if (name) {
      const named = args.flatMap((a, i) => (PS_PATH.test(a) && args[i + 1] ? [args[i + 1]] : []));
      if (WRITERS.test(name)) found.push(...(named.length ? named : positional));
      else if (LAST_ARG.test(name)) found.push(...(named.length ? named : positional.slice(-1)));
      else if (/^sed$/i.test(name) && args.some((a) => /^-i/.test(a) || a === '--in-place')) found.push(...positional.slice(1));
      args.forEach((a, i) => {
        const out = a.match(/^--out(?:-dir)?=(.+)$/);
        if (out) found.push(out[1]);
        else if (/^--out(-dir)?$/.test(a) && args[i + 1]) found.push(args[i + 1]);
      });
    }
    seg.forEach((t, i) => { if (/>/.test(t.op ?? '') && seg[i + 1]?.word !== undefined) found.push(seg[i + 1].word); });
    written.push(...found.map(at).filter(Boolean));
  };
  let seg = [];
  for (const t of tokens(command, { powershell })) {
    if (SPLIT.has(t.op)) { run(seg); seg = []; } else seg.push(t);
  }
  run(seg);
  return written;
}

const SHELLS = ['Bash', 'PowerShell'];
const EDITS = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };

// The refusal, as a sentence, or null to let the call through.
export function refusalFor(input, env = process.env) {
  if (input.hook_event_name !== 'PreToolUse') return null;
  const cwd = input.cwd || process.cwd();
  if (inside(env.CLAUDE_PROJECT_DIR || cwd)) return null;
  let target = null;
  if (SHELLS.includes(input.tool_name)) target = writesOf(input.tool_input?.command ?? '', cwd, { powershell: input.tool_name === 'PowerShell' })
    .find((p) => inside(p));
  else if (EDITS[input.tool_name]) {
    const file = input.tool_input?.[EDITS[input.tool_name]];
    if (file && inside(resolve(cwd, file))) target = file;
  }
  if (!target) return null;
  return `Arkitect: this would write ${target}, inside the Arkitect plugin (${ROOT}), which the next update replaces, `
    + 'so it was not run. Nothing else is blocked and the shell still works: run the command again from the project '
    + `folder (${cwd}), give a script its full path (node "${join(ROOT, 'skills', 'arkitect-<engine>', 'scripts', '<script>.mjs')}" ...), `
    + 'and keep the spec, the diagram and the report with the project\'s files.';
}

export function respond(input, env) {
  const reason = refusalFor(input, env);
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

if (process.argv[1] && process.argv[1].endsWith('install-write.mjs')) main().catch(() => {});
