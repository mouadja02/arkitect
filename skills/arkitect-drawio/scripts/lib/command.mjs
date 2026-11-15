// The command a hint prints for the next step, in the one form that runs from
// any folder: `node "<install>/bin/arkitect.mjs" <engine> <verb> ...`, with the
// install found from this file's own place, as the adapters `arkitect install`
// writes it. A hint that named the script instead, `node scripts/fetch-logo.mjs`
// or `node find-icon.mjs`, failed with "Cannot find module" from the project
// folder, where every command is run (#478).
//
// Computed where it is printed, never stored: a committed file that held it
// would carry one machine's path to every other install.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'bin', 'arkitect.mjs');

// An argument is quoted unless it is a plain word or path, so a placeholder
// (`<component>`), a URL with a `&` or a path with a space runs as it reads.
export const shown = (arg) => (/^[\w./\\:@%+=,-]+$/.test(arg) ? arg : JSON.stringify(arg));

export function command(engine, verb, ...args) {
  return `node "${CLI}" ${engine} ${verb}${args.map((a) => ` ${shown(a)}`).join('')}`;
}
