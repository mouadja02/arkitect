// Shared backup naming and retention for both diagram engines.

import { existsSync, copyFileSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, constants } from 'node:fs';
import { dirname, join, basename, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A backup is created exclusively and never replaces an earlier one. Two updates
// inside the same second get `-1`, `-2`, ... instead of the second copy
// overwriting the first, which is how the original used to be lost (#35). The
// counter continues from the highest one already used that second instead of
// filling a gap: retention deletes old backups (#49), and a reused low counter
// would make the newest copy sort among the oldest and be pruned at once.
// `now` exists so a test can pin the clock.
const MAX_BACKUPS_PER_SECOND = 1000;
const quoteRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `kept: true` names it `<stem>.backup-<stamp>-kept<ext>`, which retention
// never matches: the builders pass it when the file holds work the build drops
// (#376).
export function backupExisting(path, { now = new Date(), kept = false } = {}) {
  if (!existsSync(path)) return null;
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const ext = extname(path);
  const name = `${basename(path, ext)}.backup-${stamp}${kept ? '-kept' : ''}`;
  const sameSecond = new RegExp(`^${quoteRe(name)}(?:-([1-9]\\d*))?${quoteRe(ext)}$`);
  let first = 0;
  for (const entry of readdirSync(dirname(path))) {
    const m = sameSecond.exec(entry);
    if (m) first = Math.max(first, Number(m[1] ?? 0) + 1);
  }
  for (let n = first; n < MAX_BACKUPS_PER_SECOND; n++) {
    const backup = join(dirname(path), `${name}${n ? `-${n}` : ''}${ext}`);
    try {
      copyFileSync(path, backup, constants.COPYFILE_EXCL);
      return backup;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`no free backup name for ${path}: ${MAX_BACKUPS_PER_SECOND} already exist for ${stamp}`);
}

// Asked to add one node to a .drawio someone drew, an agent wrote a spec for
// the whole diagram and built over it; the user's corners and colours came
// back in the house style and the report said it had followed the file
// (#339). The backup was the only trace. So a builder asks, before its
// backup, whether the file it replaces carries the engine's sign of an
// Arkitect build (`isOurs(text)`), and when it does not, its report says what
// was lost and where the original went. Never refused: rebuilding a diagram
// that was drawn by hand can be what the user asked for.
export function replacesForeign(path, isOurs) {
  if (!existsSync(path)) return false;
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return false; }
  try { return !isOurs(text); } catch { return true; }
}

export const foreignNote = (path, backup) => `${path} carries no sign of an Arkitect build, so its own styling, `
  + `positions and anything drawn by hand were replaced by this build; the original is at ${backup}. To change a `
  + 'diagram someone drew, edit it in place instead, as references/editing.md says, and say so in the report';

// A file Arkitect built and someone then added to passes as Arkitect's own, so
// a rebuild dropped the added shapes with nothing said, and retention deleted
// the one backup holding them a few rebuilds later (#376). Each builder lists
// what the replaced file has that its build does not draw, `{ id, label }`,
// and backs the file up under a name retention never deletes.
export const droppedNote = (path, backup, dropped) => {
  const shown = dropped.slice(0, 10).map((d) => `"${d.id}"${d.label ? ` (${d.label})` : ''}`).join(', ');
  const more = dropped.length > 10 ? ` and ${dropped.length - 10} more` : '';
  return `${path} held ${dropped.length} shape${dropped.length > 1 ? 's' : ''} this build does not draw, added since it `
    + `was built or dropped from the spec: ${shown}${more}. The replaced file is kept at ${backup}, which retention never `
    + 'deletes. To change a diagram someone touched, edit it in place as references/editing.md says, and say so in the report';
};

// Retention (#49). Every rebuild leaves a backup, so a build-look-fix loop used
// to leave ten or twenty beside the user's diagram. After a successful write
// the builder keeps the newest `keep` backups of that target plus the oldest -
// usually the person's own version from before an agent started - and deletes
// the rest. Only names backupExisting writes for this exact target count
// (`<stem>.backup-YYYYMMDD-HHMMSS[-n]<ext>`); nothing else is ever touched,
// a `-kept` backup holding work a build dropped included (#376).
// `keep: 0` keeps everything. Returns the deleted paths.
export const DEFAULT_KEEP_BACKUPS = 5;

export function pruneBackups(path, { keep = DEFAULT_KEEP_BACKUPS } = {}) {
  if (!Number.isSafeInteger(keep) || keep < 0) throw new TypeError(`keep must be a non-negative whole number, got ${keep}`);
  const dir = dirname(path);
  if (keep === 0 || !existsSync(dir)) return [];
  const ext = extname(path);
  const own = new RegExp(`^${quoteRe(basename(path, ext))}\\.backup-(\\d{8}-\\d{6})(?:-([1-9]\\d*))?${quoteRe(ext)}$`);
  const backups = readdirSync(dir)
    .map((name) => { const m = own.exec(name); return m && { name, stamp: m[1], n: Number(m[2] ?? 0) }; })
    .filter(Boolean)
    // By name, not mtime: the stamp is UTC and the collision counter counts up,
    // so `-10` is newer than `-2` although it sorts before it as text.
    .sort((a, b) => (a.stamp < b.stamp ? -1 : a.stamp > b.stamp ? 1 : a.n - b.n));
  const pruned = [];
  for (const { name } of backups.slice(1, Math.max(1, backups.length - keep))) {
    const doomed = join(dir, name);
    try {
      if (!statSync(doomed).isFile()) continue;
      unlinkSync(doomed);
      pruned.push(doomed);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return pruned;
}

// Why an --out may not be written, or null. `analyze x.drawio --out x.drawio`
// put a JSON summary where the diagram was, with no backup, and `build` would
// write a diagram over its own spec (#349). `exts` is what the file must end
// in, `refuse` what it may not.
export const DIAGRAM_EXTS = ['.drawio', '.dio', '.excalidraw', '.excalidrawlib'];
const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const samePath = (a, b) => fold(resolve(a)) === fold(resolve(b));

// Two names for one file: a hard link, or a symlink, has its own path string,
// and `analyze a.drawio --out summary.json` through one replaced the diagram
// with its summary (#391). Identity is the device and inode, compared only
// when both exist.
const sameFile = (a, b) => {
  try {
    const [x, y] = [statSync(a, { bigint: true }), statSync(b, { bigint: true })];
    return x.ino !== 0n && x.dev === y.dev && x.ino === y.ino;
  } catch { return false; }
};

// The real path of a file that may not exist yet: its nearest existing folder,
// resolved through links, with the rest appended.
const realish = (p) => {
  const rest = [];
  let dir = resolve(p);
  for (;;) {
    try { return join(realpathSync(dir), ...rest); } catch {}
    const up = dirname(dir);
    if (up === dir) return resolve(p);
    rest.unshift(basename(dir));
    dir = up;
  }
};
const within = (dir, p) => {
  const r = relative(fold(dir), fold(p));
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
};

// A relative --out run from a skill folder wrote the user's diagram inside the
// install, which the next plugin or npm update replaces (#377). The suite's own
// scratch folder, gitignored, is the one place inside it a build may write.
export const INSTALL = realish(fileURLToPath(new URL('../../../../', import.meta.url)));
const SCRATCH = join(INSTALL, 'tests', 'output');
export const insideInstall = (out) => {
  const real = realish(out);
  return within(INSTALL, real) && !within(SCRATCH, real);
};

// `install: true` refuses an --out inside the install. The builders pass it
// unless --defaults is set, which the maintainer's template rebuild always is.
export function outProblem(out, { inputs = [], exts = null, refuse = [], install = false } = {}) {
  const input = inputs.find((file) => samePath(file, out) || sameFile(file, out));
  if (input) return `--out ${out} is the file this reads, ${input}; write somewhere else`;
  const ext = extname(out).toLowerCase();
  if (exts && !exts.includes(ext)) return `--out must end in ${exts.join(' or ')}, got "${ext}"`;
  if (refuse.includes(ext)) return `--out ${out} is a ${ext} diagram, not a place for this summary; write a .json`;
  if (install && insideInstall(out)) {
    return `--out ${out} is inside the Arkitect install (${INSTALL}), which an update replaces; `
      + 'write the diagram in the project, with a path from the project folder';
  }
  return null;
}

// The builders back up for you. A hand edit, a script or an MCP set_page does
// not, and "call backupExisting() or copy the file yourself" is two choices and
// an import - so the same protection is one command (#179). Both engines'
// scripts/backup.mjs are three lines over this.
const USAGE = `usage: backup.mjs <file>... [--keep-backups N]

Copies each file beside itself as <stem>.backup-YYYYMMDD-HHMMSS<ext> before you
edit it, then keeps the oldest backup of that file plus the newest N (default
${DEFAULT_KEEP_BACKUPS}; 0 keeps all) and deletes the rest. Prints each backup written.`;

export function backupCli(argv) {
  const files = [];
  let keep = DEFAULT_KEEP_BACKUPS;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') { console.log(USAGE); return 0; }
    if (arg === '--keep-backups') keep = Number(argv[++i]);
    else if (arg.startsWith('-')) { console.error(`unknown option: ${arg}`); console.error(USAGE); return 2; }
    else files.push(arg);
  }
  if (!files.length) { console.error(USAGE); return 2; }
  // Like the builders: a malformed count fails before anything is copied or
  // deleted, rather than halfway through the list (#49).
  if (!Number.isSafeInteger(keep) || keep < 0) {
    console.error(`--keep-backups must be a non-negative whole number, got ${keep}`);
    return 2;
  }
  const missing = files.filter((f) => !existsSync(f));
  if (missing.length) {
    for (const f of missing) console.error(`no such file: ${f}`);
    return 1;
  }
  for (const file of files) {
    console.log(backupExisting(file));
    const pruned = pruneBackups(file, { keep });
    if (pruned.length) console.log(`pruned ${pruned.length} older backup${pruned.length > 1 ? 's' : ''}`);
  }
  return 0;
}
