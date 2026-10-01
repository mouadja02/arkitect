// arkitect doctor: what this install can draw with, and what it cannot.
//
// Node and the bundled assets are the core: a failed row there makes the
// command exit 1, so a script can tell a broken install from a working one
// (#308). Everything else - the renderers, Docker, the style and the project's
// adapters - is optional, and a warning never changes the exit status.
//
// Doctor reads files and asks programs for their version. It never launches a
// renderer or a browser, starts a container or contacts anything remote.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ADAPTERS, BEGIN, END } from './install-agent.mjs';

const OK = 'ok';
const WARN = 'warn';
const FAIL = 'fail';

const firstLine = (s) => String(s ?? '').trim().split(/\r?\n/)[0];

// Each bundled asset parsed, and every file it names present. A file that is
// there but cut short used to read "present" while the icon search it feeds
// failed on it (#306). Artwork bytes are not hashed here: `drawio packs
// --verify` does that against the pins.
export function assetRows(root, { read = (p) => readFileSync(p, 'utf8'), exists = existsSync } = {}) {
  const lib = join(root, 'skills', 'arkitect-drawio', 'assets', 'libraries');
  const bundled = join(root, 'skills', 'arkitect-excalidraw', 'assets', 'libraries', 'bundled');
  const json = (text) => {
    try { return JSON.parse(text); } catch (error) { throw new Error(`not valid JSON (${error.message})`); }
  };
  const list = (value, what) => {
    if (!Array.isArray(value) || !value.length) throw new Error(`no ${what} list`);
    return value;
  };
  const absent = (dir, files) => {
    const gone = files.filter((f) => typeof f !== 'string' || !exists(join(dir, f)));
    if (gone.length) throw new Error(`names ${gone.length} file${gone.length === 1 ? '' : 's'} that are not there: ${gone.slice(0, 3).join(', ')}`);
  };

  const checks = [
    ['draw.io icon packs', join(lib, 'sources.json'), (t) => `${list(json(t).packs, 'packs').length} pack sources`],
    ['draw.io icon catalog', join(root, 'skills', 'arkitect-drawio', 'references', 'icon-catalog.json'), (t) => {
      const c = json(t);
      const packs = list(c.packs, 'packs');
      const icons = list(c.icons, 'icons');
      absent(lib, packs.map((p) => p.file));
      const onDemand = c.counts?.onDemand ?? 0;
      return `${(icons.length - onDemand).toLocaleString('en-US')} marks in ${packs.length} packs`
        + `${onDemand ? ` and ${onDemand} on demand` : ''}, every pack file there`;
    }],
    ['draw.io AWS pack', join(lib, 'aws.drawio'), (t) => {
      const m = /^\s*<mxlibrary>([\s\S]*)<\/mxlibrary>\s*$/.exec(t);
      if (!m) throw new Error('not an <mxlibrary>');
      return `${list(json(m[1]), 'shapes').length} shapes`;
    }],
    ['excalidraw libraries', join(bundled, 'index.json'), (t) => {
      const index = json(t);
      const libs = list(index.libraries, 'libraries');
      absent(bundled, libs.map((l) => l.file));
      return `${libs.length} libraries, ${index.totals?.items ?? '?'} items, every file there`;
    }],
    ['plugin manifest', join(root, '.claude-plugin', 'plugin.json'), (t) => {
      const m = json(t);
      if (typeof m.name !== 'string') throw new Error('no name');
      return `${m.name} ${m.version ?? ''}`.trim();
    }],
    ['agent contract', join(root, 'AGENTS.md'), (t) => {
      if (!t.trim()) throw new Error('empty');
      return 'present';
    }],
  ];
  return checks.map(([label, path, parse]) => {
    if (!exists(path)) return [FAIL, label, `missing: ${path}`];
    try {
      return [OK, label, parse(read(path))];
    } catch (error) {
      return [FAIL, label, `${relative(root, path)}: ${error.message}`];
    }
  });
}

