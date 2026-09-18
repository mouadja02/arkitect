// Every exact icon count a hand-written doc quotes, checked against what ships (#78).
//
// The numbers were typed by hand in more than a dozen files and nothing compared
// them with their source. The Draw.io pack table went two releases stale before
// anyone noticed, and the answer-key sentence in docs/drawio-icons.md claimed
// 375 queries and 28 flagged when the file held 471 and 21.
//
// Each claim names the files it applies to and carries enough of the sentence
// around the number to be unique there. That is deliberate: the docs use one
// noun for several quantities - "marks" counts the Draw.io packs in one
// paragraph, both engines in another, the Excalidraw libraries in a third, and
// a historical batch of 38 in testing.md - so a pattern anchored on the noun
// alone would compare unrelated numbers. The list doubles as the inventory of
// where a count is quoted, which is the thing nobody had.
//
// Generated files are left out: pack-index.md and ATTRIBUTION.md are rewritten
// from the catalog and cannot drift. CHANGELOG.md is left out too, because a
// released entry records what was true when it shipped.

const LABEL = {
  committed: 'marks that ship their artwork',
  bundled: 'marks bundled across both engines',
  packs: 'Draw.io packs',
  onDemand: 'entries catalogued without bytes',
  excalidrawItems: 'Excalidraw library items',
  excalidrawLibraries: 'bundled Excalidraw libraries',
  answered: 'answer-key queries with an expected answer',
  flagged: 'answer-key queries that must come back flagged',
  excalidrawQueries: 'Excalidraw answer-key queries',
};

const AGENT_RULES = ['.cursor/rules/arkitect.mdc', '.github/copilot-instructions.md'];
// Each engine's icon reference, which SKILL.md sends an agent to when it needs
// the counts (#113).
const DRAWIO_ICONS = 'skills/arkitect-drawio/references/icons.md';
const EXCALIDRAW_ICONS = 'skills/arkitect-excalidraw/references/icons.md';

