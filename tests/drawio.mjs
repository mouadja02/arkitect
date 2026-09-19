#!/usr/bin/env node
// Deterministic, offline test suite.
//
//   node tests/run-tests.mjs        (runs this suite and the Excalidraw one)
//   node tests/drawio.mjs
//
// Tests that need your own reference diagrams (when you supply them) read their paths from
// .analysis/sources.local.json (gitignored). Without that file those tests
// skip rather than fail, so the suite still runs on a clean checkout.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync, deflateSync, inflateSync } from 'node:zlib';
import { repoFiles } from './repo-files.mjs';
import { createHarness, settle } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SKILL = join(ROOT, 'skills', 'arkitect-drawio');
const SCRIPTS = join(SKILL, 'scripts');
const TMP = join(HERE, 'output', 'drawio');
const SOURCES_FILE = join(ROOT, '.analysis', 'sources.local.json');

// The suite never reads or writes the style store of the person running it
// (#89). Every process a test spawns inherits this, so a personal override on
// the machine cannot change what a build here draws.
process.env.ARKITECT_HOME = join(TMP, 'arkitect-home');

// test() is synchronous; a callback that returns a promise fails (#114).
const { test, sourceTest, finish } = createHarness();

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg} (expected ${b}, got ${a})`); }

const node = (script, args, opts = {}) =>
  execFileSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

const sources = existsSync(SOURCES_FILE) ? JSON.parse(readFileSync(SOURCES_FILE, 'utf8')) : null;
// One source list serves both suites; this one reads the `drawio` key.
const sourceList = sources ? (sources.drawio ?? sources.diagrams ?? []) : [];
const haveSources = sourceList.length > 0 && sourceList.every((p) => existsSync(p));

if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const core = await import(`file://${join(SCRIPTS, 'lib', 'drawio-core.mjs').replace(/\\/g, '/')}`);
const finder = await import(`file://${join(SCRIPTS, 'find-icon.mjs').replace(/\\/g, '/')}`);
const builder = await import(`file://${join(SCRIPTS, 'build-diagram.mjs').replace(/\\/g, '/')}`);
const logos = await import(`file://${join(SCRIPTS, 'fetch-logo.mjs').replace(/\\/g, '/')}`);
const validator = await import(`file://${join(SCRIPTS, 'validate-drawio.mjs').replace(/\\/g, '/')}`);
const styleTokens = await import(`file://${join(SCRIPTS, 'lib', 'style-tokens.mjs').replace(/\\/g, '/')}`);
const store = await import(`file://${join(SCRIPTS, 'lib', 'store.mjs').replace(/\\/g, '/')}`);
// The Excalidraw icon builder, for one assertion only: both engines must read
// an SVG's size the same way, and this suite owns the implementation (#96).
const makeIcon = await import(`file://${join(ROOT, 'skills', 'arkitect-excalidraw', 'scripts', 'make-icon.mjs').replace(/\\/g, '/')}`);
const findingsTool = await import(`file://${join(SCRIPTS, 'style-findings.mjs').replace(/\\/g, '/')}`);
const applyTool = await import(`file://${join(SCRIPTS, 'apply-style.mjs').replace(/\\/g, '/')}`);
const osHome = (await import('node:os')).homedir();

const LIB_DIR = join(SKILL, 'assets', 'libraries');

test('mxfile preserves raw decoded/compressed pages and wrapper bytes while ignoring fake tags', () => {
  const file = join(TMP, 'raw-pages.drawio');
  const inner = '\r\n<mxGraphModel><root><mxCell id="0" value="é &amp; x"/></root></mxGraphModel>\r\n';
  const packed = deflateRawSync(Buffer.from(encodeURIComponent(inner), 'binary')).toString('base64');
  const raw = [`<diagram id="a" name="A > B">${inner}</diagram>`, `<diagram id="b">\r\n${packed}\r\n</diagram>`, '<diagram id="c"/>'];
  const opening = '<mxfile host="local > desktop"\r\n agent=\'test\' compressed="true">';
  writeFileSync(file, opening + '<!-- <diagram>fake</diagram> -->'
    + '<![CDATA[ > <diagram>fake</diagram><diagram/> ]]>'
    + '<diagram-extra>fake</diagram-extra>' + raw.join('\r\n') + '</mxfile>');
  const mx = core.readMxfile(file);
  eq(mx.pages.length, 3, 'real page count including self closing');
  eq(mx.opening, opening, 'verbatim wrapper opening');
  raw.forEach((page, i) => eq(mx.pages[i].raw, page, `raw page ${i}`));
  eq(mx.pages[0].xml, inner, 'uncompressed XML API');
  eq(mx.pages[1].xml, inner, 'decoded compressed XML API');
  eq(mx.pages[1].compressed, true, 'compressed metadata');
  eq(mx.pages[2].xml, '', 'empty page XML');
});

// ------------------------------------------------------------- portable rendering

const rendererPath = join(SCRIPTS, 'render-drawio.mjs');
const renderer = existsSync(rendererPath) ? await import(new URL('../skills/arkitect-drawio/scripts/render-drawio.mjs', import.meta.url)) : {};
function rejects(fn, pattern) {
  let error;
  try { fn(); } catch (e) { error = e; }
  assert(error && pattern.test(error.message), `expected ${pattern}, got ${error?.message ?? 'no error'}`);
}

test('renderer parses defaults, explicit options and rejects invalid CLI input', () => {
  assert(typeof renderer.parseArgs === 'function', 'renderer parseArgs is missing');
  const defaults = renderer.parseArgs(['a.drawio']);
  eq(JSON.stringify(defaults), JSON.stringify({ file: 'a.drawio', pageIndex: 0, all: false, width: 2200, outDir: '.', format: 'png', drawioExe: undefined, disableGpu: false, noSandbox: false, pageIndexPassthrough: false }), 'defaults');
  const opts = renderer.parseArgs(['--all', 'a.drawio', '--page-index', '2', '--width', '800', '--out-dir', 'with spaces', '--format', 'svg', '--drawio-exe', '/custom app', '--disable-gpu', '--no-sandbox']);
  eq(opts.pageIndex, 2, 'page index'); eq(opts.width, 800, 'width');
  eq(opts.outDir, 'with spaces', 'directory'); eq(opts.format, 'svg', 'format');
  eq(opts.drawioExe, '/custom app', 'override'); assert(opts.all && opts.disableGpu && opts.noSandbox, 'switches');
  for (const args of [[], ['a', 'b'], ['a', '--unknown'], ['a', '--width'], ['a', '--width', '0'], ['a', '--width', '1.5'], ['a', '--page-index', '-1'], ['a', '--page-index', 'NaN'], ['a', '--page-index', '9007199254740992'], ['a', '--out-dir'], ['a', '--format', '../png'], ['a', '--drawio-exe']]) {
    rejects(() => renderer.parseArgs(args), /usage|unknown|expected|positive|non-negative|format/i);
  }
  assert(renderer.parseArgs(['--help']).help, 'help without file');
});

test('renderer discovers auto-discovery candidates in priority order and reports all misses', () => {
  assert(typeof renderer.discoverDrawio === 'function', 'discoverDrawio missing');
  for (const platform of ['linux', 'darwin', 'win32']) {
    const onWindows = platform === 'win32';
    const env = { PATH: onWindows ? 'C:\\Tools;D:\\Apps' : '/tools:/apps' };
    const candidates = [
      ...(onWindows ? ['C:\\Tools\\drawio.exe', 'D:\\Apps\\drawio.exe'] : ['/tools/drawio', '/apps/drawio']),
      '/opt/drawio/drawio', '/usr/bin/drawio', '/Applications/draw.io.app/Contents/MacOS/draw.io',
      'C:\\Program Files\\draw.io\\draw.io.exe', 'C:\\Program Files (x86)\\draw.io\\draw.io.exe'];
    for (let i = 0; i < candidates.length; i++) {
      const tried = [];
      eq(renderer.discoverDrawio(undefined, { platform, env, isExecutable: p => { tried.push(p); return p === candidates[i]; } }), candidates[i], 'chosen candidate');
      eq(JSON.stringify(tried), JSON.stringify(candidates.slice(0, i + 1)), 'probe order');
    }
    let message = '';
    try { renderer.discoverDrawio(undefined, { platform, env, isExecutable: () => false }); } catch (e) { message = e.message; }
    for (const path of candidates) assert(message.includes(path), `error omits ${path}`);
  }
});

test('renderer pins an explicit override and never falls through to auto-discovery', () => {
  assert(typeof renderer.discoverDrawio === 'function', 'discoverDrawio missing');
  for (const platform of ['linux', 'darwin', 'win32']) {
    let probes = 0; let message = '';
    try { renderer.discoverDrawio('/override/drawio', { platform, env: {}, isExecutable: p => { probes++; return false; } }); } catch (e) { message = e.message; }
    assert(message.includes('--drawio-exe'), 'names --drawio-exe');
    assert(message.includes('/override/drawio'), 'names the override path');
    eq(probes, 1, 'override probes exactly once and never falls through');

    probes = 0; message = '';
    try { renderer.discoverDrawio(undefined, { platform, env: { DRAWIO_EXE: '/environment/drawio' }, isExecutable: p => { probes++; return false; } }); } catch (e) { message = e.message; }
    assert(message.includes('DRAWIO_EXE'), 'names DRAWIO_EXE');
    assert(message.includes('/environment/drawio'), 'names the env path');
    eq(probes, 1, 'env pin probes exactly once and never falls through');

    probes = 0;
    eq(renderer.discoverDrawio('/override/drawio', { platform, env: { DRAWIO_EXE: '/environment/drawio' }, isExecutable: p => { probes++; return p === '/override/drawio'; } }), '/override/drawio', 'executable override wins over env');
    eq(probes, 1, 'executable override probes once');
  }
});

test('locateDrawio reports the path, the source that won and every path tried (#46)', () => {
  const linux = { platform: 'linux', env: { PATH: '/tools:/apps' } };
  const at = (winner, deps = linux) => renderer.locateDrawio(undefined, { ...deps, isExecutable: p => p === winner });
  const shape = r => JSON.stringify([r.path, r.source, r.tried]);
  eq(shape(at('/apps/drawio')), JSON.stringify(['/apps/drawio', 'PATH', ['/tools/drawio', '/apps/drawio']]), 'found on PATH');
  eq(shape(at('/opt/drawio/drawio')), JSON.stringify(['/opt/drawio/drawio', 'install location', ['/tools/drawio', '/apps/drawio', '/opt/drawio/drawio']]),
    'the official .deb location');
  eq(shape(at('/usr/bin/drawio', { platform: 'linux', env: { PATH: '/usr/bin' } })), JSON.stringify(['/usr/bin/drawio', 'PATH', ['/usr/bin/drawio']]),
    'a PATH entry that is also an install location is probed once, as PATH');
  eq(shape(renderer.locateDrawio(undefined, { platform: 'linux', env: { PATH: '/tools', DRAWIO_EXE: '/pin/drawio' }, isExecutable: p => p === '/pin/drawio' })),
    JSON.stringify(['/pin/drawio', 'DRAWIO_EXE', ['/pin/drawio']]), 'DRAWIO_EXE');
  const flag = renderer.locateDrawio('/flag/drawio', { platform: 'linux', env: {}, isExecutable: () => false });
  eq(shape(flag), JSON.stringify([null, '--drawio-exe', ['/flag/drawio']]), 'an unusable --drawio-exe never falls through');
  assert(flag.error.includes('--drawio-exe /flag/drawio is not executable'), flag.error);
  const none = at('nowhere');
  eq(JSON.stringify([none.path, none.source, none.tried.length]), JSON.stringify([null, null, 7]), 'two PATH entries and five install locations tried');
  eq(JSON.stringify(none.onPath), JSON.stringify(['/tools/drawio', '/apps/drawio']), 'the PATH candidates are told apart');
  eq(JSON.stringify(renderer.locateDrawio(undefined, { platform: 'linux', env: { PATH: '/a:/a' }, isExecutable: () => false }).onPath),
    JSON.stringify(['/a/drawio']), 'a repeated PATH entry is probed once');
  assert(none.error.startsWith('Draw.io Desktop not found.'), none.error);
  eq(renderer.discoverDrawio(undefined, { ...linux, isExecutable: p => p === '/opt/drawio/drawio' }), '/opt/drawio/drawio', 'discoverDrawio answers with the same path');
});

test('renderer splits zero-based pages on all platforms and preserves opt-in Electron flags', () => {
  assert(typeof renderer.render === 'function', 'render missing');
  const file = join(TMP, 'two pages.drawio');
  const opening = '<mxfile host="desktop > local"\r\n compressed="true" agent=\'test\'>';
  const packed = deflateRawSync(Buffer.from(encodeURIComponent('<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>'))).toString('base64');
  const raw = ['<diagram id="a">\r\n<mxGraphModel/>\r\n</diagram>', `<diagram id="b">\r\n${packed}\r\n</diagram>`];
  writeFileSync(file, opening + raw.join('\r\n') + '</mxfile>');
  for (const platform of ['linux', 'win32', 'darwin']) {
    const lines = []; const calls = [];
    const outDir = join(TMP, `render-${platform}`);
    const options = renderer.parseArgs([file, '--all', '--width', '600', '--out-dir', outDir, '--format', 'svg', '--drawio-exe', '/custom app', '--disable-gpu', '--no-sandbox']);
    const result = renderer.render(options, { platform, env: { DISPLAY: ':1' }, isExecutable: p => p === '/custom app', log: s => lines.push(s), runner: (exe, args, opts) => {
      const input = args[args.indexOf('-o') + 2];
      calls.push({ exe, args, opts, input, bytes: readFileSync(input), count: core.readMxfile(input).pages.length, mode: statSync(dirname(input)).mode & 0o777 });
      writeFileSync(args[args.indexOf('-o') + 1], '<svg/>');
      return { status: 9, stderr: 'Chromium cache noise' };
    } });
    assert(result.ok, 'fresh nonempty output must win over noisy nonzero exit');
    eq(calls.length, 2, 'all diagram elements'); eq(lines.length, 2, 'one report per page');
    calls.forEach(({ exe, args, opts, input, bytes, count, mode }, i) => {
      eq(exe, '/custom app', 'no shell splitting');
      eq(JSON.stringify(args), JSON.stringify(['-x', '-f', 'svg', '--width', '600', '-o', join(outDir, `two pages.p${i}.svg`), input, '--disable-gpu', '--no-sandbox']), 'argv without Desktop index');
      assert(input !== file && input.endsWith('.drawio'), 'private split input');
      eq(count, 1, 'exactly one page per input');
      assert(bytes.equals(Buffer.from(opening + raw[i] + '</mxfile>')), 'wrapper and payload bytes preserved');
      if (process.platform !== 'win32') eq(mode, 0o700, 'private temporary directory');
      assert(!existsSync(input) && !existsSync(dirname(input)), 'temporary input and directory removed after success');
      assert(!opts.shell, 'must not use a shell');
      assert(lines[i].includes(`rendered page ${i}`) && lines[i].includes('(6 bytes)'), 'report includes index and size');
    });
  }
  const calls = [];
  const result = renderer.render(renderer.parseArgs([file, '--page-index', '1', '--out-dir', join(TMP, 'single')]), {
    platform: 'linux', env: { PATH: '/tools' }, isExecutable: p => p === '/tools/drawio', log: () => {},
    runner: (exe, args) => { calls.push(args); writeFileSync(args[args.indexOf('-o') + 1], 'png'); return { status: 0 }; },
  });
  assert(result.ok, 'single page succeeds'); eq(calls.length, 1, 'one selected page');
  assert(!calls[0].includes('--disable-gpu') && !calls[0].includes('--no-sandbox'), 'flags never enabled implicitly');
  assert(!calls[0].includes('--page-index'), 'selected page also omits Desktop index');
});

test('renderer debug passthrough uses the original source and exact raw index on every platform', () => {
  const file = join(TMP, 'passthrough.drawio');
  writeFileSync(file, '<mxfile><diagram/><diagram/></mxfile>');
  for (const platform of ['linux', 'win32', 'darwin']) for (const rawIndex of ['0', '1', '01']) {
    let invocation;
    const options = renderer.parseArgs([file, '--page-index', rawIndex, '--page-index-passthrough', '--out-dir', join(TMP, 'passthrough')]);
    assert(options.pageIndexPassthrough, 'debug switch enabled');
    const result = renderer.render(options, { platform, env: { DISPLAY: ':1' }, isExecutable: () => true, log: () => {}, runner: (exe, args) => {
      invocation = args; writeFileSync(args[args.indexOf('-o') + 1], 'png'); return { status: 0 };
    } });
    assert(result.ok, 'passthrough exported');
    eq(invocation[invocation.indexOf('-o') + 2], file, 'original source, not split');
    eq(invocation[invocation.indexOf('--page-index') + 1], rawIndex, 'raw CLI index unchanged');
  }
});

test('renderer removes split inputs after empty output, spawn failure and reporting failure', () => {
  const file = join(TMP, 'cleanup.drawio'); writeFileSync(file, '<mxfile><diagram/></mxfile>');
  for (const failure of ['empty', 'spawn', 'log']) {
    let input;
    const run = () => renderer.render(renderer.parseArgs([file, '--out-dir', join(TMP, 'cleanup')]), {
      platform: 'linux', env: { DISPLAY: ':1' }, isExecutable: () => true,
      log: () => { if (failure === 'log') throw new Error('report failed'); },
      runner: (exe, args) => { input = args[args.indexOf('-o') + 2]; if (failure === 'spawn') throw new Error('spawn failed'); return { status: 1 }; },
    });
    if (failure === 'log') rejects(run, /report failed/); else assert(!run().ok, 'failure reported');
    assert(input !== file && !existsSync(input) && !existsSync(dirname(input)), `cleaned after ${failure}`);
    assert(existsSync(file), 'source never deleted');
  }
});

test('renderer validates all and passthrough ranges before discovery or export', () => {
  const file = join(TMP, 'invalid-ranges.drawio'); writeFileSync(file, '<mxfile><diagram/><diagram/></mxfile>');
  for (const flags of [[], ['--all'], ['--page-index-passthrough'], ['--all', '--page-index-passthrough']]) {
    const options = renderer.parseArgs([file, '--page-index', '2', ...flags]);
    let probes = 0; let calls = 0;
    rejects(() => renderer.render(options, { isExecutable: () => { probes++; return true; }, runner: () => { calls++; }, log: () => {} }), /out of range/);
    eq(probes, 0, 'no discovery before validation'); eq(calls, 0, 'no export before validation');
  }
});

test('renderer wraps only headless Linux with available xvfb-run and logs the wrapper', () => {
  const file = join(TMP, 'headless.drawio'); writeFileSync(file, '<mxGraphModel/>');
  // [platform, DISPLAY, is that display's X server reachable, xvfb-run installed, wrapped]
  for (const [platform, display, up, haveXvfb, wrapped] of [
    ['linux', '', false, true, true], ['linux', ':7', true, true, false], ['linux', '', false, false, false],
    ['darwin', '', false, true, false], ['win32', '', false, true, false],
    // A sandbox that hides the X socket (WSLg's :0 included) gets xvfb-run (#113).
    ['linux', ':0', false, true, true],
  ]) {
    const lines = []; let invocation;
    renderer.render(renderer.parseArgs([file, '--all', '--out-dir', join(TMP, 'headless')]), {
      platform, env: { PATH: '/tools', DISPLAY: display }, displayUp: () => up,
      isExecutable: p => p.includes('drawio') || (haveXvfb && p.endsWith('xvfb-run')),
      log: s => lines.push(s), runner: (exe, args) => {
        invocation = { exe, args }; writeFileSync(args[args.indexOf('-o') + 1], 'png'); return { status: 0 };
      },
    });
    eq(invocation.exe.endsWith('xvfb-run'), wrapped, 'wrapper selection');
    eq(lines.some(s => s.includes('xvfb-run -a')), wrapped, 'wrapper log');
    if (wrapped) eq(JSON.stringify(invocation.args.slice(0, 3)), JSON.stringify(['-a', '/tools/drawio', '-x']), 'wrapper argv');
    if (wrapped && display) assert(lines.some(s => s.includes(`DISPLAY ${display} has no X server here`)), `says why: ${lines.join(' | ')}`);
  }
});

test('a local DISPLAY counts only when its X socket exists, and a failed export says why (#113)', () => {
  const socket = (want) => (p) => p === want;
  eq(renderer.displayReachable(':0', { exists: socket('/tmp/.X11-unix/X0') }), true, ':0 with its socket');
  eq(renderer.displayReachable(':0', { exists: () => false }), false, ':0 without its socket');
  eq(renderer.displayReachable('unix:3.0', { exists: socket('/tmp/.X11-unix/X3') }), true, 'unix:N.S names socket N');
  eq(renderer.displayReachable('build-host:10.0', { exists: () => false }), true, 'a remote display is trusted');
  eq(renderer.displayReachable('', { exists: () => true }), false, 'no DISPLAY');

  const crashed = { status: null, signal: 'SIGTRAP', stderr: '[9:0918/1:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.systemd1.Manager.StartTransientUnit\n'
    + '[9:0918/1:ERROR:ui/ozone/platform/x11/ozone_platform_x11.cc:257] Missing X server or $DISPLAY\n[9:0918/1:ERROR:ui/aura/env.cc:246] The platform failed to initialize.  Exiting.\n' };
  eq(renderer.exportFailure(crashed), 'killed by SIGTRAP: Missing X server or $DISPLAY', 'the signal and the first real error');
  eq(renderer.exportFailure({ status: 3, stderr: '' }), 'exit 3', 'a bare exit code');
  eq(renderer.exportFailure({ error: new Error('spawn xvfb-run ENOENT') }), 'spawn xvfb-run ENOENT', 'a spawn error');
  eq(renderer.exportFailure({ status: 0, stderr: '' }), '', 'nothing to say');

  const file = join(TMP, 'crash.drawio'); writeFileSync(file, '<mxGraphModel/>');
  const lines = [];
  const result = renderer.render(renderer.parseArgs([file, '--out-dir', join(TMP, 'crash')]), {
    platform: 'linux', env: { PATH: '/tools', DISPLAY: ':1' }, displayUp: () => true, isExecutable: p => p.includes('drawio'),
    log: s => lines.push(s), runner: () => crashed,
  });
  eq(result.ok, false, 'an empty export fails');
  assert(lines.some(s => s.includes('FAILED') && s.includes('(killed by SIGTRAP: Missing X server or $DISPLAY)')), `the log says why: ${lines.join(' | ')}`);
});

test('renderer backs up before export, rejects stale or empty output and continues after failure', () => {
  const file = join(TMP, 'freshness.drawio'); writeFileSync(file, '<mxfile><diagram/><diagram/></mxfile>');
  const outDir = join(TMP, 'freshness'); mkdirSync(outDir);
  const target = join(outDir, 'freshness.p0.png'); writeFileSync(target, 'original');
  const lines = []; let calls = 0;
  const deps = { platform: 'linux', env: {}, isExecutable: () => true, log: s => lines.push(s), runner: (exe, args) => {
    calls++;
    if (calls === 1) {
      assert(!existsSync(target), 'stale output still present during export');
      const backups = readdirSync(outDir).filter(p => p.includes('backup-'));
      eq(backups.length, 1, 'backup exists before invocation');
      eq(readFileSync(join(outDir, backups[0]), 'utf8'), 'original', 'backup bytes');
      return { status: 0, stderr: 'no export' };
    }
    writeFileSync(args[args.indexOf('-o') + 1], 'new'); return { status: 1 };
  } };
  const options = renderer.parseArgs([file, '--all', '--out-dir', outDir]);
  const result = renderer.render(options, deps);
  assert(!result.ok && !result.pages[0].ok && result.pages[1].ok, 'mixed outcome fails overall');
  eq(calls, 2, 'continue after failed page'); eq(lines.length, 2, 'one report each');
  assert(lines[0].includes('FAILED') && lines[0].includes('(0 bytes)'), 'failed report');
  eq(readFileSync(target, 'utf8'), 'original', 'restore previous output on failed export');
  const again = renderer.render({ ...options, all: false }, { ...deps, runner: (exe, args) => {
    writeFileSync(args[args.indexOf('-o') + 1], ''); return { status: 0 };
  } });
  assert(!again.ok, 'empty fresh file cannot succeed');
  eq(readdirSync(outDir).filter(p => p.includes('backup-')).length, 2, 'unique backups even in same second');
  eq(readFileSync(target, 'utf8'), 'original', 'empty export restores original');
  const thrown = renderer.render({ ...options, all: false }, { ...deps, runner: () => { throw new Error('spawn failed'); } });
  assert(!thrown.ok, 'spawn failure reported');
  eq(readFileSync(target, 'utf8'), 'original', 'spawn failure restores original');
  rejects(() => renderer.render({ ...options, file: join(TMP, 'absent.drawio') }, deps), /no such diagram/i);
});

test('renderer CLI exposes help, validates arguments and propagates through the dispatcher', () => {
  for (const prefix of [[rendererPath], [join(ROOT, 'bin', 'arkitect.mjs'), 'drawio', 'render']]) {
    const run = args => spawnSync(process.execPath, [...prefix, ...args], { encoding: 'utf8' });
    const help = run(['--help']); eq(help.status, 0, 'help status');
    assert(help.stdout.includes('--page-index') && help.stdout.includes('--drawio-exe'), 'renderer help surfaced');
    const invalid = run(['a.drawio', '--width', '0']);
    eq(invalid.status, 2, 'argument failure status'); assert(invalid.stderr.includes('positive'), 'argument diagnostic');
    const missing = run([join(TMP, 'missing.drawio')]);
    eq(missing.status, 1, 'missing input status'); assert(missing.stderr.includes('No such diagram'), 'missing input diagnostic');
    // Node is an existing executable but cannot accept Draw.io flags; proves the
    // real subprocess failure path without installing or launching Desktop.
    const noOutput = run([join(TMP, 'headless.drawio'), '--drawio-exe', process.execPath, '--out-dir', join(TMP, 'cli-failure')]);
    eq(noOutput.status, 1, 'no-output export status'); assert(noOutput.stdout.includes('FAILED'), 'export failure report');
  }
  const help = execFileSync(process.execPath, [join(ROOT, 'bin', 'arkitect.mjs'), '--help'], { encoding: 'utf8' });
  assert(help.includes('arkitect drawio render'), 'dispatcher command listing');
});

test('renderer rejects an explicit page index beyond the real page count', () => {
  const file = join(TMP, 'range.drawio');
  writeFileSync(file, '<mxfile><diagram id="a"/><diagram id="b"/></mxfile>');
  const outDir = join(TMP, 'range');
  rejects(() => renderer.render(renderer.parseArgs([file, '--page-index', '2', '--out-dir', outDir]), {
    platform: 'linux', env: {}, isExecutable: () => true, log: () => {},
    runner: () => { throw new Error('must not run'); },
  }), /out of range/i);
  const calls = [];
  const ok = renderer.render(renderer.parseArgs([file, '--page-index', '1', '--out-dir', outDir]), {
    platform: 'linux', env: {}, isExecutable: () => true, log: () => {},
    runner: (exe, args) => { calls.push(args); writeFileSync(args[args.indexOf('-o') + 1], 'png'); return { status: 0 }; },
  });
  assert(ok.ok && calls.length === 1, 'in-range index still renders');
});

test('renderer counts only real diagram elements, ignoring comments, CDATA and lookalikes', () => {
  const file = join(TMP, 'county.drawio');
  writeFileSync(file, '<mxfile>'
    + '<diagram id="real1"/>'
    + '<!-- <diagram id="commented"/> -->'
    + '<diagram-extra id="lookalike"/>'
    + '<![CDATA[ <diagram id="cdata"/> ]]>'
    + '<diagram id="real2"/>'
    + '</mxfile>');
  const outDir = join(TMP, 'county');
  let calls = 0;
  const result = renderer.render(renderer.parseArgs([file, '--all', '--out-dir', outDir]), {
    platform: 'linux', env: {}, isExecutable: () => true, log: () => {},
    runner: (exe, args) => { calls++; writeFileSync(args[args.indexOf('-o') + 1], 'png'); return { status: 0 }; },
  });
  assert(result.ok, 'all real pages render');
  eq(calls, 2, 'only the two real <diagram> elements export');
});

test('renderer accepts prototype-key filenames and rejects extra positionals', () => {
  for (const name of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    eq(renderer.parseArgs([name]).file, name, `filename "${name}"`);
  }
  rejects(() => renderer.parseArgs(['a.drawio', 'toString']), /Expected one file/i);
});

test('renderer preserves standalone graph models after declarations and leading comments', () => {
  const model = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>';
  const file = join(TMP, 'standalone-prolog.drawio');
  for (const prefix of ['<?xml version="1.0" encoding="UTF-8"?>\r\n', '<!-- <mxfile><diagram/> -->\n', '<?xml version="1.0"?>\n<!-- first -->\n<!-- second -->\n']) {
    writeFileSync(file, prefix + model);
    let input;
    const result = renderer.render(renderer.parseArgs([file, '--out-dir', join(TMP, 'standalone-prolog')]), {
      platform: 'linux', env: {}, isExecutable: () => true, log: () => {},
      runner: (exe, args) => {
        input = args.at(-1);
        eq(readFileSync(input, 'utf8'), `<mxfile><diagram>${model}</diagram></mxfile>`, 'only graph XML inside diagram');
        writeFileSync(args[args.indexOf('-o') + 1], 'png'); return { status: 0 };
      },
    });
    assert(result.ok, 'standalone XML prolog is supported');
    assert(!existsSync(input), 'temporary standalone file cleaned');
  }
});

// Opt-in local integration: ARKITECT_DRAWIO_SMOKE=1 node tests/drawio.mjs.
// Default tests remain offline/deterministic with no new prerequisite skips.
// ARKITECT_DRAWIO_SMOKE=required is what CI sets: a missing Desktop then fails
// the run instead of skipping, so a broken install cannot pass as green.
const SMOKE = process.env.ARKITECT_DRAWIO_SMOKE;
const smokeEnabled = SMOKE === '1' || SMOKE === 'required';
function desktopOrSkip() {
  try { return renderer.discoverDrawio(); } catch (error) {
    if (SMOKE === 'required') throw new Error(`ARKITECT_DRAWIO_SMOKE=required, but ${error.message.split('\n')[0]}`);
    return null;
  }
}
// Ubuntu's AppArmor refuses Electron's sandbox for an unprivileged runner.
const electronFlags = ['--disable-gpu', ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : [])];

