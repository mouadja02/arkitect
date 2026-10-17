#!/usr/bin/env node
// Print one section of the pattern catalog, read-only (#417). The section
// reader is shared with the Draw.io skill, like the backups.
import { fileURLToPath } from 'node:url';
import { patternCli } from '../../arkitect-drawio/scripts/lib/pattern-section.mjs';

const catalogPath = fileURLToPath(new URL('../references/pattern-catalog.md', import.meta.url));
process.exit(patternCli(process.argv.slice(2), { catalogPath, engine: 'excalidraw' }));
