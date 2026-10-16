#!/usr/bin/env node
// Repository-level checks: the CLI, the agent adapters, the docs and the shape
// of the plugin. The two engine suites test the diagram generators; this one
// tests everything that holds them together.
//
//   node tests/toolkit.mjs
//
// Offline and deterministic, like the others.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync, mkdirSync, chmodSync, mkdtempSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
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
  for (const [alias, targets] of Object.entries(adapters.ALIASES)) {
    for (const target of [targets].flat()) {
      if (target.startsWith('--')) continue;
      assert(adapters.ADAPTERS[target], `alias ${alias} points at unknown adapter ${target}`);
    }
  }
  assert(!Object.hasOwn(adapters.ALIASES, 'gemini'), 'gemini is an adapter, not an alias of one');
  eq(adapters.ADAPTERS.gemini.file, 'GEMINI.md', 'Gemini reads GEMINI.md by default');
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

  const geminiDir = join(TMP, 'gemini-merge');
  mkdirSync(geminiDir, { recursive: true });
  writeFileSync(join(geminiDir, 'GEMINI.md'), own);
  cli(['install', 'gemini', '--dir', geminiDir]);
  cli(['install', 'gemini', '--dir', geminiDir]);
  cli(['install', 'gemini', '--dir', geminiDir]);
  const gemini = readFileSync(join(geminiDir, 'GEMINI.md'), 'utf8');
  eq(gemini.split('<!-- arkitect:begin -->').length - 1, 1, 'Gemini marker blocks after three runs');
  assert(gemini.includes('Always rebase.'), 'existing Gemini context was lost');
  assert(!existsSync(join(geminiDir, 'AGENTS.md')), 'install gemini also wrote AGENTS.md');
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

// `install --all --force`, the documented update, replaced a project's own
// command file and left no copy of it (#401). The backup ends past the
// extension: a `.md` beside a Cursor command is a command too.
test('install --force backs up each non-merge adapter file it replaces, under a name no host loads (#401)', () => {
  const dir = join(TMP, 'force-backup');
  const own = Object.entries(adapters.ADAPTERS).filter(([, a]) => !a.merge);
  for (const [name, a] of own) {
    mkdirSync(dirname(join(dir, a.file)), { recursive: true });
    writeFileSync(join(dir, a.file), `my own ${name}\n`);
  }
  const out = cli(['install', '--all', '--force', '--dir', dir]);
  for (const [name, a] of own) {
    const folder = dirname(join(dir, a.file));
    const copies = readdirSync(folder).filter((f) => f.startsWith(`${basename(a.file)}.backup-`));
    eq(copies.length, 1, `${a.file}: backups`);
    assert(/\.backup-\d{8}-\d{6}$/.test(copies[0]), `${copies[0]}: ends in the stamp, not in an extension a host loads`);
    eq(readFileSync(join(folder, copies[0]), 'utf8'), `my own ${name}\n`, `${a.file}: the backup holds the replaced file`);
    assert(out.includes(copies[0]), `the output names ${copies[0]}`);
  }
  // A rerun replaces Arkitect's own block with itself, and needs no copy.
  cli(['install', '--all', '--force', '--dir', dir]);
  for (const [, a] of own) {
    eq(readdirSync(dirname(join(dir, a.file))).filter((f) => f.includes('.backup-')).length, 1, `${a.file}: a second backup of the same block`);
  }
  assert(!readdirSync(dir).some((f) => f.includes('.backup-')), 'a merge adapter left a backup');
});

// `/diagram` is a generic name a host, an extension or the project can hold
// too, and a project's own `diagram.md` kept Arkitect's from installing (#401).
// The command is `/arkitect`; an earlier Arkitect's `diagram.md` goes, and a
// project's own stays byte for byte.
test('Cursor and OpenCode get /arkitect, and an earlier Arkitect /diagram is removed while a project\'s own is kept (#401)', () => {
  const pairs = [['cursor-command', '.cursor/commands'], ['opencode', '.opencode/command']];
  for (const [name, folder] of pairs) {
    eq(adapters.ADAPTERS[name].file.split(sep).join('/'), `${folder}/arkitect.md`, `${name}: file`);
    assert(adapters.ADAPTERS[name].hosts.includes('(/arkitect)'), `${name}: ${adapters.ADAPTERS[name].hosts}`);
  }
  const fresh = join(TMP, 'command-fresh');
  cli(['install', 'cursor-command', 'opencode', '--dir', fresh]);
  for (const [, folder] of pairs) eq(readdirSync(join(fresh, folder)).join(), 'arkitect.md', `${folder}: a fresh install`);

  // What earlier releases wrote, under other install paths, one with CRLF as a
  // Windows checkout of a committed file has it.
  const current = (root) => adapters.ADAPTERS['cursor-command'].render(root);
  const first = (root, s) => ['---', 'description: Draw an editable architecture, system or flow diagram (Draw.io or Excalidraw)', '---', '',
    `Draw the diagram the user asked for using Arkitect, installed at \`${root}\`.`, '',
    `Read \`${root}${s}AGENTS.md\` first — it is the contract. Then:`, '',
    '1. Choose the engine: Draw.io for formal solution architecture, Excalidraw for',
    '   system design and flows. Say which you chose.',
    '2. Resolve every icon before laying out. Never substitute one product\'s mark for',
    '   another.',
    '3. Write a spec, build it, validate it, render it, and look at the PNG.',
    '4. Report the file path, your assumptions, and anything you could not resolve.', '', '$ARGUMENTS', ''].join('\n');
  const earlier = [current('/Users/Jane Doe/arkitect'), first('D:\\Profiles\\Jane Doe\\arkitect', '\\').replace(/\n/g, '\r\n'), first('/opt/arkitect', '/')];
  earlier.forEach((old, n) => {
    const dir = join(TMP, `command-migrate-${n}`);
    for (const [, folder] of pairs) { mkdirSync(join(dir, folder), { recursive: true }); writeFileSync(join(dir, folder, 'diagram.md'), old); }
    const out = cli(['install', 'cursor-command', 'opencode', '--dir', dir]);
    for (const [, folder] of pairs) {
      eq(readdirSync(join(dir, folder)).join(), 'arkitect.md', `${folder}: after migrating release ${n}'s command`);
      assert(new RegExp(`remove ${folder.replace('/', '[\\\\/]').replace('.', '\\.')}[\\\\/]diagram\\.md`).test(out), `the output does not say ${folder}/diagram.md was removed:\n${out}`);
    }
  });

  // A project's own /diagram, and one an earlier Arkitect wrote and the user
  // then edited, are the project's: kept byte for byte, and named.
  const own = { 'a Mermaid command': '---\ndescription: Draw a Mermaid diagram\n---\n\nDraw it in Mermaid.\n',
    'an edited Arkitect command': `${current('/opt/arkitect')}\nAlways use our colours.\n` };
  for (const [what, text] of Object.entries(own)) {
    const dir = join(TMP, `command-own-${what.replace(/\W+/g, '-')}`);
    for (const [, folder] of pairs) { mkdirSync(join(dir, folder), { recursive: true }); writeFileSync(join(dir, folder, 'diagram.md'), text); }
    for (const force of [[], ['--force']]) {
      const out = cli(['install', 'cursor-command', 'opencode', '--dir', dir, ...force]);
      for (const [, folder] of pairs) {
        eq(readFileSync(join(dir, folder, 'diagram.md'), 'utf8'), text, `${what}${force.join('')}: ${folder}/diagram.md`);
        assert(existsSync(join(dir, folder, 'arkitect.md')), `${what}: no ${folder}/arkitect.md`);
        assert(/keep\s+\S*diagram\.md/.test(out), `${what}: the output does not name the kept file:\n${out}`);
      }
    }
  }
  // No doc names the old command but the one sentence on what install migrates.
  for (const file of ['README.md', ...readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)]) {
    const stale = readFileSync(join(ROOT, file), 'utf8').split('\n')
      .filter((line) => /(?<![\w:.-])\/diagram(?![\w.-])|\bdiagram\.md\b/.test(line) && !/used to be `\/diagram`/.test(line));
    eq(stale.join('\n'), '', `${file} still names the old command`);
  }
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
    '.cursor/commands/arkitect.md',
    '.opencode/command/arkitect.md',
    '.github/copilot-instructions.md',
    'AGENTS.md',
  ]) {
    assert(existsSync(join(ROOT, p)), `missing committed adapter: ${p}`);
  }
});

// The command restated the workflow in four steps that contradicted it: an
// engine with no reason, a report with no validation, render or icons. A
// small model follows the short list it reads first (#354).
test('the /arkitect command points at AGENTS.md §2 and restates no step of it (#354)', () => {
  const bodies = ['cursor-command', 'opencode'].map((k) => [k, adapters.ADAPTERS[k].render('/opt/arkitect')])
    .concat(['.cursor/commands/arkitect.md', '.opencode/command/arkitect.md'].map((p) => [p, readFileSync(join(ROOT, p), 'utf8')]));
  for (const [name, body] of bodies) {
    assert(body.includes('AGENTS.md') && body.includes('§2') && body.includes('step 8'), `${name}: does not point at AGENTS.md §2`);
    assert(!/^\s*\d+\.\s/m.test(body), `${name}: restates numbered steps`);
    assert(!/\b(report the|choose the engine|say which you chose)\b/i.test(body), `${name}: restates a rule of its own`);
    assert(Buffer.byteLength(body) < 400, `${name}: ${Buffer.byteLength(body)} bytes; the pointer alone is about 300`);
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

// Codex's reusable-command route was a custom prompt: deprecated upstream in
// favour of skills, documented here with the wrong invocation, and written with
// paths that only resolve inside the Arkitect checkout. The skill it gets now is
// generated with absolute paths, and has to work from an unrelated project whose
// path has spaces in it, with CLAUDE_PLUGIN_ROOT unset - which is how Codex runs
// it (#127).
test('install codex writes a Codex skill whose every path resolves from another project (#127)', () => {
  const project = join(TMP, 'codex project with spaces');
  mkdirSync(project, { recursive: true });
  const out = cli(['install', 'codex'], { cwd: project });
  assert(existsSync(join(project, 'AGENTS.md')), 'install codex no longer writes AGENTS.md');
  const skillPath = join(project, '.agents', 'skills', 'arkitect', 'SKILL.md');
  assert(existsSync(skillPath), `no skill at ${skillPath}`);
  assert(out.includes('$arkitect'), 'the installer does not say how to invoke the skill');

  const skill = readFileSync(skillPath, 'utf8');
  const front = /^---\nname: (\S+)\ndescription: (.+)\n---\n/.exec(skill);
  assert(front, 'the skill does not open with name and description frontmatter');
  eq(front[1], 'arkitect', 'skill name');
  assert(front[2].length <= 1024 && /\.drawio/.test(front[2]) && /\.excalidraw/.test(front[2]), `description: ${front[2]}`);

  const paths = [...skill.matchAll(/`([^`\n]+)`/g)].map((m) => m[1])
    .concat([...skill.matchAll(/node "([^"]+)"/g)].map((m) => m[1]))
    .filter((p) => resolve(p) === p);
  for (const guide of ['arkitect-drawio', 'arkitect-excalidraw']) {
    const at = join(ROOT, 'skills', guide, 'SKILL.md');
    assert(paths.includes(at), `the skill does not name ${guide}'s guide by its absolute path`);
    // What the guide calls ${CLAUDE_PLUGIN_ROOT} is the root the skill names.
    const scripts = /`\$\{CLAUDE_PLUGIN_ROOT\}\/([^`]+)`/.exec(readFileSync(at, 'utf8'))[1];
    assert(existsSync(join(ROOT, scripts)), `${guide}: ${scripts} does not exist under the root`);
  }
  assert(skill.includes('`${CLAUDE_PLUGIN_ROOT}`') && paths.includes(ROOT), 'the skill does not say what ${CLAUDE_PLUGIN_ROOT} means');
  for (const p of paths) assert(existsSync(p), `the skill names ${p}, which does not exist`);

  const dispatcher = paths.find((p) => p.endsWith('arkitect.mjs'));
  const run = spawnSync(process.execPath, [dispatcher, 'drawio', 'icon', 'bedrock'],
    { cwd: project, encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: '' } });
  eq(run.status, 0, `the dispatcher the skill names fails from the project: ${run.stderr}`);
  assert(run.stdout.includes('aws/amazon-bedrock'), 'bedrock did not resolve from the project');

  // Existing installs stay compatible: a rerun updates AGENTS.md and leaves the skill.
  const again = cli(['install', 'codex'], { cwd: project });
  assert(/update\s+AGENTS\.md/.test(again) && /skip\s+\.agents/.test(again), again);

  // The docs name the current route and the legacy one's real spelling.
  const agents = readFileSync(join(ROOT, 'docs', 'install.md'), 'utf8');
  const codex = agents.slice(agents.indexOf('## Codex'), agents.indexOf('\n## ', agents.indexOf('## Codex') + 1));
  assert(codex.includes('$arkitect') && codex.includes('/prompts:diagram'), 'docs/install.md: Codex invocation');
  assert(!/cp .*\.codex\/prompts/.test(agents) && !existsSync(join(ROOT, '.codex')), 'the deprecated prompt is still shipped');
});

// The Codex skill sent the agent through all of AGENTS.md and then an engine
// guide that repeats it: 15,894 bytes no other host reads twice (#303). Its
// route is now the AGENTS.md pointer Codex loads, the skill, and one guide.
test('the Codex reading route reaches one engine guide, not the full contract as well (#303)', () => {
  const skill = adapters.ADAPTERS['codex-skill'].render(ROOT);
  const pointer = adapters.ADAPTERS.agents.render(ROOT);
  const contract = join(ROOT, 'AGENTS.md');
  assert(!skill.includes(contract), 'the Codex skill still sends the agent to AGENTS.md');
  assert(pointer.includes(contract) && /`arkitect` skill is loaded \(Codex\), its engine guide is that contract/.test(pointer),
    'the AGENTS.md pointer does not hand Codex to the skill\'s guide');

  // What the entry blocks drop is still said on the route.
  for (const rule of ['Nothing is uploaded', 'Never substitute one product\'s mark', '**Draw.io** for', '**Excalidraw** for',
    'run only when the user asks', '`${CLAUDE_PLUGIN_ROOT}`']) {
    assert(skill.includes(rule), `the Codex skill dropped: ${rule}`);
  }
  // Run from the guide's folder, a relative --out lands inside the install (#377).
  assert(!/commands from that\s+folder/.test(skill) && /from the project folder/.test(skill),
    'the Codex skill tells the agent to run commands from the install folder');
  const guides = ['arkitect-drawio', 'arkitect-excalidraw'].map((g) => join(ROOT, 'skills', g, 'SKILL.md'));
  for (const g of guides) assert(skill.includes(`\`${g}\``), `the Codex skill does not name ${g}`);

  // The blocks name the install path 16 times, so they are measured at a fixed
  // root as long as CI's checkout; the real one failed past 85 characters (#358).
  const bytes = (s) => Buffer.byteLength(s);
  const fixed = `/${'r'.repeat(34)}`;
  const entry = bytes(adapters.ADAPTERS.agents.render(fixed)) + bytes(adapters.ADAPTERS['codex-skill'].render(fixed));
  const guide = Math.max(...guides.map((g) => bytes(readFileSync(g, 'utf8'))));
  const route = entry + guide;
  assert(entry <= 5000, `the Codex entry blocks are ${entry} bytes`);
  assert(route < guide + bytes(readFileSync(contract, 'utf8')),
    `the Codex route is ${route} bytes, more than a guide and the full contract`);
});

