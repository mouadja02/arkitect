// Where each generated edge leaves, enters and runs, decided from the grid
// (#237). Left to Draw.io's router an edge between columns often drew an L
// whose leg ran down the target's column, through whatever was stacked there,
// and an agent on a field test wrote a 5 KB routing pass to fix it by hand.
//
//   - Between columns an edge leaves and enters sideways, so it turns in the
//     gap between them. When one end's centre falls inside the other's height,
//     both ends sit at that height and the line is straight.
//   - Within a column it leaves and enters vertically, below any caption (#45).
//   - Ends that would share one point on a side are spread along it, so two
//     flows into one port, or a request and its reply, stay two lines (#246,
//     #272).
//   - Only when that route would still cross a node or a caption does the edge
//     get waypoints, through the gaps between columns and rows. Draw.io keeps a
//     waypoint where it is when a node moves.
//   - Each label goes on the longest straight run of its route that is clear of
//     borders, nodes and the last 30px before the arrowhead (#241).
//
// Every route is estimated with lib/routes.mjs, which validate checks with too.

import { routeThrough, crosses, lengthOf, pointAt } from './routes.mjs';

export const SIDES = ['left', 'right', 'top', 'bottom'];
const SPREAD = 16;         // px between ends spread along one side
const ARROW_CLEAR = 30;    // px before the arrowhead a label stays off (#241)
const HEADER = 28;         // px strip at a container's top that carries its name
const LABEL_PAD = 6;       // px kept clear around a label chip

const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const along = (side) => (side === 'left' || side === 'right' ? 'y' : 'x');
const horizontal = (side) => side === 'left' || side === 'right';

// `at` is a fraction along the side; `drop` pushes a bottom end below a caption.
function portOf(box, side, at, drop = 0) {
  if (side === 'left') return { x: box.x, y: box.y + at * box.h, vertical: false };
  if (side === 'right') return { x: box.x + box.w, y: box.y + at * box.h, vertical: false };
  if (side === 'top') return { x: box.x + at * box.w, y: box.y, vertical: true };
  return { x: box.x + at * box.w, y: box.y + box.h + drop, vertical: true };
}

function styleOf(end, box, side, at, drop) {
  const x = side === 'left' ? 0 : side === 'right' ? 1 : at;
  const y = side === 'top' ? 0 : side === 'bottom' ? 1 : at;
  const r = (n) => Math.round(n * 1000) / 1000;
  return `${end}X=${r(x)};${end}Y=${r(y)};${end}Dx=0;${end}Dy=${drop};${drop ? `${end}Perimeter=0;` : ''}`;
}

// A per-edge override: "right", or { "side": "right", "at": 0.25 }. Null when
// it is absent; `bad` when it cannot be used, so the caller can report it.
export function readEnd(value) {
  if (value === undefined || value === null) return null;
  const side = typeof value === 'string' ? value : value?.side;
  const at = typeof value === 'object' ? value.at : undefined;
  if (!SIDES.includes(side) || (at !== undefined && !(typeof at === 'number' && at >= 0 && at <= 1))) return { bad: true };
  return at === undefined ? { side } : { side, at, fixed: true };
}

