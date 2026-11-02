import type { Layout } from "../src/core/layout";
import { ENGINES } from "./core";
import { benchCases } from "./gen";

/** Draws a layout the way the map does in the light theme: nodes, then edges by kind. */
function svg(layout: Layout, titles: Map<string, { title: string; source: boolean }>) {
  const pad = 24;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width + pad * 2}" height="${layout.height + pad * 2}" viewBox="${-pad} ${-pad} ${layout.width + pad * 2} ${layout.height + pad * 2}">`,
    `<rect x="${-pad}" y="${-pad}" width="100%" height="100%" fill="#ffffff"/>`,
  ];
  for (const edge of layout.edges) {
    const dash = edge.kind === "recommends" ? ' stroke-dasharray="2 6"' : edge.kind === "teaches" ? ' stroke-dasharray="5 5"' : "";
    parts.push(`<path d="${edge.path}" fill="none" stroke="#9a9aa6" stroke-width="1.5" stroke-linecap="round"${dash}/>`);
  }
  for (const node of layout.nodes.values()) {
    const meta = titles.get(node.id)!;
    parts.push(
      `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="10" fill="${meta.source ? "#f6f6f8" : "#ffffff"}" stroke="#c9c9d2" stroke-width="1.5"/>`,
      `<text x="${node.x + 14}" y="${node.y + node.height / 2 + 5}" font-family="Inter, system-ui, sans-serif" font-size="${meta.source ? 12.5 : 14}" fill="#2e2e33">${meta.title}</text>`,
    );
  }
  parts.push("</svg>");
  return parts.join("");
}

declare global {
  interface Window {
    renders?: { name: string; svg: string; anchor: { x: number; y: number } }[];
  }
}

const renders = [];
for (const name of ["200", "200+m"]) {
  const bench = benchCases([200]).find((c) => c.name === name)!;
  const titles = new Map([...bench.graph.nodes.values()].map((node) => [node.id, { title: node.title, source: node.kind === "source" }]));
  for (const engine of ENGINES) {
    const layout = engine.layout(bench.graph, { showSources: bench.showSources });
    const anchor = layout.nodes.get("c/100")!;
    renders.push({ name: `${name}-${engine.id}`, svg: svg(layout, titles), anchor: { x: anchor.x + 24, y: anchor.y + 24 } });
  }
}
window.renders = renders;
