// Numeric spec fields, checked by both engines' validateSpec before anything is
// laid out (#115). Without this a string or a missing coordinate became NaN, and
// a negative size was written into the file as given.
//
// A field left out, or set to null, takes the builder's default. A field that is
// present must be a real number the rule accepts: "3" is a string, not a 3.

const rule = (want, test) => ({ want, test });

export const FINITE = rule('a finite number', Number.isFinite);
export const POSITIVE = rule('a number greater than 0', (v) => Number.isFinite(v) && v > 0);
export const NON_NEGATIVE = rule('a number of at least 0', (v) => Number.isFinite(v) && v >= 0);
// A boundary spans at least one grid cell; less and its box turns inside out.
export const SPAN = rule('a number of at least 1', (v) => Number.isFinite(v) && v >= 1);

const show = (v) => (typeof v === 'number' ? String(v) : JSON.stringify(v) ?? String(v));

// Every field of `item` that breaks its rule, as "<field>.<key>: expected ..., got ...".
export function numberProblems(field, item, rules) {
  const problems = [];
  for (const [key, { want, test }] of Object.entries(rules)) {
    const v = item[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'number' || !test(v)) problems.push(`${field}.${key}: expected ${want}, got ${show(v)}`);
  }
  return problems;
}
