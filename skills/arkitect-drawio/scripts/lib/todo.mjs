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

// At most `max` entries, then how many were left out, as `validate` stops at ten.
export const cap = (list, max = 10) => (list.length > max ? [...list.slice(0, max), `and ${list.length - max} more`] : list);

// `restated` maps a build key to the phrase its `validate` warning carries
// (each validator's RESTATED). A warning for something the build lists under
// that key is the key's line already, and the key's names the spec node and
// carries the entry to paste; so it is left out, and the defect is listed once.
// A key that lists nothing leaves `validate`'s warning the only report (#477).
export function todoOf(report, result, restated = {}) {
  const listed = Object.entries(restated).filter(([key]) => (at(report, key) ?? []).length).map(([, phrase]) => phrase);
  return [
    ...result.errors.map((e) => `validate error: ${e}`),
    ...result.warnings.filter((w) => !listed.some((phrase) => w.includes(phrase))).map((w) => `validate warning: ${w}`),
    ...TODO_KEYS.flatMap((key) => (at(report, key) ?? []).map((entry) => `${key}: ${brief(entry)}`)),
  ];
}