// The style each engine draws with on this install: the house style, an
// applied override, or one ignored for its problems. Field names only, never
// the values or the notes behind them (#309).
export async function styleRows(root, env = process.env) {
  const rows = [];
  for (const [skill, label] of [['arkitect-drawio', 'draw.io style'], ['arkitect-excalidraw', 'excalidraw style']]) {
    const { loadStyle } = await import(pathToFileURL(join(root, 'skills', skill, 'scripts', 'lib', 'style-tokens.mjs')).href);
    const s = loadStyle({ env });
    const n = s.overridden.length;
    if (s.source === 'override') rows.push([OK, label, `override applied, ${n} field${n === 1 ? '' : 's'}: ${s.file}`]);
    else if (s.errors.length) {
      rows.push([WARN, label, `override ignored, drawing the house style: ${s.file}`,
        [s.errors.map((e) => e.split(':')[0]).join(', ')]]);
    } else rows.push([OK, label, 'house style, no override']);
  }
  return rows;
}

// What the two PNG routes need, from the renderers' own discovery (#305).
export async function rendererRows(root, { platform = process.platform, env = process.env, isExecutable } = {}) {
  const rows = [];
  const drawioScripts = join(root, 'skills', 'arkitect-drawio', 'scripts');
  const { locateDrawio, displayFor } = await import(pathToFileURL(join(drawioScripts, 'render-drawio.mjs')).href);
  const { locateBrowser } = await import(pathToFileURL(join(root, 'skills', 'arkitect-excalidraw', 'scripts', 'lib', 'browser.mjs')).href);
  const probe = { platform, env, ...(isExecutable && { isExecutable }) };

  // The renderer's own discovery, not a second list of paths: doctor used to
  // miss /opt/drawio, PATH and DRAWIO_EXE while `drawio render` found them (#46).
  const drawio = locateDrawio(undefined, probe);
  const drawioLabel = 'draw.io desktop (PNG render)';
  if (drawio.path) rows.push([OK, drawioLabel, `${drawio.path} (${drawio.source})`]);
  else if (drawio.source) {
    rows.push([WARN, drawioLabel, `${drawio.source} ${drawio.tried[0]} is not executable - render refuses it; fix or unset ${drawio.source}`]);
  } else {
    // A PATH can run to dozens of directories; one line for those keeps the
    // install locations readable. `drawio render` still names every one.
    const dirs = drawio.onPath.length;
    rows.push([WARN, drawioLabel, 'not found - optional, generation and validation work without it', [
      ...(dirs ? [`tried drawio in ${dirs} PATH director${dirs === 1 ? 'y' : 'ies'}`] : []),
      ...drawio.tried.filter((p) => !drawio.onPath.includes(p)).map((p) => `tried ${p}`),
    ]]);
  }

  const display = displayFor(probe);
  if (display.needed) {
    const label = 'display (draw.io render)';
    const why = display.stale ? `DISPLAY ${display.stale} has no X server here` : 'no DISPLAY';
    if (display.display) rows.push([OK, label, `DISPLAY ${display.display}`]);
    else if (display.xvfb) rows.push([OK, label, `${why}; render runs under ${display.xvfb}`]);
    else rows.push([WARN, label, `${why}, and no xvfb-run on PATH - a Draw.io export fails; sudo apt install -y xvfb`]);
  }

  const browser = locateBrowser(undefined, probe);
  const browserLabel = 'browser (excalidraw PNG)';
  if (browser.path) rows.push([OK, browserLabel, `${browser.path} (${browser.source})`]);
  else if (browser.source) {
    rows.push([WARN, browserLabel, `${browser.error} - a PNG render refuses it; fix or unset ${browser.source}. --format svg needs no browser`]);
  } else {
    rows.push([WARN, browserLabel, `no Edge, Chrome or Chromium - optional, --format svg needs no browser (tried ${browser.tried.length} paths)`]);
  }
  return rows;
}

