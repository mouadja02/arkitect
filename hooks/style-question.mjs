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
// mind for any diagrams", "I'll apply the same when working with your diagrams".
const PROMISE = /\b(I['’]ll|I will|I['’]m going to|I am going to)\s+(remember|keep\b[^.!?\n]{0,40}\bin mind|note (that|this|those|it)|apply (that|this|those|these|the same|it)|use (that|this|those|these|the same|it) (style|look|for))/i;

export const RULE = 'Arkitect: nothing about a diagram\'s style is kept between conversations unless the user '
  + 'runs /learn-drawio-style or /learn-excalidraw-style themselves. If they say they like a style, do not '
  + 'reply that you will remember it, keep it in mind or use it next time: answer the question, and say '
  + 'that running that command is how a style is kept.';

export const SEND_BACK = 'Arkitect: your reply promises to remember a diagram style, but nothing is stored: '
  + 'a style is kept only if the user runs /learn-drawio-style or /learn-excalidraw-style. Write your whole '
  + 'answer again without that promise, and say that running that command is how a style is kept.';

export function ruleFor(prompt) {
  const text = String(prompt ?? '');
  return DIAGRAM.test(text) && STYLE.test(text) && !COMMAND.test(text) ? RULE : null;
}

export function promisesToRemember(reply) {
  return PROMISE.test(String(reply ?? ''));
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