if (smokeEnabled) test('installed Desktop exports distinct synthetic pages as real PNGs', () => {
  const exe = desktopOrSkip();
  if (!exe) return 'skip';
  const file = join(TMP, 'desktop-smoke.drawio');
  const page = (id, color, width) => `<diagram id="${id}" name="${id}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="${id}" style="fillColor=${color};" vertex="1" parent="1"><mxGeometry x="10" y="10" width="${width}" height="80" as="geometry"/></mxCell></root></mxGraphModel></diagram>`;
  writeFileSync(file, `<mxfile>${page('first', '#ff0000', 160)}${page('second', '#0000ff', 320)}</mxfile>`);
  const outDir = join(TMP, 'desktop-smoke');
  const result = spawnSync(process.execPath, [join(ROOT, 'bin', 'arkitect.mjs'), 'drawio', 'render', file, '--all', '--width', '600', '--out-dir', outDir, '--drawio-exe', exe, ...electronFlags], { encoding: 'utf8', timeout: 120000 });
  eq(result.status, 0, `Desktop export: ${result.stdout} ${result.stderr}`);
  const pages = [0, 1].map(i => readFileSync(join(outDir, `desktop-smoke.p${i}.png`)));
  for (const png of pages) {
    eq(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
    eq(png.readUInt32BE(16), 600, 'PNG width');
    assert(png.length > 100, 'nontrivial PNG');
  }
  assert(!pages[0].equals(pages[1]), 'both exports selected the same page');
});

// A PNG as Desktop exports it - 8-bit, non-interlaced grey/RGB/RGBA - decoded to
// pixels, written out longhand because the toolkit takes no dependencies.
function decodePng(buf) {
  let offset = 8;
  let ihdr = null;
  const idat = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colour: data[9], interlace: data[12] };
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr?.colour];
  if (!ihdr || ihdr.depth !== 8 || ihdr.interlace !== 0 || !channels) {
    throw new Error(`unsupported PNG layout ${JSON.stringify(ihdr)}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = ihdr.width * channels;
  const pixels = Buffer.alloc(ihdr.height * stride);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < ihdr.height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    const line = Buffer.from(raw.subarray(start + 1, start + 1 + stride));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      line[x] = (line[x] + predictor) & 0xff;
    }
    line.copy(pixels, y * stride);
    previous = line;
  }
  return { width: ihdr.width, height: ihdr.height, channels, pixels };
}

// Share of pixels that carry ink - opaque and not near-white - in a box of a
// PNG, the whole image unless a box is given.
function pngInk(png, box = {}) {
  const image = Buffer.isBuffer(png) ? decodePng(png) : png;
  const { x = 0, y = 0, width = image.width, height = image.height } = box;
  const { channels, pixels } = image;
  let ink = 0;
  for (let row = y; row < y + height; row++) {
    for (let col = x; col < x + width; col++) {
      const at = (row * image.width + col) * channels;
      const alpha = channels === 4 ? pixels[at + 3] : channels === 2 ? pixels[at + 1] : 255;
      const darkest = channels >= 3 ? Math.min(pixels[at], pixels[at + 1], pixels[at + 2]) : pixels[at];
      if (alpha > 32 && darkest < 235) ink++;
    }
  }
  return ink / (width * height);
}

function pngBytes(width, height, pixel) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.from([0]));
    for (let x = 0; x < width; x++) rows.push(Buffer.from(pixel(x, y)));
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

test('the PNG ink reader tells a drawn page from a blank one', () => {
  eq(pngInk(pngBytes(10, 10, () => [255, 255, 255, 255])), 0, 'white page');
  eq(pngInk(pngBytes(10, 10, () => [0, 0, 0, 0])), 0, 'transparent page');
  eq(pngInk(pngBytes(10, 10, (x) => (x < 3 ? [30, 90, 200, 255] : [255, 255, 255, 255]))), 0.3, 'three columns of ink');
});

// #33: the export covers every committed mark, not the first of each pack.
// Marks sit in 100px cells, 400 to a page, fitted to 78px with no caption or
// border - in a column widened, on every page alike, to hold the widest lockup
// (#76) - and two invisible corner cells pin each page's bounds so every mark
// lands on known pixels. Ink is measured inside each mark's own box: a share
// taken over the whole page cannot see one blank mark among 399 drawn ones, and
// a caption's text would pass for artwork.
const TILE_GRID = { perRow: 20, perPage: 400, cell: 100, icon: 78 };

function tilePages(icons, { perRow, perPage, cell, icon: size } = TILE_GRID) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const corner = (id, x, y) => `<mxCell id="${id}" value="" style="fillColor=none;strokeColor=none;" vertex="1" parent="1">`
    + `<mxGeometry x="${x}" y="${y}" width="1" height="1" as="geometry"/></mxCell>`;
  const sizedAll = icons.map((icon) => ({ icon, ...finder.recommendedSize(icon, size) }));
  // A wide lockup is drawn wider than the footprint (#76), so the column has to
  // hold the widest tile: ink is measured inside each mark's own box, and boxes
  // that overlapped would let a blank mark borrow the ink of the one beside it.
  // One width serves every page, not one per page - the export renders all pages
  // in a single call at a single --width, so a page laid out wider than that
  // comes back scaled and its tiles are no longer where the measurement looks.
  const colW = Math.max(cell, ...sizedAll.map((t) => t.width + 4));
  const pages = [];
  for (let start = 0; start < icons.length; start += perPage) {
    const n = pages.length;
    const sized = sizedAll.slice(start, start + perPage);
    const rows = Math.ceil(sized.length / perRow);
    const tiles = sized.map((t, i) => ({
      ...t,
      x: (i % perRow) * colW + Math.round((colW - t.width) / 2),
      y: Math.floor(i / perRow) * cell + Math.round((cell - t.height) / 2),
    }));
    const cells = tiles.map((t, i) => `<mxCell id="i${i}" value="" style="${esc(finder.styleFor(t.icon))}" vertex="1" parent="1">`
      + `<mxGeometry x="${t.x}" y="${t.y}" width="${t.width}" height="${t.height}" as="geometry"/></mxCell>`).join('')
      + corner('top-left', 0, 0) + corner('bottom-right', perRow * colW - 1, rows * cell - 1);
    pages.push({
      tiles, width: perRow * colW, height: rows * cell,
      xml: `<diagram id="p${n}" name="p${n}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram>`,
    });
  }
  return pages;
}

test('ink is measured in each mark\'s own tile, so one blank mark among drawn ones is found (#33)', () => {
  const icons = finder.loadCatalog().icons.filter((i) => i.bytes === 'committed').slice(0, 3);
  const pages = tilePages(icons, { perRow: 2, perPage: 2, cell: 100, icon: 78 });
  eq(pages.length, 2, 'three marks at two a page');
  eq(pages.map((p) => `${p.width}x${p.height}`).join(' '), '200x100 200x100', 'page bounds follow the rows used');
  assert(pages.every((p) => p.xml.includes('id="top-left"') && p.xml.includes('id="bottom-right"')), 'corner cells pin every page');
  const [drawn, blank] = pages[0].tiles;
  assert(drawn.x >= 0 && drawn.x + drawn.width <= blank.x && blank.x + blank.width <= 200
    && [drawn, blank].every((t) => t.y >= 0 && t.y + t.height <= 100), 'tiles stay apart and inside their page');
  const inside = (t, x, y) => x >= t.x && x < t.x + t.width && y >= t.y && y < t.y + t.height;
  const png = decodePng(pngBytes(200, 100, (x, y) => (inside(drawn, x, y) ? [20, 20, 20, 255] : [255, 255, 255, 255])));
  assert(pngInk(png) > 0.01, 'the page as a whole carries ink');
  eq(pngInk(png, drawn), 1, 'the drawn tile is all ink');
  eq(pngInk(png, blank), 0, 'the blank tile is found');
});

// The five GCP legacy marks with luminance masks and filters are named, because
// an export that silently drops a mask is exactly what #13 feared.
const MASKED_GCP = ['Cloud Healthcare API', 'My Cloud', 'OS Inventory Management', 'Pub/Sub', 'Security Health Advisor'];

if (smokeEnabled) test('every committed mark, the masked GCP marks among them, exports with ink in its own tile (#12, #13, #33)', () => {
  const exe = desktopOrSkip();
  if (!exe) return 'skip';
  const icons = finder.loadCatalog().icons.filter((i) => i.bytes === 'committed');
  for (const title of MASKED_GCP) assert(icons.some((i) => i.pack === 'gcp' && i.title === title), `no committed GCP mark "${title}"`);
  const pages = tilePages(icons);
  const file = join(TMP, 'every-mark.drawio');
  writeFileSync(file, `<mxfile>${pages.map((p) => p.xml).join('')}</mxfile>`);
  const outDir = join(TMP, 'every-mark');
  const result = spawnSync(process.execPath, [join(ROOT, 'bin', 'arkitect.mjs'), 'drawio', 'render', file, '--all',
    '--width', String(pages[0].width), '--out-dir', outDir, '--drawio-exe', exe, ...electronFlags],
  { encoding: 'utf8', timeout: 1200000 });
  eq(result.status, 0, `Desktop export: ${result.stdout} ${result.stderr}`);
  const problems = [];
  const measured = [];
  const digests = new Set();
  pages.forEach((page, n) => {
    const bytes = readFileSync(join(outDir, `every-mark.p${n}.png`));
    digests.add(createHash('sha256').update(bytes).digest('hex'));
    const png = decodePng(bytes);
    // Desktop can round a page edge by a pixel. Every mark sits at least 11px
    // inside its cell, so that much drift still measures the right artwork.
    if (Math.abs(png.width - page.width) > 2 || Math.abs(png.height - page.height) > 2) {
      problems.push(`page ${n}: exported at ${png.width}x${png.height}, laid out at ${page.width}x${page.height}, so its tiles cannot be located`);
      return;
    }
    for (const tile of page.tiles) {
      const box = { x: tile.x, y: tile.y, width: Math.min(tile.width, png.width - tile.x), height: Math.min(tile.height, png.height - tile.y) };
      const ink = pngInk(png, box);
      measured.push({ id: tile.icon.id, ink });
      // The sparsest committed mark covers about 5% of its box; a mark the
      // exporter could not paint covers none of it.
      if (ink < 0.01) problems.push(`${tile.icon.pack} / ${tile.icon.libraryIndex} / ${tile.icon.id} / ${(ink * 100).toFixed(2)}% ink in its tile`);
    }
  });
  eq(digests.size, pages.length, 'every page exported its own marks');
  const sparsest = [...measured].sort((a, b) => a.ink - b.ink).slice(0, 10);
  console.log(`        ${measured.length} of ${icons.length} marks measured; sparsest: `
    + sparsest.map((m) => `${m.id} ${(m.ink * 100).toFixed(1)}%`).join(', '));
  assert(problems.length === 0, reportProblems(problems));
});

// ------------------------------------------------------------- packs

const packs = await import(`file://${join(SCRIPTS, 'build-packs.mjs').replace(/\\/g, '/')}`);

test('every pack the manifest declares is committed and parses', () => {
  const manifest = packs.loadManifest();
  const cat = finder.loadCatalog();
  eq(cat.packs.length, manifest.packs.length, 'pack count');
  for (const p of cat.packs) {
    const entries = core.readLibrary(join(LIB_DIR, p.file));
    eq(entries.length, p.count, `${p.id} entry count`);
  }
});

// Draw.io opens a library in EditorUi.loadLibrary: mxUtils.parseXml, an
// <mxlibrary> root, then JSON.parse(mxUtils.getTextContent(root)). Then
// addLibraryEntries turns each entry's `data` into `image=<data>` at w x h under
// its title. This loader follows that path, at least as strictly as a browser's
// XML parser, and shares no code with readLibrary, so an escaping bug in
// writeLibrary cannot pass by being read back by an equally forgiving reader.
const iconBuild = await import(`file://${join(SCRIPTS, 'lib', 'icon-build.mjs').replace(/\\/g, '/')}`);
const XML_TEXT_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const XML_CHAR = /^[\t\n\r\x20-퟿-�\u{10000}-\u{10FFFF}]*$/u;

const xmlCheck = await import(`file://${join(SCRIPTS, 'lib', 'xml-check.mjs').replace(/\\/g, '/')}`);

// Every problem counted, the first twenty shown, so one run names every broken
// mark instead of one per run (#33).
function reportProblems(problems, shown = 20) {
  return `${problems.length} problem${problems.length === 1 ? '' : 's'}:\n        ${problems.slice(0, shown).join('\n        ')}`
    + (problems.length > shown ? `\n        ... and ${problems.length - shown} more` : '');
}

