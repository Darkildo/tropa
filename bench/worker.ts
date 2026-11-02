import { dagreEngine, type EngineInput } from "../src/core/layout";

/** Dagre off the main thread: the map view would post its input here and draw on reply. */
self.onmessage = (event: MessageEvent<{ input: EngineInput; ids: string[] }>) => {
  const t = performance.now();
  const output = dagreEngine(event.data.input, event.data.ids);
  (self as unknown as Worker).postMessage({ output, computeMs: performance.now() - t });
};
