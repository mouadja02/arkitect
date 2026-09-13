#!/usr/bin/env node
// Changelog fragments (#32).
//
// Every pull request used to edit the same lines at the top of CHANGELOG.md's
// [Unreleased] section, so each merge after the first conflicted there, and a
// hand resolution could drop an entry or leave a conflict marker with nothing
// to catch it. A change now adds its own file under changelog.d/, and the
// fragments are folded into CHANGELOG.md when a release is cut.
//
//   node scripts/changelog.mjs --check                     every fragment is well formed
//   node scripts/changelog.mjs --assemble [--dry-run]      fold fragments into [Unreleased]
//   node scripts/changelog.mjs --require-fragment <base>   fail when bin/, skills/ or docs/
//                                                          changed since <base> without one
//   --root DIR   work on another checkout (default: this repository)
//
// Exit 0 clean, 1 with findings, 2 on a usage error. Maintainer tooling: it is
// outside package.json `files`, so it never ships.

import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Keep a Changelog's headings, in its order.
export const KINDS = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];
export const FRAGMENT_NAME = /^(\d+|nopr)-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
// The lines git writes into a conflicted file. `=======` is left out: on its own
// it is also a Markdown heading underline.
export const CONFLICT_MARKER = /^(?:<{7}|\|{7}|>{7})(?:[ \r]|$)/m;
// A change under these paths is one a reader of the release notes would notice.
export const NEEDS_FRAGMENT = /^(?:bin|skills|docs)\//;

const USAGE = 'usage: changelog.mjs --check | --assemble [--dry-run] | --require-fragment <base> [--root DIR]';