// A fault in the library itself throws: Draw.io would not open it. A fault in
// an entry is collected, every one of them, because Draw.io still lists the
// other entries and paints nothing for that one (#33).
function loadLikeDrawio(text) {
  if (!XML_CHAR.test(text)) throw new Error('a character XML does not allow');
  const m = /^﻿?(?:<\?xml[^?]*\?>)?\s*<mxlibrary((?:\s+[A-Za-z_:][\w.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*>([^<]*)<\/mxlibrary>\s*$/.exec(text);
  if (!m) throw new Error('not a single <mxlibrary> root holding only text');
  const body = m[2];
  if (body.includes(']]>')) throw new Error('"]]>" inside XML text');
  const reference = /&(#x[0-9A-Fa-f]+|#[0-9]+|lt|gt|amp|quot|apos);/g;
  if (body.replace(reference, '').includes('&')) throw new Error('an unescaped "&" or an entity XML does not define');
  const decoded = body.replace(reference, (_, ref) => {
    if (ref[0] !== '#') return XML_TEXT_ENTITIES[ref];
    const ch = String.fromCodePoint(ref[1] === 'x' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1)));
    if (!XML_CHAR.test(ch)) throw new Error(`character reference &${ref}; is not an XML character`);
    return ch;
  });
  const entries = JSON.parse(decoded);
  if (!Array.isArray(entries)) throw new Error('the library JSON is not an array');
  const problems = [];
  const loaded = entries.map((e, index) => {
    try {
      return loadEntryLikeDrawio(e);
    } catch (error) {
      problems.push({ index, title: typeof e?.title === 'string' ? e.title : null, reason: error.message });
      return null;
    }
  });
  return { entries: loaded, problems };
}

function loadEntryLikeDrawio(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error('not an object');
  if (typeof e.title !== 'string' || !e.title) throw new Error('no title');
  if (!(Number.isFinite(e.w) && e.w > 0 && Number.isFinite(e.h) && e.h > 0)) throw new Error('no usable size');
  const uri = typeof e.data === 'string' && /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(e.data);
  if (!uri || uri[2].length % 4 !== 0) throw new Error('not a base64 image data URI');
  const bytes = Buffer.from(uri[2], 'base64');
  // The browser inside Draw.io parses an SVG payload as XML and paints nothing
  // when it is not well-formed: a mismatched or unclosed tag, a raw "&", an
  // undefined entity, a namespace prefix used out of scope (#29, #33).
  if (uri[1] === 'image/svg+xml') {
    const problem = xmlCheck.svgBytesProblem(bytes);
    if (problem) throw new Error(`SVG payload is not well-formed: ${problem}`);
  }
  if (uri[1] === 'image/png' && bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('payload is not a PNG');
  }
  return { title: e.title, mime: uri[1], sha256: createHash('sha256').update(bytes).digest('hex') };
}

test('every committed library loads the way Draw.io reads one, every broken entry named (#12, #33)', () => {
  const cat = finder.loadCatalog();
  const problems = [];
  for (const p of cat.packs) {
    const file = join(LIB_DIR, p.file);
    let loaded;
    try { loaded = loadLikeDrawio(readFileSync(file, 'utf8')); } catch (e) { problems.push(`${p.id}: Draw.io would not open the library: ${e.message}`); continue; }
    const committed = new Map(cat.icons.filter((i) => i.pack === p.id && i.bytes === 'committed').map((i) => [i.libraryIndex, i]));
    for (const bad of loaded.problems) problems.push(`${p.id} / ${bad.index} / ${committed.get(bad.index)?.id ?? 'no catalog entry'} / ${bad.reason}`);
    if (loaded.entries.length !== p.count) problems.push(`${p.id}: Draw.io would list ${loaded.entries.length} entries, the catalog says ${p.count}`);
    const lenient = core.readLibrary(file);
    loaded.entries.forEach((entry, i) => {
      if (entry && entry.title !== lenient[i]?.title) problems.push(`${p.id} / ${i}: title ${JSON.stringify(entry.title)} disagrees with readLibrary`);
    });
    for (const icon of committed.values()) {
      const entry = loaded.entries[icon.libraryIndex];
      if (entry && entry.sha256 !== icon.sha256) problems.push(`${p.id} / ${icon.libraryIndex} / ${icon.id} / the payload Draw.io would show does not match the catalog`);
    }
  }
  assert(problems.length === 0, reportProblems(problems));
});

test('the Draw.io-strict loader round-trips awkward titles and rejects a mis-escaped library', () => {
  const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`;
  const titles = ['Weights & Biases', '<script>alert(1)</script>', 'a "quoted" ]]> title', "it's",
    'rocket \u{1F680}', 'line separator', 'tab\tand\\backslash'];
  const file = join(TMP, 'awkward.drawio');
  iconBuild.writeLibrary(file, titles.map((title) => ({ data: svg, title })));
  eq(loadLikeDrawio(readFileSync(file, 'utf8')).entries.map((e) => e.title).join('|'), titles.join('|'), 'titles survive writeLibrary exactly');

  const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const good = `<mxlibrary>${escapeText(JSON.stringify([{ data: svg, w: 78, h: 78, title: 'ok' }]))}</mxlibrary>`;
  const loaded = loadLikeDrawio(good);
  eq(loaded.entries.length, 1, 'a well-formed library loads');
  eq(loaded.problems.length, 0, 'a well-formed library has no broken entry');
  const broken = {
    'a raw ampersand': good.replace('"ok"', '"A & B"'),
    'a raw angle bracket': good.replace('"ok"', '"<b>"'),
    'an entity only HTML defines': good.replace('"ok"', '"A&nbsp;B"'),
    'a control character': good.replace('"ok"', '"AB"'),
    'the wrong root': good.replace(/mxlibrary/g, 'mxfile'),
    'a second element': `${good}<extra/>`,
    'a truncated payload': good.replace(/base64,[^"]+/, (s) => s.slice(0, -3)),
    'an entry with no title': good.replace(',"title":"ok"', ''),
    'JSON that is not an array': '<mxlibrary>{}</mxlibrary>',
    'an SVG using a namespace prefix it never declares': good.replace(svg, `data:image/svg+xml;base64,${Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="#a"/></svg>').toString('base64')}`),
    'an SVG with an unclosed element': good.replace(svg, `data:image/svg+xml;base64,${Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>').toString('base64')}`),
  };
  for (const [what, text] of Object.entries(broken)) {
    let rejected = false;
    try { rejected = loadLikeDrawio(text).problems.length > 0; } catch { rejected = true; }
    assert(rejected, `a library with ${what} loaded`);
  }
});

// The shared strict check (#33). Its negative inputs are the four the Excalidraw
// tracer accepts without complaint, plus the faults a browser also refuses; its
// positive ones are XML the packs never use but a browser draws.
test('an SVG payload must be well-formed XML with an <svg> root in the SVG namespace (#33)', () => {
  const NS = 'xmlns="http://www.w3.org/2000/svg"';
  const path = '<path d="M0 0 L10 0 L10 10Z"/>';
  const refused = {
    'an unclosed group': `<svg ${NS}><g>${path}</svg>`,
    'a raw ampersand': `<svg ${NS}><path id="A&B" d="M0 0 L10 0 L10 10Z"/></svg>`,
    'an undefined entity': `<svg ${NS}><path id="&nbsp;" d="M0 0 L10 0 L10 10Z"/></svg>`,
    'an unclosed root': `<svg ${NS}>${path}`,
    'a prefix declared only on a sibling': `<svg ${NS}><g xmlns:xlink="http://www.w3.org/1999/xlink"/><use xlink:href="#a"/></svg>`,
    'a repeated attribute': `<svg ${NS} width="1" width="2"/>`,
    'an unquoted attribute': `<svg ${NS} width=1/>`,
    'a "<" in an attribute': `<svg ${NS} id="a<b"/>`,
    '"--" inside a comment': `<svg ${NS}><!-- a -- b --></svg>`,
    'a second root': `<svg ${NS}/><svg ${NS}/>`,
    'an XML declaration after a comment': `<!-- c --><?xml version="1.0"?><svg ${NS}/>`,
    'a reference to a character XML forbids': `<svg ${NS}><text>&#0;</text></svg>`,
    'a control character': `<svg ${NS}></svg>`,
    'no SVG namespace': '<svg/>',
    'a root that is not <svg>': '<html xmlns="http://www.w3.org/1999/xhtml"/>',
    'a parameter entity': `<!DOCTYPE svg [<!ENTITY % p "x">]><svg ${NS}/>`,
    'nothing at all': '',
  };
  for (const [what, svg] of Object.entries(refused)) assert(xmlCheck.svgProblem(svg), `accepted ${what}`);
  const notUtf8 = Buffer.concat([Buffer.from(`<svg ${NS}><title>`), Buffer.from([0xC3, 0x28]), Buffer.from('</title></svg>')]);
  assert(xmlCheck.svgBytesProblem(notUtf8), 'accepted bytes that are not UTF-8');

  const accepted = {
    'a declaration, comments, CDATA and every reference form': `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!-- lead --><svg ${NS}><!----><style><![CDATA[ a > b && c ]]></style><text>&lt;&amp;&#x41;&#66;&quot;&apos;&gt;</text></svg>\n<!-- trail -->`,
    'a prefix declared on an ancestor': `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink"><g><use xlink:href="#a"/></g></svg>`,
    'a prefix declared on the element using it': `<svg ${NS}><use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#a"/></svg>`,
    'a prefixed SVG root': '<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:g/></s:svg>',
    'the implicit xml prefix': `<svg ${NS} xml:space="preserve"/>`,
    'a DOCTYPE declaring an entity': `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n<!ENTITY ns_flows "http://ns.adobe.com/Flows/1.0/">\n]><svg ${NS} xmlns:x="&ns_flows;"/>`,
    'a processing instruction': `<svg ${NS}><?foo bar?></svg>`,
    'a byte-order mark and CRLF': `﻿<svg ${NS}>\r\n</svg>`,
  };
  for (const [what, svg] of Object.entries(accepted)) {
    const problem = xmlCheck.svgProblem(svg);
    assert(!problem, `refused ${what}: ${problem}`);
  }
  eq(xmlCheck.svgProblem(`<svg ${NS}><g>${path}</svg>`), 'line 1, column 74: </svg> closes <g>', 'a problem says where and why');
});

test('one load names every broken entry in a library, not only the first (#33)', () => {
  const NS = 'xmlns="http://www.w3.org/2000/svg"';
  const uri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const file = join(TMP, 'two-broken.drawio');
  iconBuild.writeLibrary(file, [
    { data: uri(`<svg ${NS}/>`), title: 'fine' },
    { data: uri(`<svg ${NS}><g></svg>`), title: 'unclosed' },
    { data: uri(`<svg ${NS}><path id="A&B"/></svg>`), title: 'ampersand' },
  ]);
  const { entries, problems } = loadLikeDrawio(readFileSync(file, 'utf8'));
  eq(entries.length, 3, 'every entry is still listed');
  eq(problems.map((p) => `${p.index}:${p.title}`).join(' '), '1:unclosed 2:ampersand', 'both broken entries are reported');
  assert(/closes <g>/.test(problems[0].reason) && /raw "&"/.test(problems[1].reason), `reasons: ${problems.map((p) => p.reason).join('; ')}`);
  const report = reportProblems(Array.from({ length: 25 }, (_, i) => `p${i}`));
  assert(report.startsWith('25 problems:') && report.includes('p19') && !report.includes('p20') && report.endsWith('... and 5 more'),
    `the report caps what it shows, not what it counts: ${report}`);
});

test('build-packs refuses to write a pack holding a malformed SVG, naming every bad entry (#33)', () => {
  const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  packs.refuseMalformedSvg('test-pack', [
    { slug: 'fine', title: 'Fine', svg: svg('<g/>') },
    { slug: 'raster', title: 'Raster', data: 'data:image/png;base64,iVBORw0KGgo=' },
  ]);
  let error;
  try {
    packs.refuseMalformedSvg('test-pack', [
      { slug: 'fine', title: 'Fine', svg: svg('<g/>') },
      { slug: 'unclosed', title: 'Unclosed', svg: svg('<g>') },
      { slug: 'entity', title: 'Entity', data: `data:image/svg+xml;base64,${Buffer.from(svg('<path id="&nbsp;"/>')).toString('base64')}` },
      { slug: 'plain-uri', title: 'Plain URI', data: `data:image/svg+xml,${svg('')}` },
    ]);
  } catch (e) { error = e; }
  assert(error, 'a pack with malformed payloads was accepted');
  assert(/3 malformed SVG payloads/.test(error.message) && ['unclosed', 'entity', 'plain-uri'].every((s) => error.message.includes(`test-pack/${s}:`))
    && !error.message.includes('test-pack/fine'), error.message);
});

test('build-packs refuses a mark whose every paint is white, and nothing that also draws in a colour (#85)', () => {
  const svg = (inner, root = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"${root}>${inner}</svg>`;
  const shape = (attrs = '') => `<path d="M0 0h24v24z"${attrs}/>`;
  const refused = {
    'white fills': svg(shape(' fill="white"') + shape(' fill="#FFF"')),
    'a white root fill': svg(shape(), ' fill="#ffffff"'),
    'a near-white style fill and a white stroke': svg(shape(' style="fill: rgb(250, 250, 250)" stroke="#fefefe"')),
    'a gradient with only white stops': svg('<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1" style="stop-color:white"/></linearGradient></defs>'
      + shape(' fill="url(#g)"')),
    'a white class in a style sheet': svg(`<style>.a{fill:#fff}</style>${shape(' class="a" fill="#fff"')}`),
    'a white shape under a clip path drawn with the default black': svg(`<clipPath id="c">${shape()}</clipPath>${shape(' fill="#fff" clip-path="url(#c)"')}`),
  };
  for (const [what, text] of Object.entries(refused)) assert(iconBuild.paintsOnlyWhite(text), `accepted ${what}`);

  const accepted = {
    'an implicit black fill': svg(shape()),
    'an implicit black fill beside a white one': svg(shape() + shape(' fill="white"')),
    'a stroke-only mark': svg(shape(' fill="none" stroke="#1B1F23"')),
    'white ink on a coloured plate': svg(`<rect width="24" height="24" fill="#E11D48"/>${shape(' fill="#fff"')}`),
    'a gradient with one dark stop': svg('<linearGradient id="g"><stop stop-color="#fff"/><stop offset="1" stop-color="#312e81"/></linearGradient>'
      + shape(' fill="url(#g)"')),
    'currentColor': svg(shape(' fill="currentColor"')),
    'an embedded raster': svg(`<image href="data:image/png;base64,iVBORw0KGgo="/>${shape(' fill="#fff"')}`),
    'a group fill overridden by its child': svg(`<g fill="#fff">${shape(' fill="#0f172a"')}</g>`),
    'nothing drawn at all': svg(''),
  };
  for (const [what, text] of Object.entries(accepted)) assert(!iconBuild.paintsOnlyWhite(text), `refused ${what}`);

  packs.refuseWhiteMarks('test-pack', [
    { slug: 'dark', title: 'Dark', svg: accepted['a stroke-only mark'] },
    { slug: 'raster', title: 'Raster', data: 'data:image/png;base64,iVBORw0KGgo=' },
  ]);
  let error;
  try {
    packs.refuseWhiteMarks('test-pack', [
      { slug: 'dark', title: 'Dark', svg: accepted['an implicit black fill'] },
      { slug: 'mem0', title: 'Mem0', svg: refused['white fills'], upstreamId: 'mem0-logo.svg' },
      { slug: 'plate', title: 'Plate', data: iconBuild.dataUri(refused['a white root fill']) },
    ]);
  } catch (e) { error = e; }
  assert(error, 'a pack with white-only marks was accepted');
  assert(/every paint is white in 2 marks/.test(error.message) && error.message.includes('test-pack/mem0 (mem0-logo.svg)')
    && error.message.includes('test-pack/plate') && !error.message.includes('test-pack/dark'), error.message);

  const shipped = JSON.parse(readFileSync(join(SKILL, 'references', 'icon-catalog.json'), 'utf8')).packs
    .flatMap((p) => core.readLibrary(join(SKILL, 'assets', 'libraries', p.file)).map((e) => ({ ...e, pack: p.id })))
    .filter((e) => /^data:image\/svg\+xml;base64,/.test(e.dataUri ?? ''))
    .filter((e) => iconBuild.paintsOnlyWhite(Buffer.from(e.dataUri.slice(e.dataUri.indexOf(',') + 1), 'base64').toString('utf8')));
  eq(shipped.map((e) => `${e.pack}[${e.index}] ${e.title}`).join(', '), '', 'shipped marks that paint only white');
});

// #31: a devicon mark with no paint of its own draws black. One flagged
// "paint": "tint" is filled with its brand colour through the root, keeping
// every namespace and its viewBox; artwork that already carries paint is
// refused, never guessed at.
test('a devicon mark flagged for tint is filled through its root, and paint it cannot override is refused (#31)', () => {
  const NS = 'xmlns="http://www.w3.org/2000/svg"';
  const plain = `<svg ${NS} viewBox="0 0 128 128"><path d="M0 0h10v10z"/></svg>`;
  const { svg, render } = iconBuild.tintUnpaintedMark(plain, '00b0ad');
  eq(render, 'tinted', 'render');
  eq(svg, `<svg ${NS} width="64" height="64" viewBox="0 0 128 128" fill="#00b0ad"><path d="M0 0h10v10z"/></svg>`, 'filled through the root, viewBox kept');
  const linked = iconBuild.tintUnpaintedMark(`<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24">`
    + '<defs><path id="a" d="M0 0h1v1z"/></defs><use xlink:href="#a"/></svg>', '00b0ad');
  assert(linked.svg.includes(' xmlns:xlink="http://www.w3.org/1999/xlink"') && linked.svg.includes('xlink:href="#a"'),
    `the xlink declaration survives the tint: ${linked.svg}`);
  const refused = {
    'an explicit black fill': `<svg ${NS} viewBox="0 0 24 24"><path fill="#000000" d="M0 0h1v1z"/></svg>`,
    currentColor: `<svg ${NS} viewBox="0 0 24 24"><path fill="currentColor" d="M0 0h1v1z"/></svg>`,
    'a stroke': `<svg ${NS} viewBox="0 0 24 24"><path stroke="#000" d="M0 0h1v1z"/></svg>`,
    'a style attribute': `<svg ${NS} viewBox="0 0 24 24"><path style="fill:#000" d="M0 0h1v1z"/></svg>`,
    'a gradient': `<svg ${NS} viewBox="0 0 24 24"><linearGradient id="g"/><path d="M0 0h1v1z"/></svg>`,
    'fill="none" on the root': `<svg ${NS} viewBox="0 0 24 24" fill="none"><path d="M0 0h1v1z"/></svg>`,
  };
  for (const [what, text] of Object.entries(refused)) {
    let error;
    try { iconBuild.tintUnpaintedMark(text, '00b0ad'); } catch (e) { error = e; }
    assert(error && /already carries paint/.test(error.message), `tinted artwork with ${what}: ${error?.message ?? 'no error'}`);
  }
  rejects(() => iconBuild.tintUnpaintedMark(plain, '#00b0ad'), /six-digit hex/);
  rejects(() => iconBuild.tintUnpaintedMark(plain, undefined), /six-digit hex/);
  eq(iconBuild.sizedSvg(`<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" width="128" height="128"><path/></svg>`),
    `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" width="64" height="64" viewBox="0 0 128 128"><path/></svg>`,
    'a verbatim mark is only resized');
});

// The seven full-colour devicon marks as built before #31. The tint must not
// touch a byte of them.
const DEVICON_VERBATIM = {
  'databases/oracle': '7643635b2306795d283976c2ac3bcbe36a321e5567c144042eccf8ec1cf3333e',
  'databases/microsoftsqlserver': 'fbdd4a5cbd969f9d97b210d162d23a393776780f7ce3979c821d3a81bccede9c',
  'databases/memcached': '83073fc28501ea75994af428cc1faedfd359ce98321ccfaaa60bc88b0c88d2d8',
  'databases/yugabytedb': '0273097482e119d86fb981f0dbeae1f5f85b5404e019fef3c6b81b21ea496123',
  'ml-training/kubeflow': 'f5873bb2d4133f4f5157e13992eb7eac0f1d0be8a37a5cf0c2a9f97bdaef3471',
  'devops/sonarqube': '44ab2530f7a929e37be661b5ce074de01a9192383d54c0705dd7e1516cf3e641',
  'languages-runtimes/csharp': 'd73d492a523c1102b8e59660de27da613f65e5dc47652971fb376c2b09aaaaa4',
  'security-identity/teleport': 'a45e6ae1cfcaa8f7f065c6e4418d06b540c1cdfc7cf312c05c1f52c711d3bda2',
  'devops/argocd': '2e3b6661a6a1e94342f63414527f1d1e5be02081aee2369cc7c72b7a0d52c79e',
  'languages-runtimes/playwright': '1bc125e2248458631f7cc63da68ff708b3197d12e5d5f753d57f0ce205cecf15',
};

test('gRPC ships tinted in its manifest colour, the other devicon marks stay verbatim, and painted rows record their hex (#31)', () => {
  const cat = finder.loadCatalog();
  const grpc = cat.icons.find((i) => i.id === 'languages-runtimes/grpc');
  eq(`${grpc.render} ${grpc.hex}`, 'tinted 00b0ad', 'the gRPC catalog row');
  const entry = core.readLibrary(join(LIB_DIR, 'languages-runtimes.drawio'))[grpc.libraryIndex];
  const svg = Buffer.from(entry.dataUri.split(',')[1], 'base64').toString('utf8');
  assert(/^<svg [^>]*\sfill="#00b0ad"[^>]*>/.test(svg) && svg.includes('viewBox="0 0 128 128"'), `gRPC's payload root: ${svg.slice(0, 160)}`);
  const devicon = cat.icons.filter((i) => i.source.startsWith('devicon@') && i.id !== grpc.id);
  eq(devicon.map((i) => i.id).sort().join(' '), Object.keys(DEVICON_VERBATIM).sort().join(' '), 'the other devicon marks');
  for (const icon of devicon) {
    eq(`${icon.render} ${icon.hex ?? '-'}`, 'verbatim-colour -', `${icon.id} render`);
    eq(icon.sha256, DEVICON_VERBATIM[icon.id], `${icon.id} payload untouched by the tint`);
  }
  const painted = cat.icons.filter((i) => i.render === 'tinted' || i.render === 'tile-bright');
  const unrecorded = painted.filter((i) => !/^[0-9A-Fa-f]{6}$/.test(i.hex ?? ''));
  assert(painted.length > 3000 && unrecorded.length === 0, `painted rows without the colour they were painted: ${unrecorded.slice(0, 3).map((i) => i.id).join(', ')}`);
  const stray = cat.icons.filter((i) => i.hex && i.render !== 'tinted' && i.render !== 'tile-bright');
  eq(stray.length, 0, `rows carrying a hex nothing painted: ${stray.slice(0, 3).map((i) => i.id).join(', ')}`);
});

// #11: the ASF licenses its project graphic logos under the Apache License, so
// the official originals that draw correctly at icon size ship byte-for-byte.
// The Apache and CNCF marks that do not ship say why, and where to fetch them.
const ASF_SHIPPED = {
  'data-platforms/apacheiceberg': 'iceberg.svg',
  'data-platforms/apachepinot': 'pinot.svg',
  'streaming-orchestration/apachebeam': 'beam-2.svg',
  // APISIX joined the same source rather than getting its own: the ASF policy
  // and licence are identical for every project logo in that index (#20).
  'devops/apacheapisix': 'apisix.svg',
};

test('Apache Iceberg, Pinot, Beam and APISIX ship byte-for-byte from the pinned ASF originals, at their own aspect (#11, #20)', () => {
  const src = packs.loadManifest().sources['asf-logos'];
  eq(`${src.type} ${src.terms} ${src.licence}`, 'local-files licence Apache-2.0', 'the asf-logos source');
  assert(src.licenceUrl === 'https://www.apache.org/foundation/marks/' && /licensed to the public under the Apache License/.test(src.note),
    'the source records the ASF policy that licenses its graphic logos');
  const dir = join(LIB_DIR, src.dir);
  const files = new Map(readdirSync(dir).sort().map((name) => [name, readFileSync(join(dir, name))]));
  eq([...files.keys()].join(' '), Object.values(ASF_SHIPPED).sort().join(' '), 'exactly the shipped originals are committed');
  eq(packs.localFilesDigest(files), src.sha256, 'the committed originals match their pin');
  const cat = finder.loadCatalog();
  for (const [id, file] of Object.entries(ASF_SHIPPED)) {
    const icon = cat.icons.find((i) => i.id === id);
    eq(`${icon?.bytes} ${icon?.source} ${icon?.licence} ${icon?.render}`, 'committed asf-logos Apache-2.0 verbatim', `${id} catalog row`);
    eq(icon.sha256, createHash('sha256').update(files.get(file)).digest('hex'), `${id} embeds the original byte-for-byte`);
    eq(icon.upstreamId, `https://www.apache.org/logos/originals/${file}`, `${id} names where its bytes came from`);
    const entry = core.readLibrary(join(LIB_DIR, `${icon.pack}.drawio`))[icon.libraryIndex];
    const fitted = finder.recommendedSize(icon);
    eq(`${entry.w}x${entry.h} ${entry.aspect}`, `${fitted.width}x${fitted.height} fixed`, `${id} library cell keeps the artwork's aspect`);
  }
  const iceberg = finder.recommendedSize(cat.icons.find((i) => i.id === 'data-platforms/apacheiceberg'));
  eq(`${iceberg.width}x${iceberg.height}`, '95x26', 'the Iceberg lockup is drawn wide and legible, not squashed into a square nor left a hairline');
});

// #20: a logo the project itself authored and ships in its own repository,
// under that repository's OSI licence, ships byte-for-byte when no separate
// logo or trademark policy governs it. [source, file, licence, where it came from]
const PROJECT_LOGOS = {
  'ml-training/jax': ['jax-logo', 'jax_logo.svg', 'Apache-2.0',
    'https://raw.githubusercontent.com/jax-ml/jax/adb0562417371429beddf7d575a0753dc957de19/images/jax_logo.svg'],
  'ml-training/flax': ['flax-logo', 'flax_logo.svg', 'Apache-2.0',
    'https://raw.githubusercontent.com/google/flax/01854da11286b4109c59d7fd9205f3822fe807d6/images/flax_logo.svg'],
  'ml-training/lightgbm': ['lightgbm-logo', 'LightGBM_logo_black_text.svg', 'MIT',
    'https://raw.githubusercontent.com/lightgbm-org/LightGBM/6d386edf77a363750669ba622b133ca4e794e353/docs/logo/LightGBM_logo_black_text.svg'],
  'ml-training/catboost': ['catboost-logo', 'catboost.png', 'Apache-2.0',
    'https://raw.githubusercontent.com/catboost/catboost/bc912d111cd9afc7efb89857e119634049b54e76/logo/catboost.png'],
  'ml-training/metaflow': ['metaflow-logo', 'metaflow.svg', 'Apache-2.0',
    'https://raw.githubusercontent.com/Netflix/metaflow/72591a0a9e17e8070523cfcdfbdf38e11ee1dba1/docs/metaflow.svg'],
  'observability/signoz': ['signoz-logo', 'signoz-brand-logo.svg', 'MIT',
    'https://raw.githubusercontent.com/SigNoz/signoz/c8e9e362f7ec90578a828d0c39c8db6408abc035/frontend/src/assets/Logos/signoz-brand-logo.svg'],
};

test('JAX, Flax, LightGBM, CatBoost, Metaflow and SigNoz ship their own logos under their own repositories\' licences (#20)', () => {
  const manifest = packs.loadManifest();
  const cat = finder.loadCatalog();
  for (const [id, [key, file, licence, upstream]] of Object.entries(PROJECT_LOGOS)) {
    const src = manifest.sources[key];
    eq(`${src?.type} ${src?.terms} ${src?.licence}`, `local-files licence ${licence}`, `${key} source`);
    const commit = upstream.split('/')[5];
    assert(/^[0-9a-f]{40}$/.test(commit) && src.licenceUrl.endsWith(`/blob/${commit}/LICENSE`),
      `${key} links the LICENSE at the commit its file came from: ${src.licenceUrl}`);
    assert(/no separate logo or trademark policy governs it \(#20\)/.test(src.note) && src.note.includes(upstream.split(`${commit}/`)[1]),
      `${key} records the file it took and the finding`);
    const dir = join(LIB_DIR, src.dir);
    const files = new Map(readdirSync(dir).sort().map((name) => [name, readFileSync(join(dir, name))]));
    eq([...files.keys()].join(' '), file, `${key} commits exactly its original`);
    eq(packs.localFilesDigest(files), src.sha256, `${key} matches its pin`);
    const icon = cat.icons.find((i) => i.id === id);
    eq(`${icon?.bytes} ${icon?.source} ${icon?.licence} ${icon?.render}`, `committed ${key} ${licence} verbatim`, `${id} catalog row`);
    eq(icon.sha256, createHash('sha256').update(files.get(file)).digest('hex'), `${id} embeds the original byte-for-byte`);
    eq(icon.upstreamId, upstream, `${id} names where its bytes came from`);
    const entry = core.readLibrary(join(LIB_DIR, `${icon.pack}.drawio`))[icon.libraryIndex];
    const fitted = finder.recommendedSize(icon);
    eq(`${entry.w}x${entry.h} ${entry.aspect} ${entry.mime}`, `${fitted.width}x${fitted.height} fixed ${file.endsWith('.png') ? 'image/png' : 'image/svg+xml'}`,
      `${id} library cell keeps the artwork's aspect and format`);
  }
});

test('the #20 projects whose artwork no licence covers stay on-demand, each with its finding and a fetch source (#20)', () => {
  const cat = finder.loadCatalog();
  const pinned = /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\//;
  for (const [id, licence, why] of [
    ['ml-training/flyte', /Linux Foundation/, /link to its project/],
    ['ml-training/feast', /Linux Foundation/, /link to its project/],
    ['ml-training/kserve', /Linux Foundation/, /link to its project/],
    ['security-identity/spiffe', /Linux Foundation/, /link to its project/],
    ['security-identity/sigstore', /Linux Foundation/, /all rights reserved/],
    ['security-identity/cosign', /Linux Foundation/, /all rights reserved/],
    ['devops/kustomize', /no published logo/, /favicon/],
    ['ml-training/seldon', /Business Source License/, /not an open-source licence/],
    ['devops/dagger', /Dagger trademark guidelines/, /written permission/],
  ]) {
    const icon = cat.icons.find((i) => i.id === id);
    eq(icon?.bytes, 'on-demand', id);
    assert(licence.test(icon.licence) && why.test(icon.reason) && /^https:\/\//.test(icon.licenceUrl ?? ''),
      `${id} records its finding: ${icon.licence} / ${icon.reason}`);
    // Dagger publishes no artwork file to point at, only a brand page.
    if (id === 'devops/dagger') {
      assert(icon.brandUrl === 'https://dagger.io/brand/' && icon.artwork === 'none pinned' && !icon.fetch,
        `${id} points at the brand page and offers nothing to fetch`);
    } else assert(pinned.test(icon.upstreamUrl ?? '') && icon.fetch.includes(icon.upstreamUrl), `${id} fetches pinned artwork: ${icon.upstreamUrl}`);
  }
  for (const [q, id] of [['jax', 'ml-training/jax'], ['flax', 'ml-training/flax'], ['lightgbm', 'ml-training/lightgbm'],
    ['catboost', 'ml-training/catboost'], ['metaflow', 'ml-training/metaflow'], ['signoz', 'observability/signoz']]) {
    const r = finder.resolve(q);
    assert(r.confident, `"${q}" is not confident: ${r.reason}`);
    eq(r.icon.id, id, `"${q}"`);
  }
});

// #20, third batch: the remaining 123 products a modern data, ML and platform
// stack uses. [source, file, licence] for each mark whose licence let it ship.
const STACK_LOGOS = {
  'ai-frameworks/dspy': ['dspy-logo', 'dspy-logo.svg', 'MIT'],
  'ai-frameworks/guardrails': ['guardrails-logo', 'guardrails-logo.svg', 'Apache-2.0'],
  'ai-frameworks/llamacpp': ['llamacpp-logo', 'icon-light.svg', 'CC-BY-NC-4.0 with ggml-org brand-usage grant'],
  'ai-frameworks/localai': ['localai-logo', 'logo-mark.png', 'MIT'],
  'ai-frameworks/mem0': ['mem0-logo', 'mem0-logo.svg', 'Apache-2.0'],
  'ai-frameworks/pydanticai': ['pydanticai-logo', 'pydantic-ai-light.svg', 'MIT'],
  'ai-frameworks/trl': ['trl-logo', 'trl-logo.png', 'Apache-2.0'],
  'ai-frameworks/axolotl': ['axolotl-logo', 'axolotl-symbol.svg', 'Apache-2.0'],
  'ai-frameworks/whylogs': ['whylogs-logo', 'whylogs-logo.png', 'Apache-2.0'],
  'data-platforms/lightdash': ['lightdash-logo', 'lightdash-logo-icon.svg', 'MIT'],
  'data-platforms/evidence': ['evidence-logo', 'evidence-logo.svg', 'MIT'],
  'data-platforms/datahub': ['datahub-logo', 'datahub-logo.svg', 'Apache-2.0'],
  'data-platforms/openmetadata': ['openmetadata-logo', 'openmetadata-monogram.svg', 'Apache-2.0'],
  'saas-collab/flagsmith': ['flagsmith-logo', 'flagsmith-logo.svg', 'BSD-3-Clause'],
  'ml-training/apachehamilton': ['hamilton-logo', 'hamilton-logo.png', 'Apache-2.0'],
  'ml-training/marimo': ['marimo-logo', 'marimo-logotype.svg', 'Apache-2.0'],
  'ml-training/statsmodels': ['statsmodels-logo', 'statsmodels-logo.svg', 'BSD-3-Clause'],
  'languages-runtimes/move': ['move-logo', 'move-logo.svg', 'Apache-2.0'],
  'languages-runtimes/hatch': ['hatch-logo', 'hatch-logo.svg', 'MIT'],
  'languages-runtimes/tox': ['tox-logo', 'tox-logo.svg', 'MIT'],
  'streaming-orchestration/hatchet': ['hatchet-logo', 'hatchet-logo.svg', 'MIT'],
  'streaming-orchestration/trigger': ['trigger-logo', 'trigger-logo.svg', 'Apache-2.0'],
  'streaming-orchestration/restate': ['restate-logo', 'restate-logo.svg', 'MIT'],
  'streaming-orchestration/meltano': ['meltano-logo', 'meltano-logo.svg', 'MIT'],
  'streaming-orchestration/sqlmesh': ['sqlmesh-logo', 'sqlmesh-logo.svg', 'Apache-2.0'],
  'security-identity/sysdig': ['sysdig-logo', 'sysdig-logo.png', 'Apache-2.0'],
  'security-identity/checkov': ['checkov-logo', 'checkov-logo.svg', 'Apache-2.0'],
  'security-identity/tfsec': ['tfsec-logo', 'tfsec.png', 'MIT'],
  'security-identity/infisical': ['infisical-logo', 'infisical-logo.svg', 'MIT'],
  'security-identity/zitadel': ['zitadel-logo', 'zitadel-logo-solo.svg', 'MIT'],
  'databases/lancedb': ['lancedb-logo', 'lancedb-logo.png', 'Apache-2.0'],
  'databases/marqo': ['marqo-logo', 'marqo-logo.svg', 'Apache-2.0'],
  'databases/orientdb': ['orientdb-logo', 'orientdb-logo.svg', 'Apache-2.0'],
  'devops/okteto': ['okteto-logo', 'okteto.svg', 'Apache-2.0'],
  'devops/tilt': ['tilt-logo', 'tilt-logo.svg', 'Apache-2.0'],
  'devops/colima': ['colima-logo', 'colima.png', 'MIT'],
  'devops/dokku': ['dokku-logo', 'dokku-logo.svg', 'MIT'],
};

test('the modern-stack marks that ship are pinned to a commit and committed byte-for-byte (#20)', () => {
  const manifest = packs.loadManifest();
  const cat = finder.loadCatalog();
  for (const [id, [key, file, licence]] of Object.entries(STACK_LOGOS)) {
    const src = manifest.sources[key];
    eq(`${src?.type} ${src?.terms} ${src?.licence}`, `local-files licence ${licence}`, `${key} source`);
    assert(/^https:\/\//.test(src.licenceUrl ?? ''), `${key} links its licence`);
    assert(/\(#20\)/.test(src.note) && src.note.includes('committed'), `${key} records its finding`);
    const dir = join(LIB_DIR, src.dir);
    const files = new Map(readdirSync(dir).sort().map((name) => [name, readFileSync(join(dir, name))]));
    eq([...files.keys()].join(' '), file, `${key} commits exactly its original`);
    eq(packs.localFilesDigest(files), src.sha256, `${key} matches its pin`);
    const icon = cat.icons.find((i) => i.id === id);
    eq(`${icon?.bytes} ${icon?.source} ${icon?.render}`, `committed ${key} verbatim`, `${id} catalog row`);
    eq(icon.sha256, createHash('sha256').update(files.get(file)).digest('hex'), `${id} embeds the original byte-for-byte`);
    // Every mark names a pinned upstream: a 40-char commit, or the ASF's own index.
    assert(/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\//.test(icon.upstreamId)
      || icon.upstreamId.startsWith('https://www.apache.org/logos/originals/'), `${id} pins its upstream: ${icon.upstreamId}`);
    const entry = core.readLibrary(join(LIB_DIR, `${icon.pack}.drawio`))[icon.libraryIndex];
    // The cell is the footprint fit, floored so a wide lockup stays legible
    // (#76), and keeps the artwork's own aspect - both sides checked against the
    // committed original's own size, the one build-packs fits: Restate's 34.46
    // by 30.52, not the 34 by 31 the catalog rounds it to. recommendedSize hands
    // back that same cell (#80). The rule itself is tested on its own; here it
    // is the builder having applied it that is under test.
    const original = files.get(file);
    const png = file.endsWith('.png') ? iconBuild.pngSize(original) : null;
    const [width, height] = png ? [png.width, png.height] : iconBuild.viewBoxOf(original.toString('utf8')).slice(2);
    const fit = core.fitCell(width, height);
    eq(`${entry.w}x${entry.h} ${entry.aspect} ${entry.mime}`,
      `${fit.width}x${fit.height} fixed ${file.endsWith('.png') ? 'image/png' : 'image/svg+xml'}`,
      `${id} library cell is its artwork fitted to the footprint, in its own format`);
    const fitted = finder.recommendedSize(icon);
    eq(`${fitted.width}x${fitted.height}`, `${entry.w}x${entry.h}`, `${id} recommendedSize is its library cell`);
  }
  // llama.cpp is the one mark a policy rather than a bare licence lets in: the
  // brand repository grants redistribution notwithstanding CC BY-NC's terms.
  const brand = manifest.sources['llamacpp-logo'];
  assert(brand.licenceUrl.endsWith('/BRAND-USAGE.md') && /notwithstanding the NonCommercial term/.test(brand.note),
    'llama.cpp records the grant that permits it, not just the licence');
});

test('the modern-stack findings each name what blocked the mark (#20)', () => {
  const cat = finder.loadCatalog();
  for (const [id, licence, why] of [
    ['streaming-orchestration/vector', /MPL-2\.0/, /copyleft/],
    ['streaming-orchestration/windmill', /AGPL-3\.0/, /AGPLv3/],
    ['streaming-orchestration/inngest', /SSPL-1\.0/, /non-OSI/],
    ['saas-collab/unleash', /AGPL-3\.0/, /copyleft/],
    ['data-platforms/rudderstack', /Elastic License 2\.0/, /non-OSI/],
    ['security-identity/boundary', /HashiCorp trademark policy/, /hyperlink/],
    ['observability/cortex', /Linux Foundation/, /LICENSE\.md/],
    ['observability/telegraf', /InfluxData trademark guidelines/, /written logo licence/],
    ['observability/logzio', /express written consent/, /a published policy decides before a repository licence/],
    ['ml-training/triton', /NVIDIA/, /expressly authorized in writing/],
    ['ai-frameworks/unsloth', /does not cover the artwork directory/, /appears in neither list/],
    ['ai-frameworks/instructor', /no published logo/, /no logo image of any kind/],
    // The trap the render pass caught: the permissively licensed file that
    // looked like OpenObserve's mark is still the ZincSearch logo.
    ['streaming-orchestration/openobserve', /AGPL-3\.0/, /ZincSearch/],
  ]) {
    const icon = cat.icons.find((i) => i.id === id);
    eq(icon?.bytes, 'on-demand', id);
    assert(licence.test(icon.licence) && why.test(icon.reason) && /^https:\/\//.test(icon.licenceUrl ?? ''),
      `${id} records its finding: ${icon.licence} / ${icon.reason}`);
    assert(icon.brandUrl || icon.upstreamUrl, `${id} says where to get the artwork`);
  }
});

test('two of the #20 products needed no new source at all (#20)', () => {
  const cat = finder.loadCatalog();
  // AWS renamed QuickSight: the architecture package already shipped the mark
  // under a name nobody searches for.
  for (const q of ['quicksight', 'amazon quicksight', 'quick suite']) {
    const r = finder.resolve(q);
    assert(r.confident && r.icon.id === 'aws/amazon-quick', `"${q}" -> ${r.confident ? r.icon.id : r.reason}`);
  }
  // Aqua Security shipped all along, stranded in the rank-90 catch-all.
  const aqua = cat.icons.find((i) => i.id === 'security-identity/aqua');
  eq(`${aqua?.title} ${aqua?.bytes}`, 'Aqua Security committed', 'Aqua Security is promoted out of the catch-all');
  assert(!cat.icons.some((i) => i.id === 'brands/aqua'), 'the catch-all copy is gone, so the title cannot tie with itself');
  for (const q of ['aqua', 'aqua security', 'aquasec']) {
    const r = finder.resolve(q);
    assert(r.confident && r.icon.id === 'security-identity/aqua', `"${q}" -> ${r.confident ? r.icon.id : r.reason}`);
  }
});

test('every product #20 lists has a recorded outcome, and none resolves to nothing (#20)', () => {
  const cat = finder.loadCatalog();
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const known = new Map();
  for (const i of cat.icons) {
    for (const k of [i.id.split('/').pop(), i.title, ...(i.aliases ?? [])]) {
      if (k && !known.has(norm(k))) known.set(norm(k), i);
    }
  }
  // The issue's ten clusters, verbatim. "bun tooling" is the one phrase that
  // names no product of its own: bun itself already shipped.
  const LISTED = `together fireworks baseten runpod lambdalabs litellm dspy arize whylabs galileo instructor
    guardrails llamacpp localai openwebui agno phidata letta mem0 smolagents pydanticai trl unsloth axolotl
    hex sigma preset lightdash evidence hightouch census rudderstack segment amplitude datahub openmetadata
    amundsen atlan collibra alation greatexpectations soda montecarlo datafold dune quicksight mode thoughtspot
    wiz orca aquasecurity sysdig semgrep checkov tfsec gitleaks vanta drata stepsecurity sigstore cosign spiffe
    teleport boundary infisical doppler zitadel supertokens stytch flyte metaflow hamilton triton torchserve
    kserve seldon feast tecton marimo fastai jax flax catboost lightgbm statsmodels dagger earthly garden okteto
    tilt kustomize argocd werf colima orbstack lima flatcar dokku tyk apisix krakend hatchet inngest trigger
    restate windmill benthos vector cribl openobserve meltano singer sqlmesh dlt slab craft height productboard
    aha launchdarkly statsig unleash flagsmith chronosphere lightstep coralogix logzio signoz telegraf cortex
    mimir lancedb marqo libsql rethinkdb ravendb orientdb janusgraph move hatch tox bun`.split(/\s+/);
  const missing = LISTED.filter((n) => !known.has(norm(n)));
  eq(missing.join(' '), '', 'every product the issue names is answered');
  // Of the products the issue names, these ship their artwork and the rest are
  // catalogued with the licence or policy that blocked it. Change the numbers
  // deliberately, when a finding changes — never to make a build pass.
  const shipped = LISTED.filter((n) => known.get(norm(n)).bytes === 'committed');
  // 142 products: the issue lists 143 distinct names, but "bun tooling" is a
  // phrase rather than a product and bun itself already shipped.
  eq(`${shipped.length} of ${LISTED.length}`, '49 of 142', 'the split between shipped and catalogued');
});

test('the Apache and CNCF marks that stay on-demand record the licence finding, the reason and a fetch source (#11)', () => {
  const cat = finder.loadCatalog();
  const row = (id) => cat.icons.find((i) => i.id === id);
  for (const id of ['data-platforms/apachehudi', 'streaming-orchestration/apachesamza',
    'streaming-orchestration/apacheactivemq', 'streaming-orchestration/apachezookeeper']) {
    const icon = row(id);
    eq(`${icon.bytes} ${icon.licence}`, 'on-demand Apache-2.0', id);
    assert(icon.licenceUrl === 'https://www.apache.org/foundation/marks/' && /^the ASF licenses its graphic logos under Apache-2\.0, but /.test(icon.reason),
      `${id} says why its licensed original does not ship: ${icon.reason}`);
    assert(icon.upstreamUrl?.startsWith('https://www.apache.org/logos/res/') && icon.fetch.includes(icon.upstreamUrl),
      `${id} fetches the ASF's own render: ${icon.fetch}`);
  }
  for (const id of ['devops/crossplane', 'devops/fluxcd', 'security-identity/openpolicyagent']) {
    const icon = row(id);
    eq(icon.bytes, 'on-demand', id);
    assert(/Linux Foundation/.test(icon.licence) && /link/.test(icon.reason) && icon.licenceUrl === 'https://github.com/cncf/artwork/blob/main/LICENSE.md',
      `${id} records the Linux Foundation finding: ${icon.licence} / ${icon.reason}`);
    assert(/^https:\/\/raw\.githubusercontent\.com\/cncf\/artwork\/[0-9a-f]{40}\//.test(icon.upstreamUrl ?? ''), `${id} points at pinned CNCF artwork: ${icon.upstreamUrl}`);
  }
});

const verified = await settle(packs.verify());
test('committed libraries still match the manifest they were built from', () => {
  if (verified.error) throw verified.error;
  const checks = verified.value;
  const bad = checks.filter((c) => !c.pass);
  assert(bad.length === 0, `failing checks: ${bad.map((c) => `${c.name} [${c.detail}]`).join(', ')}`);
  assert(checks.length >= 50, `expected at least 50 checks, got ${checks.length}`);
  const wellFormed = checks.filter((c) => c.name.endsWith('every SVG payload is well-formed'));
  eq(wellFormed.length, finder.loadCatalog().packs.length, '--verify parses the payloads of every pack (#33)');
});

// ------------------------------------------------------------- upstream watch

// The checks reach the network, so the suite drives them with fake fetchers.
// test() is synchronous: settle the promises first, assert afterwards.
const upstream = await import(`file://${join(SCRIPTS, 'lib', 'upstream.mjs').replace(/\\/g, '/')}`);

const fakeCatalog = { icons: [
  { id: 'brands/gonebrand', bytes: 'committed', source: 'simple-icons@1.0.0', upstreamId: 'gonebrand' },
  { id: 'brands/oldname', bytes: 'committed', source: 'simple-icons@1.0.0', upstreamId: 'oldname' },
  { id: 'languages-runtimes/rome', bytes: 'committed', source: 'simple-icons@1.0.0', upstreamId: 'rome' },
  { id: 'devops/docker', bytes: 'committed', source: 'simple-icons@1.0.0', upstreamId: 'docker' },
  { id: 'file-types/dockerfile', bytes: 'committed', source: 'simple-icons@1.0.0', upstreamId: 'icons/docker.svg' },
  { id: 'ai-frameworks/openai', bytes: 'on-demand', source: 'simple-icons@0.9.0', upstreamId: 'openai' },
  { id: 'vendor/queue', bytes: 'committed', source: 'vendor-zip', upstreamId: 'queue.svg' },
] };
const fakeManifest = { sources: {
  'simple-icons': { type: 'npm', package: 'simple-icons', version: '1.0.0',
    dataUrl: 'https://cdn.example/npm/simple-icons@1.0.0/data/simple-icons.json' },
  'simple-icons-withdrawn': { type: 'npm', package: 'simple-icons', version: '0.9.0' },
  'vendor-zip': { type: 'zip', url: 'https://vendor.example/icons.zip', sha256: 'a'.repeat(64) },
  'unused-zip': { type: 'zip', url: 'https://vendor.example/other.zip', sha256: 'b'.repeat(64) },
  palette: { type: 'local' },
} };
// 2.0.0 withdraws "gonebrand", moves "Old Name" to a new slug, and renames Rome
// to Biome while keeping the old title under aliases.old.
const pinnedRelease = [{ title: 'Gone Brand', slug: 'gonebrand' }, { title: 'Old Name', slug: 'oldname' },
  { title: 'Rome', slug: 'rome' }, { title: 'Docker', slug: 'docker' }];
const latestRelease = [{ title: 'Old Name', slug: 'newname' },
  { title: 'Biome', slug: 'biome', aliases: { old: ['Rome'] } }, { title: 'Docker', slug: 'docker' }];
const fetched = [];
const hashed = [];
const fakeGet = async (url) => {
  fetched.push(url);
  if (url === `${upstream.REGISTRY}/simple-icons/latest`) return { version: '2.0.0' };
  if (url.includes('@1.0.0/')) return pinnedRelease;
  if (url.includes('@2.0.0/')) return latestRelease;
  throw new Error(`unexpected fetch ${url}`);
};
const fakeHash = async (url) => { hashed.push(url); return 'c'.repeat(64); };

const removals = await settle(upstream.checkSimpleIcons({ catalog: fakeCatalog, manifest: fakeManifest, get: fakeGet }));
const drift = await settle(upstream.checkDrift({ catalog: fakeCatalog, manifest: fakeManifest, get: fakeGet, hash: fakeHash }));
const offline = await settle(upstream.checkSimpleIcons({ catalog: fakeCatalog, manifest: fakeManifest,
  get: async () => { throw new Error('network down'); } }));

test('the upstream check tells a removal from a rename, and ignores marks that ship no bytes (#10)', () => {
  assert(!removals.error, `check threw: ${removals.error?.message}`);
  const r = removals.value;
  eq(`${r.pinned}->${r.latest}`, '1.0.0->2.0.0', 'versions compared');
  eq(r.shipped, 4, 'distinct shipped slugs, the file-type glyph folded into docker');
  eq(r.removed.map((m) => m.slug).join(), 'gonebrand', 'removed');
  eq(r.removed[0].title, 'Gone Brand', 'title taken from the pinned release');
  eq(r.renamed.map((m) => `${m.slug}->${m.to}`).sort().join(), 'oldname->newname,rome->biome', 'renamed');
  assert(fetched.includes('https://cdn.example/npm/simple-icons@2.0.0/data/simple-icons.json'), 'latest data fetched at the new version');
  assert(!r.removed.concat(r.renamed).some((m) => m.slug === 'openai'), 'an on-demand mark is not "shipped"');
});

test('every shipped Simple Icons mark in the real catalog is watched', () => {
  const version = packs.loadManifest().sources['simple-icons'].version;
  const cat = finder.loadCatalog();
  const shipped = upstream.shippedSimpleIcons(cat, version);
  const committed = cat.icons.filter((i) => i.bytes === 'committed' && i.source === `simple-icons@${version}`);
  eq([...shipped.values()].reduce((n, s) => n + s.ids.length, 0), committed.length, 'every committed mark counted once');
  assert(shipped.size > 3000, `only ${shipped.size} slugs watched`);
  assert(shipped.has('markdown') && !shipped.has('icons/markdown.svg'), 'file-type glyph paths fold into their slug');
});

test('a removal report names the mark and the fix, and a failed check is an error, not a finding', () => {
  const report = upstream.removalReport(removals.value);
  for (const needle of ['`gonebrand`', 'Gone Brand', '`brands/gonebrand`', 'onDemand', 'oldname', 'Nothing in the repository was changed']) {
    assert(report.includes(needle), `report is missing ${needle}`);
  }
  assert(offline.error && /network down/.test(offline.error.message), 'a network failure must reject, never report clean');
});

test('the drift check flags moved pins and skips sources nothing ships from (#9)', () => {
  assert(!drift.error, `check threw: ${drift.error?.message}`);
  const row = (key) => drift.value.find((r) => r.key === key);
  assert(row('simple-icons').drifted, 'a newer npm release is drift');
  assert(row('vendor-zip').drifted, 'a changed archive hash is drift');
  assert(!row('simple-icons-withdrawn').drifted && row('simple-icons-withdrawn').note, 'a pin kept for withdrawn marks is skipped');
  assert(!row('unused-zip').drifted && row('unused-zip').note, 'an archive nothing ships from is skipped');
  assert(!row('palette').drifted, 'a local source has no upstream');
  eq(hashed.join(), 'https://vendor.example/icons.zip', 'only the watched archive is downloaded');
  const report = upstream.driftReport(drift.value);
  assert(report.includes('`vendor-zip`') && !report.includes('unused-zip'), 'report lists only what drifted');
});

// Seven committed project logos, each wrong in one way, and one that is fine.
const pinUrl = (repo, sha, path) => `https://raw.githubusercontent.com/${repo}/${sha}/${path}`;
const blobUrl = (repo, sha, path) => `https://github.com/${repo}/blob/${sha}/${path}`;
const SHA = '1'.repeat(40);
const logoSources = {
  fine: ['o/fine', {}], redrawn: ['o/redrawn', {}], vanished: ['o/vanished', {}], relicensed: ['o/relicensed', {}],
  archived: ['o/archived', {}], known: ['o/known', { archived: true, dormant: false, checked: '2026-01-01' }],
  sleepy: ['o/sleepy', {}], renamed: ['o/renamed', {}],
};
const logoManifest = { sources: {
  asf: { type: 'local-files', dir: 'asf', licenceUrl: 'https://foundation.example/marks/' },
  unused: { type: 'local-files', dir: 'unused', licenceUrl: blobUrl('o/unused', SHA, 'LICENSE') },
  ...Object.fromEntries(Object.entries(logoSources).map(([key, [repo, recorded]]) => [key, {
    type: 'local-files', dir: key, licenceUrl: blobUrl(repo, SHA, 'LICENSE'), upstreamRepo: recorded,
  }])),
}, packs: [{ id: 'p', icons: [
  { slug: 'asf', source: 'asf', file: 'asf.svg', upstreamUrl: 'https://foundation.example/logos/asf.svg' },
  ...Object.entries(logoSources).map(([key, [repo]]) => ({ slug: key, source: key, file: `${key}.svg`,
    upstreamUrl: pinUrl(repo, SHA, `img/${key}.svg`) })),
] }] };
const logoCatalog = { icons: Object.keys(logoManifest.sources).filter((k) => k !== 'unused')
  .map((key) => ({ id: `p/${key}`, bytes: 'committed', source: key })) };
const NOW = Date.parse('2026-09-16T00:00:00Z');
const probed = [];
const logoProbe = async (url) => {
  probed.push(url);
  if (url === 'https://foundation.example/marks/') return { status: 200, sha256: 'policy' };
  if (url === 'https://foundation.example/logos/asf.svg') return { status: 200, sha256: 'asf-bytes' };
  if (url.includes('/o/vanished/HEAD/img/')) return { status: 404 };
  if (url.includes('/o/redrawn/HEAD/img/')) return { status: 200, sha256: 'redrawn' };
  if (url.includes('/o/relicensed/HEAD/LICENSE')) return { status: 200, sha256: 'BUSL' };
  return { status: 200, sha256: url.replace(/\/(HEAD|1{40})\//, '/@/') };
};
const logoGet = async (url) => {
  const repo = url.replace(`${upstream.GITHUB_API}/repos/`, '');
  const days = { 'o/sleepy': 400, 'o/archived': 10, 'o/known': 900 }[repo] ?? 1;
  return { full_name: repo === 'o/renamed' ? 'neworg/renamed' : repo, archived: repo === 'o/archived' || repo === 'o/known',
    pushed_at: new Date(NOW - days * 86_400_000).toISOString() };
};
const logoDrift = await settle(upstream.checkDrift({ catalog: logoCatalog, manifest: logoManifest, get: logoGet,
  probe: logoProbe, committed: (src, file) => (file === 'asf.svg' ? 'asf-bytes' : 'unexpected'), now: NOW }));
const logoOffline = await settle(upstream.checkDrift({ catalog: logoCatalog, manifest: logoManifest, get: logoGet,
  probe: async () => { throw new Error('503 Service Unavailable'); }, committed: () => 'x', now: NOW }));

test('the drift check compares each committed project logo, its licence and its repository with the pin (#74, #82)', () => {
  assert(!logoDrift.error, `check threw: ${logoDrift.error?.message}`);
  const row = (key) => logoDrift.value.find((r) => r.key === key);
  const found = (key) => row(key).checks.filter((c) => c.state !== 'ok').map((c) => `${c.what} ${c.state}`).join();
  eq(found('fine'), '', 'unchanged artwork, licence and live repository');
  assert(!row('fine').drifted, 'a clean source is not drift');
  eq(row('fine').checks.map((c) => c.what).join(), 'artwork,licence,repo', 'all three checked');
  eq(found('redrawn'), 'artwork changed', 'a redrawn logo');
  eq(found('vanished'), 'artwork gone', 'a logo no longer at its path');
  eq(found('relicensed'), 'licence changed', 'a relicensed repository');
  eq(found('archived'), 'repo archived', 'a repository archived since it was recorded');
  eq(found('known'), '', 'an archived, long-dormant repository already recorded as archived stays quiet');
  eq(found('sleepy'), 'repo dormant', `no push in ${upstream.DORMANT_DAYS} days`);
  eq(found('renamed'), 'repo moved', 'a repository that answers under another name');
  eq(found('asf'), '', 'an unpinned URL is compared with the committed bytes, a policy page only for existing');
  eq(row('unused').note, 'ships no bytes', 'a source nothing ships from is skipped');
  assert(probed.includes('https://raw.githubusercontent.com/o/redrawn/HEAD/img/redrawn.svg'), 'artwork read at HEAD');
  assert(probed.includes(`https://raw.githubusercontent.com/o/redrawn/${SHA}/img/redrawn.svg`), 'and at the pinned commit, not our own bytes, which may be downscaled');
  assert(!probed.some((u) => u.includes('/o/unused/')), 'nothing fetched for an unshipped source');
  assert(logoOffline.error && /503/.test(logoOffline.error.message), 'an upstream that cannot be read fails the check, never reports clean');

  const report = upstream.driftReport(logoDrift.value);
  for (const needle of ['`redrawn` | artwork changed', '`vanished` | artwork gone', '`relicensed` | licence changed',
    '`archived` | repo archived', '`sleepy` | repo dormant', 'now `neworg/renamed`', 'onDemand', 'upstreamRepo']) {
    assert(report.includes(needle), `report is missing ${needle}`);
  }
  assert(!report.includes('`fine`') && !report.includes('`known`'), 'report lists only what drifted');
  assert(!report.includes('| pinned | upstream now |'), 'no archive table when no archive drifted');
});

test('every committed project logo on GitHub records its repository state, so the drift check can tell news (#82)', () => {
  const manifest = packs.loadManifest();
  const committed = new Set(finder.loadCatalog().icons.filter((i) => i.bytes === 'committed').map((i) => i.source));
  const unrecorded = [];
  let watched = 0;
  for (const [key, src] of Object.entries(manifest.sources)) {
    if (src.type !== 'local-files' || !committed.has(key)) continue;
    const icons = upstream.localFileIcons(manifest, key);
    if (!upstream.sourceRepo(src, icons)) continue;
    watched++;
    const r = src.upstreamRepo;
    if (!r || typeof r.archived !== 'boolean' || typeof r.dormant !== 'boolean' || !/^\d{4}-\d{2}-\d{2}$/.test(r.checked ?? '')) unrecorded.push(key);
    else if ((r.archived || r.dormant) && !r.note) unrecorded.push(`${key} (archived or dormant with no note saying why it still ships)`);
  }
  assert(watched >= 40, `only ${watched} GitHub-backed logo sources found`);
  eq(unrecorded.join(', '), '', 'sources missing upstreamRepo { archived, dormant, checked }');
});

test('the upstream workflow can open issues and nothing else', () => {
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'upstream-watch.yml'), 'utf8');
  assert(/permissions:\s*\n\s*contents: read\s*\n\s*issues: write/.test(yml), 'expected contents: read, issues: write');
  assert(!/contents:\s*write|pull-requests:\s*write|git push/.test(yml), 'the watch must never write to the repository');
  assert(yml.includes("'17 6 * * 1'") && yml.includes("'41 6 1 1,4,7,10 *'"), 'weekly and quarterly schedules');
  assert((yml.match(/"\$code" -ge 2/g) ?? []).length === 2, 'a failed check must not open an issue');
});

test('the AWS pack is built from Amazon\'s pinned icon package and keeps every palette id (#8)', () => {
  const manifest = packs.loadManifest();
  const pack = manifest.packs.find((p) => p.id === 'aws');
  const ids = new Set(finder.loadCatalog().icons.filter((i) => i.pack === 'aws').map((i) => i.id));
  // legacyTitles holds one caption per id the original 243-entry palette shipped;
  // a spec may name any of them.
  const palette = Object.keys(pack.legacyTitles);
  eq(palette.length, 243, 'palette ids recorded');
  const missing = palette.filter((slug) => !ids.has(`aws/${slug}`));
  assert(!missing.length, `ids a spec may name are gone: ${missing.join(', ')}`);
  assert(ids.size >= 300, `only ${ids.size} AWS icons`);
  const archive = pack.sources.map((s) => manifest.sources[s.source]).find((src) => src.type === 'zip');
  assert(archive && /^[0-9a-f]{64}$/.test(archive.sha256), 'built from an archive pinned by sha256');
  eq(core.readLibrary(join(LIB_DIR, 'aws.drawio')).length, ids.size, 'library and catalog agree');
});

test('AgentCore ships small: the official SVG for the service, 156px PNGs for its five features (#7)', () => {
  const cat = finder.loadCatalog();
  for (const suffix of ['', ' Gateway', ' Identity', ' Memory', ' Observability', ' Runtime']) {
    assert(cat.icons.some((i) => i.pack === 'aws' && i.title === `Amazon Bedrock AgentCore${suffix}`),
      `missing Amazon Bedrock AgentCore${suffix}`);
  }
  const aws = core.readLibrary(join(LIB_DIR, 'aws.drawio'));
  const pngs = aws.filter((e) => e.mime === 'image/png');
  eq(pngs.length, 5, 'PNG entries');
  for (const e of pngs) {
    assert(/^Amazon Bedrock AgentCore \w+$/.test(e.title), `${e.title} is not an AgentCore feature mark`);
    eq(Math.max(e.intrinsic.width, e.intrinsic.height), 156, `${e.title} longest side`);
    assert(e.byteLength < 32 * 1024, `${e.title} is ${e.byteLength} bytes`);
    eq(e.aspect, 'fixed', `${e.title} keeps its aspect in the palette`);
  }
  const service = cat.icons.filter((i) => i.pack === 'aws' && i.title === 'Amazon Bedrock AgentCore');
  eq(service.map((i) => i.id).sort().join(), 'aws/amazon-bedrock-agentcore,aws/amazon-bedrock-agentcore-2', 'the service and the id that duplicated it');
  assert(service.every((i) => i.mime === 'image/svg+xml'), 'both carry the official SVG');
  eq(service[0].sha256, service[1].sha256, 'one artwork under both ids');
  const decoded = aws.reduce((n, e) => n + e.byteLength, 0);
  assert(decoded < 2 * 1048576, `the AWS pack decodes to ${(decoded / 1048576).toFixed(2)} MB`);
});

test('the committed AgentCore rasters match the digest the manifest pins', () => {
  const src = packs.loadManifest().sources['aws-agentcore-extras'];
  const dir = join(LIB_DIR, src.dir);
  const files = new Map(readdirSync(dir).sort().map((name) => [name, readFileSync(join(dir, name))]));
  eq(files.size, 5, 'feature marks committed');
  eq(packs.localFilesDigest(files), src.sha256, 'a changed raster must be re-pinned deliberately');
});

test('the PNG codec round-trips, shrinks by area average, keeps aspect and never enlarges', () => {
  const pixels = Buffer.alloc(40 * 20 * 3);
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 40; x++) pixels.fill((x + y) % 2 ? 0 : 255, (y * 40 + x) * 3, (y * 40 + x + 1) * 3);
  }
  const png = iconBuild.encodePng({ width: 40, height: 20, channels: 3, pixels });
  assert(iconBuild.decodePng(png).pixels.equals(pixels), 'decode(encode(x)) is x');
  const small = iconBuild.decodePng(iconBuild.downscalePng(png, 10));
  eq(`${small.width}x${small.height}`, '10x5', 'longest side fitted, aspect kept');
  assert([...small.pixels].every((v) => Math.abs(v - 128) <= 1), 'a one-pixel checker averages to grey, not aliased stripes');
  eq(iconBuild.downscalePng(png, 64), png, 'a raster already small enough comes back untouched');
  const rgba = Buffer.from([255, 0, 0, 255, 0, 0, 0, 0]);
  const edge = iconBuild.decodePng(iconBuild.downscalePng(iconBuild.encodePng({ width: 2, height: 1, channels: 4, pixels: rgba }), 1));
  eq([...edge.pixels].join(), '255,0,0,128', 'colour is averaged by alpha, so a transparent neighbour cannot darken it');
  rejects(() => iconBuild.decodePng(Buffer.from('not a png')), /not a PNG/);
});

test('an icon cell is fitted to its image, never stretched square', () => {
  const size = (w, h, requested) => JSON.stringify(finder.recommendedSize({ width: w, height: h }, requested));
  eq(size(156, 147, 78), JSON.stringify({ width: 78, height: 74 }), 'a requested size is the longest side');
  eq(size(78, 78), JSON.stringify({ width: 78, height: 78 }), 'a square mark stays square');
  eq(size(1024, 512), JSON.stringify({ width: 78, height: 39 }), 'the default footprint is fitted too');
  // Fitting the longest side alone drew a 6:1 wordmark 78x13, a hairline with
  // its text a couple of pixels tall. The short side has a floor of a third of
  // the footprint, the long side a ceiling of twice it, and both are shares of
  // the size asked for rather than fixed pixels (#76).
  eq(size(600, 100), JSON.stringify({ width: 156, height: 26 }), 'a 6:1 lockup is grown until it is legible');
  eq(size(800, 100), JSON.stringify({ width: 156, height: 20 }), 'past 6:1 the width ceiling wins over the floor');
  eq(size(600, 100, 40), JSON.stringify({ width: 80, height: 13 }), 'both bounds scale with the size asked for');
  eq(size(0, 0), JSON.stringify({ width: 78, height: 78 }), 'a mark with no usable size falls back to the footprint');
});

// A mark may sit below the floor only because the width ceiling stopped it
// growing; anything else short is the hairline this fixed (#76).
test('no committed mark is drawn as a hairline (#76)', () => {
  const floor = core.ICON_FOOTPRINT * core.MIN_SIDE_SHARE;
  const ceiling = core.ICON_FOOTPRINT * core.MAX_SIDE_SHARE;
  const thin = [];
  for (const icon of finder.loadCatalog().icons.filter((i) => i.bytes === 'committed')) {
    const { width, height } = finder.recommendedSize(icon);
    if (Math.min(width, height) < floor && Math.max(width, height) < ceiling) {
      thin.push(`${icon.id} ${width}x${height}`);
    }
  }
  assert(!thin.length, `${thin.length} marks are drawn under the floor with room to grow:\n        ${thin.join('\n        ')}`);
});

// The size the resolver hands back is the cell the library ships (#80). The
// catalog keeps the artwork's size rounded to integers, and fitting that pair
// drew Restate's 34.46x30.52 artwork at 78x71 beside its 78x69 cell.
test('recommendedSize is the library cell of every committed mark (#80)', () => {
  const cat = finder.loadCatalog();
  const libraries = new Map();
  const committed = cat.icons.filter((i) => i.bytes === 'committed');
  const mismatched = [];
  for (const icon of committed) {
    if (!libraries.has(icon.pack)) libraries.set(icon.pack, core.readLibrary(join(LIB_DIR, `${icon.pack}.drawio`)));
    const entry = libraries.get(icon.pack)[icon.libraryIndex];
    const fitted = finder.recommendedSize(icon);
    if (`${fitted.width}x${fitted.height}` !== `${entry?.w}x${entry?.h}`) {
      mismatched.push(`${icon.id}: recommends ${fitted.width}x${fitted.height}, its cell is ${entry?.w}x${entry?.h}`);
    }
  }
  assert(committed.length > 0, 'no committed marks to check');
  assert(!mismatched.length, `${mismatched.length} of ${committed.length} marks disagree with their cell:\n        ${mismatched.slice(0, 10).join('\n        ')}`);

  // What an agent is handed: the build's own call, --cell and a search.
  const restate = committed.find((i) => i.id === 'streaming-orchestration/restate');
  const at78 = finder.recommendedSize(restate, 78);
  eq(`${at78.width}x${at78.height}`, '78x69', 'Restate at the 78px footprint a build asks for');
  assert(node('find-icon.mjs', ['--cell', restate.id]).includes('width="78" height="69"'), '--cell places Restate at its cell');
  const hit = JSON.parse(node('find-icon.mjs', ['restate'])).matches[0].variants[0];
  eq(hit.recommended, '78x69', 'a search recommends Restate at its cell');
});

test('both SVG and PNG entries decode with real dimensions', () => {
  const aws = core.readLibrary(join(LIB_DIR, 'aws.drawio'));
  const svg = aws.find((e) => e.mime === 'image/svg+xml');
  const png = aws.find((e) => e.mime === 'image/png');
  assert(svg.intrinsic.width > 0 && svg.intrinsic.height > 0, 'svg dimensions');
  assert(png.intrinsic.width > 0 && png.intrinsic.height > 0, 'png dimensions');
});

// A size used to be whichever width came first in the document: a child <rect>,
// a <symbol> in <defs>, or `stroke-width`, because `\b` matches after a hyphen.
// A fetched logo sized from that is drawn at an aspect that is not its own, and
// LOGO_STYLE sets imageAspect=0, so it stretches to fit. Both engines now read
// the root <svg> element's own attributes, viewBox first (#96).
test('SVG dimensions come from the root element only, in both engines (#96)', () => {
  const ns = 'xmlns="http://www.w3.org/2000/svg"';
  const cases = [
    [`<svg ${ns} viewBox="0 0 283.5 283.5"><rect width="10" height="40"/></svg>`, '283.5x283.5', 'a child rect is not the mark'],
    [`<svg ${ns} stroke-width="3" viewBox="0 0 18 18"><path d="M0 0h90v90"/></svg>`, '18x18', 'stroke-width is not a width'],
    [`<svg ${ns} width="64" height="16"><defs><symbol viewBox="0 0 5 5"/></defs></svg>`, '64x16', 'a symbol in defs is not the root'],
    [`<svg ${ns} width="200" height="100" viewBox="0 0 200 100"/>`, '200x100', 'a fully attributed root still reads as itself'],
    [`<svg ${ns} width='48px' height='24px'/>`, '48x24', 'px lengths, single quotes, no viewBox'],
    [`<svg ${ns} width="100%" height="100%"><rect width="7" height="9"/></svg>`, 'nullxnull', 'a percentage is relative to a viewport an image does not have'],
    ['<p>not an SVG at all</p>', 'nullxnull', 'a document with no root svg'],
  ];
  for (const [svg, expect, what] of cases) {
    const bytes = Buffer.from(svg);
    const d = core.svgDimensions(bytes);
    eq(`${d.width}x${d.height}`, expect, what);
    // One rule, one implementation: the Excalidraw reader re-exports this one.
    const e = makeIcon.svgDimensions(bytes);
    eq(`${e.width}x${e.height}`, expect, `${what}, read by the Excalidraw engine`);
  }

  // What the misread cost: the cell a fetched logo is drawn in. logoBox fits
  // the longest side, so a wrong aspect in means a wrong cell out.
  const box = (w, h) => { const b = logos.logoBox({ width: w, height: h }, 78); return `${b.width}x${b.height}`; };
  eq(box(200, 100), '78x39', 'a 2:1 logo gets a 2:1 cell');
  eq(box(10, 40), '20x78', 'the child rect this used to read would have drawn it tall and narrow');
});

// The two marks the document-wide regex misread: ai-frameworks/axolotl read
// 46.4x23.2 from a child <rect> against a 283.5x283.5 root viewBox, and
// azure/intune-trends 2.17x7.32 against 18x18 (#96).
test('every committed SVG entry reads the size its own root declares (#96)', () => {
  const rootViewBox = (bytes) => {
    const attrs = /<svg\b([^>]*)>/i.exec(bytes.toString('utf8'))?.[1] ?? '';
    const vb = /(?:^|\s)viewBox\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
    const n = vb ? vb.trim().split(/[\s,]+/).map(Number) : [];
    return n.length === 4 && n.every(Number.isFinite) && n[2] > 0 && n[3] > 0 ? { width: n[2], height: n[3] } : null;
  };
  const misread = [];
  let checked = 0;
  for (const pack of finder.loadCatalog().packs) {
    for (const e of core.readLibrary(join(LIB_DIR, pack.file))) {
      if (e.mime !== 'image/svg+xml' || !e.dataUri) continue;
      const vb = rootViewBox(core.parseDataUri(e.dataUri).bytes);
      if (!vb) continue;
      checked++;
      const read = `${e.intrinsic.width}x${e.intrinsic.height}`;
      if (read !== `${vb.width}x${vb.height}`) misread.push(`${pack.id}/${e.title}: read ${read}, its root viewBox is ${vb.width}x${vb.height}`);
    }
  }
  assert(checked > 4000, `only ${checked} committed SVG entries examined`);
  assert(!misread.length, `${misread.length} of ${checked} entries read a size their root does not declare:\n        ${misread.slice(0, 10).join('\n        ')}`);
});

test('duplicate titles are retained and disambiguated by id and hash', () => {
  const cat = finder.loadCatalog();
  const dupes = cat.icons.filter((i) => i.title === 'AWS Compute Optimizer');
  eq(dupes.length, 2, 'Compute Optimizer variants in catalog');
  assert(dupes[0].libraryIndex !== dupes[1].libraryIndex, 'library indices differ');
  assert(dupes[0].sha256 !== dupes[1].sha256, 'payload hashes differ');
  assert(dupes[0].id !== dupes[1].id, 'catalog ids differ');
  assert(dupes.every((d) => d.ambiguousTitle === true), 'both flagged ambiguous');
});

test('ids that draw identical artwork name each other in the catalog, the search and the build report (#77)', () => {
  const cat = finder.loadCatalog();
  const byPayload = new Map();
  for (const i of cat.icons.filter((row) => row.bytes === 'committed')) {
    byPayload.set(i.sha256, [...(byPayload.get(i.sha256) ?? []), i.id]);
  }
  for (const i of cat.icons) {
    const twins = i.bytes === 'committed' ? byPayload.get(i.sha256).filter((id) => id !== i.id) : [];
    eq((i.sameArtworkAs ?? []).join(' '), twins.join(' '), `${i.id} sameArtworkAs`);
  }
  const byId = (id) => cat.icons.find((i) => i.id === id);
  eq(byId('azure/my-customers').sameArtworkAs.join(' '), 'azure/groups', 'Groups and My Customers are one picture');
  eq(byId('azure/intune').sameArtworkAs.join(' '), 'azure/intune-app-protection azure/intune-for-education', 'the Intune trio');
  assert(!byId('aws/aws-compute-optimizer').sameArtworkAs, 'a shared title with different artwork is not a twin');

  const shown = JSON.parse(node('find-icon.mjs', ['my customers', '--pack', 'azure'])).matches
    .flatMap((m) => m.variants).find((v) => v.id === 'azure/my-customers');
  eq(shown?.sameArtworkAs?.join(' '), 'azure/groups', 'find-icon shows the twin');

  const at = (id, icon, col) => ({ id, kind: 'icon', icon, label: id, col, row: 0 });
  const { report } = builder.buildDiagram({
    nodes: [at('a', 'azure/groups', 0), at('b', 'aws/aws-lambda', 1), at('c', 'azure/my-customers', 2), at('d', 'azure/groups', 3)],
  });
  eq(JSON.stringify(report.sameArtwork), JSON.stringify([{ ids: ['azure/groups', 'azure/my-customers'], nodes: ['a', 'c', 'd'] }]),
    'the report names both ids and every node drawing that picture');
  const repeated = builder.buildDiagram({ nodes: [at('a', 'azure/groups', 0), at('b', 'azure/groups', 1)] });
  eq(repeated.report.sameArtwork.length, 0, 'one id used twice is not a finding');
});

const lifecycle = await import(`file://${join(SCRIPTS, 'lib', 'lifecycle.mjs').replace(/\\/g, '/')}`);

test('a product status is refused unless its state, dates and successor say something checkable (#83)', () => {
  const ok = { state: 'absorbed', on: '2025-05', successor: 'Fivetran Activations', checked: '2026-09-16' };
  eq(lifecycle.statusProblems('p/x', ok).join(), '', 'a well-formed status');
  eq(lifecycle.statusProblems('p/x', undefined).join(), '', 'no status is fine');
  const problems = (s) => lifecycle.statusProblems('p/x', s).join(' | ');
  assert(/not one of/.test(problems({ ...ok, state: 'dead' })), 'an unknown state');
  assert(/status.on/.test(problems({ ...ok, on: 'May 2025' })), 'a date that is not ISO');
  assert(/status.checked/.test(problems({ ...ok, checked: '2026-09' })), 'checked is a day');
  assert(/names its successor/.test(problems({ state: 'renamed', on: '2024', checked: '2026-09-16' })), 'a rename to nothing');
  assert(/not a known field/.test(problems({ ...ok, sucessor: 'typo' })), 'a misspelt field');
  assert(/needs a successor name/.test(problems({ state: 'acquired', on: '2025', successorId: 'a/b', checked: '2026-09-16' })), 'an id with no name');

  const warn = /check before drawing it into a target state/;
  assert(warn.test(lifecycle.caveat('Height', { state: 'discontinued', on: '2025-09-24' })), 'a dead product warns');
  assert(!warn.test(lifecycle.caveat('Redpanda Connect', { state: 'renamed', on: '2024', from: 'Benthos' })), 'the current name of a renamed product does not');
  assert(!warn.test(lifecycle.caveat('Stytch', { state: 'acquired', on: '2025', by: 'Twilio' })), 'a brand still operating does not');
  assert(/not closed/.test(lifecycle.caveat('Arize AI', { state: 'acquired', on: '2026-08-13', by: 'Dynatrace', pending: true })), 'a pending deal says so');
  assert(lifecycle.staleStatus({ checked: '2025-01-01' }, Date.parse('2026-09-16')), 'a year-old fact is stale');
  assert(!lifecycle.staleStatus({ checked: '2026-09-01' }, Date.parse('2026-09-16')), 'a fresh one is not');
});

test('a discontinued, renamed or absorbed product still resolves, and says so in the search and the build (#83)', () => {
  const cat = finder.loadCatalog();
  const withStatus = cat.icons.filter((i) => i.status);
  for (const id of ['saas-collab/height', 'observability/lightstep', 'ml-training/tecton', 'data-platforms/census',
    'streaming-orchestration/redpandaconnect', 'devops/earthly', 'data-platforms/mode', 'security-identity/stytch',
    'saas-collab/statsig', 'ai-frameworks/arize', 'ai-frameworks/galileo', 'ml-training/torchserve']) {
    assert(withStatus.some((i) => i.id === id), `${id} carries no status`);
  }
  const manifest = packs.loadManifest();
  const invalid = manifest.packs.flatMap((p) => [...(p.icons ?? []), ...(p.onDemand ?? [])]
    .flatMap((e) => lifecycle.statusProblems(`${p.id}/${e.slug}`, e.status)));
  eq(invalid.join('; '), '', 'every recorded status is well-formed');
  for (const i of withStatus.filter((row) => row.status.successorId)) {
    assert(finder.byExactId(cat, i.status.successorId), `${i.id} names a successor id that is not catalogued`);
  }

  // The mark is still the right mark for that name: confidence is unchanged.
  const r = finder.resolve('height');
  assert(r.confident && r.icon.id === 'saas-collab/height', `"height" -> ${r.icon?.id} (${r.reason})`);

  const shown = JSON.parse(node('find-icon.mjs', ['census'])).matches.flatMap((m) => m.variants)
    .find((v) => v.id === 'data-platforms/census');
  eq(shown?.lifecycle?.state, 'absorbed', 'find-icon shows the state');
  assert(/Fivetran Activations/.test(shown.lifecycle.caveat), 'and the caveat names the successor');
  eq(shown.lifecycle.successor?.id, 'streaming-orchestration/fivetran', 'and the successor id to offer');

  const at = (id, icon, col) => ({ id, kind: 'icon', icon, label: id, col, row: 0 });
  const { report } = builder.buildDiagram({ nodes: [at('a', 'saas-collab/height', 0), at('b', 'aws/aws-lambda', 1)] });
  eq(report.lifecycle.map((l) => `${l.id}:${l.state}`).join(), 'saas-collab/height:discontinued', 'the build report names it');
  eq(report.needsFetch.map((n) => n.id).join(), 'saas-collab/height', 'and still reports it as needing artwork');
});

const lifecycleDrift = await settle(upstream.checkDrift({
  catalog: { icons: [] },
  manifest: { sources: {}, packs: [{ id: 'p', icons: [], onDemand: [
    { slug: 'old', title: 'Old Co', status: { state: 'acquired', on: '2024', by: 'Big Co', checked: '2025-06-01' } },
    { slug: 'new', title: 'New Co', status: { state: 'discontinued', on: '2026-01', checked: '2026-09-01' } },
  ] }] },
  now: Date.parse('2026-09-16T00:00:00Z'),
}));

test('the drift pass reports product statuses last confirmed a year ago or more (#83)', () => {
  assert(!lifecycleDrift.error, `check threw: ${lifecycleDrift.error?.message}`);
  const row = lifecycleDrift.value.find((r) => r.kind === 'lifecycle');
  assert(row?.drifted, 'a stale fact is a finding');
  eq(`${row.recorded} ${row.stale.map((s) => s.id).join()}`, '2 p/old', 'only the stale one is listed');
  const report = upstream.driftReport(lifecycleDrift.value);
  assert(report.includes('`p/old` (Old Co) | acquired | 2025-06-01') && !report.includes('p/new'), 'the report names it and nothing else');
  assert(!report.includes('| pinned | upstream now |') && !report.includes('Project logos'), 'no other section');
});

test('the old palette captions still resolve as aliases', () => {
  const cases = [
    ['Arch Amazon-Bedrock 64', 'Amazon Bedrock'],
    ['Arch AWS-Lambda 64', 'AWS Lambda'],
    ['Arch Amazon-Simple-Storage-Service 64', 'Amazon Simple Storage Service'],
  ];
  for (const [legacy, expect] of cases) {
    const r = finder.search(legacy);
    assert(r.length, `no match for ${legacy}`);
    eq(r[0].title, expect, `legacy caption "${legacy}"`);
  }
});

test('catalog carries no base64 payloads', () => {
  const raw = readFileSync(join(SKILL, 'references', 'icon-catalog.json'), 'utf8');
  assert(!raw.includes('data:image/'), 'catalog embeds image data');
  const cat = JSON.parse(raw);
  assert(cat.icons.length > 4000, `catalog size ${cat.icons.length}`);
  assert(cat.icons.every((i) => i.id && i.title && i.pack && i.licence), 'catalog fields present');
  const committed = cat.icons.filter((i) => i.bytes === 'committed');
  assert(committed.every((i) => i.sha256 && Number.isInteger(i.libraryIndex)), 'committed entries indexed');
});

test('every catalog id is unique', () => {
  const ids = finder.loadCatalog().icons.map((i) => i.id);
  eq(new Set(ids).size, ids.length, 'unique ids');
});

test('nothing ships bytes for a mark we lack permission to redistribute', () => {
  const cat = finder.loadCatalog();
  const onDemand = cat.icons.filter((i) => i.bytes === 'on-demand');
  assert(onDemand.length > 0, 'expected on-demand entries');
  for (const i of onDemand) assert(i.libraryIndex === undefined, `${i.id} has a library index`);
  // ...and the library genuinely does not contain them.
  const lib = core.readLibrary(join(LIB_DIR, 'ai-frameworks.drawio'));
  assert(!lib.some((e) => e.title === 'OpenAI'), 'an on-demand mark leaked into a library');
});

// ------------------------------------------------------------- icon lookup

test('icon lookup resolves an exact service name', () => {
  const r = finder.search('Amazon Bedrock');
  eq(r[0].title, 'Amazon Bedrock', 'exact match');
});

test('icon lookup resolves fuzzy and abbreviated names', () => {
  const cases = [['bedrock', 'Amazon Bedrock'], ['lambda', 'AWS Lambda'],
    ['cloudwatch', 'Amazon CloudWatch'], ['s3', 'Amazon Simple Storage Service'],
    ['kafka', 'Apache Kafka'], ['terraform', 'Terraform'], ['blob storage', 'Storage Accounts'],
    ['gke', 'GKE'], ['snowflake', 'Snowflake']];
  for (const [q, expect] of cases) {
    const r = finder.resolve(q);
    assert(r.groups.length, `no match for ${q}`);
    eq(r.groups[0].title, expect, `lookup for "${q}"`);
  }
});

test('a curated pack outranks the catch-all', () => {
  for (const q of ['docker', 'kubernetes', 'grafana', 'postgresql']) {
    const r = finder.resolve(q);
    assert(r.confident, `"${q}" should resolve confidently`);
    assert(r.icon.pack !== 'brands', `"${q}" resolved into the catch-all`);
  }
});

// Vespa and Nebula were promoted too, by slug, and were the wrong products:
// Simple Icons' marks are Piaggio's scooter and the nebula.tv streaming service (#81).
test('the 64 products promoted out of the catch-all now live in curated packs (#19)', () => {
  const cat = finder.loadCatalog();
  const promoted = {
    'data-platforms': 'mixpanel posthog elementary',
    databases: 'pocketbase appwrite turso',
    'ai-frameworks': 'modal braintrust langflow openaigym',
    'ml-training': 'deepnote lightning',
    observability: 'checkmk icinga netdata thanos',
    devops: 'devbox talos coolify caprover portainer watchtower kong',
    'security-identity': 'ory clerk',
    'saas-collab': 'coda obsidian logseq shortcut pivotaltracker retool appsmith budibase',
    'languages-runtimes': 'zig nim crystal ocaml fsharp clojure erlang solidity astro solid qwik remix nuxt vite esbuild '
      + 'rollupdotjs webpack turborepo nx biome eslint prettier ruff uv poetry pdm rye pytest vitest jest cypress',
  };
  const ids = new Set(cat.icons.filter((i) => i.bytes === 'committed').map((i) => i.id));
  let count = 0;
  for (const [pack, slugs] of Object.entries(promoted)) {
    for (const slug of slugs.split(' ')) {
      count++;
      assert(ids.has(`${pack}/${slug}`), `${pack}/${slug} is not curated`);
      assert(!ids.has(`brands/${slug}`), `brands/${slug} still ships a second copy`);
    }
  }
  eq(count, 64, 'promoted products');
  // Named exactly, each now answers from its curated pack without the catch-all caveat.
  for (const [q, id] of [['kong', 'devops/kong'], ['posthog', 'data-platforms/posthog'], ['thanos', 'observability/thanos'],
    ['vite', 'languages-runtimes/vite'], ['pytest', 'languages-runtimes/pytest'], ['f#', 'languages-runtimes/fsharp']]) {
    const r = finder.resolve(q);
    assert(r.confident, `"${q}" is not confident: ${r.reason}`);
    eq(r.icon.id, id, `"${q}"`);
  }
});

test('Vespa and NebulaGraph never draw the scooter or the streaming service Simple Icons names alike (#81)', () => {
  const cat = finder.loadCatalog();
  const row = (id) => cat.icons.find((i) => i.id === id);
  for (const [id, title, wrong] of [['databases/vespa', 'Vespa', 'brands/vespa'], ['databases/nebula', 'NebulaGraph', 'brands/nebula']]) {
    eq(`${row(id)?.bytes} ${row(id)?.title}`, `on-demand ${title}`, id);
    assert(/not the/.test(row(id).reason), `${id} records why its Simple Icons mark is the wrong product`);
    eq(row(wrong)?.bytes, 'committed', `${wrong} stays in the catch-all, where it names what it is`);
  }
  for (const q of ['vespa', 'nebula']) {
    const r = finder.resolve(q);
    assert(!r.confident, `"${q}" resolved confidently to ${r.icon?.id}`);
    eq(r.icon?.id, `databases/${q}`, `"${q}" ranks the database first`);
  }
  const graph = finder.resolve('nebulagraph');
  assert(graph.confident && graph.icon.id === 'databases/nebula', `"nebulagraph" -> ${graph.icon?.id}`);
});

test('Teleport, Argo CD, Playwright and dlt ship from sources already pinned (#20)', () => {
  const cat = finder.loadCatalog();
  const byId = new Map(cat.icons.filter((i) => i.bytes === 'committed').map((i) => [i.id, i]));
  // Three full-colour devicon originals, verbatim, and one Simple Icons mark
  // promoted out of the catch-all. No new source, no new licence.
  for (const [id, title, source, upstreamId] of [
    ['security-identity/teleport', 'Teleport', 'devicon@2.17.0', 'icons/teleport/teleport-original.svg'],
    ['devops/argocd', 'Argo CD', 'devicon@2.17.0', 'icons/argocd/argocd-original.svg'],
    ['languages-runtimes/playwright', 'Playwright', 'devicon@2.17.0', 'icons/playwright/playwright-original.svg'],
    ['streaming-orchestration/dlthub', 'dlt', 'simple-icons@16.30.0', 'dlthub'],
  ]) {
    const r = byId.get(id);
    assert(r, `${id} does not ship`);
    eq(`${r.title} | ${r.source} | ${r.upstreamId}`, `${title} | ${source} | ${upstreamId}`, id);
    if (source.startsWith('devicon')) eq(r.render, 'verbatim-colour', `${id} ships its own colours`);
  }
  assert(!byId.has('brands/dlthub'), 'brands/dlthub still ships a second copy');
  // The Argo octopus stays Argo's; Argo CD answers from DevOps in colour.
  for (const [q, id] of [['teleport', 'security-identity/teleport'], ['argocd', 'devops/argocd'], ['argo cd', 'devops/argocd'],
    ['argo', 'streaming-orchestration/argo'], ['argo workflows', 'streaming-orchestration/argo'],
    ['playwright', 'languages-runtimes/playwright'], ['dlt', 'streaming-orchestration/dlthub'], ['dlthub', 'streaming-orchestration/dlthub']]) {
    const r = finder.resolve(q);
    assert(r.confident, `"${q}" is not confident: ${r.reason}`);
    eq(r.icon.id, id, `"${q}"`);
  }
  // "F#" normalises to "f"; an alias that short would answer to any one-letter query.
  assert(!cat.icons.find((i) => i.id === 'languages-runtimes/fsharp').aliases.includes('f'), 'F# carries a one-letter alias');
});

test('pack context breaks a tie toward the stack being drawn', () => {
  const plain = finder.resolve('opensearch');
  const aws = finder.resolve('opensearch', { packs: ['aws'] });
  eq(aws.groups[0].pack, 'aws', 'AWS context wins');
  assert(plain.groups[0].pack !== 'aws', 'context made no difference');
});

test('an ambiguous lookup is flagged rather than resolved silently', () => {
  const r = finder.resolve('compute optimizer');
  assert(!r.confident, 'should not be confident');
  eq(r.groups[0].variants.length, 2, 'both variants offered');
});

test('an unknown service returns no match rather than a wrong icon', () => {
  eq(finder.search('nonexistent quantum widget').length, 0, 'match count');
  // Across ~4,800 icons some query will always graze something. What must never
  // happen is a confident answer to a question the catalog cannot answer.
  for (const q of ['acme internal gateway', 'widget factory service', 'frobnicator']) {
    assert(!finder.resolve(q).confident, `"${q}" resolved confidently`);
  }
});

test('a name that only starts a different product flags itself instead of resolving (#21)', () => {
  // Each ranks a real icon first, and each is the wrong product: Grafana Tempo is
  // not Temporal, Cube is not Azure's generic "Cubes", and Active Directory is not
  // its Connect Health sub-product.
  for (const q of ['tempo', 'cube', 'active directory']) {
    const r = finder.resolve(q);
    assert(r.groups.length, `"${q}" should still offer candidates`);
    assert(!r.confident, `"${q}" resolved confidently to ${r.icon?.id}`);
  }
  // A prefix that only drops a generic tail still names the product.
  for (const [q, id] of [['postgres', 'databases/postgresql'], ['rabbit', 'streaming-orchestration/rabbitmq'],
    ['envoy', 'devops/envoyproxy'], ['key vault', 'azure/key-vaults'], ['storage account', 'azure/storage-accounts']]) {
    const r = finder.resolve(q);
    assert(r.confident, `"${q}" lost confidence: ${r.reason}`);
    eq(r.icon.id, id, `"${q}"`);
  }
  // Doubt must not work by lowering a score: that widens the margin and hands
  // confidence to a different wrong answer - here, the airline.
  assert(!finder.resolve('delta').confident, '"delta" became confident');
});

test('icon resolution corpus: never confidently wrong, and precision at rank 1 holds its floor (#15)', () => {
  const key = JSON.parse(readFileSync(join(HERE, 'icon-queries.json'), 'utf8'));
  const m = { answerable: 0, top1: 0, gated: 0, refusals: 0, held: 0 };
  const wrong = [];
  for (const [q, accept, context] of key.queries) {
    const r = finder.resolve(q, context ? { packs: context.split(',') } : {});
    const right = accept !== null && [].concat(accept).includes(r.icon?.id);
    if (accept === null) { m.refusals++; if (!r.confident) m.held++; } else {
      m.answerable++;
      if (right) m.top1++;
      if (!r.confident) m.gated++;
    }
    // A wrong confident answer gets drawn; a right unconfident one gets asked about.
    if (r.confident && !right) wrong.push(`${q}${context ? ` [${context}]` : ''} -> ${r.icon.id}`);
  }
  const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`;
  console.log(`        corpus: precision@1 ${pct(m.top1, m.answerable)} (${m.top1}/${m.answerable}), `
    + `gate fires on ${pct(m.gated, m.answerable)}, refusals held ${m.held}/${m.refusals}, confident-wrong ${wrong.length}`);
  assert(!wrong.length, `confident and wrong: ${wrong.join('; ')}`);
  assert(m.top1 / m.answerable >= key.precisionFloor,
    `precision@1 ${pct(m.top1, m.answerable)} fell below the ${key.precisionFloor * 100}% floor`);
});

// Two packs can ship marks with exactly the same title, and both then score 105,
// so the margin is nil and nothing is drawn. Every such tie needs a recorded
// judgement, and a new one must not appear unnoticed the way Azure's corrected
// Prometheus caption once did. `brands` is left out: it is the catch-all, ranked
// last by design, and the issue scopes it out (#75).
test('every exact-title tie is judged, and naming the stack settles it (#75)', () => {
  const key = JSON.parse(readFileSync(join(HERE, 'icon-queries.json'), 'utf8'));
  const judged = new Set(key.queries.map((r) => String(r[0]).toLowerCase()));
  const byTitle = new Map();
  for (const icon of finder.loadCatalog().icons.filter((i) => i.bytes === 'committed')) {
    const title = String(icon.title).toLowerCase();
    byTitle.set(title, [...(byTitle.get(title) ?? []), icon]);
  }
  const ties = [...byTitle].filter(([, g]) => new Set(g.map((i) => i.pack)).size > 1
    && !g.some((i) => i.pack === 'brands'));
  assert(ties.length > 0, 'no cross-pack title ties found, so this test proves nothing');

  // Naming a stack cannot settle a tie whose runner-up sits in that same pack:
  // Azure ships File beside Files, and primitives ships Monitor beside Desktop.
  const RUNNER_UP_IN_SAME_PACK = new Set(['file::azure', 'monitor::primitives']);

  const problems = [];
  for (const [title, group] of ties) {
    if (!judged.has(title)) {
      problems.push(`"${title}" ties ${group.map((i) => i.id).join(' and ')}, with no row in icon-queries.json`);
    }
    if (finder.resolve(title).confident) {
      problems.push(`"${title}" is confident with no stack named, although ${group.length} packs share the title`);
    }
    for (const icon of group) {
      const r = finder.resolve(title, { packs: [icon.pack] });
      const settled = r.confident && r.icon.id === icon.id;
      const exception = RUNNER_UP_IN_SAME_PACK.has(`${title}::${icon.pack}`);
      if (exception && settled) problems.push(`"${title}" [${icon.pack}] settles now, so it is no longer an exception`);
      if (!exception && !settled) {
        problems.push(`"${title}" [${icon.pack}] does not settle on ${icon.id}: ${r.confident ? r.icon.id : r.reason}`);
      }
    }
  }
  assert(!problems.length, `${problems.length} problems:\n        ${problems.join('\n        ')}`);
});

// A search prints `<pack>/<slug>` as the thing to put in a spec, and the skill
// says to do exactly that - but the builder passed it to the text search like
// any free-text query. 752 of the 4,843 committed ids embedded another
// product's mark, 227 drew a plain box, and only 288 came back confidently
// right (#95). An exact id is now an instruction: it selects that row or
// nothing.
test('every exact catalog id embeds its own artwork (#95)', () => {
  const cat = finder.loadCatalog();
  const wrong = [];
  for (const icon of cat.icons) {
    const report = { used: [], missing: [], ambiguous: [], needsFetch: [] };
    const chosen = builder.resolveIcon({ kind: 'icon', icon: icon.id }, cat, report, null);
    // An exact id on a mark that ships no bytes still goes to needsFetch: a
    // licence we do not have is not fixed by drawing something else.
    if (icon.bytes === 'on-demand') {
      if (chosen) wrong.push(`${icon.id}: drew ${chosen.id} for a mark that ships no bytes`);
      else if (report.needsFetch[0]?.id !== icon.id) wrong.push(`${icon.id}: not reported to fetch`);
      continue;
    }
    if (!chosen) { wrong.push(`${icon.id}: drew a plain box`); continue; }
    if (chosen.id !== icon.id) { wrong.push(`${icon.id}: drew ${chosen.id}`); continue; }
    const uri = finder.styleSafeDataUri(chosen).replace(/^data:([^;,]+),/, 'data:$1;base64,');
    const { hash } = core.parseDataUri(uri);
    if (hash !== icon.sha256) wrong.push(`${icon.id}: embedded ${hash.slice(0, 12)}, catalog says ${icon.sha256.slice(0, 12)}`);
  }
  assert(cat.icons.length > 4000, `no catalog to check (${cat.icons.length} rows)`);
  assert(!wrong.length, `${wrong.length} of ${cat.icons.length} ids resolve to the wrong artwork:\n        ${wrong.slice(0, 10).join('\n        ')}`);
});

test('a build draws the mark each exact id names, and says so (#95)', () => {
  const cat = finder.loadCatalog();
  const ids = ['azure/advisor', 'databases/postgresql', 'streaming-orchestration/restate'];
  const { xml, report } = builder.buildDiagram({
    title: 'exact ids',
    nodes: [
      ...ids.map((id, i) => ({ id: `n${i}`, kind: 'icon', icon: id, label: id, col: i, row: 0 })),
      { id: 'od', kind: 'icon', icon: 'ai-frameworks/openai', label: 'OpenAI', col: 0, row: 1 },
    ],
  });
  eq(report.used.map((u) => u.id).join(','), ids.join(','), 'the report names the ids the spec asked for');
  eq(report.ambiguous.length, 0, 'an exact id is not ambiguous');
  eq(report.missing.length, 0, 'an exact id is not missing');
  for (const id of ids) {
    const payload = finder.styleSafeDataUri(cat.icons.find((i) => i.id === id)).replace(/^data:[^,]+,/, '');
    assert(xml.includes(payload), `${id}: its own artwork is not in the file`);
  }
  eq(report.needsFetch.map((f) => f.id).join(), 'ai-frameworks/openai', 'an exact on-demand id is reported to fetch');
  assert(!report.used.some((u) => u.query === 'ai-frameworks/openai'), 'an on-demand id must not be drawn');

  // A node that pins a pack the id does not belong to is a spec arguing with
  // itself. Searching the pinned pack for it is the same bug in miniature:
  // "aws" plus `databases/postgresql` scored Amazon RDS, confidently. It is
  // reported and drawn as a box instead.
  const clash = builder.buildDiagram({
    nodes: [{ id: 'n0', kind: 'icon', icon: 'databases/postgresql', pack: 'aws', label: 'Postgres', col: 0, row: 0 }],
  });
  assert(!clash.report.used.length, `a contradicted id drew ${clash.report.used[0]?.id} unattended`);
  eq(clash.report.missing.length, 1, 'a contradicted id is reported once');
  assert(/pack/.test(clash.report.missing[0].reason ?? ''), 'the report names the pack the id really lives in');
});

test('an on-demand icon refuses to produce bytes and hands back the command', () => {
  const cat = finder.loadCatalog();
  const icon = cat.icons.find((i) => i.id === 'ai-frameworks/openai');
  assert(icon, 'openai catalog entry');
  let threw = null;
  try { finder.dataUriFor(icon); } catch (e) { threw = e; }
  assert(threw, 'expected dataUriFor to refuse');
  assert(threw.message.includes(icon.fetch), 'error should name the fetch command');
});

// 122 of 158 on-demand entries once carried `--url <logo URL from ...>`, a
// sentence an agent cannot run. Only a pinned artwork file gets a command (#84).
test('only an on-demand entry with pinned artwork offers a fetch command; the rest say there is nothing to fetch (#84)', () => {
  const cat = finder.loadCatalog();
  const onDemand = cat.icons.filter((i) => i.bytes === 'on-demand');
  for (const i of onDemand) {
    const slug = i.id.slice(i.pack.length + 1);
    if (i.upstreamUrl) {
      eq(i.artwork, 'pinned', i.id);
      eq(i.fetch, `node scripts/fetch-logo.mjs --url ${i.upstreamUrl} --name ${slug}`, `${i.id} fetch`);
    } else {
      eq(i.artwork, 'none pinned', i.id);
      assert(i.fetch === undefined, `${i.id} offers a command with nothing to download: ${i.fetch}`);
    }
  }
  for (const p of cat.packs) {
    const mine = onDemand.filter((i) => i.pack === p.id);
    eq(`${p.onDemand}/${p.onDemandPinned}`, `${mine.length}/${mine.filter((i) => i.artwork === 'pinned').length}`, `${p.id} on-demand/pinned`);
  }

  const pinned = cat.icons.find((i) => i.id === 'ai-frameworks/openai');
  const unpinned = cat.icons.find((i) => i.id === 'data-platforms/deltalake');
  assert(pinned.artwork === 'pinned' && unpinned.artwork === 'none pinned', 'fixture rows changed');
  let threw = null;
  try { finder.dataUriFor(unpinned); } catch (e) { threw = e; }
  assert(threw && /nothing to fetch/.test(threw.message) && threw.message.includes('https://delta.io/')
    && threw.message.includes('--file <path> --name deltalake') && !threw.message.includes('--url'), threw?.message);

  const variant = (query, id) => JSON.parse(node('find-icon.mjs', [query])).matches.flatMap((m) => m.variants).find((v) => v.id === id);
  const shownPinned = variant('openai', pinned.id);
  assert(shownPinned?.artwork === 'pinned' && shownPinned.fetch === pinned.fetch && !shownPinned.next, JSON.stringify(shownPinned));
  const shownUnpinned = variant('delta lake', unpinned.id);
  assert(shownUnpinned?.artwork === 'none pinned' && !shownUnpinned.fetch && /placeholder/.test(shownUnpinned.next), JSON.stringify(shownUnpinned));

  const { report } = builder.buildDiagram({
    nodes: [
      { id: 'a', kind: 'icon', icon: pinned.id, label: 'OpenAI', col: 0, row: 0 },
      { id: 'b', kind: 'icon', icon: unpinned.id, label: 'Delta Lake', col: 1, row: 0 },
    ],
  });
  const [a, b] = report.needsFetch;
  assert(a?.id === pinned.id && a.artwork === 'pinned' && a.fetch === pinned.fetch && !a.next, JSON.stringify(a));
  assert(b?.id === unpinned.id && b.artwork === 'none pinned' && !b.fetch && /nothing to fetch/.test(b.next), JSON.stringify(b));

  const listed = JSON.parse(node('find-icon.mjs', ['--list-packs'])).packs.find((p) => p.id === 'data-platforms');
  eq(`${listed.onDemand}/${listed.onDemandPinned}`, `${cat.packs.find((p) => p.id === 'data-platforms').onDemand}/`
    + `${cat.packs.find((p) => p.id === 'data-platforms').onDemandPinned}`, '--list-packs shows the pinned count');
  const index = readFileSync(join(SKILL, 'references', 'pack-index.md'), 'utf8');
  assert(!index.includes('<logo URL'), 'pack-index still offers a placeholder URL');
  const heading = `## ${cat.packs.find((p) => p.id === 'data-platforms').title}\n`;
  const start = index.indexOf(heading);
  const section = index.slice(start, index.indexOf('\n## ', start + 1));
  assert(start >= 0, `pack-index has no "${heading.trim()}" section`);
  assert(/\*Fetchable with your own permission \(\d+\)\.\*/.test(section) && /\*Nothing to fetch \(\d+\)\.\*/.test(section)
    && section.indexOf('Delta Lake') > section.indexOf('*Nothing to fetch'), 'pack-index separates the two kinds');
});

test('cell styles use the comma-only data URI form draw.io can parse', () => {
  const cat = finder.loadCatalog();
  for (const id of ['aws/aws-lambda', 'azure/storage-accounts', 'agents/memory', 'file-types/py']) {
    const icon = cat.icons.find((i) => i.id === id);
    assert(icon, `catalog entry ${id}`);
    const style = finder.styleFor(icon);
    assert(!style.includes(';base64,'), `${id}: style holds a semicolon that would split it`);
    const parsed = core.parseStyle(style);
    const data = core.parseDataUri(parsed.image);
    assert(data && data.bytes.length > 0, `${id}: embedded image does not decode`);
    eq(data.hash, icon.sha256, `${id}: embedded payload matches catalog hash`);
  }
});

test('every generated pack renders as a parseable SVG', () => {
  for (const id of ['agents', 'primitives', 'github', 'file-types']) {
    const entries = core.readLibrary(join(LIB_DIR, `${id}.drawio`));
    for (const e of entries) {
      const svg = e.dataUri && core.parseDataUri(e.dataUri);
      assert(svg && svg.mime === 'image/svg+xml', `${id}/${e.title}: not an SVG`);
      const text = svg.bytes.toString('utf8');
      assert(text.startsWith('<svg') && text.trimEnd().endsWith('</svg>'), `${id}/${e.title}: malformed SVG`);
    }
  }
});

test('a file-type band never renders under 8px, and a long extension takes a shorter band (#14)', () => {
  const glyph = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>';
  const fontOf = (svg) => Number(/<text[^>]*font-size="([\d.]+)"/.exec(svg)[1]);
  const textOf = (svg) => /<text[^>]*>([^<]*)<\/text>/.exec(svg)[1];
  const refusal = (options) => {
    try { iconBuild.fileSheet(glyph, { colour: '#2496ED', ...options }); } catch (error) { return error.message; }
    return null;
  };

  eq(fontOf(iconBuild.fileSheet(glyph, { ext: 'py', colour: '#3776AB' })), 9, 'a short extension keeps 9px');
  const seven = iconBuild.fileSheet(glyph, { ext: 'parquet', colour: '#50ABF1' });
  assert(textOf(seven) === 'PARQUET' && fontOf(seven) >= iconBuild.MIN_BAND_FONT, 'seven capitals still fit at 8px or more');
  assert(/"DOCKERFILE" would render at 5\.65px, under 8px/.test(refusal({ ext: 'dockerfile' }) ?? ''), 'a ten-letter band is refused');
  assert(/under 8px/.test(refusal({ ext: 'py', band: 'abcdefgh' }) ?? ''), 'an eight-letter band is refused too');
  for (const band of ['', '  ']) assert(/"band" is empty/.test(refusal({ ext: 'py', band }) ?? ''), `band ${JSON.stringify(band)} accepted`);
  const docker = iconBuild.fileSheet(glyph, { ext: 'dockerfile', band: 'docker', colour: '#2496ED' });
  assert(textOf(docker) === 'DOCKER' && fontOf(docker) === 9, 'the band label replaces the extension at full size');

  const entries = core.readLibrary(join(LIB_DIR, 'file-types.drawio'));
  const svgOf = (e) => core.parseDataUri(e.dataUri).bytes.toString('utf8');
  for (const e of entries) assert(fontOf(svgOf(e)) >= iconBuild.MIN_BAND_FONT, `${e.title}: band at ${fontOf(svgOf(e))}px`);
  eq(textOf(svgOf(entries.find((e) => e.title === 'Docker file (.dockerfile)'))), 'DOCKER', 'committed dockerfile band');
  eq(textOf(svgOf(entries.find((e) => e.title === 'Excalidraw file (.excalidraw)'))), 'EXCALI', 'committed excalidraw band');
  for (const [query, title] of [['dockerfile', 'Docker file (.dockerfile)'], ['dot excalidraw', 'Excalidraw file (.excalidraw)'],
    ['excalidraw file', 'Excalidraw file (.excalidraw)']]) {
    const top = finder.search(query)[0];
    assert(top?.pack === 'file-types' && top.title === title, `${query} now finds ${top?.pack}/${top?.title}`);
  }
});

// ------------------------------------------------------------- contact sheets

const sheets = await import(`file://${join(SCRIPTS, 'contact-sheet.mjs').replace(/\\/g, '/')}`);
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake shot')]);

// Stands in for Chrome: fills the profile it was handed with the kind of files
// a real one leaves, then does whatever `shoot` says with the screenshot path.
function fakeChrome(calls, shoot) {
  const flag = (args, name) => args.find((a) => a.startsWith(`--${name}=`)).slice(name.length + 3);
  return (exe, args) => {
    const call = { profile: flag(args, 'user-data-dir'), shot: flag(args, 'screenshot'), html: fileURLToPath(args.at(-1)) };
    calls.push(call);
    assert(existsSync(call.html), 'the sheet HTML exists while Chrome runs');
    mkdirSync(call.profile, { recursive: true });
    for (const f of ['Cookies', 'History', 'Login Data']) writeFileSync(join(call.profile, f), 'private');
    shoot(call.shot);
  };
}

test('a contact sheet leaves only its PNG, and a failed shot keeps the old one (#44)', () => {
  const sheetDir = join(TMP, 'contact-sheets');
  mkdirSync(sheetDir, { recursive: true });
  const committed = join(sheetDir, 'file-types.png');
  const listing = () => readdirSync(sheetDir).sort().join(',');
  writeFileSync(committed, 'committed sheet');
  const before = listing();

  const calls = [];
  const ok = sheets.build('file-types', { png: true, sheetDir, chrome: 'chrome', runner: fakeChrome(calls, (shot) => writeFileSync(shot, PNG_BYTES)) });
  assert(ok.pngPath === committed && !ok.error && !ok.htmlPath, 'reports the PNG and no HTML');
  assert(readFileSync(committed).equals(PNG_BYTES), 'the new screenshot replaced the sheet');
  assert(!calls[0].profile.startsWith(ROOT) && !calls[0].html.startsWith(ROOT), 'profile and HTML live outside the repository');
  assert(!existsSync(dirname(calls[0].profile)), 'the scratch directory is removed');
  eq(listing(), before, 'nothing new beside the PNG');

  const failures = [
    ['Chrome crashes', (shot) => { throw new Error('boom'); }, /Chrome failed: boom/],
    ['Chrome times out', () => { throw Object.assign(new Error('spawnSync chrome ETIMEDOUT'), { code: 'ETIMEDOUT' }); }, /timed out/],
    ['no screenshot', () => {}, /without writing/],
    ['an empty screenshot', (shot) => writeFileSync(shot, ''), /not a PNG/],
    ['a screenshot that is not a PNG', (shot) => writeFileSync(shot, '<svg/>'), /not a PNG/],
  ];
  for (const [why, shoot, message] of failures) {
    writeFileSync(committed, 'committed sheet');
    const r = sheets.build('file-types', { png: true, sheetDir, chrome: 'chrome', runner: fakeChrome(calls, shoot) });
    assert(r.error && message.test(r.error) && !r.pngPath, `${why}: reported as "${r.error}"`);
    eq(readFileSync(committed, 'utf8'), 'committed sheet', `${why}: the previous sheet is untouched`);
    assert(!existsSync(dirname(calls.at(-1).profile)), `${why}: the scratch profile is removed`);
    eq(listing(), before, `${why}: nothing left beside the sheet`);
  }
});

test('the sheet HTML stays only when it is the output or --keep-html asks for it (#44)', () => {
  const sheetDir = join(TMP, 'contact-sheets-html');
  const html = join(sheetDir, 'file-types.html');
  const never = () => { throw new Error('Chrome must not run'); };

  const plain = sheets.build('file-types', { sheetDir, chrome: 'chrome', runner: never });
  assert(plain.htmlPath === html && existsSync(html) && !plain.pngPath, 'without --png the HTML is the sheet');
  rmSync(html);

  const kept = sheets.build('file-types', { png: true, keepHtml: true, sheetDir, chrome: 'chrome', runner: fakeChrome([], (shot) => writeFileSync(shot, PNG_BYTES)) });
  assert(kept.pngPath && kept.htmlPath === html && existsSync(html), '--keep-html keeps it beside the PNG');
  rmSync(html);

  const noChrome = sheets.build('file-types', { png: true, sheetDir, chrome: null, runner: never });
  assert(noChrome.htmlPath === html && existsSync(html) && !noChrome.error && /no Chrome/.test(noChrome.note), 'no Chrome falls back to the HTML');

  eq(sheets.staleProfile(sheetDir), null, 'no legacy profile reported when there is none');
  mkdirSync(join(sheetDir, '.shot'));
  eq(sheets.staleProfile(sheetDir), join(sheetDir, '.shot'), 'a legacy profile is reported');
  assert(existsSync(join(sheetDir, '.shot')), 'and never deleted');
});

test('a review record pins each verdict to the artwork it saw, and an unseen entry stays unchecked (#18)', () => {
  const recordDir = join(TMP, 'reviews');
  mkdirSync(recordDir, { recursive: true });
  const fresh = sheets.reviewStatus('file-types', { recordDir });
  assert(fresh.rows.length > 4 && fresh.unchecked.length === fresh.rows.length && fresh.ok.length === 0,
    'with no record, every entry is unchecked');

  const [a, b, c, d] = fresh.rows;
  writeFileSync(join(recordDir, 'file-types.json'), JSON.stringify({ entries: {
    [a.id]: { sha256: a.sha256, verdict: 'ok' },
    [b.id]: { sha256: '0'.repeat(64), verdict: 'ok' },
    [c.id]: { sha256: c.sha256, verdict: 'mismatch', note: 'wears another mark' },
    [d.id]: { sha256: d.sha256, verdict: 'looks fine' },
    'file-types/gone': { sha256: a.sha256, verdict: 'ok' },
  } }));
  const s = sheets.reviewStatus('file-types', { recordDir });
  eq(s.ok.join(), a.id, 'a row at the current hash counts');
  eq(s.stale.join(), b.id, 'a row for artwork that has changed since is stale, not ok');
  eq(s.mismatch.join(), c.id, 'a recorded mismatch stays visible');
  eq(s.unknown.join(), d.id, 'a verdict outside ok/mismatch is not taken as a pass');
  eq(s.orphaned.join(), 'file-types/gone', 'a row for an id that no longer ships is orphaned');
  eq(s.unchecked.length, s.rows.length - 4, 'everything else is unchecked');
});

test('review pages cover every entry, 54 to a page, and write only under review/ (#18)', () => {
  const sheetDir = join(TMP, 'contact-sheets-review');
  const recordDir = join(TMP, 'reviews-none');
  const calls = [];
  const pages = [];
  const shoot = (shot) => { pages.push(readFileSync(calls.at(-1).html, 'utf8')); writeFileSync(shot, PNG_BYTES); };
  const out = sheets.buildReview('azure', { sheetDir, recordDir, chrome: 'chrome', runner: fakeChrome(calls, shoot) });

  eq(out.pageCount, Math.ceil(out.status.rows.length / 54), 'pages of 54');
  eq(out.pages.map((p) => p.page).join(), Array.from({ length: out.pageCount }, (_, i) => i + 1).join(), 'every page is rendered');
  eq(pages.map((h) => h.split('<figure').length - 1).reduce((x, y) => x + y, 0), out.status.rows.length, 'every entry is on a page once');
  eq(out.pages.at(-1).last, out.status.rows.at(-1).index, 'the last page ends on the last entry');
  const first = out.status.rows[0];
  assert(pages[0].includes(first.id) && pages[0].includes(first.sha256.slice(0, 12)) && pages[0].includes('unchecked'),
    'a tile names its id, its hash and its review state');
  eq(readdirSync(sheetDir).join(), 'review', 'nothing is written beside the committed sheets');
  eq(readdirSync(join(sheetDir, 'review')).length, out.pageCount, 'one PNG per page');
  assert(calls.every((c) => !existsSync(dirname(c.profile))), 'every scratch profile is removed');

  const one = sheets.buildReview('azure', { page: 2, sheetDir, recordDir, chrome: 'chrome', runner: fakeChrome([], (shot) => writeFileSync(shot, PNG_BYTES)) });
  eq(one.pages.map((p) => `${p.page}:${p.first}`).join(), '2:54', '--page renders just that page');
  for (const page of [0, out.pageCount + 1, 1.5, Number.NaN]) {
    let error = null;
    try { sheets.buildReview('azure', { page, sheetDir, recordDir, chrome: 'chrome', runner: () => { throw new Error('Chrome must not run'); } }); } catch (e) { error = e; }
    assert(error && /there is no page/.test(error.message), `page ${page} is refused before anything renders`);
  }

  const htmlOnly = sheets.buildReview('azure', { page: 1, sheetDir: join(TMP, 'contact-sheets-review-html'), recordDir, chrome: null });
  assert(htmlOnly.pages[0].htmlPath && existsSync(htmlOnly.pages[0].htmlPath) && !htmlOnly.pages[0].pngPath, 'no Chrome falls back to the HTML page');
});

test('two Azure marks sharing a name and a folder are told apart by file number, and keep their old caption (#18)', () => {
  const cat = JSON.parse(readFileSync(join(SKILL, 'references', 'icon-catalog.json'), 'utf8'));
  const row = (id) => cat.icons.find((i) => i.id === id);
  for (const [id, title, formerly, other] of [
    ['azure/workspaces-compute', 'Workspaces (00400)', 'workspaces compute', 'azure/workspaces'],
    ['azure/load-balancer-hub-networking', 'Load Balancer Hub (029029174)', 'load balancer hub networking', 'azure/load-balancer-hub'],
  ]) {
    const r = row(id);
    eq(r?.title, title, `${id} is captioned by Microsoft's file number`);
    assert(r.aliases.includes(formerly), `${id} still answers to "${formerly}"`);
    assert(row(other) && row(other).sha256 !== r.sha256, `${other} is a different mark`);
    eq(dirname(r.upstreamId), dirname(row(other).upstreamId), `${id} and ${other} come from the same folder`);
  }
  eq(row('azure/multifactor-authentication-security')?.title, 'Multifactor Authentication (Security)',
    'a pair from different folders keeps its folder as the suffix');
});

test('Azure captions Microsoft misspelled or ran together are corrected, and the upstream spelling still resolves (#18)', () => {
  const cat = JSON.parse(readFileSync(join(SKILL, 'references', 'icon-catalog.json'), 'utf8'));
  const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [id, title, upstream] of [
    ['azure/promethus', 'Azure Monitor Managed Service for Prometheus', 'Promethus'],
    ['azure/entra-privleged-identity-management', 'Entra Privileged Identity Management', 'Entra Privleged Identity Management'],
    ['azure/defender-programable-board', 'Defender Programmable Board', 'Defender Programable Board'],
    ['azure/azure-a', 'Azure', 'Azure a'],
    ['azure/azureattestation', 'Azure Attestation', 'AzureAttestation'],
    ['azure/extendedsecurityupdates', 'Extended Security Updates', 'ExtendedSecurityUpdates'],
    ['azure/machinesazurearc', 'Machines Azure Arc', 'MachinesAzureArc'],
    ['azure/vpnclientwindows', 'VPN Client Windows', 'VPNClientWindows'],
    ['azure/windows10-core-services', 'Windows 10 Core Services', 'Windows10 Core Services'],
    ['azure/web-application-firewall-policies-waf', 'Web Application Firewall Policies (WAF)', 'Web Application Firewall Policies(WAF)'],
  ]) {
    const r = cat.icons.find((i) => i.id === id);
    eq(r?.title, title, `${id} keeps its id and reads "${title}"`);
    assert(r.aliases.some((a) => squash(a) === squash(upstream)), `${id} still answers to Microsoft's "${upstream}"`);
  }
});

// A pack with a record is a reviewed pack: a new or changed mark cannot ship
// into it unreviewed. Every pack must have one, the catch-all included (#18, #73, #81, #72).
test('every shipped mark in every pack has been reviewed at the artwork that ships (#18, #72, #73, #81)', () => {
  const recordDir = join(SKILL, 'assets', 'libraries', 'reviews');
  const reviewed = readdirSync(recordDir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
  for (const { id } of finder.loadCatalog().packs) {
    assert(reviewed.includes(id), `${id} has no review record`);
  }
  for (const pack of reviewed) {
    const s = sheets.reviewStatus(pack);
    const open = [
      ...s.unchecked.map((id) => `${id}: unchecked`), ...s.stale.map((id) => `${id}: artwork changed since review`),
      ...s.mismatch.map((id) => `${id}: recorded mismatch`), ...s.unknown.map((id) => `${id}: unknown verdict`),
      ...s.orphaned.map((id) => `${id}: record row for an id that no longer ships`),
    ];
    assert(s.rows.length > 0 && s.ok.length === s.rows.length && open.length === 0,
      `${pack}: ${open.length} open (contact-sheet.mjs --pack ${pack} --review):\n        ${open.slice(0, 20).join('\n        ')}`);
  }
});

// Amazon's and Google's file names drop the punctuation their product names
// carry ("AWS X Ray", "Speech to Text"). The corrected caption resolves, the
// upstream spelling still does, and neither moves to another mark (#73).
test('AWS and Google Cloud captions their file names mangled are corrected, and the upstream spelling still resolves (#73)', () => {
  const cat = finder.loadCatalog();
  const title = (id) => cat.icons.find((i) => i.id === id)?.title;
  for (const [id, caption, upstream] of [
    ['aws/aws-x-ray', 'AWS X-Ray', 'aws x ray'], ['aws/aws-repost', 'AWS re:Post', 'aws repost'],
    ['aws/aws-site-to-site-vpn', 'AWS Site-to-Site VPN', 'aws site to site vpn'],
    ['aws/amazon-fsx-for-wfs', 'Amazon FSx for Windows File Server', 'fsx for wfs'],
    ['aws/aws-parallel-cluster', 'AWS ParallelCluster', 'aws parallel cluster'],
    ['gcp/identity-aware-proxy', 'Identity-Aware Proxy', 'identity aware proxy'],
    ['gcp/beyondcorp', 'BeyondCorp', 'beyondcorp'], ['gcp/speech-to-text', 'Speech-to-Text', 'speech to text'],
  ]) {
    eq(title(id), caption, id);
    for (const q of [caption, upstream]) {
      const r = finder.resolve(q);
      assert(r.confident && r.icon.id === id, `"${q}" should resolve to ${id}, got ${r.icon?.id} (${r.reason})`);
    }
  }
  // Oracle's own spelling now ranks Amazon's mark first rather than Azure's, but
  // "Oracle Database" scores too close behind for it to resolve on its own.
  eq(title('aws/oracle-database-at-aws'), 'Oracle Database@AWS', 'aws/oracle-database-at-aws');
  eq(finder.resolve('Oracle Database@AWS').icon?.id, 'aws/oracle-database-at-aws', 'Oracle Database@AWS ranks first');
  assert(finder.resolve('oracle database at aws').confident, 'the upstream spelling still resolves');
});

// ------------------------------------------------------------- generation

const SPEC = join(SKILL, 'assets', 'templates', 'starter-architecture.spec.json');
const OUT = join(TMP, 'generated.drawio');

// Agents read the committed example, and its PNG, before writing a spec, so a
// stale one teaches the wrong output. Draw.io output is deterministic, so the
// committed file must be exactly what its spec builds today (#50).
test('the committed Draw.io starter is exactly what its spec builds (#50)', () => {
  const committedPath = join(SKILL, 'assets', 'templates', 'starter-architecture.drawio');
  assert(existsSync(join(SKILL, 'assets', 'templates', 'starter-architecture.png')), 'a rendered PNG ships beside the example');
  const build = () => builder.buildDiagram(JSON.parse(readFileSync(SPEC, 'utf8'))).xml;
  const xml = build();
  eq(build(), xml, 'two builds of the same spec are identical');
  const committed = readFileSync(committedPath, 'utf8');
  if (xml === committed) return;
  const a = committed.split('\n');
  const b = xml.split('\n');
  let line = a.findIndex((l, i) => l !== b[i]);
  if (line === -1) line = Math.min(a.length, b.length);
  const cell = /<mxCell id="([^"]+)"/.exec(a[line] ?? b[line] ?? '')?.[1];
  const column = [...(a[line] ?? '')].findIndex((c, i) => c !== (b[line] ?? '')[i]) + 1;
  throw new Error(`starter-architecture.drawio is stale: line ${line + 1}${cell ? `, cell "${cell}"` : ''}, column ${column} differs from a fresh build. `
    + 'Rebuild it (node bin/arkitect.mjs drawio build skills/arkitect-drawio/assets/templates/starter-architecture.spec.json --out <tmp> --defaults), '
    + 'copy it over, and re-render starter-architecture.png in the same pull request.');
});

// ------------------------------------------------------------- per-install style (#89)

const OWN_STORE = join(process.env.ARKITECT_HOME, 'drawio');
const OVERRIDES = join(OWN_STORE, 'style-overrides.json');
const COMMITTED_STARTER = join(SKILL, 'assets', 'templates', 'starter-architecture.drawio');
const clearStore = () => rmSync(process.env.ARKITECT_HOME, { recursive: true, force: true });
const plantOverride = (value) => {
  mkdirSync(OWN_STORE, { recursive: true });
  writeFileSync(OVERRIDES, typeof value === 'string' ? value : JSON.stringify(value));
};
const buildCli = (...args) => spawnSync(process.execPath, [join(SCRIPTS, 'build-diagram.mjs'), ...args], { encoding: 'utf8' });
const toolCli = (script, ...args) => spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: 'utf8' });
const PERSONAL = {
  schemaVersion: 1,
  engine: 'drawio',
  tokens: { rounded: 1, noteFill: '#FFF4CC' },
  edgeKinds: {
    flow: { meaning: 'trigger' },
    query: { stroke: '#7A00CC', dashed: 0, width: 2, meaning: 'SQL query' },
  },
};

test('the style store lives outside the plugin, and ARKITECT_HOME moves it (#89)', () => {
  const env = { ...process.env };
  delete env.ARKITECT_HOME;
  const home = store.arkitectHome(env);
  eq(home, join(osHome, '.arkitect'), 'the default is <home>/.arkitect');
  // Outside means `..` - or, when the checkout and the home directory are on
  // different Windows drives (the checkout on D: and the home directory on C:,
  // as on a CI runner), an absolute path, which is what relative() returns
  // across drives.
  const fromPlugin = relative(ROOT, home);
  assert(fromPlugin.startsWith('..') || isAbsolute(fromPlugin), `the default store is not inside the plugin, so an update cannot wipe it (${fromPlugin})`);
  eq(store.arkitectHome({ ARKITECT_HOME: '' }), join(osHome, '.arkitect'), 'an empty ARKITECT_HOME counts as unset');
  eq(store.engineStore('drawio', { ARKITECT_HOME: TMP }), join(TMP, 'drawio'), 'ARKITECT_HOME replaces <home>/.arkitect');
  eq(styleTokens.overridesPath({ ARKITECT_HOME: TMP }), join(TMP, 'drawio', 'style-overrides.json'), 'the override sits in the drawio store');
  let threw = false;
  try { store.engineStore('visio'); } catch { threw = true; }
  assert(threw, 'an unknown engine is refused');
});

test('without an override every build is the shipped house style, byte for byte (#89)', () => {
  clearStore();
  const spec = JSON.parse(readFileSync(SPEC, 'utf8'));
  const committed = readFileSync(COMMITTED_STARTER, 'utf8');
  eq(builder.buildDiagram(spec, { style: styleTokens.resolveStyle() }).xml, committed, 'the house style handed over explicitly draws the committed example');
  const style = styleTokens.loadStyle();
  eq(style.source, 'defaults', 'an empty store means the house style');
  eq(JSON.stringify(style.tokens), JSON.stringify(builder.T), 'every token is the shipped one');
  eq(builder.buildDiagram(spec, { style }).xml, committed, 'and draws the committed example');
  const out = join(TMP, 'no-override.drawio');
  const r = buildCli(SPEC, '--out', out);
  eq(r.status, 0, `build: ${r.stderr}`);
  eq(r.stderr, '', 'no warning');
  eq(readFileSync(out, 'utf8'), committed, 'the CLI with no override draws the committed example');
  const report = JSON.parse(r.stdout);
  eq(report.style.source, 'defaults', 'the report says the house style drew it');
  eq(report.style.edgeKinds.flow, 'primary data or control flow', 'and names each kind by its meaning');
});

// A committed example is shared: it must build the same on a maintainer's
// machine with a personal override as on CI with none (#50). buildDiagram()
// never reads the store, and the CLI's --defaults skips it.
test('the committed starter builds exactly even with a personal override on the machine (#50, #89)', () => {
  clearStore();
  plantOverride(PERSONAL);
  const committed = readFileSync(COMMITTED_STARTER, 'utf8');
  eq(builder.buildDiagram(JSON.parse(readFileSync(SPEC, 'utf8'))).xml, committed, 'buildDiagram() ignores the store');
  const forced = join(TMP, 'forced-defaults.drawio');
  const r = buildCli(SPEC, '--out', forced, '--defaults');
  eq(r.status, 0, `--defaults build: ${r.stderr}`);
  eq(readFileSync(forced, 'utf8'), committed, '--defaults draws the committed example although an override is present');
  eq(JSON.parse(r.stdout).style.reason, '--defaults', 'and says why');
  const personal = join(TMP, 'personal.drawio');
  const p = buildCli(SPEC, '--out', personal);
  eq(p.status, 0, `personal build: ${p.stderr}`);
  assert(readFileSync(personal, 'utf8') !== committed, 'without --defaults the override is picked up automatically');
  eq(JSON.parse(p.stdout).style.source, 'override', 'and the report says so');
  clearStore();
});

test('an override restyles tokens and kinds, adds a kind, and never outranks the spec (#89)', () => {
  const style = styleTokens.resolveStyle({ ...PERSONAL, tokens: { ...PERSONAL.tokens, colPitch: 500 } });
  eq(style.source, 'override', 'a valid override applies');
  eq(style.overridden.join(','), 'tokens.rounded,tokens.noteFill,tokens.colPitch,edgeKinds.flow.meaning,edgeKinds.query',
    'overridden names every value it changed');
  const spec = {
    title: 'Styled', titleColor: '#123456', layout: { colPitch: 400 },
    boundaries: [{ id: 'zone', label: 'Zone', col: 0, row: 0, cols: 3 }],
    nodes: [
      { id: 'a', kind: 'box', label: 'A', col: 0, row: 0, parent: 'zone' },
      { id: 'b', kind: 'box', label: 'B', col: 1, row: 0, parent: 'zone' },
      { id: 'c', kind: 'box', label: 'C', col: 2, row: 0, parent: 'zone' },
      { id: 'n', kind: 'note', label: 'Note', col: 0, row: 1 },
    ],
    edges: [
      { from: 'a', to: 'b', kind: 'flow' },
      { from: 'b', to: 'c', kind: 'query' },
      { from: 'a', to: 'c', kind: 'error' },
    ],
  };
  const { xml, report } = builder.buildDiagram(spec, { style });
  eq(report.unknownKinds.length, 0, 'a kind the override adds is a known kind');
  eq(report.style.source, 'override', 'the report names the style');
  assert(xml.includes('<mxCell id="a" value="A" style="rounded=1;'), 'boxes take the rounded token');
  assert(xml.includes('<mxCell id="zone" value="Zone" style="rounded=1;'), 'scopes take the rounded token');
  assert(xml.includes('fillColor=#FFF4CC;'), 'notes take the note fill token');
  assert(xml.includes('value="trigger"'), 'the legend gives flow its overridden meaning');
  assert(xml.includes('value="SQL query"') && xml.includes('value="failure or exception path"'),
    'the new kind joins the legend, and error keeps its own meaning');
  assert(xml.includes('strokeColor=#7A00CC;strokeWidth=2;dashed=0;'), 'the new kind draws in its own stroke');
  assert(xml.includes('fontColor=#123456;'), 'a colour the spec sets still wins');
  const geometryOf = (x, id) => new RegExp(`<mxCell id="${id}" [^>]*><mxGeometry x="(-?\\d+)"`).exec(x)?.[1];
  const houseStyle = builder.buildDiagram(spec).xml;
  eq(geometryOf(xml, 'b'), geometryOf(houseStyle, 'b'), 'the spec layout pitch still wins over an overridden pitch');
});

// An override is named values only; a raw style string, or a value that would
// break a cell, is refused - and never echoed when it is a legend's free text.
// Icon choice is not a token, so no override can reach it (invariant 4).
test('an override is checked field by field, and a bad one is ignored whole (#89)', () => {
  const base = { schemaVersion: 1, engine: 'drawio' };
  const kind = { stroke: '#7A00CC', dashed: 0, width: 2, meaning: 'SQL query' };
  const cases = [
    [{ ...base, tokens: { rounded: 2 } }, 'tokens.rounded: expected 0 or 1'],
    [{ ...base, tokens: { text: 'red' } }, 'tokens.text: expected a #RRGGBB colour'],
    [{ ...base, tokens: { shadow: 1 } }, 'tokens.shadow: not a style token'],
    [{ ...base, tokens: { box: 'rounded=1;shadow=1' } }, 'tokens.box: not a style token'],
    [{ ...base, tokens: { icon: 'aws/amazon-s3' } }, 'tokens.icon: not a style token'],
    [{ ...base, tokens: { scopeDashPattern: '8 8;shadow=1' } }, 'tokens.scopeDashPattern: expected a dash pattern'],
    [{ ...base, tokens: { colPitch: 100 } }, 'tokens.colPitch: 100 leaves less than 40px'],
    [{ ...base, edgeKinds: { query: { stroke: '#CC0000' } } }, 'a new kind needs all of stroke, dashed, width and meaning'],
    [{ ...base, edgeKinds: { Query: kind } }, 'a kind name is lower-case'],
    [{ ...base, edgeKinds: { constructor: { meaning: 'x' } } }, 'edgeKinds.constructor: a new kind needs all'],
    [{ ...base, edgeKinds: { flow: { meaning: 'x'.repeat(61) } } }, 'edgeKinds.flow.meaning: expected one line of 1 to 60 characters'],
    [{ ...base, edgeKinds: { flow: { style: 'dashed=1' } } }, 'edgeKinds.flow.style: not an edge kind field'],
    [{ schemaVersion: 2, engine: 'drawio' }, 'schemaVersion: expected 1'],
    [{ schemaVersion: 1, engine: 'excalidraw' }, 'engine: expected "drawio"'],
    [{ ...base, extra: true }, 'extra: not a field an override carries'],
    [[], 'expected a JSON object'],
  ];
  for (const [raw, expected] of cases) {
    const errors = styleTokens.validateOverrides(raw);
    assert(errors.some((e) => e.includes(expected)), `expected "${expected}", got: ${errors.join('; ')}`);
    const resolved = styleTokens.resolveStyle(raw);
    assert(resolved.source === 'defaults' && resolved.errors.length && resolved.overridden.length === 0,
      `a bad override is ignored whole: ${expected}`);
    eq(JSON.stringify(resolved.tokens), JSON.stringify(builder.T), `and every token is the house style's: ${expected}`);
    assert(!errors.some((e) => e.includes('xxxxxxxxxx')), 'a legend meaning is never echoed');
  }
  eq(styleTokens.validateOverrides({ ...base, tokens: { ...builder.T }, edgeKinds: { query: kind } }).length, 0,
    'every shipped value, and a whole new kind, is itself a valid override');
});

test('a broken override warns once, and the build draws the house style (#89)', () => {
  for (const [label, content] of [
    ['bad JSON', '{"schemaVersion":1,'],
    ['bad value', JSON.stringify({ schemaVersion: 1, engine: 'drawio', tokens: { rounded: 5 } })],
  ]) {
    clearStore();
    plantOverride(content);
    const out = join(TMP, `broken-override-${label.replace(' ', '-')}.drawio`);
    const r = buildCli(SPEC, '--out', out);
    eq(r.status, 0, `${label}: the build still succeeds (${r.stderr})`);
    eq(r.stderr.trim().split('\n').length, 1, `${label}: one warning line`);
    assert(r.stderr.startsWith('warning: ignoring'), `${label}: the warning says what was ignored`);
    const report = JSON.parse(r.stdout);
    eq(report.style.source, 'defaults', `${label}: the house style drew it`);
    assert(report.style.errors.length > 0, `${label}: the report lists the problems`);
    eq(readFileSync(out, 'utf8'), readFileSync(COMMITTED_STARTER, 'utf8'), `${label}: exactly the house-style output`);
  }
  clearStore();
});

test('--print-style shows the style a build would use, and writes nothing (#89)', () => {
  clearStore();
  plantOverride(`﻿${JSON.stringify(PERSONAL)}`);
  const r = buildCli('--print-style');
  eq(r.status, 0, `--print-style: ${r.stderr}`);
  const shown = JSON.parse(r.stdout);
  eq(shown.store, OWN_STORE, 'it names the store');
  eq(shown.source, 'override', 'a byte-order mark does not make the override unreadable');
  eq(shown.edgeKinds.query.meaning, 'SQL query', 'every active kind, in full');
  eq(shown.edgeKinds.error.meaning, 'failure or exception path', 'shipped kinds included');
  eq(shown.tokens.rounded, 1, 'every token');
  eq(JSON.parse(buildCli('--print-style', '--defaults').stdout).source, 'defaults', '--defaults shows the house style');
  const stray = join(TMP, 'print-style-stray.drawio');
  for (const bad of [[SPEC, '--print-style'], ['--print-style', '--out', stray]]) {
    eq(buildCli(...bad).status, 2, `${bad.join(' ')} is a usage error`);
  }
  assert(!existsSync(stray), 'nothing was written');
  clearStore();
});

test('learning writes your record to the store, and elsewhere only by --out (#89)', () => {
  clearStore();
  const shipped = join(SKILL, 'references', 'source-analysis.json');
  const before = readFileSync(shipped);
  const r = toolCli('build-knowledge.mjs', '--sources', COMMITTED_STARTER);
  eq(r.status, 0, `learn: ${r.stderr}`);
  const record = JSON.parse(readFileSync(join(OWN_STORE, 'source-analysis.json'), 'utf8'));
  assert(Array.isArray(record.tokens.rounded) && record.tokens.rounded[0].value === '0', 'the record tallies corner rounding');
  eq(JSON.parse(readFileSync(join(OWN_STORE, 'sources.json'), 'utf8')).files[0], COMMITTED_STARTER, 'the designated paths stay beside it, in the store');
  assert(before.equals(readFileSync(shipped)), 'the shipped record is untouched');
  const elsewhere = join(TMP, 'maintainer', 'record.json');
  eq(toolCli('build-knowledge.mjs', '--sources', COMMITTED_STARTER, '--out', elsewhere).status, 0, '--out builds a record elsewhere');
  assert(existsSync(elsewhere) && !existsSync(join(TMP, 'maintainer', 'sources.json')), '--out writes the record where it is told, and no paths beside it');
  clearStore();
});

// `learn --sources x --help` used to ignore the --help, do the learn, and
// replace a record the caller only meant to read the usage for (#151).
test('learning checks its arguments before it reads or writes anything (#151)', () => {
  clearStore();
  mkdirSync(OWN_STORE, { recursive: true });
  const record = join(OWN_STORE, 'source-analysis.json');
  const sources = join(OWN_STORE, 'sources.json');
  const sentinel = () => {
    writeFileSync(record, 'SENTINEL-RECORD');
    writeFileSync(sources, 'SENTINEL-SOURCES');
  };
  const untouched = (what) => {
    eq(readFileSync(record, 'utf8'), 'SENTINEL-RECORD', `${what}: the record is untouched`);
    eq(readFileSync(sources, 'utf8'), 'SENTINEL-SOURCES', `${what}: the source list is untouched`);
  };

  for (const args of [
    ['--sources', COMMITTED_STARTER, '--help'],
    ['--help', '--sources', COMMITTED_STARTER],
    ['--sources', COMMITTED_STARTER, '--merge', '-h'],
  ]) {
    sentinel();
    const r = toolCli('build-knowledge.mjs', ...args);
    eq(r.status, 0, `${args.join(' ')} exits 0`);
    assert(r.stdout.includes('usage: build-knowledge.mjs'), `${args.join(' ')} prints the usage`);
    assert(!r.stdout.includes('source-analysis v'), `${args.join(' ')} does not learn`);
    untouched(args.join(' '));
  }

  for (const [args, said] of [
    [['--sources', COMMITTED_STARTER, '--nope'], 'unknown option --nope'],
    [['--sources', COMMITTED_STARTER, '--out'], '--out needs a value'],
    [['--sources', COMMITTED_STARTER, '--out', 'a', '--out', 'b'], '--out given more than once'],
    [['--sources', '--merge'], '--sources needs at least one value'],
    [['--merge'], '--sources needs at least one file'],
    [['stray.drawio', '--sources', COMMITTED_STARTER], 'unexpected argument stray.drawio'],
    [['--sources', join(TMP, 'not-here.drawio')], 'no such file'],
  ]) {
    sentinel();
    const r = toolCli('build-knowledge.mjs', ...args);
    eq(r.status, 2, `${args.join(' ')} is a usage error`);
    assert(r.stderr.includes(said), `${args.join(' ')} says "${said}", got "${r.stderr.trim()}"`);
    untouched(args.join(' '));
  }

  // The commands that are supposed to work still do.
  clearStore();
  eq(toolCli('build-knowledge.mjs', '--sources', COMMITTED_STARTER).status, 0, 'a plain learn still works');
  eq(toolCli('build-knowledge.mjs', '--sources', COMMITTED_STARTER, '--merge').status, 0, 'and --merge still works');
  eq(JSON.parse(readFileSync(join(OWN_STORE, 'source-analysis.json'), 'utf8')).version, 2, 'the merge counted as a second version');
  clearStore();
});

test('findings: --derive reads four tokens, --add is checked, and an agent finding holds its target (#89)', () => {
  const record = {
    version: 3,
    conventions: [{ id: 'type-scale', evidence: { total: 155 } }],
    tokens: {
      fontSize: [{ value: '14', count: 120 }, { value: '18', count: 30 }, { value: '12', count: 5 }],
      fontColor: [{ value: '#ffffff', count: 30 }, { value: '#232f3e', count: 3 }],
      rounded: [{ value: '0', count: 200 }, { value: '1', count: 10 }],
    },
  };
  const { derived, skipped } = findingsTool.deriveFindings(record);
  const at = (target) => derived.find((f) => f.target === target);
  eq(at('tokens.fontBody').observed, 14, 'body size is the commonest size');
  eq(at('tokens.fontBody').confidence, 'high', 'graded like a convention: 120 of 155');
  eq(at('tokens.fontHeading').observed, 18, 'heading is the next size up');
  eq(at('tokens.fontHeading').confidence, 'medium', 'weighed against the sizes that are not body text: 30 of 35');
  eq(at('tokens.text').observed, '#232F3E', 'a colour differing only in case is the shipped colour');
  eq(at('tokens.text').confidence, 'low', 'three sightings are a hint');
  eq(at('tokens.rounded').observed, 0, 'square corners');
  eq(skipped.length, 0, 'nothing skipped');
  eq(findingsTool.deriveFindings({ tokens: { fontSize: record.tokens.fontSize } }).skipped.map((s) => s.target).join(','),
    'tokens.text,tokens.rounded', 'a record without those tallies is named, not guessed');

  let file = findingsTool.mergeDerived(findingsTool.readFindings(join(TMP, 'no-such-findings.json')), record).file;
  eq(file.findings.length, 4, 'four record-based findings');
  const bad = findingsTool.addFinding(file, { target: 'edgeKinds.query', observed: { stroke: 'red' }, evidence: 0, confidence: 'sure' });
  eq(bad.added.length, 0, 'a bad finding adds nothing');
  for (const expected of ['edgeKinds.query.stroke', 'a new kind needs', '--evidence', '--confidence']) {
    assert(bad.errors.some((e) => e.includes(expected)), `a bad finding names ${expected}: ${bad.errors.join('; ')}`);
  }
  for (const [target, observed] of [
    ['tokens.box', 'rounded=1;shadow=1'], ['icons.snowflake', 'aws/amazon-s3'],
    ['edgeKinds.query.meaning', 'SQL query'], ['edgeKinds.flow', 'trigger'],
  ]) {
    eq(findingsTool.addFinding(file, { target, observed, evidence: 2, confidence: 'low' }).added.length, 0, `${target} is refused`);
  }
  const split = findingsTool.addFinding(file, {
    target: 'edgeKinds.async', observed: { meaning: 'file transfer', width: 3 }, evidence: 4, confidence: 'medium', note: 'legend on 4 of 5',
  });
  eq(split.added.map((f) => f.target).join(','), 'edgeKinds.async.meaning,edgeKinds.async.width', 'a whole shipped kind splits into one finding per field');
  file = findingsTool.addFinding(split.file, { target: 'tokens.fontBody', observed: 12, evidence: 2, confidence: 'low' }).file;
  const again = findingsTool.mergeDerived(file, record);
  eq(again.heldByAgent.join(','), 'tokens.fontBody', 'a later --derive leaves a target the agent holds');
  eq(again.file.findings.filter((f) => f.target === 'tokens.fontBody').length, 1, 'one entry per target');
  eq(findingsTool.removeFinding(again.file, 'edgeKinds.async').removed.length, 2, 'removing a kind removes its fields');
});

test('apply: --list offers only contradictions, --accept says what changed, --reset undoes it (#89)', () => {
  clearStore();
  mkdirSync(OWN_STORE, { recursive: true });
  writeFileSync(join(OWN_STORE, 'source-analysis.json'), JSON.stringify({
    version: 1,
    tokens: {
      fontSize: [{ value: '12', count: 90 }, { value: '16', count: 40 }],
      fontColor: [{ value: '#232F3E', count: 80 }],
      rounded: [{ value: '1', count: 9 }, { value: '0', count: 1 }],
    },
  }));
  const json = (r, what) => { eq(r.status, 0, `${what}: ${r.stderr}`); return JSON.parse(r.stdout); };
  const newKind = { stroke: '#7A00CC', dashed: 0, width: 2, meaning: 'SQL query' };
  json(toolCli('style-findings.mjs', '--derive'), 'derive');
  json(toolCli('style-findings.mjs', '--add', 'edgeKinds.flow.meaning', '--observed', 'trigger', '--evidence', '4', '--confidence', 'medium'), 'add a meaning');
  json(toolCli('style-findings.mjs', '--add', 'edgeKinds.query', '--observed', JSON.stringify(newKind), '--evidence', '3', '--confidence', 'medium'), 'add a kind');
  eq(toolCli('style-findings.mjs', '--add', 'tokens.rounded', '--observed', 'yes', '--evidence', '1', '--confidence', 'low').status, 1,
    'a value a build would refuse is refused as a finding');

  const listed = json(toolCli('apply-style.mjs', '--list'), 'list');
  eq(listed.candidates.map((c) => c.id).join(','), 'edgeKinds.flow.meaning,edgeKinds.query,tokens.rounded', 'only the contradictions, strongest first');
  assert(['tokens.fontBody', 'tokens.fontHeading', 'tokens.text'].every((t) => listed.alreadyInEffect.includes(t)),
    'findings that match what is drawn are not offered');
  const rounded = listed.candidates.find((c) => c.id === 'tokens.rounded');
  assert(rounded.lowConfidence && rounded.shipped === 0 && rounded.current === 0 && rounded.proposed === 1,
    'a low-confidence candidate is still offered, flagged, with shipped, current and proposed');

  eq(toolCli('apply-style.mjs', '--accept', 'tokens.fontBody').status, 2, 'accepting what is not a candidate exits 2');
  assert(!existsSync(OVERRIDES), 'and writes nothing');

  const accepted = json(toolCli('apply-style.mjs', '--accept', 'edgeKinds.query,tokens.rounded'), 'accept');
  eq(JSON.stringify(accepted.changed), JSON.stringify([
    { target: 'edgeKinds.query', from: null, fromSource: 'house style', to: newKind },
    { target: 'tokens.rounded', from: 0, fromSource: 'house style', to: 1 },
  ]), 'it reports each change against what was in effect');
  const written = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
  eq(Object.keys(written).join(','), 'schemaVersion,engine,updated,tokens,edgeKinds', 'the override carries named tokens and kinds only');
  eq(styleTokens.validateOverrides(written).length, 0, 'and is valid');

  const second = json(toolCli('apply-style.mjs', '--accept', 'edgeKinds.flow.meaning'), 'accept on top');
  eq(second.overridden.join(','), 'tokens.rounded,edgeKinds.query,edgeKinds.flow.meaning', 'a later accept keeps what was accepted before');
  eq(json(toolCli('apply-style.mjs', '--list'), 'list after').candidates.length, 0, 'nothing accepted is offered again');
  eq(json(buildCli('--print-style'), 'print-style').edgeKinds.flow.meaning, 'trigger', 'the next build draws what was accepted');

  writeFileSync(OVERRIDES, '{');
  eq(toolCli('apply-style.mjs', '--accept', 'tokens.rounded').status, 1, 'a broken override is never quietly replaced');
  eq(json(toolCli('apply-style.mjs', '--reset'), 'reset').removed, OVERRIDES, '--reset removes the override');
  eq(json(buildCli('--print-style'), 'print-style after reset').source, 'defaults', 'and the house style is back');
  clearStore();
});

test('apply drops whatever equals the house style, so an override says only where you differ (#89)', () => {
  const next = applyTool.applyAccepted(
    { schemaVersion: 1, engine: 'drawio', tokens: { rounded: 1, flow: '#333333' }, edgeKinds: { flow: { meaning: 'trigger' } } },
    [
      { id: 'tokens.rounded', proposed: 0 },
      { id: 'edgeKinds.flow.meaning', proposed: 'primary data or control flow' },
      { id: 'edgeKinds.async.stroke', proposed: '#333333' },
    ],
  );
  eq(JSON.stringify(next), JSON.stringify({ schemaVersion: 1, engine: 'drawio', tokens: { flow: '#333333' } }),
    'values back at the house style drop out, a kind colour that follows its token included');
});

test('corner rounding and the other style literals go through named tokens (#89)', () => {
  const src = readFileSync(join(SCRIPTS, 'build-diagram.mjs'), 'utf8');
  for (const literal of ['rounded=0', 'rounded=1', 'fontSize=11', '#F7F7F7', '#DFDFDF', '#333333', 'strokeWidth=3', 'dashPattern=8 8']) {
    assert(!src.includes(literal), `build-diagram.mjs still hard-codes ${literal}`);
  }
  const t = builder.T;
  eq([t.rounded, t.edgeRounded, t.fontEdgeLabel, t.noteFill, t.noteStroke, t.noteText, t.scopeStrokeWidth, t.scopeDashPattern].join('|'),
    '0|0|11|#F7F7F7|#DFDFDF|#333333|3|8 8', 'each token defaults to the literal it replaced');
});

// An edge attached to the bottom of an icon ran through the caption hanging
// there (#45). Vertical edges now attach below the caption, and the validator
// warns when a route crosses one.
test('vertical edges attach below icon captions, and the validator names a crossing (#45)', () => {
  const spec = {
    context: { packs: ['aws'] },
    nodes: [
      { id: 'top', kind: 'icon', icon: 'lambda', label: 'Top function', col: 0, row: 0 },
      { id: 'bottom', kind: 'icon', icon: 'simple storage service', label: 'Bottom bucket', col: 0, row: 1 },
      { id: 'side', kind: 'icon', icon: 'opensearch', label: 'Side index', col: 1, row: 0 },
      { id: 'upper', kind: 'icon', icon: 'eventbridge', label: 'Upper bus', col: 2, row: 0 },
      { id: 'lower', kind: 'box', label: 'Lower box', col: 2, row: 1 },
      { id: 'b1', kind: 'box', label: 'Box one', col: 3, row: 0 },
      { id: 'b2', kind: 'box', label: 'Box two', col: 3, row: 1 },
    ],
    edges: [
      { id: 'down', from: 'top', to: 'bottom' },
      { id: 'up', from: 'lower', to: 'upper' },
      { id: 'across', from: 'top', to: 'side' },
      { id: 'diagonal', from: 'bottom', to: 'side' },
      { id: 'boxes', from: 'b1', to: 'b2' },
    ],
  };
  const { xml } = builder.buildDiagram(spec);
  const out = join(TMP, 'captions.drawio');
  writeFileSync(out, xml);
  const cells = core.extractCells(core.readMxfile(out).pages[0].xml);
  const style = (id) => core.parseStyle(cells.find((c) => c.id === id).style);
  const at = (s, end) => JSON.stringify([s[`${end}X`], s[`${end}Y`], s[`${end}Dx`], s[`${end}Dy`], s[`${end}Perimeter`]]);
  eq(at(style('down'), 'exit'), JSON.stringify(['0.5', '1', '0', '34', '0']), 'an edge leaving an icon downward starts below its caption');
  eq(style('down').entryY, undefined, 'and enters the node below from the top as before');
  eq(at(style('up'), 'entry'), JSON.stringify(['0.5', '1', '0', '34', '0']), 'an edge entering an icon from below ends below its caption');
  eq(style('up').exitY, undefined, 'a box has no caption to avoid');
  for (const id of ['across', 'diagonal', 'boxes']) {
    assert(style(id).exitY === undefined && style(id).entryY === undefined, `${id} is left to the router`);
  }
  const r = validator.validateFile(out);
  assert(r.ok, `validation errors: ${r.errors.join('; ')}`);
  eq(r.warnings.filter((w) => w.includes('caption')).join('; '), '', 'no route crosses a caption');
  eq(r.info.pages[0].captionCrossings, 0, 'no crossing counted');

  // The same diagram attached the old way: exactly the two vertical edges cross.
  const old = join(TMP, 'captions-old.drawio');
  writeFileSync(old, xml.replace(/(?:exit|entry)(?:X|Y|Dx|Dy|Perimeter)=[^;"]*;/g, ''));
  const before = validator.validateFile(old);
  eq(JSON.stringify(before.warnings.filter((w) => w.includes('caption')).sort()), JSON.stringify([
    'page 0: edge "down" runs through the caption of "top"',
    'page 0: edge "up" runs through the caption of "upper"',
  ]), 'the validator names each crossing edge and the icon whose caption it crosses');
  eq(before.info.pages[0].captionCrossings, 2, 'and counts them');

  // A caption on three lines gets room for three lines.
  const tall = builder.buildDiagram({ ...spec, nodes: spec.nodes.map((n) => (n.id === 'top' ? { ...n, label: 'Top\nfunction\nwith notes' } : n)) }).xml;
  assert(/id="down" style="[^"]*exitDy=49;/.test(tall), 'a three-line caption pushes the attachment to 49px');
});

test('the committed Draw.io starter has no edge through a caption (#45)', () => {
  const r = validator.validateFile(join(SKILL, 'assets', 'templates', 'starter-architecture.drawio'));
  assert(r.ok, `validation errors: ${r.errors.join('; ')}`);
  eq(r.warnings.filter((w) => w.includes('caption')).join('; '), '', 'caption crossings in the worked example');
});

test('a generated diagram is valid, connected and portable', () => {
  const spec = JSON.parse(readFileSync(SPEC, 'utf8'));
  const { xml, report } = builder.buildDiagram(spec);
  writeFileSync(OUT, xml);
  eq(report.missing.length, 0, `icons missing from the library: ${JSON.stringify(report.missing)}`);

  const r = validator.validateFile(OUT);
  assert(r.ok, `validation errors: ${r.errors.join('; ')}`);
  const page = r.info.pages[0];
  assert(page.embeddedImages >= 5, `expected embedded icons, got ${page.embeddedImages}`);
  eq(page.externalImages, 0, 'external image references');
  eq(page.danglingEdges, 0, 'dangling edges');
  eq(page.overlaps, 0, 'overlapping cells');
  assert(page.edges >= spec.edges.length, 'edges present');
});

test('generated XML is native draw.io, not an image or Mermaid', () => {
  const xml = readFileSync(OUT, 'utf8');
  assert(xml.startsWith('<mxfile'), 'not an mxfile');
  assert(xml.includes('<mxGraphModel'), 'no graph model');
  assert(xml.includes('vertex="1"') && xml.includes('edge="1"'), 'no native cells');
  assert(!xml.includes('```'), 'contains markdown fencing');
});

test('every cell id is unique and every parent exists', () => {
  const mx = core.readMxfile(OUT);
  const cells = core.extractCells(mx.pages[0].xml);
  const ids = cells.map((c) => c.id);
  eq(new Set(ids).size, ids.length, 'unique ids');
  const idSet = new Set(ids);
  for (const c of cells) {
    if (c.id === '0') continue;
    assert(idSet.has(c.parent), `cell ${c.id} references missing parent ${c.parent}`);
  }
});

test('every edge connects two existing cells', () => {
  const mx = core.readMxfile(OUT);
  const cells = core.extractCells(mx.pages[0].xml);
  const idSet = new Set(cells.map((c) => c.id));
  const edges = cells.filter((c) => c.edge);
  assert(edges.length > 0, 'no edges');
  for (const e of edges) {
    assert(e.source && idSet.has(e.source), `edge ${e.id} has a bad source`);
    assert(e.target && idSet.has(e.target), `edge ${e.id} has a bad target`);
  }
});

test('generated styles carry the learned tokens', () => {
  const mx = core.readMxfile(OUT);
  const cells = core.extractCells(mx.pages[0].xml);
  const icons = cells.filter((c) => /(^|;)image=data:/.test(c.style));
  assert(icons.length >= 5, 'icon cells');
  for (const c of icons) {
    const s = core.parseStyle(c.style);
    eq(s.verticalLabelPosition, 'bottom', 'caption below icon');
    eq(s.verticalAlign, 'top', 'caption alignment');
    eq(s.fontSize, '12', 'body type size');
    eq(s.fontColor, '#232F3E', 'squid-ink text');
  }
  for (const c of cells.filter((k) => k.edge)) {
    const s = core.parseStyle(c.style);
    eq(s.edgeStyle, 'orthogonalEdgeStyle', 'orthogonal routing');
    eq(s.rounded, '0', 'square corners');
  }
});

test('updating an existing file writes a timestamped backup first', () => {
  const target = join(TMP, 'update-me.drawio');
  writeFileSync(target, '<mxfile><diagram name="x" id="x"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>');
  const before = readFileSync(target, 'utf8');
  const backup = builder.backupExisting(target);
  assert(backup && existsSync(backup), 'no backup written');
  eq(readFileSync(backup, 'utf8'), before, 'backup content differs from the original');
  assert(/backup-\d{8}-\d{6}/.test(backup), `backup name is not timestamped: ${backup}`);
  writeFileSync(target, '<mxfile></mxfile>');
  eq(readFileSync(backup, 'utf8'), before, 'backup was clobbered by the update');
});

test('rapid updates in the same second never overwrite an earlier backup (#35)', () => {
  const dir = join(TMP, 'rapid-backups');
  mkdirSync(dir, { recursive: true });
  const target = join(dir, 'rapid.drawio');
  const now = new Date('2026-09-13T10:15:00.000Z');
  // Someone else's backup already holds the first name for this second.
  const taken = join(dir, 'rapid.backup-20260913-101500.drawio');
  writeFileSync(taken, 'pre-existing');
  const versions = ['original', 'first revision', 'second revision'];
  const backups = versions.map((v) => { writeFileSync(target, v); return builder.backupExisting(target, { now }); });
  eq(new Set(backups).size, versions.length, 'every call wrote its own backup');
  eq(readFileSync(taken, 'utf8'), 'pre-existing', 'a pre-existing backup was overwritten');
  versions.forEach((v, i) => eq(readFileSync(backups[i], 'utf8'), v, `backup ${i} lost its version`));
  assert(backups[0].endsWith('rapid.backup-20260913-101500-1.drawio'), `unexpected collision name: ${backups[0]}`);
  assert(backups[2].endsWith('rapid.backup-20260913-101500-3.drawio'), `unexpected collision name: ${backups[2]}`);
});

test('retention keeps the oldest backup and the newest five, and touches nothing else (#49)', () => {
  const dir = join(TMP, 'retention');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const target = join(dir, 'arch.drawio');
  // Not backups of this target: a hand-named copy, another diagram's, the other
  // engine's extension, a lookalike stem, a counter the builder never writes.
  const foreign = ['arch.backup-old.drawio', 'other.backup-20260913-101500.drawio', 'arch.backup-20260913-101500.excalidraw',
    'arch.v2.backup-20260913-101500.drawio', 'arch.backup-20260913-101500-0.drawio'];
  for (const f of foreign) writeFileSync(join(dir, f), 'not ours');
  const now = new Date('2026-09-13T10:15:00.000Z');
  const made = [];
  for (let i = 0; i < 12; i++) {
    writeFileSync(target, `version ${i}`);
    made.push(builder.backupExisting(target, { now }));
    builder.pruneBackups(target);
  }
  eq(new Set(made).size, made.length, 'a counter freed by pruning is never reused, so the newest backup is never pruned');
  const ours = () => readdirSync(dir).filter((f) => f !== 'arch.drawio' && !foreign.includes(f)).sort();
  eq(JSON.stringify(ours()), JSON.stringify([made[0], ...made.slice(7)].map((p) => basename(p)).sort()),
    'the oldest and the newest five, with -10 and -11 counted as newer than -2');
  eq(readFileSync(made[0], 'utf8'), 'version 0', 'the oldest backup still holds the first version');
  for (const f of foreign) eq(readFileSync(join(dir, f), 'utf8'), 'not ours', `${f} was touched`);

  builder.backupExisting(target, { now: new Date('2026-09-13T10:15:01.000Z') });
  eq(JSON.stringify(builder.pruneBackups(target).map((p) => basename(p))), JSON.stringify([basename(made[7])]),
    'a later second is newer than every counter of an earlier one');
  eq(JSON.stringify(builder.pruneBackups(target, { keep: 1 }).map((p) => basename(p))),
    JSON.stringify(made.slice(8).map((p) => basename(p))), 'keep 1 leaves the oldest and the newest');
  builder.backupExisting(target, { now });
  eq(builder.pruneBackups(target, { keep: 0 }).length, 0, 'keep 0 deletes nothing');
  for (const bad of [-1, 1.5, NaN, '5']) {
    let threw = false;
    try { builder.pruneBackups(target, { keep: bad }); } catch { threw = true; }
    assert(threw, `keep ${JSON.stringify(bad)} was accepted`);
  }
  eq(builder.pruneBackups(join(dir, 'no-such-dir', 'arch.drawio')).length, 0, 'a missing directory prunes nothing');
});

test('build prunes old backups only after writing, and --keep-backups sets how many (#49)', () => {
  const dir = join(TMP, 'retention-cli');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'arch.drawio');
  const specPath = join(dir, 'spec.json');
  writeFileSync(specPath, JSON.stringify({ nodes: [{ id: 'a', kind: 'box', label: 'A', col: 0, row: 0 }] }));
  const build = (...extra) => spawnSync(process.execPath, [join(SCRIPTS, 'build-diagram.mjs'), specPath, '--out', out, ...extra], { encoding: 'utf8' });
  const backupsOf = () => readdirSync(dir).filter((f) => f.startsWith('arch.backup-'));
  let report;
  for (let i = 0; i < 8; i++) {
    const r = build();
    eq(r.status, 0, `build ${i}: ${r.stderr}`);
    report = JSON.parse(r.stdout);
  }
  eq(backupsOf().length, 6, 'seven rebuilds leave the oldest backup and the newest five');
  eq(report.pruned.length, 1, 'the last build reports the backup it pruned');
  assert(!existsSync(report.pruned[0]) && existsSync(report.backup), 'the pruned backup is gone and the new one stays');
  const two = JSON.parse(build('--keep-backups', '2').stdout);
  eq(two.pruned.length, 4, '--keep-backups 2 reports the four it removed');
  eq(backupsOf().length, 3, 'and leaves the oldest and the newest two');
  eq(JSON.parse(build('--keep-backups', '0').stdout).pruned.length, 0, '--keep-backups 0 removes nothing');
  eq(backupsOf().length, 4, 'and keeps the new backup');
  for (const bad of [['--keep-backups', '-1'], ['--keep-backups', 'two'], ['--keep-backups', '1.5'], ['--keep-backups']]) {
    eq(build(...bad).status, 2, `${bad.join(' ')} exits 2`);
  }
  eq(backupsOf().length, 4, 'a refused flag writes no backup and deletes none');
});

test('the validator rejects a broken diagram', () => {
  const bad = join(TMP, 'broken.drawio');
  writeFileSync(bad, '<mxfile><diagram name="b" id="b"><mxGraphModel><root>'
    + '<mxCell id="0"/><mxCell id="1" parent="0"/>'
    + '<mxCell id="a" vertex="1" parent="1"><mxGeometry x="0" y="0" width="10" height="10" as="geometry"/></mxCell>'
    + '<mxCell id="a" vertex="1" parent="ghost"><mxGeometry x="0" y="0" width="10" height="10" as="geometry"/></mxCell>'
    + '<mxCell id="e" edge="1" parent="1" source="a" target="nope"><mxGeometry relative="1" as="geometry"/></mxCell>'
    + '</root></mxGraphModel></diagram></mxfile>');
  const r = validator.validateFile(bad);
  assert(!r.ok, 'broken file passed validation');
  assert(r.errors.some((e) => e.includes('duplicate cell id')), 'duplicate id not caught');
  assert(r.errors.some((e) => e.includes('missing parent')), 'missing parent not caught');
  assert(r.errors.some((e) => e.includes('does not exist')), 'bad edge target not caught');
});

// ------------------------------------------------------------- command lines (#37)

const ARGS_STARTER = join(SKILL, 'assets', 'templates', 'starter-architecture.drawio');
const drawioCli = (...args) => spawnSync(process.execPath, [join(ROOT, 'bin', 'arkitect.mjs'), 'drawio', ...args], { encoding: 'utf8' });
const stderrLine = (r) => r.stderr.trim().split('\n')[0];
const hasStack = (r) => /\n\s+at /.test(r.stderr);

test('validate --page N validates that page and never reads N as a file (#37)', () => {
  const r = drawioCli('validate', ARGS_STARTER, '--page', '0', '--json');
  eq(r.status, 0, `--page 0 --json status (stderr: ${stderrLine(r)})`);
  const body = JSON.parse(r.stdout);
  assert(body.ok && body.info.pages.length === 1 && body.info.pages[0].index === 0, 'page 0 was the page validated');

  const flagFirst = drawioCli('validate', '--page', '0', ARGS_STARTER, ARGS_STARTER);
  eq(flagFirst.status, 0, `flag before two files (stderr: ${stderrLine(flagFirst)})`);
  eq(flagFirst.stdout.split('PASS').length - 1, 2, 'both files validated');

  const unnamed = join(TMP, 'unnamed-page.drawio');
  writeFileSync(unnamed, '<mxfile><diagram id="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>');
  eq(drawioCli('validate', unnamed, '--page', '0').status, 0, 'a warning alone passes');
  eq(drawioCli('validate', unnamed, '--strict', '--page', '0').status, 1, '--strict still fails on a warning');

  const range = drawioCli('validate', ARGS_STARTER, '--page', '1');
  eq(range.status, 1, 'a page the file lacks fails');
  assert(range.stdout.includes('FAIL') && range.stdout.includes('page 1 is out of range'), 'says which page is missing');

  for (const bad of [['--page'], ['--page', '-1'], ['--page', '1.5'], ['--page', 'abc'], ['--page', ''], ['--page', '1e3'],
    ['--page', '--json'], ['--page', '0', '--page', '0'], ['--stirct']]) {
    const u = drawioCli('validate', ARGS_STARTER, ...bad);
    eq(u.status, 2, `${bad.join(' ')}: usage status`);
    assert(/non-negative integer|needs a value|more than once|unknown option/.test(u.stderr) && u.stderr.includes('usage:'), `${bad.join(' ')}: said "${stderrLine(u)}"`);
    assert(!u.stdout.includes('PASS') && !hasStack(u), `${bad.join(' ')}: nothing validated, no stack trace`);
  }
  eq(drawioCli('validate').status, 2, 'no file is a usage error');
  const help = drawioCli('validate', '--help');
  assert(help.status === 0 && help.stdout.includes('--page'), 'help names --page');
});

// The tag scanner extractCells needs is forgiving on purpose, and it recovers
// from a mismatched closing tag rather than seeing one, so the validator used to
// answer PASS for XML no parser would accept (#155). The page body below is the
// one from the report, and its only defect is </WRONG>.
const PAGE_CELLS = '<mxCell id="0"/><mxCell id="1" parent="0"/>'
  + '<mxCell id="a" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="50" as="geometry"/></mxCell>';

test('the validator refuses XML that is not well-formed (#155)', () => {
  const malformed = [
    ['a closing tag that matches nothing',
      `<mxfile><diagram id="p" name="P"><mxGraphModel><root>${PAGE_CELLS}</WRONG></mxGraphModel></diagram></mxfile>`,
      /<\/WRONG> closes <root>/],
    ['an element that is never closed',
      `<mxfile><diagram id="p" name="P"><mxGraphModel><root>${PAGE_CELLS}</root></mxGraphModel></diagram>`,
      /<mxfile> is never closed/],
    ['the same attribute twice',
      '<mxfile><diagram id="p" name="P"><mxGraphModel><root><mxCell id="0"/>'
      + '<mxCell id="1" parent="0" parent="0"/></root></mxGraphModel></diagram></mxfile>',
      /attribute parent appears twice/],
    ['an unquoted attribute value',
      '<mxfile><diagram id=p name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
      + '</root></mxGraphModel></diagram></mxfile>',
      /is not quoted/],
    ['a raw ampersand in an attribute value',
      '<mxfile><diagram id="p" name="P"><mxGraphModel><root><mxCell id="0"/>'
      + '<mxCell id="1" parent="0" value="a & b"/></root></mxGraphModel></diagram></mxfile>',
      /raw "&"/],
    ['content after the root element',
      `<mxfile><diagram id="p" name="P"><mxGraphModel><root>${PAGE_CELLS}</root></mxGraphModel></diagram></mxfile><mxfile/>`,
      /a second root element/],
  ];
  for (const [what, xml, expected] of malformed) {
    const p = join(TMP, `wellformed-${what.replace(/[^a-z]+/gi, '-')}.drawio`);
    writeFileSync(p, xml);
    const r = validator.validateFile(p);
    eq(r.ok, false, `${what} must fail`);
    assert(r.errors.some((e) => /not well-formed XML at line \d+, column \d+/.test(e) && expected.test(e)),
      `${what} must say where and why, got: ${r.errors.join('; ')}`);
    eq(drawioCli('validate', p).status, 1, `${what} fails on the command line too`);
  }
});

// Well-formedness is checked, not tidiness: everything XML actually allows has
// to keep passing, or the gate becomes a style opinion.
test('declarations, comments, CDATA and quoting stay acceptable (#155)', () => {
  const p = join(TMP, 'wellformed-legal.drawio');
  writeFileSync(p, '<?xml version="1.0" encoding="UTF-8"?>\n'
    + "<!-- written by hand -->\n"
    + "<mxfile host='local' agent=\"a &amp; b\">"
    + '<diagram id="p" name="P"><mxGraphModel><root>'
    + '<mxCell id="0"/><mxCell id="1" parent="0"/>'
    + '<mxCell id="a" vertex="1" parent="1" value="&lt;b&gt;x&lt;/b&gt;">'
    + '<mxGeometry x="0" y="0" width="100" height="50" as="geometry"/></mxCell>'
    + '<![CDATA[free text < & > inside]]>'
    + '</root></mxGraphModel></diagram></mxfile>\n'
    + '<!-- and a trailing comment -->\n');
  const r = validator.validateFile(p);
  assert(!r.errors.some((e) => /well-formed/.test(e)), `legal XML must not be called malformed: ${r.errors.join('; ')}`);
  eq(r.ok, true, `legal XML must pass: ${r.errors.join('; ')}`);

  // Well-formed but not a diagram: the parse names the root it did find, which
  // is what the two wrapper string checks used to do less accurately.
  const wrong = join(TMP, 'wellformed-wrong-root.drawio');
  writeFileSync(wrong, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
  const w = validator.validateFile(wrong);
  eq(w.ok, false, 'a well-formed non-mxfile document must not pass');
  assert(w.errors.some((e) => e === 'the root element is <svg>, not <mxfile>'), `errors: ${w.errors.join('; ')}`);
});

test('a compressed page is checked after it is decoded (#155)', () => {
  const pack = (inner) => deflateRawSync(Buffer.from(encodeURIComponent(inner), 'binary')).toString('base64');
  const wrap = (body) => `<mxfile compressed="true"><diagram id="p" name="P">${body}</diagram></mxfile>`;

  const good = join(TMP, 'wellformed-packed-good.drawio');
  writeFileSync(good, wrap(pack(`<mxGraphModel><root>${PAGE_CELLS}</root></mxGraphModel>`)));
  const okResult = validator.validateFile(good);
  eq(okResult.ok, true, `a well-formed compressed page passes: ${okResult.errors.join('; ')}`);
  eq(okResult.info.pages[0].compressed, true, 'and really was compressed');

  const bad = join(TMP, 'wellformed-packed-bad.drawio');
  writeFileSync(bad, wrap(pack(`<mxGraphModel><root>${PAGE_CELLS}</WRONG></mxGraphModel>`)));
  const r = validator.validateFile(bad);
  eq(r.ok, false, 'a malformed compressed page must fail');
  assert(r.errors.some((e) => /^page 0: not well-formed XML at line \d+, column \d+/.test(e)),
    `the error names the page, got: ${r.errors.join('; ')}`);
});

// The wrapper is not a cheaper place to leak than the cells are: the report
// says what went wrong with the markup and where, never what the diagram says.
test('a well-formedness error quotes no attribute value (#155)', () => {
  const p = join(TMP, 'wellformed-secret.drawio');
  const secret = 'Acme Bank card issuing';
  writeFileSync(p, `<mxfile><diagram id="p" name="${secret}"><mxGraphModel><root>`
    + `<mxCell id="0"/><mxCell id="1" parent="0" value="${secret}" style="a & b"/>`
    + `</root></mxGraphModel></diagram></mxfile>`);
  const r = validator.validateFile(p);
  eq(r.ok, false, 'the raw ampersand fails the file');
  const said = JSON.stringify(r);
  assert(!said.includes('Acme'), `the report repeats the diagram's text: ${r.errors.join('; ')}`);
});

test('validateFile fails a page it cannot check and throws on a malformed index (#37)', () => {
  const broken = join(TMP, 'broken-one-page.drawio');
  writeFileSync(broken, '<mxfile><diagram name="b" id="b"><mxGraphModel><root>'
    + '<mxCell id="0"/><mxCell id="1" parent="0"/>'
    + '<mxCell id="e" edge="1" parent="1" source="1" target="nope"><mxGeometry relative="1" as="geometry"/></mxCell>'
    + '</root></mxGraphModel></diagram></mxfile>');
  eq(validator.validateFile(broken).ok, false, 'the broken page fails');
  eq(validator.validateFile(broken, { pageIndex: 0 }).ok, false, 'page 0 is that page');
  const missing = validator.validateFile(broken, { pageIndex: 999 });
  eq(missing.ok, false, 'page 999 of a one-page file must not pass');
  assert(missing.errors.some((e) => e === 'page 999 is out of range: "broken-one-page.drawio" has 1 page (0-0)'), `errors: ${missing.errors.join('; ')}`);
  eq(missing.info.pages.length, 0, 'no page is claimed as validated');
  for (const pageIndex of [-1, 1.5, NaN, Infinity, '0']) {
    let threw = null;
    try { validator.validateFile(broken, { pageIndex }); } catch (error) { threw = error; }
    assert(threw instanceof TypeError && /pageIndex must be a non-negative integer/.test(threw.message), `pageIndex ${String(pageIndex)} was accepted`);
  }
  const good = validator.validateFile(ARGS_STARTER, { pageIndex: 0 });
  assert(good.ok && good.info.pages[0].index === 0, 'a real page still validates');
});

test('build reads the spec, not the --out value, and refuses a bad command line in one line (#37)', () => {
  const dir = join(TMP, 'build-args');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'arch.drawio');
  const specBytes = readFileSync(SPEC);
  const flagFirst = drawioCli('build', '--out', out, SPEC);
  eq(flagFirst.status, 0, `--out before the spec (stderr: ${stderrLine(flagFirst)})`);
  eq(JSON.parse(flagFirst.stdout).wrote, out, 'reports the output it wrote');
  assert(validator.validateFile(out).ok, 'the spec was built');
  assert(readFileSync(SPEC).equals(specBytes), 'the spec was never written to');

  const malformed = join(dir, 'malformed.spec.json');
  writeFileSync(malformed, '{ "nodes": [ ');
  const target = join(dir, 'never.drawio');
  for (const [args, message] of [
    [[malformed, '--out', target], /is not valid JSON$/],
    [[join(dir, 'absent.spec.json'), '--out', target], /^no spec file at /],
    [[SPEC, SPEC, '--out', target], /expected one spec file, got 2/],
    [['--out', target], /expected a spec file/],
    [[SPEC], /--out <file.drawio> is required/],
    [[SPEC, '--out'], /--out needs a value/],
    [[SPEC, '--out', target, '--verbose'], /unknown option --verbose/],
  ]) {
    const r = drawioCli('build', ...args);
    const shown = args.map((a) => basename(a)).join(' ');
    eq(r.status, 2, `${shown}: usage status`);
    assert(message.test(stderrLine(r)), `${shown}: said "${stderrLine(r)}"`);
    assert(!hasStack(r) && !existsSync(target), `${shown}: no stack trace and nothing written`);
  }
  eq(drawioCli('build', malformed, '--out', target).stderr.trim().split('\n').length, 1, 'a malformed spec is one line');
});

test('analyze --page is checked the same way, and a missing page exits 1 instead of crashing (#37)', () => {
  const cells = drawioCli('analyze', '--page', '0', ARGS_STARTER, '--cells');
  eq(cells.status, 0, `--page 0 --cells (stderr: ${stderrLine(cells)})`);
  assert(Array.isArray(JSON.parse(cells.stdout)), 'prints the geometry table');

  const range = drawioCli('analyze', ARGS_STARTER, '--page', '3', '--images');
  eq(range.status, 1, 'a page the file lacks');
  assert(/page 3 is out of range/.test(range.stderr) && !hasStack(range), `said "${stderrLine(range)}"`);

  for (const [args, message] of [
    [[ARGS_STARTER, '--page', 'abc', '--cells'], /--page must be a non-negative integer/],
    [[ARGS_STARTER, '--page', '0'], /--page selects the page for --cells or --images/],
    [[ARGS_STARTER, ARGS_STARTER, '--cells'], /--cells and --images read one file/],
    [[ARGS_STARTER, '--labels', 'none'], /unknown option --labels/],
  ]) {
    const r = drawioCli('analyze', ...args);
    eq(r.status, 2, `${args.slice(1).join(' ')}: usage status`);
    assert(message.test(r.stderr) && !hasStack(r), `${args.slice(1).join(' ')}: said "${stderrLine(r)}"`);
  }
  const summary = join(TMP, 'analyze-summary.json');
  eq(drawioCli('analyze', '--out', summary, ARGS_STARTER).status, 0, '--out before the file');
  assert(existsSync(summary), 'summary written');
});

// ------------------------------------------------------------- spec checks (#36)

test('a spec naming a missing node is refused before anything is backed up or written (#36)', () => {
  const dir = join(TMP, 'spec-refused');
  mkdirSync(dir, { recursive: true });
  const specPath = join(dir, 'bad.spec.json');
  writeFileSync(specPath, JSON.stringify({
    nodes: [{ id: 'api', label: 'API', kind: 'box', col: 0, row: 0 }],
    edges: [{ from: 'api', to: 'missing' }],
  }));
  const out = join(dir, 'bad.drawio');
  writeFileSync(out, 'original');
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'arkitect.mjs'), 'drawio', 'build', specPath, '--out', out], { encoding: 'utf8' });
  eq(r.status, 1, 'exit status');
  const body = JSON.parse(r.stderr);
  eq(body.ok, false, 'reported as not ok');
  assert(body.errors.some((e) => e.startsWith('edges[0].to: "missing"')), `errors: ${body.errors.join('; ')}`);
  eq(readFileSync(out, 'utf8'), 'original', 'the existing target was changed');
  eq(readdirSync(dir).filter((f) => f.includes('.backup-')).length, 0, 'a refused build wrote a backup');
});

