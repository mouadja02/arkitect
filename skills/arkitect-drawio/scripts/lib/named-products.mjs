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

// resolveOne(text) returns the ref it would draw unattended, or null.
export function namedProducts(boxes, resolveOne) {
  const found = [];
  for (const { id, label } of boxes) {
    for (const text of labelParts(label)) {
      const icon = resolveOne(text);
      if (icon) found.push({ node: id, text, icon });
    }
  }
  return found;
}
