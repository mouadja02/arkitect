// What the eval scaffolds build their fixtures with: the real CLI, from the
// checkout the suite runs against, so a fixture is what Arkitect writes today
// rather than a copy that drifts from it. Each case that needs one keeps a
// fixture.mjs beside its case.yaml. Its scaffold.sh runs it, and
// tests/toolkit.mjs imports it to check the case's graders against the very
// files a run starts from (#415).

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// `arkitect <args>` from this checkout, in `cwd`; its stdout, or a throw that
// says what failed.
export function arkitect(args, cwd) {
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'arkitect.mjs'), ...args],
    { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`arkitect ${args.join(' ')} exited ${r.status}: ${(r.stderr || r.stdout || '').trim().slice(0, 400)}`);
  }
  return r.stdout;
}

// Builds `spec` to `out`, relative to `cwd`, with the house style (an applied
// style override must not change a fixture), and leaves no spec file behind:
// the only copy is the one the built file carries.
export function buildFixture(engine, spec, out, cwd, extra = []) {
  mkdirSync(join(cwd, dirname(out)), { recursive: true });
  const tmp = join(cwd, dirname(out), `.fixture-${process.pid}.spec.json`);
  writeFileSync(tmp, JSON.stringify(spec, null, 2));
  try {
    arkitect([engine, 'build', tmp, '--out', out, '--defaults', ...extra], cwd);
  } finally {
    rmSync(tmp, { force: true });
  }
}

// Writes `files`, { relative path: text }, under `cwd`.
export function writeFixture(files, cwd) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(cwd, dirname(rel)), { recursive: true });
    writeFileSync(join(cwd, rel), text);
  }
}

// A conversation as the JSONL transcript Claude Code writes, for a case that
// continues one through `context.history_file` (#418). The runner resumes it
// with `--resume <file>`, so the next turn is the case's prompt. `turns` is a
// list of { user }, { assistant } and { tool, input, result }; the last becomes
// an assistant tool call and the user turn that answers it. Every id and time
// is made from the turn's position, so a history rebuilds byte for byte, and
// no line carries a cwd: the run's own directory is the one that counts.
//
// Resuming writes `<sessionId>.jsonl` beside the history file, in the case
// folder; .gitignore keeps it out of the repository.
export function transcript(turns, { sessionId }) {
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const lines = [];
  let parent = null;
  const push = (type, message) => {
    const n = lines.length + 1;
    const line = {
      parentUuid: parent, isSidechain: false, type, message, uuid: id(n),
      timestamp: new Date(Date.UTC(2026, 9, 1, 9, 0, n * 5)).toISOString(),
      userType: 'external', sessionId, version: '2.1.300',
    };
    lines.push(JSON.stringify(line));
    parent = line.uuid;
  };
  const reply = (content, stop) => ({
    id: `msg_hist_${lines.length + 1}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
    content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 },
  });
  for (const turn of turns) {
    if (turn.user !== undefined) push('user', { role: 'user', content: turn.user });
    else if (turn.assistant !== undefined) push('assistant', reply([{ type: 'text', text: turn.assistant }], 'end_turn'));
    else {
      const toolId = `toolu_hist_${String(lines.length + 1).padStart(18, '0')}`;
      push('assistant', reply([{ type: 'tool_use', id: toolId, name: turn.tool, input: turn.input }], 'tool_use'));
      push('user', { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: turn.result, is_error: false }] });
    }
  }
  return `${lines.join('\n')}\n`;
}

// Writes a case's history.jsonl beside its history.mjs when node was given
// that module.
export function writeHistory(meta, turns, options) {
  if (process.argv[1] && pathToFileURL(process.argv[1]).href === meta.url) {
    writeFileSync(fileURLToPath(new URL('history.jsonl', meta.url)), transcript(turns, options));
  }
}

// Runs a fixture module's make() in the working directory when node was given
// that module, which is what a scaffold does.
export function runAsScript(meta, make) {
  if (process.argv[1] && pathToFileURL(process.argv[1]).href === meta.url) make(process.cwd());
}
