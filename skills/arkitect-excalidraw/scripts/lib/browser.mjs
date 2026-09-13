// Headless Chromium for PNG previews (#39).
//
// Edge, Chrome or Chromium, whichever is installed: nothing is downloaded and
// nothing leaves the machine. The page rendered is a local SVG inside a
// zero-margin wrapper, in a throwaway profile that is removed afterwards, pass
// or fail. A screenshot counts only once it is on disk, non-empty and starts
// with the PNG signature; Chromium's stderr is not evidence either way.

import { accessSync, constants, statSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TIMEOUT = 120000;
// Chromium refuses windows past 16384px, and a PNG that large is not readable anyway.
const MAX_VIEWPORT = 16000;

const PATH_NAMES = {
  win32: ['msedge.exe', 'chrome.exe'],
  posix: ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'microsoft-edge', 'microsoft-edge-stable'],
};

const INSTALL_LOCATIONS = {
  win32: (env) => [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean).flatMap((root) => [
    win32.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    win32.join(root, 'Chromium', 'Application', 'chrome.exe'),
  ]),
  darwin: () => [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: () => [
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/microsoft-edge', '/snap/bin/chromium', '/opt/google/chrome/chrome',
  ],
};

function executable(path, platform) {
  try {
    accessSync(path, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// The browser a PNG render uses, how it was found, and every path tried.
// --browser and ARKITECT_BROWSER are pins, like DRAWIO_EXE: an unusable pin
// fails naming it rather than rendering with some other browser.
export function locateBrowser(override, { platform = process.platform, env = process.env,
  isExecutable = (p) => executable(p, platform) } = {}) {
  const explicit = override ?? env.ARKITECT_BROWSER;
  if (explicit) {
    const source = override ? '--browser' : 'ARKITECT_BROWSER';
    return isExecutable(explicit)
      ? { path: explicit, source, tried: [explicit] }
      : { path: null, source, tried: [explicit], error: `${source} ${explicit} is not executable` };
  }
  const windows = platform === 'win32';
  const dirs = (env.PATH ?? env.Path ?? '').split(windows ? ';' : ':').filter(Boolean);
  const onPath = dirs.flatMap((dir) => PATH_NAMES[windows ? 'win32' : 'posix']
    .map((name) => (windows ? win32 : posix).join(dir.replace(/^"|"$/g, ''), name)));
  const installs = (INSTALL_LOCATIONS[platform] ?? INSTALL_LOCATIONS.linux)(env);
  const tried = [];
  for (const candidate of new Set([...onPath, ...installs])) {
    tried.push(candidate);
    if (isExecutable(candidate)) return { path: candidate, source: onPath.includes(candidate) ? 'PATH' : 'install location', tried };
  }
  return { path: null, source: null, tried, error: 'no Edge, Chrome or Chromium found' };
}

// Where the page, profile and screenshot go. A snap-packaged Chromium - what
// Ubuntu installs, including behind /usr/bin/chromium-browser - gets a private
// /tmp and cannot see the host's, so it would render nothing and write its
// screenshot where we cannot read it. Its own data directory is reachable from
// both sides, so a snap works there; everything else uses the system temp dir.
export function workRootFor(browser, { platform = process.platform, env = process.env,
  readHead = (p) => readFileSync(p).subarray(0, 4096).toString('latin1') } = {}) {
  if (platform !== 'linux' || !env.HOME) return tmpdir();
  let snap = browser.startsWith('/snap/');
  if (!snap) {
    try { snap = /\/snap\/bin\/|\bsnap run\b/.test(readHead(browser)); } catch { snap = false; }
  }
  const name = /^\/snap\/bin\/([\w-]+)/.exec(browser)?.[1] ?? 'chromium';
  return snap ? join(env.HOME, 'snap', name, 'common') : tmpdir();
}

// The browser's output goes to a file, never a pipe. A piped child only counts
// as finished once every process holding the pipe has closed it, and
// Chromium's helpers can outlive the browser holding it open, so the call would
// return only when the timeout killed it.
const runBrowser = (exe, args, { timeout, log }) => {
  const fd = openSync(log, 'w');
  try {
    return execFileSync(exe, args, { stdio: ['ignore', fd, fd], timeout });
  } finally {
    closeSync(fd);
  }
};

// The last of what the browser printed, for a failure message.
const said = (log) => {
  try {
    const text = readFileSync(log, 'utf8').trim().split('\n').slice(-3).join(' | ').slice(-400);
    return text ? ` (browser said: ${text})` : '';
  } catch {
    return '';
  }
};

// Screenshots an SVG document whose root carries its width and height in CSS
// pixels, `width` pixels wide. Returns the PNG bytes and their dimensions, or
// throws saying why. `runner` stands in for the browser in the tests.
export function rasteriseSvg(svg, { browser, width, noSandbox = false, runner = runBrowser, timeout = TIMEOUT, workRoot = tmpdir() }) {
  const size = /<svg\b[^>]*?\swidth="([\d.]+)"[^>]*?\sheight="([\d.]+)"/.exec(svg);
  if (!size) throw new Error('the SVG carries no width and height to size the screenshot by');
  const w = Math.max(1, Math.ceil(Number(size[1])));
  const h = Math.max(1, Math.ceil(Number(size[2])));
  // The SVG is drawn as a vector at the output size, in a window of that size at
  // scale factor 1. Shrinking with --force-device-scale-factor instead is
  // clamped by some builds (snap Chromium would not go below 0.5), which
  // silently gave a PNG wider than asked.
  const outH = Math.max(1, Math.round((h * width) / w));
  if (width > MAX_VIEWPORT || outH > MAX_VIEWPORT) {
    throw new Error(`a ${width}x${outH}px screenshot is past Chromium's ${MAX_VIEWPORT}px limit; use a smaller --width`);
  }
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, 'arkitect-render-'));
  try {
    const svgPath = join(work, 'scene.svg');
    const page = join(work, 'page.html');
    const shot = join(work, 'shot.png');
    const browserLog = join(work, 'browser.log');
    writeFileSync(svgPath, svg);
    // Chromium puts an 8px body margin round a bare SVG, shifting and clipping it.
    writeFileSync(page, '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}img{display:block}</style>'
      + `<img src="${pathToFileURL(svgPath).href}" width="${width}" height="${outH}">`);
    const args = [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      '--disable-crash-reporter', '--force-device-scale-factor=1', `--user-data-dir=${join(work, 'profile')}`,
      `--window-size=${width},${outH}`, `--screenshot=${shot}`,
      ...(noSandbox ? ['--no-sandbox'] : []),
      pathToFileURL(page).href,
    ];
    try {
      runner(browser, args, { timeout, log: browserLog });
    } catch (error) {
      const timedOut = error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM';
      const reason = timedOut ? `the browser timed out after ${timeout / 1000}s` : `the browser failed: ${String(error.message).split('\n')[0]}`;
      throw new Error(`${reason}${said(browserLog)}`);
    }
    let bytes;
    try { bytes = readFileSync(shot); } catch { throw new Error(`the browser exited without writing a screenshot${said(browserLog)}`); }
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString('latin1', 12, 16) !== 'IHDR') {
      throw new Error('the screenshot is empty or not a PNG');
    }
    return { bytes, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } finally {
    // Chromium's helpers can hold the profile open for a moment after it exits.
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
