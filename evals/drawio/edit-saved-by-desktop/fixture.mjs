// A diagram Arkitect built, then opened and saved in Draw.io Desktop: Desktop
// rewrote the `agent` on <mxfile> (it keeps `arkitect-spec`, #388), someone
// filled the payment processor orange, and someone added a text cell by hand.
// Neither change is in the spec the file carries, so a rebuild from it drops
// the colour, and drops the text unless it is put in the spec (#376, #403).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFixture, runAsScript } from '../../fixtures.mjs';
import { SPEC } from '../edit-built-diagram/fixture.mjs';

export const FILE = 'diagrams/payments.drawio';
export const DESKTOP_AGENT = '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) draw.io/29.0.3 Chrome/138.0.7204.100 Electron/37.2.1 Safari/537.36';
export const ADDED = 'PCI DSS scope: owned by the payments team';
export const FILL = 'fillColor=#FFE6CC;';

export function saveAsDesktop(xml) {
  const out = xml
    .replace('agent="arkitect-drawio"', `agent="${DESKTOP_AGENT}"`)
    .replace(/(<mxCell id="psp" [^>]*style="[^"]*?)fillColor=none;/, `$1${FILL}`)
    .replace('</root>', `  <mxCell id="Hx7pci01" value="${ADDED}" style="text;html=1;align=left;verticalAlign=top;whiteSpace=wrap;fontSize=12;fontColor=#232F3E;" vertex="1" parent="1"><mxGeometry x="80" y="470" width="300" height="40" as="geometry" /></mxCell>\n    </root>`);
  if (!out.includes(DESKTOP_AGENT) || !out.includes(FILL) || !out.includes(ADDED)) {
    throw new Error('the Desktop save no longer applies to what the builder writes; update saveAsDesktop');
  }
  return out;
}

export function make(cwd) {
  buildFixture('drawio', SPEC, FILE, cwd);
  const path = join(cwd, FILE);
  writeFileSync(path, saveAsDesktop(readFileSync(path, 'utf8')));
  return [FILE];
}

runAsScript(import.meta, make);
