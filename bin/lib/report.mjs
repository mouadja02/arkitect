// arkitect report <file|-> [--png-viewed]
// arkitect report --draft <diagram> [--spec <spec>]
//
// The report check, for every host. Claude Code runs it as a Stop hook
// (hooks/report-check.mjs); Codex, Cursor, Copilot, OpenCode and Gemini had no
// route to it, so a report there was checked by nothing (#302). Save the
// report, run this, and fix what it names.
//
// It sees only the text. Whether a PNG was opened is the agent's declaration,
// `--png-viewed`, not an observed tool call: the hook can tell, this cannot.
// Exit 0 clean, 1 with problems, 2 on a usage error.

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { parseCli, UsageError } from '../../skills/arkitect-drawio/scripts/lib/drawio-core.mjs';
import { problems, FILL_IN } from '../../hooks/report-check.mjs';
import * as drawioBuilder from '../../skills/arkitect-drawio/scripts/build-diagram.mjs';
import * as drawioValidator from '../../skills/arkitect-drawio/scripts/validate-drawio.mjs';
import * as excalidrawBuilder from '../../skills/arkitect-excalidraw/scripts/build-diagram.mjs';
import * as excalidrawValidator from '../../skills/arkitect-excalidraw/scripts/validate-excalidraw.mjs';

export const USAGE = 'usage: arkitect report <report.md | -> [--png-viewed]\n'
  + '       arkitect report --draft <diagram> [--spec <spec.json>]\n'
  + '  checks a saved diagram report: the seven headings, a Render section that describes\n'
  + '  only what was seen, no validate warning explained away, no hosted-editor link, no\n'
  + '  `fill in` marker left.\n'
  + '  --png-viewed  you opened the rendered PNG and looked at it (declared, not observed)\n'
  + '  --draft       print the report with File, Icons and Validation filled from the diagram\n'
  + '                and its spec; save it, fill in each `fill in` line, then check it';

export function checkReport(text, { viewed = false } = {}) {
  return problems(text, { viewed, unseen: 'the report check was not told a PNG was looked at (--png-viewed)' });
}

// Copying a dozen warning lines and every icon by hand is what a small model
// gets wrong first, and where most report fixes since 2.2.0 landed: a warning
// without its ids, a namesAProduct entry left out, a mark that was never drawn
// (#387). Everything under File, Icons and Validation is in the diagram and
// its spec, so a script writes it; the agent fills in the judgement.
const fill = (what) => `${FILL_IN}: ${what} -->`;

const ENGINES = {
  drawio: { name: 'Draw.io', other: 'Excalidraw', exts: ['.drawio', '.dio', '.xml'], builder: drawioBuilder, validator: drawioValidator },
  excalidraw: { name: 'Excalidraw', other: 'Draw.io', exts: ['.excalidraw'], builder: excalidrawBuilder, validator: excalidrawValidator },
};
export const engineOf = (file) => Object.keys(ENGINES).find((k) => ENGINES[k].exts.includes(extname(file).toLowerCase())) ?? null;

const code = (s) => `\`${String(s).replace(/`/g, "'")}\``;
const list = (items) => items.map((i) => `- ${i}`);
// One build-report entry on a line, every field but the spec fragment to paste.
const brief = (entry) => (typeof entry === 'string' ? entry : Object.entries(entry)
  .filter(([k, v]) => k !== 'replace' && v != null && !(Array.isArray(v) && !v.length))
  .map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', '));

function fileSection(file, engine, result) {
  const i = result.info ?? {};
  if (engine === 'drawio') {
    const pages = i.pages ?? [];
    const sum = (key) => pages.reduce((n, p) => n + (p[key] ?? 0), 0);
    return [`${code(file)}: ${ENGINES[engine].name}, ${pages.length} page${pages.length === 1 ? '' : 's'}`
      + ` (${pages.map((p) => JSON.stringify(p.name ?? '')).join(', ')}), ${sum('vertices')} vertices, ${sum('edges')} edges,`
      + ` ${sum('embeddedImages')} embedded images.`];
  }
  return [`${code(file)}: ${ENGINES[engine].name}, ${i.elements ?? 0} elements, ${i.embeddedFiles ?? 0} embedded files`
    + `${i.canvas ? `, canvas ${i.canvas.width}x${i.canvas.height}` : ''}.`];
}

function iconLines(engine, report) {
  if (engine === 'drawio') {
    return [
      ...report.used.map((u) => `${code(u.query)}: ${code(u.id)}, ${u.pack} pack`),
      ...report.logos.map((l) => `${code(l.name)}: a fetched logo, embedded`),
      ...report.missing.map((m) => `not found, drawn as a labelled box: ${brief(m)}`),
      ...report.ambiguous.map((a) => `not confident: ${code(a.query)} drew ${code(a.chose)}; alternatives ${a.alternatives.join(', ')}`),
      ...report.needsFetch.map((n) => `on demand, not drawn: ${brief(n)}`),
      ...report.sameArtwork.map((s) => `one artwork for several marks: ${brief(s)}`),
      ...report.lifecycle.map((l) => `lifecycle: ${brief(l)}`),
      ...report.missingLogos.map((l) => `logo not found, drawn as a labelled box: ${code(l)}`),
      ...report.opaqueLogos.map((l) => `logo with an opaque background: ${l}`),
      ...report.namesAProduct.map((p) => `a plain box naming a product, drawn as text: node ${code(p.node)} names ${code(p.text)}, whose mark is ${code(p.icon)}`),
    ];
  }
  return [
    ...report.icons.map((i) => `node ${code(i.node)}: ${code(i.ref)}${i.pack ? `, ${i.pack} pack` : i.kind === 'embedded' ? '' : `, ${String(i.ref).split(':')[0]} library`}`),
    ...report.missingIcons.map((m) => `placeholder, no icon found: ${code(m)}`),
    ...report.opaqueIcons.map((o) => `icon with an opaque background: ${o}`),
    ...report.namesAProduct.map((p) => `a plain shape naming a product, drawn as text: node ${code(p.node)} names ${code(p.text)}, whose mark is ${code(p.icon)}`),
  ];
}

