import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// `import wasm from "tropa:layout-wasm"` gives the layout engine's WebAssembly as base64 text, so
// main.js carries it without a file of its own. Build it first: npm run build:wasm.
const path = resolve("dist/wasm/tropa_layout.wasm");

export const layoutWasm = {
  name: "layout-wasm",
  setup(build) {
    build.onResolve({ filter: /^tropa:layout-wasm$/ }, () => ({ path, namespace: "tropa-wasm" }));
    build.onLoad({ filter: /.*/, namespace: "tropa-wasm" }, async () => {
      const bytes = await readFile(path).catch(() => {
        throw new Error("dist/wasm/tropa_layout.wasm is missing: run npm run build:wasm (needs Rust, see README)");
      });
      return { contents: `export default ${JSON.stringify(bytes.toString("base64"))};`, loader: "js", watchFiles: [path] };
    });
  },
};
