#!/usr/bin/env node
// Asked about an existing diagram's style, an agent answered from one Read,
// loaded no skill, and promised to remember the style for later diagrams.
// Nothing was stored, and storing it unasked is what AGENTS.md §6 forbids
// (#265). Three wordings in the skill descriptions never reached it: no
// Arkitect text was in context. So this hook says the rule where the agent
// reads it, and only for a prompt that asks about a diagram's style. Every
// other prompt gets nothing, so it costs no context there.
//
// Claude Code runs it on UserPromptSubmit with the prompt as JSON on stdin;
// what it prints is added to the context. It reads nothing else and never
// fails the prompt.

const DIAGRAM = /\.(drawio|excalidraw)\b|\b(draw\.?io|excalidraw|diagrams?)\b/i;
const STYLE = /\b(style|styled|look(s|ing)? like|rounded|square|sharp|dashed|dotted|corners?|colou?rs?|fonts?|roughness|sketchy|that way|prefer|my diagrams)\b/i;
// Running the commands themselves is the user doing exactly what the rule asks.
const COMMAND = /\/(arkitect:)?(learn|apply)-(drawio|excalidraw)-style\b/i;

export const RULE = 'Arkitect: a diagram style is stored only when the user runs /learn-drawio-style '
  + 'or /learn-excalidraw-style (and applied with /apply-drawio-style or /apply-excalidraw-style). '
  + 'Answering a question about a style stores nothing, so do not say you will remember it or use it '
  + 'for later diagrams; if they want it kept, name the command.';

export function ruleFor(prompt) {
  const text = String(prompt ?? '');
  return DIAGRAM.test(text) && STYLE.test(text) && !COMMAND.test(text) ? RULE : null;
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let prompt = '';
  try { prompt = JSON.parse(input).prompt ?? ''; } catch { /* not ours to fail */ }
  const rule = ruleFor(prompt);
  if (rule) process.stdout.write(`${rule}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('style-question.mjs')) main().catch(() => {});
