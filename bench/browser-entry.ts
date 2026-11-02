import { dagreEngine, finishLayout, prepareLayout, type EngineOutput } from "../src/core/layout";
import { benchCases } from "./gen";
import { runAll } from "./run";

declare const WORKER_SOURCE: string;

/** Longest pause of a 4 ms timer while `task` runs: how long the UI would freeze. */
async function longestPause(task: () => Promise<unknown> | unknown) {
  let last = performance.now();
  let longest = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 4);
  await new Promise((resolve) => setTimeout(resolve, 20));
  last = performance.now();
  longest = 0;
  const t = performance.now();
  await task();
  const elapsed = performance.now() - t;
  await new Promise((resolve) => setTimeout(resolve, 20));
  clearInterval(timer);
  return { elapsed, longest: Math.max(longest, 0) };
}

async function workerExperiment(log: (line: string) => void) {
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  const rows = [];
  for (const bench of benchCases([400, 1000]).filter((c) => ["400", "400+m", "1000"].includes(c.name))) {
    const prepared = prepareLayout(bench.graph, { showSources: bench.showSources });
    // Main thread, warm.
    dagreEngine(prepared.input, prepared.ids);
    const sync = await longestPause(() => finishLayout(prepared, dagreEngine(prepared.input, prepared.ids)));

    const worker = new Worker(url);
    const ask = () =>
      new Promise<{ output: EngineOutput; computeMs: number }>((resolve) => {
        worker.onmessage = (event) => resolve(event.data);
        worker.postMessage({ input: prepared.input, ids: prepared.ids });
      });
    let computeMs = 0;
    const cold = await longestPause(async () => {
      const reply = await ask();
      computeMs = reply.computeMs;
      finishLayout(prepared, reply.output);
    });
    const coldCompute = computeMs;
    const warm = await longestPause(async () => {
      const reply = await ask();
      computeMs = reply.computeMs;
      finishLayout(prepared, reply.output);
    });
    worker.terminate();
    const row = {
      case: bench.name,
      syncMs: Math.round(sync.elapsed),
      syncLongestPause: Math.round(sync.longest),
      workerColdMs: Math.round(cold.elapsed),
      workerColdCompute: Math.round(coldCompute),
      workerWarmMs: Math.round(warm.elapsed),
      workerWarmCompute: Math.round(computeMs),
      workerLongestPause: Math.round(Math.max(cold.longest, warm.longest)),
    };
    rows.push(row);
    log(`worker ${JSON.stringify(row)}`);
  }
  return rows;
}

declare global {
  interface Window {
    benchDone?: unknown;
    benchLog: string[];
  }
}

window.benchLog = [];
const log = (line: string) => {
  window.benchLog.push(line);
  console.log(line);
};
const results = await runAll("chromium", false, log);
const worker = await workerExperiment(log);
window.benchDone = { ...results, worker };