// The entry paths taught the verbose search, 4,611 bytes for "bedrock" where
// --compact answers in 145, though both guides already used it (#304).
test('every icon search an adapter or AGENTS.md teaches is compact, and the detail route is named (#304)', () => {
  const md = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  const commands = md.slice(md.indexOf('## 3. Commands'), md.indexOf('## 4.'));
  const taught = [commands, ...Object.values(adapters.ADAPTERS).map((a) => a.render(ROOT))]
    .flatMap((text) => text.split('\n').filter((l) => /arkitect\.mjs"? (drawio|excalidraw) icon /.test(l)));
  assert(taught.length >= 4, `found ${taught.length} icon searches to check`);
  for (const line of taught) assert(line.includes('--compact'), `not compact: ${line.trim()}`);
  assert(/drop --compact for detail/.test(commands), 'AGENTS.md no longer says how to get the full search');
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
  eq(out.split('write ').length - 1, 2, 'AGENTS.md once, and the Codex skill once');
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
    read: (rel) => (rel === 'docs/icons.md'
      ? docText(rel).replace('an answer key of', 'an answer key of about')
      : docText(rel)),
  });
  assert(dropped.some((p) => p.startsWith('docs/icons.md: no longer says answer-key queries with an expected answer')),
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

// A regex grader read out of a case file, applied to text the way
// `claude plugin eval` applies it: `contains`, `not_contains`, or `count:N`,
// which is exactly N matches of the pattern made global.
const evalGrader = (yaml, name) => {
  const block = yaml.replace(/\r\n/g, '\n').match(new RegExp(`^  - type: (\\w+)\\n    name: ${name}\\n((?:    .*\\n?)*)`, 'm'));
  assert(block, `the ${name} grader is gone`);
  const field = (key) => block[2].match(new RegExp(`^    ${key}: (.*)$`, 'm'))?.[1]?.trim();
  const quoted = (v) => (v?.startsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v);
  const grader = { type: block[1], pattern: quoted(field('pattern') ?? field('input_match')), match: field('match') ?? 'contains',
    target: field('target'), flags: quoted(field('flags')) ?? '' };
  grader.passes = (text) => {
    const re = new RegExp(grader.pattern, grader.flags);
    if (grader.match === 'not_contains') return !re.test(text);
    const count = grader.match.match(/^count:(\d+)$/);
    if (count) return (text.match(new RegExp(grader.pattern, `${grader.flags.replace('g', '')}g`)) ?? []).length === Number(count[1]);
    return re.test(text);
  };
  return grader;
};

// `target: files` is the list of files a run CREATED. A file the scaffold wrote
// before the run is never in it, rewritten or not, so the four "input
// unchanged" graders that looked there passed whatever the agent did to the
// fixture (#414). A files grader may only name what the run itself creates,
// and the fixture checks read the file: each passes it as written and fails
// it rewritten.
test('no files grader names a file its scaffold wrote, and the fixture checks read the file (#414)', () => {
  for (const { id, dir } of evalCases()) {
    const yaml = readFileSync(join(dir, 'case.yaml'), 'utf8').replace(/\r\n/g, '\n');
    const script = yaml.match(/^\s{2}scaffold_script:[ \t]*(\S+)/m)?.[1];
    if (!script) continue;
    const body = readFileSync(join(dir, script), 'utf8');
    const written = [...body.matchAll(/(?:cat >|cp "?\S+"?|>)\s*"?([\w./-]+\.\w+)"?/g)].map((m) => m[1].replace(/^\.\//, ''));
    for (const [, name] of yaml.matchAll(/^  - type: regex\n    name: ([\w-]+)\n(?:    (?!name:).*\n)*?    target: files\n/gm)) {
      const grader = evalGrader(yaml, name);
      for (const path of written) {
        assert(!new RegExp(grader.pattern).test(path), `${id}: ${name} names ${path}, which its scaffold wrote, so it never sees a change`);
      }
    }
  }

  const heredoc = (rel) => readFileSync(join(ROOT, 'evals', rel, 'scaffold.sh'), 'utf8').match(/<<'EOF'\n([\s\S]*?)\nEOF/)[1] + '\n';
  const template = readFileSync(join(ROOT, 'skills', 'arkitect-excalidraw', 'assets', 'templates', 'starter-architecture.excalidraw'), 'utf8');
  for (const [rel, fixture, kept, rewrites] of [
    ['drawio/apply-skill-stays-manual', heredoc('drawio/apply-skill-stays-manual'), 'input-keeps-its-cells',
      [(t) => t.replaceAll('rounded=1;', 'rounded=0;'), (t) => t.replace('dashed=1;', ''), (t) => t.replace('<mxfile ', '<mxfile agent="arkitect-drawio" ')]],
    ['drawio/learning-skill-stays-manual', heredoc('drawio/learning-skill-stays-manual'), 'input-keeps-its-cells',
      [(t) => t.replaceAll('rounded=0;whiteSpace', 'rounded=1;whiteSpace'), (t) => t.replace('html=1;" edge', 'html=1;dashed=1;" edge')]],
    ['excalidraw/apply-skill-stays-manual', template, 'input-keeps-its-elements',
      [(t) => t.replaceAll('"strokeStyle": "dashed"', '"strokeStyle": "solid"'), (t) => t.replace(/"customData": \{\s*"arkitect": \{[^}]*\},\s*"arkitectSpec"/, '"customData": {"arkitect": {}, "x"')]],
    ['excalidraw/learning-skill-stays-manual', template, 'input-keeps-its-elements',
      [(t) => t.replaceAll('"strokeStyle": "dashed"', '"strokeStyle": "solid"')]],
  ]) {
    const yaml = readFileSync(join(ROOT, 'evals', rel, 'case.yaml'), 'utf8');
    const unchanged = evalGrader(yaml, 'input-unchanged');
    const count = evalGrader(yaml, kept);
    assert(unchanged.target.startsWith('{ source: file'), `${rel}: input-unchanged no longer reads the file`);
    assert(unchanged.passes(fixture), `${rel}: input-unchanged fails the fixture as the scaffold writes it`);
    assert(count.passes(fixture), `${rel}: ${kept} expects ${count.match}, and the fixture has ${(fixture.match(new RegExp(count.pattern, 'g')) ?? []).length}`);
    for (const [i, rewrite] of rewrites.entries()) {
      const changed = rewrite(fixture);
      assert(changed !== fixture, `${rel}: rewrite ${i} changed nothing; fix the test`);
      assert(!unchanged.passes(changed), `${rel}: input-unchanged passes rewrite ${i}`);
    }
    const grown = rel.startsWith('drawio') ? fixture.replace('</root>', '<mxCell id="x" vertex="1" parent="1" /></root>')
      : fixture.replace('"elements": [', '"elements": [{"id": "x", "versionNonce": 1},');
    assert(!count.passes(grown), `${rel}: ${kept} passes a fixture with an element added`);
    for (const tool of ['input-not-edited', 'input-not-written']) {
      assert(/^    max: 0$/m.test(yaml.slice(yaml.indexOf(`name: ${tool}`), yaml.indexOf(`name: ${tool}`) + 200)), `${rel}: ${tool} no longer refuses every write`);
    }
  }
});

// The tier-2 and tier-3 cases build their fixtures with the real CLI through a
// fixture.mjs, so a test can make the very files a run starts from, act out the
// outcome a case asks for and the ones it guards against, and hold each file
// grader to the right verdict on each. A case whose grader passes the trap, or
// fails the right answer, measures nothing, and nobody sees it until the
// scores stop moving (#415).
const fixtureOf = async (rel) => import(pathToFileURL(join(ROOT, 'evals', rel, 'fixture.mjs')).href);
const evalFixtures = {
  built: await fixtureOf('drawio/edit-built-diagram'),
  desktop: await fixtureOf('drawio/edit-saved-by-desktop'),
  scene: await fixtureOf('excalidraw/edit-built-scene'),
  appScene: await fixtureOf('excalidraw/edit-follows-the-scene'),
};
const { arkitect: arkitectCli } = await import(pathToFileURL(join(ROOT, 'evals', 'fixtures.mjs')).href);
test('the new eval cases grade their fixtures, the right outcome and the traps the way they mean to (#415)', () => {
  const dir = join(TMP, 'eval-fixtures');
  const fresh = (name) => {
    const at = join(dir, name);
    rmSync(at, { recursive: true, force: true });
    mkdirSync(at, { recursive: true });
    return at;
  };
  const caseYaml = (rel) => readFileSync(join(ROOT, 'evals', rel, 'case.yaml'), 'utf8');
  // Every file grader of a case on one file, as { name: verdict }.
  const verdicts = (rel, text, path) => {
    const yaml = caseYaml(rel).replace(/\r\n/g, '\n');
    const out = {};
    for (const [, name, target] of yaml.matchAll(/^  - type: regex\n    name: ([\w-]+)\n    target: \{ source: file, path: (\S+) \}$/gm)) {
      if (target === path) out[name] = evalGrader(yaml, name).passes(text);
    }
    assert(Object.keys(out).length, `${rel} has no file grader on ${path}`);
    return out;
  };
  const expect = (rel, text, path, wanted, what) => {
    const got = verdicts(rel, text, path);
    for (const [name, verdict] of Object.entries(wanted)) {
      assert(name in got, `${rel}: no file grader ${name}`);
      eq(got[name], verdict, `${rel}, ${what}: ${name}`);
    }
  };
  const read = (cwd, rel) => readFileSync(join(cwd, rel), 'utf8');
  const cmdGrader = (rel, name) => new RegExp(evalGrader(caseYaml(rel), name).pattern);

  // drawio-edit-built-diagram: the spec route passes; an XML edit does not.
  {
    const rel = 'drawio/edit-built-diagram';
    const cwd = fresh('built');
    evalFixtures.built.make(cwd);
    const path = './eval-input/payments.drawio';
    expect(rel, read(cwd, evalFixtures.built.FILE), path,
      { 'rebuilt-from-the-carried-spec': false, 'fraud-check-wired-in': false, 'direct-call-replaced': false, 'nothing-else-lost': true }, 'as built');
    const spec = JSON.parse(arkitectCli(['drawio', 'spec', evalFixtures.built.FILE], cwd));
    spec.nodes.push({ id: 'fraud', kind: 'box', label: 'Fraud check', col: 2, row: 0 });
    spec.edges = spec.edges.filter((e) => !(e.from === 'api' && e.to === 'psp')).concat({ from: 'api', to: 'fraud' }, { from: 'fraud', to: 'psp' });
    writeFileSync(join(cwd, 'edit.spec.json'), JSON.stringify(spec));
    arkitectCli(['drawio', 'build', 'edit.spec.json', '--out', evalFixtures.built.FILE], cwd);
    const rebuilt = read(cwd, evalFixtures.built.FILE);
    expect(rel, rebuilt, path, { 'rebuilt-from-the-carried-spec': true, 'fraud-check-wired-in': true, 'direct-call-replaced': true, 'nothing-else-lost': true }, 'rebuilt from its spec');
    assert(readdirSync(join(cwd, 'eval-input')).some((f) => evalGrader(caseYaml(rel), 'wrote-a-backup').passes(`eval-input/${f}`)), 'the rebuild\'s backup is one wrote-a-backup sees');
    // The same edit spliced into the XML: wired in, but the spec it carries is the old one.
    const spliced = read(cwd, '../built/eval-input/payments.drawio').replace(/<mxfile [^>]*>/, (m) => m.replace(/&quot;fraud&quot;/g, '&quot;f&quot;'));
    expect(rel, spliced, path, { 'rebuilt-from-the-carried-spec': false, 'fraud-check-wired-in': true }, 'edited as XML');
    for (const cmd of ['node bin/arkitect.mjs drawio spec eval-input/payments.drawio > s.json', 'node scripts/spec.mjs payments.drawio']) {
      assert(cmdGrader(rel, 'printed-the-carried-spec').test(cmd), cmd);
    }
    assert(!cmdGrader(rel, 'printed-the-carried-spec').test('node bin/arkitect.mjs drawio build edit.spec.json --out x.drawio'), 'a build is not the spec');
  }

  // drawio-edit-saved-by-desktop: an in-place edit keeps Desktop's changes;
  // a rebuild from the carried spec loses both.
  {
    const rel = 'drawio/edit-saved-by-desktop';
    const cwd = fresh('desktop');
    const { make, FILE, ADDED, FILL } = evalFixtures.desktop;
    make(cwd);
    const path = './eval-input/payments.drawio';
    const saved = read(cwd, FILE);
    assert(saved.includes(ADDED) && saved.includes(FILL), 'the fixture holds both Desktop changes');
    arkitectCli(['drawio', 'validate', FILE], cwd);
    const warned = spawnSync(process.execPath, [join(ROOT, 'bin', 'arkitect.mjs'), 'drawio', 'spec', FILE], { cwd, encoding: 'utf8' });
    eq(warned.status, 0, 'the spec is still there');
    assert(/saved by an editor since it was built/.test(warned.stderr), `spec warns: ${warned.stderr}`);
    expect(rel, saved, path, { 'kept-the-hand-added-text': true, 'kept-the-colour-set-in-desktop': true, 'fraud-check-wired-in': false, 'direct-call-replaced': false, 'nothing-else-lost': true }, 'as saved');
    const inPlace = saved
      .replace(/<mxCell id="(e\d+)" ([^>]*)source="api" target="psp">/, '<mxCell id="$1" $2source="fraud" target="psp">')
      .replace('</root>', '<mxCell id="fraud" value="Fraud check" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="560" y="109" width="120" height="60" as="geometry" /></mxCell><mxCell id="e9" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="api" target="fraud"><mxGeometry relative="1" as="geometry" /></mxCell></root>');
    expect(rel, inPlace, path, { 'kept-the-hand-added-text': true, 'kept-the-colour-set-in-desktop': true, 'fraud-check-wired-in': true, 'direct-call-replaced': true }, 'edited in place');
    const spec = JSON.parse(warned.stdout);
    spec.nodes.push({ id: 'fraud', kind: 'box', label: 'Fraud check', col: 2, row: 0 });
    spec.edges = spec.edges.filter((e) => !(e.from === 'api' && e.to === 'psp')).concat({ from: 'api', to: 'fraud' }, { from: 'fraud', to: 'psp' });
    writeFileSync(join(cwd, 'edit.spec.json'), JSON.stringify(spec));
    arkitectCli(['drawio', 'build', 'edit.spec.json', '--out', FILE], cwd);
    expect(rel, read(cwd, FILE), path, { 'kept-the-hand-added-text': false, 'kept-the-colour-set-in-desktop': false, 'fraud-check-wired-in': true }, 'rebuilt over the Desktop save');
  }

  // excalidraw-edit-built-scene: the spec route passes; the scene as built does not.
  {
    const rel = 'excalidraw/edit-built-scene';
    const cwd = fresh('scene');
    const { make, FILE } = evalFixtures.scene;
    make(cwd);
    const path = './eval-input/orders.excalidraw';
    expect(rel, read(cwd, FILE), path, { 'rebuilt-from-the-carried-spec': false, 'nothing-else-lost': true, 'names-it-redis': false }, 'as built');
    const spec = JSON.parse(arkitectCli(['excalidraw', 'spec', FILE], cwd));
    spec.nodes.push({ id: 'cache', kind: 'icon', icon: 'redis', label: 'Redis cache', col: 2, row: 1 });
    spec.edges.push({ from: 'api', to: 'cache', label: 'read' });
    writeFileSync(join(cwd, 'edit.spec.json'), JSON.stringify(spec));
    arkitectCli(['excalidraw', 'build', 'edit.spec.json', '--out', FILE, '--seed', '7'], cwd);
    expect(rel, read(cwd, FILE), path, { 'rebuilt-from-the-carried-spec': true, 'nothing-else-lost': true, 'names-it-redis': true }, 'rebuilt from its spec');
  }

  // excalidraw-edit-follows-the-scene: an element added in the scene's own
  // look passes; a redraw in the house style fails the case's key grader.
  {
    const rel = 'excalidraw/edit-follows-the-scene';
    const cwd = fresh('app-scene');
    const { make, FILE, SPEC, STROKE, FILL } = evalFixtures.appScene;
    make(cwd);
    arkitectCli(['excalidraw', 'validate', FILE], cwd);
    const path = './eval-input/shop.excalidraw';
    const scene = JSON.parse(read(cwd, FILE));
    expect(rel, JSON.stringify(scene, null, 2), path,
      { 'followed-the-scene-not-the-style-guide': true, 'no-house-stroke-colour': true, 'new-arrow-bound-at-the-start': false, 'not-redrawn-from-a-new-spec': true, 'audit-log-added-nothing-lost': false }, 'as drawn');
    const checkout = scene.elements.find((e) => e.type === 'rectangle' && scene.elements.some((t) => t.containerId === e.id && t.text === 'Checkout service'));
    const like = (over) => ({ ...checkout, groupIds: [], boundElements: [], version: 1, ...over });
    const box = like({ id: 'audit-box', x: checkout.x + 320, y: checkout.y + 200, boundElements: [{ id: 'audit-text', type: 'text' }, { id: 'audit-arrow', type: 'arrow' }] });
    const text = { ...scene.elements.find((t) => t.text === 'Stock service'), id: 'audit-text', text: 'Audit log', originalText: 'Audit log', containerId: 'audit-box', x: box.x + 40, y: box.y + 30 };
    const arrow = { ...scene.elements.find((e) => e.type === 'arrow'), id: 'audit-arrow', startBinding: { elementId: checkout.id, focus: 0, gap: 8 }, endBinding: { elementId: 'audit-box', focus: 0, gap: 8 } };
    checkout.boundElements = [...(checkout.boundElements ?? []), { id: 'audit-arrow', type: 'arrow' }];
    const edited = { ...scene, elements: [...scene.elements, box, text, arrow] };
    expect(rel, JSON.stringify(edited, null, 2), path,
      { 'followed-the-scene-not-the-style-guide': true, 'no-house-stroke-colour': true, 'new-arrow-bound-at-the-start': true, 'new-arrow-bound-at-the-end': true, 'not-redrawn-from-a-new-spec': true, 'audit-log-added-nothing-lost': true }, 'edited in its own look');
    assert(box.strokeColor === STROKE && box.backgroundColor === FILL && box.roughness === 0, 'the added box copies the scene\'s look');
    const redraw = { ...SPEC, nodes: [...SPEC.nodes, { id: 'audit', kind: 'box', label: 'Audit log', col: 2, row: 1 }], edges: [...SPEC.edges, { from: 'checkout', to: 'audit' }] };
    writeFileSync(join(cwd, 'redraw.spec.json'), JSON.stringify(redraw));
    arkitectCli(['excalidraw', 'build', 'redraw.spec.json', '--out', 'redrawn.excalidraw'], cwd);
    expect(rel, read(cwd, 'redrawn.excalidraw'), path,
      { 'followed-the-scene-not-the-style-guide': false, 'not-redrawn-from-a-new-spec': false, 'audit-log-added-nothing-lost': true }, 'redrawn in the house style');
  }

  rmSync(dir, { recursive: true, force: true });
});

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

// The edit case's validation grader failed accurate reports three times, each
// worded a new way (#368). Every wording seen passes; a report that gives no
// result, or a failing one, does not.
const diagramRead = await import(pathToFileURL(join(ROOT, 'hooks', 'diagram-read.mjs')).href);
test('the edit case recognises every accurate report wording it has failed (#368)', () => {
  const yaml = readFileSync(join(ROOT, 'evals', 'drawio', 'edit-existing-diagram', 'case.yaml'), 'utf8');
  const grader = (name) => {
    const pattern = yaml.match(new RegExp(`name: ${name}[\\s\\S]*?pattern: '([^']+)'`))?.[1];
    assert(pattern, `the ${name} grader is gone`);
    return new RegExp(pattern.replace(/''/g, "'"));
  };
  const validation = grader('reports-the-validation');
  for (const reply of [
    '**Validation**: `validate-drawio.mjs --page 0` passes with 0 warnings and 0 errors.',
    '**Validation**: `validate-drawio.mjs` on page 0 passed with no errors and no warnings.',
    '**Validation**: `validate-drawio.mjs` on `eval-input/checkout.drawio` passed (exit 0): 4 vertices, 3 edges.',
    '**Validation**: `validate-drawio.mjs --page 0` returns PASS with 4 vertices, 3 edges.',
    'The diagram validates successfully.',
    '**Validation** ✓ Passes',
    'Validation passes with no warnings.',
  ]) assert(validation.test(reply), `fails an accurate validation report: ${reply}`);
  for (const reply of [
    '**Validation**: not run.',
    '**Validation**: `validate-drawio.mjs --page 0` failed with 2 errors.',
    '**Validation**: `validate-drawio.mjs` bypassed; see below.',
    '**Validation**: `validate-drawio.mjs` failed; once fixed, it should pass.',
  ]) assert(!validation.test(reply), `passes a report with no passing result: ${reply}`);

  // Analyzing through the dispatcher is analyzing: the hook lets the Read
  // through after either form, so the grader takes the hook's own pattern.
  const analyzed = yaml.match(/name: analyzed-instead-of-reading[\s\S]*?input_match: '(.+)'\r?$/m)?.[1];
  assert(analyzed, 'the analyzed-instead-of-reading grader is gone');
  eq(analyzed.replace(/''/g, "'"), diagramRead.ANALYZE.source, 'the grader and the read hook count the same commands as analyzing');

  const matched = grader('says-it-matched-the-file');
  for (const reply of [
    '**Deviations**: The Redis box uses plain styling, not an icon, to match the rest of the file.',
    '- Redis is drawn as a plain box, not the bundled Redis icon, to match the other three plain boxes.',
    '- Redis is a plain box, not an icon, to match the file.',
    'I followed the existing file\'s style instead.',
    'The new vertex and edge use the file\'s existing style strings.',
    '- The Redis box is a plain labelled box ("Redis Cache"), not the Redis logo. The existing three boxes are plain, so I matched them, as the editing guide asks.',
    'The style guide\'s icon-first look is not applied, because the existing file uses plain boxes and I followed it.',
  ]) assert(matched.test(reply), `fails a report that says it matched the file: ${reply}`);
  for (const reply of [
    'I added Redis with the bundled icon from the house style guide.',
    'Redis uses the databases/redis mark.',
  ]) assert(!matched.test(reply), `passes a report that never says it matched the file: ${reply}`);
});

// evals/README.md counts the cases in prose and lists every one of them. Both
// go stale the moment a case is added, and a reader has no way to tell, so they
// are checked the way every other count a doc quotes is (#78, #177).
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five',
  'twenty-six', 'twenty-seven', 'twenty-eight', 'twenty-nine', 'thirty', 'thirty-one', 'thirty-two', 'thirty-three',
  'thirty-four', 'thirty-five', 'thirty-six', 'thirty-seven', 'thirty-eight', 'thirty-nine', 'forty'];

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
  const quoted = readme.match(/^([\w-]+) cases, ([\w-]+) for Draw\.io and ([\w-]+) for Excalidraw/mi);
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

  // docs/testing.md repeats the counts in a sentence, and it said 17 cases,
  // nine for Draw.io, for as long as there were 18 (#415).
  const testing = readFileSync(join(ROOT, 'docs', 'testing.md'), 'utf8').replace(/\s+/g, ' ');
  const said = testing.match(/`evals\/` holds (\d+) agent cases, ([\w-]+) for Draw\.io and ([\w-]+) for Excalidraw/);
  assert(said, 'docs/testing.md no longer says how many eval cases there are, per engine');
  eq(Number(said[1]), cases.length, `docs/testing.md says ${said[1]} eval cases; there are ${cases.length}`);
  for (const [i, engine] of ['drawio', 'excalidraw'].entries()) {
    eq(said[i + 2].toLowerCase(), NUMBER_WORDS[perEngine.get(engine) ?? 0], `docs/testing.md's count for ${engine}`);
  }
});

// Every case carries exactly one tier, and only tags evals/README.md documents:
// the summary scores each tag, and an undocumented one is a score nobody can
// read. A tier-2 or tier-3 case marks the grader it exists for with weight 3,
// the only weight used, so a score stays the share of checks passed (#415).
test('every eval case has one tier, documented tags, and its key grader weighted (#415)', () => {
  const readme = readFileSync(join(ROOT, 'evals', 'README.md'), 'utf8').replace(/\r\n/g, '\n');
  const documented = new Set([...readme.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]));
  const tiers = ['tier-1', 'tier-2', 'tier-3'];
  for (const tier of tiers) assert(documented.has(tier), `evals/README.md no longer documents ${tier}`);
  const used = new Set();
  for (const { id, dir } of evalCases()) {
    const yaml = readFileSync(join(dir, 'case.yaml'), 'utf8').replace(/\r\n/g, '\n');
    const tags = (yaml.match(/^tags:\s*\[(.*)\]/m)?.[1] ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    const own = tags.filter((t) => tiers.includes(t));
    eq(own.length, 1, `${id} carries ${own.join(', ') || 'no tier'}; give it exactly one of ${tiers.join(', ')}`);
    assert(tags.length > 1, `${id} has a tier and no competency tag`);
    for (const tag of tags) {
      used.add(tag);
      assert(documented.has(tag), `${id}: the tag ${tag} is not documented in evals/README.md`);
    }
    const weights = [...yaml.matchAll(/^ {4}weight: (\S+)$/gm)].map((m) => m[1]);
    for (const w of weights) assert(w === '3', `${id}: weight ${w}; weight: 3 marks the grader a case exists for, and no other is used`);
    if (own[0] !== 'tier-1') assert(weights.length > 0, `${id}: a ${own[0]} case marks the grader it exists for with weight: 3`);
  }
  for (const tag of documented) {
    if (!tiers.includes(tag)) assert(used.has(tag), `evals/README.md documents ${tag}, which no case uses`);
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

// AGENTS.md is the whole route on every non-Claude host, and a learning
// skill runs on the user's own diagrams; neither carried anything that changes
// what gets drawn or learned in its render internals, PR ritual or shipped-
// record rebuild, and the learning skills pointed a write into the plugin (#356).
const AGENTS_BUDGET = 14800;
test('AGENTS.md stays under its ceiling, and maintainer work lives in docs/maintenance.md (#356)', () => {
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  assert(Buffer.byteLength(agents) <= AGENTS_BUDGET, `AGENTS.md is ${Buffer.byteLength(agents)} bytes, over ${AGENTS_BUDGET}`);
  for (const gone of ['--page-index-passthrough', 'render-drawio.ps1', 'attached to or referenced from a PR']) {
    assert(!agents.includes(gone), `AGENTS.md still carries maintainer detail: ${gone}`);
  }
  assert(agents.includes('validate-only') && agents.includes('Read `docs/maintenance.md` first'), 'AGENTS.md lost its render fallback or its pointer');
  for (const engine of ['drawio', 'excalidraw']) {
    const skill = readFileSync(join(ROOT, 'skills', `learn-${engine}-style`, 'SKILL.md'), 'utf8');
    assert(!/maintaining the shipped|--out references\//i.test(skill), `learn-${engine}-style still tells an agent to rebuild the shipped record`);
  }
  const maintenance = readFileSync(join(ROOT, 'docs', 'maintenance.md'), 'utf8');
  assert(maintenance.includes('### Rebuilding the shipped house style') && maintenance.includes('build-knowledge.mjs'),
    'docs/maintenance.md does not say how the shipped record is rebuilt');
  assert(maintenance.includes('never attach it to a pull request'), 'docs/maintenance.md does not hold the render rule for pull requests');
  assert(maintenance.includes(`${AGENTS_BUDGET.toLocaleString('en-US')} bytes`), 'docs/maintenance.md does not state the AGENTS.md ceiling');
});

// "Offer nothing Arkitect cannot do" (#183) has to be true itself: the Draw.io
// skill said there was no PDF export while its renderer wrote one (#256).
test('neither drawing skill denies an export format its renderer accepts (#256)', () => {
  for (const [engine, script, list] of [
    ['arkitect-drawio', 'render-drawio.mjs', /\[--format ([a-z|]+)\]/],
    ['arkitect-excalidraw', 'render-excalidraw.mjs', /--format ([a-z|]+)\]/],
  ]) {
    const skill = readFileSync(join(ROOT, 'skills', engine, 'SKILL.md'), 'utf8');
    const source = readFileSync(join(ROOT, 'skills', engine, 'scripts', script), 'utf8');
    const formats = list.exec(source)[1].split('|');
    const denied = [...skill.matchAll(/there is no ([^.,;:]+?) export/gi)]
      .flatMap((m) => m[1].split(/\s+or\s+|,\s*/)).map((w) => w.trim().toLowerCase());
    assert(denied.length, `${engine}: SKILL.md no longer says which exports do not exist`);
    for (const word of denied) assert(!formats.includes(word), `${engine}: SKILL.md denies a ${word} export, and ${script} accepts --format ${word}`);
  }
  const rendering = readFileSync(join(ROOT, 'skills', 'arkitect-drawio', 'references', 'rendering.md'), 'utf8');
  assert(rendering.includes('--format pdf'), 'references/rendering.md does not show the PDF export');
});

// Draw.io Desktop leaves `.$<name>.drawio.bkp`, a full copy of the diagram,
// beside any file it has open; the ignore advice named only our own backups
// (#252).
test('the ignore advice and this repository cover Draw.io Desktop\'s own .bkp (#252)', () => {
  for (const path of ['AGENTS.md', 'docs/cli.md', 'skills/arkitect-drawio/SKILL.md']) {
    const text = readFileSync(join(ROOT, path), 'utf8');
    assert(text.includes('`*.backup-*`') && text.includes('`.$*.bkp`'), `${path} does not suggest both patterns`);
  }
  assert(readFileSync(join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).includes('.$*.bkp'), '.gitignore has no .$*.bkp line');
  assert(readFileSync(join(ROOT, 'docs', 'privacy.md'), 'utf8').includes('| `.$*.bkp` |'), 'docs/privacy.md does not list .$*.bkp');
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

// A raw control character in source is invisible in review and in most
// terminals. One sat in a regex as a backspace where `\b` was meant, so the
// #150 preview-safety assertion could never fail (#365). A fixture that needs
// one writes it as an escape.
test('no committed text file holds a raw control character (#365)', () => {
  const C0 = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
  const scripts = repoFiles(ROOT, ({ name }) => /\.(sh|ya?ml)$/i.test(name));
  const hits = [];
  for (const f of new Set([...FILES, ...scripts])) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = line.match(C0);
      if (m) hits.push(`${relative(ROOT, f)}:${i + 1}: U+${m[0].charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}`);
    });
  }
  assert(hits.length === 0, `raw control characters; write them as \\uXXXX escapes:\n        ${hits.slice(0, 10).join('\n        ')}`);
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
  for (const source of ['simple-icons@16.35.0', 'devicon@2.17.0', 'lucide-static@1.57.0',
    '@primer/octicons@19.40.0', 'azure-v24', 'gcp-legacy']) {
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
const PACKAGE_DIRS = ['bin', 'skills', '.claude-plugin', 'hooks', 'docker', 'docs'];
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

  // bash -n is a parse, not a run: nothing in the script executes. The path is
  // relative because the bash found on Windows may be WSL's, which reads
  // C:\... as one name with its backslashes stripped (#267).
  const bash = spawnSync('bash', ['-n', 'scripts/eval.sh'], { cwd: ROOT, encoding: 'utf8' });
  if (bash.error) { console.log('      (bash was not found, so the parse check was skipped)'); return 'skip'; }
  eq(bash.status, 0, `bash rejected scripts/eval.sh: ${(bash.stderr || '').trim().slice(0, 200)}`);
});

// It passed --threshold 0 and exited with the run's own status, so a batch
// whose every run errored exited 0. Under WSL it took the Windows claude from
// /mnt/c, and it still accepted Node 20 (#369). Run for real against stubs:
// a `claude` that writes the result it is handed, and a `node` that says 20.
test('scripts/eval.sh exits with the verdict, and refuses Node 20 (#369)', () => {
  const sh = readFileSync(join(ROOT, 'scripts', 'eval.sh'), 'utf8');
  assert(/\/mnt\/\[a-zA-Z\]\/\*\)/.test(sh) && sh.includes('linux claude'), 'the WSL check for a Windows claude is gone');
  assert(sh.includes('args+=(--keep-temp)') && sh.includes('--traces "$OUT/traces"') && sh.includes('chmod -R u+rwx "$RUN_TMP"'),
    'the traces are no longer kept, or their temp dirs no longer removed (#374)');
  // The script refuses Windows itself, so here only the text above is checked;
  // a skip would count against the fresh-clone total (#47).
  if (process.platform === 'win32') { console.log('      (the script runs on Linux and macOS; its run was checked there)'); return; }

  const dir = join(TMP, 'eval-sh');
  const bin = join(dir, 'bin');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(bin, { recursive: true });
  const stub = (name, body) => { writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  // Like the real one with --keep-temp: a read-only temp dir holding the trace.
  stub('claude', ['keep=0; for a in "$@"; do [ "$a" = --keep-temp ] && keep=1; done',
    'echo "$keep $TMPDIR" > "$STUB_SEEN"',
    'if [ $keep = 1 ]; then k="$TMPDIR/claude-eval-stub"; mkdir -p "$k/out"; echo trace > "$k/out/trace.jsonl"; chmod 500 "$k/out" "$k"; fi',
    'while [ $# -gt 0 ]; do [ "$1" = --json ] && sed "s|@TMP@|$TMPDIR|g" "$STUB_RESULT" > "$2"; shift; done; exit 0'].join('\n'));
  stub('bwrap', 'exit 0');
  stub('socat', 'exit 0');
  const env = { ...process.env, HOME: dir, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin` };
  const run = (result, args = [], more = {}) => {
    writeFileSync(join(dir, 'result.json'), JSON.stringify(result));
    return spawnSync('bash', ['scripts/eval.sh', '--out', join(dir, 'out'), ...args], {
      cwd: ROOT, encoding: 'utf8', env: { ...env, STUB_RESULT: join(dir, 'result.json'), STUB_SEEN: join(dir, 'seen'), ...more },
    });
  };
  const errored = run({ cases: [{ name: 'c', arms: { with: [{ score: 0, error: 'scaffold failed (exit 127)' }] } }],
    aggregates: { overallScore: 0, overallPassRate: 0 } });
  eq(errored.status, 1, `every run errored, so the script fails:\n${errored.stdout.slice(-400)}`);
  const clean = run({ cases: [{ name: 'c', arms: { with: [{ score: 1, graders: [{ name: 'g', passed: true }] }] } }],
    aggregates: { overallScore: 1, overallPassRate: 1 } });
  eq(clean.status, 0, `a clean run passes:\n${clean.stdout.slice(-400)}`);

  // Each run's trace is kept with the results, and the temp dir it came from,
  // read-only and holding a copy of the Claude config, is gone (#374).
  const failed = run({ cases: [{ name: 'c', arms: { with: [{ score: 0.5, tracePath: '@TMP@/claude-eval-stub/out/trace.jsonl',
    graders: [{ name: 'g', passed: false }] }] } }], aggregates: { overallScore: 0.5, overallPassRate: 0 } });
  eq(failed.status, 1, 'a failed grader fails the run');
  const [keep, tmp] = readFileSync(join(dir, 'seen'), 'utf8').trim().split(' ');
  eq(keep, '1', 'the run is told to keep its temp dirs');
  assert(tmp.includes('arkitect-eval-home'), `in a TMPDIR of its own: ${tmp}`);
  eq(readFileSync(join(dir, 'out', 'traces', 'c-run1.jsonl'), 'utf8').trim(), 'trace', 'the trace is copied');
  assert(failed.stdout.includes('trace: traces/c-run1.jsonl'), `the failure names its trace:\n${failed.stdout.slice(-400)}`);
  assert(!existsSync(tmp), `the kept temp dir is removed: ${tmp}`);
  const own = join(dir, 'tmp');
  mkdirSync(own, { recursive: true });
  run({ cases: [], aggregates: {} }, ['--', '--keep-temp'], { TMPDIR: own });
  eq(readFileSync(join(dir, 'seen'), 'utf8').trim(), `1 ${own}`, 'asked to keep them, they stay where they were');
  assert(existsSync(join(own, 'claude-eval-stub', 'out', 'trace.jsonl')), 'and are not removed');
  chmodSync(join(own, 'claude-eval-stub'), 0o755);
  chmodSync(join(own, 'claude-eval-stub', 'out'), 0o755);

  stub('node', 'echo 20');
  const old = spawnSync('bash', ['scripts/eval.sh', '--check'], { cwd: ROOT, encoding: 'utf8', env });
  eq(old.status, 2, 'Node 20 is refused');
  assert(old.stdout.includes('node >= 22'), old.stdout);
  rmSync(dir, { recursive: true, force: true });
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

  // --traces copies each run's trace out of the temp dir and names it under a
  // failure; a run whose trace is gone is reported without one (#374).
  const traceFile = join(TMP, 'eval-trace.jsonl');
  writeFileSync(traceFile, '{"type":"assistant"}\n');
  writeFileSync(join(TMP, 'eval-result.json'), JSON.stringify({
    cases: [{ name: 'drawio-x', arms: { with: [{ score: 0.5, tracePath: traceFile, graders: [{ name: 'g', passed: false }] },
      { score: 0.5, tracePath: join(TMP, 'gone.jsonl'), graders: [{ name: 'g', passed: false }] }] } }],
    aggregates: {} }));
  const kept = join(TMP, 'eval-traces');
  rmSync(kept, { recursive: true, force: true });
  const traced = spawnSync(process.execPath, [summary, '--traces', kept, join(TMP, 'eval-result.json')], { encoding: 'utf8' });
  eq(traced.status, 1, 'still gates');
  eq(readFileSync(join(kept, 'drawio-x-run1.jsonl'), 'utf8'), '{"type":"assistant"}\n', 'the trace is copied');
  assert(traced.stdout.includes('trace (run 1): eval-traces/drawio-x-run1.jsonl'), traced.stdout);
  assert(!traced.stdout.includes('trace (run 2)'), `a trace that is gone is not named:\n${traced.stdout}`);
  eq(spawnSync(process.execPath, [summary, join(TMP, 'eval-result.json'), '--traces'], { encoding: 'utf8' }).status, 2, '--traces needs a folder');
});

// Every case scored 1.00, so the suite stopped telling a better agent from a
// worse one, and a case meant to be hard would fail the gate for ever (#415).
// The summary reads each case's tier and tags, gates on tier 1, scores every
// tier and competency, reads how each run worked from its trace, and writes
// and compares a scoreboard that holds no path.
test('the eval summary scores tiers and competencies, gates on tier 1, and keeps a scoreboard (#415)', () => {
  const summary = join(ROOT, 'scripts', 'eval-summary.mjs');
  const dir = join(TMP, 'eval-415');
  rmSync(dir, { recursive: true, force: true });
  const caseDir = (name, tags) => {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'case.yaml'), `schema_version: "1.1"\nname: ${name}\ntags: [${tags.join(', ')}]\n`);
    return join(dir, name);
  };
  const trace = join(dir, 'trace.jsonl');
  mkdirSync(dir, { recursive: true });
  writeFileSync(trace, [
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }, { type: 'tool_use', name: 'Read', input: {} }] } },
    { type: 'system', subtype: 'permission_denied' },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'x'.repeat(2048), is_error: true }, { type: 'tool_result', content: [{ type: 'text', text: 'ok' }] }] } },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const ran = (score, graders = [], more = {}) => ({ score, turns: 9, costUsd: 0.02, tracePath: trace, graders: [{ name: 'ran', passed: true }, ...graders], ...more });
  const result = (floor, headroom) => ({
    startedAt: '2026-10-16T08:00:00.000Z', claudeVersion: '2.1.300', costUsd: 0.1, durationSeconds: 60,
    suite: { modelOverride: 'claude-haiku-5-5', judgeModel: 'claude-sonnet-5-5', plugins: [{ name: 'arkitect', version: '2.3.2', path: '/home/Jane Doe/arkitect' }] },
    cases: [
      { name: 'drawio-floor', dir: caseDir('drawio-floor', ['generation', 'tier-1']), maxTurns: 30, promptMarkdown: 'a secret prompt', arms: { with: [ran(floor)] } },
      { name: 'drawio-headroom', dir: caseDir('drawio-headroom', ['editing', 'safety', 'tier-2']), maxTurns: 9, arms: { with: [
        ran(headroom, [{ name: 'kept-the-note', passed: false, weight: 3, explanation: 'pattern not found' }, { name: 'said-so', passed: false, weight: 1 }]),
        ran(1)] } },
    ],
    aggregates: { casesTotal: 2, casesPassed: 2, overallScore: 0.9, overallPassRate: 0.5 },
  });
  const sum = (json, args = []) => {
    const file = join(dir, `result-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, JSON.stringify(json));
    return spawnSync(process.execPath, [summary, file, ...args], { encoding: 'utf8' });
  };

  const headroom = sum(result(1, 0.5));
  eq(headroom.status, 0, `a tier-2 case below 1 is headroom, not a failure:\n${headroom.stdout}`);
  assert(headroom.stdout.includes('gate: pass'), headroom.stdout);
  for (const line of [/^tier-1$/m, /^tier-2$/m, /^ {2}tier-2 +1 +0\.75 +0$/m, /^ {2}editing +1 +0\.75/m, /^ {2}generation +1 +1\.00 +1$/m]) {
    assert(line.test(headroom.stdout), `the scorecard lost ${line}:\n${headroom.stdout}`);
  }
  assert(/CRIT \(run 1\) {2}kept-the-note/.test(headroom.stdout), `a weight-3 failure is critical:\n${headroom.stdout}`);
  assert(/FAIL \(run 1\) {2}said-so/.test(headroom.stdout), `a weight-1 failure is an ordinary one:\n${headroom.stdout}`);
  assert(headroom.stdout.includes('used all 9 turns'), `a run that used every turn is named:\n${headroom.stdout}`);
  assert(/2 tool calls per run · 3 failed or refused · 3 denied · 2 KB of tool output per run/.test(headroom.stdout),
    `the efficiency line reads the traces:\n${headroom.stdout}`);
  assert(headroom.stdout.includes('· 2 runs used every turn · 1 critical failure'), `the efficiency line counts both:\n${headroom.stdout}`);

  const floor = sum(result(0.9, 1));
  eq(floor.status, 1, 'a tier-1 case below 1 fails the run');
  assert(floor.stdout.includes('gate: FAIL - 1 tier-1 case below 1.00'), floor.stdout);

  // The scoreboard holds scores and counts, and no path, prompt or reply.
  const board = join(dir, 'board', 'scoreboard.json');
  eq(sum(result(1, 0.5), ['--scoreboard', board]).status, 0, 'writing a scoreboard changes no verdict');
  const written = JSON.parse(readFileSync(board, 'utf8'));
  eq(written.schema, 'arkitect-eval-scoreboard/1', 'the scoreboard names its schema');
  eq(JSON.stringify(written.run), JSON.stringify({ date: '2026-10-16', claude: '2.1.300', plugin: '2.3.2', model: 'claude-haiku-5-5', judge: 'claude-sonnet-5-5', costUsd: 0.1 }), 'the run it records');
  eq(written.cases['drawio-headroom'].score, 0.75, 'a case score');
  eq(written.cases['drawio-headroom'].tier, 'tier-2', 'a case tier');
  const strings = JSON.stringify(written).match(/"[^"]*"/g);
  for (const s of strings) {
    if (s !== `"${written.schema}"`) assert(!/[\\/]/.test(s) && !s.includes('secret'), `the scoreboard holds ${s}`);
  }

  // Against that scoreboard: a case that falls further than the tolerance
  // fails, a smaller dip is reported, and a case it has never seen is new.
  const fell = sum(result(1, 0), ['--baseline', board]);
  eq(fell.status, 1, `a case 0.25 below its baseline fails:\n${fell.stdout}`);
  assert(/drawio-headroom .*−0\.25 on 0\.75 {2}REGRESSED/.test(fell.stdout), fell.stdout);
  assert(fell.stdout.includes('1 regressed more than 0.2 on the baseline'), fell.stdout);
  eq(sum(result(1, 0), ['--baseline', board, '--tolerance', '0.5']).status, 0, 'within a wider tolerance');
  assert(/drawio-headroom .*−0\.15 on 0\.75$/m.test(sum(result(1, 0.2), ['--baseline', board]).stdout), 'a smaller dip is reported, not failed');
  const grown = result(1, 0.5);
  grown.cases.push({ name: 'excalidraw-new', dir: caseDir('excalidraw-new', ['icons', 'tier-3']), arms: { with: [ran(0.4)] } });
  const fresh = sum(grown, ['--baseline', board]);
  eq(fresh.status, 0, fresh.stdout);
  assert(/excalidraw-new .* new$/m.test(fresh.stdout) && /^tier-3$/m.test(fresh.stdout), fresh.stdout);
  // A result.json serves as a baseline too.
  const old = join(dir, 'old-result.json');
  writeFileSync(old, JSON.stringify(result(1, 1)));
  assert(/drawio-headroom .*−0\.25 on 1\.00 {2}REGRESSED$/m.test(sum(result(1, 0.5), ['--baseline', old]).stdout), 'a result as the baseline');

  for (const args of [['--tolerance', '-1'], ['--bogus'], ['--baseline', join(dir, 'missing.json')], ['--baseline']]) {
    eq(sum(result(1, 1), args).status, 2, `refused: ${args.join(' ')}`);
  }

  // scripts/eval.sh writes the scoreboard beside every result and forwards
  // --baseline and --tolerance, and --tier is a tag.
  const sh = readFileSync(join(ROOT, 'scripts', 'eval.sh'), 'utf8');
  assert(sh.includes('--scoreboard "$OUT/scoreboard.json"'), 'scripts/eval.sh no longer writes a scoreboard');
  assert(sh.includes('summary+=(--baseline "$BASELINE")') && sh.includes('summary+=(--tolerance "$TOLERANCE")'), 'the baseline is not forwarded');
  assert(sh.includes('TAGS+=("tier-$2")'), '--tier is no longer a tag');
  rmSync(dir, { recursive: true, force: true });
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
      // patterns.json is a map of fragments, each a partial spec tagged with the
      // catalog section it belongs to; since #221 its fragment names would read
      // as unknown top-level keys, and its fragments were never checked at all.
      const specs = file === 'patterns.json'
        ? Object.entries(spec).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v))
          .map(([name, { pattern, ...fragment }]) => [`${file} ${name}`, fragment])
        : [[file, spec]];
      for (const [where, s] of specs) {
        checked++;
        const unknown = builder.unknownFields(s);
        eq(unknown.length, 0,
          `${engine}/${where} would warn about ${unknown.map((u) => u.field).join(', ')} - add the field to the builder's list, or fix the template`);
      }
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

test('the release workflows are started by a person, gated by a merged pull request, and publish to npm only after the Release (#88, #126)', () => {
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
  const steps = (yml) => yml.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  assert(!/npm publish|npm_token|NODE_AUTH_TOKEN|registry-url/i.test(steps(prepare)), 'prepare must not publish to npm');
  // Publish may, once the tag and the Release exist, with provenance; a
  // missing secret warns rather than fails, and a version already there is
  // left alone so a rerun passes (#126).
  const npm = steps(publish).indexOf('npm publish');
  assert(npm > steps(publish).indexOf('gh release create'), 'npm after the Release');
  assert(/npm publish --provenance --access public/.test(publish) && /id-token: write/.test(publish), 'with provenance');
  assert(/if \[ -z "\$NODE_AUTH_TOKEN" \]; then\s+echo "::warning::/.test(publish), 'no secret: a warning, not a failure');
  assert(/npm view "arkitect@\$VERSION" version/.test(publish), 'already published: skipped');
  const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert(/npm publish --dry-run/.test(ci), 'CI dry-runs it');
  // npm 12 refuses a dry run over a published version: main went red at 2.2.0.
  assert(/npm pkg set version=.*-ci\./.test(ci) && /--dry-run[^\n]*--tag ci/.test(ci), 'on a version nothing has used');
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

  // Ambiguity stays a question, with bounded choices, in both engines. It was
  // "monitor" until that became a generic word, answered with a placeholder
  // node instead (#231).
  const kinesis = ask('drawio', 'kinesis');
  eq(kinesis.confident, false, 'drawio: an ambiguous search is not settled');
  assert(!('node' in kinesis) && kinesis.needsAChoice && kinesis.choices.length === 4 && kinesis.more > 0, 'drawio: choices, not a node');
  const doubtful = ask('excalidraw', 'tempo');
  assert(!('draws' in doubtful) && !('node' in doubtful) && doubtful.placeholder && doubtful.choices.length <= 4, 'excalidraw: choices, not a node');

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

// Asked about a diagram's style, the agent loaded no skill and promised to
// remember it (#265). The hook speaks only in a session whose prompt asked
// about a diagram's style, so it costs nothing on a drawing request; there it
// adds the rule, and sends back once a reply that still makes the promise.
const styleHook = await import(pathToFileURL(join(ROOT, 'hooks', 'style-question.mjs')).href);
test('the style-question hook speaks only for a prompt about a diagram\'s style, and never fails one (#265)', () => {
  const hooks = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  eq(Object.keys(hooks).join(), 'PreToolUse,UserPromptSubmit,Stop', 'three events');
  for (const event of [hooks.UserPromptSubmit, hooks.Stop]) {
    eq(event[0].hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/style-question.mjs"', 'runs the script from the plugin');
  }
  const { ruleFor, RULE, SEND_BACK, promisesToRemember, respond, lastReply } = styleHook;

  const promptOf = (engine, name) => readFileSync(join(ROOT, 'evals', engine, name, 'case.yaml'), 'utf8')
    .replace(/\r\n/g, '\n').match(/prompt: \|\n([\s\S]*?)\n\n/)[1];
  const speaks = new Set(['drawio/apply-skill-stays-manual', 'excalidraw/apply-skill-stays-manual', 'excalidraw/learning-skill-stays-manual']);
  for (const engine of ['drawio', 'excalidraw']) {
    for (const name of readdirSync(join(ROOT, 'evals', engine))) {
      if (!existsSync(join(ROOT, 'evals', engine, name, 'case.yaml'))) continue;
      eq(ruleFor(promptOf(engine, name)), speaks.has(`${engine}/${name}`) ? RULE : null, `${engine}/${name}`);
    }
  }
  eq(ruleFor('/learn-drawio-style C:\\diagrams\\a.drawio'), null, 'running the command is the user doing what the rule asks');

  // Every closing line the eval recorded, and two that are fine.
  for (const said of ["Good to know your style preference — I'll apply the same when working with your diagrams going forward.",
    'Got it—I\'ll remember this style for future diagrams you create.', "Got it—I'll keep that style in mind for any diagrams you create.",
    "Got it — I'll keep those preferences in mind for future diagrams.", "I'll keep that in mind for future diagram work",
    'So your preferred style is rounded corners. Got it — I can apply that when you create diagrams going forward.']) {
    assert(promisesToRemember(said), `a promise: ${said}`);
  }
  for (const said of ['Nice preferences — rounded + dashed gives it a cleaner, more approachable look!',
    'Run /learn-drawio-style to record that style, then /apply-drawio-style to have later builds draw with it.',
    '/learn-excalidraw-style records what your diagrams do; it changes no build by itself.',
    'The diagram uses rounded corners and the arrow is dashed — exactly the style you like.']) {
    assert(!promisesToRemember(said), `no promise: ${said}`);
  }

  const dir = mkdtempSync(join(tmpdir(), 'arkitect-hook-'));
  try {
    const ask = (session, prompt) => respond({ hook_event_name: 'UserPromptSubmit', session_id: session, prompt }, dir);
    const stop = (session, reply, active = false) => respond({ hook_event_name: 'Stop', session_id: session, last_assistant_message: reply, stop_hook_active: active }, dir);
    const promise = "Rounded, and dashed. I'll keep that in mind for future diagrams.";
    eq(ask('s1', 'Does a.drawio use rounded corners? I like my diagrams that way.'), RULE, 'the rule, for a style question');
    eq(JSON.parse(stop('s1', promise)).reason, SEND_BACK, 'the promise is sent back');
    eq(stop('s1', promise, true), null, 'once: the second stop is final');
    eq(stop('s1', promise), null, 'and the session is released');
    eq(ask('s2', 'Draw our AWS pipeline in Draw.io'), null, 'nothing for a drawing request');
    eq(stop('s2', promise), null, 'and its replies are never read');
    ask('s3', 'Is the arrow in a.drawio dashed?');
    eq(stop('s3', 'Yes, it is dashed.'), null, 'a clean answer stops');

    // A Claude Code that passes no last message: read it from the transcript.
    const transcript = join(dir, 't.jsonl');
    writeFileSync(transcript, [JSON.stringify({ type: 'user', message: { role: 'user', content: 'q' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: promise }] } })].join('\n'));
    eq(lastReply(transcript), promise, 'the last assistant text');
    ask('s4', 'Are the corners in a.drawio rounded?');
    assert(respond({ hook_event_name: 'Stop', session_id: 's4', transcript_path: transcript }, dir), 'sent back from the transcript');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const run = (input) => spawnSync(process.execPath, [join(ROOT, 'hooks', 'style-question.mjs')], { input, encoding: 'utf8' });
  const said = run(JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'test-265-cli', prompt: 'Does eval-input/a.drawio use rounded corners?' }));
  eq([said.status, said.stdout.trim()].join('|'), `0|${RULE}`, 'printed for Claude Code to add');
  run(JSON.stringify({ hook_event_name: 'Stop', session_id: 'test-265-cli', stop_hook_active: true }));
  for (const input of ['', 'not json', JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'Draw our AWS pipeline' }),
    JSON.stringify({ hook_event_name: 'Stop', session_id: 'never-asked', transcript_path: '/nowhere' })]) {
    const quiet = run(input);
    eq([quiet.status, quiet.stdout].join('|'), '0|', `silent and exit 0 on ${JSON.stringify(input)}`);
  }
});

// Reports after a build dropped headings (#215) and described renders nobody
// saw; the replies below are the 3.0.0 batch's, cut to the sentence that
// counts. The hook reads a transcript only when a reply names a diagram.
const reportHook = await import(pathToFileURL(join(ROOT, 'hooks', 'report-check.mjs')).href);
test('the report check sends back a report missing headings, or one describing a render nobody saw, once (#215)', () => {
  const stop = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks.Stop[0].hooks;
  eq(stop.map((h) => h.command).join(' | '), 'node "${CLAUDE_PLUGIN_ROOT}/hooks/style-question.mjs" | node "${CLAUDE_PLUGIN_ROOT}/hooks/report-check.mjs"', 'a second Stop hook');
  const { problems, describesThePicture, respond } = reportHook;
  const report = (render) => ['**File** `./eval-output/orders.excalidraw`', '**Assumptions** none', '**Icons** none',
    '**Validation** PASS, no warnings', `**Render** ${render}`, '**Deviations** none'].join('\n');

  for (const said of ['SVG rendered. Layout is clean with the pipeline on the main flow.',
    'PNG rendering unavailable in sandbox. SVG confirms structure and spacing.',
    'SVG rendered successfully. Layout shows clean vertical flow: frontend → API → worker.',
    'Both will render the two-page comparison with all icons embedded and spacing correct.']) {
    assert(describesThePicture(said), `a claim: ${said}`);
  }
  for (const said of ['Render to PNG failed due to headless environment. Validation confirms structural correctness; visual inspection not possible in this session.',
    '🔴 Render failed: Draw.io Desktop unavailable in this environment. Diagram validates structurally.',
    "SVG written; I haven't seen it, so the spacing is only validate's finding: no crossings."]) {
    eq(describesThePicture(said), null, `honest: ${said}`);
  }
  eq(problems(report('failed, not seen.'), { viewed: false }).length, 0, 'a whole, honest report');
  eq(problems(report('Layout is clean.'), { viewed: true }).length, 0, 'a PNG was opened');
  assert(/no Validation, Render, Deviations headings/.test(problems('Done! Saved `x.drawio`.\n**File** x\n**Assumptions** y\n**Icons** z', { viewed: true })[0]),
    'names what is missing');

  const dir = mkdtempSync(join(tmpdir(), 'arkitect-report-'));
  try {
    const transcript = join(dir, 't.jsonl');
    const use = (name, input) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } });
    const bad = report('Layout is clean.');
    writeFileSync(transcript, [use('Bash', { command: 'node skills/arkitect-excalidraw/scripts/build-diagram.mjs s.json --out ./eval-output/orders.excalidraw' }),
      use('Read', { file_path: 'o.svg' })].join('\n'));
    const sent = JSON.parse(respond({ hook_event_name: 'Stop', transcript_path: transcript, last_assistant_message: bad }));
    eq(sent.decision, 'block', 'sent back');
    assert(/Render says "Layout"/.test(sent.reason), sent.reason);
    eq(respond({ hook_event_name: 'Stop', transcript_path: transcript, last_assistant_message: bad, stop_hook_active: true }), null, 'once');
    writeFileSync(transcript, use('Read', { file_path: 'o.drawio' }));
    eq(respond({ hook_event_name: 'Stop', transcript_path: transcript, last_assistant_message: bad }), null, 'no build, no check');
    eq(respond({ hook_event_name: 'Stop', transcript_path: '/nowhere', last_assistant_message: 'Hello.' }), null, 'a reply naming no diagram is not read further');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const run = (input) => spawnSync(process.execPath, [join(ROOT, 'hooks', 'report-check.mjs')], { input, encoding: 'utf8' });
  for (const input of ['', 'not json', JSON.stringify({ hook_event_name: 'Stop', transcript_path: '/nowhere' })]) {
    const quiet = run(input);
    eq([quiet.status, quiet.stdout].join('|'), '0|', `silent and exit 0 on ${JSON.stringify(input)}`);
  }
});

// docs/install.md teaches `arkitect` and `npx arkitect`; a build by either was
// not a build to the check, so the same report went unchecked (#301).
test('the report check counts a build by the installed, npx or script command, under any engine alias (#301)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arkitect-report-'));
  try {
    const transcript = join(dir, 't.jsonl');
    const built = (name, command) => {
      writeFileSync(transcript, JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name, input: { command } }] } }));
      return reportHook.sessionOf(transcript).built;
    };
    for (const command of ['arkitect drawio build a.json --out a.drawio', 'arkitect excalidraw build a.json --out a.excalidraw',
      'npx arkitect drawio build a.json --out a.drawio', 'npx -y arkitect@2.2.0 excalidraw build a.json --out a.excalidraw',
      'cd docs && arkitect dio build a.json --out a.drawio', 'arkitect draw.io build a.json', 'arkitect ex build a.json',
      'node "C:\\Program Files\\arkitect\\bin\\arkitect.mjs" excali build a.json', "node '/opt/arkitect/bin/arkitect.mjs' drawio build a.json",
      'node bin/arkitect.mjs drawio build a.json --out a.drawio', 'node skills/arkitect-excalidraw/scripts/build-diagram.mjs a.json']) {
      assert(built('Bash', command), `not a build: ${command}`);
    }
    assert(built('PowerShell', 'arkitect drawio build a.json --out a.drawio'), 'a build in the PowerShell tool');
    for (const command of ['arkitect drawio validate a.drawio', 'arkitect excalidraw render a.excalidraw --format svg',
      'npx arkitect drawio icon build', 'node skills/arkitect-drawio/scripts/validate-drawio.mjs a.drawio', 'ls arkitect-drawio build']) {
      assert(!built('Bash', command), `a build: ${command}`);
    }
    assert(!built('Read', 'arkitect drawio build a.json'), 'only a shell tool builds');
    // Only a run of the script is a build; reading or committing it isn't (#373).
    for (const command of ['for f in a b; do ./skills/arkitect-drawio/scripts/build-diagram.mjs $f.json; done',
      'cd x && skills/arkitect-drawio/scripts/build-diagram.mjs a.json', 'node --no-warnings "C:\\a\\build-diagram.mjs" a.json']) {
      assert(built('Bash', command), `not a build: ${command}`);
    }
    for (const command of ['git add skills/arkitect-drawio/scripts/build-diagram.mjs', 'grep -n "--out" skills/arkitect-drawio/scripts/build-diagram.mjs',
      'sed -n 1405,1450p skills/arkitect-excalidraw/scripts/build-diagram.mjs', 'cd x && git diff skills/arkitect-drawio/scripts/build-diagram.mjs']) {
      assert(!built('Bash', command), `a build: ${command}`);
    }
    // An install under a home folder with a space is quoted (#382).
    const spaced = 'D:/Profiles/Jane Doe/.claude/plugins/cache/arkitect/arkitect/2.3.2/skills/arkitect-drawio/scripts/build-diagram.mjs';
    for (const command of [`node "${spaced}" spec.json --out orders.drawio`, "node '/Users/Jane Doe/arkitect/skills/arkitect-excalidraw/scripts/build-diagram.mjs' a.json",
      `cd x && "${spaced}" a.json`]) {
      assert(built('Bash', command), `not a build: ${command}`);
    }
    eq(reportHook.outOf(`node "${spaced}" spec.json --out orders.drawio`), 'orders.drawio', 'the --out of a spaced build');
    for (const command of [`grep -n x "${spaced}"`, `git add "${spaced}"`, `node -e "1" ; grep x "${spaced}"`]) {
      assert(!built('Bash', command), `a build: ${command}`);
    }

    built('Bash', 'arkitect drawio build a.json --out a.drawio');
    const sent = JSON.parse(reportHook.respond({ hook_event_name: 'Stop', transcript_path: transcript, last_assistant_message: 'Done: a.drawio' }) ?? 'null');
    assert(/no File, Assumptions, Icons, Validation, Render, Deviations headings/.test(sent?.reason), 'the installed build is checked like the script one');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A closing summary hours after a build run to reproduce a bug mentioned "an
