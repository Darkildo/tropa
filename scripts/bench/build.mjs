// Bundles the benchmark for Chromium, with the layout worker inlined as in main.js.
import esbuild from "esbuild";
import { layoutWasm } from "../../layout-wasm.esbuild.mjs";
import { layoutWorker } from "../../layout-worker.esbuild.mjs";

await esbuild.build({
  entryPoints: ["scripts/bench/browser-entry.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: "dist/bench/browser.js",
  plugins: [layoutWorker, layoutWasm],
  logLevel: "warning",
});
await esbuild.build({
  entryPoints: ["scripts/bench/render-entry.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: "dist/bench/render.js",
  logLevel: "warning",
});
