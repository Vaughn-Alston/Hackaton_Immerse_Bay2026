// The Ripple: where each Living Window sits in the graph.
//
// Who-hurt-whom is a tree (every Monster has exactly one source), so it can be drawn as a
// mind-map with no crossing lines: the main window is the hub, and everyone else branches
// out to its left and right. Pure module: runs in the browser and under `node --test`.

export const COLUMNS = 3; // columns per wing; deeper steps stack downward in the last column

/**
 * nodeIds: characters with a side window, in the order their windows appeared.
 * links:   [{ from, to }] who gave whom a Monster.
 * rootIds: Set of characters shown in the main window (they are the hub).
 *
 * Returns Map id -> { side: -1 | 1, col: 1..COLUMNS, row, rows, parent, loose }.
 * `row` counts from the top of that wing (may be fractional for a parent centred on its
 * children), `rows` is how many rows that wing uses, `parent` is the id one step closer to
 * the hub (null for the hub itself), and `loose` marks a window with no visible link.
 */
export function layoutGraph(nodeIds, links, rootIds) {
  const ROOT = null;
  const ids = new Set(nodeIds);
  const key = (id) => (rootIds.has(id) ? ROOT : id);
  const neighbours = new Map([[ROOT, []], ...nodeIds.map((id) => [id, []])]);
  for (const { from, to } of links) {
    const a = key(from), b = key(to);
    if (a === b || (a !== ROOT && !ids.has(a)) || (b !== ROOT && !ids.has(b))) continue;
    if (!neighbours.get(a).includes(b)) { neighbours.get(a).push(b); neighbours.get(b).push(a); }
  }

  // Walk outward from the hub. Anyone not reached hangs off the hub as a loose branch.
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

  const size = new Map();
  const measure = (node) => { let total = 1; for (const child of children.get(node)) total += measure(child); size.set(node, total); return total; };
  measure(ROOT);

  // Deal the hub's branches to the two wings, largest first, always onto the lighter one.
  const wings = { [-1]: [], 1: [] };
  const weight = { [-1]: 0, 1: 0 };
  for (const branch of [...children.get(ROOT)].sort((a, b) => size.get(b) - size.get(a))) {
    const side = weight[1] <= weight[-1] ? 1 : -1;
    wings[side].push(branch);
    weight[side] += size.get(branch);
  }

  const placement = new Map();
  for (const side of [-1, 1]) {
    let nextRow = 0;
    const placed = [];
    const place = (node, depth) => {
      const kids = children.get(node);
      let row;
      if (depth >= COLUMNS) {
        // Last column: this window takes the next row and its own branch stacks below it.
        row = nextRow++;
        for (const kid of kids) place(kid, depth + 1);
      } else if (kids.length === 0) {
        row = nextRow++;
      } else {
        const rows = kids.map((kid) => place(kid, depth + 1));
        row = (Math.min(...rows) + Math.max(...rows)) / 2; // level with the middle of its children
      }
      const entry = { side, col: Math.min(depth, COLUMNS), row, rows: 0, parent: parent.get(node), loose: loose.has(node) };
      placement.set(node, entry);
      placed.push(entry);
      return row;
    };
    for (const branch of wings[side]) place(branch, 1);
    for (const entry of placed) entry.rows = nextRow;
  }
  return placement;
}