test('spec checks list every broken reference, id clash and cycle in one run (#36)', () => {
  const spec = {
    title: 'Title',
    boundaries: [
      { id: 'outer', parent: 'inner', col: 0, row: 0 },
      { id: 'inner', parent: 'outer', col: 0, row: 0 },
      { id: 'shared', col: 2, row: 0 },
    ],
    nodes: [
      { id: 'a', col: 0, row: 0, parent: 'nowhere' },
      { id: 'shared', col: 1, row: 0 },
      { id: 'title', col: 2, row: 0 },
      { id: 'b-lbl', col: 3, row: 0 },
      { label: 'no id', col: 4, row: 0 },
      { id: 'c', col: 5, row: 0, parent: 'a' },
    ],
    edges: [
      { from: 'a', to: 'ghost' },
      { from: 'a' },
      { id: 'a', from: 'a', to: 'shared' },
    ],
  };
  const errors = builder.validateSpec(spec);
  for (const expected of [
    'nodes[0].parent: "nowhere" is not a boundary id',
    'nodes[1].id: "shared" is already used by boundaries[2]',
    'nodes[2].id: "title" is reserved',
    'nodes[3].id: "b-lbl" is reserved',
    'nodes[4].id: expected a non-empty string',
    'nodes[5].parent: "a" is not a boundary id',
    'boundaries[0].parent: boundary "outer" is nested inside itself',
    'boundaries[1].parent: boundary "inner" is nested inside itself',
    'edges[0].to: "ghost" is not a node or boundary id',
    'edges[1].to: missing',
    'edges[2].id: "a" is already used by nodes[0]',
  ]) {
    assert(errors.some((e) => e.startsWith(expected)), `missing "${expected}" in:\n        ${errors.join('\n        ')}`);
  }
  let thrown = null;
  try { builder.buildDiagram(spec); } catch (e) { thrown = e; }
  assert(thrown instanceof builder.SpecError, 'buildDiagram did not refuse the spec');
  eq(thrown.errors.length, errors.length, 'the thrown error carries every problem');
});

