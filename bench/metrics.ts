import type { Layout, Point } from "../src/core/layout";

export interface Quality {
  /** Pairs of drawn edges that cross, edges sharing a node not counted. */
  crossings: number;
  /** Edges drawn through a node they do not belong to. */
  throughNodes: number;
  width: number;
  height: number;
  /** Total drawn edge length, px. */
  edgeLength: number;
  ranks: number;
}

/** Samples the M/C path the plugin draws into a polyline. */
export function polyline(d: string): Point[] {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const out: Point[] = [{ x: numbers[0], y: numbers[1] }];
  for (let i = 2; i + 5 < numbers.length; i += 6) {
    const p0 = out[out.length - 1];
    const [x1, y1, x2, y2, x3, y3] = numbers.slice(i, i + 6);
    for (let k = 1; k <= 8; k++) {
      const t = k / 8;
      const a = (1 - t) ** 3;
      const b = 3 * (1 - t) ** 2 * t;
      const c = 3 * (1 - t) * t * t;
      const e = t ** 3;
      out.push({ x: a * p0.x + b * x1 + c * x2 + e * x3, y: a * p0.y + b * y1 + c * y2 + e * y3 });
    }
  }
  return out;
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  const d1 = (d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x);
  const d2 = (d.x - c.x) * (b.y - c.y) - (d.y - c.y) * (b.x - c.x);
  const d3 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d4 = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

const CELL = 120;

export function quality(layout: Layout): Quality {
  const edges = layout.edges.map((edge) => ({ edge, points: polyline(edge.path) }));
  let edgeLength = 0;
  // Spatial grid of segments.
  const grid = new Map<number, [number, number][]>();
  const cellKey = (cx: number, cy: number) => cx * 100_003 + cy;
  edges.forEach(({ points }, e) => {
    for (let s = 0; s + 1 < points.length; s++) {
      const a = points[s];
      const b = points[s + 1];
      edgeLength += Math.hypot(b.x - a.x, b.y - a.y);
      for (let cx = Math.floor(Math.min(a.x, b.x) / CELL); cx <= Math.floor(Math.max(a.x, b.x) / CELL); cx++) {
        for (let cy = Math.floor(Math.min(a.y, b.y) / CELL); cy <= Math.floor(Math.max(a.y, b.y) / CELL); cy++) {
          const key = cellKey(cx, cy);
          let list = grid.get(key);
          if (!list) grid.set(key, (list = []));
          list.push([e, s]);
        }
      }
    }
  });

  const crossingPairs = new Set<number>();
  const n = edges.length;
  for (const list of grid.values()) {
    for (let i = 0; i < list.length; i++) {
      const [e1, s1] = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const [e2, s2] = list[j];
        if (e1 === e2) continue;
        const a = edges[e1].edge;
        const b = edges[e2].edge;
        if (a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to) continue;
        const key = Math.min(e1, e2) * n + Math.max(e1, e2);
        if (crossingPairs.has(key)) continue;
        const p = edges[e1].points;
        const q = edges[e2].points;
        if (segmentsCross(p[s1], p[s1 + 1], q[s2], q[s2 + 1])) crossingPairs.add(key);
      }
    }
  }

  // Edges through foreign nodes, sampled along the polyline.
  const nodes = [...layout.nodes.values()];
  const nodeGrid = new Map<number, number[]>();
  nodes.forEach((node, i) => {
    for (let cx = Math.floor(node.x / CELL); cx <= Math.floor((node.x + node.width) / CELL); cx++) {
      for (let cy = Math.floor(node.y / CELL); cy <= Math.floor((node.y + node.height) / CELL); cy++) {
        const key = cellKey(cx, cy);
        let list = nodeGrid.get(key);
        if (!list) nodeGrid.set(key, (list = []));
        list.push(i);
      }
    }
  });
  let throughNodes = 0;
  for (const { edge, points } of edges) {
    let hit = false;
    for (let s = 0; s + 1 < points.length && !hit; s++) {
      for (let k = 0; k <= 4 && !hit; k++) {
        const x = points[s].x + ((points[s + 1].x - points[s].x) * k) / 4;
        const y = points[s].y + ((points[s + 1].y - points[s].y) * k) / 4;
        for (const i of nodeGrid.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) {
          const node = nodes[i];
          if (node.id === edge.from || node.id === edge.to) continue;
          if (x > node.x + 2 && x < node.x + node.width - 2 && y > node.y + 2 && y < node.y + node.height - 2) {
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) throughNodes++;
  }

  return {
    crossings: crossingPairs.size,
    throughNodes,
    width: Math.round(layout.width),
    height: Math.round(layout.height),
    edgeLength: Math.round(edgeLength),
    ranks: ranksOf(layout).size ? new Set(ranksOf(layout).values()).size : 0,
  };
}

/** Rank of every node, read from the drawing: centres closer than 20 px share a rank. */
export function ranksOf(layout: Layout): Map<string, number> {
  const centres = [...layout.nodes.values()].map((node) => ({ id: node.id, y: node.y + node.height / 2 })).sort((a, b) => a.y - b.y);
  const ranks = new Map<string, number>();
  let rank = -1;
  let last = -Infinity;
  for (const { id, y } of centres) {
    if (y - last > 20) rank++;
    last = y;
    ranks.set(id, rank);
  }
  return ranks;
}

/** Share of nodes on the same rank as in the reference layout. */
export function rankAgreement(layout: Layout, reference: Layout) {
  const a = ranksOf(layout);
  const b = ranksOf(reference);
  let same = 0;
  for (const [id, rank] of a) if (b.get(id) === rank) same++;
  return a.size ? same / a.size : 1;
}
