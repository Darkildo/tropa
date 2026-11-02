import esbuild from "esbuild";
import { layoutWorker } from "./layout-worker.esbuild.mjs";
import { localesAsText } from "./locales.esbuild.mjs";

const production = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  treeShaking: true,
  outfile: "main.js",
  // Keeps non-Latin strings as UTF-8 instead of \u escapes, which would triple their size.
  charset: "utf8",
  plugins: [localesAsText, layoutWorker],
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
