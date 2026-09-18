// The one test harness the three suites share: plain assertions, no framework.
//
// test() is synchronous. A callback that returns a promise would be counted
// before its assertions ran, and a rejection would escape the totals (#114), so
// it fails instead: settle the promise first, assert afterwards.

// { value } or { error }, never a rejection: await it at the top level, then
// assert on the result inside a synchronous test().
export const settle = async (promise) => {
  try { return { value: await promise }; } catch (error) { return { error }; }
};

export function createHarness({ log = console.log } = {}) {
  const counts = { pass: 0, fail: 0, skip: 0, sourceDependent: 0 };
  const failures = [];

  const failed = (name, message) => {
    counts.fail++; failures.push(`${name}: ${message}`);
    log(`FAIL  ${name}\n        ${message}`);
  };

  function test(name, fn) {
    let r;
    try {
      r = fn();
    } catch (e) {
      failed(name, e.message);
      return;
    }
    if (typeof r?.then === 'function') {
      // Observe the rejection so it cannot end the run; the test has already failed.
      try { r.then(undefined, () => {}); } catch {}
      failed(name, 'returned a promise; settle it before test() and assert synchronously');
      return;
    }
    if (r === 'skip') { counts.skip++; log(`skip  ${name}`); return; }
    counts.pass++; log(`ok    ${name}`);
  }

  // Tests that need reference diagrams of your own. They skip on a clone without
  // .analysis/sources.local.json, and run-tests.mjs checks the skip count quoted
  // in docs/testing.md against how many are declared this way (#47).
  function sourceTest(name, fn) {
    counts.sourceDependent++;
    test(name, fn);
  }

  // The summary run-tests.mjs parses, then exit 1 if anything failed.
  function finish(note) {
    log(`\n${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped`);
    log(`source-dependent: ${counts.sourceDependent}`);
    if (note) log(note);
    if (counts.fail) { log('\nfailures:'); for (const f of failures) log(`  - ${f}`); process.exit(1); }
  }

  return { test, sourceTest, finish, counts, failures };
}
