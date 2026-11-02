import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { prepareLayout } from "../src/core/layout";
import { ENGINES, initWasm } from "./engines";
import { benchCases } from "./gen";
import { runAll } from "./run";

const out = "dist/bench";
mkdirSync(`${out}/inputs`, { recursive: true });

// Inputs for the native Rust run: the same flat arrays the engines get.
for (const bench of benchCases()) {
  const { input } = prepareLayout(bench.graph, { showSources: bench.showSources });
  const lines = [
    `${input.width.length} ${input.from.length} ${input.tight ? 1 : 0}`,
    Array.from(input.width).join(" "),
    Array.from(input.height).join(" "),
    Array.from(input.from).join(" "),
    Array.from(input.to).join(" "),
    Array.from(input.weight).join(" "),
  ];
  writeFileSync(`${out}/inputs/${bench.name}.txt`, lines.join("\n") + "\n");
}

// The Rust port must draw exactly what the TypeScript original draws.
initWasm();
const ts = ENGINES.find((engine) => engine.id === "sugi-ts")!;
const wasm = ENGINES.find((engine) => engine.id === "sugi-wasm")!;
for (const bench of benchCases()) {
  const { input, ids } = prepareLayout(bench.graph, { showSources: bench.showSources });
  const a = await ts.run(input, ids);
  const b = await wasm.run(input, ids);
  let diff = 0;
  for (let i = 0; i < a.x.length; i++) diff = Math.max(diff, Math.abs(a.x[i] - b.x[i]), Math.abs(a.y[i] - b.y[i]));
  const points = a.inner.reduce((count, p, e) => count + (JSON.stringify(p) === JSON.stringify(b.inner[e]) ? 0 : 1), 0);
  let ys = 0;
  for (let i = 0; i < a.y.length; i++) if (a.y[i] !== b.y[i]) ys++;
  console.log(`port check ${bench.name}: max coordinate difference ${diff}, edges with different bends ${points}, nodes on another rank ${ys}`);
}

if (process.argv.includes("--check")) process.exit(0);

// One case per process (`--case=400+m`), rows appended as they finish: an engine that runs out of
// memory takes down only its own case, and bench/node.sh records it as such.
const only = process.argv.find((arg) => arg.startsWith("--case="))?.slice(7);
const rowsFile = `${out}/node.jsonl`;
const finished = new Set(
  existsSync(rowsFile)
    ? readFileSync(rowsFile, "utf8").split("\n").filter(Boolean).map((line) => {
        const row = JSON.parse(line) as { engine: string; case: string };
        return `${row.engine}|${row.case}`;
      })
    : [],
);
const cases = benchCases().filter((bench) => !only || bench.name === only);
await runAll(
  "node",
  true,
  (line) => console.log(line),
  cases,
  (row) => appendFileSync(rowsFile, JSON.stringify(row) + "\n"),
  (engine, bench) => finished.has(`${engine}|${bench}`),
);
console.log(`case ${only ?? "all"} done`);
