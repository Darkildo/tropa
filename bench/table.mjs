// Markdown tables from bench/results (copied from dist/bench after a run) → dist/bench/tables.md
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const CASES = ["sample", "sample+m", "100", "100+m", "200", "200+m", "400", "400+m", "1000", "1000+m"];
const ENGINES = ["dagre", "dagre-lp", "dagre-ns", "elk", "sugi-ts", "sugi-wasm", "crate-wasm"];

const node = readFileSync("dist/bench/node.jsonl", "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const chromium = existsSync("dist/bench/chromium.json") ? JSON.parse(readFileSync("dist/bench/chromium.json", "utf8")) : { rows: [], worker: [] };
const native = existsSync("dist/bench/native.jsonl")
  ? Object.fromEntries(readFileSync("dist/bench/native.jsonl", "utf8").split("\n").filter(Boolean).map((line) => {
      const row = JSON.parse(line);
      return [row.case, row];
    }))
  : {};

const find = (rows, engine, bench) => rows.find((row) => row.engine === engine && row.case === bench);
const ms = (value) => (value === undefined ? "—" : value >= 1000 ? `${(value / 1000).toFixed(1)} s` : value >= 10 ? `${Math.round(value)} ms` : `${value.toFixed(1)} ms`);
// Slow cases: three runs, so the p95 column would only repeat the slowest one.
const cell = (row) => (!row ? "—" : row.error ? "OOM" : row.skipped ? "не дождались" : `${ms(row.totalMedian)}${row.runs === 3 ? "³" : ""}`);

const out = [];
const nodesOf = (bench) => node.find((row) => row.case === bench && row.nodes)?.nodes ?? "";

for (const [title, rows] of [["Node", node], ["Chromium", chromium.rows]]) {
  out.push(`### Время раскладки, ${title} (медиана, prepare + движок + finish)`, "");
  out.push(`| граф | узлов | ${ENGINES.join(" | ")} |`, `| --- | ---: | ${ENGINES.map(() => "---:").join(" | ")} |`);
  for (const bench of CASES) out.push(`| ${bench} | ${nodesOf(bench)} | ${ENGINES.map((engine) => cell(find(rows, engine, bench))).join(" | ")} |`);
  out.push("", "³ — медленный случай: 1 разогрев и 3 прогона вместо 2 и 7, p95 не считается.", "");
}

out.push("### Rust: WebAssembly против нативного кода", "");
out.push("| граф | узлов | TS (Node) | WASM, только расчёт (Node) | WASM, с копированием (Node) | WASM (Chromium) | нативный Rust | WASM / натив |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const bench of CASES) {
  const ts = find(node, "sugi-ts", bench);
  const wasm = find(node, "sugi-wasm", bench);
  const wasmChromium = find(chromium.rows, "sugi-wasm", bench);
  const nat = native[bench];
  out.push(
    `| ${bench} | ${nodesOf(bench)} | ${ms(ts?.engineMedian)} | ${ms(wasm?.computeMedian)} | ${ms(wasm?.engineMedian)} | ${ms(wasmChromium?.computeMedian)} | ${ms(nat?.median)} | ${nat && wasm?.computeMedian ? (wasm.computeMedian / nat.median).toFixed(1) + "×" : "—"} |`,
  );
}
out.push("");

out.push("### Качество раскладки (Node, по нарисованным кривым)", "");
out.push("Пересечения — пары пересекающихся рёбер без общих узлов; «сквозь узел» — рёбра, проходящие через чужую карточку; ранги — доля узлов на том же уровне, что у dagre.", "");
for (const bench of ["sample+m", "200", "400+m", "1000+m"]) {
  out.push(`**${bench}**`, "", "| движок | пересечения | сквозь узел | ширина × высота | длина рёбер | ранги как у dagre |", "| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const engine of ENGINES) {
    const row = find(node, engine, bench);
    if (!row?.quality) continue;
    const q = row.quality;
    out.push(`| ${engine} | ${q.crossings} | ${q.throughNodes} | ${Math.round(q.width)} × ${Math.round(q.height)} | ${Math.round(q.edgeLength)} | ${row.rankAgreement === undefined ? "—" : Math.round(row.rankAgreement * 100) + "%"} |`);
  }
  out.push("");
}

if (chromium.worker?.length) {
  out.push("### dagre в Web Worker (Chromium)", "");
  out.push("| граф | синхронно | самая длинная пауза UI | worker, холодный | worker, тёплый | пауза UI с worker |", "| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const row of chromium.worker) out.push(row.skipped ? `| ${row.case} | не дождались | | | | |` : `| ${row.case} | ${ms(row.syncMs)} | ${ms(row.syncLongestPause)} | ${ms(row.workerColdMs)} | ${ms(row.workerWarmMs)} | ${ms(row.workerLongestPause)} |`);
  out.push("");
}

if (existsSync("dist/bench/wasm-init-node.jsonl")) {
  // Cold start in a fresh Node process, median of the runs: what the plugin pays once on load.
  const runs = readFileSync("dist/bench/wasm-init-node.jsonl", "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const med = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];
  out.push(`### Холодный старт WebAssembly (Node, медиана ${runs.length} запусков)`, "", "| модуль | .wasm | base64 в main.js | декодирование | компиляция | инстанцирование |", "| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const key of ["own", "crate"]) {
    const w = runs[0][key];
    out.push(`| ${key === "own" ? "свой Sugiyama" : "rust-sugiyama"} | ${Math.round(w.wasmBytes / 1024)} КБ | ${Math.round(w.base64Bytes / 1024)} КБ | ${ms(med(runs.map((r) => r[key].decodeMs)))} | ${ms(med(runs.map((r) => r[key].compileMs)))} | ${ms(med(runs.map((r) => r[key].instantiateMs)))} |`);
  }
  out.push("");
}

writeFileSync("dist/bench/tables.md", out.join("\n"));
console.log(out.join("\n"));
