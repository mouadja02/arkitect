#!/usr/bin/env node
// Cuts a release in two halves, each run by a workflow a person starts (#88).
//
//   node scripts/release.mjs prepare <patch|minor|major> [--date <iso-date>]
//       bump package.json and .claude-plugin/plugin.json together, then roll
//       [Unreleased] into a dated section. Refuses an empty [Unreleased]: run
//       `draft` first. Prints the new version.
//   node scripts/release.mjs empty
//       exit 0 when [Unreleased] has no entry, 1 when it has one.
//   node scripts/release.mjs draft
//       fill an empty [Unreleased] from the commits since the last release, by
//       one OpenAI-compatible chat completion. RELEASE_LLM_BASE_URL,
//       RELEASE_LLM_MODEL and RELEASE_LLM_API_KEY; any of them missing fails.
//   node scripts/release.mjs notes <X.Y.Z>
//       print that version's CHANGELOG section, verbatim, for the release body.
//   node scripts/release.mjs check <X.Y.Z>
//       fail unless both manifests carry that version.
//
// Nothing here tags, pushes or publishes; the workflows do that in the open.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = {
  changelog: join(ROOT, 'CHANGELOG.md'),
  pkg: join(ROOT, 'package.json'),
  plugin: join(ROOT, '.claude-plugin', 'plugin.json'),
};
export const HEADINGS = ['Added', 'Changed', 'Removed', 'Fixed'];
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function nextVersion(current, bump) {
  const m = SEMVER.exec(current);
  if (!m) throw new Error(`"${current}" is not a plain X.Y.Z version`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`bump must be patch, minor or major, not "${bump}"`);
}

// The [Unreleased] section: where its body starts and ends in the file.
function unreleasedSpan(changelog) {
  const head = /^## \[Unreleased\][^\n]*\n/m.exec(changelog);
  if (!head) throw new Error('CHANGELOG.md has no ## [Unreleased] section');
  const start = head.index + head[0].length;
  const next = changelog.slice(start).search(/^## \[/m);
  return { headStart: head.index, start, end: next === -1 ? changelog.length : start + next };
}

export const unreleasedBody = (changelog) => {
  const { start, end } = unreleasedSpan(changelog);
  return changelog.slice(start, end);
};

// Empty means no bullet: bare headings left over from the last release count as nothing.
export const isEmpty = (changelog) => !/^\s*[-*] \S/m.test(unreleasedBody(changelog));

// Renames [Unreleased] to the version and date, with a fresh empty one above.
// Purely mechanical: it never writes an entry.
export function rollChangelog(changelog, version, date) {
  if (!SEMVER.test(version)) throw new Error(`"${version}" is not a plain X.Y.Z version`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`"${date}" is not a full ISO date`);
  if (new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(changelog)) {
    throw new Error(`CHANGELOG.md already has a ${version} section`);
  }
  if (isEmpty(changelog)) throw new Error('[Unreleased] has no entries; draft them first');
  const { headStart, start, end } = unreleasedSpan(changelog);
  const body = changelog.slice(start, end).replace(/\s+$/, '');
  return `${changelog.slice(0, headStart)}## [Unreleased]\n\n## [${version}] — ${date}\n${body}\n\n${changelog.slice(end)}`;
}

// A version's section body, exactly as written, without its heading.
export function sectionFor(changelog, version) {
  const head = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\][^\\n]*\\n`, 'm').exec(changelog);
  if (!head) throw new Error(`CHANGELOG.md has no ${version} section`);
  const start = head.index + head[0].length;
  const next = changelog.slice(start).search(/^## \[/m);
  return changelog.slice(start, next === -1 ? changelog.length : start + next).trim();
}

// The date the newest released section records, to anchor a first run before any tag.
export function lastReleaseDate(changelog) {
  const m = /^## \[\d+\.\d+\.\d+\] — (\d{4}-\d{2}-\d{2})/m.exec(changelog);
  return m ? m[1] : null;
}

// Models answer with LF or CRLF; the changelog is LF.
const lf = (text) => text.replace(/\r\n?/g, '\n');

// A draft is accepted only in the house shape: known headings, one-line bullets.
export function draftProblems(draft) {
  const problems = [];
  const lines = lf(draft).trim().split('\n');
  let heading = null;
  let bullets = 0;
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    const h = /^### (\w+)$/.exec(line);
    if (h) {
      if (!HEADINGS.includes(h[1])) problems.push(`line ${i + 1}: unknown heading "${h[1]}"`);
      heading = h[1];
      continue;
    }
    if (/^- \S/.test(line)) {
      if (!heading) problems.push(`line ${i + 1}: a bullet before any heading`);
      bullets++;
      continue;
    }
    if (/^  \S/.test(line) && heading) continue; // a bullet wrapped onto a second line
    problems.push(`line ${i + 1}: not a heading or a bullet: ${line.slice(0, 60)}`);
  }
  if (!bullets) problems.push('no bullets');
  return problems;
}

export function insertDraft(changelog, draft) {
  if (!isEmpty(changelog)) throw new Error('[Unreleased] already has entries; a draft only fills an empty one');
  const problems = draftProblems(draft);
  if (problems.length) throw new Error(`the drafted changelog is not in the house style:\n  ${problems.join('\n  ')}`);
  const { start, end } = unreleasedSpan(changelog);
  return `${changelog.slice(0, start)}\n${lf(draft).trim()}\n\n${changelog.slice(end)}`;
}

export function draftMessages(commits, examples) {
  return [
    {
      role: 'system',
      content: 'You write the [Unreleased] section of this repository\'s CHANGELOG.md from its commit messages. '
        + `Use only these headings, in this order, and only those that have entries: ${HEADINGS.map((h) => `### ${h}`).join(', ')}. `
        + 'Under each, one bullet per user-visible change, starting "- ", in the present tense, '
        + 'naming what changed and the issue or PR number in parentheses when a commit names one. '
        + 'Wrap long bullets at 80 columns with two-space continuation lines. No justification, no marketing, '
        + 'no entries for status snapshots, merges or pure test and docs upkeep. Output the section body only, '
        + 'with no ## heading and no code fence.\n\nExamples of the house style:\n\n'
        + examples,
    },
    { role: 'user', content: `Commits since the last release:\n\n${commits}` },
  ];
}

export async function callModel({ baseUrl, model, apiKey, messages, fetchImpl = fetch }) {
  const missing = Object.entries({ RELEASE_LLM_BASE_URL: baseUrl, RELEASE_LLM_MODEL: model, RELEASE_LLM_API_KEY: apiKey })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`cannot draft the changelog: ${missing.join(', ')} not set`);
  const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.2 }),
  });
  if (!res.ok) throw new Error(`the model call failed: ${res.status} ${res.statusText}`);
  const text = (await res.json())?.choices?.[0]?.message?.content;
  if (!text?.trim()) throw new Error('the model returned no text');
  return lf(text).replace(/^```\w*\n|\n```\s*$/g, '').trim();
}

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

function commitsSinceRelease(changelog) {
  let range;
  try { range = [`${git('describe', '--tags', '--abbrev=0')}..HEAD`]; } catch {
    const since = lastReleaseDate(changelog);
    range = since ? [`--since=${since}`, 'HEAD'] : ['HEAD'];
  }
  return git('log', '--no-merges', '--format=%s%n%b%n---', ...range);
}

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const writeJson = (f, v) => writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`);

