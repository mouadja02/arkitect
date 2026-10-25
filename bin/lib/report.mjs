// arkitect report <file|-> [--png-viewed]
// arkitect report --draft <diagram> [--spec <spec>] [--defaults]
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
import { readJson } from '../../skills/arkitect-drawio/scripts/lib/read-json.mjs';
import { brief } from '../../skills/arkitect-drawio/scripts/lib/todo.mjs';
import { problems, FILL_IN } from '../../hooks/report-check.mjs';
import * as drawioBuilder from '../../skills/arkitect-drawio/scripts/build-diagram.mjs';
import * as drawioValidator from '../../skills/arkitect-drawio/scripts/validate-drawio.mjs';
import * as excalidrawBuilder from '../../skills/arkitect-excalidraw/scripts/build-diagram.mjs';
import * as excalidrawValidator from '../../skills/arkitect-excalidraw/scripts/validate-excalidraw.mjs';

export const USAGE = 'usage: arkitect report <report.md | -> [--png-viewed]\n'
  + '       arkitect report --draft <diagram> [--spec <spec.json>] [--defaults]\n'
  + '  checks a saved diagram report: the seven headings, a Render section that describes\n'
  + '  only what was seen, no validate warning explained away, no hosted-editor link, no\n'
  + '  `fill in` marker left.\n'
  + '  --png-viewed  you opened the rendered PNG and looked at it (declared, not observed)\n'
  + '  --draft       print the report with File, Icons and Validation filled from the diagram\n'
  + '                and its spec (--spec, else the one it carries); save it, fill in each\n'
  + '                `fill in` line, then check it\n'
  + '  --defaults    replay the spec in the house style, as build --defaults draws it';

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

// A Draw.io entry by its node, as Excalidraw's are (#409); by its query when
// the API was handed a bare one.
const whose = (e) => (e.node != null ? `node ${code(e.node)}` : code(e.query));

function iconLines(engine, report) {
  if (engine === 'drawio') {
    return [
      ...report.used.map((u) => `${whose(u)}: ${code(u.id)}, ${u.pack} pack`),
      ...report.logos.map((l) => `${code(l.name)}: a fetched logo, embedded`),
      ...report.missing.map((m) => `${m.alternatives ? 'unsure' : 'not found'}, drawn as a labelled box: ${brief(m)}`),
      ...report.ambiguous.map((a) => `not confident: ${whose(a)} drew ${code(a.chose)} for ${code(a.query)}`
        + `${a.alternatives.length ? `; alternatives ${a.alternatives.join(', ')}` : ''}`),
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

// The style a replay drew in, named: an applied kind or token changes what the
// build reports, and the diagram does not record which style drew it (#429).
function styleWords(style) {
  if (style.source === 'override') return 'in the applied style';
  return style.reason === '--defaults' ? 'in the house style (--defaults)' : 'in the house style';
}

function buildLines(engine, report, style) {
  return [
    // Ignored whole, as every build here ignores it: said, not presented as
    // the convention the person applied.
    ...(style.errors.length ? [`style: the applied style is ignored, as a build here ignores it: ${style.errors.join('; ')}`] : []),
    ...report.unknownKinds.map((u) => `unknownKinds: ${brief(u)}`),
    ...report.unknownFields.map((u) => `unknownFields: ${brief(u)}`),
    ...report.looksLikeBoundary.map((b) => `looksLikeBoundary: ${brief(b)}`),
    ...(report.crossings ?? []).map((c) => `crossing: ${c}`),
    ...report.notes.map((n) => `note: ${n}`),
  ];
}

// The draft as Markdown, or { error } for a usage problem. `style` is the one
// the replay draws in: the builders' API never reads the person's store, so it
// is the house style unless the caller passes one, as the CLI does (#429).
export function draftReport(file, { spec: specPath = null, style = null } = {}) {
  const engine = engineOf(file);
  if (!engine) return { error: `${file} is not a diagram: --draft reads a .drawio, .dio, .xml or .excalidraw file` };
  const { builder, validator, name, other } = ENGINES[engine];
  style ??= builder.resolveStyle();
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { return { error: `cannot read the diagram ${file}: ${e.code ?? e.message}` }; }
  const result = validator.validateFile(file);

  // Without --spec, the spec the diagram carries, when it carries one (#388).
  let spec = null;
  let from = null;
  if (specPath) {
    try { spec = readJson(specPath); } catch (e) {
      return { error: e instanceof SyntaxError ? `${specPath} is not valid JSON` : `cannot read the spec ${specPath}: ${e.code ?? e.message}` };
    }
    from = code(specPath);
  } else {
    try { spec = builder.specOf(text); } catch { /* not readable as its engine's file: validate says why */ }
    from = spec ? `the spec ${code(file)} carries` : null;
  }
  let built = null;
  if (spec) {
    try { built = builder.buildDiagram(spec, { style }).report; } catch (e) {
      if (!(e instanceof builder.SpecError)) throw e;
      return { error: `the spec ${specPath ?? `${file} carries`} does not build:\n  ${e.errors.join('\n  ')}` };
    }
  }

  const icons = built ? iconLines(engine, built) : [];
  const replay = built ? buildLines(engine, built, style) : [];
  const out = [
    '**File**', '', ...fileSection(file, engine, result), '',
    '**Engine**', '', fill(`why ${name} rather than ${other}, from the audience and the request; or that the user named it`), '',
    '**Assumptions**', '', fill('every assumption, asked or not, and any product the user did not name'), '',
    '**Icons**', '',
    ...(built
      ? [`From ${from}, resolved as the build does:`, '', ...(icons.length ? list(icons) : ['- no icon nodes'])]
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
    ...(replay.length ? ['', `The build report for the spec, replayed now ${styleWords(style)}:`, '', ...list(replay)] : []),
    '',
    '**Render**', '', fill('what was rendered and that you looked at the PNG, or that it failed and why; add each defect seen and left to Validation, by page'), '',
    '**Deviations**', '', fill('each departure from the style guide, or none'), '',
  ];
  return { markdown: out.join('\n') };
}

export function report(argv, { stdin = () => readFileSync(0, 'utf8'), log = console.log, error = console.error } = {}) {
  let parsed;
  try {
    parsed = parseCli(argv, { switches: ['--png-viewed', '--draft', '--defaults'], values: { '--spec': null } });
    if (!parsed.help && parsed.positionals.length !== 1) {
      const what = parsed.options.draft ? 'diagram' : 'report file';
      throw new UsageError(parsed.positionals.length ? `expected one ${what}, got ${parsed.positionals.length}` : `expected a ${what}${parsed.options.draft ? '' : ', or - for stdin'}`);
    }
    if (!parsed.help && parsed.options.spec !== undefined && !parsed.options.draft) throw new UsageError('--spec goes with --draft');
    if (!parsed.help && parsed.options.defaults && !parsed.options.draft) throw new UsageError('--defaults goes with --draft');
    if (!parsed.help && parsed.options.draft && parsed.options['png-viewed']) throw new UsageError('--png-viewed checks a report; --draft writes one');
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    error(`${e.message}\n${USAGE}`);
    return 2;
  }
  if (parsed.help) { log(USAGE); return 0; }
  const [file] = parsed.positionals;
  if (parsed.options.draft) {
    // The style this engine's build loads from the same store, or the house
    // style under --defaults, as build --defaults draws (#429).
    const engine = engineOf(file);
    const style = engine ? ENGINES[engine].builder.loadStyle({ defaults: Boolean(parsed.options.defaults) }) : null;
    const draft = draftReport(file, { spec: parsed.options.spec ?? null, style });
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