// edges: [{ from, to, exit, entry, label, labelPos }]
// boxes: id -> { x, y, w, h, caption, lines } for every node and boundary
// obstacles, captions: [{ id, box: { x, y, width, height } }]
// containers: [{ id, box }]; grid: { colX, rowY, colPitch, rowPitch, iconSize, captionRoom, captionLine }
// label: (text) -> { width, height } of its chip
export function planEdges({ edges, boxes, obstacles, captions, containers, grid, label }) {
  const plans = edges.map((e) => {
    const a = boxes.get(e.from); const b = boxes.get(e.to);
    if (!a || !b || e.from === e.to) return null;
    const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
    const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
    const ca = centre(a); const cb = centre(b);
    let exit; let entry;
    if (gapX > 0) {
      exit = { side: cb.x > ca.x ? 'right' : 'left' };
      entry = { side: cb.x > ca.x ? 'left' : 'right' };
    } else if (gapY > 0) {
      exit = { side: cb.y > ca.y ? 'bottom' : 'top' };
      entry = { side: cb.y > ca.y ? 'top' : 'bottom' };
    } else if (!e.exit && !e.entry) return null;          // one inside the other: Draw.io decides
    else { exit = { side: 'right' }; entry = { side: 'left' }; }
    const given = { exit: readEnd(e.exit), entry: readEnd(e.entry) };
    for (const end of ['exit', 'entry']) {
      if (given[end] && !given[end].bad) Object.assign(end === 'exit' ? exit : entry, given[end]);
    }
    // Level when one centre lies inside the other's extent on the shared axis.
    const k = along(exit.side); const len = k === 'y' ? 'h' : 'w';
    const inside = (v, box) => v >= box[k] + 6 && v <= box[k] + box[len] - 6;
    let ce = ca[k]; let cn = cb[k];
    if (along(entry.side) === k && Math.abs(ce - cn) >= 1) {
      if (inside(ca[k], b)) cn = ca[k];
      else if (inside(cb[k], a)) ce = cb[k];
    }
    if (!exit.fixed) exit.at = (ce - a[k]) / a[len];
    if (!entry.fixed) entry.at = along(entry.side) === k ? (cn - b[k]) / b[len] : 0.5;
    return { e, a, b, exit, entry };
  });

  // Ends that meet at one point of one side are spread along it, ordered by
  // where their other end is, so they do not cross each other on the way.
  const bySide = new Map();
  plans.forEach((p, i) => {
    if (!p) return;
    for (const end of ['exit', 'entry']) {
      const s = p[end];
      if (s.fixed) continue;
      const box = end === 'exit' ? p.a : p.b; const node = end === 'exit' ? p.e.from : p.e.to;
      const other = end === 'exit' ? p.b : p.a;
      const key = `${node}\u0000${s.side}`;
      if (!bySide.has(key)) bySide.set(key, []);
      bySide.get(key).push({ i, end, s, box, at: s.at, towards: centre(other)[along(s.side)] });
    }
  });
  const spread = new Set();
  for (const ends of bySide.values()) {
    const groups = [];
    for (const x of [...ends].sort((m, n) => m.at - n.at)) {
      const last = groups.at(-1);
      const len = horizontal(x.s.side) ? x.box.h : x.box.w;
      if (last && Math.abs(last[0].at - x.at) * len < 2) last.push(x); else groups.push([x]);
    }
    for (const g of groups) {
      if (g.length < 2) continue;
      const len = horizontal(g[0].s.side) ? g[0].box.h : g[0].box.w;
      const step = Math.min(SPREAD, (len - 12) / (g.length - 1)) / len;
      g.sort((m, n) => m.towards - n.towards || m.i - n.i || (m.end === 'exit' ? -1 : 1));
      g.forEach((x, n) => {
        x.s.at = Math.min(1 - 6 / len, Math.max(6 / len, g[0].at + (n - (g.length - 1) / 2) * step));
        spread.add(`${x.i}:${x.end}`);
      });
    }
  }
  // An end left alone follows its spread partner when it can, and stays level.
  plans.forEach((p, i) => {
    if (!p || along(p.exit.side) !== along(p.entry.side)) return;
    const k = along(p.exit.side); const len = k === 'y' ? 'h' : 'w';
    const pe = p.a[k] + p.exit.at * p.a[len]; const pn = p.b[k] + p.entry.at * p.b[len];
    const free = (end) => !p[end].fixed && !spread.has(`${i}:${end}`);
    if (spread.has(`${i}:entry`) && free('exit') && pn > p.a[k] + 6 && pn < p.a[k] + p.a[len] - 6) p.exit.at = (pn - p.a[k]) / p.a[len];
    else if (spread.has(`${i}:exit`) && free('entry') && pe > p.b[k] + 6 && pe < p.b[k] + p.b[len] - 6) p.entry.at = (pe - p.b[k]) / p.b[len];
  });

  // A bottom end drops below the caption hanging there.
  const dropOf = (box, side) => (side === 'bottom' && box.caption
    ? Math.max(grid.captionRoom, box.lines * grid.captionLine + 4) : 0);

  const clear = (segments, p) => !obstacles.some((o) => o.id !== p.e.from && o.id !== p.e.to && segments.some((s) => crosses(s, o.box)))
    && !captions.some((c) => segments.some((s) => crosses(s, c.box)));

  // Channels: the middle of each gap between grid columns and between rows.
  const colOf = (x) => Math.floor((x - grid.colX(0)) / grid.colPitch);
  const rowOf = (y) => Math.floor((y - grid.rowY(0)) / grid.rowPitch);
  const colGap = (c) => grid.colX(c) + (grid.iconSize + grid.colPitch) / 2;
  const rowGap = (r) => grid.rowY(r) + (grid.iconSize + grid.captionRoom + grid.rowPitch) / 2;

  // Chips already placed, so two labels on parallel lines do not stack.
  const chips = [];
  return plans.map((p) => {
    if (!p) return null;
    const exitDrop = dropOf(p.a, p.exit.side); const entryDrop = dropOf(p.b, p.entry.side);
    const ex = portOf(p.a, p.exit.side, p.exit.at, exitDrop);
    const en = portOf(p.b, p.entry.side, p.entry.at, entryDrop);
    let points = [];
    let segments = routeThrough(ex, points, en);
    if (!clear(segments, p)) {
      const tries = [];
      const [c0, c1] = [colOf(ex.x), colOf(en.x)].sort((m, n) => m - n);
      const [r0, r1] = [rowOf(Math.min(ex.y, en.y)), rowOf(Math.max(ex.y, en.y))];
      const cols = []; for (let c = c0 - 1; c <= c1; c++) cols.push(colGap(c));
      const rows = []; for (let r = r0 - 1; r <= r1; r++) rows.push(rowGap(r));
      if (!ex.vertical && !en.vertical) {
        for (const x of cols) tries.push([{ x, y: ex.y }, { x, y: en.y }]);
        for (const x1 of cols) for (const x2 of cols) for (const y of rows) {
          tries.push([{ x: x1, y: ex.y }, { x: x1, y }, { x: x2, y }, { x: x2, y: en.y }]);
        }
      } else if (ex.vertical && en.vertical) {
        for (const y of rows) tries.push([{ x: ex.x, y }, { x: en.x, y }]);
        for (const y1 of rows) for (const y2 of rows) for (const x of cols) {
          tries.push([{ x: ex.x, y: y1 }, { x, y: y1 }, { x, y: y2 }, { x: en.x, y: y2 }]);
        }
      }
      // A detour's first point lies out from the exit's side, its last out from
      // the entry's, so it never doubles back through either end.
      const outside = (pt, port, side) => (side === 'right' ? pt.x > port.x : side === 'left' ? pt.x < port.x
        : side === 'bottom' ? pt.y > port.y : pt.y < port.y);
      const best = tries
        .filter((pts) => outside(pts[0], ex, p.exit.side) && outside(pts.at(-1), en, p.entry.side))
        .map((pts) => ({ pts: pts.filter((pt, n) => n === 0 || pt.x !== pts[n - 1].x || pt.y !== pts[n - 1].y), segs: null }))
        .map((t) => ({ ...t, segs: routeThrough(ex, t.pts, en) }))
        .filter((t) => clear(t.segs, p))
        .sort((m, n) => m.pts.length - n.pts.length || lengthOf(m.segs) - lengthOf(n.segs))[0];
      if (best) { points = best.pts.map((pt) => ({ x: Math.round(pt.x), y: Math.round(pt.y) })); segments = routeThrough(ex, points, en); }
    }
    const style = styleOf('exit', p.a, p.exit.side, p.exit.at, exitDrop) + styleOf('entry', p.b, p.entry.side, p.entry.at, entryDrop);
    const labelX = p.e.label && p.e.labelPos === undefined ? placeLabel(segments, label(p.e.label), obstacles, captions, containers, chips) : null;
    return { style, points, segments, labelX };
  });
}

