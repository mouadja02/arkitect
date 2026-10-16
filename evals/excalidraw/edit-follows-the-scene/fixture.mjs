// A scene drawn in the Excalidraw app, not by Arkitect: no stamps, no carried
// spec, and a look of its own - every stroke teal, no roughness at all, every
// box filled pale cyan. The builder draws it, and this then strips everything
// that says Arkitect drew it, so it is a well-formed scene the app would
// write. An edit that matches the file keeps that look; one that reaches for
// the house style draws a rough, dark-stroked box (#415).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFixture, runAsScript } from '../../fixtures.mjs';

export const FILE = 'eval-input/shop.excalidraw';
export const STROKE = '#0b7285';
export const FILL = '#e3fafc';

export const SPEC = {
  title: 'Shop',
  nodes: [
    { id: 'web', kind: 'box', label: 'Storefront', col: 0, row: 0 },
    { id: 'checkout', kind: 'box', label: 'Checkout service', col: 1, row: 0 },
    { id: 'orders', kind: 'cylinder', label: 'Orders DB', col: 2, row: 0 },
    { id: 'stock', kind: 'box', label: 'Stock service', col: 1, row: 1 },
  ],
  edges: [
    { from: 'web', to: 'checkout' },
    { from: 'checkout', to: 'orders' },
    { from: 'checkout', to: 'stock' },
  ],
};

export function drawnInTheApp(scene) {
  for (const e of scene.elements) {
    delete e.customData;
    e.roughness = 0;
    e.strokeColor = STROKE;
    if (['rectangle', 'ellipse', 'diamond'].includes(e.type)) Object.assign(e, { backgroundColor: FILL, fillStyle: 'solid' });
  }
  return scene;
}

export function make(cwd) {
  buildFixture('excalidraw', SPEC, FILE, cwd, ['--seed', '11']);
  const path = join(cwd, FILE);
  writeFileSync(path, JSON.stringify(drawnInTheApp(JSON.parse(readFileSync(path, 'utf8'))), null, 2));
  return [FILE];
}

runAsScript(import.meta, make);
