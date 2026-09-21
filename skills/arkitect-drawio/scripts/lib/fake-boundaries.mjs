// A box drawn where a boundary was meant, found by both engines' builders after
// layout (#204). A boundary owns what is inside it: the nodes are its children,
// they move with it, and Draw.io marks it container=1. A plain box laid over the
// same nodes draws the same picture and owns nothing, and validation passes.
//
// Two shapes of the mistake are caught, both from geometry the builder already
// has, so no model has to notice:
//
//   - a plain shape whose box holds another node's centre point;
//   - a width or height under 10px, which is a count of grid cells read as
//     pixels. The one spec on record did this: width 2 drew a 2px dot.
//
// Reported, never refused. A wide backdrop with nothing inside it is fine, and
// an agent may have a reason the check cannot see.

const TINY = 10;

const COVERS = 'a box draws over these nodes but does not own them: a boundary '
  + 'goes in `boundaries` (col, row, cols, rows) and each node inside names it '
  + 'as its `parent`';
const CELLS = 'width and height are pixels, not grid cells: a boundary that spans '
  + 'cells goes in `boundaries` with `cols` and `rows`';

// Bigger in both directions, and around the other node's centre. A shape
// smaller than the node it sits on is not claiming to contain it: a 2px dot
// centred on the same cell as an icon would otherwise "cover" the icon.
const holds = (a, b) => {
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  return a.width > b.width && a.height > b.height
    && x > a.x && x < a.x + a.width && y > a.y && y < a.y + a.height;
};

// nodes: [{ field, id, plain, box: {x, y, width, height}, width, height }], in
// spec order. `field` names the node in the report ("nodes[3]", or
// "pages[1].nodes[3]"); `plain` is whether it draws as a plain shape that could
// pass for a container; `width`/`height` are what the spec asked for, if it did.
export function looksLikeBoundary(nodes) {
  const out = [];
  for (const n of nodes) {
    for (const key of ['width', 'height']) {
      if (typeof n[key] === 'number' && n[key] < TINY) {
        out.push({ field: `${n.field}.${key}`, node: n.id, value: n[key], hint: CELLS });
      }
    }
    if (!n.plain) continue;
    // A node under 10px is already reported for its size; naming it again as
    // something a neighbour swallowed would send the fix to the wrong node.
    const covers = nodes
      .filter((m) => m !== n && m.box.width >= TINY && m.box.height >= TINY && holds(n.box, m.box))
      .map((m) => m.id);
    if (covers.length) out.push({ field: n.field, node: n.id, covers, hint: COVERS });
  }
  return out;
}
