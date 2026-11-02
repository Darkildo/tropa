import type { LearningGraph } from "../src/core/graph";
import { layoutGraph, type Layout, type LayoutOptions } from "../src/core/layout";
import { layoutDagre } from "./dagre-as-shipped";
import type { BenchCase } from "./gen";

export interface Engine {
  id: string;
  label: string;
  layout(graph: LearningGraph, options: LayoutOptions): Layout;
}

export const ENGINES: Engine[] = [
  { id: "dagre", label: "dagre (0.1)", layout: layoutDagre },
  { id: "tropa", label: "own Sugiyama (0.2)", layout: layoutGraph },
];

export interface Timing {
  engine: string;
  case: string;
  nodes: number;
  runs: number;
  /** Graph in, drawn paths out, ms. */
  median: number;
  p95?: number;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const p95 = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
};
const round = (value: number) => Math.round(value * 100) / 100;

function once(engine: Engine, bench: BenchCase) {
  const t = performance.now();
  const layout = engine.layout(bench.graph, { showSources: bench.showSources });
  return { layout, ms: performance.now() - t };
}

/**
 * Two warm-up runs and seven measured ones. A case slower than 4 s per run gets the first run as
 * its warm-up and three measured runs, without p95: dagre on the largest graphs takes minutes.
 */
export function time(engine: Engine, bench: BenchCase): { timing: Timing; layout: Layout } {
  const first = once(engine, bench);
  const slow = first.ms > 4000;
  const runs = slow ? 3 : 7;
  if (!slow) once(engine, bench);
  const times: number[] = [];
  let layout = first.layout;
  for (let i = 0; i < runs; i++) {
    const result = once(engine, bench);
    times.push(result.ms);
    layout = result.layout;
  }
  return {
    layout,
    timing: { engine: engine.id, case: bench.name, nodes: layout.nodes.size, runs, median: round(median(times)), p95: slow ? undefined : round(p95(times)) },
  };
}