// ------------------------------------------------------------- PowerShell entry point (#157)

// powershell.exe, not pwsh: these are the Windows entry points, and Windows
// PowerShell 5.1 is what ships. -NonInteractive so a prompt can never hang CI.
const powershell = (script, args) => spawnSync('powershell.exe',
  ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
  { encoding: 'utf8', timeout: 180000 });

// The supported Windows helper tested only whether something existed at the
// output path, so an exporter that produced nothing was reported as "rendered
// page 0" over whatever PNG was already sitting there - and the run still
// exited 0. An agent would then look at an old preview and believe its changes
// had rendered (#157). It is an adapter over render-drawio.mjs now, which backs
// the previous output up, judges success by a fresh non-empty file, and puts
// the old one back when the export fails.
test('the Windows Draw.io helper never calls a stale image a render (#157)', () => {
  const script = join(SCRIPTS, 'render-drawio.ps1');
  const source = readFileSync(script, 'utf8');
  // Checked everywhere: a second implementation must not grow back.
  assert(/render-drawio\.mjs/.test(source), 'it delegates to the tested renderer');
  assert(/exit \$code/.test(source), 'and exits with what the renderer said');
  assert(!/Test-Path \$out\b/.test(source), 'an existing output path is no longer success');
  assert(!/--page-index \(\$i \+ 1\)/.test(source), 'and there is no second page-index translation to drift');
  for (const flag of ['--page-index', '--all', '--width', '--out-dir', '--format', '--drawio-exe']) {
    assert(source.includes(flag), `the documented parameters still map to ${flag}`);
  }
  if (process.platform !== 'win32') return;

  const dir = join(TMP, 'ps-render-drawio');
  mkdirSync(dir, { recursive: true });
  const diagram = join(dir, 'sample.drawio');
  writeFileSync(diagram, '<mxfile><diagram id="p" name="P"><mxGraphModel><root>'
    + '<mxCell id="0"/><mxCell id="1" parent="0"/>'
    + '<mxCell id="a" vertex="1" parent="1" value="A" style="rounded=0">'
    + '<mxGeometry x="20" y="20" width="160" height="60" as="geometry"/></mxCell>'
    + '</root></mxGraphModel></diagram></mxfile>');

  // node.exe stands in for an exporter that fails and writes nothing: it is a
  // real executable the renderer can spawn, and Draw.io's flags are not its own.
  const stale = join(dir, 'sample.p0.png');
  writeFileSync(stale, 'stale-render');
  const over = powershell(script, ['-Path', diagram, '-OutDir', dir, '-DrawioExe', process.execPath]);
  assert(over.status !== 0, `a failed export must exit non-zero, got ${over.status}`);
  assert(!/rendered page/.test(over.stdout), `it must not say rendered: ${over.stdout.trim()}`);
  assert(/page 0 FAILED/.test(over.stdout), `it says which page failed: ${over.stdout.trim()}`);
  eq(readFileSync(stale, 'utf8'), 'stale-render', 'the previous output is put back untouched');

  // The same failure with nothing already there must not invent a file.
  rmSync(stale, { force: true });
  for (const f of readdirSync(dir)) if (f.includes('.backup-')) rmSync(join(dir, f), { force: true });
  const fresh = powershell(script, ['-Path', diagram, '-OutDir', dir, '-DrawioExe', process.execPath]);
  assert(fresh.status !== 0, `a failed export with no previous output must exit non-zero, got ${fresh.status}`);
  eq(existsSync(stale), false, 'and leaves no output behind');

  // Parameters really reach the renderer: only it knows the page count.
  const range = powershell(script, ['-Path', diagram, '-OutDir', dir, '-PageIndex', '5', '-DrawioExe', process.execPath]);
  assert(range.status !== 0, '-PageIndex past the end fails');
  assert(/out of range/.test(range.stdout + range.stderr), `-PageIndex reached the renderer: ${(range.stdout + range.stderr).trim()}`);
});

