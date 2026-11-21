// A rebuild leaves behind the picture `render --embed` made of the diagram it
// replaced (#480). That picture is what a README shows, and it holds its own
// source, so after one more component is added to the spec it still shows, and
// opens as, the old diagram, with nothing in the build's report to say so.
// After writing the diagram, a builder looks beside it for the names `--embed`
// gives, reads each one it finds and, for every picture that holds some other
// diagram, adds one `notes` line, so it reaches `todo`, naming the picture and
// the command that renders it again. A picture kept in another folder is not
// found, so a build without a note proves nothing about one.

import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { command } from './command.mjs';

const quoteRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The names the renderers write, derived from the diagram's own the way they
// derive them: Draw.io's `<name>.drawio.svg|png`, `<name>.p<N>.drawio.svg|png`
// for a file of several pages, and Excalidraw's `<name>.excalidraw.svg|png`.
const NAMES = {
  drawio: (file) => new RegExp(`^${quoteRe(basename(file, extname(file)).replace(/\.drawio$/i, ''))}(?<page>\\.p\\d+)?\\.drawio\\.(?<format>svg|png)$`, 'i'),
  excalidraw: (file) => new RegExp(`^${quoteRe(basename(file).replace(/\.excalidraw(?:\.(?:svg|png))?$/i, ''))}\\.excalidraw\\.(?<format>svg|png)$`, 'i'),
};
const MOST = 4;

// `holds(bytes)` says whether a picture holds the diagram just written: true,
// false, or null when it holds no diagram at all, which says nothing about
// whether it is out of date and so is left alone.
export function staleImageNotes(out, engine, holds) {
  const dir = dirname(out);
  let entries;
  try { entries = readdirSync(dir); } catch { return []; }
  const name = NAMES[engine](out);
  const stale = new Map();
  for (const entry of entries.filter((e) => name.test(e)).sort()) {
    let verdict;
    try { verdict = holds(readFileSync(join(dir, entry))); } catch { continue; }
    if (verdict !== false) continue;
    const { page, format } = name.exec(entry).groups;
    const group = stale.get(format.toLowerCase()) ?? { files: [], pages: false };
    group.files.push(join(dir, entry));
    group.pages ||= Boolean(page);
    stale.set(format.toLowerCase(), group);
  }
  return [...stale].map(([format, { files, pages }]) => {
    const shown = files.slice(0, MOST).join(', ') + (files.length > MOST ? ` and ${files.length - MOST} more` : '');
    return `${shown} ${files.length > 1 ? 'hold' : 'holds'} a different diagram than this build wrote, so the picture a README shows is out of date; `
      + `render it again: ${command(engine, 'render', out, ...(pages ? ['--all'] : []), '--embed', '--format', format, '--out-dir', dir)}`;
  });
}
