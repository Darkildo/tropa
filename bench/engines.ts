import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge } from "elkjs/lib/elk-api";
import { dagreEngine, dagreWith, type EngineInput, type EngineOutput, type Point } from "../src/core/layout";
import { sugiyama } from "./sugi";
// esbuild inlines these as base64, the way main.js would carry them.
import ownWasm from "../dist/wasm/own/tropa_layout_bg.wasm";
import crateWasm from "../dist/wasm/crate/tropa_layout_bg.wasm";
import * as own from "../dist/wasm/own/tropa_layout.js";
import * as crate from "../dist/wasm/crate/tropa_layout.js";

export interface Engine {
  id: string;
  label: string;
  run(input: EngineInput, ids: string[]): EngineOutput | Promise<EngineOutput>;
  /** Time spent inside WebAssembly during the last run, ms. */
  lastCompute?: number;
}

function decode(flat: Float64Array | number[], n: number, edges: number, routeFrom: number): EngineOutput {
  const x = Float64Array.from({ length: n }, (_, i) => flat[i]);
  const y = Float64Array.from({ length: n }, (_, i) => flat[n + i]);
  const inner: Point[][] = [];
  let k = 2 * n;
  for (let e = 0; e < edges; e++) {
    const count = flat[k++];
    const points: Point[] = [];
    for (let p = 0; p < count; p++, k += 2) points.push({ x: flat[k], y: flat[k + 1] });
    inner.push(points);
  }
  return { x, y, inner, routeFrom };
}

function bytes(base64: string) {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export interface WasmInit {
  base64Bytes: number;
  wasmBytes: number;
  decodeMs: number;
  compileMs: number;
  instantiateMs: number;
}

/** Decodes, compiles and instantiates both modules; returns what the plugin would pay on load. */
export function initWasm(): Record<"own" | "crate", WasmInit> {
  const result = {} as Record<"own" | "crate", WasmInit>;
  for (const [name, base64, glue] of [
    ["own", ownWasm, own],
    ["crate", crateWasm, crate],
  ] as const) {
    let t = performance.now();
    const raw = bytes(base64);
    const decodeMs = performance.now() - t;
    t = performance.now();
    const module = new WebAssembly.Module(raw);
    const compileMs = performance.now() - t;
    t = performance.now();
    glue.initSync({ module });
    const instantiateMs = performance.now() - t;
    result[name] = { base64Bytes: base64.length, wasmBytes: raw.length, decodeMs, compileMs, instantiateMs };
  }
  return result;
}

const elk = new ELK();

async function elkEngine(input: EngineInput, ids: string[]): Promise<EngineOutput> {
  const graph = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "64",
      "elk.spacing.edgeNode": "18",
      "elk.spacing.edgeEdge": "18",
      "elk.edgeRouting": "POLYLINE",
      "elk.padding": "[top=0,left=0,bottom=0,right=0]",
    },
    children: ids.map((id, i) => ({ id: String(i), width: input.width[i], height: input.height[i] })),
    edges: Array.from(input.from, (from, e) => ({ id: `e${e}`, sources: [String(from)], targets: [String(input.to[e])] })),
  });
  const n = ids.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  let minX = Infinity;
  let minY = Infinity;
  for (const child of graph.children ?? []) {
    const i = Number(child.id);
    x[i] = (child.x ?? 0) + input.width[i] / 2;
    y[i] = (child.y ?? 0) + input.height[i] / 2;
    minX = Math.min(minX, child.x ?? 0);
    minY = Math.min(minY, child.y ?? 0);
  }
  if (!n) minX = minY = 0;
  for (let i = 0; i < n; i++) {
    x[i] -= minX;
    y[i] -= minY;
  }
  const inner: (Point[] | undefined)[] = new Array(input.from.length);
  for (const edge of (graph.edges ?? []) as ElkExtendedEdge[]) {
    const e = Number(edge.id.slice(1));
    inner[e] = (edge.sections?.[0]?.bendPoints ?? []).map((p) => ({ x: p.x - minX, y: p.y - minY }));
  }
  return { x, y, inner, routeFrom: 1 };
}

function wasmEngine(id: string, label: string, call: (input: EngineInput) => Float64Array, timed: boolean): Engine {
  const engine: Engine = {
    id,
    label,
    run(input) {
      const flat = call(input);
      const n = input.width.length;
      if (timed) engine.lastCompute = flat[flat.length - 1];
      return decode(flat, n, input.from.length, 1);
    },
  };
  return engine;
}

export const ENGINES: Engine[] = [
  { id: "dagre", label: "dagre (as shipped)", run: dagreEngine },
  { id: "dagre-lp", label: "dagre, longest-path ranker", run: (input, ids) => dagreWith(input, ids, "longest-path") },
  { id: "dagre-ns", label: "dagre, network simplex always", run: (input, ids) => dagreWith(input, ids, "network-simplex") },
  { id: "elk", label: "elkjs layered", run: elkEngine },
  { id: "sugi-ts", label: "own Sugiyama, TypeScript", run: (input) => sugiyama(input) },
  wasmEngine("sugi-wasm", "own Sugiyama, Rust → WASM", (i) => own.layout(i.width, i.height, i.from, i.to, i.weight, i.tight), true),
  wasmEngine("crate-wasm", "rust-sugiyama crate → WASM", (i) => crate.layout_crate_sugiyama(i.width, i.height, i.from, i.to), false),
];
