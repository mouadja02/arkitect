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

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CLI = join(ROOT, 'bin', 'arkitect.mjs');
const TMP = join(HERE, 'output', 'toolkit');

let pass = 0; let fail = 0; let skip = 0;
const failures = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r === 'skip') { skip++; console.log(`skip  ${name}`); return; }
    pass++; console.log(`ok    ${name}`);
  } catch (e) {
    fail++; failures.push(`${name}: ${e.message}`);
    console.log(`FAIL  ${name}\n        ${e.message}`);
  }
}
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
// they are other people's bytes and are verified by digest elsewhere.
const SKIP_DIRS = new Set(['.git', 'node_modules', '.analysis', 'output', 'bundled', 'libraries']);
function textFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) textFiles(p, acc);
    else if (/\.(md|mdc|json|mjs|js|ps1|ya?ml|txt)$/i.test(name) && st.size < 4 * 1024 * 1024) acc.push(p);
  }
  return acc;
}
const FILES = textFiles(ROOT);

// ------------------------------------------------------------------ the CLI

test('the dispatcher points every command at a script that exists', async () => {
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

// ------------------------------------------------------------------- shape

test('the plugin, marketplace and package manifests agree', () => {
  eq(manifest.name, pkg.name, 'plugin vs package name');
  eq(marketplace.plugins[0].name, manifest.name, 'marketplace vs plugin name');
  assert(existsSync(join(ROOT, pkg.bin.arkitect)), 'package.json bin points at a missing file');
  assert(manifest.description.length > 40, 'plugin description is too thin to be useful');
});

test('all four skills are well formed, and only the learning ones are manual', () => {
  const skills = readdirSync(join(ROOT, 'skills')).sort();
  eq(skills.join(','), 'arkitect-drawio,arkitect-excalidraw,learn-drawio-style,learn-excalidraw-style', 'skill directories');
  for (const s of skills) {
    const md = readFileSync(join(ROOT, 'skills', s, 'SKILL.md'), 'utf8');
    assert(/^---\r?\n/.test(md), `${s}: no YAML frontmatter`);
    assert(md.includes(`name: ${s}`), `${s}: frontmatter name does not match the directory`);
    const manual = s.startsWith('learn-');
    eq(md.includes('disable-model-invocation: true'), manual, `${s}: wrong invocation mode`);
  }
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
  /^skills\/arkitect-drawio\/assets\/libraries\/contact-sheets\/(?:\.shot\/|[^/]+\.html$)/,
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

// -------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
if (fail) { console.log('\nfailures:'); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
