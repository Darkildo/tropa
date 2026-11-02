import esbuild from "esbuild";
import { resolve } from "node:path";

// `import source from "tropa:layout-worker"` gives the layout worker as a script, bundled on every
// build, so main.js stays a single file and the worker needs no file of its own.
export const layoutWorker = {
  name: "layout-worker",
  setup(build) {
    build.onResolve({ filter: /^tropa:layout-worker$/ }, () => ({ path: "layout-worker", namespace: "tropa" }));
    build.onLoad({ filter: /.*/, namespace: "tropa" }, async () => {
      const result = await esbuild.build({
        entryPoints: ["src/core/layout-worker.ts"],
        bundle: true,
        format: "iife",
        target: "es2020",
        minify: true,
        write: false,
        metafile: true,
        logLevel: "warning",
      });
      return {
        contents: `export default ${JSON.stringify(result.outputFiles[0].text)};`,
        loader: "js",
        watchFiles: Object.keys(result.metafile.inputs).map((path) => resolve(path)),
      };
    });
  },
};
