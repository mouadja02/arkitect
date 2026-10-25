#!/usr/bin/env node
// Print the spec a .drawio file was built from, to change and rebuild (#388).
// Draw.io Desktop rewrites agent="arkitect-drawio" on save and keeps the spec.
import { specCli } from './lib/spec-cli.mjs';
import { specOf, isArkitectDrawio } from './build-diagram.mjs';
import { readDiagram } from './lib/drawio-core.mjs';

const savedSince = (text) => !/<mxfile\b[^>]*\bagent="arkitect-drawio"/.test(text.slice(0, 4096));
process.exit(specCli(process.argv.slice(2), { specOf, savedSince, isOurs: isArkitectDrawio, kind: 'drawio', read: (file) => readDiagram(file).text }));
