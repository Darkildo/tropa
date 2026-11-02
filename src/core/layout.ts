import type { LearningGraph } from "./graph";
import { ENGINES, type EngineInput, type EngineOutput } from "./layout-engine";

export type { EngineInput, EngineOutput } from "./layout-engine";

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

/** An engine's output with its paths written out for SVG, which the worker does off the main thread. */
export interface EngineResult {
  output: EngineOutput;
  paths: string[];
}

export interface PreparedLayout {
  ids: string[];
  input: EngineInput;
  /** `ranked` points into the engine's edges, `soft` into its soft links, -1 when not there. */
  edges: { from: string; to: string; kind: EdgeKind; ranked: number; soft: number }[];
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
      if (visible.has(requirement)) edges.push({ from: requirement, to: id, kind: "requires", ranked: -1, soft: -1 });
    }
    for (const taught of node.teaches) {
      if (visible.has(taught)) edges.push({ from: id, to: taught, kind: "teaches", ranked: -1, soft: -1 });
    }
    for (const soft of node.recommends) {
      if (visible.has(soft)) edges.push({ from: soft, to: id, kind: "recommends", ranked: -1, soft: -1 });
    }
  }

  // Soft links stay out of the ranking: they must not change the order of study.
  const ranked = new Map<string, number>();
  const pairs: [number, number, number][] = [];
  const softPairs = new Map<string, number>();
  const soft: [number, number][] = [];
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    if (edge.kind === "recommends") {
      const key = [edge.from, edge.to].sort().join("\0");
      let known = softPairs.get(key);
      if (known === undefined) {
        known = soft.length;
        softPairs.set(key, known);
        soft.push([index.get(edge.from)!, index.get(edge.to)!]);
      }
      edge.soft = known;
      continue;
    }
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
      softFrom: Uint32Array.from(soft, (p) => p[0]),
      softTo: Uint32Array.from(soft, (p) => p[1]),
      tight: visible.size > 150,
    },
    edges,
  };
}

export function finishLayout(prepared: PreparedLayout, { output, paths }: EngineResult): Layout {
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

  const ranked = input.from.length;
  const edges: LaidOutEdge[] = prepared.edges.map((edge) => {
    const path = edge.ranked >= 0 ? edge.ranked : edge.soft >= 0 ? ranked + edge.soft : -1;
    return {
      id: `${edge.kind}|${edge.from}|${edge.to}`,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      path: path >= 0 ? paths[path] : loopPath(nodes.get(edge.from)!),
    };
  });

  return { nodes, edges, width, height };
}

/** Lays the graph out on the calling thread. The map view goes through `LayoutRunner` instead. */
export function layoutGraph(graph: LearningGraph, options: LayoutOptions): Layout {
  const prepared = prepareLayout(graph, options);
  const output = ENGINES.ts.layout(prepared.input);
  return finishLayout(prepared, { output, paths: svgPaths(output) });
}

/** SVG path data for every path of an engine's output. */
export function svgPaths(output: EngineOutput) {
  return Array.from({ length: output.pathStart.length - 1 }, (_, path) => svgPath(output, path));
}

function svgPath({ pathStart, pathPoints }: EngineOutput, path: number) {
  const first = pathStart[path] * 2;
  const last = pathStart[path + 1] * 2;
  let d = `M${n(pathPoints[first])},${n(pathPoints[first + 1])}`;
  for (let i = first + 2; i < last; i += 6) {
    d += ` C${n(pathPoints[i])},${n(pathPoints[i + 1])} ${n(pathPoints[i + 2])},${n(pathPoints[i + 3])} ${n(pathPoints[i + 4])},${n(pathPoints[i + 5])}`;
  }
  return d;
}

/** A note that requires itself: a side arc keeps the loop from hiding behind it. */
function loopPath(node: LaidOutNode) {
  const x = node.x + node.width;
  const y = node.y + node.height / 2;
  return `M${n(x)},${n(y)} C${n(x + 48)},${n(y - 24)} ${n(x + 48)},${n(y + 24)} ${n(x)},${n(y)}`;
}

const n = (value: number) => Math.round(value * 10) / 10;
