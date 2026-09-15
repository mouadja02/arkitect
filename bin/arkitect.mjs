#!/usr/bin/env node
// Arkitect - one command surface over both diagram engines.
//
// Every script under skills/*/scripts is usable directly; this dispatcher
// exists so an agent (or a person) has a single, discoverable entry point that
// does not depend on knowing the repository layout:
//
//   arkitect drawio icon "bedrock"
//   arkitect excalidraw build spec.json --out arch.excalidraw
//   arkitect doctor
//
// No dependencies, no network, no state. It resolves a subcommand to a script
// and execs it, passing the rest of the argv through untouched.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DRAWIO = join(ROOT, 'skills', 'arkitect-drawio', 'scripts');
const EXCALI = join(ROOT, 'skills', 'arkitect-excalidraw', 'scripts');

// engine -> verb -> [script directory, script file, one-line help]
const COMMANDS = {
  drawio: {
    icon: [DRAWIO, 'find-icon.mjs', 'search the eighteen bundled icon packs'],
    logo: [DRAWIO, 'fetch-logo.mjs', 'cache a third-party product logo for embedding'],
    build: [DRAWIO, 'build-diagram.mjs', 'generate a .drawio diagram from a spec'],
    validate: [DRAWIO, 'validate-drawio.mjs', 'structural and layout checks on a .drawio file'],
    render: [DRAWIO, 'render-drawio.mjs', 'export pages locally using Draw.io Desktop'],
    analyze: [DRAWIO, 'analyze-drawio.mjs', 'summarize a .drawio file without loading its XML'],
    packs: [DRAWIO, 'build-packs.mjs', 'verify or rebuild the icon packs and catalog'],
    sheets: [DRAWIO, 'contact-sheet.mjs', 'render a pack as a labelled grid for review'],
    learn: [DRAWIO, 'build-knowledge.mjs', 'rebuild your style record from your own diagrams'],
    findings: [DRAWIO, 'style-findings.mjs', 'record what your own diagrams say about the style'],
    apply: [DRAWIO, 'apply-style.mjs', 'choose which findings this install draws with'],
  },
  excalidraw: {
    icon: [EXCALI, 'find-icon.mjs', 'search native Excalidraw libraries and the shared packs'],
    'make-icon': [EXCALI, 'make-icon.mjs', 'build an icon from a real product logo'],
    libraries: [EXCALI, 'index-libraries.mjs', 'list, inspect and reindex the bundled libraries'],
    browse: [EXCALI, 'browse-libraries.mjs', 'search and install from the public catalogue'],
    build: [EXCALI, 'build-diagram.mjs', 'generate an .excalidraw scene from a spec'],
    validate: [EXCALI, 'validate-excalidraw.mjs', 'structural checks on an .excalidraw file'],
    analyze: [EXCALI, 'analyze-excalidraw.mjs', 'summarize a scene without loading its JSON'],
    render: [EXCALI, 'render-excalidraw.mjs', 'rasterise a scene to SVG/PNG for a look'],
    learn: [EXCALI, 'build-knowledge.mjs', 'rebuild your style record from your own scenes'],
    findings: [EXCALI, 'style-findings.mjs', 'record what your own scenes say about the style'],
    apply: [EXCALI, 'apply-style.mjs', 'choose which findings this install draws with'],
  },
};

const ALIASES = { dio: 'drawio', 'draw.io': 'drawio', excali: 'excalidraw', ex: 'excalidraw' };

function usage() {
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const lines = [
    `arkitect ${version} - editable Draw.io and Excalidraw diagrams, drawn by your agent`,
    '',
    'usage: arkitect <engine> <command> [args...]',
    '       arkitect install [agent] | test | doctor | where | version',
    '',
  ];
  for (const [engine, verbs] of Object.entries(COMMANDS)) {
    lines.push(`${engine}:`);
    for (const [verb, [, , help]] of Object.entries(verbs)) {
      lines.push(`  arkitect ${engine} ${verb}`.padEnd(34) + help);
    }
    lines.push('');
  }
  lines.push('Every command passes its remaining arguments straight through to the');
  lines.push('underlying script, so `arkitect drawio icon --help` is that script\'s help.');
  lines.push('');
  lines.push('Docs: docs/cli.md   Agent setup: AGENTS.md   Skills: skills/*/SKILL.md');
  return lines.join('\n');
}

function run(script, args, cwd = process.cwd()) {
  const r = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit', cwd });
  process.exit(r.status ?? 1);
}

