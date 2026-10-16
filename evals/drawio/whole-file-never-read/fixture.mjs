// A diagram the size real ones reach: the builder draws eight services round
// an event bus, and a banner of embedded artwork makes the file about 400 KB,
// as a pasted screenshot or a logo strip does. The artwork is an SVG whose
// base64 holds SENTINEL many times over and nowhere else, so a trace that
// contains SENTINEL is a trace where the payload entered the agent's context:
// a whole Read, a cat, a grep that printed the image (AGENTS.md §5).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFixture, runAsScript } from '../../fixtures.mjs';

export const FILE = 'eval-input/platform.drawio';

export const SPEC = {
  title: 'Commerce platform',
  nodes: [
    { id: 'web', kind: 'icon', icon: 'react', label: 'Storefront', col: 0, row: 0 },
    { id: 'orders', kind: 'icon', icon: 'aws/aws-lambda', label: 'Orders service', col: 1, row: 0 },
    { id: 'billing', kind: 'icon', icon: 'aws/aws-lambda', label: 'Billing service', col: 1, row: 1 },
    { id: 'bus', kind: 'icon', icon: 'aws/amazon-eventbridge', label: 'Event bus', col: 2, row: 1 },
    { id: 'shipping', kind: 'icon', icon: 'aws/aws-lambda', label: 'Shipping service', col: 3, row: 0 },
    { id: 'analytics', kind: 'icon', icon: 'aws/aws-lambda', label: 'Analytics', col: 3, row: 1 },
    { id: 'crm', kind: 'icon', icon: 'aws/aws-lambda', label: 'CRM sync', col: 3, row: 2 },
    { id: 'db', kind: 'icon', icon: 'aws/amazon-dynamodb', label: 'Orders DB', col: 1, row: 2 },
    { id: 'note', kind: 'note', label: 'Assumptions: one account; the event bus is the default bus.', col: 0, row: 2 },
  ],
  edges: [
    { from: 'web', to: 'orders', label: 'place order' },
    { from: 'orders', to: 'db', label: 'write' },
    { from: 'orders', to: 'bus', kind: 'async', label: 'OrderPlaced' },
    { from: 'billing', to: 'bus', kind: 'async', label: 'InvoiceIssued' },
    { from: 'bus', to: 'shipping', kind: 'async' },
    { from: 'bus', to: 'analytics', kind: 'async' },
    { from: 'bus', to: 'crm', kind: 'async' },
  ],
};

// The answer the case grades: who sends to the bus, and who it delivers to.
export const PUBLISHERS = ['Orders service', 'Billing service'];
export const CONSUMERS = ['Shipping service', 'Analytics', 'CRM sync'];

const ARTWORK = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="48"><desc>'
  + 'Banner artwork, embedded. '.repeat(11000)
  + '</desc><rect width="640" height="48" fill="#232F3E"/></svg>').toString('base64');
export const SENTINEL = ARTWORK.slice(2600, 2640);

export function withBanner(xml) {
  const cell = `<mxCell id="banner" value="" style="shape=image;html=1;imageAspect=0;aspect=fixed;image=data:image/svg+xml,${ARTWORK};" vertex="1" parent="1"><mxGeometry x="80" y="-40" width="640" height="48" as="geometry" /></mxCell>\n    </root>`;
  if (!xml.includes('</root>')) throw new Error('the builder no longer writes </root>; update withBanner');
  return xml.replace('</root>', cell);
}

export function make(cwd) {
  buildFixture('drawio', SPEC, FILE, cwd);
  const path = join(cwd, FILE);
  writeFileSync(path, withBanner(readFileSync(path, 'utf8')));
  return [FILE];
}

runAsScript(import.meta, make);
