#!/usr/bin/env node
// A report after a build drops headings about one run in three, sometimes all
// of them for ones it made up (#215). And with no PNG to look at, since a
// sandbox or a missing browser leaves only an SVG, the Render section still
// says the layout is "clean" or the SVG "confirms spacing": both cases in the
// 3.0.0 batch. SKILL.md step 9 says both things already; wording has not moved
// either, as it did not for #265.
//
// So on Stop, in a session that ran an Arkitect build, a reply naming the file
// that build wrote is checked for the six headings the report needs (Engine is
// asked for only when the user named no engine); when no PNG was opened, for a
// Render section that describes the picture anyway or doesn't say nothing saw
// it; for a validate warning explained away; and for a link to the hosted
// editor. Any of them sends the reply back once, saying what to fix. Any other
// session is not read past its last reply.

import { readFileSync } from 'node:fs';
import { lastReply } from './style-question.mjs';

export const HEADINGS = ['File', 'Assumptions', 'Icons', 'Validation', 'Render', 'Deviations'];
const heading = (name) => new RegExp(`\\*\\*${name}\\b|#+\\s*\\**${name}\\b`);
// A build by script, by the dispatcher's path, or by the installed or npx
// `arkitect` with any engine alias: docs/install.md teaches the last two, and
// the check used to skip them (#301).
const BUILD = /build-diagram\.mjs|\barkitect(@[\w.-]+|\.mjs)?["']?\s+(drawio|draw\.io|dio|excalidraw|excali|ex)\s+build\b/;
const SHELLS = ['Bash', 'PowerShell'];
// What a reply says when it describes a picture: "Layout is clean", "SVG
// confirms structure and spacing". A sentence that is validate's finding, or
// that says nothing was seen, is what the report should say, so it passes.
// "Layout from SVG shows horizontal flow ... All elements properly positioned,
// labels adjacent to arrows" got through the first list (#328).
const SEEN = /\b(clean(ly)?|confirm(s|ed)?|legible|readable|looks?|spacing|clarity|well[- ]spaced|tidy|balanced|neat|crisp|reads well|layout|laid out|position(ed|ing)?|placement|placed|adjacent|align(ed|ment)?|arranged|overlap(s|ping)?|properly|correct(ly)?|shows?\b[^.]*\bflow)\b/i;
const VALIDATE = /\bvalidat(e|ed|es|ion|or)\b/i;
const LOOK = '(see|seen|saw|view|viewed|look|looked|inspect|inspected|inspection|open|opened)';
const UNSEEN = new RegExp(`(\\b(not|never|cannot|unable|nobody|nothing)\\b|n't\\b)[^.]*\\b${LOOK}\\b|\\b${LOOK}\\b[^.]*\\b(not possible|unavailable|impossible)\\b`, 'i');
const FAILED = /\b(fail(s|ed|ure)?|unavailable|blocked|refused|denied|skipped)\b/i;

export function describesThePicture(section) {
  return String(section).split(/(?<=[.!?])\s+|\n+/)
    .map((s) => (!VALIDATE.test(s) && !UNSEEN.test(s) ? s.match(SEEN)?.[0] : null)).find(Boolean) ?? null;
}

// A word list keeps missing new ways of describing a picture, so with no PNG
// opened the section must also say so, or that the render failed (#328).
export const admitsUnseen = (section) => UNSEEN.test(String(section)) || FAILED.test(String(section));

// A warning validate printed is a defect still in the drawing, even when the
// spec may not change; replies named both and went on to call them
// "intentional per spec" and "not errors" (#330).
const EXCUSE = /\b(intentional(ly)?|by (design|spec)|expected|acceptable|harmless|cosmetic|minor|benign|false positives?|ignor(e|ed|able))\b|\b(not|n't)\b[^.]{0,20}\b(errors?|defects?|problems?|issues?|bugs?)\b/i;
const NO_WARNINGS = /\b(no|0|zero|without)\s+(\w+\s+)?warnings?\b/gi;

// A report linked "Draw.io Desktop" to www.draw.io, the web app (#340). The
// eval cases grade `no-hosted-editor` with this same pattern (#186); a test
// keeps the two identical.
export const HOSTED = /app\.diagrams\.net|viewer\.diagrams\.net|diagrams\.net\/\?|\/\/(?:www\.)?draw\.io/;
export const DESKTOP = 'https://github.com/jgraph/drawio-desktop/releases';

const ABOUT_A_WARNING = /\bwarn(ing|ings|s|ed)?\b|\boverlap|\bborder\b|\bdefects?\b/i;
const sentences = (text) => String(text).split(/(?<=[.!?])\s+|\n+/);

// Every sentence of the Validation section, and any other about a warning.
export function excusesAWarning(reply) {
  const validation = sectionOf(reply, 'Validation');
  if (!/\bwarn(ing|ings|s|ed)?\b/i.test(validation.replace(NO_WARNINGS, ''))) return null;
  return [...sentences(validation), ...sentences(reply).filter((s) => ABOUT_A_WARNING.test(s))]
    .map((s) => s.match(EXCUSE)?.[0]).find(Boolean) ?? null;
}

// The file a build command wrote, by basename, from `--out x` or `--out=x`.
// A path the shell expands (`$OUT`, `%OUT%`) can't be read here, so it stands
// for any file, as every build did before #345.
export function outOf(command) {
  const m = String(command).match(/--out(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/);
  if (!m) return null;
  const path = m[1] ?? m[2] ?? m[3];
  return /[$%]/.test(path) ? '*' : path.split(/[\\/]/).pop();
}

// What the session did, from its transcript: a build, the files it wrote, and
// a PNG opened.
export function sessionOf(transcriptPath) {
  const seen = { built: false, viewed: false, outs: [] };
  try {
    for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
      if (!line.includes('"tool_use"')) continue;
      try {
        const e = JSON.parse(line);
        for (const part of (e.message ?? e).content ?? []) {
          if (part?.type !== 'tool_use') continue;
          const command = String(part.input?.command ?? '');
          if (SHELLS.includes(part.name) && BUILD.test(command)) {
            seen.built = true;
            const out = outOf(command);
            if (out && !seen.outs.includes(out)) seen.outs.push(out);
          }
          if (part.name === 'Read' && /\.png$/i.test(String(part.input?.file_path ?? ''))) seen.viewed = true;
        }
      } catch { /* one bad line is not ours to fail */ }
    }
  } catch { /* no transcript: nothing to check */ }
  return seen;
}

// One section: from its heading to the next report heading.
export function sectionOf(reply, name) {
  const text = String(reply ?? '');
  const at = text.search(heading(name));
  if (at < 0) return '';
  const rest = text.slice(at + name.length + 2);
  const ends = HEADINGS.filter((h) => h !== name).map((h) => rest.search(heading(h))).filter((n) => n >= 0);
  return rest.slice(0, ends.length ? Math.min(...ends) : undefined);
}
export const renderSection = (reply) => sectionOf(reply, 'Render');

// Each problem with a report, as a sentence to send back.
export function problems(reply, { viewed }) {
  const out = [];
  const missing = HEADINGS.filter((h) => !heading(h).test(String(reply ?? '')));
  if (missing.length) {
    out.push(`the report has no ${missing.join(', ')} heading${missing.length > 1 ? 's' : ''}: write it under **File**, `
      + '**Engine** (only when the user named no engine), **Assumptions**, **Icons**, **Validation**, **Render** and '
      + '**Deviations**, each even when it is one line');
  }
  const render = renderSection(reply);
  const said = describesThePicture(render);
  if (!viewed && said) {
    out.push(`no PNG was opened in this session, so nothing has seen the diagram, but Render says "${said}": say what `
      + "was rendered and that you haven't seen it, and give spacing and crossings only as validate's findings");
  } else if (!viewed && render.trim() && !admitsUnseen(render)) {
    out.push("no PNG was opened in this session, so nothing has seen the diagram, and Render doesn't say so: say what "
      + "was rendered and that you haven't seen it, and give spacing and crossings only as validate's findings");
  }
  const excuse = excusesAWarning(reply);
  if (excuse) {
    out.push(`Validation calls a warning "${excuse}", but a warning validate printed is a defect still in the drawing, `
      + 'even when the spec could not change: name each one as a defect still there, with its ids, and drop "'
      + `${excuse}"`);
  }
  const hosted = String(reply ?? '').match(HOSTED)?.[0];
  if (hosted) {
    out.push(`the reply links ${hosted}, the hosted editor, and a diagram dropped into it leaves the machine: link `
      + `Draw.io Desktop's releases page, ${DESKTOP}, or name the VS Code extension instead`);
  }
  return out;
}

// A reply is a report of a build only when it names a file that build wrote: a
// status message that mentions "an existing `.drawio`" hours after a build run
// to reproduce a bug is not one, and no honest rewrite could satisfy the check
// (#345).
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function namesABuiltFile(reply, outs) {
  const text = String(reply ?? '');
  return outs.some((out) => (out === '*' ? /\.(drawio|excalidraw)\b/.test(text)
    : new RegExp(`(^|[^\\w.-])${escape(out)}(?![\\w.-]*\\w)`, 'i').test(text)));
}

export function respond(input) {
  if (input.hook_event_name !== 'Stop' || input.stop_hook_active) return null;
  const reply = input.last_assistant_message ?? lastReply(input.transcript_path);
  if (!/\.(drawio|excalidraw|json)\b/.test(String(reply ?? ''))) return null;
  const session = sessionOf(input.transcript_path);
  if (!session.built || !namesABuiltFile(reply, session.outs)) return null;
  const found = problems(reply, session);
  if (!found.length) return null;
  return JSON.stringify({ decision: 'block', reason: `Arkitect: ${found.join('; and ')}. Write the whole report again.` });
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try { input = JSON.parse(raw) ?? {}; } catch { /* not ours to fail */ }
  const out = respond(input);
  if (out) process.stdout.write(`${out}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('report-check.mjs')) main().catch(() => {});
