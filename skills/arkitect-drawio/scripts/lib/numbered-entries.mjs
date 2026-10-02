// Ways in numbered as steps: web, mobile and partner edges into one gateway
// labelled "1. Order", "2. Order", "3. Order", then "4. Validate". Pattern 7
// says entry points are not steps (#251), but an agent that never opened the
// pattern drew them anyway, and nothing it ran said so (#329). The build
// notes it and validate warns, so the rule reaches it where it reads.
//
// An entry point is an edge from a node no edge points at. Two or more of them
// into the same target, each starting with a step number, are listed; one
// numbered entry is just the first step of its path.

// "1. Order", "2) Order", "Step 3", and a bare "1" on each way in (the 2.2.1
// follow-up batch). "100 req/s" is a rate, not a step.
const STEP = /^\s*(?:step\s*)?\(?\d{1,2}\s*(?:[.):]|$)|^\s*step\s*\d/i;
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
