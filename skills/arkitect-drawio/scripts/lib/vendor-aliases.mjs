// An alias on a cloud vendor's mark must name that product, not the idea it
// implements. AWS Glue answered to "etl", Step Functions to "state machine",
// S3 to "object storage", and each drew unattended with no vendor in the spec
// (#347): a diagram that says the ETL step runs on Glue is a claim the user
// never made. The suite checks every vendor pack's aliases against this rule.
// A vendor's own name made of generic words ("key vault", "api gateway") is
// still its name; the resolvers keep it from drawing without the vendor in
// the spec or the query (#231).

import { GENERIC_WORDS } from './generic-words.mjs';

const VENDOR_WORDS = new Set(['aws', 'amazon', 'azure', 'microsoft', 'google', 'gcp']);
const SMALL = new Set(['and', 'for', 'of', 'the', 'to', 'on', 'with']);

// A product's earlier name, a product sold under its family's mark, or an
// open-source product the vendor hosts: still that product, though no word of
// today's title is in it. A hosted one draws the vendor's mark only with its
// stack named; without, the product's own name decides (#283).
export const OTHER_NAMES = new Set([
  'quicksight', 'amazon quicksight', 'kinesis data analytics', 'kusto', 'elastic compute cloud', 'elastic mapreduce',
  'elasticsearch service', 'application load balancer', 'redis cache', 'memcached cache',
]);

const words = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const same = (w, t) => w === t || w === `${t}s` || t === `${w}s` || (Math.min(w.length, t.length) >= 3 && (t.startsWith(w) || w.startsWith(t)));
const initialsOf = (list) => list.filter((w) => !SMALL.has(w)).map((w) => w[0]).join('');

export function aliasNamesItsProduct(alias, title) {
  const all = words(alias);
  // "google redis" or "azure blob": the query names the vendor, so drawing its
  // mark claims nothing the user did not say.
  if (all.some((w) => VENDOR_WORDS.has(w)) || OTHER_NAMES.has(all.join(' '))) return true;
  const titled = words(title).filter((w) => !VENDOR_WORDS.has(w));
  // Its own words: "api gateway" for Amazon API Gateway, "key vault" for Key Vaults.
  if (all.every((w) => SMALL.has(w) || titled.some((t) => same(w, t)))) return true;
  // Its acronym, or the acronym spelled out: "iam", "relational database service".
  if (all.join('') === initialsOf(titled) || (all.length > 1 && titled.includes(initialsOf(all)))) return true;
  const distinct = all.filter((w) => !GENERIC_WORDS.has(w));
  if (!distinct.length) return false;
  // An acronym ("aks", "s3"), or a word of the product's name ("dynamo", "route53").
  if (all.length === 1 && all[0].length <= 5) return true;
  const squashed = titled.join('');
  return distinct.some((w) => titled.some((t) => same(w, t)) || squashed.includes(w));
}
