// The contract between the map and a layout engine. Everything crosses it as flat typed arrays, so
// an engine can live in a worker or in WebAssembly and be swapped without touching the callers.
import { sugiyama } from "./sugiyama";

/** Node `i` and edge `e` are positions in these arrays; the caller keeps the names. */
export interface EngineInput {
  /** Node sizes, px. */
  width: Float64Array;
  height: Float64Array;
  /** Edges that rank: `from[e]` goes above `to[e]`. Deduplicated, no loops onto one node. */
  from: Uint32Array;
  to: Uint32Array;
  /** How hard an edge pulls its ends together: 2 for "requires", 1 for "teaches". */
  weight: Uint32Array;
  /** Soft links: drawn and ordered, never ranked. Deduplicated, no loops onto one node. */
  softFrom: Uint32Array;
  softTo: Uint32Array;
  /** Large graphs trade ranking quality for speed. */
  tight: boolean;
}

/**
 * Coordinates start at 0,0 at the top-left corner of the drawing.
 *
 * Paths: one per ranked edge (`e`), then one per soft link (`from.length + s`). Path `p` holds the
 * points `pathStart[p]` up to `pathStart[p + 1]`, as x,y pairs in `pathPoints`: a start point, then
 * three points per cubic Bézier segment (two control points and the end). Every path is drawn from
 * its higher end down, whatever its direction, so an edge the engine turned around to break a
 * loop is drawn the same way as the rest.
 */
export interface EngineOutput {
  /** Node centres. */
  x: Float64Array;
  y: Float64Array;
  pathStart: Uint32Array;
  pathPoints: Float64Array;
}

export interface LayoutEngine {
  id: string;
  layout(input: EngineInput): EngineOutput;
}

/** Engines by id; the worker runs the one a request names. */
export const ENGINES: Record<string, LayoutEngine> = {
  ts: { id: "ts", layout: sugiyama },
};

export const DEFAULT_ENGINE = "ts";
