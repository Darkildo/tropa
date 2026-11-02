import dagre, { type EdgeLabel, type GraphLabel, type NodeLabel } from "@dagrejs/dagre";
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

/** Flat input for a layout engine. Node `i` is `ids[i]`; ranked edges only, soft links stay out. */
export interface EngineInput {
  width: Float64Array;
  height: Float64Array;
  from: Uint32Array;
  to: Uint32Array;
  weight: Uint32Array;
  /** Large graphs trade ranking quality for speed. */
  tight: boolean;
}

export interface EngineOutput {
  /** Node centres. */
  x: Float64Array;
  y: Float64Array;
  /** Bend points between the ends of each ranked edge. */
  inner: (Point[] | undefined)[];
  /** How many bend points make a real detour rather than a straight run. */
  routeFrom: number;
}

export type LayoutEngine = (input: EngineInput, ids: string[]) => EngineOutput;

export interface PreparedLayout {
  ids: string[];
  input: EngineInput;
  edges: { from: string; to: string; kind: EdgeKind; ranked: number }[];
}

export function prepareLayout(graph: LearningGraph, options: LayoutOptions): PreparedLayout {
  const visible = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (node.kind === "concept" && (!options.only || options.only.has(node.id))) visible.add(node.id);
  }
  if (options.showSources) {
    for (const node of graph.sources) {
      if (node.teaches.some((id) => visible.has(id)) || node.teaches.length === 0) visible.add(node.id);
    }
  }

  const ids = [...visible];
  const index = new Map(ids.map((id, i) => [id, i]));
  const width = new Float64Array(ids.length);
  const height = new Float64Array(ids.length);
  ids.forEach((id, i) => {
    const size = graph.nodes.get(id)!.kind === "concept" ? CONCEPT_SIZE : SOURCE_SIZE;
    width[i] = size.width;
    height[i] = size.height;
  });

  const edges: PreparedLayout["edges"] = [];
  for (const id of visible) {
    const node = graph.nodes.get(id)!;
    for (const requirement of node.requires) {
      if (visible.has(requirement)) edges.push({ from: requirement, to: id, kind: "requires", ranked: -1 });
    }
    for (const taught of node.teaches) {
      if (visible.has(taught)) edges.push({ from: id, to: taught, kind: "teaches", ranked: -1 });
    }
    for (const soft of node.recommends) {
      if (visible.has(soft)) edges.push({ from: soft, to: id, kind: "recommends", ranked: -1 });
    }
  }

  // Soft links stay out of the ranking: they must not change the order of study.
  const ranked = new Map<string, number>();
  const pairs: [number, number, number][] = [];
  for (const edge of edges) {
    if (edge.kind === "recommends" || edge.from === edge.to) continue;
    const key = `${edge.from}\0${edge.to}`;
    const weight = edge.kind === "requires" ? 2 : 1;
    const known = ranked.get(key);
    if (known === undefined) {
      ranked.set(key, pairs.length);
      edge.ranked = pairs.length;
      pairs.push([index.get(edge.from)!, index.get(edge.to)!, weight]);
    } else {
      edge.ranked = known;
      pairs[known][2] = weight;
    }
  }

  return {
    ids,
    input: {
      width,
      height,
      from: Uint32Array.from(pairs, (p) => p[0]),
      to: Uint32Array.from(pairs, (p) => p[1]),
      weight: Uint32Array.from(pairs, (p) => p[2]),
      tight: visible.size > 150,
    },
    edges,
  };
}

export function finishLayout(prepared: PreparedLayout, output: EngineOutput): Layout {
  const { ids, input } = prepared;
  const nodes = new Map<string, LaidOutNode>();
  let width = 0;
  let height = 0;
  ids.forEach((id, i) => {
    const node = { id, x: output.x[i] - input.width[i] / 2, y: output.y[i] - input.height[i] / 2, width: input.width[i], height: input.height[i] };
    nodes.set(id, node);
    width = Math.max(width, node.x + node.width);
    height = Math.max(height, node.y + node.height);
  });

  const laidOut: LaidOutEdge[] = prepared.edges.map((edge) => {
    const from = nodes.get(edge.from)!;
    const to = nodes.get(edge.to)!;
    const inner = edge.ranked < 0 ? undefined : output.inner[edge.ranked];
    return {
      id: `${edge.kind}|${edge.from}|${edge.to}`,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      path: edgePath(from, to, inner && inner.length >= output.routeFrom ? inner : undefined),
    };
  });

  return { nodes, edges: laidOut, width, height };
}

export const dagreEngine: LayoutEngine = (input, ids) => dagreWith(input, ids, input.tight ? "tight-tree" : "network-simplex");

export type DagreRanker = "network-simplex" | "tight-tree" | "longest-path";

export function dagreWith(input: EngineInput, ids: string[], ranker: DagreRanker): EngineOutput {
  const g = new dagre.graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>({ multigraph: false });
  g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 64, edgesep: 18, marginx: 0, marginy: 0, ranker });
  g.setDefaultEdgeLabel(() => ({}));
  ids.forEach((id, i) => g.setNode(id, { width: input.width[i], height: input.height[i] }));
  for (let e = 0; e < input.from.length; e++) {
    g.setEdge(ids[input.from[e]], ids[input.to[e]], { minlen: 1, weight: input.weight[e] });
  }

  dagre.layout(g);

  const x = new Float64Array(ids.length);
  const y = new Float64Array(ids.length);
  ids.forEach((id, i) => {
    const { x: nx = 0, y: ny = 0 } = g.node(id);
    x[i] = nx;
    y[i] = ny;
  });
  const inner = Array.from(input.from, (from, e) => g.edge(ids[from], ids[input.to[e]])?.points?.slice(1, -1));
  // Dagre leaves a label slot in the middle of every edge, so one bend point is still a straight run.
  return { x, y, inner, routeFrom: 2 };
}

export function layoutGraph(graph: LearningGraph, options: LayoutOptions, engine: LayoutEngine = dagreEngine): Layout {
  const prepared = prepareLayout(graph, options);
  return finishLayout(prepared, engine(prepared.input, prepared.ids));
}

export function edgePath(from: LaidOutNode, to: LaidOutNode, inner?: Point[]) {
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

  if (!inner) {
    const bend = Math.max(28, (end.y - start.y) * 0.5);
    return `M${n(start.x)},${n(start.y)} C${n(start.x)},${n(start.y + bend)} ${n(end.x)},${n(end.y - bend)} ${n(end.x)},${n(end.y)}`;
  }

  // Keep dagre's detours around other nodes, but leave and enter each node vertically.
  const detour = inner.filter((p) => p.y > start.y + 8 && p.y < end.y - 8);
  return basisSpline([start, { x: start.x, y: start.y + 26 }, ...detour, { x: end.x, y: end.y - 26 }, end]);
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
