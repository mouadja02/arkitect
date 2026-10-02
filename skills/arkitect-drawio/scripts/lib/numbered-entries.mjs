// Ways in numbered as steps: web, mobile and partner edges into one gateway
// labelled "1. Order", "2. Order", "3. Order", then "4. Validate". Pattern 7
// says entry points are not steps (#251), but an agent that never opened the
// pattern drew them anyway, and nothing it ran said so (#329). The build
// notes it and validate warns, so the rule reaches it where it reads.
//
// An entry point is an edge from a node no edge points at. Two or more of them
// into the same target, each starting with a step number, are listed; one
// numbered entry is just the first step of its path.

const STEP = /^\s*\d+\s*[.):]/;
const plain = (label) => String(label ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');

export const ENTRY_RULE = 'entry points are not steps: letter them (A., B.) or leave them unnumbered, '
  + 'and number the path from 1 after they meet';

// edges: [{ id, from, to, label }]. Returns [{ to, edges: [id, ...] }].
export function numberedEntries(edges) {
  const reached = new Set(edges.map((e) => e.to));
  const byTarget = new Map();
  for (const e of edges) {
    if (reached.has(e.from) || !STEP.test(plain(e.label))) continue;
    byTarget.set(e.to, [...(byTarget.get(e.to) ?? []), e.id]);
  }
  return [...byTarget].filter(([, ids]) => ids.length > 1).map(([to, ids]) => ({ to, edges: ids }));
}