// existing `.drawio`" and was sent back for six headings (#345). Only a reply
// naming a file the session built is a report of it.
test('the report check reads only a reply naming a file the session built (#345)', () => {
  const { outOf, namesABuiltFile, respond } = reportHook;
  eq(outOf('node bin/arkitect.mjs drawio build p329.json --out C:\\tmp\\p329.drawio'), 'p329.drawio', 'a Windows path');
  eq(outOf('arkitect excalidraw build a.json --out="docs/my arch.excalidraw"'), 'my arch.excalidraw', 'quoted, with =');
  eq(outOf('arkitect drawio build a.json --out "$OUT"'), '*', 'a shell variable stands for any file');
  eq(outOf('arkitect drawio build a.json'), null, 'no --out');
  // A variable in the folder leaves the name; one in the name is read from the
  // same command, or stands for any file (#373).
  const { outsOf } = reportHook;
  eq(outOf('SP=C:/x/ritual && node bin/arkitect.mjs drawio build s.json --out $SP/a.drawio'), 'a.drawio', 'a variable folder');
  eq(outsOf('for n in starter as-is; do arkitect drawio build $n.spec.json --out "$T/$n.drawio"; done').join(), 'starter.drawio,as-is.drawio', 'a loop');
  eq(outOf('OUT=docs/arch.drawio; arkitect drawio build a.json --out "$OUT"'), 'arch.drawio', 'set in the command');
  eq(outOf('$out = "docs/p.excalidraw"; arkitect excalidraw build a.json --out $out'), 'p.excalidraw', 'set in PowerShell');
  eq(outOf("s = 'node b/build-diagram.mjs s.json --out o.excalidraw'"), 'o.excalidraw', 'no quote kept');
  eq(outsOf('arkitect drawio build a.json --out a.drawio && arkitect drawio build b.json --out=b.drawio').join(), 'a.drawio,b.drawio', 'two builds');
  eq(outsOf('arkitect drawio build a.json --out docs/').join(), '', 'a folder names no file');
  assert(namesABuiltFile('Saved `docs/arch.drawio`.', ['*']), 'any file is still a file');
  for (const reply of ['#339 is about an existing `.drawio`.', 'It mentioned `.drawio` and `.excalidraw` files in passing.']) {
    assert(!namesABuiltFile(reply, ['*']), `no file named: ${reply}`);
  }
  assert(namesABuiltFile('Saved `./docs/p329.drawio`.', ['p329.drawio']), 'by path');
  assert(namesABuiltFile('**File** P329.drawio', ['p329.drawio']), 'any case');
  for (const reply of ['#339 is about an existing `.drawio`.', 'See xp329.drawio.', 'See p329.drawio.bak']) {
    assert(!namesABuiltFile(reply, ['p329.drawio']), reply);
  }
  // A name the command can't resolve keeps its folder, so a reply quoting an
  // unrelated diagram path is not a report of it (#395).
  const loop = 'for f in specs/*.spec.json; do n=$(basename $f .spec.json); node bin/arkitect.mjs drawio build $f --out out/$n.drawio; done';
  eq(outsOf(loop).join(), 'out/*.drawio', 'a substitution in the name');
  eq(outOf('arkitect drawio build a.json --out $n.drawio'), '*', 'no folder: any file');
  eq(outOf('arkitect drawio build a.json --out ./$n.drawio'), '*', 'the current folder: any file');
  eq(outOf('arkitect drawio build a.json --out $C/$n.drawio'), '*', 'a variable folder: any file');
  eq(outOf('arkitect drawio build a.json --out out/$OUT'), 'out/*', 'any diagram in out/');
  assert(!namesABuiltFile('Reviewed the issues. AGENTS.md §3 shows `--out docs/arch.drawio`, which writes into the install.', ['out/*.drawio']), 'an unrelated path');
  for (const reply of ['Built `out/starter.drawio`.', 'Built out\\as-is.drawio', 'Built starter.drawio and as-is.drawio in out/.']) {
    assert(namesABuiltFile(reply, ['out/*.drawio']), reply);
  }
  for (const reply of ['Built starter.drawio.', 'See out/a.excalidraw', 'See layout/a.drawio', 'See out/.drawio']) {
    assert(!namesABuiltFile(reply, ['out/*.drawio']), reply);
  }
  assert(namesABuiltFile('See out/a.excalidraw', ['out/*']), 'any diagram in out/');
  // A folder held in a variable set in the same command is read too (#397).
  const scratch = 'S="scratch/tpl"; mkdir -p "$S"; for f in specs/*.spec.json; do n=$(basename $f .spec.json); node bin/arkitect.mjs drawio build $f --out "$S/$n.drawio" --defaults; done';
  eq(outsOf(scratch).join(), 'tpl/*.drawio', 'a folder variable set in the command');
  eq(outOf('S=out; arkitect drawio build a.json --out ${S}/$n.drawio'), 'out/*.drawio', 'braced');
  eq(outOf('$S = "C:\\tmp\\tpl"; arkitect drawio build a.json --out $S\\$n.drawio'), 'tpl/*.drawio', 'set in PowerShell');
  eq(outOf('S=.; arkitect drawio build a.json --out $S/$n.drawio'), '*', 'set to the current folder: any file');
  eq(outOf('for S in a b; do arkitect drawio build x.json --out $S/$n.drawio; done'), '*', 'a folder with two values: any file');
  const dir = mkdtempSync(join(tmpdir(), 'arkitect-report-'));
  try {
    const transcript = join(dir, 't.jsonl');
    writeFileSync(transcript, JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash',
      input: { command: 'node bin/arkitect.mjs drawio build p329.json --out /tmp/repro/p329.drawio' } }] } }));
    const stop = (reply) => respond({ hook_event_name: 'Stop', transcript_path: transcript, last_assistant_message: reply });
    eq(stop('Opened three PRs. #339: an agent rebuilt an existing `.drawio` from a new spec.'), null, 'a summary naming no built file');
    assert(/no File, Assumptions/.test(JSON.parse(stop('Done: /tmp/repro/p329.drawio') ?? '{}').reason), 'the built file is still checked');
    writeFileSync(transcript, JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: loop } }] } }));
    eq(stop('Reviewed the issues. AGENTS.md §3 shows `--out docs/arch.drawio`, which writes into the install.'), null, 'a review quoting another path (#395)');
    assert(/no File, Assumptions/.test(JSON.parse(stop('Done: out/starter.drawio') ?? '{}').reason), 'a file the loop built (#395)');
    writeFileSync(transcript, JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: scratch } }] } }));
    eq(stop('Summary of the code changes: AGENTS.md §3 builds `docs/arch.drawio`.'), null, 'a summary after a scratch build (#397)');
    assert(/no File, Assumptions/.test(JSON.parse(stop('Done: scratch/tpl/starter-architecture.drawio') ?? '{}').reason), 'a file the scratch loop built (#397)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A heredoc writing a test script, a `node -e` string and a commit message each
// quoted a build command; each counted as a build, and every later reply naming
// any diagram was sent back (#400). Only what the shell runs is read.
test('the report check counts a build only from what the shell runs, not one quoted in text (#400)', () => {
  const { sessionOf, respond, outsOf } = reportHook;
  const dir = mkdtempSync(join(tmpdir(), 'arkitect-report-'));
  try {
    const transcript = join(dir, 't.jsonl');
    const run = (command, name = 'Bash') => {
      writeFileSync(transcript, JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name, input: { command } }] } }));
      return sessionOf(transcript);
    };
    const reply = 'Merged both PRs; AGENTS.md §3 shows `--out docs/arch.drawio`.';
    const stop = () => respond({ hook_event_name: 'Stop', transcript_path: transcript, last_assistant_message: reply });
    const quotedOnly = {
      'commit message': 'git add -A && git commit -m "Keep the folder of an --out the check cannot resolve\n\nA loop such as node bin/arkitect.mjs drawio build $f --out out/$n.drawio now keeps out/."',
      'commit message from a heredoc': "git commit -m \"$(cat <<'EOF'\nRead node bin/arkitect.mjs drawio build $f --out out/$n.drawio\nEOF\n)\"",
      'heredoc test script': "cat > t.mjs <<'EOF'\nconst loop = 'node bin/arkitect.mjs drawio build a.json --out $C/$n.drawio';\nconsole.log(loop);\nEOF\nnode t.mjs",
      'node -e string': 'node -e "const cmd = \'arkitect drawio build a.json --out \\$OUT\'; console.log(cmd)"',
      'README section': 'cat >> README.md <<\'EOF\'\nRebuild with `arkitect drawio build spec.json --out "$OUT"`.\nEOF',
      'echo': 'echo "arkitect excalidraw build a.json --out $OUT" >> ci.sh',
      'PowerShell here-string': "git commit -m @'\nRead arkitect drawio build a.json --out $C/$n.drawio\n'@",
    };
    for (const [name, command] of Object.entries(quotedOnly)) {
      const seen = run(command, name.startsWith('PowerShell') ? 'PowerShell' : 'Bash');
      eq(`${seen.built}|${seen.outs.join()}`, 'false|', name);
      eq(stop(), null, `${name}: the reply is not sent back`);
    }
    // What a shell does run still counts, and of the same files outsOf() reads.
    const spaced = 'D:/Profiles/Jane Doe/.claude/plugins/cache/arkitect/arkitect/2.3.2/skills/arkitect-drawio/scripts/build-diagram.mjs';
    const builds = [
      'arkitect drawio build a.json --out a.drawio',
      'node bin/arkitect.mjs drawio build p329.json --out /tmp/repro/p329.drawio',
      `node "${spaced}" spec.json --out orders.drawio`,
      "node '/Users/Jane Doe/arkitect/skills/arkitect-excalidraw/scripts/build-diagram.mjs' a.json --out a.excalidraw",
      'node "C:\\Program Files\\arkitect\\bin\\arkitect.mjs" excali build a.json --out a.excalidraw',
      'arkitect excalidraw build a.json --out="docs/my arch.excalidraw"',
      'OUT=docs/arch.drawio; arkitect drawio build a.json --out "$OUT"',
      'for n in starter as-is; do arkitect drawio build $n.spec.json --out "$T/$n.drawio"; done',
      'for f in specs/*.spec.json; do n=$(basename $f .spec.json); node bin/arkitect.mjs drawio build $f --out out/$n.drawio; done',
      'S="scratch/tpl"; mkdir -p "$S"; for f in specs/*.spec.json; do n=$(basename $f .spec.json); node bin/arkitect.mjs drawio build $f --out "$S/$n.drawio" --defaults; done',
      'arkitect drawio build a.json --out $C/$n.drawio',
    ];
    for (const command of builds) {
      const seen = run(command);
      eq(`${seen.built}|${seen.outs.join()}`, `true|${outsOf(command).join()}`, command);
    }
    const ps = run('$out = "docs/p.excalidraw"; node bin/arkitect.mjs excalidraw build a.json --out $out', 'PowerShell');
    eq(`${ps.built}|${ps.outs.join()}`, 'true|p.excalidraw', 'a PowerShell build');
    for (const [command, outs, name] of [
      ['bash -c "node bin/arkitect.mjs drawio build a.json --out docs/a.drawio"', 'a.drawio', 'bash -c'],
      ["sh -lc 'arkitect excalidraw build a.json --out \"$D/b.excalidraw\"'", 'b.excalidraw', 'sh -lc'],
      ['pwsh -NoProfile -Command "node bin/arkitect.mjs drawio build a.json --out c.drawio"', 'c.drawio', 'pwsh -Command'],
      ['cmd /c "arkitect drawio build a.json --out d.drawio"', 'd.drawio', 'cmd /c'],
      ["bash <<'EOF'\nnode bin/arkitect.mjs drawio build a.json --out e.drawio\nEOF", 'e.drawio', 'a heredoc fed to bash'],
      ["cat <<'EOF' | sh\narkitect drawio build a.json --out f.drawio\nEOF", 'f.drawio', 'a heredoc piped to sh'],
      ["cat > t.mjs <<'EOF'\nx\nEOF\nnode bin/arkitect.mjs drawio build a.json --out g.drawio", 'g.drawio', 'a build after a heredoc'],
    ]) {
      const seen = run(command);
      eq(`${seen.built}|${seen.outs.join()}`, `true|${outs}`, name);
    }
    run('git commit -m "Rebuild out/a.drawio" && node bin/arkitect.mjs drawio build a.json --out a.drawio');
    assert(/no File, Assumptions/.test(JSON.parse(respond({ hook_event_name: 'Stop', transcript_path: transcript, last_assistant_message: 'Done: a.drawio' }) ?? '{}').reason),
      'a real build beside a commit message is still checked');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A report linked "Draw.io Desktop" to https://www.draw.io, the hosted editor
