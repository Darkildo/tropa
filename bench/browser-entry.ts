// The benchmark in Chromium: layout time of both engines, then how long the interface freezes
// while the map lays out, on the main thread and through the worker.
import layoutWorker from "tropa:layout-worker";
import { finishLayout, prepareLayout, svgPaths } from "../src/core/layout";
import { ENGINES as LAYOUT_ENGINES } from "../src/core/layout-engine";
import { LayoutRunner } from "../src/core/layout-runner";
import { ENGINES, time, type Timing } from "./core";
import { benchCases } from "./gen";

declare global {
  interface Window {
    benchDone?: unknown;
    /** Also time dagre on the 1000-concept graphs, which takes minutes. */
    benchFull?: boolean;
  }
}

/** Longest gap between ticks of a 4 ms timer while `task` runs: how long the interface would freeze. */
async function freeze(task: () => unknown) {
  let last = performance.now();
  let longest = 0;
  const timer = window.setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 4);
  await new Promise((resolve) => window.setTimeout(resolve, 30));
  last = performance.now();
  longest = 0;
  const start = performance.now();
  await task();
  const elapsed = performance.now() - start;
  await new Promise((resolve) => window.setTimeout(resolve, 30));
  window.clearInterval(timer);
  return { elapsed: Math.round(elapsed), longestPause: Math.round(longest) };
}

const timings: Timing[] = [];
const full = window.benchFull === true;
for (const bench of benchCases()) {
  for (const engine of ENGINES) {
    if (engine.id === "dagre" && !full && bench.graph.nodes.size >= 1000) continue;
    timings.push(time(engine, bench).timing);
    console.log(JSON.stringify(timings[timings.length - 1]));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

const worker = [];
for (const bench of benchCases([400, 1000]).filter((c) => ["400+m", "1000", "1000+m"].includes(c.name))) {
  const options = { showSources: bench.showSources };
  const main = await freeze(() => {
    const prepared = prepareLayout(bench.graph, options);
    const output = LAYOUT_ENGINES.ts.layout(prepared.input);
    finishLayout(prepared, { output, paths: svgPaths(output) });
  });
  const runner = new LayoutRunner(layoutWorker);
  const inWorker = await freeze(async () => {
    const prepared = prepareLayout(bench.graph, options);
    const output = await runner.run(prepared.input);
    finishLayout(prepared, output!);
  });
  runner.dispose();
  worker.push({ case: bench.name, main, worker: inWorker });
  console.log(JSON.stringify(worker[worker.length - 1]));
}

window.benchDone = { timings, worker };
