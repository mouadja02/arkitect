#!/usr/bin/env node
// Repository-level checks: the CLI, the agent adapters, the docs and the shape
// of the plugin. The two engine suites test the diagram generators; this one
// tests everything that holds them together.
//
//   node tests/toolkit.mjs
//
// Offline and deterministic, like the others.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { repoFiles, trackedButIgnored } from './repo-files.mjs';
import { liveCounts, checkDocCounts } from './icon-count-guard.mjs';
import { createHarness, settle } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CLI = join(ROOT, 'bin', 'arkitect.mjs');
const TMP = join(HERE, 'output', 'toolkit');

// Never the style store of the person running the suite (#89): every CLI a test
// runs, the packed one included, inherits this.
process.env.ARKITECT_HOME = join(TMP, 'arkitect-home');

// test() is synchronous; a callback that returns a promise fails (#114).
const { test, finish } = createHarness();

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg} (expected ${b}, got ${a})`); }

const cli = (args, opts = {}) =>
  execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts });

if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
const marketplace = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));

// Text files worth scanning. Binary assets and vendored libraries are excluded:
// they are other people's bytes and are verified by digest elsewhere. Inside a
// library folder only our own Markdown is read - its README and the generated
// ATTRIBUTION.md files - so their links are checked like any other doc (#87).
const LIBRARY_DIRS = new Set(['bundled', 'libraries']);
const TEXT = /\.(md|mdc|json|mjs|js|ps1|ya?ml|txt)$/i;
const MARKDOWN = /\.mdc?$/i;
const FILES = repoFiles(ROOT, ({ rel, name, size }) => {
  const inLibrary = rel.split('/').some((d) => LIBRARY_DIRS.has(d));
  return (inLibrary ? MARKDOWN : TEXT).test(name) && size < 4 * 1024 * 1024;
});

// ------------------------------------------------------------------ the CLI

test('the dispatcher points every command at a script that exists', () => {
  const src = readFileSync(CLI, 'utf8');
  const refs = [...src.matchAll(/\[(DRAWIO|EXCALI), '([^']+\.mjs)'/g)];
  assert(refs.length >= 15, `expected the full command table, found ${refs.length}`);
  for (const [, engine, file] of refs) {
    const skill = engine === 'DRAWIO' ? 'arkitect-drawio' : 'arkitect-excalidraw';
    const p = join(ROOT, 'skills', skill, 'scripts', file);
    assert(existsSync(p), `missing script: ${relative(ROOT, p)}`);
  }
});

test('usage lists both engines and every top-level verb', () => {
  const out = cli([]);
  for (const token of ['drawio:', 'excalidraw:', 'install', 'doctor', 'where', 'version']) {
    assert(out.includes(token), `usage does not mention ${token}`);
  }
});

test('version matches package.json, and where prints the repository root', () => {
  eq(cli(['version']).trim(), pkg.version, 'reported version');
  eq(resolve(cli(['where']).trim()), resolve(ROOT), 'reported root');
});

test('an unknown engine or verb fails loudly rather than doing something', () => {
  for (const args of [['nonsense'], ['drawio', 'nonsense']]) {
    let code = 0;
    try { cli(args, { stdio: 'pipe' }); } catch (e) { code = e.status; }
    eq(code, 2, `"${args.join(' ')}" should exit 2`);
  }
});

test('doctor reports the bundled assets as present', () => {
  const out = cli(['doctor']);
  for (const line of ['draw.io icon packs', 'draw.io AWS pack', 'excalidraw libraries', 'plugin manifest', 'agent contract']) {
    const row = out.split('\n').find((l) => l.includes(line));
    assert(row, `doctor does not check ${line}`);
    assert(row.startsWith('ok'), `doctor says: ${row.trim()}`);
  }
});

// doctor asks the renderer where Draw.io Desktop is, so the two can never
// disagree (#46). A stub stands in for the app; doctor only looks, never runs it.
const renderDrawio = await import(pathToFileURL(join(ROOT, 'skills', 'arkitect-drawio', 'scripts', 'render-drawio.mjs')).href);

test('doctor finds Draw.io Desktop where render does, and says how (#46)', () => {
  const windows = process.platform === 'win32';
  const drawioRow = (out) => out.split('\n').find((l) => l.includes('draw.io desktop')) ?? '';
  // The machine's own PATH and DRAWIO_EXE are dropped, so only a stub can be found.
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^path$/i.test(k) && k !== 'DRAWIO_EXE'));
  const doctorWith = (env) => cli(['doctor'], { env: { ...base, ...env } });
  const stub = (dir, name) => {
    const p = join(TMP, dir, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, '#!/bin/sh\nexit 0\n');
    if (!windows) execFileSync('chmod', ['755', p]);
    return p;
  };
  const empty = join(TMP, 'drawio-empty');
  mkdirSync(empty, { recursive: true });

  const pinned = stub('drawio-pinned', windows ? 'draw.io.exe' : 'drawio');
  let row = drawioRow(doctorWith({ PATH: empty, DRAWIO_EXE: pinned }));
  assert(row.startsWith('ok') && row.includes(`${pinned} (DRAWIO_EXE)`), `a DRAWIO_EXE stub: ${row}`);

  const missing = join(TMP, 'drawio-pinned', 'not-there');
  row = drawioRow(doctorWith({ PATH: empty, DRAWIO_EXE: missing }));
  assert(row.startsWith('warn') && row.includes(`DRAWIO_EXE ${missing} is not executable`), `an unusable DRAWIO_EXE: ${row}`);

  const listed = stub('drawio-on-path', windows ? 'drawio.exe' : 'drawio');
  row = drawioRow(doctorWith({ PATH: dirname(listed) }));
  assert(row.startsWith('ok') && row.includes(`${listed} (PATH)`), `a drawio on PATH: ${row}`);

  // Nothing anywhere: every path the renderer tried is listed. Checkable only
  // where Desktop is not installed, which includes every CI runner.
  const bare = renderDrawio.locateDrawio(undefined, { env: { PATH: empty } });
  if (bare.path) {
    console.log(`      (Draw.io Desktop is installed at ${bare.path}; the not-found listing is checked where it is not)`);
    return;
  }
  const out = doctorWith({ PATH: empty });
  assert(drawioRow(out).startsWith('warn') && drawioRow(out).includes('not found'), `nothing installed: ${drawioRow(out)}`);
  assert(out.includes('tried drawio in 1 PATH directory'), `doctor does not summarise the PATH search:\n${out}`);
  const installs = bare.tried.filter((p) => !bare.onPath.includes(p));
  assert(installs.length >= 5, `expected every install location to be tried, got ${installs.join(', ')}`);
  for (const p of installs) assert(out.includes(`tried ${p}`), `doctor does not list ${p}:\n${out}`);
});

test('both builders create a missing output folder instead of failing with a stack trace (#113)', () => {
  for (const [engine, spec, ext] of [
    ['drawio', join(ROOT, 'skills', 'arkitect-drawio', 'assets', 'templates', 'starter-architecture.spec.json'), 'drawio'],
    ['excalidraw', join(ROOT, 'skills', 'arkitect-excalidraw', 'assets', 'templates', 'starter-architecture.spec.json'), 'excalidraw'],
  ]) {
    const out = join(TMP, 'new-folder', engine, 'deeper', `arch.${ext}`);
    const report = JSON.parse(cli([engine, 'build', spec, '--out', out, '--defaults']));
    eq(report.wrote, out, `${engine} reports the file it wrote`);
    assert(statSync(out).size > 0, `${engine} wrote into the new folder`);
  }
});

test('both engines dispatch through to a real search', () => {
  const drawio = JSON.parse(cli(['drawio', 'icon', 'bedrock']));
  assert(drawio.matches?.length > 0, 'no draw.io icon match for "bedrock"');
  const excali = JSON.parse(cli(['excalidraw', 'icon', 'postgres']));
  assert(excali.matches?.length > 0, 'no excalidraw icon match for "postgres"');
});

// ------------------------------------------------------------- the adapters

const adapters = await import(pathToFileURL(join(ROOT, 'bin', 'lib', 'install-agent.mjs')).href);

test('every adapter renders a block naming the install path and the engines', () => {
  for (const [name, a] of Object.entries(adapters.ADAPTERS)) {
    const block = a.render('/opt/arkitect');
    assert(block.includes('/opt/arkitect'), `${name}: does not carry the install path`);
    const lower = block.toLowerCase();
    assert(lower.includes('draw.io') || lower.includes('drawio'), `${name}: does not name Draw.io`);
    assert(lower.includes('excalidraw'), `${name}: does not name Excalidraw`);
    assert(a.file && a.hosts, `${name}: missing file or hosts`);
  }
});

test('every alias resolves to a real adapter', () => {
  for (const [alias, target] of Object.entries(adapters.ALIASES)) {
    if (target.startsWith('--')) continue;
    assert(adapters.ADAPTERS[target], `alias ${alias} points at unknown adapter ${target}`);
  }
});

test('install writes each adapter into the target project', () => {
  const dir = join(TMP, 'project');
  mkdirSync(dir, { recursive: true });
  cli(['install', '--all', '--dir', dir]);
  for (const a of Object.values(adapters.ADAPTERS)) {
    assert(existsSync(join(dir, a.file)), `install did not write ${a.file}`);
  }
});

test('install is idempotent and leaves existing content alone', () => {
  const dir = join(TMP, 'merge');
  mkdirSync(dir, { recursive: true });
  const own = '# House rules\n\nAlways rebase.\n';
  writeFileSync(join(dir, 'AGENTS.md'), own);

  cli(['install', 'agents', '--dir', dir]);
  cli(['install', 'agents', '--dir', dir]);
  cli(['install', 'agents', '--dir', dir]);

  const after = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  eq(after.split('<!-- arkitect:begin -->').length - 1, 1, 'marker blocks after three runs');
  assert(after.includes('Always rebase.'), 'existing content was lost');
});

test('a non-merge adapter refuses to clobber without --force', () => {
  const dir = join(TMP, 'force');
  mkdirSync(join(dir, '.cursor', 'rules'), { recursive: true });
  writeFileSync(join(dir, '.cursor', 'rules', 'arkitect.mdc'), 'mine\n');

  cli(['install', 'cursor', '--dir', dir]);
  eq(readFileSync(join(dir, '.cursor', 'rules', 'arkitect.mdc'), 'utf8'), 'mine\n', 'file was replaced without --force');

  cli(['install', 'cursor', '--dir', dir, '--force']);
  assert(readFileSync(join(dir, '.cursor', 'rules', 'arkitect.mdc'), 'utf8').includes('Arkitect'), '--force did not replace it');
});

test('install refuses to write into the Arkitect checkout itself', () => {
  // It would append a copy of the pointer block, absolute path and all, to the
  // very contract file the block tells agents to read.
  const before = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  let code = 0;
  try { cli(['install', '--all'], { cwd: ROOT, stdio: 'pipe' }); } catch (e) { code = e.status; }
  eq(code, 2, 'self-install should exit 2');
  eq(readFileSync(join(ROOT, 'AGENTS.md'), 'utf8'), before, 'AGENTS.md was modified');
});

test('--print writes nothing to disk', () => {
  const dir = join(TMP, 'print');
  mkdirSync(dir, { recursive: true });
  const out = cli(['install', 'agents', '--print', '--dir', dir]);
  assert(out.includes('Arkitect'), '--print produced no block');
  eq(readdirSync(dir).length, 0, '--print wrote files');
});

test('this repository ships the adapters it advertises', () => {
  for (const p of [
    '.cursor/rules/arkitect.mdc',
    '.cursor/commands/diagram.md',
    '.opencode/command/diagram.md',
    '.codex/prompts/diagram.md',
    '.github/copilot-instructions.md',
    'AGENTS.md',
  ]) {
    assert(existsSync(join(ROOT, p)), `missing committed adapter: ${p}`);
  }
});


// Invalid CLI requests must fail before changing the user's project.
test('prototype names are usage errors at each dispatcher level', () => {
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    for (const args of [[name], ['drawio', name], ['excalidraw', name]]) {
      const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
      eq(result.status, 2, args.join(' '));
      assert(result.stderr.includes('unknown'), 'missing usage error');
      assert(!result.stderr.includes('TypeError'), 'leaked stack trace');
    }
  }
});

test('install rejects malformed requests before writing any adapter', () => {
  const dir = join(TMP, 'invalid-install');
  mkdirSync(dir, { recursive: true });
  const own = '# Existing project rules\n';
  const target = join(dir, 'AGENTS.md');
  writeFileSync(target, own);
  const badArgs = [
    ['agents', '--prnit'], ['agents', '--dir'], ['agents', '--dir', '--print'],
    ['agents', '--dir', '-h'], ['agents', '--dir', ''],
    ['agents', '--dir', dir, '--dir', dir], ['agents', 'missing'],
    ['--all', 'missing'], ['agents', 'constructor'], ['__proto__'], ['toString'],
  ];
  for (const args of badArgs) {
    const result = spawnSync(process.execPath, [CLI, 'install', ...args], { cwd: dir, encoding: 'utf8' });
    eq(result.status, 2, args.join(' '));
    assert(result.stderr.length > 0 && !result.stderr.includes('TypeError'), 'expected a usage error');
    eq(readFileSync(target, 'utf8'), own, 'invalid install changed project rules');
    eq(readdirSync(dir).join(','), 'AGENTS.md', 'invalid install created files');
  }
});

test('install help never writes even when adapters were selected', () => {
  const dir = join(TMP, 'install-help');
  mkdirSync(dir, { recursive: true });
  for (const flag of ['--help', '-h']) {
    const out = cli(['install', 'agents', '--all', flag], { cwd: dir });
    assert(out.includes('usage: arkitect install'), 'missing installer usage');
    eq(readdirSync(dir).length, 0, 'help wrote adapters');
  }
});

test('install deduplicates adapter aliases and supports options before names', () => {
  const dir = join(TMP, 'install-aliases');
  const out = cli(['install', '--dir', dir, 'agents', 'codex', 'pi']);
  eq(out.split('write ').length - 1, 1, 'same adapter written more than once');
  assert(!out.includes('update '), 'aliases triggered duplicate updates');
  assert(readFileSync(join(dir, 'AGENTS.md'), 'utf8').includes('Arkitect'), 'adapter missing');
});

test('test runner refuses unknown selections before running a suite', () => {
  for (const args of [['drawio', 'typo'], ['toolkit', '--typo'], ['--typo']]) {
    const result = spawnSync(process.execPath, [join(HERE, 'run-tests.mjs'), ...args], { encoding: 'utf8' });
    eq(result.status, 2, args.join(' '));
    assert(result.stderr.includes('unknown suite or option'), 'missing diagnostic');
    assert(!result.stdout.includes('==='), 'ran a suite before rejecting arguments');
  }
  assert(cli(['test', '--help']).includes('usage:'), 'missing runner help');
});

test('CLI guide names commands that the dispatcher supports', () => {
  const src = readFileSync(CLI, 'utf8');
  const commands = new Set([...src.matchAll(/([\w-]+): \[(DRAWIO|EXCALI),/g)]
    .map(([, verb, engine]) => (engine === 'DRAWIO' ? 'drawio' : 'excalidraw') + ' ' + verb));
  for (const [, engine, verb] of readFileSync(join(ROOT, 'docs', 'cli.md'), 'utf8')
    .matchAll(/^arkitect (drawio|excalidraw) ([a-z-]+)/gm)) {
    assert(commands.has(engine + ' ' + verb) || src.includes("'" + verb + "': [" + (engine === 'drawio' ? 'DRAWIO' : 'EXCALI')),
      'undispatchable documented command: ' + engine + ' ' + verb);
  }
});

// ------------------------------------------------------------------- shape

test('the plugin, marketplace and package manifests agree', () => {
  eq(manifest.name, pkg.name, 'plugin vs package name');
  eq(manifest.version, pkg.version, 'plugin vs package version');
  eq(marketplace.plugins[0].name, manifest.name, 'marketplace vs plugin name');
  assert(existsSync(join(ROOT, pkg.bin.arkitect)), 'package.json bin points at a missing file');
  assert(manifest.description.length > 40, 'plugin description is too thin to be useful');
  // Only skills/ is a component location, so evals/ and tests/ are not (#138),
  // and everything in it has to be a skill Claude Code can load.
  eq(JSON.stringify(manifest.skills), '["./skills/"]', 'declared skills path');
  for (const dir of readdirSync(join(ROOT, 'skills'))) {
    assert(existsSync(join(ROOT, 'skills', dir, 'SKILL.md')), `skills/${dir} has no SKILL.md`);
  }
});

test('every advertised icon count agrees, so one cannot drift from the rest', () => {
  // Not the exact catalog number - that changes with every pack addition. This
  // just stops plugin.json, marketplace.json, package.json and the installer's
  // own pointer text from independently going stale relative to each other, the
  // way "1,400+", "5,900+" and "243 AWS icons" once did in the same repository.
  const PHRASE = '6,000+';
  eq(manifest.description.includes(PHRASE), true, 'plugin.json description');
  eq(marketplace.description.includes(PHRASE), true, 'marketplace.json description');
  eq(marketplace.plugins[0].description.includes(PHRASE), true, 'marketplace.json plugin description');
  eq(pkg.description.includes(PHRASE), true, 'package.json description');
  eq(adapters.ADAPTERS.agents.render('/opt/arkitect').includes(PHRASE), true, 'install-agent.mjs agents body');
});

// A rounded phrase cannot catch a stale exact number, and more than a dozen
// docs quote one. Each is checked against the catalog, the Excalidraw library
// index and the two answer keys, and the failure names the value to write (#78).
const iconCounts = () => {
  const json = (...p) => JSON.parse(readFileSync(join(ROOT, ...p), 'utf8'));
  return liveCounts({
    catalog: json('skills', 'arkitect-drawio', 'references', 'icon-catalog.json'),
    libraries: json('skills', 'arkitect-excalidraw', 'assets', 'libraries', 'bundled', 'index.json'),
    drawioQueries: json('tests', 'icon-queries.json'),
    excalidrawQueries: json('tests', 'excalidraw-icon-queries.json'),
  });
};
const docText = (rel) => {
  const abs = join(ROOT, ...rel.split('/'));
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
};

test('every exact icon count a doc quotes matches what ships (#78)', () => {
  const problems = checkDocCounts({ live: iconCounts(), read: docText });
  assert(problems.length === 0, problems.join('\n        '));
});

// The two ways a quoted count goes wrong, on the real docs with one bent.
test('the count guard catches a drifted number and a dropped sentence (#78)', () => {
  const live = iconCounts();
  const committed = live.committed.toLocaleString('en-US');

  const drifted = checkDocCounts({
    live,
    read: (rel) => (rel === 'docs/icons.md'
      ? docText(rel).replace(`# ${committed} marks in`, '# 4,000 marks in')
      : docText(rel)),
  });
  assert(drifted.some((p) => p.startsWith('docs/icons.md: quotes 4,000 marks that ship their artwork')
    && p.endsWith(`so write ${committed}`)), `a drifted number went unreported: ${drifted.join(' | ')}`);

  // Rewording past the pattern hides the number instead of correcting it.
  const dropped = checkDocCounts({
    live,
    read: (rel) => (rel === 'docs/drawio-icons.md'
      ? docText(rel).replace('an answer key of', 'an answer key of about')
      : docText(rel)),
  });
  assert(dropped.some((p) => p.startsWith('docs/drawio-icons.md: no longer says answer-key queries with an expected answer')),
    `a dropped sentence went unreported: ${dropped.join(' | ')}`);
});

