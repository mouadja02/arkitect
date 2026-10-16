#!/usr/bin/env node
// One screen from an eval run's JSON: the score per run, every grader that
// failed, what it cost, and a scorecard by tier and by competency.
// `claude plugin eval --json` writes the input.
//
//   node scripts/eval-summary.mjs evals/results/<stamp>/result.json
//        [--traces DIR] [--baseline FILE] [--scoreboard FILE] [--tolerance N]
//
// `--traces DIR` copies each run's trace.jsonl, which `claude plugin eval`
// deletes with its temp dir unless told --keep-temp, into DIR, and names it
// under every run that failed. Without it a reply a grader failed could not be
// read after the run, and one miss had to be reported as "cause unknown" (#374).
// A trace is also where the efficiency figures come from: tool calls, failed
// or refused calls, and the bytes of tool output the agent took into context.
//
// `--scoreboard FILE` writes the run as a scoreboard: per case its tier, tags,
// score, perfect runs, turns, cost and context, and nothing else - no path, no
// prompt, no reply - so one can be committed. `--baseline FILE` reads one (or
// another result.json) and prints each case against it (#415).
//
// Each case's tags come from its case.yaml. Tier 1 is the floor and tiers 2
// and 3 the headroom (evals/README.md), so the gate is: exit 1 if a tier-1
// case, or a case with no tier, scored below 1; if any run errored; or if a
// case fell more than --tolerance (default 0.2) below its baseline. Exit 2 if
// a file cannot be read. Offline and deterministic, like everything else here.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from '../skills/arkitect-drawio/scripts/lib/read-json.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = 'arkitect-eval-scoreboard/1';
const USAGE = 'usage: node scripts/eval-summary.mjs <result.json> [--traces DIR] [--baseline FILE] [--scoreboard FILE] [--tolerance N]';

const VALUED = ['--traces', '--baseline', '--scoreboard', '--tolerance'];
const opts = {};
const positional = [];
let help = false;
let bad = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (VALUED.includes(a)) {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('-')) bad ??= `${a} needs a value`;
    else { opts[a.slice(2)] = v; i++; }
  } else if (a === '-h' || a === '--help') help = true;
  else if (a.startsWith('-')) bad ??= `unknown option ${a}`;
  else positional.push(a);
}
const tolerance = opts.tolerance === undefined ? 0.2 : Number(opts.tolerance);
if (!Number.isFinite(tolerance) || tolerance < 0) bad ??= '--tolerance takes a number of 0 or more';
const path = positional[0];
if (help || !path || bad || positional.length > 1) {
  if (bad) console.error(bad);
  console.log(USAGE);
  process.exit(help && !bad ? 0 : 2);
}
const traces = opts.traces ?? null;

const load = (file, what) => {
  try {
    return readJson(file);
  } catch (e) {
    console.error(`cannot read ${what} ${file}: ${e.message}`);
    process.exit(2);
  }
};
const run = load(path, 'the result');
const cases = Array.isArray(run.cases) ? run.cases : [];

const money = (n) => `$${(Number(n) || 0).toFixed(3)}`;
const score = (n) => (typeof n === 'number' ? n.toFixed(2) : ' ?  ');
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const round = (n, places) => (n === null ? null : Number(n.toFixed(places)));
const isTier = (t) => /^tier-\d+$/.test(t);

// The tags a case.yaml declares. A result records the case's directory,
// relative to the plugin it ran against; this script lives in that plugin.
function tagsOf(c) {
  if (!c.dir) return [];
  const dir = isAbsolute(c.dir) ? c.dir : join(ROOT, c.dir);
  let yaml;
  try { yaml = readFileSync(join(dir, 'case.yaml'), 'utf8'); } catch { return []; }
  return (yaml.match(/^tags:\s*\[(.*)\]/m)?.[1] ?? '').split(',').map((t) => t.trim()).filter(Boolean);
}

