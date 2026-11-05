import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareLayout } from "../src/core/layout";
import { ENGINES } from "../src/core/layout-engine";
import { wasmEngine } from "../src/core/layout-wasm";
import { benchCases } from "../bench/gen";

// Kept in git and checked against a build from source by `npm run build:wasm -- --verify`.
const file = "assets/wasm/tropa_layout.wasm";
const built = existsSync(file);
if (!built && process.env.CI) throw new Error(`${file} is missing`);

const largest = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs(a[i] - b[i]));
  return diff;
};

describe.skipIf(!built)("WebAssembly engine", () => {
  const wasm = built ? wasmEngine(new Uint8Array(readFileSync(file))) : ENGINES.ts;

  // The example map and every benchmark graph, materials on and off, 20 to 1700 nodes.
  for (const bench of benchCases()) {
    it(`draws ${bench.name} exactly like the TypeScript engine, to the last bit`, () => {
      const { input } = prepareLayout(bench.graph, { showSources: bench.showSources });
      const ts = ENGINES.ts.layout(input);
      const rust = wasm.layout(input);
      expect(rust.x).toHaveLength(ts.x.length);
      expect(Array.from(rust.pathStart)).toEqual(Array.from(ts.pathStart));
      expect(rust.pathPoints).toHaveLength(ts.pathPoints.length);
      expect(largest(rust.x, ts.x)).toBe(0);
      expect(largest(rust.y, ts.y)).toBe(0);
      expect(largest(rust.pathPoints, ts.pathPoints)).toBe(0);
    }, 60_000);
  }

  it("lays out an empty map", () => {
    const empty = { width: new Float64Array(0), height: new Float64Array(0), from: new Uint32Array(0), to: new Uint32Array(0), weight: new Uint32Array(0), softFrom: new Uint32Array(0), softTo: new Uint32Array(0), tight: false };
    expect(Array.from(wasm.layout(empty).pathStart)).toEqual([0]);
  });
});
