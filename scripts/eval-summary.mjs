#!/usr/bin/env node
// One screen from an eval run's JSON: the score per run, every grader that
// failed, and what it cost. `claude plugin eval --json` writes the input.
//
//   node scripts/eval-summary.mjs evals/results/<stamp>/result.json
//
// Offline and deterministic, like everything else here. Exits 1 if any case
// scored below 1, so it can gate a run; 2 if the file cannot be read.

import { readFileSync } from 'node:fs';
import { readJson } from '../skills/arkitect-drawio/scripts/lib/read-json.mjs';

const path = process.argv[2];
if (!path || process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log('usage: node scripts/eval-summary.mjs <result.json>');
  process.exit(path ? 0 : 2);
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

let worst = 1;
const widest = Math.max(0, ...cases.map((c) => (c.name || '').length));
for (const c of cases) {
  const runs = c.arms?.with ?? [];
  const scores = runs.map((r) => (typeof r.score === 'number' ? r.score : null));
  const known = scores.filter((s) => s !== null);
  const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
  if (mean !== null) worst = Math.min(worst, mean);

  const mark = mean === null ? '??' : mean === 1 ? 'ok' : '  ';
  lines.push(`${mark}  ${(c.name || '?').padEnd(widest)}  ${score(mean)}`
    + (runs.length > 1 ? `   runs: ${scores.map(score).join(' ')}` : ''));

  // Errors first: a case that never started is not a low score, it is no score.
  for (const [i, r] of runs.entries()) {
    const at = runs.length > 1 ? ` (run ${i + 1})` : '';
    if (r.error) { lines.push(`      ERROR${at}: ${String(r.error).split('\n')[0].slice(0, 160)}`); continue; }
    const failed = (r.graders ?? []).filter((g) => !g.passed);
    for (const g of failed) {
      lines.push(`      FAIL${at}  ${g.name}${g.explanation ? `  — ${String(g.explanation).slice(0, 90)}` : ''}`);
    }
  }
}

const agg = run.aggregates ?? {};
lines.push('');
lines.push(`overall ${score(agg.overallScore)}`
  + `  ·  ${agg.casesPassed ?? '?'}/${agg.casesTotal ?? '?'} cases ran`
  + `  ·  ${typeof agg.overallPassRate === 'number' ? Math.round(agg.overallPassRate * 100) : '?'}% of runs perfect`);
if (run.partial) lines.push('PARTIAL: the cost ceiling stopped the run before every case finished');

console.log(lines.join('\n'));
process.exit(worst < 1 ? 1 : 0);