test('all six skills are well formed, and only the learning and apply ones are manual', () => {
  const skills = readdirSync(join(ROOT, 'skills')).sort();
  eq(skills.join(','), 'apply-drawio-style,apply-excalidraw-style,arkitect-drawio,arkitect-excalidraw,learn-drawio-style,learn-excalidraw-style', 'skill directories');
  for (const s of skills) {
    const md = readFileSync(join(ROOT, 'skills', s, 'SKILL.md'), 'utf8');
    assert(/^---\r?\n/.test(md), `${s}: no YAML frontmatter`);
    assert(md.includes(`name: ${s}`), `${s}: frontmatter name does not match the directory`);
    // They change what an install knows or draws, so they never fire on their own.
    const manual = s.startsWith('learn-') || s.startsWith('apply-');
    eq(md.includes('disable-model-invocation: true'), manual, `${s}: wrong invocation mode`);
  }
  const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert(ci.includes(`skills.length !== ${skills.length}`), `ci.yml's plugin job still expects a different skill count than ${skills.length}`);
});

// A skill is selected on its description, before AGENTS.md §1 is read, so the
// trigger text has to route the way §1 does. It did not: "for the README" is an
// Excalidraw signal in §1 and appeared in neither description, while Draw.io
// claimed every unqualified architecture request. Both runs of a README-leaning
// prompt drew Draw.io, and cited the README as the reason (#201). The signals
// are read out of §1 rather than repeated here, so moving one moves both.
test('each skill description carries the routing signals AGENTS.md §1 gives it (#201)', () => {
  const flat = (s) => s.replace(/\s+/g, ' ');
  const rule = flat(readFileSync(join(ROOT, 'AGENTS.md'), 'utf8'));
  const split = rule.match(/or infer:(.*?)→ Draw\.io\.(.*?)→ Excalidraw\./);
  assert(split, 'AGENTS.md §1 no longer infers an engine from the request');
  const quoted = (s) => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/^for the /, ''));
  const signals = { 'arkitect-drawio': quoted(split[1]), 'arkitect-excalidraw': quoted(split[2]) };
  assert(signals['arkitect-drawio'].length >= 3 && signals['arkitect-excalidraw'].length >= 3,
    'AGENTS.md §1 lists fewer signals than it used to; check the parse');

  const described = {};
  for (const skill of Object.keys(signals)) {
    const md = readFileSync(join(ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
    described[skill] = flat(md.slice(md.indexOf('description:'), md.indexOf('\n---', 10))).toLowerCase();
  }
  for (const [skill, own] of Object.entries(signals)) {
    const other = skill === 'arkitect-drawio' ? 'arkitect-excalidraw' : 'arkitect-drawio';
    for (const signal of own) {
      assert(described[skill].includes(signal.toLowerCase()),
        `${skill}: §1 routes "${signal}" here, but the description never says it`);
      assert(!described[other].includes(signal.toLowerCase()),
        `${other}: the description claims "${signal}", which §1 routes to ${skill}`);
    }
  }
});

// Every eval case directory, in a stable order, for the checks below.
const evalCases = () => {
  const root = join(ROOT, 'evals');
  return readdirSync(root)
    .filter((engine) => statSync(join(root, engine)).isDirectory() && engine !== 'results')
    .flatMap((engine) => readdirSync(join(root, engine))
      .filter((name) => existsSync(join(root, engine, name, 'case.yaml')))
      .map((name) => ({ id: `evals/${engine}/${name}`, dir: join(root, engine, name) })))
    .sort((a, b) => a.id.localeCompare(b.id));
};

