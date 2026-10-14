// arkitect report <file|-> [--png-viewed]
//
// The report check, for every host. Claude Code runs it as a Stop hook
// (hooks/report-check.mjs); Codex, Cursor, Copilot, OpenCode and Gemini had no
// route to it, so a report there was checked by nothing (#302). Save the
// report, run this, and fix what it names.
//
// It sees only the text. Whether a PNG was opened is the agent's declaration,
// `--png-viewed`, not an observed tool call: the hook can tell, this cannot.
// Exit 0 clean, 1 with problems, 2 on a usage error.

import { readFileSync } from 'node:fs';
import { parseCli, UsageError } from '../../skills/arkitect-drawio/scripts/lib/drawio-core.mjs';
import { problems } from '../../hooks/report-check.mjs';

export const USAGE = 'usage: arkitect report <report.md | -> [--png-viewed]\n'
  + '  checks a saved diagram report: the seven headings, a Render section that describes\n'
  + '  only what was seen, no validate warning explained away, no hosted-editor link.\n'
  + '  --png-viewed  you opened the rendered PNG and looked at it (declared, not observed)';

export function checkReport(text, { viewed = false } = {}) {
  return problems(text, { viewed, unseen: 'the report check was not told a PNG was looked at (--png-viewed)' });
}

export function report(argv, { stdin = () => readFileSync(0, 'utf8'), log = console.log, error = console.error } = {}) {
  let parsed;
  try {
    parsed = parseCli(argv, { switches: ['--png-viewed'] });
    if (!parsed.help && parsed.positionals.length !== 1) {
      throw new UsageError(parsed.positionals.length ? `expected one report file, got ${parsed.positionals.length}` : 'expected a report file, or - for stdin');
    }
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    error(`${e.message}\n${USAGE}`);
    return 2;
  }
  if (parsed.help) { log(USAGE); return 0; }
  const [file] = parsed.positionals;
  let text;
  try {
    text = file === '-' ? stdin() : readFileSync(file, 'utf8');
  } catch (e) {
    error(`cannot read the report ${file}: ${e.code ?? e.message}`);
    return 2;
  }
  const found = checkReport(text, { viewed: Boolean(parsed.options['png-viewed']) });
  if (!found.length) {
    log('report ok: every heading present, nothing describing an unseen render, no warning excused, no hosted-editor link');
    return 0;
  }
  log(`report: ${found.length} problem${found.length > 1 ? 's' : ''}. Fix each, then write the whole report again:`);
  for (const p of found) log(`- ${p}`);
  return 1;
}
