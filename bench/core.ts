import { finishLayout, prepareLayout, type Layout } from "../src/core/layout";
import type { Engine } from "./engines";
import type { BenchCase } from "./gen";

export interface Timing {
  engine: string;
  case: string;
  nodes: number;
  rankedEdges: number;
  edges: number;
  runs: number;
  /** prepare + engine + finish, ms: what the map view waits for. */
  totalMedian: number;
  totalP95: number;
  engineMedian: number;
  /** Inside WebAssembly only, ms. */
  computeMedian?: number;
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

export async function layoutOnce(engine: Engine, bench: BenchCase): Promise<{ layout: Layout; total: number; engine: number }> {
  const t0 = performance.now();
  const prepared = prepareLayout(bench.graph, { showSources: bench.showSources });
  const t1 = performance.now();
  const output = await engine.run(prepared.input, prepared.ids);
  const t2 = performance.now();
  const layout = finishLayout(prepared, output);
  const t3 = performance.now();
  return { layout, total: t3 - t0, engine: t2 - t1 };
}

/**
 * Two warm-up runs and seven measured ones. A case slower than 4 s per run gets one warm-up and
 * three runs, otherwise dagre on the largest graphs would take most of an hour.
 */
export async function time(engine: Engine, bench: BenchCase): Promise<{ timing: Timing; layout: Layout }> {
  const first = await layoutOnce(engine, bench);
  const slow = first.total > 4000;
  const runs = slow ? 3 : 7;
  if (!slow) await layoutOnce(engine, bench);
  const totals: number[] = [];
  const engines: number[] = [];
  const computes: number[] = [];
  let layout = first.layout;
  for (let i = 0; i < runs; i++) {
    const result = await layoutOnce(engine, bench);
    totals.push(result.total);
    engines.push(result.engine);
    if (engine.lastCompute !== undefined) computes.push(engine.lastCompute);
    layout = result.layout;
  }
  const prepared = prepareLayout(bench.graph, { showSources: bench.showSources });
  return {
    layout,
    timing: {
      engine: engine.id,
      case: bench.name,
      nodes: prepared.ids.length,
      rankedEdges: prepared.input.from.length,
      edges: prepared.edges.length,
      runs,
      totalMedian: round(median(totals)),
      totalP95: round(p95(totals)),
      engineMedian: round(median(engines)),
      computeMedian: computes.length ? round(median(computes)) : undefined,
    },
  };
}