// The local Excalidraw app needs the docker CLI, its Compose plugin, a local
// engine that is running and the compose file; `docker --version` answered
// only the first (#307). A remote engine is named, never contacted.
export function dockerRow(root, { env = process.env, exists = existsSync, run } = {}) {
  // No shell, so a timeout kills docker itself and not a cmd.exe above it; and
  // from home, so a probe that outlives doctor holds no folder of the caller's
  // open. A slow engine left docker.exe in the cwd and CI could not delete it.
  run ??= (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', env, timeout: 5000, windowsHide: true, cwd: homedir() });
  const label = 'excalidraw app (docker)';
  const cli = run('docker', ['--version']);
  if (cli.status !== 0) return [WARN, label, 'docker not found - optional, needed only to open the real Excalidraw'];
  const have = [firstLine(cli.stdout)];
  const missing = [];
  const compose = run('docker', ['compose', 'version', '--short']);
  if (compose.status === 0) have.push(`Compose ${firstLine(compose.stdout)}`);
  else missing.push('no Compose plugin: `docker compose version` failed');
  const host = env.DOCKER_HOST || firstLine(run('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).stdout);
  if (host && !/^(unix|npipe):/.test(host)) missing.push(`the engine is remote (${host}); not checked`);
  else {
    const server = run('docker', ['version', '--format', '{{.Server.Version}}']);
    if (server.status === 0 && firstLine(server.stdout)) have.push(`engine ${firstLine(server.stdout)}`);
    else missing.push('the local engine is not running: start Docker Desktop or the docker service');
  }
  const file = join(root, 'docker', 'docker-compose.yml');
  if (!exists(file)) missing.push(`no compose file at ${file}`);
  return missing.length ? [WARN, label, have.join(', '), missing] : [OK, label, `${have.join(', ')}; ${relative(root, file)}`];
}

// The adapters `arkitect install` wrote into this project, and where each
// points. Moving or removing an install strands them, and an agent is then
// sent to code that is not there (#310). Only Arkitect's own blocks are read.
export function adapterRow(root, cwd, { read = (p) => readFileSync(p, 'utf8'), exists = existsSync, platform = process.platform } = {}) {
  const same = (a, b) => (platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));
  const found = [];
  for (const adapter of Object.values(ADAPTERS)) {
    const path = join(cwd, adapter.file);
    if (!exists(path)) continue;
    let text;
    try { text = read(path); } catch { continue; }
    const i = text.indexOf(BEGIN);
    const j = text.indexOf(END);
    const block = adapter.merge ? (i !== -1 && j > i ? text.slice(i, j) : '') : text;
    const at = /Arkitect[^`]*installed at `([^`]+)`/.exec(block)?.[1];
    if (at) found.push({ file: adapter.file, at });
  }
  const label = 'project adapters';
  if (!found.length) return [OK, label, `none in ${cwd}`];
  const stale = found.filter((f) => !same(f.at, root));
  if (!stale.length) return [OK, label, `${found.map((f) => f.file).join(', ')} point${found.length === 1 ? 's' : ''} here`];
  return [WARN, label, `${stale.length} of ${found.length} point${stale.length === 1 ? 's' : ''} elsewhere; \`arkitect install\` here rewrites them`,
    stale.map((f) => (exists(join(f.at, 'bin', 'arkitect.mjs'))
      ? `${f.file} -> another install, ${f.at}` : `${f.file} -> ${f.at}, which is gone`))];
}

export async function doctor({ root, cwd = process.cwd(), env = process.env, platform = process.platform,
  arch = process.arch, node = process.versions.node, log = console.log } = {}) {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const rows = [
    [Number(node.split('.')[0]) >= 20 ? OK : FAIL, 'node >= 20', `found v${node}`],
    ...assetRows(root),
    ...await styleRows(root, env),
    ...await rendererRows(root, { platform, env }),
    dockerRow(root, { env }),
    adapterRow(root, cwd, { platform }),
  ];

  log(`arkitect ${version} at ${root} (${platform} ${arch})\n`);
  const width = Math.max(...rows.map((r) => r[1].length));
  for (const [status, label, detail, more = []] of rows) {
    log(`${status.padEnd(4)}  ${label.padEnd(width)}  ${detail}`);
    for (const line of more) log(`${' '.repeat(width + 8)}${line}`);
  }
  const failed = rows.filter((r) => r[0] === FAIL).length;
  log(`\nNode and the bundled assets are required${failed ? `, and ${failed} failed: exit 1` : ''}. `
    + 'The rest only widens what you can see.');
  log('Artwork is not hashed here; `arkitect drawio packs --verify` checks it against the pins.');
  return failed ? 1 : 0;
}