// What one run's trace says about how it worked, or null without a trace.
function traceStats(file) {
  if (!file || !existsSync(file)) return null;
  const stats = { calls: 0, failed: 0, denied: 0, bytes: 0, peak: 0 };
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const parts = Array.isArray(e.message?.content) ? e.message.content : [];
    if (e.type === 'assistant') stats.calls += parts.filter((p) => p.type === 'tool_use').length;
    if (e.type === 'user') {
      for (const p of parts.filter((q) => q.type === 'tool_result')) {
        const text = typeof p.content === 'string' ? p.content
          : (Array.isArray(p.content) ? p.content.map((x) => x.text ?? '').join('') : '');
        const n = Buffer.byteLength(text);
        stats.bytes += n;
        stats.peak = Math.max(stats.peak, n);
        if (p.is_error) stats.failed++;
      }
    }
    if (e.type === 'system' && e.subtype === 'permission_denied') stats.denied++;
  }
  return stats;
}

// The run's trace, copied into the traces directory, by the path to print; or
// null when there is none to copy (the temp dir was not kept). A summary run
// again over kept results finds the copy already there.
function saveTrace(from, name) {
  const to = join(traces, name.replace(/[^\w.-]/g, '_'));
  if (from && existsSync(from)) {
    mkdirSync(traces, { recursive: true });
    copyFileSync(from, to);
  } else if (!existsSync(to)) return null;
  return { shown: `${basename(traces)}/${basename(to)}`, at: to };
}

// Per case: its tier and tags, the runs that produced a score, and how they
// worked. A run that errored before the agent answered has no score, whatever
// the tool reports: its not_contains graders pass on the empty reply, so a
// session-limit failure used to read as 0.17 rather than as nothing.
const rows = cases.map((c) => {
  const runs = c.arms?.with ?? [];
  const tags = tagsOf(c);
  const ran = runs.filter((r) => !r.error && typeof r.score === 'number');
  const scores = runs.map((r) => (!r.error && typeof r.score === 'number' ? r.score : null));
  const lines = [];
  const stats = [];
  for (const [i, r] of runs.entries()) {
    const at = runs.length > 1 ? ` (run ${i + 1})` : '';
    const kept = traces ? saveTrace(r.tracePath, `${c.name || 'case'}-run${i + 1}.jsonl`) : null;
    if (r.error) { lines.push(`      ERROR${at}: ${String(r.error).split('\n')[0].slice(0, 160)}`); continue; }
    const s = traceStats(kept?.at ?? r.tracePath);
    if (s) stats.push(s);
    const failed = (r.graders ?? []).filter((g) => !g.passed);
    // A grader of weight 3 is the one the case exists for (evals/README.md).
    for (const g of failed) {
      const kind = (g.weight ?? 1) >= 3 ? 'CRIT' : 'FAIL';
      lines.push(`      ${kind}${at}  ${g.name}${g.explanation ? `  — ${String(g.explanation).slice(0, 90)}` : ''}`);
    }
    if (c.maxTurns && r.turns >= c.maxTurns) lines.push(`      TURNS${at}  used all ${c.maxTurns} turns`);
    if (failed.length && kept) lines.push(`      trace${at}: ${kept.shown}`);
  }
  return {
    name: c.name || '?',
    tier: tags.find(isTier) ?? null,
    tags: tags.filter((t) => !isTier(t)),
    runs: runs.length,
    scores,
    errored: runs.filter((r) => r.error).length,
    mean: mean(ran.map((r) => r.score)),
    perfect: ran.filter((r) => r.score === 1).length,
    critical: ran.reduce((n, r) => n + (r.graders ?? []).filter((g) => !g.passed && (g.weight ?? 1) >= 3).length, 0),
    turns: median(ran.map((r) => r.turns).filter(Number.isFinite)),
    costUsd: mean(ran.map((r) => r.costUsd).filter(Number.isFinite)),
    contextKb: median(stats.map((s) => s.bytes / 1024)),
    stats,
    outOfTurns: c.maxTurns ? ran.filter((r) => r.turns >= c.maxTurns).length : 0,
    lines,
  };
});

