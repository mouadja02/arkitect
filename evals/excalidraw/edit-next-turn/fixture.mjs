// The scene the earlier turn in history.jsonl built, and the spec it wrote
// beside it. The next turn asks for one change to it.
import { buildFixture, runAsScript, writeFixture } from '../../fixtures.mjs';

export const FILE = 'docs/orders.excalidraw';
export const SPEC_FILE = 'docs/orders.spec.json';

export const SPEC = {
  title: 'Order flow',
  nodes: [
    { id: 'shop', kind: 'icon', icon: 'react', label: 'Shop front', col: 0, row: 0 },
    { id: 'api', kind: 'box', label: 'Orders API', col: 1, row: 0 },
    { id: 'queue', kind: 'icon', icon: 'sqs', label: 'Order queue', col: 2, row: 0 },
    { id: 'worker', kind: 'box', label: 'Fulfilment worker', col: 3, row: 0 },
    { id: 'db', kind: 'icon', icon: 'postgres', label: 'Orders DB', col: 4, row: 0 },
    { id: 'note', kind: 'note', label: 'Assumptions: one region; the worker runs on its own host.', col: 1, row: 1 },
  ],
  edges: [
    { from: 'shop', to: 'api', label: 'place order' },
    { from: 'api', to: 'queue', label: 'enqueue' },
    { from: 'queue', to: 'worker', label: 'consume' },
    { from: 'worker', to: 'db', label: 'write' },
  ],
};

export function make(cwd) {
  buildFixture('excalidraw', SPEC, FILE, cwd, ['--seed', '11']);
  writeFixture({ [SPEC_FILE]: `${JSON.stringify(SPEC, null, 2)}\n` }, cwd);
  return [FILE, SPEC_FILE];
}

runAsScript(import.meta, make);
