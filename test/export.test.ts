import { describe, expect, it } from "vitest";
import { buildCanvas, canvasText, CANVAS_COLOR, type ExportEdge, type ExportNode } from "../src/core/canvas";
import { exportPath, fileName, freePath } from "../src/core/export-path";
import { buildSvg, wrapText, type SvgScene } from "../src/core/svg";

/** Checks a document against JSON Canvas 1.0 (https://jsoncanvas.org/spec/1.0/). Returns the problems found. */
function validateCanvas(doc: unknown): string[] {
  const problems: string[] = [];
  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
  const isInt = (value: unknown) => Number.isInteger(value);
  const isColor = (value: unknown) => typeof value === "string" && (/^[1-6]$/.test(value) || /^#[0-9a-fA-F]{6}$/.test(value));
  const SIDES = ["top", "right", "bottom", "left"];
  const ENDS = ["none", "arrow"];
  if (!isRecord(doc)) return ["top level is not an object"];
  for (const key of Object.keys(doc)) if (key !== "nodes" && key !== "edges") problems.push(`unknown top-level key ${key}`);
  const nodes = doc.nodes ?? [];
  const edges = doc.edges ?? [];
  if (!Array.isArray(nodes)) problems.push("nodes is not an array");
  if (!Array.isArray(edges)) problems.push("edges is not an array");
  const ids = new Set<string>();
  const nodeIds = new Set<string>();
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!isRecord(node)) { problems.push("node is not an object"); continue; }
    const at = `node ${String(node.id)}`;
    if (typeof node.id !== "string" || !node.id) problems.push(`${at}: id`);
    else if (ids.has(node.id)) problems.push(`${at}: duplicate id`);
    else { ids.add(node.id); nodeIds.add(node.id); }
    for (const key of ["x", "y", "width", "height"]) if (!isInt(node[key])) problems.push(`${at}: ${key} is not an integer`);
    if (node.color !== undefined && !isColor(node.color)) problems.push(`${at}: color`);
    if (node.type === "file") { if (typeof node.file !== "string") problems.push(`${at}: file`); if (node.subpath !== undefined && !(typeof node.subpath === "string" && node.subpath.startsWith("#"))) problems.push(`${at}: subpath`); }
    else if (node.type === "link") { if (typeof node.url !== "string") problems.push(`${at}: url`); }
    else if (node.type === "text") { if (typeof node.text !== "string") problems.push(`${at}: text`); }
    else if (node.type === "group") { /* optional label, background */ }
    else problems.push(`${at}: type ${String(node.type)}`);
  }
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!isRecord(edge)) { problems.push("edge is not an object"); continue; }
    const at = `edge ${String(edge.id)}`;
    if (typeof edge.id !== "string" || !edge.id) problems.push(`${at}: id`);
    else if (ids.has(edge.id)) problems.push(`${at}: duplicate id`);
    else ids.add(edge.id);
    if (typeof edge.fromNode !== "string" || !nodeIds.has(edge.fromNode)) problems.push(`${at}: fromNode`);
    if (typeof edge.toNode !== "string" || !nodeIds.has(edge.toNode)) problems.push(`${at}: toNode`);
    for (const key of ["fromSide", "toSide"]) if (edge[key] !== undefined && !SIDES.includes(edge[key] as string)) problems.push(`${at}: ${key}`);
    for (const key of ["fromEnd", "toEnd"]) if (edge[key] !== undefined && !ENDS.includes(edge[key] as string)) problems.push(`${at}: ${key}`);
    if (edge.color !== undefined && !isColor(edge.color)) problems.push(`${at}: color`);
    if (edge.label !== undefined && typeof edge.label !== "string") problems.push(`${at}: label`);
  }
  return problems;
}

