import { t } from "../i18n";
import { formatDate } from "./format";
import { parseDate } from "./plan";

/** What a `tropa` block shows: the route, today's reviews, or the next step alone. */
export type BlockShow = "route" | "review" | "next";

export interface BlockOptions {
  show: BlockShow;
  /** The link text of the goal as written, without brackets; null for the active goal. */
  goal: string | null;
  /** How many rows at most; null for the default of the kind. */
  limit: number | null;
}

export type BlockError =
  | { kind: "unknown"; key: string }
  | { kind: "show"; value: string }
  | { kind: "limit"; value: string };

export const BLOCK_SHOWS: readonly BlockShow[] = ["route", "review", "next"];
export const BLOCK_LIMIT_MAX = 100;
/** Rows shown when the block does not say: enough for a daily note, short of the whole route. */
export const BLOCK_LIMIT_DEFAULT = 10;

/**
 * Reads the block's lines, `key: value` each. Blank lines and `#` comments are skipped; keys are
 * case-insensitive. The first mistake is returned, to be shown in the block instead of the list.
 */
export function parseBlockOptions(source: string): { options: BlockOptions } | { error: BlockError } {
  const options: BlockOptions = { show: "route", goal: null, limit: null };
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    const key = (colon < 0 ? line : line.slice(0, colon)).trim().toLowerCase();
    const value = colon < 0 ? "" : line.slice(colon + 1).trim();
    if (key === "show") {
      const show = value.toLowerCase() as BlockShow;
      if (!BLOCK_SHOWS.includes(show)) return { error: { kind: "show", value } };
      options.show = show;
    } else if (key === "goal") {
      options.goal = linkText(value);
    } else if (key === "limit") {
      const limit = Number(value);
      if (!/^\d+$/.test(value) || limit < 1 || limit > BLOCK_LIMIT_MAX) return { error: { kind: "limit", value } };
      options.limit = limit;
    } else {
      return { error: { kind: "unknown", key: colon < 0 ? line : line.slice(0, colon).trim() } };
    }
  }
  return { options };
}

/** `[[Note|alias]]`, `"[[Note]]"` or `Note` → `Note`; empty for nothing, which means the active goal. */
export function linkText(value: string): string | null {
  let text = value.trim().replace(/^["']|["']$/g, "").trim();
  const wiki = /^\[\[([^\]]*)\]\]$/.exec(text);
  if (wiki) text = wiki[1];
  text = text.split("|")[0].trim();
  return text || null;
}

/** The block's error, in words, with the option it is about. */
export function blockErrorText(error: BlockError) {
  if (error.kind === "unknown") return t.presence.errUnknown({ key: error.key });
  if (error.kind === "show") return t.presence.errShow;
  return t.presence.errLimit({ max: BLOCK_LIMIT_MAX });
}

export interface StatusInput {
  /** Concepts in today's review queue, within the daily limit. */
  due: number;
  /** The day review comes back, YYYY-MM-DD, while it is paused. */
  pausedUntil: string | null;
  /** The title of the route's next step. */
  next: string | null;
}

/** Where a click on the status bar goes. */
export type StatusAction = "queue" | "next";

/**
 * The status bar line: reviews first, as they cannot wait, then the next step. Nothing to show
 * gives null, and the item hides.
 */
export function statusLine({ due, pausedUntil, next }: StatusInput, today = new Date()): { text: string; action: StatusAction } | null {
  const parts: string[] = [];
  if (pausedUntil) parts.push(t.presence.statusPaused({ date: formatDate(parseDate(pausedUntil), today) }));
  else if (due > 0) parts.push(t.presence.statusDue({ count: due }));
  if (next) parts.push(t.presence.statusNext({ title: next }));
  if (!parts.length) return null;
  return { text: parts.join(" · "), action: due > 0 && !pausedUntil ? "queue" : next ? "next" : "queue" };
}
