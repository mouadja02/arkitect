// A boundary is sized to hold its members, so it covers every grid cell
// between them, and a node the spec put outside it, set between two members,
// was drawn inside it with nothing to tell it apart. Both validators passed
// (#378). A trust, network or account boundary is a claim about the system, so
// both builders list it after layout, and both validators warn on it, for
// Draw.io from each cell's `parent`, for Excalidraw from the `parent` the
// builder stamps into customData.
//
// `items` are the nodes and boundaries on one page: { id, parent, box,
// boundary }, a box being { x, y, width, height } on the page. Text and other
// free labels are left out by the caller: a caption laid over a boundary
// claims nothing. Each item whose box overlaps a boundary that is neither one
// of its ancestors nor inside it comes back once as { id, boundary, isBoundary };
// two boundaries that overlap come back once, not once each way.

const overlaps = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0
  && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0;

export function strayMembers(items) {
  const parentOf = new Map(items.map((it) => [it.id, it.parent ?? null]));
  // validateSpec refuses a boundary cycle; the seen set only keeps a
  // hand-edited file from spinning.
  const inside = (id, ancestor) => {
    const seen = new Set();
    for (let at = parentOf.get(id); at != null && !seen.has(at); at = parentOf.get(at)) {
      if (at === ancestor) return true;
      seen.add(at);
    }
    return false;
  };
  const out = [];
  const pairs = new Set();
  for (const b of items.filter((it) => it.boundary)) {
    for (const it of items) {
      if (it.id === b.id || inside(it.id, b.id) || inside(b.id, it.id) || !overlaps(it.box, b.box)) continue;
      const pair = [it.id, b.id].sort().join('\n');
      if (it.boundary && pairs.has(pair)) continue;
      pairs.add(pair);
      out.push({ id: it.id, boundary: b.id, isBoundary: Boolean(it.boundary) });
    }
  }
  return out;
}

export const strayNote = ({ id, boundary, isBoundary }) => `${isBoundary ? 'boundary' : 'node'} "${id}" is drawn `
  + `inside or across boundary "${boundary}" but is not its member: move it past the members of "${boundary}", `
  + `or make it a member (\`parent\`)`;
