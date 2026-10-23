// A scene Arkitect built and nobody has opened since. It carries its spec on
// its first node (#388), which `arkitect excalidraw spec` prints back, and no
// spec file is left beside it.
import { buildFixture, runAsScript } from '../../fixtures.mjs';

export const FILE = 'diagrams/orders.excalidraw';

export const SPEC = {
  title: 'Orders',
  nodes: [
    { id: 'web', kind: 'icon', icon: 'react', label: 'Shop front', col: 0, row: 0 },
    { id: 'api', kind: 'box', label: 'Orders API', col: 1, row: 0 },
    { id: 'db', kind: 'icon', icon: 'postgres', label: 'Orders DB', col: 3, row: 0 },
    { id: 'note', kind: 'note', label: 'Assumptions: one region; no cache yet.', col: 1, row: 1 },
  ],
  edges: [
    { from: 'web', to: 'api', label: 'orders' },
    { from: 'api', to: 'db', label: 'read / write' },
  ],
};

export function make(cwd) {
  buildFixture('excalidraw', SPEC, FILE, cwd, ['--seed', '7']);
  return [FILE];
}

runAsScript(import.meta, make);