async function main([command, arg, ...rest]) {
  const changelog = readFileSync(FILES.changelog, 'utf8');
  if (command === 'empty') process.exit(isEmpty(changelog) ? 0 : 1);
  if (command === 'notes') { process.stdout.write(`${sectionFor(changelog, arg)}\n`); return; }
  if (command === 'check') {
    const found = [readJson(FILES.pkg).version, readJson(FILES.plugin).version];
    if (found.some((v) => v !== arg)) throw new Error(`manifests say ${found.join(' and ')}, not ${arg}`);
    console.log(`ok  ${arg}`);
    return;
  }
  if (command === 'draft') {
    const commits = commitsSinceRelease(changelog);
    if (!commits) throw new Error('no commits since the last release: nothing to draft');
    const newest = /^## \[(\d+\.\d+\.\d+)\]/m.exec(changelog)?.[1];
    const examples = newest ? sectionFor(changelog, newest).split('\n').slice(0, 40).join('\n') : '';
    const draft = await callModel({
      baseUrl: process.env.RELEASE_LLM_BASE_URL, model: process.env.RELEASE_LLM_MODEL,
      apiKey: process.env.RELEASE_LLM_API_KEY, messages: draftMessages(commits, examples),
    });
    writeFileSync(FILES.changelog, insertDraft(changelog, draft));
    console.log(draft);
    return;
  }
  if (command === 'prepare') {
    const dateAt = rest.indexOf('--date');
    const date = dateAt === -1 ? new Date().toISOString().slice(0, 10) : rest[dateAt + 1];
    const pkg = readJson(FILES.pkg);
    const plugin = readJson(FILES.plugin);
    if (pkg.version !== plugin.version) throw new Error(`package.json says ${pkg.version}, plugin.json ${plugin.version}`);
    const version = nextVersion(pkg.version, arg);
    const rolled = rollChangelog(changelog, version, date);
    pkg.version = version;
    plugin.version = version;
    writeJson(FILES.pkg, pkg);
    writeJson(FILES.plugin, plugin);
    writeFileSync(FILES.changelog, rolled);
    console.log(version);
    return;
  }
  console.error('usage: release.mjs prepare <patch|minor|major> [--date <iso-date>] | empty | draft | notes <X.Y.Z> | check <X.Y.Z>');
  process.exit(2);
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exit(1); });
}
