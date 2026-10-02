#!/usr/bin/env node
// Asked about an existing diagram's style, an agent answered from one Read,
// loaded no skill, and promised to remember the style for later diagrams.
// Nothing was stored, and storing it unasked is what AGENTS.md §6 forbids
// (#265). Three wordings in the skill descriptions never reached it: no
// Arkitect text was in context. Saying the rule in context was not enough
// either: haiku read it and still closed with "I'll keep that in mind".
//
// So this hook does two things, both only in a session whose prompt asked
// about a diagram's style:
//   UserPromptSubmit  adds the rule to the context, and marks the session;
//   Stop              if the final reply still promises to remember the style,
//                     sends it back once, saying why.
// Every other prompt and session gets nothing and costs no context. The hook
// reads only its own input and the session's last reply, and never fails.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIAGRAM = /\.(drawio|excalidraw)\b|\b(draw\.?io|excalidraw|diagrams?)\b/i;
const STYLE = /\b(style|styled|look(s|ing)? like|rounded|square|sharp|dashed|dotted|corners?|colou?rs?|fonts?|roughness|sketchy|that way|prefer|my diagrams)\b/i;
// Running the commands themselves is the user doing exactly what the rule asks.
const COMMAND = /\/(arkitect:)?(learn|apply)-(drawio|excalidraw)-style\b/i;
// What the failing replies said: "I'll remember this style", "I'll keep that in
// mind for any diagrams", "I'll apply the same when working with your diagrams
// going forward", "I can apply that when you create diagrams going forward".
const PROMISE = new RegExp([
  /\bI['’]ll remember\b|\bI will remember\b|\bremember (that|this|those|your) (style|preference)/,
  /\bkeep\b[^.!?\n]{0,40}\bin mind\b/,
  /\bgoing forward\b|\bnext time\b|\bfrom now on\b/,
  /\bfor (any |all |your )?(future|later|upcoming|next) (diagrams?|work|drawings?)\b/,
  // "Now I know your style preference!" went through with no send-back (#331).
  /\bnow I know\b|\bI['’]ve (noted|recorded|saved|stored)\b|\bnoted\b[^.!?\n]{0,40}\b(style|preferences?)\b/,
  // "Got it — I'll apply that style when creating or editing your diagrams."
  /\bI['’]ll (apply|use|follow|match|carry|stick (to|with))\b[^.!?\n]{0,60}\b(style|preferences?|conventions?|that way|the same)\b/,
].map((r) => r.source).join('|'), 'i');
const LEARN = /\/(arkitect:)?learn-(drawio|excalidraw)-style\b/i;
const APPLY = /\/(arkitect:)?apply-(drawio|excalidraw)-style\b/i;
// Learning only records findings; apply-*-style is what changes a build. The
// rewrite after a send-back said "run /learn-drawio-style to have it applied
// to new Draw.io diagrams" (#331).
const APPLIES = /\bappl(y|ied|ies|ying)\b|\bautomatic(ally)?\b|\b(use[sd]?|draw(n|s)?)\b[^.!?\n]{0,30}\b(new|future|later|next)\b/i;

// A harness memory may keep the preference, so the rule does not say nothing
// is stored; what is true either way is that no Arkitect build reads it.
// The agent copies these words into its answer, so they say what each command
// does exactly.
export const RULE = 'Arkitect: a diagram style reaches later Arkitect diagrams only through two commands the '
  + 'user runs themselves: /learn-drawio-style or /learn-excalidraw-style records what their diagrams do, and '
  + '/apply-drawio-style or /apply-excalidraw-style then makes builds draw that way. No build reads a remembered '
  + 'preference. If they say they like a style, do not reply that you will remember it, keep it in mind or use it '
  + 'going forward: answer the question, and if you name the commands, say that learning records and applying '
  + 'changes the build.';

export const SEND_BACK = 'Arkitect: your reply says a diagram style will carry over to later diagrams, but '
  + 'no Arkitect build reads a remembered preference, and learning alone changes no build: '
  + '/learn-drawio-style or /learn-excalidraw-style records what the diagrams do, and only '
  + '/apply-drawio-style or /apply-excalidraw-style, which the user runs themselves, makes builds draw that way. '
  + 'Write your whole answer again without that promise.';

export function ruleFor(prompt) {
  const text = String(prompt ?? '');
  return DIAGRAM.test(text) && STYLE.test(text) && !COMMAND.test(text) ? RULE : null;
}

// Sentence by sentence: one that names the command is the right answer, even
// when it says "for future diagrams", unless it says learning applies it.
export function promisesToRemember(reply) {
  return String(reply ?? '').split(/(?<=[.!?])\s+|\n+/)
    .some((s) => (PROMISE.test(s) && !COMMAND.test(s)) || (LEARN.test(s) && !APPLY.test(s) && APPLIES.test(s)));
}

const markerFor = (session, dir = tmpdir()) => join(dir, `arkitect-style-question-${String(session).replace(/[^\w-]/g, '')}`);

// The last assistant text in a transcript, for a Claude Code that does not
// pass it in the Stop input.
export function lastReply(transcriptPath) {
  let text = null;
  try {
    for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
      if (!line.includes('"assistant"')) continue;
      try {
        const e = JSON.parse(line);
        const parts = (e.message ?? e).content;
        if ((e.type === 'assistant' || e.message?.role === 'assistant') && Array.isArray(parts)) {
          const t = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
          if (t) text = t;
        }
      } catch { /* one bad line is not ours to fail */ }
    }
  } catch { /* no transcript: nothing to check */ }
  return text;
}

// What the hook prints for one event, or null. `dir` is where session marks go.
export function respond(input, dir = tmpdir()) {
  const session = input.session_id ?? 'unknown';
  if (input.hook_event_name === 'UserPromptSubmit') {
    const rule = ruleFor(input.prompt);
    if (rule) writeFileSync(markerFor(session, dir), '');
    else rmSync(markerFor(session, dir), { force: true });
    return rule;
  }
  if (input.hook_event_name === 'Stop') {
    const marker = markerFor(session, dir);
    if (!existsSync(marker)) return null;
    // Sent back once: a second stop is final, whatever it says.
    if (input.stop_hook_active) { rmSync(marker, { force: true }); return null; }
    const reply = input.last_assistant_message ?? lastReply(input.transcript_path);
    if (!promisesToRemember(reply)) { rmSync(marker, { force: true }); return null; }
    return JSON.stringify({ decision: 'block', reason: SEND_BACK });
  }
  return null;
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try { input = JSON.parse(raw) ?? {}; } catch { /* not ours to fail */ }
  const out = respond(input);
  if (out) process.stdout.write(`${out}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('style-question.mjs')) main().catch(() => {});
