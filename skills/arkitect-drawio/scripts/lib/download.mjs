// The one way a downloader reaches the network: a logo (fetch-logo), a logo
// made into an icon (make-icon) and the Excalidraw library catalogue
// (browse-libraries) all go through download().
//
// Each followed redirect used to be trusted, plain http included, and the body
// was read whole before its size was checked, with no time limit (#444). Here
// every hop must be https, the body stops being read at its limit, and a server
// that stalls is given up on.

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
export const MAX_REDIRECTS = 5;
export const DOWNLOAD_TIMEOUT_MS = 30_000;

const isHttps = (url) => /^https:\/\//i.test(url);

// { bytes, url }: the body, and the https URL it finally came from.
export async function download(url, { limit, headers = {}, timeout = DOWNLOAD_TIMEOUT_MS } = {}) {
  if (!isHttps(url)) throw new Error('only https URLs are accepted');
  const signal = AbortSignal.timeout(timeout);
  try {
    let at = url;
    for (let hops = 0; ; hops++) {
      // Followed by hand: fetch's own 'follow' takes an https URL to http.
      const res = await fetch(at, { redirect: 'manual', headers, signal });
      const location = REDIRECTS.has(res.status) ? res.headers.get('location') : null;
      if (location) {
        await res.body?.cancel();
        if (hops === MAX_REDIRECTS) throw new Error(`more than ${MAX_REDIRECTS} redirects from ${url}`);
        at = new URL(location, at).href;
        if (!isHttps(at)) throw new Error(`refused a redirect to ${at}: only https is followed`);
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${at}`);
      }
      const declared = Number(res.headers.get('content-length'));
      if (declared > limit) {
        await res.body?.cancel();
        throw new Error(`too large: ${declared} bytes (limit ${limit})`);
      }
      const chunks = [];
      let size = 0;
      if (res.body) {
        for await (const chunk of res.body) {
          size += chunk.length;
          // Leaving the loop cancels the stream: nothing past the limit is read.
          if (size > limit) throw new Error(`too large: over ${limit} bytes, the limit`);
          chunks.push(chunk);
        }
      }
      return { bytes: Buffer.concat(chunks), url: at };
    }
  } catch (error) {
    if (error?.name === 'TimeoutError') throw new Error(`timed out after ${timeout / 1000} s fetching ${url}`);
    throw error;
  }
}