// `claude plugin eval` reads context.scaffold_script as a PATH, resolved against
// the case directory - not as inline bash. An inlined script is not run and not
// reported as skipped: the case errors before the agent starts, with
// `path "mkdir -p eval-input ..." does not exist`, and scores 0. That looks like
// a failing plugin rather than a broken case file, so it is worth a test (#133).
test('every eval scaffold_script names a runnable script beside its case (#133)', () => {
  const cases = evalCases();
  assert(cases.length > 0, 'no eval cases were found');
  let scaffolded = 0;
  for (const { id, dir } of cases) {
    const yaml = readFileSync(join(dir, 'case.yaml'), 'utf8');
    const declared = yaml.match(/^\s{2}scaffold_script:[ \t]*(.*)$/m);
    if (!declared) continue;
    scaffolded++;
    const value = declared[1].trim();
    assert(value !== '' && !value.startsWith('|') && !value.startsWith('>'),
      `${id}: scaffold_script is inlined; it must name a script file in the case directory`);
    assert(!/[\\/]/.test(value) && !value.startsWith('.'),
      `${id}: scaffold_script "${value}" must be a plain file name inside the case directory`);
    const script = join(dir, value);
    assert(existsSync(script), `${id}: scaffold_script "${value}" does not exist`);
    const body = readFileSync(script, 'utf8');
    assert(body.startsWith('#!'), `${id}: ${value} has no shebang`);
    // CRLF reaches the sandbox verbatim and `bash` fails on `\r`.
    assert(!body.includes('\r'), `${id}: ${value} has CRLF line endings; the sandbox runs it with bash`);
  }
  assert(scaffolded >= 4, `expected at least the four stays-manual scaffolds, found ${scaffolded}`);
});

// The two constraints that outrank every feature: functional and lightweight,
// and good output on whatever model is driving. They are stated in AGENTS.md and
// repeated wherever someone decides what ships, so a contributor or an agent
// cannot miss them. Wording may improve; the substance may not quietly leave.
test('the project identity is stated in every central file', () => {
  // Prose wraps, and markdown emphasis lands mid-phrase, so match on the words
  // rather than on the line breaks between them.
  const flat = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/[\s*_]+/g, ' ');
  const canonical = flat('AGENTS.md');
  const section = canonical.slice(canonical.indexOf('## What Arkitect optimises for'));
  assert(section.startsWith('## What Arkitect optimises for'),
    'AGENTS.md no longer states what the project optimises for');
  assert(canonical.includes('## What Arkitect optimises for'), 'the identity section lost its heading');
  for (const claim of [
    /functional and lightweight/i,
    /whatever model is driving/i,
    /small local model/i,
    /[Cc]ontext is the scarce resource/,
    /never left to/i,
  ]) {
    assert(claim.test(section.slice(0, 2000)), `AGENTS.md's identity section dropped ${claim}`);
  }

  // Each of these is a place a decision about what ships gets made.
  for (const rel of ['README.md', 'CONTRIBUTING.md', 'docs/maintenance.md']) {
    const text = flat(rel);
    assert(/functional and lightweight|lightweight/i.test(text), `${rel} no longer says the project stays lightweight`);
    assert(/whatever model is driving/i.test(text), `${rel} no longer says it must work on whatever model is driving`);
    assert(/small local model/i.test(text), `${rel} no longer says a small local model must get a good diagram`);
  }
});

// An `llm` grader votes three times and can still disagree with itself run to
// run; a `regex` grader cannot. Anything checkable about a report - a heading,
// a file name, an icon id - belongs in a regex, leaving the judge the one
// question no pattern can answer. A case that drifts back to judge-only checks
// stops being a usable signal, so the composition is held (#135).
test('every generation and icon case keeps deterministic graders (#135)', () => {
  const judged = [];
  for (const { id, dir } of evalCases()) {
    const yaml = readFileSync(join(dir, 'case.yaml'), 'utf8').replace(/\r\n/g, '\n');
    const tags = (yaml.match(/^tags:\s*\[(.*)\]/m)?.[1] ?? '').split(',').map((t) => t.trim());
    if (!tags.includes('generation') && !tags.includes('icons')) continue;

    const graders = [...yaml.matchAll(/^\s*-\s*type:\s*(\w+)/gm)].map((m) => m[1]);
    const deterministic = graders.filter((g) => g !== 'llm').length;
    const llm = graders.filter((g) => g === 'llm').length;
    assert(deterministic > 0, `${id}: no deterministic graders at all`);
    assert(deterministic >= llm * 2,
      `${id}: ${llm} llm grader(s) against only ${deterministic} deterministic - move what is checkable into a regex`);

    // Three runs, so a flapping judge is visible as a spread rather than a
    // single verdict that happens to land.
    const runs = Number(yaml.match(/^runs:\s*(\d+)/m)?.[1] ?? 0);
    eq(runs, 3, `${id}: runs should be 3 for a generation or icon case`);

    if (llm) judged.push(id);
  }
  assert(judged.length > 0, 'no generation or icon case kept an llm grader; the judgement calls were lost');

  // The runner must not flatten those three runs. It once forwarded its own
  // default of 1 on every call, which overrode every case's `runs:`.
  const sh = readFileSync(join(ROOT, 'scripts', 'eval.sh'), 'utf8');
  const forwarded = sh.split('\n').filter((l) => l.includes('--runs "$RUNS"'));
  assert(forwarded.length > 0, 'scripts/eval.sh no longer forwards --runs at all');
  for (const line of forwarded) {
    assert(/\[\s*-n\s+"\$RUNS"\s*\]/.test(line),
      `scripts/eval.sh forwards --runs unconditionally, overriding every case's runs: ${line.trim()}`);
  }
});

// The seven report headings were one sentence carrying seven bold names through
// nine lines of interleaved parentheticals, and about a third of runs dropped,
// merged or renamed one: `Deviations` missing, `Design notes` in its place, or
// `Validation & Rendering` standing for two. The list is now written out bare
// before the qualifications, so it can be copied rather than extracted (#208).
// The names are read back out of the skills here, not repeated, so moving one
// moves the check with it.
test('both skills list their report headings bare, and the evals check that list (#208)', () => {
  const bare = /^\s*\*\*File\*\*(?: · \*\*\w+\*\*)+\s*$/;
  const headingsOf = (engine) => {
    const line = readFileSync(join(ROOT, 'skills', engine, 'SKILL.md'), 'utf8')
      .split('\n').find((l) => bare.test(l));
    assert(line, `${engine}: SKILL.md no longer writes its report headings out as a bare list`);
    return [...line.matchAll(/\*\*(\w+)\*\*/g)].map((m) => m[1]);
  };
  const expected = ['File', 'Engine', 'Assumptions', 'Icons', 'Validation', 'Render', 'Deviations'];
  const listed = {};
  for (const engine of ['arkitect-drawio', 'arkitect-excalidraw']) {
    listed[engine] = headingsOf(engine);
    eq(listed[engine].join(' · '), expected.join(' · '), `${engine}: the report headings, in order`);
    // The list is the thing to copy, so the qualifications must come after it.
    const skill = readFileSync(join(ROOT, 'skills', engine, 'SKILL.md'), 'utf8');
    const lines = skill.split('\n');
    const at = lines.findIndex((l) => bare.test(l));
    assert(/\*\*Report\*\*|\*\*Report\.\*\*/.test(lines.slice(Math.max(0, at - 4), at).join(' ')),
      `${engine}: the bare list is not in the report step`);
  }

  // Each generation case checks a subset of the same names - every one but
  // Engine, which is required only where the user named no engine and has its
  // own grader there. A name the skills stopped listing would go unchecked.
  let cases = 0;
  for (const { id, dir } of evalCases()) {
    const yaml = readFileSync(join(dir, 'case.yaml'), 'utf8');
    const grader = yaml.match(/name: reports-under-every-heading[\s\S]*?pattern: '([^']+)'/);
    if (!grader) continue;
    cases++;
    const engine = id.startsWith('evals/drawio') ? 'arkitect-drawio' : 'arkitect-excalidraw';
    const required = [...grader[1].matchAll(/\\\*\\\*(\w+)\\b/g)].map((m) => m[1]);
    assert(required.length > 0, `${id}: the heading grader names no headings`);
    for (const name of required) {
      assert(listed[engine].includes(name), `${id} requires a "${name}" heading that ${engine} no longer lists`);
    }
    for (const name of listed[engine]) {
      if (name === 'Engine') continue;
      assert(required.includes(name), `${id} does not check the "${name}" heading that ${engine} promises`);
    }
  }
  assert(cases > 0, 'no eval case checks the report headings any more');
});

// "Render it and actually look at it" is required by both skills and was the
// one step no eval could observe: every case watched the renderer being called
// and none read what came out, so a layout regression scored 1.00 like anything
// else. No PNG can be made inside the eval sandbox, but `--format svg` needs no
// browser and writes text a grader can read, so at least one case reads one
// (#136). The evidence for what does and does not render lives in the README,
// because the next person to find an empty renders directory needs it.
test('an eval case reads a render the run produced (#136)', () => {
  const reading = [];
  for (const { id, dir } of evalCases()) {
    const yaml = readFileSync(join(dir, 'case.yaml'), 'utf8').replace(/\r\n/g, '\n');
    for (const [, kind, path] of yaml.matchAll(/^\s*(?:-\s*type:\s*(file_exists)[\s\S]*?^\s*path:\s*(\S+))/gm)) {
      if (/\.(?:svg|png)$/i.test(path)) reading.push(`${id} (${kind} ${path})`);
    }
    for (const [, path] of yaml.matchAll(/source:\s*file,\s*path:\s*(\S+?)\s*\}/g)) {
      if (/\.(?:svg|png)$/i.test(path)) reading.push(`${id} (regex ${path})`);
    }
  }
  assert(reading.length > 0,
    'no eval case reads a rendered .svg or .png, so the render step is unobserved again');

  const readme = readFileSync(join(ROOT, 'evals', 'README.md'), 'utf8');
  assert(readme.includes('What renders inside the sandbox'),
    'evals/README.md no longer records what renders inside a run, and what does not');
  assert(readme.includes('socket() failed'),
    'evals/README.md no longer names the failure that rules a PNG out of an eval run');
});

// evals/README.md counts the cases in prose and lists every one of them. Both
// go stale the moment a case is added, and a reader has no way to tell, so they
// are checked the way every other count a doc quotes is (#78, #177).
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen'];

test('evals/README.md counts and lists exactly the cases that exist (#177)', () => {
  const cases = evalCases();
  // A Windows clone checks this out with CRLF, and the tree is matched by line.
  const readme = readFileSync(join(ROOT, 'evals', 'README.md'), 'utf8').replace(/\r\n/g, '\n');

  const perEngine = new Map();
  for (const { id } of cases) {
    const engine = id.split('/')[1];
    perEngine.set(engine, (perEngine.get(engine) ?? 0) + 1);
  }
  assert(perEngine.size > 0, 'no eval engines were found');

  // The opening line names each engine's count separately. It used to say "for
  // each engine" and this test held the two equal, which was a coincidence
  // dressed as a rule - Draw.io carries the editing case, Excalidraw the
  // Mermaid and placeholder ones, and they have never mirrored each other case
  // for case. #201 needed a seventh on one side, and a number that has to stay
  // even is a reason not to cover something. The staleness guard is unchanged:
  // every number is still checked against the directories that exist.
  const quoted = readme.match(/^(\w+) cases, (\w+) for Draw\.io and (\w+) for Excalidraw/mi);
  assert(quoted, 'evals/README.md no longer opens with "<N> cases, <A> for Draw.io and <B> for Excalidraw"');
  const total = NUMBER_WORDS[cases.length];
  assert(total, `${cases.length} cases is past the words this test knows`);
  eq(quoted[1].toLowerCase(), total,
    `evals/README.md says ${quoted[1]} cases; there are ${cases.length}, so write ${total}`);

  for (const [i, engine] of ['drawio', 'excalidraw'].entries()) {
    const n = perEngine.get(engine) ?? 0;
    eq(quoted[i + 2].toLowerCase(), NUMBER_WORDS[n],
      `evals/README.md says ${quoted[i + 2]} for ${engine}; there are ${n}`);
  }

  // The tree lists each directory by name, once, and nothing that is not there.
  const tree = readme.slice(readme.indexOf('evals/\n'), readme.indexOf('```', readme.indexOf('evals/\n')));
  assert(tree.includes('drawio/'), 'the case tree in evals/README.md was not found');
  for (const { id } of cases) {
    const name = id.split('/')[2];
    assert(new RegExp(`^\\s+${name}/`, 'm').test(tree), `evals/README.md's tree does not list ${id}`);
  }
  const listed = [...tree.matchAll(/^\s{4}([a-z0-9-]+)\/\s{2,}/gm)].map((m) => m[1]);
  eq(listed.length, cases.length, `the tree lists ${listed.length} cases but ${cases.length} exist`);
  for (const name of listed) {
    assert(cases.some(({ id }) => id.endsWith(`/${name}`)), `evals/README.md's tree lists ${name}, which does not exist`);
  }
});