// ------------------------------------------------------------- spec numbers (#115)

test('a node or boundary without col or row sits at 0, and fractional or negative coordinates still build (#115)', () => {
  const geometry = (xml, id) => xml.match(new RegExp(`<mxCell id="${id}"[^>]*>\\s*<mxGeometry x="([^"]*)" y="([^"]*)" width="([^"]*)" height="([^"]*)"`))?.slice(1).join(',');
  const bare = builder.buildDiagram({ boundaries: [{ id: 'z', label: 'Zone' }], nodes: [{ id: 'a', label: 'A' }] }).xml;
  const zero = builder.buildDiagram({ boundaries: [{ id: 'z', label: 'Zone', col: 0, row: 0 }], nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }] }).xml;
  assert(!/NaN|Infinity/.test(bare), 'no NaN or Infinity in the geometry');
  eq(geometry(bare, 'a'), geometry(zero, 'a'), 'a node without col and row is drawn at col 0, row 0');
  eq(geometry(bare, 'z'), geometry(zero, 'z'), 'so is a boundary');
  const spec = { nodes: [{ id: 'a', label: 'Zürich — 東京', col: 1.5, row: -0.5 }] };
  eq(builder.validateSpec(spec).length, 0, 'fractional and negative coordinates are valid');
  const xAt = (col) => Number(geometry(builder.buildDiagram({ nodes: [{ id: 'a', label: 'A', col, row: -0.5 }] }).xml, 'a').split(',')[0]);
  assert(xAt(1) < xAt(1.5) && xAt(1.5) < xAt(2), `a fractional column lands between columns: ${xAt(1)} < ${xAt(1.5)} < ${xAt(2)}`);
  assert(!/NaN/.test(builder.buildDiagram(spec).xml), 'a Unicode label with fractional coordinates builds');
});

