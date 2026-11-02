import type { EdgeKind } from "./layout";

/** JSON Canvas 1.0, the format of Obsidian's `.canvas` files: https://jsoncanvas.org/spec/1.0/ */
export type CanvasColor = "1" | "2" | "3" | "4" | "5" | "6" | `#${string}`;
export type CanvasSide = "top" | "right" | "bottom" | "left";

interface CanvasNodeBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColor;
}

export type CanvasNode =
  | (CanvasNodeBase & { type: "file"; file: string })
  | (CanvasNodeBase & { type: "link"; url: string })
  | (CanvasNodeBase & { type: "text"; text: string });

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide: CanvasSide;
  toNode: string;
  toSide: CanvasSide;
  color?: CanvasColor;
  label?: string;
}

export interface JsonCanvas {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/** Preset colors of the format: 4 green, 3 yellow, 6 purple, 5 cyan, 2 orange. */
export const CANVAS_COLOR = { mastered: "4", learning: "3", goal: "6", teaches: "5", recommends: "2" } as const;

/** One node of the current map, already placed by the layout. Exactly one of `file`, `url` and `text` is set. */
export interface ExportNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** A note or an attachment in the vault. */
  file?: string;
  /** A material that is only a link. */
  url?: string;
  /** A concept that has no note yet. */
  text?: string;
  color?: CanvasColor;
}

export interface ExportEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

/**
 * The map as a canvas. Ids are derived from note paths, so exporting again gives the same ids.
 * The format has no dashed lines: soft links get a color and a label instead.
 */
export function buildCanvas(nodes: ExportNode[], edges: ExportEdge[], softLabel: string): JsonCanvas {
  const ids = new Map<string, string>();
  const placed = new Map<string, ExportNode>();
  const used = new Set<string>();
  const unique = (seed: string) => {
    let id = hashId(seed);
    for (let n = 2; used.has(id); n++) id = hashId(`${seed}#${n}`);
    used.add(id);
    return id;
  };

  const out: JsonCanvas = { nodes: [], edges: [] };
  for (const node of nodes) {
    const id = unique(`node:${node.id}`);
    ids.set(node.id, id);
    placed.set(node.id, node);
    const base: CanvasNodeBase = {
      id,
      x: Math.round(node.x),
      y: Math.round(node.y),
      width: Math.max(1, Math.round(node.width)),
      height: Math.max(1, Math.round(node.height)),
    };
    if (node.color) base.color = node.color;
    if (node.file !== undefined) out.nodes.push({ ...base, type: "file", file: node.file });
    else if (node.url !== undefined) out.nodes.push({ ...base, type: "link", url: node.url });
    else out.nodes.push({ ...base, type: "text", text: node.text ?? "" });
  }

  for (const edge of edges) {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to) continue;
    const [fromSide, toSide] = sides(from, to);
    const link: CanvasEdge = { id: unique(`edge:${edge.kind}:${edge.from}:${edge.to}`), fromNode: ids.get(edge.from)!, fromSide, toNode: ids.get(edge.to)!, toSide };
    if (edge.kind === "teaches") link.color = CANVAS_COLOR.teaches;
    if (edge.kind === "recommends") {
      link.color = CANVAS_COLOR.recommends;
      link.label = softLabel;
    }
    out.edges.push(link);
  }
  return out;
}

/** Obsidian writes canvases with tabs. */
export function canvasText(canvas: JsonCanvas) {
  return `${JSON.stringify(canvas, null, "\t")}\n`;
}

/** The map flows top to bottom; nodes in one row are joined side to side. */
function sides(from: ExportNode, to: ExportNode): [CanvasSide, CanvasSide] {
  const fromMiddle = from.y + from.height / 2;
  const toMiddle = to.y + to.height / 2;
  if (Math.abs(fromMiddle - toMiddle) < Math.min(from.height, to.height) / 2) {
    return from.x <= to.x ? ["right", "left"] : ["left", "right"];
  }
  return fromMiddle < toMiddle ? ["bottom", "top"] : ["top", "bottom"];
}

/** 16 hex digits from two 32-bit FNV-1a hashes, the id length Obsidian uses. */
function hashId(text: string) {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x5bd1e995) ^ (b >>> 15);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}