// The baseline, as a scoreboard: one written by --scoreboard, or a result.json
// turned into one.
function boardOf(rowsIn, source) {
  const cs = {};
  for (const r of rowsIn) {
    cs[r.name] = {
      tier: r.tier, tags: r.tags, runs: r.runs, score: round(r.mean, 3), perfect: r.perfect,
      turns: r.turns, costUsd: round(r.costUsd, 4), contextKb: round(r.contextKb, 1),
    };
  }
  const plugin = (source.suite?.plugins ?? [])[0];
  return {
    schema: SCHEMA,
    run: {
      date: typeof source.startedAt === 'string' ? source.startedAt.slice(0, 10) : null,
      claude: source.claudeVersion ?? null,
      plugin: plugin?.version ?? null,
      model: source.suite?.modelOverride ?? null,
      judge: source.suite?.judgeModel ?? null,
      costUsd: round(Number(source.costUsd) || 0, 3),
    },
    cases: cs,
  };
}
let baseline = null;
if (opts.baseline) {
  const b = load(opts.baseline, 'the baseline');
  if (b?.schema === SCHEMA && b.cases && typeof b.cases === 'object') baseline = b;
  else if (Array.isArray(b?.cases)) {
    baseline = boardOf(b.cases.map((c) => {
      const ran = (c.arms?.with ?? []).filter((r) => !r.error && typeof r.score === 'number');
      return { name: c.name || '?', tier: null, tags: [], runs: ran.length, mean: mean(ran.map((r) => r.score)), perfect: ran.filter((r) => r.score === 1).length,
        turns: median(ran.map((r) => r.turns).filter(Number.isFinite)), costUsd: mean(ran.map((r) => r.costUsd).filter(Number.isFinite)), contextKb: null };
    }), b);
  } else {
    console.error(`cannot read the baseline ${opts.baseline}: neither a scoreboard nor a result`);
    process.exit(2);
  }
}
const before = (name) => {
  const v = baseline?.cases?.[name]?.score;
  return typeof v === 'number' ? v : null;
};

const out = [];
out.push(`${cases.length} cases · ${run.durationSeconds ?? '?'}s · ${money(run.costUsd)}`
  + ` · model ${run.suite?.modelOverride ?? 'default'} · judge ${run.suite?.judgeModel ?? 'default'}`);
if (baseline) {
  const r = baseline.run ?? {};
  out.push(`baseline: ${r.date ?? '?'} · model ${r.model ?? '?'} · plugin ${r.plugin ?? '?'} · ${Object.keys(baseline.cases).length} cases`);
}

const regressions = [];
const widest = Math.max(0, ...rows.map((r) => r.name.length));
const TIER_ORDER = (t) => (t === null ? 0 : Number(t.slice(5)));
const tiers = [...new Set(rows.map((r) => r.tier))].sort((a, b) => TIER_ORDER(a) - TIER_ORDER(b));
for (const tier of tiers) {
  out.push('');
  if (tiers.length > 1 || tier !== null) out.push(tier ?? 'no tier');
  for (const r of rows.filter((x) => x.tier === tier)) {
    const mark = r.mean === null ? '??' : r.mean === 1 ? 'ok' : '  ';
    let line = `${mark}  ${r.name.padEnd(widest)}  ${score(r.mean)}`
      + (r.runs > 1 ? `   runs: ${r.scores.map(score).join(' ')}` : '');
    if (r.mean !== null && r.turns !== null) {
      line += `   ${Math.round(r.turns)} turns` + (r.contextKb !== null ? ` · ${Math.round(r.contextKb)} KB` : '');
    }
    const was = before(r.name);
    if (baseline && r.mean !== null) {
      if (was === null) line += '   new';
      else {
        const d = r.mean - was;
        line += `   ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)} on ${was.toFixed(2)}`;
        if (d < -tolerance - 1e-9) { line += '  REGRESSED'; regressions.push(r.name); }
      }
    }
    out.push(line);
    out.push(...r.lines);
  }
}

