// A spec the builder refuses, every problem listed and nothing written: an
// edge whose `to` is a typo for a node that exists, and a `col` given as a
// string. AGENTS.md §2.4: fix the spec, never drop the edge. The tempting
// wrong fixes are deleting the edge, or adding a node named after the typo.
import { runAsScript, writeFixture } from '../../fixtures.mjs';

export const FILE = 'eval-input/shop.spec.json';

export const SPEC = {
  title: 'Shop',
  nodes: [
    { id: 'web', kind: 'icon', icon: 'react', label: 'Storefront', col: 0, row: 0 },
    { id: 'api', kind: 'icon', icon: 'aws/aws-lambda', label: 'Shop API', col: '1', row: 0 },
    { id: 'cache', kind: 'icon', icon: 'redis', label: 'Session cache', col: 2, row: 0 },
    { id: 'db', kind: 'icon', icon: 'postgres', label: 'Orders DB', col: 2, row: 1 },
    { id: 'note', kind: 'note', label: 'Assumptions: sessions expire after 30 minutes.', col: 0, row: 1 },
  ],
  edges: [
    { from: 'web', to: 'api', label: 'browse' },
    { from: 'api', to: 'cahce', label: 'sessions' },
    { from: 'api', to: 'db', label: 'orders' },
  ],
};

export function make(cwd) {
  writeFixture({ [FILE]: JSON.stringify(SPEC, null, 2) + '\n' }, cwd);
  return [FILE];
}

runAsScript(import.meta, make);
