#!/usr/bin/env node
// A report after a build drops headings about one run in three, sometimes all
// of them for ones it made up (#215). And with no PNG to look at, since a
// sandbox or a missing browser leaves only an SVG, the Render section still
// says the layout is "clean" or the SVG "confirms spacing": both cases in the
// 3.0.0 batch. SKILL.md step 9 says both things already; wording has not moved
// either, as it did not for #265.
//
// So on Stop, in a session that ran an Arkitect build, the reply is checked
// for the six headings the report needs (Engine is asked for only when the
// user named no engine), and, when no PNG was opened, for a Render section
// that describes the picture anyway. Either sends the reply back once, saying
// what to fix. Any other session is not read past its last reply.

import { readFileSync } from 'node:fs';
import { lastReply } from './style-question.mjs';

export const HEADINGS = ['File', 'Assumptions', 'Icons', 'Validation', 'Render', 'Deviations'];
const heading = (name) => new RegExp(`\\*\\*${name}\\b|#+\\s*\\**${name}\\b`);
const BUILD = /build-diagram\.mjs|arkitect\.mjs"?\s+(drawio|excalidraw)\s+build\b/;
// What a reply says when it describes a picture: "Layout is clean", "SVG
// confirms structure and spacing". A sentence that is validate's finding, or
// that says nothing was seen, is what the report should say, so it passes.
const SEEN = /\b(clean(ly)?|confirm(s|ed)?|legible|readable|looks?|spacing|clarity|well[- ]spaced|tidy|balanced|neat|crisp|reads well)\b/i;
const VALIDATE = /\bvalidat(e|ed|es|ion|or)\b/i;
const LOOK = '(see|seen|view|viewed|look|looked|inspect|inspected|inspection)';
const UNSEEN = new RegExp(`\\b(not|never|n't|cannot|unable)\\b[^.]*\\b${LOOK}\\b|\\b${LOOK}\\b[^.]*\\b(not possible|unavailable|impossible)\\b`, 'i');

export function describesThePicture(section) {
  return String(section).split(/(?<=[.!?])\s+|\n+/)
    .map((s) => (!VALIDATE.test(s) && !UNSEEN.test(s) ? s.match(SEEN)?.[0] : null)).find(Boolean) ?? null;
}

// What the session did, from its transcript: a build, and a PNG opened.
export function sessionOf(transcriptPath) {
  const seen = { built: false, viewed: false };
  try {
    for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
      if (!line.includes('"tool_use"')) continue;
      try {
        const e = JSON.parse(line);
        for (const part of (e.message ?? e).content ?? []) {
          if (part?.type !== 'tool_use') continue;
          if (part.name === 'Bash' && BUILD.test(String(part.input?.command ?? ''))) seen.built = true;
          if (part.name === 'Read' && /\.png$/i.test(String(part.input?.file_path ?? ''))) seen.viewed = true;
        }
      } catch { /* one bad line is not ours to fail */ }
    }
  } catch { /* no transcript: nothing to check */ }
  return seen;
}

// The Render section: from its heading to the next report heading.
export function renderSection(reply) {
  const text = String(reply ?? '');
  const at = text.search(heading('Render'));
  if (at < 0) return '';
  const rest = text.slice(at + 8);
  const ends = HEADINGS.filter((h) => h !== 'Render').map((h) => rest.search(heading(h))).filter((n) => n >= 0);
  return rest.slice(0, ends.length ? Math.min(...ends) : undefined);
}

// Each problem with a report, as a sentence to send back.
export function problems(reply, { viewed }) {
  const out = [];
  const missing = HEADINGS.filter((h) => !heading(h).test(String(reply ?? '')));
  if (missing.length) {
    out.push(`the report has no ${missing.join(', ')} heading${missing.length > 1 ? 's' : ''}: write it under **File**, `
      + '**Engine** (only when the user named no engine), **Assumptions**, **Icons**, **Validation**, **Render** and '
      + '**Deviations**, each even when it is one line');
  }
  const said = describesThePicture(renderSection(reply));
  if (!viewed && said) {
    out.push(`no PNG was opened in this session, so nothing has seen the diagram, but Render says "${said}": say what `
      + "was rendered and that you haven't seen it, and give spacing and crossings only as validate's findings");
  }
  return out;
}

export function respond(input) {
  if (input.hook_event_name !== 'Stop' || input.stop_hook_active) return null;
  const reply = input.last_assistant_message ?? lastReply(input.transcript_path);
  if (!/\.(drawio|excalidraw)\b/.test(String(reply ?? ''))) return null;
  const session = sessionOf(input.transcript_path);
  if (!session.built) return null;
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
