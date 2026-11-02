// Entry of the layout worker. esbuild bundles it into a string inside main.js (layout-worker.esbuild.mjs).
import { svgPaths } from "./layout";
import { ENGINES } from "./layout-engine";
import type { LayoutReply, LayoutRequest } from "./layout-runner";

interface WorkerScope {
  onmessage: ((event: MessageEvent<LayoutRequest>) => void) | null;
  postMessage(reply: LayoutReply, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { id, engine, input } = event.data;
  try {
    const output = ENGINES[engine].layout(input);
    // Writing out the paths is a good share of the work on large maps, so it is done here too.
    const result = { output, paths: svgPaths(output) };
    scope.postMessage({ id, result }, [output.x.buffer, output.y.buffer, output.pathStart.buffer, output.pathPoints.buffer]);
  } catch (error) {
    scope.postMessage({ id, error: String(error) }, []);
  }
};
