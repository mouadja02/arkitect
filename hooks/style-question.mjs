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

// The failing answers all closed with "I'll remember" or "I'll keep that in
// mind", so the rule names that and says what to answer instead.
export const RULE = 'Arkitect: nothing about a diagram\'s style is kept between conversations unless the user '
  + 'runs /learn-drawio-style or /learn-excalidraw-style themselves. If they say they like a style, do not '
  + 'reply that you will remember it, keep it in mind or use it next time: answer the question, and say '
  + 'that running that command is how a style is kept.';

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