test('numeric spec fields are checked in one run, each problem naming its field (#115)', () => {
  const problems = builder.validateSpec({
    layout: { originX: 'left', colPitch: 0 },
    legendY: '10',
    boundaries: [{ id: 'z', label: 'Z', col: 0, row: 0, cols: 0.5, rows: 2, padTop: -1 }],
    nodes: [
      { id: 'a', label: 'A', col: 'oops', row: 0 },
      { id: 'b', label: 'B', col: 0, row: 1, width: -10, height: 0, fontSize: '12' },
      { id: 'c', label: 'C', col: 2, row: null },
    ],
    edges: [{ from: 'a', to: 'b', labelPos: 'mid' }],
  });
  const expected = [
    'layout.originX: expected a finite number, got "left"',
    'layout.colPitch: expected a number greater than 0, got 0',
    'spec.legendY: expected a finite number, got "10"',
    'boundaries[0].cols: expected a number of at least 1, got 0.5',
    'boundaries[0].padTop: expected a number of at least 0, got -1',
    'nodes[0].col: expected a finite number, got "oops"',
    'nodes[1].width: expected a number greater than 0, got -10',
    'nodes[1].height: expected a number greater than 0, got 0',
    'nodes[1].fontSize: expected a number greater than 0, got "12"',
    'edges[0].labelPos: expected a finite number, got "mid"',
  ];
  eq(problems.join('\n'), expected.join('\n'), 'every numeric problem, and a null row taken as absent');
  eq(builder.validateSpec({ layout: 'wide' }).join(), 'layout: expected an object', 'a layout that is not an object');
  eq(builder.validateSpec({ nodes: [{ id: 'a', col: Infinity, row: NaN }] }).length, 2, 'Infinity and NaN from the API are refused too');
  let thrown;
  try { builder.buildDiagram({ nodes: [{ id: 'a', label: 'A', col: 'oops', row: 0 }] }); } catch (e) { thrown = e; }
  assert(thrown instanceof builder.SpecError, 'buildDiagram refuses the spec instead of writing NaN');
});

