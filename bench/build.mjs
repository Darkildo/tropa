// Bundles the benchmark for Node and for Chromium. WebAssembly is inlined as base64, as main.js would carry it.
import esbuild from "esbuild";

const common = {
  bundle: true,
  target: "es2022",
  loader: { ".wasm": "base64" },
  logLevel: "warning",
  minify: true,
};

await esbuild.build({ ...common, entryPoints: ["bench/node-entry.ts"], platform: "node", format: "esm", outfile: "dist/bench/node.mjs",
  // elkjs calls require() for Node built-ins.
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});

const worker = await esbuild.build({ ...common, entryPoints: ["bench/worker.ts"], platform: "browser", format: "iife", write: false });
await esbuild.build({
  ...common,
  entryPoints: ["bench/browser-entry.ts"],
  platform: "browser",
  format: "esm",
  outfile: "dist/bench/browser.js",
  define: { WORKER_SOURCE: JSON.stringify(worker.outputFiles[0].text) },
});

await esbuild.build({ ...common, entryPoints: ["bench/wasm-init.ts"], platform: "node", format: "esm", outfile: "dist/bench/wasm-init.mjs" });
await esbuild.build({ ...common, entryPoints: ["bench/render-entry.ts"], platform: "browser", format: "esm", outfile: "dist/bench/render.js" });

// What each candidate would add to main.js.
for (const [name, entry] of [
  ["dagre", "bench/size/dagre.ts"],
  ["elk", "bench/size/elk.ts"],
  ["sugi-ts", "bench/size/sugi-ts.ts"],
  ["sugi-wasm", "bench/size/sugi-wasm.ts"],
]) {
  const result = await esbuild.build({ ...common, entryPoints: [entry], platform: "browser", format: "cjs", write: false });
  console.log(`size ${name} ${result.outputFiles[0].contents.length}`);
}
