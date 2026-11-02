/**
 * A drawing of the map as a standalone SVG file. The view measures what it shows (places, colors,
 * fonts of the current theme) and hands it over as plain shapes, so this part knows nothing of the DOM.
 */
export interface SvgBox {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** `stroke-dasharray`, when the border is dashed. */
  dash?: string;
}

export interface SvgText {
  /** Start of the line: its left end, or its right end when `rtl`. */
  x: number;
  /** Middle of the line. */
  y: number;
  text: string;
  fill: string;
  fontSize: number;
  fontWeight: string;
  fontFamily: string;
  rtl: boolean;
}

export interface SvgIcon {
  x: number;
  y: number;
  size: number;
  color: string;
  viewBox: string;
  /** Markup of the icon's shapes, serialized from an icon the view already shows. */
  markup: string;
}

export interface SvgPath {
  d: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  dash?: string;
}

/** Shapes are in map coordinates; the drawing adds `margin` on every side. */
export interface SvgScene {
  title: string;
  width: number;
  height: number;
  margin: number;
  background: string;
  edges: SvgPath[];
  boxes: SvgBox[];
  icons: SvgIcon[];
  texts: SvgText[];
}

export function buildSvg(scene: SvgScene) {
  const out: string[] = [];
  const width = scene.width + scene.margin * 2;
  const height = scene.height + scene.margin * 2;
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}">`);
  out.push(`<title>${escape(scene.title)}</title>`);
  out.push(`<rect width="100%" height="100%" fill="${attr(scene.background)}"/>`);
  out.push(`<g transform="translate(${n(scene.margin)} ${n(scene.margin)})">`);
  out.push(`<g fill="none" stroke-linecap="round">`);
  for (const path of scene.edges) {
    out.push(`<path d="${attr(path.d)}" stroke="${attr(path.stroke)}" stroke-width="${n(path.strokeWidth)}"${path.opacity < 1 ? ` opacity="${n(path.opacity)}"` : ""}${path.dash ? ` stroke-dasharray="${attr(path.dash)}"` : ""}/>`);
  }
  out.push("</g>");
  for (const box of scene.boxes) {
    out.push(
      `<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" rx="${n(box.radius)}" fill="${attr(box.fill)}"` +
        (box.strokeWidth > 0 ? ` stroke="${attr(box.stroke)}" stroke-width="${n(box.strokeWidth)}"${box.dash ? ` stroke-dasharray="${attr(box.dash)}"` : ""}` : "") +
        "/>",
    );
  }
  for (const icon of scene.icons) {
    out.push(
      `<svg x="${n(icon.x)}" y="${n(icon.y)}" width="${n(icon.size)}" height="${n(icon.size)}" viewBox="${attr(icon.viewBox)}" fill="none" stroke="${attr(icon.color)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon.markup}</svg>`,
    );
  }
  for (const text of scene.texts) {
    out.push(
      `<text x="${n(text.x)}" y="${n(text.y)}" dominant-baseline="central" fill="${attr(text.fill)}" font-size="${n(text.fontSize)}" font-weight="${attr(text.fontWeight)}" font-family="${attr(text.fontFamily)}"${text.rtl ? ` direction="rtl"` : ""}>${escape(text.text)}</text>`,
    );
  }
  out.push("</g>");
  out.push("</svg>");
  return `${out.join("\n")}\n`;
}

/** Breaks a title into at most `maxLines` lines of `width`, as the map does; the last one ends in "…" if cut. */
export function wrapText(text: string, width: number, measure: (text: string) => number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (!line || measure(next) <= width) {
      line = next;
      continue;
    }
    if (lines.length === maxLines - 1) {
      // The last line takes the rest and is cut below.
      line = `${line} ${words.slice(i).join(" ")}`;
      break;
    }
    lines.push(line);
    line = words[i];
  }
  if (line) lines.push(line);
  const last = lines.length - 1;
  if (last >= 0 && measure(lines[last]) > width) lines[last] = ellipsis(lines[last], width, measure);
  return lines;
}

function ellipsis(text: string, width: number, measure: (text: string) => number) {
  let end = text.length;
  while (end > 1 && measure(`${text.slice(0, end).trimEnd()}…`) > width) end--;
  return `${text.slice(0, end).trimEnd()}…`;
}

const n = (value: number) => String(Math.round(value * 100) / 100);
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (text: string) => escape(text).replace(/"/g, "&quot;");