// (#340). The check uses the eval cases' own pattern, so the two can't drift.
test('the report check sends back a link to the hosted editor, once, with the pattern the evals grade (#340)', () => {
  const { problems, HOSTED, DESKTOP } = reportHook;
  for (const name of ['edit-existing-diagram', 'engine-choice-is-explained', 'generate-architecture']) {
    const yaml = readFileSync(join(ROOT, 'evals', 'drawio', name, 'case.yaml'), 'utf8');
    const pattern = yaml.match(/name: no-hosted-editor[\s\S]*?pattern: '([^']+)'/)[1];
    eq(pattern, HOSTED.source.replaceAll('\\/', '/'), `${name}'s no-hosted-editor pattern`);
  }
  const report = (file) => ['**File** `./eval-output/landing-zone.drawio`', '**Assumptions** none', '**Icons** none',
    '**Validation** PASS, no warnings', '**Render** PNG opened and looked at.', '**Deviations** none', `**To see it:** ${file}`].join('\n');
  const sent = problems(report('open `./eval-output/landing-zone.drawio` in [Draw.io Desktop](https://www.draw.io) or the VS Code extension'), { viewed: true });
  eq(sent.length, 1, 'sent back');
  assert(sent[0].includes('//www.draw.io') && sent[0].includes(DESKTOP), sent[0]);
  for (const link of ['https://app.diagrams.net/?src=about', 'https://viewer.diagrams.net/#R', 'https://draw.io']) {
    eq(problems(report(link), { viewed: true }).length, 1, link);
  }
  for (const fine of ['open it in Draw.io Desktop or the VS Code extension', `[Draw.io Desktop](${DESKTOP})`]) {
    eq(problems(report(fine), { viewed: true }).length, 0, fine);
  }
});