function buildLines(engine, report) {
  return [
    ...report.unknownKinds.map((u) => `unknownKinds: ${brief(u)}`),
    ...report.unknownFields.map((u) => `unknownFields: ${brief(u)}`),
    ...report.looksLikeBoundary.map((b) => `looksLikeBoundary: ${brief(b)}`),
    ...(report.crossings ?? []).map((c) => `crossing: ${c}`),
    ...report.notes.map((n) => `note: ${n}`),
  ];
}

// The draft as Markdown, or { error } for a usage problem.
export function draftReport(file, { spec: specPath = null } = {}) {
  const engine = engineOf(file);
  if (!engine) return { error: `${file} is not a diagram: --draft reads a .drawio, .dio, .xml or .excalidraw file` };
  const { builder, validator, name, other } = ENGINES[engine];
  try { readFileSync(file); } catch (e) { return { error: `cannot read the diagram ${file}: ${e.code ?? e.message}` }; }
  const result = validator.validateFile(file);

  let built = null;
  if (specPath) {
    let spec;
    try { spec = JSON.parse(readFileSync(specPath, 'utf8')); } catch (e) {
      return { error: e instanceof SyntaxError ? `${specPath} is not valid JSON` : `cannot read the spec ${specPath}: ${e.code ?? e.message}` };
    }
    try { built = builder.buildDiagram(spec).report; } catch (e) {
      if (!(e instanceof builder.SpecError)) throw e;
      return { error: `the spec ${specPath} does not build:\n  ${e.errors.join('\n  ')}` };
    }
  }

  const icons = built ? iconLines(engine, built) : [];
  const out = [
    '**File**', '', ...fileSection(file, engine, result), '',
    '**Engine**', '', fill(`why ${name} rather than ${other}, from the audience and the request; or that the user named it`), '',
    '**Assumptions**', '', fill('every assumption, asked or not, and any product the user did not name'), '',
    '**Icons**', '',
    ...(built
      ? [`From ${code(specPath)}, resolved as the build does:`, '', ...(icons.length ? list(icons) : ['- no icon nodes'])]
      : [fill(`each icon and its source; run report --draft ${file} --spec <spec> to list them`)]),
    '',
    '**Validation**', '',
    `${code(`validate ${file}`)}: ${result.ok ? 'PASS' : 'FAIL'}, ${result.errors.length} error${result.errors.length === 1 ? '' : 's'}, `
      + `${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}`
      + `${result.warnings.length ? ', each a defect still in the drawing, every id included:' : '.'}`,
    ...(result.errors.length || result.warnings.length ? [''] : []),
    ...list(result.errors.map((e) => `error: ${e}`)),
    ...list(result.warnings.map((w) => `warning: ${w}`)),
    ...((result.notes ?? []).length ? ['', 'Its notes, for a person to check:', '', ...list(result.notes)] : []),
    ...(built && buildLines(engine, built).length ? ['', 'The build report for the spec:', '', ...list(buildLines(engine, built))] : []),
    '',
    '**Render**', '', fill('what was rendered and that you looked at the PNG, or that it failed and why; add each defect seen and left to Validation, by page'), '',
    '**Deviations**', '', fill('each departure from the style guide, or none'), '',
  ];
  return { markdown: out.join('\n') };
}

export function report(argv, { stdin = () => readFileSync(0, 'utf8'), log = console.log, error = console.error } = {}) {
  let parsed;
  try {
    parsed = parseCli(argv, { switches: ['--png-viewed', '--draft'], values: { '--spec': null } });
    if (!parsed.help && parsed.positionals.length !== 1) {
      const what = parsed.options.draft ? 'diagram' : 'report file';
      throw new UsageError(parsed.positionals.length ? `expected one ${what}, got ${parsed.positionals.length}` : `expected a ${what}${parsed.options.draft ? '' : ', or - for stdin'}`);
    }
    if (!parsed.help && parsed.options.spec !== undefined && !parsed.options.draft) throw new UsageError('--spec goes with --draft');
    if (!parsed.help && parsed.options.draft && parsed.options['png-viewed']) throw new UsageError('--png-viewed checks a report; --draft writes one');
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    error(`${e.message}\n${USAGE}`);
    return 2;
  }
  if (parsed.help) { log(USAGE); return 0; }
  const [file] = parsed.positionals;
  if (parsed.options.draft) {
    const draft = draftReport(file, { spec: parsed.options.spec ?? null });
    if (draft.error) { error(`${draft.error}\n${USAGE}`); return 2; }
    log(draft.markdown);
    return 0;
  }
  let text;
  try {
    text = file === '-' ? stdin() : readFileSync(file, 'utf8');
  } catch (e) {
    error(`cannot read the report ${file}: ${e.code ?? e.message}`);
    return 2;
  }
  const found = checkReport(text, { viewed: Boolean(parsed.options['png-viewed']) });
  if (!found.length) {
    log('report ok: every heading present, nothing describing an unseen render, no warning excused, no hosted-editor link');
    return 0;
  }
  log(`report: ${found.length} problem${found.length > 1 ? 's' : ''}. Fix each, then write the whole report again:`);
  for (const p of found) log(`- ${p}`);
  return 1;
}
