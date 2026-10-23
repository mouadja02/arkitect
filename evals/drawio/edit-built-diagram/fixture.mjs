// A diagram Arkitect built and nobody has opened since. It carries its spec,
// which `arkitect drawio spec` prints back, and no spec file is left beside it.
import { buildFixture, runAsScript } from '../../fixtures.mjs';

export const FILE = 'diagrams/payments.drawio';

export const SPEC = {
  title: 'Payments',
  nodes: [
    { id: 'web', kind: 'icon', icon: 'react', label: 'Checkout web app', col: 0, row: 0 },
    { id: 'api', kind: 'icon', icon: 'aws/aws-lambda', label: 'Payments API', col: 1, row: 0 },
    { id: 'psp', kind: 'box', label: 'Payment processor', col: 3, row: 0 },
    { id: 'ledger', kind: 'icon', icon: 'aws/amazon-dynamodb', label: 'Ledger', col: 1, row: 1 },
    { id: 'note', kind: 'note', label: 'Assumptions: one region; the payment processor is a third party.', col: 3, row: 1 },
  ],
  edges: [
    { from: 'web', to: 'api', label: 'pay' },
    { from: 'api', to: 'psp', label: 'charge' },
    { from: 'api', to: 'ledger', label: 'record' },
  ],
};

export function make(cwd) {
  buildFixture('drawio', SPEC, FILE, cwd);
  return [FILE];
}

runAsScript(import.meta, make);