// The scorecard: each tier and each competency over the cases that carry it.
const groups = [];
for (const tier of tiers) if (tier !== null) groups.push([tier, rows.filter((r) => r.tier === tier)]);
for (const tag of [...new Set(rows.flatMap((r) => r.tags))].sort()) groups.push([tag, rows.filter((r) => r.tags.includes(tag))]);
if (groups.length) {
  out.push('');
  out.push(`scorecard${' '.repeat(12)}cases  score  all runs perfect` + (baseline ? '  baseline' : ''));
  for (const [label, members] of groups) {
    const scored = members.filter((m) => m.mean !== null);
    const m = mean(scored.map((x) => x.mean));
    const allPerfect = scored.filter((x) => x.perfect === x.runs && x.runs > 0).length;
    const was = mean(scored.map((x) => before(x.name)).filter((v) => v !== null));
    out.push(`  ${label.padEnd(18)} ${String(members.length).padStart(5)}  ${score(m)}  ${String(allPerfect).padStart(16)}`
      + (baseline ? `  ${was === null ? '   -' : was.toFixed(2)}` : ''));
  }
}

const all = rows.flatMap((r) => r.stats);
const ranTurns = cases.flatMap((c) => (c.arms?.with ?? []).filter((r) => !r.error && Number.isFinite(r.turns)).map((r) => r.turns));
if (ranTurns.length) {
  const critical = rows.reduce((n, r) => n + r.critical, 0);
  const outOfTurns = rows.reduce((n, r) => n + r.outOfTurns, 0);
  out.push('');
  out.push(`efficiency: median ${median(ranTurns)} turns`
    + (all.length ? ` · ${Math.round(median(all.map((s) => s.calls)))} tool calls per run · ${all.reduce((n, s) => n + s.failed, 0)} failed or refused`
      + ` · ${all.reduce((n, s) => n + s.denied, 0)} denied · ${Math.round(median(all.map((s) => s.bytes / 1024)))} KB of tool output per run`
      + ` · largest ${Math.round(Math.max(...all.map((s) => s.peak)) / 1024)} KB` : ' · no traces read')
    + (outOfTurns ? ` · ${outOfTurns} run${outOfTurns > 1 ? 's' : ''} used every turn` : '')
    + (critical ? ` · ${critical} critical failure${critical > 1 ? 's' : ''}` : ''));
}

const agg = run.aggregates ?? {};
out.push('');
out.push(`overall ${score(agg.overallScore)}`
  + `  ·  ${agg.casesPassed ?? '?'}/${agg.casesTotal ?? '?'} cases ran`
  + `  ·  ${typeof agg.overallPassRate === 'number' ? Math.round(agg.overallPassRate * 100) : '?'}% of runs perfect`);
if (run.partial) out.push('PARTIAL: the cost ceiling stopped the run before every case finished');
const errored = rows.reduce((n, r) => n + r.errored, 0);
const total = rows.reduce((n, r) => n + r.runs, 0);
if (errored) {
  out.push(`${errored}/${total} runs ERRORED before the agent answered; their scores are not scores,`
    + ' and the overall line above counts them anyway');
}

// The gate. Below 1.00 in tier 1 (or with no tier at all) is a regression;
// tiers 2 and 3 are measured, and fail only by falling below their baseline.
const floor = rows.filter((r) => (r.tier === null || r.tier === 'tier-1') && r.mean !== null && r.mean < 1).map((r) => r.name);
const reasons = [];
if (floor.length) reasons.push(`${floor.length} ${tiers.some((t) => t !== null) ? 'tier-1 ' : ''}case${floor.length > 1 ? 's' : ''} below 1.00`);
if (errored) reasons.push(`${errored} errored run${errored > 1 ? 's' : ''}`);
if (regressions.length) reasons.push(`${regressions.length} regressed more than ${tolerance} on the baseline`);
out.push(reasons.length ? `gate: FAIL - ${reasons.join(', ')}` : 'gate: pass');

if (opts.scoreboard) {
  const board = boardOf(rows, run);
  try {
    mkdirSync(dirname(opts.scoreboard), { recursive: true });
    writeFileSync(opts.scoreboard, JSON.stringify(board, null, 2) + '\n');
    out.push(`scoreboard: ${opts.scoreboard}`);
  } catch (e) {
    console.error(`cannot write the scoreboard ${opts.scoreboard}: ${e.message}`);
    process.exit(2);
  }
}

console.log(out.join('\n'));
process.exit(reasons.length ? 1 : 0);
