#!/usr/bin/env node
// One screen from an eval run's JSON: the score per run, every grader that
// failed, and what it cost. `claude plugin eval --json` writes the input.
//
//   node scripts/eval-summary.mjs evals/results/<stamp>/result.json [--traces DIR]
//
// `--traces DIR` copies each run's trace.jsonl, which `claude plugin eval`
// deletes with its temp dir unless told --keep-temp, into DIR, and names it
// under every run that failed. Without it a reply a grader failed could not be
// read after the run, and one miss had to be reported as "cause unknown" (#374).
//
// Offline and deterministic, like everything else here. Exits 1 if any case
// scored below 1, so it can gate a run; 2 if the file cannot be read.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readJson } from '../skills/arkitect-drawio/scripts/lib/read-json.mjs';

const argv = process.argv.slice(2);
const at = argv.indexOf('--traces');
const traces = at >= 0 ? argv[at + 1] : null;
const path = argv.find((a, i) => !a.startsWith('-') && !(at >= 0 && i === at + 1));
const help = argv.includes('-h') || argv.includes('--help');
if (help || !path || (at >= 0 && !traces)) {
  console.log('usage: node scripts/eval-summary.mjs <result.json> [--traces DIR]');
  process.exit(help ? 0 : 2);
}

let run;
try {
  run = readJson(path);
} catch (e) {
  console.error(`cannot read ${path}: ${e.message}`);
  process.exit(2);
}

const cases = Array.isArray(run.cases) ? run.cases : [];
const money = (n) => `$${(Number(n) || 0).toFixed(3)}`;
const score = (n) => (typeof n === 'number' ? n.toFixed(2) : ' ?  ');

const lines = [];
lines.push(`${cases.length} cases · ${run.durationSeconds ?? '?'}s · ${money(run.costUsd)}`
  + ` · model ${run.suite?.modelOverride ?? 'default'} · judge ${run.suite?.judgeModel ?? 'default'}`);
lines.push('');

// The run's trace, copied into the traces directory, by the path to print; or
// null when there is none to copy (the temp dir was not kept).
function saveTrace(from, name) {
  if (!from || !existsSync(from)) return null;
  mkdirSync(traces, { recursive: true });
  const to = join(traces, name.replace(/[^\w.-]/g, '_'));
  copyFileSync(from, to);
  return `${basename(traces)}/${basename(to)}`;
}

let worst = 1;
let errored = 0;
const widest = Math.max(0, ...cases.map((c) => (c.name || '').length));
for (const c of cases) {
  const runs = c.arms?.with ?? [];
  // A run that errored before the agent answered has no score, whatever the
  // tool reports: its not_contains graders pass on the empty reply, so a
  // session-limit failure used to read as 0.17 rather than as nothing.
  const scores = runs.map((r) => (!r.error && typeof r.score === 'number' ? r.score : null));
  errored += runs.filter((r) => r.error).length;
  const known = scores.filter((s) => s !== null);
  const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
  if (mean !== null) worst = Math.min(worst, mean);

  const mark = mean === null ? '??' : mean === 1 ? 'ok' : '  ';
  lines.push(`${mark}  ${(c.name || '?').padEnd(widest)}  ${score(mean)}`
    + (runs.length > 1 ? `   runs: ${scores.map(score).join(' ')}` : ''));

  // Errors first: a case that never started is not a low score, it is no score.
  for (const [i, r] of runs.entries()) {
    const at = runs.length > 1 ? ` (run ${i + 1})` : '';
    const trace = traces ? saveTrace(r.tracePath, `${c.name || 'case'}-run${i + 1}.jsonl`) : null;
    if (r.error) { lines.push(`      ERROR${at}: ${String(r.error).split('\n')[0].slice(0, 160)}`); continue; }
    const failed = (r.graders ?? []).filter((g) => !g.passed);
    for (const g of failed) {
      lines.push(`      FAIL${at}  ${g.name}${g.explanation ? `  — ${String(g.explanation).slice(0, 90)}` : ''}`);
    }
    if (failed.length && trace) lines.push(`      trace${at}: ${trace}`);
  }
}

const agg = run.aggregates ?? {};
lines.push('');
lines.push(`overall ${score(agg.overallScore)}`
  + `  ·  ${agg.casesPassed ?? '?'}/${agg.casesTotal ?? '?'} cases ran`
  + `  ·  ${typeof agg.overallPassRate === 'number' ? Math.round(agg.overallPassRate * 100) : '?'}% of runs perfect`);
if (run.partial) lines.push('PARTIAL: the cost ceiling stopped the run before every case finished');
const total = cases.reduce((n, c) => n + (c.arms?.with?.length ?? 0), 0);
if (errored) {
  lines.push(`${errored}/${total} runs ERRORED before the agent answered; their scores are not scores,`
    + ' and the overall line above counts them anyway');
}

console.log(lines.join('\n'));
process.exit(worst < 1 || errored ? 1 : 0);
