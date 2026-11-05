// Entry of the layout worker. esbuild bundles it into a string inside main.js (layout-worker.esbuild.mjs),
// with the WebAssembly engine inside it, so main.js carries the module once.
import wasmBase64 from "tropa:layout-wasm";
import { svgPaths } from "./layout";
import { ENGINES, type LayoutEngine } from "./layout-engine";
import type { LayoutReply, LayoutRequest } from "./layout-runner";
import { fromBase64, wasmEngine } from "./layout-wasm";

interface WorkerScope {
  onmessage: ((event: MessageEvent<LayoutRequest>) => void) | null;
  postMessage(reply: LayoutReply, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

/** Compiled on the first request that asks for it; `null` once it failed, then TypeScript takes over. */
let wasm: LayoutEngine | null | undefined;
/** Why WebAssembly is out, sent back with every reply so the runner can tell; not logged, it is not an error. */
let fallback: string | undefined;

function engine(id: string): LayoutEngine {
  if (id !== "wasm") return ENGINES[id] ?? ENGINES.ts;
  if (wasm === undefined) {
    try {
      wasm = wasmEngine(fromBase64(wasmBase64));
    } catch (error) {
      fallback = `WebAssembly layout unavailable: ${String(error)}`;
      wasm = null;
    }
  }
  return wasm ?? ENGINES.ts;
}

scope.onmessage = (event) => {
  const { id, engine: wanted, input } = event.data;
  try {
    let used = engine(wanted);
    let output;
    try {
      output = used.layout(input);
    } catch (error) {
      if (used.id === "ts") throw error;
      fallback = `WebAssembly layout failed: ${String(error)}`;
      wasm = null;
      used = ENGINES.ts;
      output = used.layout(input);
    }
    // Writing out the paths is a good share of the work on large maps, so it is done here too.
    const result = { output, paths: svgPaths(output) };
    scope.postMessage({ id, engine: used.id, fallback, result }, [output.x.buffer, output.y.buffer, output.pathStart.buffer, output.pathPoints.buffer]);
  } catch (error) {
    scope.postMessage({ id, error: String(error) }, []);
  }
};
