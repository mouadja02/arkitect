#!/usr/bin/env node
// Render an icon pack as a labelled grid, so a human can see what actually got
// built. Structural checks prove a library parses and hashes; they cannot
// notice that "Cloud Run" is wearing Cloud Scheduler's artwork. That needs eyes.
//
//   node contact-sheet.mjs --pack devops                   write the HTML sheet
//   node contact-sheet.mjs --pack devops --png             rasterise it instead
//   node contact-sheet.mjs --pack devops --png --keep-html ...and keep the HTML
//   node contact-sheet.mjs --all --png                     every pack worth reviewing
//
// The HTML is local and self-contained: every icon is already a data URI in the
// library, so nothing is fetched while the sheet renders.
//
// Chrome needs a profile directory, and a profile holds cookies, history and
// login data. It lives in a temporary directory that is removed after every
// shot, pass or fail, so the only thing a PNG run adds to the skill is the PNG.

import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { readLibrary } from './lib/drawio-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = join(HERE, '..');
const LIB_DIR = join(SKILL_ROOT, 'assets', 'libraries');
const SHEET_DIR = join(LIB_DIR, 'contact-sheets');
const CATALOG_FILE = join(SKILL_ROOT, 'references', 'icon-catalog.json');

// The catch-all is 3,000+ marks from one CC0 source at a pinned version; a sheet
// of it would be megabytes of PNG telling you what the pin already tells you.
const SKIP = new Set(['brands']);

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHROME_TIMEOUT = 120000;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function sheetHtml(pack, entries) {
  const cells = entries.map((e, i) => `<figure><img src="${e.dataUri}" alt="${esc(e.title)}">`
    + `<figcaption><b>${esc(e.title)}</b><span>${i}</span></figcaption></figure>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>${esc(pack.title)} contact sheet</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 28px 32px 40px; background: #fff;
         font: 13px/1.45 "Segoe UI", system-ui, sans-serif; color: #1b2733; }
  header { margin-bottom: 22px; border-bottom: 2px solid #e3e9ef; padding-bottom: 14px; }
  h1 { margin: 0 0 4px; font-size: 20px; letter-spacing: -0.01em; }
  .meta { color: #5b6b7c; font-size: 12.5px; }
  .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 14px 10px; }
  figure { margin: 0; display: flex; flex-direction: column; align-items: center;
           gap: 6px; padding: 10px 4px 8px; border: 1px solid #edf1f5; border-radius: 8px; }
  img { width: 56px; height: 56px; object-fit: contain; }
  figcaption { text-align: center; font-size: 10.5px; line-height: 1.3; color: #35485c;
               word-break: break-word; display: flex; flex-direction: column; gap: 1px; }
  figcaption span { color: #9aa8b6; font-size: 9px; }
</style>
<header><h1>${esc(pack.title)}</h1>
<div class="meta">${entries.length} icons &middot; <code>${esc(pack.file)}</code> &middot; ${esc(pack.description ?? '')}</div></header>
<div class="grid">${cells}</div>`;
}

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  return null;
}

const runChrome = (exe, args) => execFileSync(exe, args, { stdio: 'pipe', timeout: CHROME_TIMEOUT });

// Older versions kept Chrome's profile here. Nothing uses it now; say so, but
// never delete a directory this run did not create.
export function staleProfile(sheetDir = SHEET_DIR) {
  const legacy = join(sheetDir, '.shot');
  return existsSync(legacy) ? legacy : null;
}