// The default drawing path has to fit a small model's window before it has read
// the user's architecture (#113): SKILL.md plus the one pattern section it sends
// the agent to, measured in bytes. Everything else sits behind a named condition.
const CONTEXT_BUDGET = 12000;
const skillReading = (engine) => {
  const dir = join(ROOT, 'skills', engine);
  const skill = readFileSync(join(dir, 'SKILL.md'), 'utf8');
  const catalog = readFileSync(join(dir, 'references', 'pattern-catalog.md'), 'utf8');
  const sections = new Map(catalog.split(/\n(?=## \d+\.)/).slice(1)
    .map((s) => [Number(s.match(/^## (\d+)\./)[1]), Buffer.byteLength(s.split(/\n(?=# )/)[0])]));
  return { dir, skill, sections, skillBytes: Buffer.byteLength(skill), largest: Math.max(...sections.values()) };
};

test('each drawing skill reads at most 12,000 bytes before its example, and names one path per task (#113)', () => {
  const measured = [];
  for (const [engine, mustKeep] of [
    ['arkitect-drawio', ['open_drawio_xml', 'confident', 'Never** use a different product', 'validate-only', '--print-style', 'scripts/backup.mjs', 'No hosted-editor URL', 'no link to the hosted editor', 'never overrides a stated', '**Engine**']],
    ['arkitect-excalidraw', ['Never read a whole existing scene', 'placeholder', 'never** use one product', '--format svg', '--print-style', 'scripts/backup.mjs', 'never overrides a stated', '**Engine**']],
  ]) {
    const { dir, skill, sections, skillBytes, largest } = skillReading(engine);
    measured.push(`${engine} ${skillBytes} + ${largest} = ${skillBytes + largest}`);
    assert(skillBytes + largest <= CONTEXT_BUDGET,
      `${engine}: SKILL.md (${skillBytes}) plus its largest pattern (${largest}) is over ${CONTEXT_BUDGET} bytes`);

    // Every file the reading table or the workflow names exists.
    for (const [, path] of skill.matchAll(/`((?:references|assets\/templates)\/[\w./-]+)`/g)) {
      assert(existsSync(join(dir, path)), `${engine}: SKILL.md names ${path}, which does not exist`);
    }
    for (const path of ['references/editing.md', 'references/icons.md', 'references/rendering.md', 'references/style-guide.md']) {
      assert(skill.includes(`\`${path}\``), `${engine}: SKILL.md has no reading path to ${path}`);
    }
    // The selector offers exactly the patterns the catalog has, as table rows or
    // as a "1 pipeline · 2 ..." list (#137).
    const selector = skill.slice(skill.indexOf('pattern-catalog.md`:'), skill.indexOf('Spec fragments'));
    const entry = selector.includes('|') ? /\|\s*(\d+)\s*\|/g : /(?:^|·)[ \t]*(\d+) (?=[a-z])/gm;
    const offered = [...selector.matchAll(entry)].map((m) => Number(m[1])).sort((a, b) => a - b);
    eq(offered.join(','), [...sections.keys()].sort((a, b) => a - b).join(','), `${engine}: selector rows vs catalog sections`);
    for (const rule of mustKeep) assert(skill.includes(rule), `${engine}: SKILL.md no longer says "${rule}"`);
  }
  console.log(`      (context budget: ${measured.join('; ')})`);
});

// docs/maintenance.md quotes the same measured SKILL.md + largest-pattern totals (#161).
test('docs/maintenance.md skill-budget table matches measured context budgets (#161)', () => {
  const md = readFileSync(join(ROOT, 'docs', 'maintenance.md'), 'utf8');
  for (const engine of ['arkitect-drawio', 'arkitect-excalidraw']) {
    const { skillBytes, largest } = skillReading(engine);
    const total = skillBytes + largest;
    const row = md.match(new RegExp('`' + engine + '`\\s*\\|\\s*([\\d,]+)\\s*\\|\\s*([\\d,]+)\\s*\\|\\s*([\\d,]+)'));
    assert(row, `docs/maintenance.md missing budget row for ${engine}`);
    const got = row.slice(1).map((s) => Number(s.replace(/,/g, '')));
    eq(got.join(','), [skillBytes, largest, total].join(','),
      `docs/maintenance.md ${engine} budget table`);
  }
});

// A committed example must build the same on every machine, so a documented
// command that rebuilds a template passes --defaults. Without it, a maintainer's
// personal style override would end up in the repository (#89, #90).
test('every documented rebuild of a committed template passes --defaults, in both engines (#89, #90)', () => {
  const offenders = [];
  const seen = { drawio: 0, excalidraw: 0 };
  for (const f of FILES) {
    // Inside an engine's own skills a bare build-diagram.mjs is that engine's builder.
    const skill = /skills[\\/](?:arkitect-(drawio|excalidraw)|(?:learn|apply)-(drawio|excalidraw)-style)[\\/]/.exec(f);
    const skillEngine = skill ? skill[1] ?? skill[2] : null;
    // A command continued over lines reads as one.
    const text = readFileSync(f, 'utf8').replace(/[ \t]*[\\`]\r?\n[ \t]*/g, ' ');
    for (const line of text.split('\n')) {
      if (!/assets\/templates\/[^\s"'`]*\.spec\.json/.test(line)) continue;
      for (const engine of Object.keys(seen)) {
        const build = new RegExp(`\\b${engine} build\\b|arkitect-${engine}/scripts/build-diagram\\.mjs`).test(line)
          || (skillEngine === engine && /build-diagram\.mjs/.test(line));
        if (!build) continue;
        seen[engine]++;
        if (!line.includes('--defaults')) offenders.push(`${relative(ROOT, f)} (${engine}): ${line.trim().slice(0, 140)}`);
      }
    }
  }
  for (const [engine, n] of Object.entries(seen)) {
    assert(n > 0, `found no documented ${engine} template rebuild at all - the check has lost its teeth`);
  }
  assert(!offenders.length, `rebuilds without --defaults:\n        ${offenders.join('\n        ')}`);
});

test('the agent contract states the rules an agent must not get wrong', () => {
  const md = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  for (const rule of ['open_drawio_xml', 'placeholder', 'never', 'bin/arkitect.mjs']) {
    assert(md.toLowerCase().includes(rule.toLowerCase()), `AGENTS.md does not mention ${rule}`);
  }
  assert(md.includes('.drawio') && md.includes('.excalidraw'), 'AGENTS.md does not name both formats');
});

// -------------------------------------------------------------- hygiene

test('no committed file carries an absolute path from someone machine', () => {
  const patterns = [/C:[\\/]Users[\\/]/i, /\/home\/[a-z][a-z0-9_-]+\//, /\/Users\/[a-z][a-z0-9_-]+\//i];
  const hits = [];
  for (const f of FILES) {
    const s = readFileSync(f, 'utf8');
    for (const re of patterns) {
      // The docs legitimately show Windows install locations under Program Files
      // and a placeholder home; only a real user directory is a problem.
      const m = s.match(re);
      if (m && !/C:\\path\\to|\/path\/to|\$env:USERPROFILE|~\//.test(m.input.slice(Math.max(0, m.index - 20), m.index + 40))) {
        hits.push(`${relative(ROOT, f)}: ${m[0]}`);
      }
    }
  }
  assert(hits.length === 0, `absolute user paths committed:\n        ${hits.slice(0, 10).join('\n        ')}`);
});

test('no file still refers to a pre-merge project name', () => {
  // Assembled at runtime so this check does not trip over its own source.
  const legacy = [['aws', 'archkit'], ['excali', 'archkit'], ['learn', 'architecture-example'],
    ['learn', 'excalidraw-example']].map((parts) => parts.join('-'));
  const hits = [];
  for (const f of FILES) {
    const s = readFileSync(f, 'utf8');
    for (const name of legacy) if (s.includes(name)) hits.push(`${relative(ROOT, f)}: ${name}`);
  }
  assert(hits.length === 0, `stale names:\n        ${hits.slice(0, 10).join('\n        ')}`);
});

test('every relative link in the docs resolves', () => {
  const broken = [];
  const docs = FILES.filter((f) => f.endsWith('.md') || f.endsWith('.mdc'));
  for (const f of docs) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\]\(([^)#\s]+)(#[^)\s]*)?\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const p = resolve(dirname(f), target);
      if (!existsSync(p)) broken.push(`${relative(ROOT, f)} -> ${target}`);
    }
  }
  assert(broken.length === 0, `broken links:\n        ${broken.slice(0, 15).join('\n        ')}`);
});

// A library folder was skipped whole, so a dead link in its README went unseen (#87).
test('the docs checks read our own Markdown inside library folders, and none of the library payloads (#87)', () => {
  const scanned = FILES.map((f) => relative(ROOT, f).split(sep).join('/'));
  for (const doc of ['skills/arkitect-excalidraw/assets/libraries/README.md',
    'skills/arkitect-excalidraw/assets/libraries/bundled/ATTRIBUTION.md',
    'skills/arkitect-drawio/assets/libraries/ATTRIBUTION.md']) {
    assert(scanned.includes(doc), `${doc} is not scanned, so its links go unchecked`);
  }
  const payloads = scanned.filter((f) => /(?:^|\/)(?:libraries|bundled)\//.test(f) && !MARKDOWN.test(f));
  assert(!payloads.length, `library payloads are scanned:\n        ${payloads.slice(0, 10).join('\n        ')}`);
});

test('the README shows images that are actually committed', () => {
  const s = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const imgs = [...s.matchAll(/<img src="([^"]+)"/g), ...s.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)]
    .map((m) => m[1]).filter((p) => !/^https?:/.test(p));
  assert(imgs.length >= 2, 'the README should show what the output looks like');
  for (const p of imgs) assert(existsSync(join(ROOT, p)), `README image missing: ${p}`);
});

test('the licence and attribution files are present and name their sources', () => {
  assert(readFileSync(join(ROOT, 'LICENSE'), 'utf8').includes('MIT License'), 'LICENSE');
  const notice = readFileSync(join(ROOT, 'NOTICE'), 'utf8');
  for (const source of ['AWS Architecture Icons', 'Azure architecture icons', 'Google Cloud icons',
    'simple-icons', 'devicon', 'lucide-static', 'octicons',
    'libraries.excalidraw.com', 'Trademark']) {
    assert(notice.includes(source), `NOTICE does not cover ${source}`);
  }
  // A vendor permission is not a licence, and the distinction has to survive edits.
  assert(notice.includes('PERMISSIONS, not licences'),
    'NOTICE must distinguish vendor permissions from licences');
  assert(notice.includes('NOT A LICENCE ON A TRADEMARK'),
    'NOTICE must say a CC0 icon is not a trademark licence');
  const attribution = readFileSync(
    join(ROOT, 'skills', 'arkitect-excalidraw', 'assets', 'libraries', 'bundled', 'ATTRIBUTION.md'), 'utf8');
  assert(attribution.split('\n').filter((l) => l.startsWith('| `')).length >= 30, 'library authors are not credited');

  // The Draw.io packs carry their own generated attribution, one row per source.
  const packs = readFileSync(
    join(ROOT, 'skills', 'arkitect-drawio', 'assets', 'libraries', 'ATTRIBUTION.md'), 'utf8');
  for (const source of ['simple-icons@16.30.0', 'devicon@2.17.0', 'lucide-static@1.45.0',
    '@primer/octicons@19.36.0', 'azure-v24', 'gcp-legacy']) {
    assert(packs.includes(source), `pack attribution does not name ${source}`);
  }
  assert(packs.includes('nominative use'), 'pack attribution must state the trademark position');
});

test('gitignore keeps derived and third-party material out of the repository', () => {
  const gi = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  for (const rule of ['.analysis/', 'tests/output/', 'sensitive-tokens', 'assets/logos/', 'assets/icons/']) {
    assert(gi.includes(rule), `.gitignore does not cover ${rule}`);
  }
  assert(gi.includes('!skills/arkitect-excalidraw/assets/libraries/bundled/'),
    'the bundled libraries must stay committed - they are the offline icon source');
});

// An ignore rule does not untrack what is already committed. The rule that
// excludes the review contact sheets landed first, and a later commit about
// something else force-added 12 of them anyway: 6.3 MB that .gitignore,
// package.json and two docs all described as not being in the repository.
test('nothing git tracks is a file gitignore excludes', () => {
  const both = trackedButIgnored(ROOT);
  if (both === null) return 'skip'; // no checkout to ask
  assert(both.length === 0,
    'tracked although gitignored - either git rm --cached them or drop the rule:\n        '
    + both.slice(0, 15).join('\n        '));
});

// -------------------------------------------------------- conflict markers
//
// A hand resolution of a merge conflict can leave a marker behind with
// nothing to catch it.

const CONFLICT_MARKER = /^(?:<{7}|\|{7}|>{7})(?:[ \r]|$)/m;
const MARK = (c) => c.repeat(7);

test('no tracked text file carries a merge conflict marker', () => {
  const hits = [];
  for (const f of FILES) {
    const s = readFileSync(f, 'utf8');
    const m = CONFLICT_MARKER.exec(s);
    if (m) hits.push(`${relative(ROOT, f)}:${s.slice(0, m.index).split('\n').length}`);
  }
  assert(hits.length === 0, `conflict markers left in:\n        ${hits.slice(0, 10).join('\n        ')}`);
  for (const c of ['<', '|', '>']) {
    assert(CONFLICT_MARKER.test(`kept\n${MARK(c)} origin/main\nkept\n`), `a ${MARK(c)} line is not caught`);
    assert(CONFLICT_MARKER.test(`kept\r\n${MARK(c)}\r\n`), `a bare CRLF ${MARK(c)} line is not caught`);
  }
  assert(!CONFLICT_MARKER.test(`Title\n${MARK('=')}\n\n  ${MARK('<')} indented\n`),
    'a heading underline or an indented run is not a conflict');
});

// ------------------------------------------------------ the quoted count (#47)
//
// The fresh-clone count was written by hand in four files and drifted twice. It
// is quoted once, in docs/testing.md, and run-tests.mjs checks it.

const countGuard = await import(pathToFileURL(join(ROOT, 'tests', 'count-guard.mjs')).href);

test('the documented fresh-clone count is checked against what ran (#47)', () => {
  const clean = { pass: 186, fail: 0, skip: 7 };
  const check = (documented, totals, sourceDependent, sourcesPresent) => countGuard.checkCounts({ documented, totals, sourceDependent, sourcesPresent });

  let r = check({ passed: 186, skipped: 7 }, clean, 7, false);
  eq(r.problems.join('; '), '', 'a matching quote on a clean clone passes');
  eq(JSON.stringify(r.expected), JSON.stringify({ passed: 186, skipped: 7 }), 'and the expectation is that quote');

  r = check({ passed: 186, skipped: 7 }, { pass: 190, fail: 0, skip: 3 }, 7, true);
  eq(r.problems.join('; '), '', 'the same quote holds on a checkout where local sources run four of the seven');
  eq(JSON.stringify(r.expected), JSON.stringify({ passed: 186, skipped: 7 }), 'which still expects the fresh-clone numbers');

  // The drift of #30: numbers copied from a checkout with sources present.
  r = check({ passed: 190, skipped: 3 }, clean, 7, false);
  assert(r.problems.some((p) => p.includes('3 skipped but 7 tests need local sources') && p.includes('`186 passed, 0 failed, 7 skipped`')),
    `copied local numbers are caught: ${r.problems.join('; ')}`);

  // A test added without updating the quote.
  r = check({ passed: 186, skipped: 7 }, { pass: 187, fail: 0, skip: 7 }, 7, false);
  assert(r.problems.some((p) => p.includes('quotes 193 tests') && p.includes('194 ran') && p.includes('`187 passed, 0 failed, 7 skipped`')),
    `an added test is caught: ${r.problems.join('; ')}`);

  // A test that skips on a clean clone without being declared.
  r = check({ passed: 185, skipped: 8 }, { pass: 185, fail: 0, skip: 8 }, 7, false);
  assert(r.problems.some((p) => p.includes('8 tests skipped') && p.includes('only 7 are marked')), `an undeclared skip is caught: ${r.problems.join('; ')}`);

  assert(check(null, clean, 7, false).problems.some((p) => p.includes('has no')), 'a missing quote is caught');
  assert(countGuard.documentedCount(readFileSync(join(ROOT, 'docs', 'testing.md'), 'utf8')), 'docs/testing.md states the fresh-clone count in a line the runner reads');
});

test('the count is quoted only in docs/testing.md, and no doc claims an unmeasured runtime (#47)', () => {
  const hits = [];
  for (const f of FILES.filter((p) => p.endsWith('.md'))) {
    const rel = relative(ROOT, f).split(sep).join('/');
    if (rel === 'CHANGELOG.md') continue;
    const s = readFileSync(f, 'utf8');
    if (rel !== 'docs/testing.md' && /\b\d+ passed, \d+ failed, \d+ skipped\b/.test(s)) hits.push(`${rel}: quotes a test count; link to docs/testing.md instead`);
    if (/~\s?2\s?s\b|couple of seconds|roughly two seconds/i.test(s)) hits.push(`${rel}: claims a runtime nobody measured`);
  }
  assert(hits.length === 0, hits.join('\n        '));
});

// ------------------------------------------------------ the npm package (#38)
//
// What npm publishes is decided by `files` in package.json, not by .gitignore,
// so local caches and a browser profile left under skills/ used to ride along.
// These tests pack the real tarball with a sentinel planted in every place that
// must stay local, read it back, and run the CLI from the extracted copy,
// outside this checkout.

// Local, generated or third-party material. None of it may ship.
const LOCAL_ONLY = [
  /^skills\/arkitect-drawio\/\.cache\//,
  /^skills\/arkitect-drawio\/assets\/logos\/(?!README\.md$)/,
  /^skills\/arkitect-drawio\/assets\/libraries\/contact-sheets\/(?:\.shot\/|review\/|[^/]+\.html$)/,
  /^skills\/arkitect-excalidraw\/assets\/icons\/(?!README\.md$)/,
  /^skills\/arkitect-excalidraw\/assets\/libraries\/(?!README\.md$|bundled\/)/,
  /^skills\/arkitect-excalidraw\/assets\/libraries\/bundled\/sheets\/[^/]+\.(?:excalidraw|svg)$/,
  /\.backup-/,
  /(?:^|\/)(?:\.DS_Store|Thumbs\.db|desktop\.ini)$|\.log$/,
];
const isLocalOnly = (p) => LOCAL_ONLY.some((re) => re.test(p));

// One file in each of those places, named so a leftover is obvious.
const SENTINELS = [
  'skills/arkitect-drawio/.cache/zz-test-sentinel.tgz',
  'skills/arkitect-drawio/assets/logos/zz-test-sentinel.png',
  'skills/arkitect-drawio/assets/libraries/contact-sheets/.shot/zz-test-sentinel',
  'skills/arkitect-drawio/assets/libraries/contact-sheets/zz-test-sentinel.html',
  'skills/arkitect-drawio/assets/libraries/contact-sheets/review/zz-test-sentinel.png',
  'skills/arkitect-excalidraw/assets/icons/zz-test-sentinel.excalidrawlib',
  'skills/arkitect-excalidraw/assets/libraries/zz-test-sentinel.excalidrawlib',
  'skills/arkitect-excalidraw/assets/libraries/bundled/sheets/zz-test-sentinel.svg',
  'skills/arkitect-drawio/assets/templates/zz-test-sentinel.backup-20260101-000000.drawio',
];

// What the package is for: the CLI, the skills and their bundled assets.
const PACKAGE_DIRS = ['bin', 'skills', '.claude-plugin', 'docker', 'docs'];
const PACKAGE_ROOT_FILES = ['package.json', 'AGENTS.md', 'CHANGELOG.md', 'README.md', 'LICENSE', 'NOTICE'];
// Today's package unpacks to about 47 MB; a stray archive or cache blows past this.
const PACKAGE_CEILING = 60 * 1024 * 1024;

// npm ships beside node. Calling its script directly needs no shell on Windows.
const npmCli = [
  join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
].find(existsSync) ?? null;

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(relative(ROOT, p).split(sep).join('/'));
  }
  return acc;
}

// A .tgz read with no dependency: gunzip, then ustar headers, honouring the pax
// `path` record node-tar writes for a name that does not fit the header.
function readTarball(file) {
  const buf = gunzipSync(readFileSync(file));
  const entries = [];
  let paxPath = null;
  for (let off = 0; off + 512 <= buf.length;) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const field = (from, to) => header.subarray(from, to).toString('utf8').replace(/\0[\s\S]*$/, '');
    const size = parseInt(field(124, 136).trim() || '0', 8);
    const type = field(156, 157) || '0';
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') { paxPath = body.toString('utf8').match(/^\d+ path=(.*)$/m)?.[1] ?? null; continue; }
    if (type === 'g') continue;
    const prefix = field(345, 500);
    const path = paxPath ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    paxPath = null;
    if (type === '0') entries.push({ path, bytes: body });
  }
  return entries;
}

function packInfo(stdout) {
  const parsed = JSON.parse(stdout);
  // npm <= 11 returns an array; npm 12 keys results by package name.
  const entries = Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === 'object' ? Object.values(parsed) : [];
  assert(entries.length === 1, 'npm pack must return exactly one package');
  const [info] = entries;
  assert(info && typeof info.filename === 'string'
    && /^[^/\\\\]+\.tgz$/.test(info.filename), 'npm pack must return a tarball basename');
  return info;
}

function packAndExtract() {
  // The real path: on macOS the temp directory is a symlink into /private, and
  // Node resolves the CLI's own location through it.
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'arkitect-pack-')));
  const planted = [];
  try {
    for (const rel of SENTINELS) {
      const file = join(ROOT, ...rel.split('/'));
      // Remember the outermost directory this creates, so cleanup removes only
      // what the test added and never a real cache that was already there.
      let created = null;
      for (let d = dirname(file); !existsSync(d); d = dirname(d)) created = d;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, 'arkitect packaging sentinel - must never be published\n');
      planted.push(created ?? file);
    }
    const r = spawnSync(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', tmp],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`npm pack exited ${r.status}: ${(r.stderr || r.error?.message || '').trim().slice(-400)}`);
    const info = packInfo(r.stdout);
    const entries = readTarball(join(tmp, info.filename));
    for (const e of entries) {
      assert(e.path.startsWith('package/') && !e.path.split('/').includes('..'), `unexpected tarball entry ${e.path}`);
      const out = join(tmp, ...e.path.split('/'));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, e.bytes);
    }
    return {
      tmp,
      root: join(tmp, 'package'),
      files: entries.map((e) => e.path.slice('package/'.length)),
      bytes: entries.reduce((n, e) => n + e.bytes.length, 0),
    };
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true });
    throw error;
  } finally {
    for (const p of planted.reverse()) rmSync(p, { recursive: true, force: true });
  }
}

