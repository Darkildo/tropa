import { guessFormat, parseFormat } from "./format";
import { parseLinkTarget, toList } from "./links";
import type { SourceFormat } from "./types";

/** Materials listed inside a concept have no note of their own; their id is this prefix and a key. */
export const MATERIAL_PREFIX = "material:";

export const isMaterialId = (id: string) => id.startsWith(MATERIAL_PREFIX);
export const materialId = (key: string) => MATERIAL_PREFIX + key;
export const materialKey = (id: string) => id.slice(MATERIAL_PREFIX.length);

/** One entry of a concept's `materials` property, before links are resolved. */
export interface MaterialEntry {
  url?: string;
  /** Link target of an attachment or a note: `file.pdf` from `[[file.pdf]]`. */
  link?: string;
  title?: string;
  format?: SourceFormat;
  minutes?: number;
}

const SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;
const MARKDOWN_LINK = /^\s*\[([^\]]*)\]\(\s*<?([^)\s>]+)>?\s*\)\s*$/;
const WIKILINK = /^\s*\[\[[^\]]+\]\]\s*$/;

/**
 * Reads `materials`: a list of `https://…`, `[[file.pdf]]`, `[Title](https://…)` or
 * objects `{url | file, title?, format?, minutes?}`. Anything else is ignored.
 */
export function parseMaterials(value: unknown): MaterialEntry[] {
  return toList(value)
    .map(parseEntry)
    .filter((entry): entry is MaterialEntry => entry !== null);
}

function parseEntry(value: unknown): MaterialEntry | null {
  if (typeof value === "string") return parseString(value);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const base =
    typeof record.url === "string" ? parseString(record.url) : typeof record.file === "string" ? parseFile(record.file) : null;
  if (!base) return null;
  const minutes = Number(record.minutes);
  const title = typeof record.title === "string" ? record.title.trim() : "";
  return {
    ...base,
    title: title || base.title,
    format: typeof record.format === "string" ? parseFormatStrict(record.format) : undefined,
    minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : undefined,
  };
}

function parseString(text: string): MaterialEntry | null {
  const trimmed = text.trim();
  const markdown = MARKDOWN_LINK.exec(trimmed);
  if (markdown && SCHEME.test(markdown[2])) return { url: markdown[2], title: markdown[1].trim() || undefined };
  if (SCHEME.test(trimmed)) return { url: trimmed };
  if (WIKILINK.test(trimmed)) return parseFile(trimmed);
  return null;
}

function parseFile(text: string): MaterialEntry | null {
  const link = parseLinkTarget(text);
  return link ? { link } : null;
}

function parseFormatStrict(value: string): SourceFormat | undefined {
  const format = parseFormat(value);
  return format === "other" && value !== "other" ? undefined : format;
}

/** The same page written two ways gets one key: scheme and host in lower case, no trailing slash. */
export function normalizeUrl(url: string) {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}${parsed.hash}`;
  } catch {
    return trimmed;
  }
}

/** A readable name for a bare link: `example.com/guide/intro`. */
export function urlTitle(url: string) {
  try {
    const parsed = new URL(url.trim());
    const path = decodeURIComponent(parsed.pathname).replace(/\/+$/, "");
    const title = parsed.host.replace(/^www\./, "") + path;
    return title.length > 60 ? `${title.slice(0, 59)}…` : title;
  } catch {
    return url.trim();
  }
}

const FILE_FORMATS: Record<string, SourceFormat> = {
  pdf: "paper",
  epub: "book",
  djvu: "book",
  mobi: "book",
  mp4: "video",
  webm: "video",
  mov: "video",
  mkv: "video",
  md: "note",
};

/** Attachments that make sense as a material: documents, books, video and audio. */
export const ATTACHMENT_EXTENSIONS = new Set(["pdf", "epub", "djvu", "mobi", "mp4", "webm", "mov", "mkv", "mp3", "m4a", "ogg", "wav"]);

export function fileFormat(path: string): SourceFormat {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return FILE_FORMATS[extension] ?? "other";
}

export function entryFormat(entry: MaterialEntry, resolvedPath?: string): SourceFormat {
  if (entry.format) return entry.format;
  if (entry.url) return guessFormat(entry.url);
  return fileFormat(resolvedPath ?? entry.link ?? "");
}
