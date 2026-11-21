#!/usr/bin/env node
// Three Draw.io MCP tools open app.diagrams.net with the diagram in the URL.
// Both skills, AGENTS.md and docs/privacy.md forbid them on a user's content,
// but only in prose, and a tool call is finished before any report is checked
// (#487). So before one of them runs, the person is asked.
//
// It asks rather than denies: a script cannot tell whether the content is the
// user's diagram, and the docs allow the tools for anything that is not.
// `list_pages`, `get_page`, `set_page` and `search_shapes` never match.

// A plugin-bundled server is named mcp__plugin_<plugin>_<server>__<tool>, so
// the server part is anything. hooks.json holds the same pattern, unanchored
// as Claude Code reads it; the test keeps the two equal.
export const MATCHER = 'mcp__.*__open_drawio_(xml|csv|mermaid)';
const TOOL = new RegExp(`^${MATCHER}$`);

export const REASON = 'Arkitect: this tool opens app.diagrams.net, the hosted Draw.io editor, with the diagram in the URL, '
  + 'so the diagram leaves this machine. Arkitect never does that with your content. Approve only if the content is '
  + 'not from your diagrams. To edit one, open the file in Draw.io Desktop or the VS Code Draw.io extension.';

// The sentence to show, or null to let the call through.
export function askFor(input) {
  if (input.hook_event_name !== 'PreToolUse' || !TOOL.test(String(input.tool_name ?? ''))) return null;
  return REASON;
}

export function respond(input) {
  const reason = askFor(input);
  return reason ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } }) : null;
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try { input = JSON.parse(raw) ?? {}; } catch { /* not ours to fail */ }
  const out = respond(input);
  if (out) process.stdout.write(`${out}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('hosted-editor.mjs')) main().catch(() => {});