let packResult = null;
function packOnce() {
  if (!packResult) {
    try { packResult = { value: packAndExtract() }; } catch (error) { packResult = { error }; }
  }
  if (packResult.error) throw packResult.error;
  return packResult.value;
}

test('the npm package ships the bundled assets and nothing local (#38)', () => {
  const info = { filename: 'arkitect-1.1.0.tgz' };
  eq(packInfo(JSON.stringify([info])).filename, info.filename, 'npm array output');
  eq(packInfo(JSON.stringify({ arkitect: info })).filename, info.filename, 'npm 12 keyed output');
  for (const invalid of [null, [], {}, [info, info], { a: info, b: info }, [{}], [null], [{ filename: '../escape.tgz' }]]) {
    let rejected = false;
    try { packInfo(JSON.stringify(invalid)); } catch { rejected = true; }
    assert(rejected, `accepted malformed or ambiguous npm pack output: ${JSON.stringify(invalid)}`);
  }
  if (!npmCli) { console.log('      (npm was not found beside node)'); return 'skip'; }
  for (const s of SENTINELS) assert(isLocalOnly(s), `sentinel ${s} is not in a local-only location`);
  const { files, bytes } = packOnce();

  const leaked = files.filter(isLocalOnly);
  assert(!leaked.length, `local-only files in the package:\n        ${leaked.slice(0, 10).join('\n        ')}`);
  for (const dir of ['tests', 'evals', '.github', '.analysis']) {
    assert(!files.some((f) => f.startsWith(`${dir}/`)), `${dir}/ is in the package`);
  }

  const shipped = new Set(files);
  const expected = [...PACKAGE_DIRS.flatMap((d) => walk(join(ROOT, d))), ...PACKAGE_ROOT_FILES].filter((f) => !isLocalOnly(f));
  const missing = expected.filter((f) => !shipped.has(f));
  assert(!missing.length, `missing from the package:\n        ${missing.slice(0, 10).join('\n        ')}`);
  for (const f of ['bin/arkitect.mjs', '.claude-plugin/plugin.json', 'skills/arkitect-drawio/references/icon-catalog.json',
    'skills/arkitect-drawio/assets/libraries/ATTRIBUTION.md', 'skills/arkitect-excalidraw/assets/libraries/bundled/index.json',
    'skills/arkitect-excalidraw/assets/libraries/bundled/ATTRIBUTION.md', 'LICENSE', 'NOTICE']) {
    assert(shipped.has(f), `${f} is not in the package`);
  }
  assert(bytes < PACKAGE_CEILING, `the package unpacks to ${bytes} bytes, over the ${PACKAGE_CEILING} ceiling`);
});

