// The Ripple: where each Living Window sits in the graph.
//
// A radial tree, like a network diagram: the main window is the centre, the people it hurt (or
// who hurt it) sit on a ring around it, and each of them fans their own branches further out.
// Who-hurt-whom is a tree (every Monster has exactly one source), so this always works.
// Pure module: runs in the browser and under `node --test`.

// Angles are in degrees, counter-clockwise from "right". The first ring uses two fans, one on
// each side of the main window. Straight above is the Monster count and straight below are the
// caption and the choices, so those wedges stay empty.
export const FANS = [[-35, 45], [135, 215]];
const FAN_TOTAL = FANS.reduce((sum, [from, to]) => sum + (to - from), 0);
/** Maps a position 0..FAN_TOTAL along the two fans to an angle, skipping the gap between them. */
function fanAngle(at) {
  for (const [from, to] of FANS) {
    if (at <= to - from) return from + at;
    at -= to - from;
  }
  return FANS.at(-1)[1];
}
// The whole graph has to fit in view at once, so the rings are tight and the nodes are small
// compared with the main window, like the dots around the hub of a network diagram.
const RING = [0, 1.5, 2.25, 2.9, 3.45];    // distance from the centre for each step outward, in metres
const SIZE = [1, 0.82, 0.7, 0.6, 0.52];    // window size for each step, as a fraction of a full side window
const FAN = 110;                         // the widest a person's own branches may spread
const STRETCH_X = 1.1, STRETCH_Y = 0.6, LIFT = 0.05; // the main window is wide, so the rings are ovals

/**
 * nodeIds: characters with a side window, in the order their windows appeared.
 * links:   [{ from, to }] who gave whom a Monster.
 * rootIds: Set of characters shown in the main window (the centre of the graph).
 *
 * Returns Map id -> { x, y, angle, depth, scale, parent, loose }. x and y are metres right of
 * and above the centre of the main window, `parent` is the id one step closer to the centre
 * (null when that is the main window), and `loose` marks a window with no visible link.
 */
export function layoutRadial(nodeIds, links, rootIds) {
  const ROOT = null;
  const ids = new Set(nodeIds);
  const key = (id) => (rootIds.has(id) ? ROOT : id);
  const neighbours = new Map([[ROOT, []], ...nodeIds.map((id) => [id, []])]);
  for (const { from, to } of links) {
    const a = key(from), b = key(to);
    if (a === b || (a !== ROOT && !ids.has(a)) || (b !== ROOT && !ids.has(b))) continue;
    if (!neighbours.get(a).includes(b)) { neighbours.get(a).push(b); neighbours.get(b).push(a); }
  }

  // Walk outward from the centre. Anyone not reached hangs off the centre as a loose branch.
  const parent = new Map([[ROOT, undefined]]);
  const children = new Map([[ROOT, []], ...nodeIds.map((id) => [id, []])]);
  const loose = new Set();
  const walk = (start) => {
    const queue = [start];
    while (queue.length) {
      const node = queue.shift();
      for (const next of neighbours.get(node)) {
        if (parent.has(next)) continue;
        parent.set(next, node);
        children.get(node).push(next);
        queue.push(next);
      }
    }
  };
  walk(ROOT);
  for (const id of nodeIds) {
    if (parent.has(id)) continue;
    parent.set(id, ROOT);
    children.get(ROOT).push(id);
    loose.add(id);
    walk(id);
  }

  // A branch gets a share of the circle in proportion to how many leaves it ends in.
  const leaves = new Map();
  const count = (node) => {
    const kids = children.get(node);
    const total = kids.length ? kids.reduce((sum, kid) => sum + count(kid), 0) : 1;
    leaves.set(node, total);
    return total;
  };
  count(ROOT);

  const placement = new Map();
  const spread = (node, depth, from, to, toAngle = (at) => at) => {
    const kids = children.get(node);
    const total = kids.reduce((sum, kid) => sum + leaves.get(kid), 0);
    let at = from;
    for (const kid of kids) {
      const span = ((to - from) * leaves.get(kid)) / total;
      const angle = toAngle(at + span / 2);
      const ring = RING[Math.min(depth, RING.length - 1)] + Math.max(0, depth - (RING.length - 1)) * 0.4;
      const radians = (angle * Math.PI) / 180;
      placement.set(kid, {
        x: Math.cos(radians) * ring * STRETCH_X,
        y: Math.sin(radians) * ring * STRETCH_Y + LIFT,
        angle, depth,
        scale: SIZE[Math.min(depth, SIZE.length - 1)],
        parent: parent.get(kid),
        loose: loose.has(kid),
      });
      // This person's own branches fan outward around the direction they sit in.
      const fan = Math.min(Math.max(span, 26 * leaves.get(kid)), FAN);
      spread(kid, depth + 1, angle - fan / 2, angle + fan / 2);
      at += span;
    }
  };
  // A single branch would land straight above the main window; start it off to the side instead.
  if (children.get(ROOT).length === 1) spread(ROOT, 1, -20, 50);
  else spread(ROOT, 1, 0, FAN_TOTAL, fanAngle);
  return placement;
}
