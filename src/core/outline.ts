import { normalizeTitle } from "./audit";
import type { LearningGraph } from "./graph";
import { linked, type LinkCandidate } from "./batch-links";

/** One line of an outline: a concept, with the item it is nested under (-1 at the top). */
export interface OutlineItem {
  title: string;
  /** The target of a `[[link]]` on the line, as written, when there is one. */
  link?: string;
  parent: number;
  line: number;
}

/** How nesting becomes links: a topic needs what is under it (parts), or what is under it needs the topic. */
export type OutlineOrder = "parts" | "topic";

export interface OutlineOptions {
  order: OutlineOrder;
  /** Neighbours at one level are a sequence: each needs the one before it. */
  chain: boolean;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^([-*+])\s+(.*)$/;
/** `1.`, `1)`, `1.2`, `1.2.3.` and `12 Title` (a number and a space, as in a printed table of contents). */
const NUMBER = /^(\d+(?:\.\d+)*)(?:[.)]\s+|\s+)(.*)$/;
/** A page number at the end, after dot leaders, a tab or a wide gap: `Title ....... 15`, `Title\t15`. */
const PAGE_AFTER_GAP = /(?:\s*[.·…_]{2,}\s*|\t+|\s{2,})(?:\d{1,4}|[ivxlcdm]{1,6})\s*$/i;
const PAGE_AFTER_SPACE = /\s+\d{1,4}\s*$/;
const TASK = /^\[[ xX/-]\]\s+/;
/** Ranks per part of a `1.2.3` number, wider than any indent. */
const TOC_STEP = 1000;

/**
 * Reads a pasted outline: a nested Markdown list, headings, or a book's table of contents. Each line
 * with text is an item. Headings nest by their level, list items and plain lines by their indent,
 * under the last heading. Numbers such as `1.2` nest by their parts when the outline has any such
 * number, which is how a table of contents is told from a numbered list.
 */
export function parseOutline(text: string): OutlineItem[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const toc = lines.some((line) => /^\s*\d+\.\d+/.test(line));
  const items: OutlineItem[] = [];
  // The rank of each open item: headings 1–6, then everything else by indent or numbering, below them.
  const stack: { rank: number; index: number }[] = [];
  let fence = false;

  lines.forEach((raw, line) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence;
      return;
    }
    if (fence || !raw.trim() || /^\s*([-*_])(\s*\1){2,}\s*$/.test(raw) || /^\s*>/.test(raw)) return;
    const indent = columns(/^\s*/.exec(raw)![0]);
    const body = raw.trim();
    let rank: number;
    let rest: string;

    const heading = HEADING.exec(body);
    const bullet = heading ? null : BULLET.exec(body);
    const number = heading || bullet ? null : NUMBER.exec(body);
    if (heading) {
      rank = heading[1].length;
      rest = heading[2].replace(/\s+#+\s*$/, "");
    } else if (number && toc) {
      // A table of contents nests by the parts of its numbers; a line without one, such as a preface, sits with the chapters.
      rank = 10 + number[1].split(".").filter(Boolean).length * TOC_STEP;
      rest = number[2];
    } else {
      rank = 10 + (toc ? TOC_STEP : 0) + indent;
      rest = bullet ? bullet[2] : number && /^\d+[.)]\s/.test(body) ? number[2] : body;
    }

    rest = rest.replace(TASK, "").replace(PAGE_AFTER_GAP, "");
    if (toc && !heading) rest = rest.replace(PAGE_AFTER_SPACE, "");
    const { title, link } = clean(rest);
    if (!title) return;

    while (stack.length && stack[stack.length - 1].rank >= rank) stack.pop();
    items.push({ title, ...(link ? { link } : {}), parent: stack.length ? stack[stack.length - 1].index : -1, line });
    stack.push({ rank, index: items.length - 1 });
  });
  return items;
}

/** The title a line shows: links by their text, without emphasis, code marks or a trailing colon. */
function clean(text: string): { title: string; link?: string } {
  let link: string | undefined;
  let title = text.replace(/!?\[\[([^\]|#^]*)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, target: string, alias?: string) => {
    link ??= target.trim();
    return alias ?? target;
  });
  title = title
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|==)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](\S(?:.*?\S)?)[*_](?=$|[^\w*])/g, "$1$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*:$/, "");
  return { title, link: link || undefined };
}

/** Width of leading whitespace, a tab counting as four columns. */
function columns(space: string) {
  let width = 0;
  for (const char of space) width += char === "\t" ? 4 - (width % 4) : 1;
  return width;
}

/** A note an outline item becomes: one already in the vault, or a new one at `path`. */
export interface OutlineNote {
  path: string;
  title: string;
  existing: boolean;
  /** The file name differs from the title: characters a file name cannot have were replaced. */
  renamed: boolean;
}

export interface OutlineHost {
  /** An existing note for an item: its link, or a concept or note of the same name (case and accents aside). */
  find: (title: string, link: string | undefined) => string | null;
  /** The path of a new note for a title, not taken by any file or by `taken`. */
  newPath: (title: string, taken: ReadonlySet<string>) => string;
  /** The name the new note's file gets. */
  fileName: (title: string) => string;
  graph: LearningGraph;
}

export interface OutlinePlan {
  notes: OutlineNote[];
  candidates: LinkCandidate[];
}

/**
 * The notes and links an outline gives. An item matches a note already in the vault by its link or
 * by name; items with the same name are one note. Nesting gives `requires` one way or the other, by
 * `order`; neighbours give `requires` in order, ticked only when `chain` is on. Pairs the map already
 * links either way, and the same pair twice, are left out.
 */
export function planOutline(items: OutlineItem[], options: OutlineOptions, host: OutlineHost): OutlinePlan {
  const notes: OutlineNote[] = [];
  const byKey = new Map<string, OutlineNote>();
  const taken = new Set<string>();
  const ids = items.map((item) => {
    const key = normalizeTitle(item.title);
    const known = byKey.get(key);
    if (known) return known.path;
    const existing = host.find(item.title, item.link);
    const note: OutlineNote = existing
      ? { path: existing, title: item.title, existing: true, renamed: false }
      : (() => {
          const path = host.newPath(item.title, taken);
          taken.add(path);
          return { path, title: item.title, existing: false, renamed: host.fileName(item.title) !== item.title };
        })();
    const same = notes.find((other) => other.path === note.path);
    if (same) {
      byKey.set(key, same);
      return same.path;
    }
    notes.push(note);
    byKey.set(key, note);
    return note.path;
  });

  const candidates: LinkCandidate[] = [];
  const pairs = new Set<string>();
  const offer = (from: string, to: string, origin: "nest" | "order", checked: boolean) => {
    const key = from < to ? `${from}\0${to}` : `${to}\0${from}`;
    if (from === to || pairs.has(key) || linked(host.graph, from, to)) return;
    pairs.add(key);
    candidates.push({ from, to, kind: "requires", origin, checked });
  };
  items.forEach((item, index) => {
    if (item.parent < 0) return;
    const [child, parent] = [ids[index], ids[item.parent]];
    if (options.order === "parts") offer(parent, child, "nest", true);
    else offer(child, parent, "nest", true);
  });
  const lastChild = new Map<number, number>();
  items.forEach((item, index) => {
    const before = lastChild.get(item.parent);
    if (before !== undefined) offer(ids[index], ids[before], "order", options.chain);
    lastChild.set(item.parent, index);
  });
  return { notes, candidates };
}