// scripts/eval.sh is the supported way to run the eval suite, and the only
// place the WSL and Docker Desktop workarounds are written down. Neither is
// exercised here - a real run costs money and needs a sandbox - so what a test
// can hold is that the script parses, that its options and its --help agree,
// and that the README still points at it (#134).
test('scripts/eval.sh parses, and its options match its help and the README (#134)', () => {
  const sh = readFileSync(join(ROOT, 'scripts', 'eval.sh'), 'utf8');
  assert(!sh.includes('\r'), 'scripts/eval.sh has CRLF line endings; it is run by bash');
  assert(sh.startsWith('#!'), 'scripts/eval.sh has no shebang');

  // Every long option the argument loop accepts, and every one --help prints.
  const accepted = new Set();
  for (const m of sh.matchAll(/^\s{4}(-[^)]*)\)/gm)) {
    for (const opt of m[1].split('|')) {
      const name = opt.trim();
      if (name.startsWith('--') && name !== '--') accepted.add(name);
    }
  }
  assert(accepted.size >= 8, `only found ${accepted.size} options in the argument loop`);

  const usage = sh.slice(sh.indexOf("cat <<'USAGE'"), sh.indexOf('USAGE\n}'));
  for (const opt of accepted) {
    assert(usage.includes(opt), `scripts/eval.sh accepts ${opt} but --help does not list it`);
  }
  for (const required of ['--tag', '--runs', '--model', '--check', '--max-cost-usd']) {
    assert(accepted.has(required), `scripts/eval.sh no longer accepts ${required}`);
  }

  // The refusals that make the script worth having, rather than a bare command.
  assert(/Windows sandbox is not active/.test(sh), 'the Windows refusal no longer explains itself');
  assert(/DOCKER_CONFIG/.test(sh) && /isolated HOME|SANDBOX_HOME/.test(sh),
    'the Docker Desktop workaround is gone from scripts/eval.sh');

  const readme = readFileSync(join(ROOT, 'evals', 'README.md'), 'utf8');
  assert(readme.includes('scripts/eval.sh'), 'evals/README.md no longer points at scripts/eval.sh');
  for (const prereq of ['bubblewrap', 'socat', 'DOCKER_CONFIG']) {
    assert(readme.includes(prereq), `evals/README.md no longer names ${prereq}`);
  }

  // bash -n is a parse, not a run: nothing in the script executes.
  const bash = spawnSync('bash', ['-n', join(ROOT, 'scripts', 'eval.sh')], { encoding: 'utf8' });
  if (bash.error) { console.log('      (bash was not found, so the parse check was skipped)'); return 'skip'; }
  eq(bash.status, 0, `bash rejected scripts/eval.sh: ${(bash.stderr || '').trim().slice(0, 200)}`);
});

// A .sh authored on Windows is recorded 0644 by default, and the working-tree
// mode says nothing on Windows - only the mode git stores travels to a clone.
// evals/README.md documents `scripts/eval.sh` as a command, so it has to be one
// (#181). The scaffolds are run through bash by the eval runner rather than
// executed, so their mode is consistency, not correctness.
test('every committed .sh keeps its executable bit (#181)', () => {
  let out;
  try {
    out = execFileSync('git', ['-C', ROOT, 'ls-files', '-s', '--', '*.sh'], { encoding: 'utf8' });
  } catch {
    console.log('      (git was not available)');
    return 'skip';
  }
  const rows = out.split('\n').filter(Boolean).map((line) => {
    const [mode, , , ...rest] = line.replace('\t', ' ').split(/\s+/);
    return { mode, path: rest.join(' ') };
  });
  assert(rows.length > 0, 'git tracks no .sh files at all');
  assert(rows.some((r) => r.path === 'scripts/eval.sh'), 'scripts/eval.sh is no longer tracked');
  const plain = rows.filter((r) => r.mode !== '100755');
  assert(!plain.length,
    `these are committed non-executable; run git update-index --chmod=+x on each:\n        ${plain.map((r) => `${r.mode} ${r.path}`).join('\n        ')}`);
});

test('the eval summary reports every case and gates on the low ones (#134)', () => {
  const summary = join(ROOT, 'scripts', 'eval-summary.mjs');
  const run = (json) => {
    mkdirSync(TMP, { recursive: true });
    const file = join(TMP, 'eval-result.json');
    writeFileSync(file, JSON.stringify(json));
    return spawnSync(process.execPath, [summary, file], { encoding: 'utf8' });
  };
  const graded = (name, score, failed = []) => ({
    name,
    arms: { with: [{ score, graders: [{ name: 'ran', passed: true }, ...failed.map((f) => ({ name: f, passed: false, explanation: 'judge votes: FAIL' }))] }] },
  });

  const clean = run({
    durationSeconds: 12, costUsd: 0.5, suite: { modelOverride: 'haiku', judgeModel: 'sonnet' },
    cases: [graded('a-case', 1), graded('b-case', 1)],
    aggregates: { casesTotal: 2, casesPassed: 2, overallScore: 1, overallPassRate: 1 },
  });
  eq(clean.status, 0, 'an all-green run should exit 0');
  for (const wanted of ['a-case', 'b-case', '$0.500', 'haiku', 'sonnet', 'overall 1.00']) {
    assert(clean.stdout.includes(wanted), `the summary omitted ${wanted}:\n${clean.stdout}`);
  }

  const mixed = run({
    durationSeconds: 30, costUsd: 1.25, suite: { modelOverride: 'haiku', judgeModel: 'sonnet' },
    cases: [graded('good-case', 1), graded('bad-case', 0.5, ['honest-report'])],
    aggregates: { casesTotal: 2, casesPassed: 2, overallScore: 0.75, overallPassRate: 0.5 },
  });
  eq(mixed.status, 1, 'a run with a case below 1 should exit 1, so it can gate');
  assert(mixed.stdout.includes('honest-report'), `the failing grader was not named:\n${mixed.stdout}`);
  assert(/ok\s+good-case/.test(mixed.stdout), `a passing case lost its ok marker:\n${mixed.stdout}`);

  // A case that never started is an error, not a score; it must not read as 0.
  const errored = run({
    cases: [{ name: 'broken-case', arms: { with: [{ score: 0, error: 'path "x" does not exist' }] } }],
    aggregates: { casesTotal: 1, casesPassed: 0, overallScore: 0, overallPassRate: 0 },
  });
  eq(errored.status, 1, 'an errored case should exit 1');
  assert(errored.stdout.includes('ERROR') && errored.stdout.includes('does not exist'),
    `an errored case was not reported as one:\n${errored.stdout}`);

  // What a session limit looks like: every run errored, yet not_contains
  // graders passed on the empty reply, so the tool scores it 0.17. That number
  // is not a score and must not be printed as one (#135).
  const limited = run({
    cases: [{ name: 'limited-case', arms: { with: [1, 2, 3].map(() => ({ score: 0.17, error: "exit 1: You've hit your session limit" })) } }],
    aggregates: { casesTotal: 1, casesPassed: 1, overallScore: 0.17, overallPassRate: 0 },
  });
  eq(limited.status, 1, 'a run where every case errored should exit 1');
  const caseLine = limited.stdout.split('\n').find((l) => l.includes('limited-case')) ?? '';
  assert(!caseLine.includes('0.17'), `an errored run was printed with a score: ${caseLine}`);
  assert(/3\/3 runs ERRORED/.test(limited.stdout), `the errored runs were not counted:\n${limited.stdout}`);

  const gone = spawnSync(process.execPath, [summary, join(TMP, 'no-such-result.json')], { encoding: 'utf8' });
  eq(gone.status, 2, 'a missing file should exit 2, not 1');
});

