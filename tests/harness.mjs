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

// fetch() for the downloaders, with no network (#444). `routes` maps a URL to
// { status, headers, body } or { size } for a body streamed in 64 KB chunks, or
// { stall: true } for a server that never answers. A redirect is followed the
// way fetch() follows one, plain http included, unless the caller asks for
// 'manual'. `calls` holds each request's URL and options, `pulled` the body
// bytes a reader actually took.
export function fakeWeb(routes) {
  const web = { calls: [], pulled: 0 };
  const respond = (url, opts) => {
    const route = routes[url];
    if (!route) return new Response('not found', { status: 404, statusText: 'Not Found' });
    if (route.stall) {
      // An open socket keeps the process alive; AbortSignal.timeout() does not.
      const socket = setInterval(() => {}, 1000);
      return new Promise((_, reject) => opts.signal?.addEventListener('abort', () => {
        clearInterval(socket);
        reject(opts.signal.reason);
      }));
    }
    let body = route.body ?? null;
    if (route.size) {
      let sent = 0;
      body = new ReadableStream({
        pull(controller) {
          if (sent >= route.size) { controller.close(); return; }
          const n = Math.min(65536, route.size - sent);
          sent += n; web.pulled += n;
          controller.enqueue(new Uint8Array(n).fill(0x20));
        },
      });
    }
    return new Response(body, { status: route.status ?? 200, headers: route.headers });
  };
  web.fetch = async (url, opts = {}) => {
    web.calls.push({ url, opts });
    let at = url;
    let res = await respond(at, opts);
    for (let hops = 0; opts.redirect !== 'manual' && res.status >= 300 && res.status < 400; hops++) {
      if (hops === 20) throw new TypeError('fetch failed: redirect count exceeded');
      at = new URL(res.headers.get('location'), at).href;
      web.calls.push({ url: at, opts });
      res = await respond(at, opts);
    }
    Object.defineProperty(res, 'url', { value: at });
    return res;
  };
  return web;
}
