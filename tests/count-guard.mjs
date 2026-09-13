// The fresh-clone test count, checked (#47).
//
// It used to be written by hand in four files, and it drifted twice: once
// copied from a checkout whose local sources ran extra tests, once left behind
// as tests were added. Now docs/testing.md states it once and run-tests.mjs
// checks it on every full run, using the two facts that hold on any machine:
//
//   - passed + failed + skipped is the number of tests, whether or not local
//     reference diagrams are present;
//   - on a clone without them, the skips are exactly the tests declared with
//     sourceTest() in the engine suites.

export const COUNT_LINE = /On a fresh clone expect `(\d+) passed, 0 failed, (\d+) skipped`/;

export function documentedCount(markdown) {
  const m = COUNT_LINE.exec(markdown);
  return m ? { passed: Number(m[1]), skipped: Number(m[2]) } : null;
}

export function checkCounts({ documented, totals, sourceDependent, sourcesPresent }) {
  const problems = [];
  const total = totals.pass + totals.fail + totals.skip;
  const expected = { passed: total - sourceDependent, skipped: sourceDependent };
  const line = `\`${expected.passed} passed, 0 failed, ${expected.skipped} skipped\``;
  if (!documented) {
    problems.push(`docs/testing.md has no "On a fresh clone expect \`N passed, 0 failed, M skipped\`" line; add one reading ${line}`);
  } else {
    if (documented.passed + documented.skipped !== total) {
      problems.push(`docs/testing.md quotes ${documented.passed + documented.skipped} tests `
        + `(${documented.passed} passed + ${documented.skipped} skipped) but ${total} ran; change it to ${line}`);
    }
    if (documented.skipped !== sourceDependent) {
      problems.push(`docs/testing.md quotes ${documented.skipped} skipped but ${sourceDependent} tests need local sources; change it to ${line}`);
    }
  }
  if (!sourcesPresent && totals.skip !== sourceDependent) {
    problems.push(`${totals.skip} tests skipped on a checkout without local sources, but only ${sourceDependent} are marked `
      + 'source-dependent; declare a test that needs reference diagrams with sourceTest()');
  }
  return { problems, expected };
}