test('the packed CLI works from outside the checkout (#38)', () => {
  if (!npmCli) return 'skip';
  const { tmp, root } = packOnce();
  const run = (args) => spawnSync(process.execPath, [join(root, 'bin', 'arkitect.mjs'), ...args],
    { cwd: tmp, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const ok = (args) => {
    const r = run(args);
    eq(r.status, 0, `packed "arkitect ${args.join(' ')}" failed: ${(r.stderr || '').trim().slice(-300)}`);
    return r.stdout;
  };

  eq(ok(['version']).trim(), pkg.version, 'packed version');
  eq(realpathSync(ok(['where']).trim()), realpathSync(root), 'the packed CLI resolved a different root');
  const doctor = ok(['doctor']);
  for (const line of ['draw.io icon packs', 'draw.io AWS pack', 'draw.io icon catalog', 'excalidraw libraries', 'plugin manifest', 'agent contract']) {
    const row = doctor.split('\n').find((l) => l.includes(line));
    assert(row && row.startsWith('ok'), `packed doctor says: ${row?.trim() ?? `nothing about ${line}`}`);
  }
  assert(JSON.parse(ok(['drawio', 'icon', 'bedrock'])).matches?.length > 0, 'packed draw.io icon search found nothing');
  assert(JSON.parse(ok(['excalidraw', 'icon', 'postgres'])).matches?.length > 0, 'packed excalidraw icon search found nothing');
  for (const engine of ['drawio', 'excalidraw']) {
    const spec = join(root, 'skills', `arkitect-${engine}`, 'assets', 'templates', 'starter-architecture.spec.json');
    const out = join(tmp, `smoke.${engine}`);
    ok([engine, 'build', spec, '--out', out]);
    ok([engine, 'validate', out]);
  }

  const t = run(['test']);
  eq(t.status, 2, 'arkitect test outside a checkout');
  assert(t.stderr.includes('git checkout'), `arkitect test did not say why: ${t.stderr.trim()}`);
});

if (packResult?.value) rmSync(packResult.value.tmp, { recursive: true, force: true });

// ------------------------------------------------------------- releases (#88)

const release = await import(pathToFileURL(join(ROOT, 'scripts', 'release.mjs')).href);
const CL = `# Changelog\n\nPreamble.\n\n## [Unreleased]\n\n### Added\n\n- A thing (#1)\n- A longer thing that\n  wraps (#2)\n\n### Fixed\n\n- A bug\n\n## [1.1.0] — 2026-09-12\n\n### Added\n\n- Old thing\n`;
const EMPTY = CL.replace(/## \[Unreleased\][\s\S]*?(?=## \[1\.1\.0\])/, '## [Unreleased]\n\n### Added\n\n');

test('a release bumps the version, dates [Unreleased] verbatim and opens a fresh one (#88)', () => {
  eq(`${release.nextVersion('1.1.0', 'patch')} ${release.nextVersion('1.1.0', 'minor')} ${release.nextVersion('1.9.3', 'major')}`,
    '1.1.1 1.2.0 2.0.0', 'bumps');
  for (const bad of [['1.1', 'patch'], ['1.1.0', 'huge']]) {
    let threw = false; try { release.nextVersion(...bad); } catch { threw = true; }
    assert(threw, `nextVersion(${bad}) should refuse`);
  }
  const rolled = release.rollChangelog(CL, '1.2.0', '2026-09-16');
  assert(rolled.startsWith('# Changelog\n\nPreamble.\n\n## [Unreleased]\n\n## [1.2.0] — 2026-09-16\n'), 'fresh [Unreleased] above the dated section');
  eq(release.sectionFor(rolled, '1.2.0'), release.unreleasedBody(CL).trim(), 'the section is the old [Unreleased], word for word');
  assert(rolled.includes('## [1.1.0] — 2026-09-12\n\n### Added\n\n- Old thing'), 'older releases untouched');
  assert(release.isEmpty(rolled) && !release.isEmpty(CL), 'the new [Unreleased] is empty');
  assert(release.isEmpty(EMPTY), 'bare headings count as empty');
  const refuses = (fn, pattern, what) => {
    let err; try { fn(); } catch (e) { err = e; }
    assert(err && pattern.test(err.message), `${what}: ${err?.message ?? 'did not throw'}`);
  };
  refuses(() => release.rollChangelog(EMPTY, '1.2.0', '2026-09-16'), /no entries/, 'an empty release');
  refuses(() => release.rollChangelog(CL, '1.1.0', '2026-09-16'), /already has/, 'a version that exists');
  refuses(() => release.rollChangelog(CL, '1.2.0', 'today'), /ISO date/, 'a non-ISO date');
  eq(release.lastReleaseDate(CL), '2026-09-12', 'the first-run anchor');
});

// test() is synchronous: the model calls are settled first, asserted afterwards.
const goodDraft = '### Added\n\n- New command (#9)\n\n### Fixed\n\n- A crash on\n  empty input';
const draftMessages = release.draftMessages('Fix thing (#3)', '### Added\n\n- Example');
const sentToModel = [];
const modelOk = await settle(release.callModel({
  baseUrl: 'https://llm.example/v1/', model: 'm', apiKey: 'k', messages: draftMessages,
  fetchImpl: async (url, init) => {
    sentToModel.push({ url, init });
    return { ok: true, json: async () => ({ choices: [{ message: { content: `\`\`\`markdown\n${goodDraft}\n\`\`\`` } }] }) };
  },
}));
const modelUnset = await settle(release.callModel({ baseUrl: '', model: 'm', apiKey: '', messages: draftMessages,
  fetchImpl: async () => { throw new Error('should not be called'); } }));
const modelDown = await settle(release.callModel({ baseUrl: 'https://x', model: 'm', apiKey: 'k', messages: draftMessages,
  fetchImpl: async () => ({ ok: false, status: 429, statusText: 'Too Many Requests' }) }));
const modelCrlf = await settle(release.callModel({ baseUrl: 'https://x', model: 'm', apiKey: 'k', messages: draftMessages,
  fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: {
    content: `\`\`\`markdown\r\n${goodDraft.replace(/\n/g, '\r\n')}\r\n\`\`\`\r\n` } }] }) }) }));
const modelBlank = await settle(release.callModel({ baseUrl: 'https://x', model: 'm', apiKey: 'k', messages: draftMessages,
  fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '  ' } }] }) }) }));

test('a model-drafted changelog fills only an empty [Unreleased], in the house shape, and a failed call fails (#88)', () => {
  const good = goodDraft;
  const filled = release.insertDraft(EMPTY, good);
  assert(!release.isEmpty(filled) && release.unreleasedBody(filled).includes('- New command (#9)'), 'draft inserted');
  const refuses = (fn, pattern, what) => {
    let err; try { fn(); } catch (e) { err = e; }
    assert(err && pattern.test(err.message), `${what}: ${err?.message ?? 'did not throw'}`);
  };
  refuses(() => release.insertDraft(CL, good), /already has entries/, 'overwriting real entries');
  refuses(() => release.insertDraft(EMPTY, '### Highlights\n\n- Big news'), /unknown heading/, 'an invented heading');
  refuses(() => release.insertDraft(EMPTY, 'We are thrilled to announce...'), /not a heading or a bullet/, 'prose');
  refuses(() => release.insertDraft(EMPTY, '- orphan bullet'), /before any heading/, 'a bullet with no heading');

  assert(draftMessages[0].content.includes('### Added') && draftMessages[1].content.includes('Fix thing (#3)'), 'prompt carries style and commits');
  eq(modelOk.value, good, 'fences stripped');
  eq(sentToModel[0]?.url, 'https://llm.example/v1/chat/completions', 'one POST to chat/completions');
  eq(sentToModel[0]?.init.headers.authorization, 'Bearer k', 'key sent as a bearer token');
  assert(/RELEASE_LLM_BASE_URL, RELEASE_LLM_API_KEY not set/.test(modelUnset.error?.message), `missing config: ${modelUnset.error?.message}`);
  assert(/429/.test(modelDown.error?.message), 'a failed call throws');
  assert(/no text/.test(modelBlank.error?.message), 'an empty answer throws');
});

test('a CRLF draft validates and inserts exactly like its LF twin (#121)', () => {
  const crlf = (s) => s.replace(/\n/g, '\r\n');
  eq(modelCrlf.value, goodDraft, 'a CRLF fenced answer comes back as the LF draft');
  for (const draft of [goodDraft, `\`\`\`markdown\n${goodDraft}\n\`\`\``]) {
    eq(JSON.stringify(release.draftProblems(crlf(draft))), JSON.stringify(release.draftProblems(draft)), `same verdict for ${JSON.stringify(draft.slice(0, 12))}`);
  }
  eq(release.draftProblems(crlf(goodDraft)).length, 0, 'a CRLF draft is clean');
  eq(release.draftProblems('### Fixed\r\n\r\n- Fix the bug (#1).\r\n').length, 0, 'the reported draft');
  const filled = release.insertDraft(EMPTY, crlf(goodDraft));
  eq(filled, release.insertDraft(EMPTY, goodDraft), 'inserted as LF');
  assert(!filled.includes('\r'), 'no carriage return reaches the changelog');
  const [before, after] = EMPTY.split('## [Unreleased]\n');
  assert(filled.startsWith(`${before}## [Unreleased]\n`) && filled.endsWith(after.slice(after.indexOf('## [1.1.0]'))), 'the rest of the changelog untouched');
  let err; try { release.insertDraft(EMPTY, crlf('### Highlights\n\n- Big news')); } catch (e) { err = e; }
  assert(/unknown heading "Highlights"/.test(err?.message), `a bad CRLF heading still fails: ${err?.message}`);
});

// The allowed-field lists are written by hand, so the way they go wrong is by
// omitting a real field - and then the build report cries wolf at a spec that
// was right all along. The worked examples are the specs agents copy, so they
// are the ones that must never warn (#205).
const specBuilders = {
  'arkitect-drawio': await import(pathToFileURL(join(ROOT, 'skills', 'arkitect-drawio', 'scripts', 'build-diagram.mjs')).href),
  'arkitect-excalidraw': await import(pathToFileURL(join(ROOT, 'skills', 'arkitect-excalidraw', 'scripts', 'build-diagram.mjs')).href),
};

test('no committed template spec reports an unknown field (#205)', () => {
  let checked = 0;
  for (const [engine, builder] of Object.entries(specBuilders)) {
    assert(typeof builder.unknownFields === 'function', `${engine} no longer exports unknownFields`);
    const dir = join(ROOT, 'skills', engine, 'assets', 'templates');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      let spec;
      try { spec = JSON.parse(readFileSync(join(dir, file), 'utf8')); } catch { continue; }
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) continue;
      checked++;
      const unknown = builder.unknownFields(spec);
      eq(unknown.length, 0,
        `${engine}/${file} would warn about ${unknown.map((u) => u.field).join(', ')} - add the field to the builder's list, or fix the template`);
    }
  }
  assert(checked > 0, 'no template specs were checked');
});

// GitHub forces an action declaring Node 20 onto Node 24 and annotates every
// run saying so; v5 is the first major of each of these to declare node24,
// read from the published action.yml at that tag. And `ubuntu-latest` becomes
// Ubuntu 26 on 19 October 2026, which would move the image every job here is
// verified on without anyone choosing it. So no job rides the moving label,
// and both images are named until the migration is over (#122).
test('every workflow pins a Node 24 action and names its Ubuntu image (#122)', () => {
  const dir = join(ROOT, '.github', 'workflows');
  const files = readdirSync(dir).filter((f) => f.endsWith('.yml'));
  assert(files.length > 0, 'no workflows were found');

  const FLOOR = { 'actions/checkout': 5, 'actions/setup-node': 5, 'actions/cache': 5 };
  const images = new Set();
  const labels = (yml) => [
    ...[...yml.matchAll(/runs-on:\s*(\S+)/g)].map((m) => m[1]),
    ...[...yml.matchAll(/^\s*os:\s*\[([^\]]+)\]/gm)].flatMap((m) => m[1].split(',').map((s) => s.trim())),
  ].filter((l) => !l.startsWith('${{'));

  for (const file of files) {
    const yml = readFileSync(join(dir, file), 'utf8');
    for (const [, action, major] of yml.matchAll(/uses:\s*(actions\/[\w-]+)@v(\d+)/g)) {
      const floor = FLOOR[action];
      assert(floor !== undefined,
        `${file}: ${action} is not in this test's floor table - check which major declares node24 and add it`);
      assert(Number(major) >= floor,
        `${file}: ${action}@v${major} declares Node 20, which CI annotates on every run; v${floor} or newer declares node24`);
    }
    for (const label of labels(yml)) {
      assert(label !== 'ubuntu-latest',
        `${file}: ubuntu-latest becomes Ubuntu 26 on 19 October 2026; name the image instead`);
      if (label.startsWith('ubuntu-')) images.add(label);
    }
  }

  for (const image of ['ubuntu-24.04', 'ubuntu-26.04']) {
    assert(images.has(image),
      `no workflow runs on ${image}; both run until ubuntu-latest has migrated and the older one is dropped deliberately`);
  }
});