export function parseFragment(name, text) {
  const where = `changelog.d/${name}`;
  const problems = [];
  const named = FRAGMENT_NAME.exec(name);
  if (!named) problems.push(`${where}: name it <issue>-<slug>.md or nopr-<slug>.md, lower-case and hyphenated`);
  const src = String(text).replace(/\r\n/g, '\n');
  if (CONFLICT_MARKER.test(src)) problems.push(`${where}: carries a conflict marker`);

  const sections = [];
  let current = null;
  src.split('\n').forEach((line, i) => {
    const heading = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (heading) {
      if (heading[1] !== '###' || !KINDS.includes(heading[2])) {
        problems.push(`${where}:${i + 1}: "${line.trim()}" is not one of ${KINDS.map((k) => `### ${k}`).join(', ')}`);
        current = { kind: null, lines: [] };
        return;
      }
      if (sections.some((s) => s.kind === heading[2])) problems.push(`${where}:${i + 1}: ### ${heading[2]} appears twice`);
      current = { kind: heading[2], lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else if (line.trim()) {
      problems.push(`${where}:${i + 1}: text before the first ### heading`);
    }
  });

  if (!sections.length) problems.push(`${where}: no ### ${KINDS.join('/')} section`);
  for (const s of sections) {
    while (s.lines.length && !s.lines[0].trim()) s.lines.shift();
    while (s.lines.length && !s.lines.at(-1).trim()) s.lines.pop();
    if (!s.lines.length) problems.push(`${where}: ### ${s.kind} has no entry`);
    else if (!s.lines[0].startsWith('- ')) problems.push(`${where}: ### ${s.kind} must start with a "- " bullet`);
  }

  const issue = named && named[1] !== 'nopr' ? Number(named[1]) : null;
  if (issue !== null && !new RegExp(`#${issue}(?!\\d)`).test(src)) problems.push(`${where}: never mentions #${issue}`);
  return { name, issue, sections, problems };
}

// Issue order, then fragments with no issue, then by name.
const orderOf = (f) => (f.issue ?? Infinity);
const byIssue = (a, b) => orderOf(a) - orderOf(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function readFragments(root = ROOT) {
  const dir = join(root, 'changelog.d');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name !== 'README.md' && !name.startsWith('.'))
    .map((name) => (statSync(join(dir, name)).isFile()
      ? parseFragment(name, readFileSync(join(dir, name), 'utf8'))
      : { name, issue: null, sections: [], problems: [`changelog.d/${name}: a fragment is a file, not a directory`] }))
    .sort(byIssue);
}

// Folds fragments into [Unreleased]: each entry goes under its heading, after
// the entries already there, in issue order. A missing heading is created in
// Keep a Changelog order. Released sections are never touched.
export function assemble(changelog, fragments) {
  const bad = fragments.flatMap((f) => f.problems);
  if (bad.length) throw new Error(`refusing to assemble malformed fragments:\n  ${bad.join('\n  ')}`);
  const ordered = [...fragments].sort(byIssue);
  const lines = String(changelog).replace(/\r\n/g, '\n').split('\n');

  let start = lines.findIndex((l) => /^## \[Unreleased\]/.test(l));
  if (start === -1) {
    const firstRelease = lines.findIndex((l) => /^## /.test(l));
    start = firstRelease === -1 ? lines.length : firstRelease;
    lines.splice(start, 0, '## [Unreleased]', '');
  }
  const sectionEnd = () => {
    const i = lines.findIndex((l, j) => j > start && /^## /.test(l));
    return i === -1 ? lines.length : i;
  };

  for (const kind of KINDS) {
    const entries = ordered.flatMap((f) => f.sections.filter((s) => s.kind === kind).flatMap((s) => s.lines));
    if (!entries.length) continue;
    const end = sectionEnd();
    const heading = lines.findIndex((l, j) => j > start && j < end && l.trim() === `### ${kind}`);
    if (heading === -1) {
      const laterKinds = KINDS.slice(KINDS.indexOf(kind) + 1).map((k) => `### ${k}`);
      const later = lines.findIndex((l, j) => j > start && j < end && laterKinds.includes(l.trim()));
      const at = later === -1 ? end : later;
      const lead = lines[at - 1]?.trim() ? [''] : [];
      lines.splice(at, 0, ...lead, `### ${kind}`, '', ...entries, '');
      continue;
    }
    let blockEnd = lines.findIndex((l, j) => j > heading && /^##/.test(l));
    if (blockEnd === -1) blockEnd = lines.length;
    let at = blockEnd;
    while (at > heading + 1 && !lines[at - 1].trim()) at--;
    lines.splice(at, 0, ...(at === heading + 1 ? [''] : []), ...entries);
  }
  return lines.join('\n');
}

// The paths a pull request changed that call for a fragment, or null when it
// needs none or adds one. Editing the README or deleting a fragment is not
// adding one.
export function missingFragment(changes) {
  const touched = changes.filter((c) => NEEDS_FRAGMENT.test(c.path));
  if (!touched.length) return null;
  const added = changes.some((c) => c.status !== 'D' && /^changelog\.d\/(?!README\.md$)[^/]+$/.test(c.path));
  return added ? null : touched.map((c) => c.path);
}

function changedSince(root, base) {
  const r = spawnSync('git', ['diff', '--name-status', '--no-renames', `${base}...HEAD`], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git diff ${base}...HEAD failed: ${(r.stderr || r.error?.message || '').trim()}`);
  return r.stdout.split('\n').filter(Boolean).map((line) => {
    const [status, ...path] = line.split('\t');
    return { status: status[0], path: path.join('\t') };
  });
}

function main(argv) {
  let mode = null; let base = null; let root = ROOT; let dryRun = false;
  const usage = (why) => { console.error(`${why}\n${USAGE}`); return 2; };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') { console.log(USAGE); return 0; }
    if (arg === '--check' || arg === '--assemble' || arg === '--require-fragment') {
      if (mode) return usage(`${arg}: only one of --check, --assemble and --require-fragment`);
      mode = arg.slice(2);
      if (mode === 'require-fragment') {
        base = argv[++i];
        if (!base || base.startsWith('--')) return usage('--require-fragment needs a base ref');
      }
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--root') {
      root = argv[++i];
      if (!root || root.startsWith('--')) return usage('--root needs a directory');
    } else {
      return usage(`unknown argument ${arg}`);
    }
  }
  if (!mode) return usage('nothing to do');
  if (dryRun && mode !== 'assemble') return usage('--dry-run only applies to --assemble');

  const fragments = readFragments(root);
  const problems = fragments.flatMap((f) => f.problems);
  if (problems.length) {
    for (const p of problems) console.error(`FAIL  ${p}`);
    console.error('\nThe format is described in changelog.d/README.md.');
    return 1;
  }

  if (mode === 'check') {
    console.log(`ok  ${fragments.length} changelog fragment${fragments.length === 1 ? '' : 's'} well formed`);
    return 0;
  }

  if (mode === 'require-fragment') {
    let changes;
    try { changes = changedSince(root, base); } catch (error) { console.error(error.message); return 2; }
    const missing = missingFragment(changes);
    if (!missing) { console.log('ok  no fragment needed, or one is added'); return 0; }
    console.error(`FAIL  this change touches ${missing.length} file${missing.length === 1 ? '' : 's'} under bin/, skills/ or docs/ and adds no changelog fragment:`);
    for (const p of missing.slice(0, 10)) console.error(`        ${p}`);
    console.error('\nAdd changelog.d/<issue>-<slug>.md (see changelog.d/README.md), or label the pull request skip-changelog.');
    return 1;
  }

  if (!fragments.length) { console.log('nothing to assemble'); return 0; }
  const path = join(root, 'CHANGELOG.md');
  const next = assemble(readFileSync(path, 'utf8'), fragments);
  if (dryRun) { process.stdout.write(next); return 0; }
  writeFileSync(path, next);
  for (const f of fragments) rmSync(join(root, 'changelog.d', f.name));
  console.log(`assembled ${fragments.length} fragment${fragments.length === 1 ? '' : 's'} into CHANGELOG.md [Unreleased]; commit the deletions with it`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('changelog.mjs')) process.exit(main(process.argv.slice(2)));
