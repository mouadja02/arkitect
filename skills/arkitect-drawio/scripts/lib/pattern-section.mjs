// Prints one `## N.` section of an engine's references/pattern-catalog.md
// (#417). SKILL.md step 2 sends an agent to one section, and the obvious way
// to cut it out, `sed -n` on a plugin file, is refused in a sandboxed run: a
// small model read that refusal as the shell being off and stopped. This is
// read-only, needs no cd into the skill folder (#404), and prints exactly the
// bytes the reading budget measures.

import { readFileSync } from 'node:fs';

// Section number -> its text, from the heading up to the next `## N.` or `# `.
export function patternSections(catalog) {
  const text = catalog.replace(/\r\n/g, '\n');
  return new Map(text.split(/\n(?=## \d+\.)/).slice(1)
    .map((s) => [Number(s.match(/^## (\d+)\./)[1]), s.split(/\n(?=# )/)[0]]));
}

const usage = (engine) => `usage: arkitect ${engine} pattern [N]

Prints section N of references/pattern-catalog.md, the one pattern SKILL.md
step 2 sends you to. With no N, lists the sections.`;

export function patternCli(argv, { catalogPath, engine }) {
  if (argv.includes('-h') || argv.includes('--help')) { console.log(usage(engine)); return 0; }
  const sections = patternSections(readFileSync(catalogPath, 'utf8'));
  const list = () => [...sections].map(([, s]) => s.split('\n')[0].replace(/^## /, '')).join('\n');
  if (!argv.length) { console.log(list()); return 0; }
  const n = Number(argv[0]);
  if (argv.length > 1 || !sections.has(n)) {
    console.error(`no pattern ${argv.join(' ')}. The catalog has:\n${list()}`);
    return 2;
  }
  process.stdout.write(`${sections.get(n).trimEnd().replace(/\n+-{3,}$/, '')}\n`);
  return 0;
}