const nodes: ExportNode[] = [
  { id: "Concepts/Derivatives.md", x: 0.4, y: 0, width: 216, height: 62, file: "Concepts/Derivatives.md", color: CANVAS_COLOR.mastered },
  { id: "Concepts/Gradient.md", x: 10.6, y: 120.2, width: 216, height: 62, file: "Concepts/Gradient.md" },
  { id: "ghost:Momentum", x: 300, y: 120, width: 216, height: 62, text: "Momentum" },
  { id: "material:https://example.com/video", x: 300, y: 0, width: 196, height: 46, url: "https://example.com/video" },
  { id: "Materials/Notes.md", x: 600, y: 0, width: 196, height: 46, file: "Materials/Notes.md" },
];
const edges: ExportEdge[] = [
  { from: "Concepts/Derivatives.md", to: "Concepts/Gradient.md", kind: "requires" },
  { from: "material:https://example.com/video", to: "Concepts/Gradient.md", kind: "teaches" },
  { from: "Concepts/Gradient.md", to: "ghost:Momentum", kind: "recommends" },
  { from: "Concepts/Gradient.md", to: "Not on the map.md", kind: "requires" },
];

describe("JSON Canvas export", () => {
  const canvas = buildCanvas(nodes, edges, "recommended");
  const parsed: unknown = JSON.parse(canvasText(canvas));

  it("follows JSON Canvas 1.0", () => {
    expect(validateCanvas(parsed)).toEqual([]);
    expect(canvas.nodes).toHaveLength(5);
    expect(canvas.edges).toHaveLength(3);
  });

  it("the validator catches what breaks the format", () => {
    expect(validateCanvas({ nodes: [{ id: "a", type: "file", x: 0.5, y: 0, width: 1, height: 1 }], edges: [{ id: "a", fromNode: "a", toNode: "b", fromSide: "up" }] })).toEqual([
      "node a: x is not an integer",
      "node a: file",
      "edge a: duplicate id",
      "edge a: toNode",
      "edge a: fromSide",
    ]);
  });

  it("uses file nodes for notes, link nodes for links and text for concepts without a note", () => {
    const byType = (type: string) => canvas.nodes.filter((node) => node.type === type);
    expect(byType("file").map((node) => (node as { file: string }).file)).toEqual(["Concepts/Derivatives.md", "Concepts/Gradient.md", "Materials/Notes.md"]);
    expect(byType("link").map((node) => (node as { url: string }).url)).toEqual(["https://example.com/video"]);
    expect(byType("text").map((node) => (node as { text: string }).text)).toEqual(["Momentum"]);
    expect(canvas.nodes[0]).toMatchObject({ x: 0, y: 0, width: 216, height: 62, color: "4" });
    expect(canvas.nodes[1]).toMatchObject({ x: 11, y: 120 });
    expect(canvas.nodes[1]).not.toHaveProperty("color");
  });

  it("draws prerequisites top to bottom, materials in their color and soft links with a label", () => {
    const [requires, teaches, soft] = canvas.edges;
    expect(requires).toMatchObject({ fromSide: "bottom", toSide: "top" });
    expect(requires).not.toHaveProperty("color");
    expect(teaches).toMatchObject({ fromSide: "bottom", toSide: "top", color: CANVAS_COLOR.teaches });
    // Gradient and Momentum are in one row: joined side to side.
    expect(soft).toMatchObject({ fromSide: "right", toSide: "left", color: CANVAS_COLOR.recommends, label: "recommended" });
  });

  it("gives the same ids on every export, unique even for clashing seeds", () => {
    expect(buildCanvas(nodes, edges, "x").nodes.map((node) => node.id)).toEqual(canvas.nodes.map((node) => node.id));
    expect(canvas.nodes[0].id).toMatch(/^[0-9a-f]{16}$/);
    const twice = buildCanvas([nodes[0], nodes[0]], [], "x");
    expect(new Set(twice.nodes.map((node) => node.id)).size).toBe(2);
  });

  it("is written with tabs, like Obsidian", () => {
    expect(canvasText(canvas)).toMatch(/^\{\n\t"nodes": \[/);
  });
});

describe("SVG export", () => {
  const scene: SvgScene = {
    title: "Map <&> \"quotes\"",
    width: 300,
    height: 200,
    margin: 40,
    background: "#ffffff",
    edges: [{ d: "M0,0 C0,50 100,50 100,100", stroke: "#7c3aed", strokeWidth: 2, opacity: 0.5, dash: "5 4" }],
    boxes: [{ x: 0, y: 0, width: 216, height: 62, radius: 10, fill: "#fff", stroke: "#ccc", strokeWidth: 1.5, dash: "4.5 3" }],
    icons: [{ x: 10, y: 10, size: 16, color: "#16a34a", viewBox: "0 0 24 24", markup: '<path d="M20 6 9 17l-5-5"/>' }],
    texts: [
      { x: 50, y: 20, text: "Tom & Jerry <3", fill: "#111", fontSize: 14, fontWeight: "500", fontFamily: '"Inter", sans-serif', rtl: false },
      { x: 250, y: 40, text: "שלום", fill: "#111", fontSize: 14, fontWeight: "500", fontFamily: "sans-serif", rtl: true },
    ],
  };
  const svg = buildSvg(scene);

  it("is a standalone drawing sized to the map plus its margin", () => {
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="380" height="280" viewBox="0 0 380 280">/);
    expect(svg).toContain('<rect width="100%" height="100%" fill="#ffffff"/>');
    expect(svg).toContain('<g transform="translate(40 40)">');
    expect(svg.trim().endsWith("</svg>")).toBe(true);
  });

  it("escapes text and attributes", () => {
    expect(svg).toContain("<title>Map &lt;&amp;&gt; \"quotes\"</title>");
    expect(svg).toContain(">Tom &amp; Jerry &lt;3</text>");
    expect(svg).toContain('font-family="&quot;Inter&quot;, sans-serif"');
  });

  it("keeps dashes, opacity, borders, icons and right-to-left text", () => {
    expect(svg).toContain('stroke-dasharray="5 4"');
    expect(svg).toContain('opacity="0.5"');
    expect(svg).toContain('stroke="#ccc" stroke-width="1.5" stroke-dasharray="4.5 3"');
    expect(svg).toContain('<svg x="10" y="10" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a"');
    expect(svg).toMatch(/direction="rtl">שלום<\/text>/);
  });

  it("balances its tags", () => {
    const open = (svg.match(/<(svg|g|text|title)\b/g) ?? []).length;
    const close = (svg.match(/<\/(svg|g|text|title)>/g) ?? []).length;
    expect(open).toBe(close);
  });

  it("wraps a title like the map: two lines, the second cut with an ellipsis", () => {
    const measure = (text: string) => text.length * 10;
    expect(wrapText("Training networks in practice", 120, measure, 2)).toEqual(["Training", "networks in…"]);
    expect(wrapText("Short", 120, measure, 2)).toEqual(["Short"]);
    expect(wrapText("Gradient descent", 200, measure, 2)).toEqual(["Gradient descent"]);
    expect(wrapText("3 concepts first and more", 100, measure, 1)).toEqual(["3 concept…"]);
  });
});

describe("export paths", () => {
  it("keeps exports inside the vault with the right extension", () => {
    expect(exportPath(" Tropa/Map 2026-11-02 ", "canvas")).toBe("Tropa/Map 2026-11-02.canvas");
    expect(exportPath("/Tropa//Map.canvas", "canvas")).toBe("Tropa/Map.canvas");
    expect(exportPath("Maps\\Route", "svg")).toBe("Maps/Route.svg");
    expect(exportPath("../outside", "svg")).toBeNull();
    expect(exportPath("   ", "svg")).toBeNull();
    expect(exportPath(".svg", "svg")).toBeNull();
  });

  it("finds a free name next to a taken one", () => {
    const taken = new Set(["Tropa/Map.canvas", "Tropa/Map 2.canvas"]);
    expect(freePath("Tropa/Map.canvas", (path) => taken.has(path))).toBe("Tropa/Map 3.canvas");
    expect(freePath("Tropa/Map 2.canvas", (path) => taken.has(path))).toBe("Tropa/Map 3.canvas");
  });

  it("drops characters a file name cannot have", () => {
    expect(fileName('C#: what? "a/b" [x]')).toBe("C what a b x");
    expect(fileName("///")).toBe("Tropa");
  });
});
