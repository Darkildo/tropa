// The layout engine's Rust port (crates/tropa-layout) compiled to WebAssembly. It runs in the
// worker only: compiling a module of this size on the main thread is not allowed everywhere.
import type { EngineInput, EngineOutput, LayoutEngine } from "./layout-engine";

/** The exports of crates/tropa-layout/src/wasm.rs. */
interface LayoutExports {
  memory: WebAssembly.Memory;
  tropa_input(n: number, m: number, s: number): number;
  tropa_layout(tight: number): void;
  tropa_output(which: number): number;
  tropa_output_len(which: number): number;
}

/** Compiles the engine from its bytes. Throws when WebAssembly is missing or the module does not load. */
export function wasmEngine(bytes: Uint8Array<ArrayBuffer>): LayoutEngine {
  const wasm = new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports as unknown as LayoutExports;
  return {
    id: "wasm",
    layout(input: EngineInput): EngineOutput {
      const n = input.width.length;
      const m = input.from.length;
      const s = input.softFrom.length;
      const at = wasm.tropa_input(n, m, s);
      const memory = wasm.memory.buffer;
      new Float64Array(memory, at, n).set(input.width);
      new Float64Array(memory, at + 8 * n, n).set(input.height);
      const ints = at + 16 * n;
      new Uint32Array(memory, ints, m).set(input.from);
      new Uint32Array(memory, ints + 4 * m, m).set(input.to);
      new Uint32Array(memory, ints + 8 * m, m).set(input.weight);
      new Uint32Array(memory, ints + 12 * m, s).set(input.softFrom);
      new Uint32Array(memory, ints + 12 * m + 4 * s, s).set(input.softTo);
      wasm.tropa_layout(input.tight ? 1 : 0);
      // The layout may have grown the memory, so the views are made afresh, and copied out.
      const floats = (which: number) => new Float64Array(wasm.memory.buffer, wasm.tropa_output(which), wasm.tropa_output_len(which)).slice();
      return {
        x: floats(0),
        y: floats(1),
        pathStart: new Uint32Array(wasm.memory.buffer, wasm.tropa_output(2), wasm.tropa_output_len(2)).slice(),
        pathPoints: floats(3),
      };
    },
  };
}

export function fromBase64(text: string) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
