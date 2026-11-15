// Text spec fields, checked by both engines' validateSpec before anything is
// drawn (#488). A list or an object used to go through String(): Draw.io drew
// ["Search index","OpenSearch"] as "Search index,OpenSearch" and {"text":"Worker"}
// as "[object Object]" and validated clean, while Excalidraw wrote a scene its
// own validator then failed.
//
// A field left out, or set to null, draws nothing. One that is present must be
// a string, or a number, which has always drawn as its digits.

const kindOf = (v) => (Array.isArray(v) ? 'a list' : v !== null && typeof v === 'object' ? 'an object' : `${JSON.stringify(v)}`);

// Every field of `item` named in `keys` that is not text, as
// "<field>.<key>: expected text, got ...".
export function textProblems(field, item, keys) {
  const problems = [];
  for (const key of keys) {
    const v = item[key];
    if (v === undefined || v === null || typeof v === 'string') continue;
    if (typeof v === 'number' && Number.isFinite(v)) continue;
    const hint = Array.isArray(v) ? '; join the lines with \\n' : '';
    problems.push(`${field}.${key}: expected text, got ${kindOf(v)}${hint}`);
  }
  return problems;
}

// A number is text that has always drawn as its digits in Draw.io; Excalidraw
// wrote it as a number, which its own validator refuses. The same spec with
// each such field as a string, for a builder that needs one. The spec the file
// carries stays as written.
export function numbersAsText(spec, fields) {
  const text = (item, keys) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const out = { ...item };
    for (const key of keys) if (typeof out[key] === 'number') out[key] = String(out[key]);
    return out;
  };
  const out = text(spec, fields.spec ?? []);
  for (const [list, keys] of Object.entries(fields)) {
    if (list !== 'spec' && Array.isArray(out[list])) out[list] = out[list].map((item) => text(item, keys));
  }
  return out;
}
