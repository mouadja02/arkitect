// What a build leaves to act on, in one list (#437). The report spread it over a
// dozen keys, and `validate` printed the rest only if the agent remembered to
// run it; a small model skips a step or misses a key. Both builders validate
// the file they wrote and end their report with `todo`: one line per thing to
// fix or report, empty when there is nothing.

// One build-report entry on a line, every field but the spec fragment to paste.
export const brief = (entry) => (typeof entry === 'string' ? entry : Object.entries(entry)
  .filter(([k, v]) => k !== 'replace' && v != null && !(Array.isArray(v) && !v.length))
  .map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', '));

// The keys an agent acts on, as each builder prints them; a key one engine does
// not print is skipped. Left out: what resolved, what was embedded, a caption
// an icon draws itself, marks that share artwork and a bundled mark's opaque
// background, which are facts about the artwork, not work.
export const TODO_KEYS = [
  'style.errors',
  'unknownKinds', 'unknownFields', 'looksLikeBoundary', 'namesAProduct',
  'icons.missing', 'icons.ambiguous', 'icons.needsFetch', 'icons.lifecycle',
  'logos.missing', 'logos.opaqueBackground',
  'placeholders.forComponents',
  'crossings', 'notes',
];

const at = (report, key) => key.split('.').reduce((v, k) => v?.[k], report);

// `validate`'s first line, as the CLI prints it.
export const verdict = (result) => `${result.ok ? 'PASS' : 'FAIL'}`
  + `${result.warnings.length ? `, ${result.warnings.length} warning${result.warnings.length > 1 ? 's' : ''}` : ''}`;

export function todoOf(report, result) {
  return [
    ...result.errors.map((e) => `validate error: ${e}`),
    ...result.warnings.map((w) => `validate warning: ${w}`),
    ...TODO_KEYS.flatMap((key) => (at(report, key) ?? []).map((entry) => `${key}: ${brief(entry)}`)),
  ];
}
