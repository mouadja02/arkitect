// The file list the repository-wide checks read.
//
// Three checks - broken docs links, and the two redaction guards - are about
// what this repository contains, and two of them say so in their own names.
// All three walked whatever sat on disk instead, each with its own hand-written
// list of directories to skip, so a local Claude Code install under .claude/
// made them fail on a stranger's Markdown. Git already knows which files are
// ours: ask it once, here.
//
// `--cached --others --exclude-standard` is tracked files plus new ones that
// are not ignored, so a doc written but not yet committed is still checked,
// while derived and third-party material stays out by the same rules the rest
// of the repository already agrees on.

import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Only for the fallback below, where there is nothing to ask. An unpacked
// tarball has no checkout, and CI images do occasionally ship without git.
const DERIVED = new Set(['.git', 'node_modules', '.analysis', 'output', '.claude', '.shot']);

// A checkout rooted exactly here, or nothing. An unpacked tarball sitting
// inside somebody else's repository would otherwise be answered for by that
// repository, which is worse than not asking.
function checkout(root) {
  try {
    const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return top !== '' && realpathSync(top) === realpathSync(root);
  } catch {
    return false; // no git, or no checkout
  }
}

export function repoPaths(root) {
  if (checkout(root)) {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const paths = [...new Set(out.split('\0').filter(Boolean))];
    if (paths.length) return paths;
  }
  return walk(root, root, []);
}

function walk(root, dir, acc) {
  for (const name of readdirSync(dir)) {
    if (DERIVED.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(root, p, acc);
    else acc.push(relative(root, p).split(sep).join('/'));
  }
  return acc;
}

// Absolute paths of the files `keep` accepts. It is given the repo-relative
// path with forward slashes, its bare name, and its size, so a caller can pick
// by extension, by a directory anywhere above it, or by weight.
export function repoFiles(root, keep) {
  const out = [];
  for (const rel of repoPaths(root)) {
    const abs = join(root, ...rel.split('/'));
    let st;
    // A tracked file can be deleted locally, and a submodule is listed as a
    // path that is not a file.
    try { st = statSync(abs); } catch { continue; }
    if (!st.isFile()) continue;
    if (keep({ rel, name: rel.slice(rel.lastIndexOf('/') + 1), size: st.size })) out.push(abs);
  }
  return out;
}

// Anything git tracks although .gitignore excludes it. An ignore rule does not
// untrack what is already committed, so a force-add, or a rule written after
// the fact, leaves the repository contradicting its own policy: 12 review
// contact sheets sat in git for exactly that reason, 6.3 MB the rule, the
// package manifest and two docs all said were not there.
export function trackedButIgnored(root) {
  if (!checkout(root)) return null; // nothing to check without a checkout
  const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  });
  const paths = tracked.split('\0').filter(Boolean);
  if (!paths.length) return null;
  // --no-index answers for the committed paths too, which is the whole point.
  // check-ignore exits 1 when nothing matches, which is the result we want.
  const r = spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '--stdin'], {
    input: paths.join('\n') + '\n', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0 && r.status !== 1) return null;
  return (r.stdout ?? '').split('\n').filter(Boolean);
}