// facts[i] is what capture group i + 1 must equal. `pack:<id>` is that pack's
// committed count; everything else is a key of the object liveCounts returns.
const CLAIMS = [
  { files: AGENT_RULES, facts: ['committed', 'packs', 'excalidrawItems'],
    re: /([\d,]+) marks in ([\d,]+) packs for Draw\.io,\s+([\d,]+) bundled library items for Excalidraw/ },

  { files: ['AGENTS.md'], facts: ['packs', 'committed', 'pack:aws'],
    re: /([\d,]+) packs, ([\d,]+) marks — ([\d,]+) AWS Architecture Icons/ },
  { files: ['AGENTS.md'], facts: ['excalidrawItems', 'excalidrawLibraries', 'committed'],
    re: /([\d,]+) native items across ([\d,]+) bundled libraries plus the ([\d,]+) shared marks/ },
  { files: ['AGENTS.md'], facts: ['packs'],
    re: /search across all ([\d,]+) packs/ },

  { files: ['README.md'], facts: ['bundled', 'committed', 'packs'],
    re: /\*\*([\d,]+) icons bundled\.\*\* ([\d,]+) marks in ([\d,]+) shared packs/ },
  { files: ['README.md'], facts: ['excalidrawItems', 'excalidrawLibraries'],
    re: /plus ([\d,]+) items\s+across ([\d,]+) Excalidraw libraries/ },
  { files: ['README.md'], facts: ['packs', 'committed'],
    re: /([\d,]+) packs, ([\d,]+) marks \+ built-in/ },
  { files: ['README.md'], facts: ['excalidrawItems', 'excalidrawLibraries', 'committed'],
    re: /([\d,]+) native items across ([\d,]+) libraries \+ ([\d,]+) shared marks/ },

  { files: ['docs/icons.md'], facts: ['bundled'],
    re: /ships\s+([\d,]+) marks and refuses to fake/ },
  { files: ['docs/icons.md'], facts: ['committed', 'packs'],
    re: /# ([\d,]+) marks in ([\d,]+) packs/ },
  { files: ['docs/icons.md'], facts: ['committed', 'packs', 'excalidrawItems', 'excalidrawLibraries', 'committed'],
    re: /\| bundled \| ([\d,]+) marks across ([\d,]+) packs \| ([\d,]+) native items across ([\d,]+) libraries plus ([\d,]+) shared marks \|/ },
  // The Draw.io half of the coverage row. Its Excalidraw half names AWS and
  // Azure too, with different numbers, so this anchors on the row's first cell.
  { files: ['docs/icons.md'], facts: ['pack:aws', 'pack:azure', 'pack:gcp'],
    re: /\| coverage \| AWS \(([\d,]+)\), Azure \(([\d,]+)\), Google Cloud \(([\d,]+)\)/ },
  { files: ['docs/icons.md'], facts: ['pack:brands'],
    re: /([\d,]+) more brands as a catch-all/ },

  { files: ['docs/getting-started.md'], facts: ['excalidrawLibraries'],
    re: /and ([\d,]+) icon libraries are all committed/ },
  { files: ['docs/getting-started.md'], facts: ['bundled', 'committed', 'packs'],
    re: /([\d,]+) marks ship with Arkitect: ([\d,]+) across ([\d,]+) Draw\.io packs/ },
  { files: ['docs/getting-started.md'], facts: ['excalidrawItems', 'excalidrawLibraries'],
    re: /and ([\d,]+) items across ([\d,]+) Excalidraw libraries/ },
  { files: ['docs/getting-started.md'], facts: ['packs'],
    re: /([\d,]+) packs cover far more/ },

  { files: ['docs/shared-icons.md'], facts: ['committed', 'packs', 'excalidrawItems'],
    re: /all ([\d,]+) committed marks in the ([\d,]+) Draw\.io packs, alongside\s+its ([\d,]+) native library items/ },
  { files: ['docs/shared-icons.md'], facts: ['onDemand'],
    re: /The ([\d,]+) on-demand entries/ },

  { files: ['docs/drawio-icons.md'], facts: ['onDemand'],
    re: /([\d,]+) products \(`node scripts\/find-icon\.mjs --stats`/ },
  { files: ['docs/drawio-icons.md'], facts: ['answered'],
    re: /an answer key of ([\d,]+)\s+queries/ },
  { files: ['docs/drawio-icons.md'], facts: ['flagged'],
    re: /plus ([\d,]+) that must\s+come back flagged/ },

  { files: ['docs/testing.md'], facts: ['excalidrawQueries'],
    re: /the ([\d,]+)-query answer key in `tests\/excalidraw-icon-queries\.json`/ },

  { files: ['docs/excalidraw-icons.md'], facts: ['excalidrawItems'],
    re: /— ([\d,]+) marks covering most of what a cloud/ },
  { files: ['docs/excalidraw-icons.md'], facts: ['committed'],
    re: /fill gaps with ([\d,]+) embedded original marks/ },

  { files: ['docs/excalidraw-libraries.md'], facts: ['committed'],
    re: /also provide ([\d,]+) original\s+SVG\/PNG marks/ },
  { files: ['docs/excalidraw-libraries.md', EXCALIDRAW_ICONS, 'skills/arkitect-excalidraw/assets/libraries/README.md'],
    facts: ['excalidrawLibraries', 'excalidrawItems'],
    re: /([\d,]+) libraries, ([\d,]+) items/ },
  { files: [EXCALIDRAW_ICONS], facts: ['committed'],
    re: /fill coverage gaps with ([\d,]+) original SVG\/PNG marks/ },

  { files: [DRAWIO_ICONS], facts: ['onDemand'],
    re: /one of the ([\d,]+) on-demand marks/ },

  { files: ['bin/lib/install-agent.mjs'], facts: ['excalidrawItems'],
    re: /plus ([\d,]+) Excalidraw library items/ },
];

const PACK_TABLE_HEAD = '| Pack | Icons | What is in it |';

const num = (text) => Number(text.replace(/,/g, ''));
// Suggest the value written the way the doc writes it, so the fix is a retype
// of the digits and nothing else.
const like = (value, found) => (found.includes(',') ? value.toLocaleString('en-US') : String(value));

function hasAnswer(row) {
  const answer = row[1];
  return answer !== null && answer !== undefined && !(Array.isArray(answer) && answer.length === 0);
}

export function liveCounts({ catalog, libraries, drawioQueries, excalidrawQueries }) {
  const perPack = {};
  let committed = 0;
  for (const icon of catalog.icons) {
    if (icon.bytes !== 'committed') continue;
    committed++;
    perPack[icon.pack] = (perPack[icon.pack] ?? 0) + 1;
  }
  const answered = drawioQueries.queries.filter(hasAnswer).length;
  return {
    committed,
    onDemand: catalog.icons.length - committed,
    packs: catalog.packs.length,
    perPack,
    excalidrawItems: libraries.totals.items,
    excalidrawLibraries: libraries.totals.libraries,
    bundled: committed + libraries.totals.items,
    answered,
    flagged: drawioQueries.queries.length - answered,
    excalidrawQueries: excalidrawQueries.queries.length,
  };
}

function factValue(live, fact) {
  if (!fact.startsWith('pack:')) return live[fact];
  return live.perPack[fact.slice('pack:'.length)];
}

function labelOf(fact) {
  return fact.startsWith('pack:') ? `marks in the \`${fact.slice('pack:'.length)}\` pack` : LABEL[fact];
}

// The Draw.io skill's pack table, which is the only place every per-pack count
// is written out. Returns null when the table is gone rather than guessing.
export function packTableRows(markdown) {
  const start = markdown.indexOf(PACK_TABLE_HEAD);
  if (start < 0) return null;
  const end = markdown.indexOf('\n\n', start);
  const block = markdown.slice(start, end < 0 ? markdown.length : end);
  return [...block.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|\s*([\d,]+)\s*\|/gm)]
    .map((m) => ({ pack: m[1], found: m[2] }));
}

// `read` is given a repo-relative path and returns its text, or null when the
// file is not there.
export function checkDocCounts({ live, read }) {
  const problems = [];
  for (const claim of CLAIMS) {
    for (const rel of claim.files) {
      const text = read(rel);
      if (text === null) { problems.push(`${rel}: missing, so its icon counts cannot be checked`); continue; }
      const matches = [...text.matchAll(new RegExp(claim.re, 'g'))];
      if (!matches.length) {
        problems.push(`${rel}: no longer says ${claim.facts.map(labelOf).join(' and ')} the way `
          + `${claim.re} reads it; update the claim in tests/icon-count-guard.mjs, or remove it if the doc `
          + 'deliberately stopped quoting the number');
        continue;
      }
      for (const match of matches) {
        claim.facts.forEach((fact, i) => {
          const found = match[i + 1];
          const want = factValue(live, fact);
          if (num(found) !== want) {
            problems.push(`${rel}: quotes ${found} ${labelOf(fact)}; there are `
              + `${want.toLocaleString('en-US')}, so write ${like(want, found)}`);
          }
        });
      }
    }
  }

  const skill = read(DRAWIO_ICONS);
  const rows = skill === null ? null : packTableRows(skill);
  if (rows === null) {
    problems.push(`${DRAWIO_ICONS}: no "${PACK_TABLE_HEAD}" table, so no per-pack count is checked`);
  } else {
    for (const { pack, found } of rows) {
      const want = live.perPack[pack];
      if (want === undefined) problems.push(`${DRAWIO_ICONS}: the pack table has a row for \`${pack}\`, which ships no marks`);
      else if (num(found) !== want) {
        problems.push(`${DRAWIO_ICONS}: the pack table quotes ${found} for \`${pack}\`; `
          + `${want} ship, so write ${like(want, found)}`);
      }
    }
    for (const pack of Object.keys(live.perPack)) {
      if (!rows.some((r) => r.pack === pack)) problems.push(`${DRAWIO_ICONS}: the pack table has no row for \`${pack}\``);
    }
  }
  return problems;
}
