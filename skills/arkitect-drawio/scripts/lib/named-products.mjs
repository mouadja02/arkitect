// A plain box whose label names products with a bundled mark draws them as
// text, and the report said nothing: on a field test a box read "Sources:
// PostgreSQL, MySQL, Snowflake" while the agent reported that the sources had
// no icon (#240). Both builders run each product-like part of a plain box's
// label through their own unattended resolver and list what it would draw.
// A note is prose and is never asked; a generic word is not a product (#231).

import { onlyGenericWords } from './generic-words.mjs';

const SPLIT = /[,/+()[\]{}&;|:\n]|\s+(?:and|or)\s+/i;
const MAX_WORDS = 4;

// "Sources: PostgreSQL, MySQL" -> ["Sources", "PostgreSQL", "MySQL"]
export function labelParts(label) {
  const seen = new Set();
  return String(label ?? '').split(SPLIT)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 1 && p.split(' ').length <= MAX_WORDS && !onlyGenericWords(p))
    .filter((p) => !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()));
}

// A box that is nothing but the product's name also gets `replace`, the node to
// paste over it: the report alone was listed and then ignored, and agents take
// what a tool hands them (#287, #231). The id stays, so its edges still bind.
const BOX_ONLY = new Set(['kind', 'width', 'height', 'icon']);

// resolveOne(text) returns the ref it would draw unattended, or null.
export function namedProducts(boxes, resolveOne) {
  const found = [];
  for (const box of boxes) {
    for (const text of labelParts(box.label)) {
      const icon = resolveOne(text);
      if (!icon) continue;
      const whole = String(box.label).trim().toLowerCase() === text.toLowerCase();
      const kept = Object.fromEntries(Object.entries(box).filter(([k]) => !BOX_ONLY.has(k)));
      found.push({ node: box.id, text, icon, ...(whole ? { replace: { ...kept, kind: 'icon', icon } } : {}) });
    }
  }
  return found;
}
