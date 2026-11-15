// `arkitect <engine> spec <file>`, for both engines (#388). An edit to a
// diagram Arkitect built went through hand-written XML or bound scene JSON,
// the hardest step left on a small model's path, because the spec it was
// built from was a separate file, often not committed. Every build now
// carries its spec; this prints it, to change and rebuild. The engine supplies
// how its file holds the spec.

import { readFileSync } from 'node:fs';
import { parseCliOrExit, exitUsage } from './drawio-core.mjs';
import { otherEngineLines } from './other-engine.mjs';

// `savedSince(text)` is true when an editor has saved the file since the
// build: a colour or a position changed there is not in the spec, and a
// rebuild draws the spec's. `read(file)` gives `{ text, image }`: the text an
// exported image holds, so the spec comes out of a README picture too (#439,
// #447), and `image` ('png' or 'svg') when the file is a picture, which holds
// nothing when its text is empty (#479). `noneIn(image)` says so in the engine's words.
// `isOurs(text)` is true for a file Arkitect built, which may still carry no
// spec: built before builds carried one, or its carriers deleted (#408).
export function specCli(argv, { specOf, savedSince = () => false, isOurs = () => false, kind, noneIn, read = (file) => ({ text: readFileSync(file, 'utf8'), image: null }) }) {
  const usage = `usage: spec.mjs <file.${kind}>\n`
    + '  prints the spec the file was built from, to change and rebuild with build --out <the same file>;\n'
    + '  exit 1 when the file carries none: Arkitect did not build it, or built it before builds carried one';
  const { positionals } = parseCliOrExit(argv, {}, usage);
  if (positionals.length !== 1) exitUsage(positionals.length ? `expected one file, got ${positionals.length}` : 'expected a file', usage);
  const [file] = positionals;
  // The other engine's file has a spec of its own, from the other engine's command (#493).
  const other = otherEngineLines([file], kind, 'spec');
  if (other.length) {
    console.error(other.join('\n'));
    return 2;
  }
  let text;
  let image;
  try { ({ text, image } = read(file)); } catch (e) {
    console.error(`cannot read ${file}: ${e.code ?? e.message}`);
    return 2;
  }
  // A picture holding no diagram is not a diagram file to edit in place: the way on is its source.
  if (image && !text) {
    console.error(`${file} is ${noneIn(image)}: open the .${kind} it was rendered from, or rebuild it; render --embed writes an image that holds its source`);
    return 1;
  }
  let spec = null;
  try { spec = specOf(text); } catch { /* not a file of this kind: it carries no spec */ }
  if (!spec) {
    let ours = false;
    try { ours = isOurs(text); } catch { /* not a file of this kind */ }
    console.error(`${file} carries no spec: ${ours ? 'Arkitect built it, but before builds carried one, or what carried it was deleted in an editor since'
      : 'it was not built by Arkitect, or not since specs were embedded'}. Edit it in place as references/editing.md says`);
    return 1;
  }
  console.log(JSON.stringify(spec, null, 2));
  if (savedSince(text)) {
    console.error(`${file} was saved by an editor since it was built: a colour, position or shape changed there is not `
      + 'in this spec, and a rebuild replaces it. Edit in place, as references/editing.md says, unless the user wants the rebuild');
  }
  return 0;
}