// The middle of the longest stretch of straight line where the chip sits clear
// of every container border and name strip, every node, caption and chip
// already placed, and the arrowhead. The chip is padded for the check: an
// estimate that clears a border by a pixel touches it in the render.
function placeLabel(segments, chip, obstacles, captions, containers, chips) {
  const total = lengthOf(segments);
  const boxAt = (pt, pad = 0) => ({ x: pt.x - chip.width / 2 - pad, y: pt.y - chip.height / 2 - pad, width: chip.width + 2 * pad, height: chip.height + 2 * pad });
  const overlap = (m, n) => Math.min(m.x + m.width, n.x + n.width) - Math.max(m.x, n.x) > 1
    && Math.min(m.y + m.height, n.y + n.height) - Math.max(m.y, n.y) > 1;
  const within = (m, n) => m.x >= n.x - 1 && m.y >= n.y - 1 && m.x + m.width <= n.x + n.width + 1 && m.y + m.height <= n.y + n.height + 1;
  const ok = (box) => containers.every(({ box: g }) => !overlap(box, g)
      || (within(box, g) && !overlap(box, { x: g.x, y: g.y, width: g.width, height: HEADER })))
    && ![...obstacles, ...captions].some((o) => overlap(box, o.box)) && !chips.some((c) => overlap(box, c));
  const place = (d) => {
    chips.push(boxAt(pointAt(segments, d)));
    return Math.round((2 * d / total - 1) * 1000) / 1000;
  };
  let start = 0;
  const runs = segments.map(([a, b]) => {
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const run = { from: start, len, flat: Math.abs(a.y - b.y) < 1 };
    start += len;
    return run;
  });
  let best = null;
  for (const run of runs) {
    const half = (run.flat ? chip.width : chip.height) / 2 + LABEL_PAD;
    const lo = run.from + half; const hi = Math.min(run.from + run.len - half, total - ARROW_CLEAR - half);
    let from = null;
    for (let d = lo; d <= hi + 0.01; d += 2) {
      const clearHere = d <= hi && ok(boxAt(pointAt(segments, d), LABEL_PAD));
      if (clearHere && from === null) from = d;
      if ((!clearHere || d + 2 > hi) && from !== null) {
        const to = clearHere ? d : d - 2;
        if (!best || to - from > best.to - best.from) best = { from, to };
        from = null;
      }
    }
  }
  if (best) return place((best.from + best.to) / 2);
  const run = [...runs].sort((m, n) => n.len - m.len)[0];
  return place(run.from + run.len / 2);
}