// Screenshot the sheet into a scratch directory and copy it over `pngPath` only
// once it is a real PNG. A crash, a timeout or an empty screenshot leaves the
// previous sheet exactly as it was, and can never pass for a fresh one.
export function rasterise(html, pngPath, height, { chrome, runner = runChrome } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'arkitect-sheet-'));
  try {
    const htmlPath = join(work, 'sheet.html');
    const shot = join(work, 'sheet.png');
    writeFileSync(htmlPath, html);
    try {
      runner(chrome, [
        '--headless', '--disable-gpu', '--hide-scrollbars',
        `--screenshot=${shot}`,
        `--window-size=1600,${Math.min(height, 30000)}`,
        `--user-data-dir=${join(work, 'profile')}`,
        pathToFileURL(htmlPath).href,
      ]);
    } catch (error) {
      const timedOut = error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM';
      return { ok: false, error: timedOut ? `Chrome timed out after ${CHROME_TIMEOUT / 1000}s` : `Chrome failed: ${String(error.message).split('\n')[0]}` };
    }
    if (!existsSync(shot)) return { ok: false, error: 'Chrome exited without writing a screenshot' };
    const bytes = readFileSync(shot);
    if (bytes.length <= PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      return { ok: false, error: 'the screenshot is empty or not a PNG' };
    }
    copyFileSync(shot, pngPath);
    return { ok: true };
  } finally {
    // Chrome's helpers can hold the profile open for a moment after it exits.
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

export function build(packId, { png = false, keepHtml = false, sheetDir = SHEET_DIR, chrome = findChrome(), runner } = {}) {
  const catalog = JSON.parse(readFileSync(CATALOG_FILE, 'utf8'));
  const pack = catalog.packs.find((p) => p.id === packId);
  if (!pack) throw new Error(`no pack "${packId}" in the catalog`);

  const entries = readLibrary(join(LIB_DIR, pack.file));
  const html = sheetHtml(pack, entries);
  mkdirSync(sheetDir, { recursive: true });
  const result = { pack, count: entries.length, htmlPath: null, pngPath: null, error: null, note: null };
  const writeHtml = () => { result.htmlPath = join(sheetDir, `${packId}.html`); writeFileSync(result.htmlPath, html); };

  // Without --png the HTML is what was asked for.
  if (!png) { writeHtml(); return result; }
  if (!chrome) {
    writeHtml();
    result.note = 'no Chrome found - open the HTML yourself to review it';
    return result;
  }

  // 12 across, ~104px per row, plus the header.
  const height = 140 + Math.ceil(entries.length / 12) * 104;
  const pngPath = join(sheetDir, `${packId}.png`);
  const shot = rasterise(html, pngPath, height, { chrome, runner });
  if (shot.ok) result.pngPath = pngPath;
  else result.error = shot.error;
  if (keepHtml) writeHtml();
  return result;
}

function main(argv) {
  const png = argv.includes('--png');
  const keepHtml = argv.includes('--keep-html');
  const catalog = JSON.parse(readFileSync(CATALOG_FILE, 'utf8'));
  const ids = argv.includes('--all')
    ? catalog.packs.map((p) => p.id).filter((id) => !SKIP.has(id))
    : [argv[argv.indexOf('--pack') + 1]].filter(Boolean);

  if (!ids.length) {
    console.error('usage: contact-sheet.mjs (--pack <id> | --all) [--png [--keep-html]]');
    process.exit(2);
  }

  const stale = staleProfile();
  if (stale) {
    console.warn(`warning: ${stale} is a Chrome profile (cookies, history, login data) left by an older\n`
      + '         contact-sheet.mjs. Nothing uses it any more - delete it.\n');
  }

  let failed = 0;
  for (const id of ids) {
    const r = build(id, { png, keepHtml });
    const head = `  ${id.padEnd(26)} ${String(r.count).padStart(5)} icons  -> `;
    if (r.error) {
      failed++;
      console.log(`${head}FAILED: ${r.error}`);
      continue;
    }
    const wrote = [r.pngPath, r.htmlPath].filter(Boolean).map((p) => `contact-sheets/${basename(p)}`);
    console.log(`${head}${wrote.join(' + ')}${r.note ? `  (${r.note})` : ''}`);
  }
  if (SKIP.size && argv.includes('--all')) {
    console.log(`\nskipped: ${[...SKIP].join(', ')} (catch-all packs, see sources.json for the pin)`);
  }
  if (failed) {
    console.error(`\n${failed} sheet${failed === 1 ? '' : 's'} failed; the existing PNG for each is unchanged.`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('contact-sheet.mjs')) main(process.argv.slice(2));
