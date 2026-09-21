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

// ---------------------------------------------------------------- resuming
//
// A release is two workflows and a merge, and any step of either can fail after
// the one before it succeeded: a branch pushed and the pull request not opened,
// a tag pushed and the release not created. Re-running used to make it worse -
// prepare refused the branch it had pushed itself, publish tripped over its own
// tag - so a transient GitHub failure had to be repaired by hand (#120).
//
// Nothing below mutates anything. The workflow observes what is on the remote,
// these decide what a rerun should do, and the workflow acts on the answer. Two
// states are never papered over: a branch whose manifests disagree with the
// version, and a tag that points somewhere other than the merge commit. Both
// mean two different releases are in flight, and the fix is a person's - never
// a force-push, never a moved tag.

const ACTIONS = ['commit-push-open', 'open-only', 'tag-and-release', 'release-only', 'noop', 'conflict'];

export function prepareAction({ version, branchExists, branchVersion, tagExists, prState }) {
  const branch = `release/v${version}`;
  const say = (action, reason) => ({ action, reason });
  if (tagExists) {
    return say('conflict', `v${version} is already tagged, so it is already released; prepare the next version instead`);
  }
  if (!branchExists) return say('commit-push-open', `${branch} does not exist yet; this is a first run`);
  if (branchVersion !== version) {
    return say('conflict', `${branch} says ${branchVersion || 'nothing'}, not ${version}; settle that branch by hand before re-running`);
  }
  if (prState === 'MERGED') {
    return say('conflict', `${branch} is already merged; what is missing is the publish, not the prepare`);
  }
  if (prState === 'CLOSED') {
    return say('conflict', `the pull request for ${branch} was closed unmerged; re-open it yourself, or delete the branch and start again`);
  }
  if (prState === 'OPEN') return say('noop', `${branch} is pushed and its pull request is open; nothing to do`);
  return say('open-only', `${branch} is pushed and says ${version}, but has no pull request; opening one from the branch as it stands`);
}

export function publishAction({ version, tagSha, headSha, releaseExists }) {
  const say = (action, reason) => ({ action, reason });
  if (!headSha) return say('conflict', 'no merge commit to tag');
  if (tagSha && tagSha !== headSha) {
    return say('conflict', `v${version} already points at ${tagSha.slice(0, 12)}, not the merge commit ${headSha.slice(0, 12)}; a published tag is never moved`);
  }
  if (releaseExists && !tagSha) {
    return say('conflict', `a release v${version} exists with no tag behind it; settle that by hand`);
  }
  if (releaseExists) return say('noop', `v${version} is tagged at the merge commit and its release is published; nothing to do`);
  if (tagSha) return say('release-only', `v${version} is already tagged at the merge commit; only the release is missing`);
  return say('tag-and-release', `v${version} is not tagged yet; this is a first run`);
}

// GitHub step outputs, so a workflow can append the answer and branch on it.
// The reason is one line by construction - a newline here would end the value.
export function outputLines({ action, reason }) {
  if (!ACTIONS.includes(action)) throw new Error(`unknown action "${action}"`);
  return `action=${action}\nreason=${String(reason).replace(/\s+/g, ' ').trim()}\n`;
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
  // The next version, without writing anything. A rerun has to know which
  // version it is resuming before it may touch a file (#120).
  if (command === 'next') {
    const pkg = readJson(FILES.pkg);
    const plugin = readJson(FILES.plugin);
    if (pkg.version !== plugin.version) throw new Error(`package.json says ${pkg.version}, plugin.json ${plugin.version}`);
    console.log(nextVersion(pkg.version, arg));
    return;
  }
  if (command === 'resume-prepare' || command === 'resume-publish') {
    const flags = {};
    for (const [, key, value] of [arg, ...rest].join(' ').matchAll(/--([\w-]+)(?:[= ]([^-\s][^\s]*))?/g)) {
      flags[key] = value ?? '';
    }
    const decide = command === 'resume-prepare'
      ? prepareAction({
        version: flags.version,
        branchExists: flags.branch === 'true',
        branchVersion: flags['branch-version'] ?? '',
        tagExists: flags.tag === 'true',
        prState: (flags.pr ?? '').toUpperCase(),
      })
      : publishAction({
        version: flags.version,
        tagSha: flags['tag-sha'] ?? '',
        headSha: flags['head-sha'] ?? '',
        releaseExists: flags.release === 'true',
      });
    process.stdout.write(outputLines(decide));
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
  console.error('usage: release.mjs prepare <patch|minor|major> [--date <iso-date>] | next <patch|minor|major>'
    + ' | empty | draft | notes <X.Y.Z> | check <X.Y.Z>'
    + '\n       release.mjs resume-prepare --version X.Y.Z --branch <bool> --branch-version <X.Y.Z> --tag <bool> --pr <state>'
    + '\n       release.mjs resume-publish --version X.Y.Z --tag-sha <sha> --head-sha <sha> --release <bool>');
  process.exit(2);
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exit(1); });
}