// Editing a .drawio, an agent read the whole file instead of analyzing it
// (#342). A diagram with embedded art fills the window in one Read.
const readHook = await import(pathToFileURL(join(ROOT, 'hooks', 'diagram-read.mjs')).href);
test('a whole Read of a diagram is refused until it is analyzed, and always when it is large (#342)', () => {
  const pre = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse;
  eq(JSON.stringify(pre), JSON.stringify([{ matcher: 'Read', hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/diagram-read.mjs"' }] }]), 'a Read hook');
  const { refusalFor, respond, LARGE } = readHook;
  const dir = mkdtempSync(join(tmpdir(), 'arkitect-read-'));
  try {
    const small = join(dir, 'checkout.drawio');
    const large = join(dir, 'big.excalidraw');
    const notes = join(dir, 'notes.md');
    writeFileSync(small, '<mxfile agent="x"><diagram/></mxfile>');
    writeFileSync(large, JSON.stringify({ type: 'excalidraw', files: { a: { dataURL: 'x'.repeat(LARGE) } } }));
    writeFileSync(notes, 'x'.repeat(LARGE * 2));
    const transcript = join(dir, 't.jsonl');
    const ran = (...commands) => writeFileSync(transcript, commands.map((command) => JSON.stringify({ message: { role: 'assistant',
      content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } })).join('\n'));
    const read = (file_path, extra = {}) => refusalFor({ hook_event_name: 'PreToolUse', tool_name: 'Read', transcript_path: transcript,
      tool_input: { file_path, ...extra } });

    ran('ls');
    const first = read(small);
    assert(/analyze checkout\.drawio before reading it/.test(first ?? '') && first.includes('analyze-drawio.mjs') && first.includes('--page 0 --cells'),
      `names the analyzer the eval grades: ${first}`);
    ran(`node skills/arkitect-drawio/scripts/analyze-drawio.mjs ${small} --page 0 --cells`);
    eq(read(small), null, 'a small file, once analyzed');
    ran('arkitect drawio analyze other.drawio --cells');
    assert(read(small), 'an analysis of another file does not count');
    ran(`npx arkitect excalidraw analyze ${large} --cells`);
    const big = read(large);
    assert(/big\.excalidraw is \d+ KB/.test(big ?? '') && big.includes('analyze-excalidraw.mjs') && !big.includes('--page'), `large: ${big}`);
    eq(read(large, { offset: 1, limit: 40 }), null, 'a line range passes');
    for (const pass of [notes, join(dir, 'missing.drawio')]) eq(read(pass), null, pass);
    eq(refusalFor({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: large } }), null, 'only Read');
    const said = JSON.parse(respond({ hook_event_name: 'PreToolUse', tool_name: 'Read', transcript_path: transcript, tool_input: { file_path: large } }));
    eq(said.hookSpecificOutput.permissionDecision, 'deny', 'denied');
    const run = (input) => spawnSync(process.execPath, [join(ROOT, 'hooks', 'diagram-read.mjs')], { input, encoding: 'utf8' });
    assert(/"deny"/.test(run(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: large } })).stdout), 'from the CLI');
    for (const input of ['', 'not json', JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: notes } })]) {
      const quiet = run(input);
      eq([quiet.status, quiet.stdout].join('|'), '0|', `silent and exit 0 on ${input.slice(0, 40)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The report check ran only as a Claude Code hook; no other host had a route
// to it (#302). `arkitect report` runs the same checks on a saved report, and
// every adapter names it.
const reportCli = await import(pathToFileURL(join(ROOT, 'bin', 'lib', 'report.mjs')).href);
test('arkitect report checks a saved report like the Stop hook, and every adapter names it (#302)', () => {
  const { ADAPTERS } = adapters;
  for (const [name, adapter] of Object.entries(ADAPTERS)) {
    const text = adapter.render('/opt/arkitect');
    assert(/arkitect\.mjs"? report /.test(text), `${name} has no route to the report check`);
  }
  assert(/node bin\/arkitect\.mjs report <file>`\s+\(`--png-viewed`/.test(readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')), 'AGENTS.md step 8 names it');

  const good = ['**File** `docs/orders.drawio`', '**Assumptions** none', '**Icons** aws/aws-lambda', '**Validation** PASS, no warnings',
    '**Render** PNG opened; the flow reads left to right.', '**Deviations** none'].join('\n');
  const bad = 'Done: docs/orders.drawio. Layout is clean. Open it in [Draw.io Desktop](https://app.diagrams.net).';
  const dir = mkdtempSync(join(tmpdir(), 'arkitect-report-cli-'));
  try {
    const say = (args, stdin = '') => {
      const lines = [];
      const code = reportCli.report(args, { stdin: () => stdin, log: (l) => lines.push(l), error: (l) => lines.push(l) });
      return { code, out: lines.join('\n') };
    };
    writeFileSync(join(dir, 'good.md'), good);
    writeFileSync(join(dir, 'bad.md'), bad);
    eq(say([join(dir, 'good.md'), '--png-viewed']).code, 0, 'a whole report, PNG looked at');
    const unseen = say([join(dir, 'good.md')]);
    eq(unseen.code, 1, 'the same report without --png-viewed describes a picture');
    assert(/not told a PNG was looked at \(--png-viewed\)/.test(unseen.out), unseen.out);
    const sent = say(['-', '--png-viewed'], bad);
    eq(sent.code, 1, 'from stdin');
    assert(/no File, Assumptions, Icons, Validation, Render, Deviations headings/.test(sent.out) && /app\.diagrams\.net/.test(sent.out), sent.out);
    // The hook and the command agree on what is wrong with a report.
    const strip = (ps) => ps.map((p) => p.replace(/^.*?, so nothing has seen/, 'unseen'));
    eq(JSON.stringify(strip(reportCli.checkReport(bad, { viewed: false }))), JSON.stringify(strip(reportHook.problems(bad, { viewed: false }))), 'one check');
    for (const args of [[], ['a.md', 'b.md'], ['--viewed', 'a.md'], [join(dir, 'missing.md')]]) eq(say(args).code, 2, args.join(' '));
    const cli = spawnSync(process.execPath, [join(ROOT, 'bin', 'arkitect.mjs'), 'report', join(dir, 'bad.md')], { encoding: 'utf8' });
    eq(cli.status, 1, 'through the dispatcher');
    assert(/hosted editor/.test(cli.stdout), cli.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Copying every warning line with its ids, and every icon, from earlier output
// is what a small model drops first (#248, #287, #326, #330). `report --draft`
// writes File, Icons and Validation from the diagram and its spec, and leaves a
// `fill in` line under each heading only the agent can write; the check fails
// while one is left (#387).
test('arkitect report --draft fills File, Icons and Validation from the diagram and its spec, and the check fails a fill-in left (#387)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arkitect-draft-'));
  try {
    const say = (args) => {
      const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'arkitect.mjs'), 'report', ...args], { encoding: 'utf8' });
      return { code: r.status, out: r.stdout, err: r.stderr };
    };
    const cases = [
      ['drawio', 'starter-architecture', '.drawio', (t) => t.replace(/<diagram name="[^"]*"/, '<diagram')],
      ['excalidraw', 'aws-data-platform', '.excalidraw', (t) => { const s = JSON.parse(t); s.elements.find((e) => e.type === 'rectangle').strokeStyle = 'wavy'; return JSON.stringify(s); }],
    ];
    for (const [engine, name, ext, spoil] of cases) {
      const templates = join(ROOT, 'skills', `arkitect-${engine}`, 'assets', 'templates');
      const spec = join(templates, `${name}.spec.json`);
      const file = join(dir, `${name}${ext}`);
      writeFileSync(file, spoil(readFileSync(join(templates, `${name}${ext}`), 'utf8')));
      const validator = spawnSync(process.execPath, [join(ROOT, 'bin', 'arkitect.mjs'), engine, 'validate', file, '--json'], { encoding: 'utf8' });
      const { warnings } = JSON.parse(validator.stdout);
      assert(warnings.length >= 1, `${engine}: the spoiled copy has no warning to draft`);

      const draft = say(['--draft', file, '--spec', spec]);
      eq(draft.code, 0, `${engine}: --draft exits 0 (${draft.err})`);
      const at = ['File', 'Engine', 'Assumptions', 'Icons', 'Validation', 'Render', 'Deviations'].map((h) => draft.out.indexOf(`**${h}**`));
      assert(at.every((n, i) => n >= 0 && (i === 0 || n > at[i - 1])), `${engine}: the seven headings in order: ${at}`);
      for (const w of warnings) assert(draft.out.includes(`- warning: ${w}`), `${engine}: the draft drops the warning "${w}"`);
      const built = JSON.parse(spawnSync(process.execPath, [join(ROOT, 'bin', 'arkitect.mjs'), engine, 'build', spec, '--out', join(dir, `rebuilt${ext}`)], { encoding: 'utf8' }).stdout);
      if (engine === 'drawio') {
        const ids = [...new Set(JSON.parse(readFileSync(spec, 'utf8')).nodes.filter((n) => n.icon).map((n) => n.icon))];
        eq(built.icons.resolved, ids.length, 'every icon resolved');
        for (const icon of ids) assert(new RegExp(`- \`${icon}\`: \`[\\w-]+/[\\w-]+\`, \\w[\\w-]* pack`).test(draft.out), `drawio: the draft drops the icon ${icon}`);
      } else {
        const nodes = JSON.parse(readFileSync(spec, 'utf8')).nodes.filter((n) => n.kind === 'icon');
        for (const n of nodes) assert(new RegExp(`- node \`${n.id}\`: \``).test(draft.out), `excalidraw: the draft drops the icon of ${n.id}`);
      }
      assert(/^- note: 6 icons have no edge/m.test(draft.out) || engine === 'drawio', `${engine}: the build report's notes`);

      // The check fails it while a marker is left, and names where.
      writeFileSync(join(dir, 'draft.md'), draft.out);
      const left = say([join(dir, 'draft.md'), '--png-viewed']);
      eq(left.code, 1, `${engine}: a draft with its fill-in lines left`);
      assert(/fill in[^\n]*under Engine, Assumptions, Render, Deviations/.test(left.out), left.out);
      // Filled in, the drafted sections pass the same check: nothing in them
      // reads as an excuse or a description of an unseen picture.
      const filled = draft.out.replace(/<!-- fill in: why[^\n]*/, 'The user asked for it.').replace(/<!-- fill in: every[^\n]*/, 'None.')
        .replace(/<!-- fill in: what[^\n]*/, 'Rendered to PNG, opened and looked at.').replace(/<!-- fill in: each[^\n]*/, 'None.');
      writeFileSync(join(dir, 'filled.md'), filled);
      const ok = say([join(dir, 'filled.md'), '--png-viewed']);
      eq(ok.code, 0, `${engine}: the filled-in draft: ${ok.out}`);
    }
    // Without --spec, and with no spec in the file, the Icons section is the
    // agent's to fill, and says how not to.
    writeFileSync(join(dir, 'bare.drawio'), readFileSync(join(dir, 'starter-architecture.drawio'), 'utf8').replace(/ arkitect-spec="[^"]*"/, ''));
    const bare = say(['--draft', join(dir, 'bare.drawio')]);
    eq(bare.code, 0, 'no spec');
    assert(/\*\*Icons\*\*\s+<!-- fill in: [^\n]*--spec/.test(bare.out), bare.out);
    for (const args of [['--draft'], ['--draft', join(dir, 'draft.md')], ['--draft', join(dir, 'missing.drawio')], ['--spec', 'a.json', 'r.md'],
      ['--draft', join(dir, 'starter-architecture.drawio'), '--spec'],
      ['--draft', join(dir, 'starter-architecture.drawio'), '--spec', join(dir, 'missing.json')], ['--draft', join(dir, 'starter-architecture.drawio'), '--png-viewed']]) {
      eq(say(args).code, 2, args.join(' '));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A diagram carries its spec (#388), so the draft needs no --spec to list a
// Draw.io file's icons, which its cells do not record (#387).
test('arkitect report --draft lists the icons from the spec a diagram carries when no --spec is given (#388)', () => {
  for (const [engine, name, ext] of [['drawio', 'starter-architecture', '.drawio'], ['excalidraw', 'aws-data-platform', '.excalidraw']]) {
    const templates = join(ROOT, 'skills', `arkitect-${engine}`, 'assets', 'templates');
    const draft = (...args) => spawnSync(process.execPath, [join(ROOT, 'bin', 'arkitect.mjs'), 'report', '--draft', join(templates, `${name}${ext}`), ...args], { encoding: 'utf8' }).stdout;
    const carried = draft();
    const given = draft('--spec', join(templates, `${name}.spec.json`));
    assert(carried.includes(`From the spec \`${join(templates, `${name}${ext}`)}\` carries, resolved as the build does:`), `${engine}: ${carried.slice(0, 600)}`);
    const icons = (text) => text.slice(text.indexOf('**Icons**'), text.indexOf('**Validation**')).split('\n').filter((l) => l.startsWith('- '));
    assert(icons(carried).length > 3, `${engine}: no icons listed`);
    eq(icons(carried).join('\n'), icons(given).join('\n'), `${engine}: the same icons as from the spec file`);
  }
});

// The report step names the draft where it asked for each warning with every
// id, by hand; the drafted Validation section carries them now, and the
// reading budget stays flat (#387).
test('the report step on every reading path names report --draft in place of copying each warning by hand (#387)', () => {
  const steps = {
    'AGENTS.md': readFileSync(join(ROOT, 'AGENTS.md'), 'utf8').match(/\n8\. \*\*Report\*\*[\s\S]*?\n\n/)[0],
    ...Object.fromEntries(['drawio', 'excalidraw'].map((e) => [`arkitect-${e}/SKILL.md`,
      readFileSync(join(ROOT, 'skills', `arkitect-${e}`, 'SKILL.md'), 'utf8').match(/\n9\. \*\*Report\.\*\*[\s\S]*?\n## /)[0]])),
  };
  for (const [name, step] of Object.entries(steps)) {
    const flat = step.replace(/\s+/g, ' ');
    assert(/arkitect\.mjs report --draft <\w+> --spec <spec>/.test(flat), `${name}: does not name report --draft`);
    assert(!/with every id it (gives|names)/.test(flat), `${name}: still asks for each warning's ids by hand`);
    assert(/each defect seen and left,? by page/.test(flat), `${name}: lost the defects seen in the render`);
  }
});

// Asked to build a spec into a diagram file, the agent loaded no skill and
// wrote its own builder (#327). A prompt naming a diagram file or a spec gets
// one line naming the skill, and so does a request for a diagram (#371); any
// other prompt gets nothing.
const routeHook = await import(pathToFileURL(join(ROOT, 'hooks', 'build-route.mjs')).href);
test('a prompt naming a diagram file or spec is told which skill to load; any other prompt gets nothing (#327)', () => {
  const prompts = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks.UserPromptSubmit[0].hooks;
  eq(prompts.map((h) => h.command).join(' | '), 'node "${CLAUDE_PLUGIN_ROOT}/hooks/style-question.mjs" | node "${CLAUDE_PLUGIN_ROOT}/hooks/build-route.mjs"', 'a second prompt hook');
  const { routeFor } = routeHook;
  const promptOf = (engine, name) => readFileSync(join(ROOT, 'evals', engine, name, 'case.yaml'), 'utf8')
    .replace(/\r\n/g, '\n').match(/prompt: \|\n([\s\S]*?)\n\n/)[1];
  const skill = (text) => text?.match(/the (arkitect-\w+) skill/)?.[1] ?? null;
  eq(skill(routeFor(promptOf('excalidraw', 'names-a-product-box'))), 'arkitect-excalidraw', 'the #327 prompt');
  eq(skill(routeFor(promptOf('drawio', 'report-names-every-warning'))), 'arkitect-drawio', 'the 2.2.0 control prompt');
  for (const engine of ['drawio', 'excalidraw']) {
    for (const name of readdirSync(join(ROOT, 'evals', engine))) {
      if (!existsSync(join(ROOT, 'evals', engine, name, 'case.yaml'))) continue;
      const prompt = promptOf(engine, name);
      const said = routeFor(prompt);
      if (styleHook.ruleFor(prompt)) eq(said, null, `${engine}/${name}: a style question gets the style rule instead`);
      else if (/\.(drawio|excalidraw)\b/.test(prompt)) assert(said?.includes(`arkitect-${engine}`), `${engine}/${name}: ${said}`);
      else if (name === 'engine-choice-is-explained') assert(/asks for a diagram.*arkitect-drawio or arkitect-excalidraw skill.*README/.test(said), `${engine}/${name}: ${said}`);
      else eq(said, null, `${engine}/${name} names no file`);
    }
  }
  for (const prompt of ['Draw our AWS pipeline', 'What is a spec?', '/learn-drawio-style docs/a.drawio', 'Fix the bug in parser.json']) {
    eq(routeFor(prompt), null, prompt);
  }

  // A request that names no file: 2 runs of 3 of the README case loaded no
  // skill and handed over SVG or Mermaid (#371). A request for a diagram is
  // routed; a bug report about drawing, or one asking for another format, isn't.
  for (const prompt of ['Draw a sequence diagram for the auth flow', 'make me a flowchart of the signup flow',
    'I need a diagram of the network topology for the client', 'For the review board. Draw it, the whole architecture.']) {
    assert(/^Arkitect: this prompt asks for a diagram\. Load the arkitect-drawio or arkitect-excalidraw skill/.test(routeFor(prompt) ?? ''), prompt);
  }
  eq(skill(routeFor('Sketch the architecture of our payments service in Excalidraw')), 'arkitect-excalidraw', 'an engine named');
  eq(skill(routeFor('Draw the system design in draw.io')), 'arkitect-drawio', 'the other engine named');
  for (const prompt of ['Draw it as a Mermaid diagram in the README', 'Draw a diagram of the architecture and save it as docs/arch.svg',
    'fix the bug where the canvas does not draw the architecture overlay', 'the diagram view does not draw edges after a resize',
    "why doesn't the architecture page draw on mobile?", 'refactor the diagram renderer', 'generate the diagram types from the schema',
    'Explain this architecture diagram', 'add a test that draws a random sample', 'What does the architecture look like?']) {
    eq(routeFor(prompt), null, prompt);
  }
  // An engine named beside an export format asked for that engine; the
  // format filter dropped it (#383). The engine's name is no drawing verb.
  eq(skill(routeFor('Draw our AWS architecture in Draw.io and give me a PNG for the slides')), 'arkitect-drawio', 'Draw.io and a PNG');
  eq(skill(routeFor('Sketch the system design in Excalidraw and export an SVG for the README')), 'arkitect-excalidraw', 'Excalidraw and an SVG');
  for (const prompt of ['Convert our draw.io diagram to Mermaid', 'Export the Excalidraw canvas as a PNG',
    'fix the bug where excalidraw does not draw the architecture on the canvas']) {
    eq(routeFor(prompt), null, prompt);
  }

  // The plugin is installed per user, so an OpenAPI or Vega *.spec.json was
  // routed to a diagram skill too (#355). Only an Arkitect spec is.
  const project = join(TMP, 'build-route');
  rmSync(project, { recursive: true, force: true });
  mkdirSync(join(project, 'specs'), { recursive: true });
  writeFileSync(join(project, 'specs', 'a.spec.json'), JSON.stringify({ nodes: [{ id: 'api', label: 'API' }] }));
  writeFileSync(join(project, 'paged.spec.json'), JSON.stringify({ pages: [{ nodes: [] }] }));
  writeFileSync(join(project, 'openapi.spec.json'), JSON.stringify({ openapi: '3.1.0', paths: {} }));
  writeFileSync(join(project, 'revenue.spec.json'), '{ "$schema": "https://vega.github.io/schema/vega/v5.json", "marks": [');
  const both = /arkitect-drawio or arkitect-excalidraw skill/;
  assert(both.test(routeFor('Build specs/a.spec.json and validate it.', project)), 'a spec alone names both');
  assert(both.test(routeFor('rebuild "paged.spec.json"', project)), 'a paged spec');
  assert(both.test(routeFor('Write orders.spec.json for the checkout diagram', project)), 'a spec about to be written, for a diagram');
  eq(skill(routeFor('Write orders.spec.json and build it into orders.excalidraw', project)), 'arkitect-excalidraw', 'a new spec and its output');
  for (const prompt of ['add the /refunds endpoint to openapi.spec.json', 'the vega chart in revenue.spec.json renders blank',
    'write tests/login.spec.json for the new fixture']) {
    eq(routeFor(prompt, project), null, prompt);
  }
  const hookIn = (cwd) => ({ hook_event_name: 'UserPromptSubmit', prompt: 'Build specs/a.spec.json', cwd });
  assert(both.test(routeHook.respond(hookIn(project)) ?? ''), 'the hook reads the spec from the session\'s cwd');
  eq(routeHook.respond(hookIn(join(project, 'specs'))), null, 'and not from anywhere else');
  const run = (input) => spawnSync(process.execPath, [join(ROOT, 'hooks', 'build-route.mjs')], { input, encoding: 'utf8' });
  const said = run(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'Build a.spec.json into out/a.excalidraw' }));
  eq([said.status, skill(said.stdout)].join('|'), '0|arkitect-excalidraw', 'printed for Claude Code to add');
  for (const input of ['', 'not json', JSON.stringify({ hook_event_name: 'Stop', last_assistant_message: 'a.drawio' }),
    JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'Draw our AWS pipeline' })]) {
    const quiet = run(input);
    eq([quiet.status, quiet.stdout].join('|'), '0|', `silent and exit 0 on ${JSON.stringify(input)}`);
  }
});

// From the 2.2.1 batch: a promise worded past the pattern, and the rewrite
// that said learning applies a style (#331).
test('the style-question hook sends back "now I know your style" and a claim that learning applies it (#331)', () => {
  const { promisesToRemember, RULE, SEND_BACK } = styleHook;
  for (const said of ['Now I know your style preference!', 'Noted your preference for rounded corners.',
    "I've noted that you like dashed arrows.",
    "So your diagram style uses dashed boundaries and orthogonal (elbow) connectors throughout. Got it — I'll apply that style when creating or editing your diagrams.",
    'You can run `/learn-drawio-style` to have it applied to new Draw.io diagrams.',
    "If you'd like to make this automatic for future diagrams, you can run `/learn-drawio-style` or `/learn-excalidraw-style` to have Claude Code remember your preferred approach."]) {
    assert(promisesToRemember(said), `sent back: ${said}`);
  }
  for (const text of [RULE, SEND_BACK]) {
    assert(/learn-drawio-style or \/learn-excalidraw-style records/.test(text) && /apply-drawio-style or \/apply-excalidraw-style/.test(text),
      `says learning records and applying changes the build: ${text}`);
    assert(!/how a style is kept/.test(text), 'no longer calls learning how a style is kept');
  }
});

// From the 2.2.1 batch: a Render section with no picture word in the list,
// and warnings named and then explained away (#328, #330).
test('the report check sends back an unseen render described in other words, and a warning called intentional (#328, #330)', () => {
  const { problems, describesThePicture, excusesAWarning } = reportHook;
  const report = (validation, render) => ['**File** `./eval-output/pipeline.drawio`', '**Assumptions** none', '**Icons** none',
    `**Validation** ${validation}`, `**Render** ${render}`, '**Deviations** none'].join('\n');
  const unseen = 'SVG rendered successfully (900×277px). PNG render blocked by sandbox (browser socket denied). Layout from SVG '
    + 'shows horizontal flow: Web shop (left) → Orders API (center) → PostgreSQL (right). All elements properly positioned, '
    + 'labels adjacent to arrows.';
  assert(describesThePicture(unseen), 'the #328 Render section is a claim');
  eq(problems(report('PASS, no warnings', unseen), { viewed: false }).length, 1, 'sent back once');
  eq(problems(report('PASS, no warnings', unseen), { viewed: true }).length, 0, 'unless a PNG was opened');
  assert(/doesn't say so/.test(problems(report('PASS', 'SVG written to o.svg.'), { viewed: false })[0]), 'a render nobody saw must say so');
  eq(problems(report('PASS', "SVG written to o.svg; I haven't opened a picture of it."), { viewed: false }).length, 0, 'says so');
  eq(problems(report('PASS', 'PNG render failed: no browser.'), { viewed: false }).length, 0, 'nothing rendered to see');

  const named = 'PASS with 2 warnings: dlq overlaps worker; retention-note lies across the acct-boundary border.';
  for (const [excuse, said] of [['not errors', "Both warnings are direct results of the spec's grid coordinates and represent the agreed layout—not errors."],
    ['intentional', 'These reflect the exact spec layout you provided; the overlaps are intentional per your coordinates.'],
    ['by spec', 'Both warnings are by spec design.']]) {
    eq(excusesAWarning(report(`${named} ${said}`, 'failed, not seen.')), excuse, said);
    assert(problems(report(named, 'failed, not seen.').replace('**Deviations** none', `**Deviations** ${said}`), { viewed: false })
      .some((p) => p.includes(`"${excuse}"`)), `an excuse outside Validation: ${said}`);
  }
  for (const validation of [`${named} Both are defects still in the drawing; the spec was locked, so neither is fixed.`,
    'PASS, no warnings. The dashed edges are intentional.', 'PASS (0 errors, 0 warnings).']) {
    eq(excusesAWarning(report(validation, 'failed, not seen.')), null, validation);
  }
});

// ------------------------------------------------------------- doctor

const doc = await import(pathToFileURL(join(ROOT, 'bin', 'lib', 'doctor.mjs')).href);
const quietDoctor = async (opts) => {
  const lines = [];
  const code = await doc.doctor({ root: ROOT, cwd: TMP, log: (l) => lines.push(l), ...opts });
  return { code, out: lines.join('\n') };
};
const oldNode = await settle(quietDoctor({ node: '18.0.0' }));
const eolNode = await settle(quietDoctor({ node: '20.20.2' }));
const nothingOnPath = await settle(quietDoctor({ env: { PATH: join(TMP, 'nothing-here') } }));

// Node below 20 was a warning and exit 0, so a script could not tell (#308).
test('doctor exits 1 when a core requirement fails, and 0 when only optional tools are missing (#308)', () => {
  const old = oldNode.value;
  eq(old.code, 1, 'node 18');
  assert(/^fail\s+node >= 22\s+found v18\.0\.0/m.test(old.out) && /1 failed: exit 1/.test(old.out), old.out);
  // Node 20 reached end of life on 2026-04-30; 22 is the floor (#346).
  eq(eolNode.value.code, 1, 'node 20');
  assert(/^fail\s+node >= 22\s+found v20\.20\.2/m.test(eolNode.value.out), eolNode.value.out);
  eq(nothingOnPath.value.code, 0, `no renderer, browser or docker: exit 0\n${nothingOnPath.value.out}`);
  const broken = doc.assetRows(ROOT, { exists: (p) => !p.endsWith('index.json') && existsSync(p) });
  eq(broken.filter((r) => r[0] === 'fail').map((r) => r[1]).join(), 'excalidraw libraries', 'a missing asset is a fail row');
});

// Present is not usable: a catalog cut short read "present" while every icon
// search failed on it (#306).
test('doctor parses each bundled asset and checks the files it names (#306)', () => {
  const rows = (read, exists = existsSync) => Object.fromEntries(doc.assetRows(ROOT, {
    exists, read: (p) => read(p.replace(/\\/g, '/')) ?? readFileSync(p, 'utf8'),
  }).map(([s, label, detail]) => [label, `${s} ${detail}`]));
  const intact = rows(() => null);
  for (const [label, row] of Object.entries(intact)) assert(row.startsWith('ok '), `${label}: ${row}`);
  assert(/^ok [\d,]+ marks in 18 packs/.test(intact['draw.io icon catalog']), intact['draw.io icon catalog']);

  const cut = rows((p) => (p.endsWith('/icon-catalog.json') ? '{' : null));
  assert(/^fail .*icon-catalog\.json: not valid JSON/.test(cut['draw.io icon catalog']), cut['draw.io icon catalog']);
  const shape = rows((p) => (p.endsWith('/index.json') ? '{"libraries": {}}' : null));
  assert(/no libraries list/.test(shape['excalidraw libraries']), shape['excalidraw libraries']);
  const aws = rows((p) => (p.endsWith('/aws.drawio') ? '<mxlibrary>[{"xml"</mxlibrary>' : null));
  assert(/^fail .*not valid JSON/.test(aws['draw.io AWS pack']), aws['draw.io AWS pack']);
  const gone = rows(() => null, (p) => !/[\\/]gcp\.drawio$/.test(p) && existsSync(p));
  assert(/^fail .*names 1 file that are not there: gcp\.drawio/.test(gone['draw.io icon catalog']), gone['draw.io icon catalog']);
});

// doctor asked only for Draw.io Desktop, so a bad browser pin or a headless
// Linux with no Xvfb read as able to render (#305).
const pathDir = join(TMP, 'doctor-path');
const xvfbOnly = (p) => /xvfb-run$/.test(p);
const linuxRows = (env, executable = () => false) => settle(doc.rendererRows(ROOT, { platform: 'linux', env: { PATH: pathDir, ...env }, isExecutable: executable }));
const renderers = {
  pinned: await linuxRows({ ARKITECT_BROWSER: join(TMP, 'missing-browser'), DISPLAY: 'remote:0' }),
  bare: await linuxRows({}),
  stale: await linuxRows({ DISPLAY: ':99' }, xvfbOnly),
  windows: await settle(doc.rendererRows(ROOT, { platform: 'win32', env: { PATH: pathDir } })),
  found: await linuxRows({}, (p) => /google-chrome$/.test(p)),
};
test('doctor reports the browser pin and the Linux display the renderers would use (#305)', () => {
  const row = (rows, label) => rows.value.map(([s, l, d, more = []]) => (l.startsWith(label) ? [s, d, ...more].join(' ') : null)).find(Boolean) ?? '';
  const pinned = renderers.pinned;
  assert(/^warn ARKITECT_BROWSER .*missing-browser is not executable.*--format svg needs no browser/.test(row(pinned, 'browser')), row(pinned, 'browser'));
  eq(row(pinned, 'display'), 'ok DISPLAY remote:0', 'a remote display is trusted, as render trusts it');

  assert(/^warn no DISPLAY, and no xvfb-run on PATH/.test(row(renderers.bare, 'display')), row(renderers.bare, 'display'));
  const stale = row(renderers.stale, 'display');
  assert(/^ok DISPLAY :99 has no X server here; render runs under .*xvfb-run$/.test(stale), stale);
  const picked = renderDrawio.displayFor({ platform: 'linux', env: { PATH: pathDir, DISPLAY: ':99' }, isExecutable: xvfbOnly }).xvfb;
  assert(stale.endsWith(picked), `render picks the same xvfb-run: ${picked}`);
  eq(row(renderers.windows, 'display'), '', 'no display row off Linux');
  assert(/^ok .*google-chrome \(PATH\)$/.test(row(renderers.found, 'browser')), row(renderers.found, 'browser'));
});

// `docker --version` stood for the whole local Excalidraw route (#307).
test('doctor tells a docker CLI from a ready local Excalidraw app, and never contacts a remote engine (#307)', () => {
  const answers = (over = {}) => {
    const asked = [];
    const run = (cmd, args) => {
      const key = args.slice(0, 2).join(' ');
      asked.push(key);
      const base = { '--version': 'Docker version 27.1.1', 'compose version': 'v2.29.1', 'context inspect': 'unix:///var/run/docker.sock', 'version --format': '27.1.1' };
      const v = Object.hasOwn(over, key) ? over[key] : base[key];
      return v === null ? { status: 1, stdout: '' } : { status: 0, stdout: `${v}\n` };
    };
    return { run, asked };
  };
  const row = (over, opts = {}) => {
    const { run, asked } = answers(over);
    const [s, , d, more = []] = doc.dockerRow(ROOT, { env: {}, run, ...opts });
    return { text: [`${s} ${d}`, ...more].join(' | '), asked };
  };
  assert(/^ok Docker version 27\.1\.1, Compose v2\.29\.1, engine 27\.1\.1; docker[\\/]docker-compose\.yml$/.test(row({}).text), row({}).text);
  assert(/^warn docker not found/.test(row({ '--version': null }).text), 'no CLI');
  assert(/^warn .*no Compose plugin/.test(row({ 'compose version': null }).text), 'no Compose');
  assert(/^warn .*local engine is not running/.test(row({ 'version --format': null }).text), 'engine stopped');
  assert(/^warn .*no compose file at/.test(row({}, { exists: () => false }).text), 'no compose file');
  const clientOnly = row({ 'compose version': null, 'version --format': null });
  assert(clientOnly.text.startsWith('warn ') && /Compose/.test(clientOnly.text) && /not running/.test(clientOnly.text), clientOnly.text);
  const remote = row({ 'context inspect': 'tcp://build.example:2376' });
  assert(/^warn .*remote \(tcp:\/\/build\.example:2376\); not checked/.test(remote.text), remote.text);
  assert(!remote.asked.includes('version --format'), 'a remote engine is not asked anything');
  const viaEnv = (() => { const { run, asked } = answers(); doc.dockerRow(ROOT, { env: { DOCKER_HOST: 'ssh://ops@host' }, run }); return asked; })();
  assert(!viaEnv.includes('version --format') && !viaEnv.includes('context inspect'), 'DOCKER_HOST is the endpoint');
});

// The version, the root and the style each engine draws with, so a report of
// odd output says which install made it (#309).
const styleHome = join(TMP, 'doctor-style-home');
const styleStore = (drawio, excalidraw) => {
  rmSync(styleHome, { recursive: true, force: true });
  for (const [engine, text] of [['drawio', drawio], ['excalidraw', excalidraw]]) {
    if (text === null) continue;
    mkdirSync(join(styleHome, engine), { recursive: true });
    writeFileSync(join(styleHome, engine, 'style-overrides.json'), text);
  }
  return settle(doc.styleRows(ROOT, { ...process.env, ARKITECT_HOME: styleHome }));
};
const styleCases = {
  none: await styleStore(null, null),
  broken: await styleStore('{', JSON.stringify({ schemaVersion: 1, engine: 'excalidraw', tokens: { roughness: 'very' } })),
  applied: await styleStore(JSON.stringify({ schemaVersion: 1, engine: 'drawio', tokens: { fontBody: 14 } }),
    JSON.stringify({ schemaVersion: 1, engine: 'excalidraw', tokens: { roughness: 0 } })),
};
test('doctor names the install and the style each engine draws with, never the values (#309)', () => {
  const home = styleHome;
  const styles = (c) => Object.fromEntries(c.value.map(([s, label, d, more = []]) => [label, [s, d, ...more].join(' ')]));
  let rows = styles(styleCases.none);
  eq(rows['draw.io style'], 'ok house style, no override', 'no store');
  eq(rows['excalidraw style'], 'ok house style, no override', 'no store');

  rows = styles(styleCases.broken);
  assert(/^warn override ignored, .*style-overrides\.json the file is not valid JSON$/.test(rows['draw.io style']), rows['draw.io style']);
  assert(/^warn override ignored, .* tokens\.roughness$/.test(rows['excalidraw style']) && !rows['excalidraw style'].includes('very'),
    `the field, not the value: ${rows['excalidraw style']}`);

  rows = styles(styleCases.applied);
  assert(/^ok override applied, 1 field: .*drawio[\\/]style-overrides\.json$/.test(rows['draw.io style']), rows['draw.io style']);
  assert(/^ok override applied, 1 field: /.test(rows['excalidraw style']), rows['excalidraw style']);

  // The same store build reads, through the real CLI.
  writeFileSync(join(home, 'drawio', 'style-overrides.json'), '{');
  const env = { ...process.env, ARKITECT_HOME: home };
  const out = cli(['doctor'], { env });
  eq(out.split('\n')[0], `arkitect ${pkg.version} at ${ROOT} (${process.platform} ${process.arch})`, 'the identity line');
  assert(/^warn\s+draw\.io style\s+override ignored/m.test(out), out);
  eq(JSON.parse(cli(['drawio', 'build', '--print-style'], { env })).reason, 'override ignored: it has problems', 'build agrees');
  rmSync(home, { recursive: true, force: true });
});

// An adapter carries the absolute path of the install that wrote it; moving
// or removing that install stranded it with nothing said (#310).
test('doctor checks the adapters in this project point at this install (#310)', () => {
  const project = (name, files) => {
    const dir = join(TMP, 'doctor-adapters', name);
    rmSync(dir, { recursive: true, force: true });
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), text);
    }
    return dir;
  };
  const fenced = (root) => `My own rules.\n\n${adapters.BEGIN}\n${adapters.ADAPTERS.agents.render(root)}${adapters.END}\n`;
  const row = (dir) => { const [s, , d, more = []] = doc.adapterRow(ROOT, dir); return [`${s} ${d}`, ...more].join(' | '); };

  eq(row(project('empty', {})), `ok none in ${join(TMP, 'doctor-adapters', 'empty')}`, 'no adapters is fine');
  const here = project('here', {});
  cli(['install', 'agents', 'codex-skill', '--dir', here]);
  eq(row(here), `ok ${['AGENTS.md', join('.agents', 'skills', 'arkitect', 'SKILL.md')].join(', ')} point here`, 'current');

  const gone = join(TMP, 'doctor-adapters', 'removed-install');
  assert(/^warn 1 of 1 points elsewhere.* \| AGENTS\.md -> .*removed-install, which is gone$/.test(row(project('removed', { 'AGENTS.md': fenced(gone) }))),
    row(project('removed', { 'AGENTS.md': fenced(gone) })));
  const other = join(TMP, 'doctor-adapters', 'other-install');
  mkdirSync(join(other, 'bin'), { recursive: true });
  writeFileSync(join(other, 'bin', 'arkitect.mjs'), '');
  assert(/AGENTS\.md -> another install, .*other-install$/.test(row(project('other', { 'AGENTS.md': fenced(other) }))), 'a different install');

  // Text outside Arkitect's markers is the user's: not read as an adapter, not printed.
  const own = project('own', { 'AGENTS.md': `Arkitect is installed at \`${gone}\` - a note of mine.\n` });
  eq(row(own), `ok none in ${own}`, 'no markers, no adapter');
  assert(!row(project('mixed', { 'AGENTS.md': fenced(gone) })).includes('My own rules'), 'the user\'s text is never printed');
});

// --help went looking for a pack called "--help" (#311).
test('drawio sheets --help prints usage and exits 0 before reading the catalog (#311)', () => {
  const guard = join(TMP, 'no-catalog.mjs');
  writeFileSync(guard, "import fs from 'node:fs';\nimport { syncBuiltinESMExports } from 'node:module';\n"
    + 'const read = fs.readFileSync;\n'
    + "fs.readFileSync = (p, ...a) => { if (String(p).includes('icon-catalog')) throw new Error('read the catalog'); return read(p, ...a); };\n"
    + 'syncBuiltinESMExports();\n');
  for (const flag of ['--help', '-h']) {
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(guard).href, CLI, 'drawio', 'sheets', flag], { encoding: 'utf8' });
    eq(r.status, 0, `${flag}: ${r.stderr}`);
    assert(r.stdout.startsWith('usage: contact-sheet.mjs (--pack <id> | --all)') && !r.stderr, `${flag}: ${r.stdout}${r.stderr}`);
  }
  for (const args of [[], ['--pack'], ['--pack', '--png']]) {
    const r = spawnSync(process.execPath, [CLI, 'drawio', 'sheets', ...args], { encoding: 'utf8' });
    eq(r.status, 2, `sheets ${args.join(' ')}`);
    assert(r.stderr.startsWith('usage:') && !/at .*contact-sheet\.mjs/.test(r.stderr), `no stack trace: ${r.stderr}`);
  }
});

// -------------------------------------------------------------

finish();
