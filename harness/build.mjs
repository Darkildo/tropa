import esbuild from "esbuild";
import { localesAsText } from "../locales.esbuild.mjs";
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist/preview", { recursive: true });
await esbuild.build({
  entryPoints: ["harness/entry.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: "dist/preview/preview.js",
  alias: { obsidian: "./harness/obsidian-mock.ts" },
  charset: "utf8",
  plugins: [localesAsText],
  logLevel: "warning",
});
copyFileSync("harness/index.html", "dist/preview/index.html");
copyFileSync("styles.css", "dist/preview/styles.css");
