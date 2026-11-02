// Bundles the benchmark for Chromium, with the layout worker inlined as in main.js.
import esbuild from "esbuild";
import { layoutWorker } from "../layout-worker.esbuild.mjs";

await esbuild.build({
  entryPoints: ["bench/browser-entry.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: "dist/bench/browser.js",
  plugins: [layoutWorker],
  logLevel: "warning",
});
await esbuild.build({
  entryPoints: ["bench/render-entry.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: "dist/bench/render.js",
  logLevel: "warning",
});
