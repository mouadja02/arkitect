// How an orthogonal Draw.io edge runs, estimated from its two ports and any
// waypoints. validate-drawio.mjs checks a route with this, and the builder
// plans one with it (#237), so both mean the same line.
//
// A port is { x, y, vertical }: vertical when it leaves or enters through the
// top or bottom of its box.

// Two ports with nothing between them: Draw.io's orthogonal router draws a
// straight line when they align, an L when one is vertical and the other not,
// and otherwise a Z whose middle leg sits halfway across.
export function route(p, q) {
  if (Math.abs(p.x - q.x) < 1 || Math.abs(p.y - q.y) < 1) return [[p, q]];
  if (p.vertical !== q.vertical) {
    const corner = p.vertical ? { x: p.x, y: q.y } : { x: q.x, y: p.y };
    return [[p, corner], [corner, q]];
  }
  if (p.vertical) {
    const my = (p.y + q.y) / 2;
    return [[p, { x: p.x, y: my }], [{ x: p.x, y: my }, { x: q.x, y: my }], [{ x: q.x, y: my }, q]];
  }
  const mx = (p.x + q.x) / 2;
  return [[p, { x: mx, y: p.y }], [{ x: mx, y: p.y }, { x: mx, y: q.y }], [{ x: mx, y: q.y }, q]];
}

// Through waypoints the line runs point to point, turning at each; two points
// that do not share an axis are joined by an L.
export function routeThrough(p, points, q) {
  if (!points?.length) return route(p, q);
  const all = [p, ...points, q];
  const segments = [];
  for (let i = 0; i < all.length - 1; i++) {
    const a = all[i]; const b = all[i + 1];
    if (Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1) segments.push([a, b]);
    else {
      const corner = i === 0 && a.vertical ? { x: a.x, y: b.y } : { x: b.x, y: a.y };
      segments.push([a, corner], [corner, b]);
    }
  }
  return segments.filter(([a, b]) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 0.5);
}

export const crosses = ([p, q], r) => Math.max(p.x, q.x) > r.x + 1 && Math.min(p.x, q.x) < r.x + r.width - 1
  && Math.max(p.y, q.y) > r.y + 1 && Math.min(p.y, q.y) < r.y + r.height - 1;

export const lengthOf = (segments) => segments.reduce((n, [p, q]) => n + Math.abs(q.x - p.x) + Math.abs(q.y - p.y), 0);

// A point `d` along the route.
export function pointAt(segments, d) {
  let left = d;
  for (const [p, q] of segments) {
    const len = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
    if (left <= len) return { x: p.x + Math.sign(q.x - p.x) * left, y: p.y + Math.sign(q.y - p.y) * left };
    left -= len;
  }
  return segments.at(-1)[1];
}

// A caption hangs below its icon, centred, one line per `<br>`.
export function captionBox(g, lines, size) {
  const width = Math.max(...lines.map((l) => l.length)) * size * 0.55;
  return { x: g.x + g.width / 2 - width / 2, y: g.y + g.height + 2, width, height: lines.length * size * 1.25 };
}