test('a spec with a bad number is refused on the command line before any backup or write (#115)', () => {
  const dir = join(TMP, 'spec-numbers');
  mkdirSync(dir, { recursive: true });
  const specPath = join(dir, 'bad.spec.json');
  writeFileSync(specPath, JSON.stringify({ nodes: [{ id: 'a', label: 'A', col: 'oops', row: 0, width: -10 }] }));
  const out = join(dir, 'bad.drawio');
  writeFileSync(out, 'original');
  const r = buildCli(specPath, '--out', out);
  eq(r.status, 1, 'exit status');
  eq(JSON.parse(r.stderr).errors.join(' | '),
    'nodes[0].col: expected a finite number, got "oops" | nodes[0].width: expected a number greater than 0, got -10', 'both fields named');
  eq(readFileSync(out, 'utf8'), 'original', 'the existing target is untouched');
  eq(readdirSync(dir).filter((f) => f.includes('.backup-')).length, 0, 'no backup was written');
});

// null is documented as taking the default, and numberProblems lets it through
// for exactly that reason - but object spread then wrote the null over the
// default it was supposed to fall back to, so a whole grid collapsed onto one
// column (#153).
test('an explicit null takes the default, exactly as leaving the field out does (#153)', () => {
  const nodes = [{ id: 'a', label: 'A', col: 0 }, { id: 'b', label: 'B', col: 1 }];
  const nulled = builder.buildDiagram({ layout: { colPitch: null, rowPitch: null, originX: null }, nodes }).xml;
  const absent = builder.buildDiagram({ nodes }).xml;
  eq(nulled, absent, 'a null layout value must build the same file as no value at all');
  const p = join(TMP, 'null-defaults.drawio');
  writeFileSync(p, nulled);
  const r = validator.validateFile(p);
  assert(r.ok, `the build validates: ${r.errors.join('; ')}`);
  eq(r.info.pages[0].overlaps, 0, 'two columns must not land on top of each other');
});

// Every operand finite, the product not: what used to be written was
// pageWidth="Infinity" and a coordinate to match (#153).
test('a coordinate that overflows the layout is refused, naming the field (#153)', () => {
  const overflowing = [
    [{ nodes: [{ id: 'a', label: 'A', col: 1e308 }] }, 'nodes[0].col: 1e+308 is past what this layout\'s grid can reach'],
    [{ nodes: [{ id: 'a', label: 'A', row: -1e308 }] }, 'nodes[0].row: -1e+308 is past what this layout\'s grid can reach'],
    [{ boundaries: [{ id: 'z', label: 'Z', col: 0, cols: 1e308 }] }, 'boundaries[0].cols: 1e+308 is past what this layout\'s grid can reach'],
    [{ layout: { colPitch: 1e308 }, nodes: [{ id: 'a', label: 'A', col: 1e10 }] },
      'nodes[0].col: 10000000000 is past what this layout\'s grid can reach'],
  ];
  for (const [spec, expected] of overflowing) {
    eq(builder.validateSpec(spec).length, 0, `the fields are individually finite: ${JSON.stringify(spec)}`);
    let thrown;
    try { builder.buildDiagram(spec); } catch (e) { thrown = e; }
    assert(thrown instanceof builder.SpecError, `${JSON.stringify(spec)} must be refused`);
    eq(thrown.errors.join(' | '), expected, 'the field responsible is named');
  }
  // The pitch is what decides, so the same col is fine with the default one.
  assert(!/NaN|Infinity/.test(builder.buildDiagram({ nodes: [{ id: 'a', label: 'A', col: 1e10 }] }).xml),
    'a large but reachable column still builds');
});

test('an overflowing spec never reaches the target file or a backup (#153)', () => {
  const dir = join(TMP, 'spec-overflow');
  mkdirSync(dir, { recursive: true });
  const specPath = join(dir, 'overflow.spec.json');
  writeFileSync(specPath, JSON.stringify({ nodes: [{ id: 'a', label: 'A', col: 1e308 }] }));
  const out = join(dir, 'overflow.drawio');
  writeFileSync(out, 'original');
  const r = buildCli(specPath, '--out', out);
  eq(r.status, 1, 'exit status');
  eq(JSON.parse(r.stderr).errors.join(' | '), 'nodes[0].col: 1e+308 is past what this layout\'s grid can reach', 'the field is named');
  eq(readFileSync(out, 'utf8'), 'original', 'the existing target is untouched');
  eq(readdirSync(dir).filter((f) => f.includes('.backup-')).length, 0, 'no backup was written');
});

test('nested boundaries build, an edge may end on a boundary, and automatic edge ids skip taken ones (#36)', () => {
  const spec = {
    boundaries: [
      { id: 'outer', label: 'Outer', col: 0, row: 0, cols: 3 },
      { id: 'inner', label: 'Inner', parent: 'outer', col: 1, row: 0, cols: 2 },
    ],
    nodes: [
      { id: 'a', label: 'A', col: 0, row: 0, parent: 'outer' },
      { id: 'e1', label: 'Named like an edge', col: 1, row: 0, parent: 'inner' },
      { id: 'c', label: 'C', col: 2, row: 0, parent: 'inner' },
    ],
    edges: [
      { from: 'a', to: 'e1', label: 'first' },
      { from: 'e1', to: 'c' },
      { from: 'a', to: 'inner', kind: 'async' },
    ],
  };
  eq(builder.validateSpec(spec).length, 0, 'a valid nested spec was refused');
  const out = join(TMP, 'nested-boundaries.drawio');
  writeFileSync(out, builder.buildDiagram(spec).xml);
  const r = validator.validateFile(out);
  assert(r.ok, `validation errors: ${r.errors.join('; ')}`);
  const cells = core.extractCells(core.readMxfile(out).pages[0].xml);
  eq(new Set(cells.map((c) => c.id)).size, cells.length, 'cell ids are unique');
  const edges = cells.filter((c) => c.edge && !c.id.startsWith('legend'));
  eq(edges.length, 3, 'every requested edge was drawn');
  assert(edges.some((c) => c.source === 'a' && c.target === 'inner'), 'the edge to a boundary was drawn');
});

test('an unknown edge kind draws as a flow instead of crashing on its label (#36)', () => {
  const { xml } = builder.buildDiagram({
    nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 1, row: 0 }],
    edges: [{ from: 'a', to: 'b', kind: 'asnyc', label: 'typo' }, { from: 'b', to: 'a', kind: 'flow' }],
  });
  const out = join(TMP, 'unknown-kind.drawio');
  writeFileSync(out, xml);
  const cells = core.extractCells(core.readMxfile(out).pages[0].xml);
  const edges = cells.filter((c) => c.edge);
  eq(edges.length, 2, 'both edges drawn');
  eq(edges[0].style, edges[1].style, 'the unknown kind is not drawn as a flow');
  assert(!cells.some((c) => c.id === 'legend'), 'the unknown kind earned a legend of its own');
});

test('an unknown node or edge kind is named in the build report with what it was drawn as (#48)', () => {
  const spec = {
    nodes: [{ id: 'a', kind: 'box', label: 'A', col: 0, row: 0 }, { id: 'b', kind: 'cylinder', label: 'B', col: 1, row: 0 },
      { id: 'c', kind: 'constructor', label: 'C', col: 2, row: 0 }, { id: 'd', label: 'D', col: 3, row: 0 }],
    edges: [{ from: 'a', to: 'b', kind: 'asnyc' }, { from: 'b', to: 'c', kind: 'toString' },
      { from: 'c', to: 'd', kind: 'async' }, { from: 'a', to: 'd' }],
  };
  const { report } = builder.buildDiagram(spec);
  eq(JSON.stringify(report.unknownKinds.map((u) => [u.field, u.value, u.drawnAs])), JSON.stringify([
    ['nodes[1].kind', 'cylinder', 'box'], ['nodes[2].kind', 'constructor', 'box'],
    ['edges[0].kind', 'asnyc', 'flow'], ['edges[1].kind', 'toString', 'flow'],
  ]), 'every unknown kind, in spec order, with its fallback');
  for (const u of report.unknownKinds) {
    assert(u.valid.includes(u.field.startsWith('nodes') ? 'icon' : 'async') && !u.valid.includes(u.value), `${u.field} lists the valid kinds`);
  }
  eq(builder.buildDiagram({
    nodes: [{ id: 'a', kind: 'note', label: 'A', col: 0, row: 0 }, { id: 'd', label: 'D', col: 1, row: 0 }],
    edges: [{ from: 'a', to: 'd', kind: 'error' }, { from: 'd', to: 'a' }],
  }).report.unknownKinds.length, 0, 'known and omitted kinds report nothing');

  const specPath = join(TMP, 'unknown-kinds.spec.json');
  writeFileSync(specPath, JSON.stringify(spec));
  const out = JSON.parse(execFileSync(process.execPath, [join(SCRIPTS, 'build-diagram.mjs'), specPath, '--out', join(TMP, 'unknown-kinds.drawio')], { encoding: 'utf8' }));
  eq(JSON.stringify(out.unknownKinds.map((u) => u.value)), JSON.stringify(['cylinder', 'constructor', 'asnyc', 'toString']),
    'the CLI prints them and the build still succeeds');
});

// ------------------------------------------------------------- logos

// Minimal valid PNG, so the logo tests stay offline and deterministic.
function makePng(w, h, colorType) {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc = (b) => {
    let c = 0xFFFFFFFF;
    for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const bpp = colorType === 6 ? 4 : 3;
  const raw = Buffer.alloc((w * bpp + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * (w * bpp + 1) + 1 + x * bpp;
      raw[o] = 30; raw[o + 1] = 150; raw[o + 2] = 200;
      if (bpp === 4) raw[o + 3] = 0;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const LOGO_KEYS = ['arkitect-drawio-test-alpha', 'arkitect-drawio-test-opaque'];
function clearTestLogos() {
  for (const k of LOGO_KEYS) {
    for (const ext of ['.png', '.svg']) {
      const f = join(logos.LOGO_DIR, k + ext);
      if (existsSync(f)) rmSync(f);
    }
  }
  const idx = join(logos.LOGO_DIR, 'index.json');
  if (existsSync(idx)) {
    const j = JSON.parse(readFileSync(idx, 'utf8'));
    let touched = false;
    for (const k of LOGO_KEYS) if (j[k]) { delete j[k]; touched = true; }
    if (touched) writeFileSync(idx, JSON.stringify(j, null, 2) + '\n');
  }
}
clearTestLogos();

test('a transparent PNG logo caches and is reported as transparent', () => {
  const e = logos.storeLogo(LOGO_KEYS[0], makePng(120, 40, 6), { source: 'test', force: true });
  eq(e.mime, 'image/png', 'mime');
  eq(e.width, 120, 'width'); eq(e.height, 40, 'height');
  eq(e.transparent, true, 'transparency detected');
});

test('an opaque PNG logo is flagged rather than accepted silently', () => {
  const e = logos.storeLogo(LOGO_KEYS[1], makePng(64, 64, 2), { source: 'test', force: true });
  eq(e.transparent, false, 'opaque detected');
  assert(/opaque/i.test(e.transparencyNote), `note should say opaque, got "${e.transparencyNote}"`);
});

test('logo sizing fits the longest side and preserves aspect', () => {
  const e = logos.getLogo(LOGO_KEYS[0]);
  const box = logos.logoBox(e, 64);
  eq(box.width, 64, 'wordmark width');
  eq(box.height, 21, 'wordmark height keeps the 3:1 aspect');
  const sq = logos.logoBox(logos.getLogo(LOGO_KEYS[1]), 64);
  eq(`${sq.width}x${sq.height}`, '64x64', 'square logo');
});

test('a logo style embeds the bytes in the style-safe data URI form', () => {
  const e = logos.getLogo(LOGO_KEYS[0]);
  const style = logos.logoStyle(e);
  assert(!style.includes(';base64,'), 'semicolon would split the draw.io style');
  const data = core.parseDataUri(core.parseStyle(style).image);
  assert(data && data.bytes.length > 0, 'embedded logo does not decode');
  eq(data.hash, e.sha256, 'embedded payload matches the cached file');
});

test('non-images and oversized files are refused', () => {
  let threw = false;
  try { logos.storeLogo('arkitect-drawio-test-bad', Buffer.from('<html>nope</html>'), { force: true }); }
  catch { threw = true; }
  assert(threw, 'an HTML page was accepted as a logo');
});

test('a generated diagram embeds logos and reports missing ones', () => {
  const spec = {
    page: 'Logos', pageId: 'logo-test',
    nodes: [
      { id: 'a', kind: 'logo', logo: LOGO_KEYS[0], label: 'Product A', col: 0, row: 0 },
      { id: 'b', kind: 'logo', logo: 'arkitect-drawio-definitely-not-cached', label: 'Product B', col: 1, row: 0 },
      { id: 'c', kind: 'icon', icon: 'lambda', label: 'Function', col: 2, row: 0 },
    ],
    edges: [{ from: 'a', to: 'c', kind: 'flow' }],
  };
  const { xml, report } = builder.buildDiagram(spec);
  const out = join(TMP, 'logos.drawio');
  writeFileSync(out, xml);

  eq(report.logos.length, 1, 'logos embedded');
  eq(report.missingLogos.length, 1, 'missing logo reported, not substituted');
  eq(report.missingLogos[0], 'arkitect-drawio-definitely-not-cached', 'missing logo named');

  const r = validator.validateFile(out);
  assert(r.ok, `validation errors: ${r.errors.join('; ')}`);
  eq(r.info.pages[0].externalImages, 0, 'logos must embed, never link');
  assert(r.info.pages[0].embeddedImages >= 2, 'logo and icon both embedded');
});

clearTestLogos();

// ------------------------------------------------------------- analysis

sourceTest('all five reference diagrams summarize without emitting page XML', () => {
  if (!haveSources) return 'skip';
  const out = node('analyze-drawio.mjs', sourceList);
  for (const marker of ['<mxCell', '<mxGraphModel', '<root>', 'data:image/']) {
    assert(!out.includes(marker), `summary leaked ${marker}`);
  }
  const parsed = JSON.parse(out);
  eq(parsed.files.length, 5, 'files summarized');
  assert(parsed.files.every((f) => f.pages.length >= 1), 'pages summarized');
});

sourceTest('page inventory matches the shipped record', () => {
  if (!haveSources) return 'skip';
  // Structure only: page names are authored text and never enter the record,
  // so the invariant is the shape of each file, not what its pages are called.
  const record = JSON.parse(readFileSync(join(SKILL, 'references', 'source-analysis.json'), 'utf8'));
  sourceList.forEach((p, i) => {
    const mx = core.readMxfile(p);
    eq(mx.pages.length, record.sources[i].pageCount, `page count for source ${i}`);
  });
});

test('the record carries no page names', () => {
  const record = JSON.parse(readFileSync(join(SKILL, 'references', 'source-analysis.json'), 'utf8'));
  for (const src of record.sources) {
    for (const page of src.pages) {
      assert(!('name' in page), 'a page summary exposes its name');
      assert(typeof page.index === 'number', 'a page summary is missing its index');
    }
    assert(!('mtimeUtc' in src), 'a source exposes a modification time');
  }
});

sourceTest('reference diagrams are unmodified since analysis', () => {
  if (!haveSources) return 'skip';
  const record = JSON.parse(readFileSync(join(SKILL, 'references', 'source-analysis.json'), 'utf8'));
  sourceList.forEach((p, i) => {
    const h = createHash('sha256').update(readFileSync(p)).digest('hex');
    eq(h, record.sources[i].sha256, `source ${i} hash drifted - the file was modified`);
  });
});

test('the analyzer handles a compressed page', () => {
  // Round-trip a page through draw.io's deflate+URI encoding and re-read it.
  const inner = '<mxGraphModel dx="100" dy="100"><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
    + '<mxCell id="n1" value="x" style="rounded=0;" vertex="1" parent="1">'
    + '<mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel>';
  const packed = deflateRawSync(Buffer.from(encodeURIComponent(inner), 'binary')).toString('base64');
  const f = join(TMP, 'compressed.drawio');
  writeFileSync(f, `<mxfile><diagram name="c" id="c">${packed}</diagram></mxfile>`);
  const mx = core.readMxfile(f);
  assert(mx.pages[0].compressed, 'page not detected as compressed');
  const cells = core.extractCells(mx.pages[0].xml);
  eq(cells.filter((c) => c.vertex).length, 1, 'decompressed vertex count');
});

// ------------------------------------------------------------- redaction

const GENERIC = new Set(`
aws amazon architecture diagram drawio page cloud data source target lambda bucket
storage service function metrics logs log agent agents model models gateway runtime
memory identity observability bedrock cloudwatch timestream forecast neptune dynamodb
athena eventbridge opensearch elasticsearch batch step functions sns s3 ec2 ecs vpc
subnet region account config file files folder script scripts parser cleaning index
indexing query queries report reports monitoring collector tracker pipeline ingestion
delta recovery manifest backup destination current proposed approach strengths
weaknesses module modules external tools documentation sources producers node true
false null default none text html style value width height parent vertex edge shape
image icon label title name type kind color colour stroke fill font size legend flow
async error success light note assumption reference generic starter template example
python yaml json csv parquet sql table row column view stage integration frontend
backend user users system systems tool date time zone with without from into and the
for not new old set get run runs running use used uses case cases keys key bucketkey
`.trim().split(/\s+/));

// Broad tokenizer, used when scanning repository files: catch anything.
function tokenize(text) {
  return (text.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? [])
    .map((t) => t.replace(/^[-_]+|[-_]+$/g, ''))
    .filter((t) => t.length >= 4 && !GENERIC.has(t));
}

// Common English, SQL and infrastructure vocabulary. Diagram labels are terse
// and heavily Title Cased or SHOUTED, so without this the all-caps rule below
// would flag things like "LEFT JOIN" and "CURRENT APPROACH".
const COMMON = new Set(`
left right full inner outer join union select insert update delete where group order
copy copies copied move moved create created creating update updated read write writes
list lists check checks checked trigger triggers triggered launch launches start starts
stop stops send sends receive receives fetch load loads sync syncs export exports
import imports parse parsed clean cleansed cleaned enrich enriched detect detected
approach current previous next final draft option options solution solutions step steps
first second third only when then that this these those with without more less most
need needs needed want should could would have has had been being will can may might
all any each every some none both other others same different full empty missing exist
exists present absent available ready done complete completed success successful fail
failed failure error errors warning info debug level levels mode modes state states
metadata schema view views stage stages job jobs task tasks work worker workers batch
manifest report reports result results output outputs input inputs record records
document documents item items object objects entry entries value values field fields
number count total sum average min max limit offset range start end date time daily
hourly weekly monthly per rate cost costs price usage quota latency throughput volume
scalability traceability flexibility implementation performance recovery reduced lower
higher large small long short fast slow simple complex custom standard native default
strength strengths weakness weaknesses pros cons note notes comment comments question
questions decision decisions assumption assumptions scope scoped in-scope out-of-scope
tested caching cached fetch fetched download downloaded transparent transparency
logo logos vendor product products wordmark aspect offline synthetic probe
agentic studio knowledge graph engine vector vectors embedding embeddings retrieval
prompt chunk
collection collections namespace namespaces cluster clusters instance instances
claude plugin skill skills anthropic must listing refresh shipped arkitect
carries appears repository sensitive tokens derived structural
`.trim().split(/\s+/));

// Narrow tokenizer, used when deciding what counts as sensitive. Guarding every
// English word that appears in a label would flag ordinary prose and make the
// check meaningless. What actually identifies a customer is identifier-shaped
// text, so only that is collected:
//   - identifiers: contain a digit, an underscore, or two or more hyphens
//   - SHOUTED names: all-caps runs of 4+ letters that are not common vocabulary
// Path segments and hostnames are added separately by the caller.
function sensitiveTokens(text) {
  const out = new Set();
  const keep = (t) => {
    const k = t.toLowerCase().replace(/^[-_]+|[-_]+$/g, '');
    if (k.length >= 4 && !GENERIC.has(k) && !COMMON.has(k)) out.add(k);
  };
  for (const m of text.match(/[A-Za-z][A-Za-z0-9_-]{3,}/g) ?? []) {
    const hyphens = (m.match(/-/g) ?? []).length;
    if (/\d/.test(m) || m.includes('_') || hyphens >= 2) keep(m);
    else if (/^[A-Z]{4,}$/.test(m)) keep(m);
  }
  return [...out];
}

// Titles in the shipped icon catalog are public AWS product naming. They are in
// the repository by design, so they can never count as sensitive.
function publicVocabulary() {
  const cat = finder.loadCatalog();
  const out = new Set();
  for (const icon of cat.icons) {
    for (const t of tokenize(`${icon.title} ${icon.aliases.join(' ')}`.replace(/[-_]/g, ' '))) out.add(t);
  }
  return out;
}

// Public vendor and product names. They appear in the reference diagrams (as
// logos and vendor URLs) but they are not customer data - they are the names of
// commercially available products, and the skill is explicitly meant to mention
// them when sourcing logos. Allowlisting them keeps the redaction check aimed at
// what actually identifies a customer.
const PRODUCTS = new Set(`
streamlit snowflake pinecone grafana loki milvus qdrant databricks datadog talend
matillion langfuse clickhouse litellm github gitlab airflow kafka spark tableau
looker mongodb postgres postgresql redis elasticsearch opensearch terraform
kubernetes docker python java nodejs typescript pandas numpy jupyter neptune
timestream forecast bedrock agentcore veeam azure snowpark parquet delta iceberg
`.trim().split(/\s+/));

const SALT = 'arkitect-drawio:v1:';
const hashToken = (t) => createHash('sha256').update(SALT + t).digest('hex').slice(0, 24);

// The vendored libraries are other people's bytes, verified by digest
// elsewhere, and too heavy to tokenize.
const repoTextFiles = () => repoFiles(ROOT, ({ rel, name, size }) =>
  !rel.split('/').includes('libraries')
  && /\.(md|json|mjs|js|ps1|yaml|yml|drawio|xml|txt)$/i.test(name)
  && size < 8 * 1024 * 1024);

sourceTest('no sensitive string from the reference diagrams appears in the repository', () => {
  const hashFile = join(HERE, 'sensitive-tokens.drawio.sha256');
  let sensitive;

  if (haveSources) {
    // Derive from the live sources: full fidelity, nothing written to disk.
    sensitive = new Set();
    for (const p of sourceList) {
      const mx = core.readMxfile(p);
      for (const page of mx.pages) {
        for (const c of core.extractCells(page.xml)) {
          if (!c.value) continue;
          const plain = String(c.value).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
          for (const t of sensitiveTokens(plain)) sensitive.add(t);
        }
        for (const m of page.xml.matchAll(/\bhttps?:\/\/([a-z0-9.-]+)/gi)) {
          for (const t of tokenize(m[1])) sensitive.add(t);
        }
      }
      // Path components carry customer and project names. Split on separators
      // as well as slashes, so a hyphenated directory name yields its codename
      // on its own and not just the whole compound.
      for (const t of tokenize(p.replace(/[\\/]/g, ' '))) sensitive.add(t);
      for (const t of tokenize(p.replace(/[\\/.\-_]/g, ' '))) sensitive.add(t);
    }
    // AWS product naming shipped in the catalog is public, never sensitive.
    const publicVocab = publicVocabulary();
    for (const t of publicVocab) sensitive.delete(t);
    for (const t of COMMON) sensitive.delete(t);
    for (const t of PRODUCTS) sensitive.delete(t);
    // A hyphen/underscore compound made only of generic words is a category
    // name, not an identifier - "data-ingestion" is not customer data.
    const benign = (w) => COMMON.has(w) || GENERIC.has(w) || publicVocab.has(w) || PRODUCTS.has(w);
    for (const t of [...sensitive]) {
      if (!/[-_]/.test(t)) continue;
      if (t.split(/[-_]+/).filter(Boolean).every(benign)) sensitive.delete(t);
    }
    assert(sensitive.size > 0, 'derived sensitive-token set is empty - the tokenizer is broken');

    // Subtract whatever the repository already says. A real corpus is full of
    // ordinary vocabulary - "quality", "setup", "tables" - that is also all over
    // these docs, and guarding those produces nothing but noise. What this check
    // is for is a distinctive string arriving later: a customer name, a
    // codename, a hostname. So baseline against the repo as it stands, then
    // union with the digests already recorded, so a token once judged sensitive
    // stays guarded even if it turns up in the repo on a later run.
    const alreadyPublic = new Set();
    for (const f of repoTextFiles()) {
      if (f === hashFile) continue;
      for (const t of tokenize(readFileSync(f, 'utf8'))) alreadyPublic.add(t);
    }
    const previous = existsSync(hashFile)
      ? readFileSync(hashFile, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
      : [];
    const fresh = [...sensitive].filter((t) => !alreadyPublic.has(t)).map(hashToken);
    const union = [...new Set([...previous, ...fresh])].sort();

    // Refresh the digest list so the check still works without the sources.
    writeFileSync(hashFile,
      '# Salted SHA-256 prefixes of tokens that must never appear in this repo.\n'
      + '# Regenerated by tests/run-tests.mjs when local reference sources are present:\n'
      + `# ${sensitive.size} identifier-shaped tokens seen in the corpus, ${union.length} guarded\n`
      + union.join('\n') + '\n');
  } else if (existsSync(hashFile)) {
    sensitive = null; // digest-only mode
  } else {
    return 'skip';
  }

  const digests = new Set(readFileSync(hashFile, 'utf8').split('\n')
    .filter((l) => l && !l.startsWith('#')));
  assert(digests.size > 0, 'no sensitive tokens recorded');

  const hits = [];
  for (const f of repoTextFiles()) {
    if (f === hashFile) continue;
    for (const t of new Set(tokenize(readFileSync(f, 'utf8')))) {
      if (digests.has(hashToken(t))) hits.push(`${relative(ROOT, f)}: "${t}"`);
    }
  }
  assert(hits.length === 0, `sensitive strings leaked into the repo:\n        ${hits.slice(0, 20).join('\n        ')}`);
});

test('the shipped analysis record carries no diagram content', () => {
  const raw = readFileSync(join(SKILL, 'references', 'source-analysis.json'), 'utf8');
  for (const marker of ['<mxCell', 'data:image/', 'http://', 'https://']) {
    assert(!raw.includes(marker), `source-analysis.json contains ${marker}`);
  }
  // A literal path fragment would itself be a leak, so match it by shape.
  assert(!/[A-Za-z]:[\\/]/.test(raw), 'source-analysis.json contains a filesystem path');
  const rec = JSON.parse(raw);
  assert(rec.sources.every((s) => !s.path && !s.name && s.sha256), 'source entries expose a path or name');
});

// ------------------------------------------------------------- plugin shape

test('plugin manifest and both skills are well formed', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  eq(manifest.name, 'arkitect', 'plugin name');
  assert(manifest.description && manifest.description.length > 20, 'plugin description');

  const main = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');
  const learn = readFileSync(join(ROOT, 'skills', 'learn-drawio-style', 'SKILL.md'), 'utf8');
  assert(/^---\r?\n/.test(main) && /^---\r?\n/.test(learn), 'skills need YAML frontmatter');
  assert(main.includes('name: arkitect-drawio'), 'main skill name');
  assert(learn.includes('name: learn-drawio-style'), 'learning skill name');
  assert(learn.includes('disable-model-invocation: true'), 'learning skill must be user-invoked only');
  assert(!main.includes('disable-model-invocation'), 'main skill must stay model-invocable');
  assert(main.includes('${CLAUDE_PLUGIN_ROOT}'), 'main skill should use ${CLAUDE_PLUGIN_ROOT}');
  assert(!/C:\\Users/i.test(main) && !/C:\\Users/i.test(learn), 'skills must not hard-code install paths');
});

test('scripts avoid hard-coded absolute paths', () => {
  for (const f of readdirSync(SCRIPTS).filter((n) => n.endsWith('.mjs'))) {
    const s = readFileSync(join(SCRIPTS, f), 'utf8');
    assert(!/C:[\\/]Users/i.test(s), `${f} hard-codes a user path`);
  }
});

// -------------------------------------------------------------

finish(haveSources ? null : '(reference-diagram tests skipped: .analysis/sources.local.json not present)');
