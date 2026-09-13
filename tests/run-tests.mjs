#!/usr/bin/env node
// Runs every suite and aggregates the result.
//
//   node tests/run-tests.mjs
//   node tests/run-tests.mjs drawio          only one of them
//   node tests/run-tests.mjs excalidraw
//   node tests/run-tests.mjs toolkit
//
// Each suite is offline, deterministic and dependency-free. Tests that need
// your own reference diagrams read their paths from .analysis/sources.local.json
// (gitignored); without it they skip, which is the expected result on a fresh
// clone.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { documentedCount, checkCounts } from './count-guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  { name: 'draw.io', file: 'drawio.mjs', key: 'drawio' },
  { name: 'excalidraw', file: 'excalidraw.mjs', key: 'excalidraw' },
  { name: 'toolkit', file: 'toolkit.mjs', key: 'toolkit' },
];

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const suites = wanted.length
  ? SUITES.filter((s) => wanted.includes(s.key))
  : SUITES;

if (!suites.length) {
  console.error(`unknown suite. known: ${SUITES.map((s) => s.key).join(', ')}`);
  process.exit(2);
}

const totals = { pass: 0, fail: 0, skip: 0 };
let sourceDependent = 0;
let failed = false;

for (const suite of suites) {
  console.log(`\n=== ${suite.name} ===\n`);
  const r = spawnSync(process.execPath, [join(HERE, suite.file)], {
    stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(r.stdout ?? '');
  const m = (r.stdout ?? '').match(/(\d+) passed, (\d+) failed, (\d+) skipped/);
  if (m) {
    totals.pass += Number(m[1]);
    totals.fail += Number(m[2]);
    totals.skip += Number(m[3]);
  }
  const declared = (r.stdout ?? '').match(/^source-dependent: (\d+)\r?$/m);
  if (declared) sourceDependent += Number(declared[1]);
  if (r.status !== 0) failed = true;
}

console.log(`\n=== total ===\n${totals.pass} passed, ${totals.fail} failed, ${totals.skip} skipped`);

// On a full run, the count quoted in docs/testing.md has to match what ran (#47).
if (!wanted.length) {
  const sourcesPresent = existsSync(join(HERE, '..', '.analysis', 'sources.local.json'));
  const docsPath = join(HERE, '..', 'docs', 'testing.md');
  const documented = existsSync(docsPath) ? documentedCount(readFileSync(docsPath, 'utf8')) : null;
  const { problems, expected } = checkCounts({ documented, totals, sourceDependent, sourcesPresent });
  if (sourcesPresent) {
    console.log(`fresh-clone expectation: ${expected.passed} passed, 0 failed, ${expected.skipped} skipped `
      + '(local sources are present, so some source-dependent tests ran here; quote this line, not the one above)');
  }
  for (const problem of problems) console.log(`\nCOUNT  ${problem}`);
  if (problems.length) failed = true;
}
process.exit(failed ? 1 : 0);
