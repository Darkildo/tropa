// Layout benchmark in Node: time and drawing quality of the 0.1 layout (dagre) and the current one.
// npm run bench [-- --full]   --full adds dagre on the 1000-concept graphs (minutes, ~4 GB of heap)
import { appendFileSync } from "node:fs";
import { ENGINES, time, type Timing } from "./core";
import { benchCases } from "./gen";
import { quality, rankAgreement, type Quality } from "./metrics";
import type { Layout } from "../src/core/layout";

const full = process.argv.includes("--full");

/** Cases where the current layout must draw no worse than dagre. */
const CHECKED = ["200", "400+m"];
/** Width and height may differ from dagre's by this share. */
const SIZE_TOLERANCE = 0.15;

interface Row {
  timing: Timing;
  quality: Quality;
  sameRanks?: number;
}

const rows = new Map<string, Row>();
for (const bench of benchCases()) {
  let reference: Layout | undefined;
  for (const engine of ENGINES) {
    if (engine.id === "dagre" && !full && bench.graph.nodes.size >= 1000) continue;
    const { timing, layout } = time(engine, bench);
    const row: Row = { timing, quality: quality(layout) };
    if (engine.id === "dagre") reference = layout;
    else if (reference) row.sameRanks = rankAgreement(layout, reference);
    rows.set(`${engine.id}|${bench.name}`, row);
    console.error(`${bench.name} ${engine.id}: ${timing.median} ms, ${row.quality.crossings} crossings, ${row.quality.throughNodes} through nodes`);
  }
}

const cases = [...new Set([...rows.keys()].map((key) => key.split("|")[1]))];
const ms = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value < 10 ? value.toFixed(1) : Math.round(value)} ms`);
const cell = (engine: string, name: string, pick: (row: Row) => string) => {
  const row = rows.get(`${engine}|${name}`);
  return row ? pick(row) : "—";
};

const lines = [
  "| graph | nodes | dagre | own | crossings dagre / own | through nodes dagre / own | width × height dagre | width × height own | same rank |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
];
for (const name of cases) {
  const own = rows.get(`tropa|${name}`)!;
  lines.push(
    [
      name,
      String(own.timing.nodes),
      cell("dagre", name, (row) => ms(row.timing.median)),
      ms(own.timing.median),
      `${cell("dagre", name, (row) => String(row.quality.crossings))} / ${own.quality.crossings}`,
      `${cell("dagre", name, (row) => String(row.quality.throughNodes))} / ${own.quality.throughNodes}`,
      cell("dagre", name, (row) => `${row.quality.width} × ${row.quality.height}`),
      `${own.quality.width} × ${own.quality.height}`,
      own.sameRanks === undefined ? "—" : `${Math.round(own.sameRanks * 100)}%`,
    ].join(" | ").replace(/^/, "| ").concat(" |"),
  );
}

const failures: string[] = [];
for (const name of CHECKED) {
  const own = rows.get(`tropa|${name}`)?.quality;
  const dagre = rows.get(`dagre|${name}`)?.quality;
  if (!own || !dagre) continue;
  if (own.crossings > dagre.crossings) failures.push(`${name}: ${own.crossings} crossings, dagre ${dagre.crossings}`);
  if (own.throughNodes > dagre.throughNodes) failures.push(`${name}: ${own.throughNodes} edges through nodes, dagre ${dagre.throughNodes}`);
  for (const side of ["width", "height"] as const) {
    if (Math.abs(own[side] / dagre[side] - 1) > SIZE_TOLERANCE) failures.push(`${name}: ${side} ${own[side]}, dagre ${dagre[side]}`);
  }
}
lines.push("", failures.length ? `Quality check failed:\n${failures.map((line) => `- ${line}`).join("\n")}` : `Quality check passed on ${CHECKED.join(", ")}: no more crossings or edges through nodes than dagre, size within ${SIZE_TOLERANCE * 100}%.`);

const table = lines.join("\n");
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Layout benchmark\n\n${table}\n`);
process.exit(failures.length ? 1 : 0);
