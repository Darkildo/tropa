import { time, type Timing } from "./core";
import { ENGINES, initWasm, type WasmInit } from "./engines";
import { benchCases, type BenchCase } from "./gen";
import { quality, rankAgreement, type Quality } from "./metrics";
import type { Layout } from "../src/core/layout";

export interface Row extends Timing {
  quality?: Quality;
  /** Share of nodes on the same rank as dagre (as shipped). */
  rankAgreement?: number;
  skipped?: string;
  error?: string;
}

export interface Results {
  env: string;
  userAgent: string;
  wasm: Record<string, WasmInit>;
  rows: Row[];
}

/** A run longer than this stops the engine from trying bigger graphs. */
const GIVE_UP_MS = 60_000;

export async function runAll(
  env: string,
  withQuality: boolean,
  log: (line: string) => void,
  cases: BenchCase[] = benchCases(),
  onRow: (row: Row) => void = () => {},
  done: (engine: string, bench: string) => boolean = () => false,
): Promise<Results> {
  const wasm = initWasm();
  const rows: Row[] = [];
  const gaveUpAt = new Map<string, number>();
  for (const bench of cases) {
    let reference: Layout | undefined;
    for (const engine of ENGINES) {
      if (done(engine.id, bench.name)) continue;
      const limit = gaveUpAt.get(engine.id);
      const nodes = bench.graph.nodes.size;
      if (limit !== undefined && nodes >= limit) {
        rows.push({ engine: engine.id, case: bench.name, skipped: `over ${GIVE_UP_MS / 1000} s on a smaller graph` } as Row);
        log(`${env} ${bench.name} ${engine.id}: skipped`);
        continue;
      }
      try {
        const { timing, layout } = await time(engine, bench);
        const row: Row = { ...timing };
        if (engine.id === "dagre") reference = layout;
        if (withQuality) {
          row.quality = quality(layout);
          if (reference) row.rankAgreement = Math.round(rankAgreement(layout, reference) * 1000) / 1000;
        }
        if (timing.totalMedian > GIVE_UP_MS) gaveUpAt.set(engine.id, nodes + 1);
        rows.push(row);
        onRow(row);
        log(`${env} ${bench.name} ${engine.id}: ${timing.totalMedian} ms (engine ${timing.engineMedian}${timing.computeMedian !== undefined ? `, wasm ${timing.computeMedian}` : ""})${row.quality ? ` crossings ${row.quality.crossings}` : ""}`);
      } catch (error) {
        rows.push({ engine: engine.id, case: bench.name, error: String(error) } as Row);
        log(`${env} ${bench.name} ${engine.id}: ERROR ${String(error)}`);
      }
    }
  }
  return { env, userAgent: typeof navigator === "undefined" ? `node ${process.version}` : navigator.userAgent, wasm, rows };
}
