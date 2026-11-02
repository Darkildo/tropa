import dagre from "@dagrejs/dagre";
import type { LearningGraph } from "./graph";

export interface Point {
  x: number;
  y: number;
}

export interface LaidOutNode {
  id: string;
  /** Top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export type EdgeKind = "requires" | "teaches" | "recommends";

export interface LaidOutEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  path: string;
}

export interface Layout {
  nodes: Map<string, LaidOutNode>;
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

export const CONCEPT_SIZE = { width: 216, height: 62 };
export const SOURCE_SIZE = { width: 196, height: 46 };

export interface LayoutOptions {
  showSources: boolean;
  /** Keep only these concepts. */
  only?: Set<string>;
}

export function layoutGraph(graph: LearningGraph, options: LayoutOptions): Layout {
  const visible = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (node.kind === "concept" && (!options.only || options.only.has(node.id))) visible.add(node.id);
  }
  if (options.showSources) {
    for (const node of graph.sources) {
      if (node.teaches.some((id) => visible.has(id)) || node.teaches.length === 0) visible.add(node.id);
    }
  }

  const g = new dagre.graphlib.Graph({ multigraph: false });
  g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 64, edgesep: 18, marginx: 0, marginy: 0, ranker: visible.size > 150 ? "tight-tree" : "network-simplex" });
  g.setDefaultEdgeLabel(() => ({}));

  for (const id of visible) {
    const size = graph.nodes.get(id)!.kind === "concept" ? CONCEPT_SIZE : SOURCE_SIZE;
    g.setNode(id, { ...size });
  }

  const edges: { from: string; to: string; kind: EdgeKind }[] = [];
  for (const id of visible) {
    const node = graph.nodes.get(id)!;
    for (const requirement of node.requires) {
      if (visible.has(requirement)) edges.push({ from: requirement, to: id, kind: "requires" });
    }
    for (const taught of node.teaches) {
      if (visible.has(taught)) edges.push({ from: id, to: taught, kind: "teaches" });
    }
    for (const soft of node.recommends) {
      if (visible.has(soft)) edges.push({ from: soft, to: id, kind: "recommends" });
    }
  }

  // Soft links stay out of the ranking: they must not change the order of study.
  for (const edge of edges) {
    if (edge.kind === "recommends" || edge.from === edge.to) continue;
    g.setEdge(edge.from, edge.to, { minlen: 1, weight: edge.kind === "requires" ? 2 : 1 });
  }

  dagre.layout(g);

  const nodes = new Map<string, LaidOutNode>();
  let width = 0;
  let height = 0;
  for (const id of visible) {
    const placed = g.node(id);
    const node = {
      id,
      x: placed.x - placed.width / 2,
      y: placed.y - placed.height / 2,
      width: placed.width,
      height: placed.height,
    };
    nodes.set(id, node);
    width = Math.max(width, node.x + node.width);
    height = Math.max(height, node.y + node.height);
  }

  const laidOut: LaidOutEdge[] = edges.map((edge) => {
    const from = nodes.get(edge.from)!;
    const to = nodes.get(edge.to)!;
    const routed = edge.kind === "recommends" ? undefined : g.edge(edge.from, edge.to)?.points;
    return {
      ...edge,
      id: `${edge.kind}|${edge.from}|${edge.to}`,
      path: edgePath(from, to, routed),
    };
  });

  return { nodes, edges: laidOut, width, height };
}

function edgePath(from: LaidOutNode, to: LaidOutNode, routed?: Point[]) {
  const start = { x: from.x + from.width / 2, y: from.y + from.height };
  const end = { x: to.x + to.width / 2, y: to.y };

  if (end.y <= start.y) {
    // Only loops and soft links can run upwards. A side arc keeps them from hiding behind nodes.
    const side = Math.max(from.x + from.width, to.x + to.width);
    const startSide = { x: from.x + from.width, y: from.y + from.height / 2 };
    const endSide = { x: to.x + to.width, y: to.y + to.height / 2 };
    const reach = side + Math.max(48, Math.abs(startSide.y - endSide.y) * 0.25);
    return `M${n(startSide.x)},${n(startSide.y)} C${n(reach)},${n(startSide.y)} ${n(reach)},${n(endSide.y)} ${n(endSide.x)},${n(endSide.y)}`;
  }

  if (!routed || routed.length <= 3) {
    const bend = Math.max(28, (end.y - start.y) * 0.5);
    return `M${n(start.x)},${n(start.y)} C${n(start.x)},${n(start.y + bend)} ${n(end.x)},${n(end.y - bend)} ${n(end.x)},${n(end.y)}`;
  }

  // Keep dagre's detours around other nodes, but leave and enter each node vertically.
  const inner = routed.slice(1, -1).filter((p) => p.y > start.y + 8 && p.y < end.y - 8);
  return basisSpline([start, { x: start.x, y: start.y + 26 }, ...inner, { x: end.x, y: end.y - 26 }, end]);
}

/** Uniform cubic B-spline, clamped at both ends. It stays inside the control points, so it never overshoots. */
function basisSpline(points: Point[]) {
  const p = [points[0], points[0], ...points, points[points.length - 1], points[points.length - 1]];
  let d = `M${n(points[0].x)},${n(points[0].y)}`;
  for (let i = 1; i < p.length - 2; i++) {
    const [b, c, e] = [p[i], p[i + 1], p[i + 2]];
    d += ` C${n((2 * b.x + c.x) / 3)},${n((2 * b.y + c.y) / 3)} ${n((b.x + 2 * c.x) / 3)},${n((b.y + 2 * c.y) / 3)} ${n((b.x + 4 * c.x + e.x) / 6)},${n((b.y + 4 * c.y + e.y) / 6)}`;
  }
  return d;
}

const n = (value: number) => Math.round(value * 10) / 10;