async function doctor() {
  const checks = [];
  const ok = (label, detail, more) => checks.push(['ok  ', label, detail, more]);
  const warn = (label, detail, more) => checks.push(['warn', label, detail, more]);

  const major = Number(process.versions.node.split('.')[0]);
  (major >= 20 ? ok : warn)('node >= 20', `found ${process.version}`);

  for (const [label, p] of [
    ['draw.io icon packs', join(ROOT, 'skills', 'arkitect-drawio', 'assets', 'libraries', 'sources.json')],
    ['draw.io AWS pack', join(ROOT, 'skills', 'arkitect-drawio', 'assets', 'libraries', 'aws.drawio')],
    ['draw.io icon catalog', join(ROOT, 'skills', 'arkitect-drawio', 'references', 'icon-catalog.json')],
    ['excalidraw libraries', join(ROOT, 'skills', 'arkitect-excalidraw', 'assets', 'libraries', 'bundled', 'index.json')],
    ['plugin manifest', join(ROOT, '.claude-plugin', 'plugin.json')],
    ['agent contract', join(ROOT, 'AGENTS.md')],
  ]) {
    existsSync(p) ? ok(label, 'present') : warn(label, `missing: ${p}`);
  }

  const which = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32' });
    return r.status === 0 ? (r.stdout || '').trim().split('\n')[0] : null;
  };

  const docker = which('docker', ['--version']);
  docker ? ok('docker (Excalidraw app)', docker) : warn('docker (Excalidraw app)', 'not found - optional, needed only to open the real Excalidraw');

  // The renderer's own discovery, not a second list of paths: doctor used to
  // miss /opt/drawio, PATH and DRAWIO_EXE while `drawio render` found them (#46).
  const { locateDrawio } = await import(pathToFileURL(join(DRAWIO, 'render-drawio.mjs')).href);
  const drawio = locateDrawio();
  const drawioLabel = 'draw.io desktop (PNG render)';
  if (drawio.path) ok(drawioLabel, `${drawio.path} (${drawio.source})`);
  else if (drawio.source) warn(drawioLabel, `${drawio.source} ${drawio.tried[0]} is not executable - render refuses it; fix or unset ${drawio.source}`);
  else {
    // A PATH can run to dozens of directories; one line for those keeps the
    // install locations readable. `drawio render` still names every one.
    const dirs = drawio.onPath.length;
    warn(drawioLabel, 'not found - optional, generation and validation work without it', [
      ...(dirs ? [`tried drawio in ${dirs} PATH director${dirs === 1 ? 'y' : 'ies'}`] : []),
      ...drawio.tried.filter((p) => !drawio.onPath.includes(p)).map((p) => `tried ${p}`),
    ]);
  }

  const width = Math.max(...checks.map((c) => c[1].length));
  for (const [status, label, detail, more = []] of checks) {
    console.log(`${status}  ${label.padEnd(width)}  ${detail}`);
    for (const line of more) console.log(`${' '.repeat(width + 8)}${line}`);
  }
  console.log('\nNothing here is required except Node. The rest only widens what you can see.');
}

const argv = process.argv.slice(2);
const first = Object.hasOwn(ALIASES, argv[0]) ? ALIASES[argv[0]] : argv[0];

if (!first || first === '-h' || first === '--help' || first === 'help') { console.log(usage()); process.exit(0); }
if (first === 'version' || first === '--version' || first === '-v') {
  console.log(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
  process.exit(0);
}
if (first === 'where') { console.log(ROOT); process.exit(0); }
if (first === 'doctor') { await doctor(); process.exit(0); }
if (first === 'install') {
  const { install } = await import(pathToFileURL(join(HERE, 'lib', 'install-agent.mjs')).href);
  process.exit(install(ROOT, argv.slice(1)));
}
if (first === 'test') {
  // The suite ships with the git checkout, not the npm package (#38).
  const suite = join(ROOT, 'tests', 'run-tests.mjs');
  if (!existsSync(suite)) {
    console.error('arkitect test runs the offline suite, which ships with the git checkout, not the npm package.\n'
      + 'Clone https://github.com/mouadja02/arkitect and run `node tests/run-tests.mjs` there.');
    process.exit(2);
  }
  run(suite, argv.slice(1), ROOT);
}

const engine = Object.hasOwn(COMMANDS, first) ? COMMANDS[first] : null;
if (!engine) {
  console.error(`unknown engine "${argv[0]}". Expected one of: ${Object.keys(COMMANDS).join(', ')}\n`);
  console.error(usage());
  process.exit(2);
}

const verb = argv[1];
const entry = Object.hasOwn(engine, verb) ? engine[verb] : null;
if (!entry) {
  console.error(`unknown ${first} command "${verb ?? ''}". Expected one of: ${Object.keys(engine).join(', ')}\n`);
  console.error(usage());
  process.exit(2);
}

run(join(entry[0], entry[1]), argv.slice(2));