// A release is two workflows and a merge, and either can fail after the step
// before it has already succeeded. Both used to make a rerun worse: prepare
// refused the branch it had pushed itself, publish tripped over its own tag, so
// a transient GitHub failure had to be repaired by hand. The decision is made
// here, off the network, and the workflows only observe and act (#120).
test('a rerun resumes a half-finished release, and refuses to force one (#120)', () => {
  const prepare = (state) => release.prepareAction({ version: '1.6.3', branchExists: false, branchVersion: '', tagExists: false, prState: '', ...state });
  const publish = (state) => release.publishAction({ version: '1.6.3', tagSha: '', headSha: 'abc123abc123', releaseExists: false, ...state });

  // Prepare: the first run, and the two ways a rerun recovers.
  eq(prepare({}).action, 'commit-push-open', 'nothing on the remote is a first run');
  eq(prepare({ branchExists: true, branchVersion: '1.6.3' }).action, 'open-only',
    'the branch pushed and the pull request missing is the failure this exists for');
  eq(prepare({ branchExists: true, branchVersion: '1.6.3', prState: 'OPEN' }).action, 'noop',
    'a finished run is harmless to re-run');

  // Prepare: every state a person has to settle, and none of them mutates.
  for (const [state, expected] of [
    [{ tagExists: true }, /already tagged/],
    [{ branchExists: true, branchVersion: '1.6.2' }, /says 1\.6\.2, not 1\.6\.3/],
    [{ branchExists: true, branchVersion: '' }, /says nothing/],
    [{ branchExists: true, branchVersion: '1.6.3', prState: 'MERGED' }, /the publish, not the prepare/],
    [{ branchExists: true, branchVersion: '1.6.3', prState: 'CLOSED' }, /closed unmerged/],
  ]) {
    const got = prepare(state);
    eq(got.action, 'conflict', `${JSON.stringify(state)} must not be resumed automatically`);
    assert(expected.test(got.reason), `and says why: ${got.reason}`);
  }
  // A tag wins over everything: a released version is never re-prepared, even
  // with its branch and pull request still sitting there.
  eq(prepare({ tagExists: true, branchExists: true, branchVersion: '1.6.3', prState: 'OPEN' }).action, 'conflict',
    'an existing tag is checked before anything else');

  // Publish: the first run, the recovery, and the finished run.
  eq(publish({}).action, 'tag-and-release', 'nothing published yet is a first run');
  eq(publish({ tagSha: 'abc123abc123' }).action, 'release-only',
    'the tag pushed and the release missing is the failure this exists for');
  eq(publish({ tagSha: 'abc123abc123', releaseExists: true }).action, 'noop', 'a finished run is harmless to re-run');

  // Publish: a tag somewhere else is two releases in flight, and is never moved.
  const moved = publish({ tagSha: 'ffff9999ffff' });
  eq(moved.action, 'conflict', 'a tag on another commit is not resumed');
  assert(/never moved/.test(moved.reason), `and says why: ${moved.reason}`);
  eq(publish({ releaseExists: true }).action, 'conflict', 'a release with no tag behind it is settled by hand');
  eq(publish({ headSha: '' }).action, 'conflict', 'nothing to tag is a conflict, not a tag of nothing');

  // The workflows read the answer as step outputs, so the reason stays one line.
  const lines = release.outputLines(prepare({ branchExists: true, branchVersion: '1.6.3' }));
  assert(/^action=open-only\nreason=\S.*\n$/.test(lines), `two output lines, no stray newline: ${JSON.stringify(lines)}`);
  assert(/^action=/.test(release.outputLines({ action: 'noop', reason: 'a\nb\n  c' })), 'a multi-line reason is flattened');
  let bad; try { release.outputLines({ action: 'force-push', reason: 'x' }); } catch (e) { bad = e; }
  assert(/unknown action/.test(bad?.message ?? ''), 'an action the workflows cannot branch on is refused');

  // And the workflows actually use it, rather than deciding in bash.
  const yml = (f) => readFileSync(join(ROOT, '.github', 'workflows', f), 'utf8');
  const prepareYml = yml('release-prepare.yml');
  const publishYml = yml('release-publish.yml');
  assert(prepareYml.includes('release.mjs resume-prepare'), 'prepare no longer asks what is already on the remote');
  assert(publishYml.includes('release.mjs resume-publish'), 'publish no longer asks what is already published');
  for (const [name, text] of [['prepare', prepareYml], ['publish', publishYml]]) {
    assert(/steps\.resume\.outputs\.action == 'conflict'/.test(text), `${name} does not stop on a conflict`);
    assert(/steps\.resume\.outputs\.action == 'noop'/.test(text), `${name} does not treat a finished run as a no-op`);
    // Not `--force` anywhere: `git switch --force-create` is a local branch,
    // and harmless. What must never appear is a rewrite of something published.
    assert(!/push[^\n]*(?:--force|--delete|\s-f\b)|tag[^\n]*\s-f\b|--force-with-lease/.test(text),
      `${name} force-pushes, moves a tag or deletes a remote ref`);
  }
  // The version is known before anything is written, or a rerun cannot ask.
  const nextAt = prepareYml.indexOf('release.mjs next');
  assert(nextAt > 0 && nextAt < prepareYml.indexOf('release.mjs prepare'), 'prepare writes before it knows which version it is resuming');
  assert(prepareYml.indexOf('resume-prepare') < prepareYml.indexOf('release.mjs draft'),
    'the model is called before the run knows whether it needs one');
  // A resumed branch is published as it stands, and still read by a person.
  assert(/git switch --force-create "release\/v\$VERSION" "origin\/release\/v\$VERSION"/.test(prepareYml),
    'a resumed run does not take the branch as it stands');
  assert(/RESUMED.*=.*true.*\]; then draft_flag|\[ "\$RESUMED" = "true" \]/.test(prepareYml),
    'a resumed pull request skips the human-review gate');
});

test('the release workflows are started by a person, gated by a merged pull request, and never publish to npm (#88)', () => {
  const read = (f) => readFileSync(join(ROOT, '.github', 'workflows', f), 'utf8');
  const prepare = read('release-prepare.yml');
  const publish = read('release-publish.yml');
  assert(/^on:\s*\n\s*workflow_dispatch:/m.test(prepare) && !/schedule:|push:|pull_request:/.test(prepare), 'prepare runs only by hand');
  assert(/options: \[patch, minor, major\]/.test(prepare), 'prepare takes the bump');
  const suite = prepare.indexOf('node tests/run-tests.mjs');
  assert(suite > 0 && suite < prepare.indexOf('release.mjs draft') && suite < prepare.indexOf('release.mjs prepare'), 'the suite runs before any file changes');
  assert(prepare.includes('RELEASE_TOKEN is not set'), 'a missing token fails loudly');
  assert(/--draft/.test(prepare) && /drafted by a model/.test(prepare), 'a drafted changelog opens a draft pull request that says so');
  assert(!/git push origin main|git push\s*$/m.test(prepare), 'prepare never pushes to main');
  assert(/types: \[closed\]/.test(publish), 'publish runs on a closed pull request');
  assert(publish.includes("github.event.pull_request.merged == true && startsWith(github.event.pull_request.head.ref, 'release/v')"), 'only a merged release branch publishes');
  assert(publish.includes('release.mjs check') && publish.indexOf('release.mjs check') < publish.indexOf('git tag'), 'the version is checked before tagging');
  assert(publish.includes('--notes-file notes.md') && !/generate-notes/.test(publish), 'release notes are the changelog section, not generated');
  for (const [name, yml] of [['prepare', prepare], ['publish', publish]]) {
    const steps = yml.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
    assert(!/npm publish|npm_token|NODE_AUTH_TOKEN|registry-url/i.test(steps), `${name} must not publish to npm`);
  }
});

// ------------------------------------------------------------- the harness

// A second harness, logging to an array so its FAIL lines stay out of this run.
// Every callback runs now; the rejection gets a turn to escape before the checks.
const probeLog = [];
const probe = createHarness({ log: (line) => probeLog.push(line) });
const escaped = [];
const onEscape = (reason) => escaped.push(reason);
process.on('unhandledRejection', onEscape);
probe.test('rejects later', async () => { await Promise.resolve(); throw new Error('assertion failed'); });
probe.test('resolves later', async () => {});
probe.test('a bare thenable', () => ({ then() {} }));
probe.test('passes', () => {});
probe.test('skips', () => 'skip');
probe.test('throws', () => { throw new Error('boom'); });
await new Promise((done) => setImmediate(done));
process.off('unhandledRejection', onEscape);

test('a test callback that returns a promise fails instead of passing before it ran (#114)', () => {
  const { pass, fail, skip } = probe.counts;
  eq(`${pass}/${fail}/${skip}`, '1/4/1', 'pass/fail/skip');
  for (const name of ['rejects later', 'resolves later', 'a bare thenable']) {
    assert(probe.failures.includes(`${name}: returned a promise; settle it before test() and assert synchronously`),
      `${name} is a failure: ${probe.failures.join(' | ')}`);
  }
  assert(probe.failures.includes('throws: boom'), 'a synchronous throw still fails with its message');
  eq(escaped.length, 0, 'the rejection is observed, not left to end the run');
  assert(!probeLog.some((line) => line.startsWith('ok    ') && line.includes('later')), 'nothing async is logged as ok');
});

test('a compact icon search answers in under 1KB and keeps every verdict (#117)', () => {
  const ask = (engine, query) => {
    const out = cli([engine, 'icon', query, '--compact']);
    assert(Buffer.byteLength(out) <= 1000, `${engine} icon "${query}" --compact is ${Buffer.byteLength(out)} bytes`);
    eq(out.trim().split('\n').length, 1, `${engine} "${query}" is one line`);
    return JSON.parse(out);
  };
  const full = (engine, query) => JSON.parse(cli([engine, 'icon', query]));

  // The two searches the issue measured, and what they resolve to.
  const bedrock = ask('drawio', 'bedrock');
  eq(bedrock.resolved, full('drawio', 'bedrock').resolved, 'drawio: the same verdict as the full search');
  eq(JSON.stringify(bedrock.node), '{"kind":"icon","icon":"aws/amazon-bedrock"}', 'drawio: a spec node');
  const postgres = ask('excalidraw', 'postgres');
  eq(postgres.draws, full('excalidraw', 'postgres').draws, 'excalidraw: the same verdict as the full search');
  eq(postgres.node.icon, postgres.draws, 'excalidraw: a spec node');
  assert(postgres.others.length <= 3, 'excalidraw: alternatives are bounded');

  // Ambiguity stays a question, with bounded choices, in both engines.
  const monitor = ask('drawio', 'monitor');
  eq(monitor.confident, false, 'drawio: an ambiguous search is not settled');
  assert(!('node' in monitor) && monitor.needsAChoice && monitor.choices.length === 4 && monitor.more > 0, 'drawio: choices, not a node');
  const queue = ask('excalidraw', 'queue');
  assert(!('draws' in queue) && !('node' in queue) && queue.placeholder && queue.choices.length <= 4, 'excalidraw: choices, not a node');

  // A lifecycle caveat and an on-demand next step survive compaction.
  const census = ask('drawio', 'census');
  assert(/folded into Fivetran/.test(census.lifecycle) && census.successor, 'drawio: the lifecycle caveat and successor');
  assert(/placeholder|fetch/i.test(census.onDemand), 'drawio: what to do about a mark with no bytes');
  const hudi = ask('drawio', 'hudi');
  assert(hudi.choices.some((c) => c.onDemand), 'drawio: an on-demand choice is marked');

  // Nothing found is said with a next step, never as an empty answer.
  for (const engine of ['drawio', 'excalidraw']) {
    const none = ask(engine, 'zzqqxx');
    assert(none.found === 0 && /labelled/.test(none.next), `${engine}: a miss says what to do`);
  }

  // The full output is unchanged by the new flag's existence.
  assert(Array.isArray(full('drawio', 'bedrock').matches[0].variants), 'drawio: the full search is as before');
  const r = spawnSync(process.execPath, [CLI, 'excalidraw', 'icon', '--stats', '--compact'], { encoding: 'utf8' });
  eq(r.status, 2, '--compact applies to a search only');
});

// -------------------------------------------------------------

finish();
