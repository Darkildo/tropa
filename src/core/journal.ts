import { allGoalsOf } from "./graph";
import type { Progress } from "./types";

/*
  The learning journal: one line per action, appended to a file of its own for every month and
  device, so two devices never write the same file and sync has nothing to merge.

    - 2026-11-03T14:05:12+03:00 mastered [[Gradient]]
    - 2026-11-03T14:05:20+03:00 unmastered [[Gradient]] undo
    - 2026-11-03T14:06:00+03:00 confidence [[Gradient]] level=4
    - 2026-11-03T14:07:00+03:00 done https://en.wikipedia.org/wiki/Gradient
    - 2026-11-03T14:08:00+03:00 reviewed [[Gradient]] rating=3

  A line is `- <time> <action> <target> [key=value | flag]...`. The target is a wiki link, so a
  rename that updates links keeps the history, or a URL for a material listed in a concept, or `-`
  for nothing. Action names are English whatever the interface language: the file is read back.
  Anything that does not parse (headings, notes in between, a broken line) is skipped.
*/

/** Actions written today. Readers keep unknown ones, so a newer version's lines survive in an older one. */
export type JournalAction =
  /** The goal the route leads to now, `-` for none. */
  | "goal"
  /** One more goal kept besides the one the route leads to. */
  | "goal-added"
  | "goal-removed"
  /** A goal's deadline: `date=2026-12-31`, or `date=none` when cleared. */
  | "deadline"
  /** Hours of study a week, for no note: `hours=5`, or `hours=none`. */
  | "pace"
  | "started"
  | "stopped"
  | "mastered"
  | "unmastered"
  | "known"
  | "skipped"
  | "unskipped"
  | "done"
  | "undone"
  | "confidence"
  /** Recalled a concept and rated it, 1 to 4 as in FSRS: `rating=3`. */
  | "reviewed"
  /** Answered the self-check questions of a concept: `rating=` as above, optionally `right=` and `of=`. */
  | "checked";

/** The flag on lines written by Undo: they put back what the action changed. */
export const UNDO = "undo";

/** What a change of progress or a review adds to the journal, before it gets a time and a file. */
export interface JournalEvent {
  action: JournalAction;
  /** A concept or material id, or null for none (a cleared goal). */
  id: string | null;
  fields?: Record<string, string>;
  flags?: string[];
}

export interface JournalEntry {
  /** Milliseconds since the epoch. */
  time: number;
  action: string;
  /** As written: `[[link]]`, a URL, or `-`. */
  target: string;
  fields: Record<string, string>;
  flags: string[];
  /** Journal file and line number (0-based), to order entries of the same second. */
  file: string;
  line: number;
}

/** An entry whose target is resolved to the id the graph uses now, or null when it names nothing. */
export interface ResolvedEntry extends JournalEntry {
  id: string | null;
}

/** Why progress changed, when a plain diff cannot tell. */
export type ChangeCause = "known" | "undo";

const LINE = /^\s*[-*]\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))\s+([a-z][a-z-]*)(?:\s+(.*))?$/;
const ACTION = /^[a-z][a-z-]*$/;

/** Local time with its offset, to the second: readable, and still one moment wherever it is read. */
export function stamp(date: Date) {
  const pad = (value: number, size = 2) => String(Math.abs(value)).padStart(size, "0");
  const offset = -date.getTimezoneOffset();
  const zone = `${offset >= 0 ? "+" : "-"}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${zone}`
  );
}

/** `YYYY-MM` of the local month, the first part of the file name. */
export function monthOf(date: Date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Spaces and `=` would break a value apart, so they are dropped; values are short words and numbers. */
const cleanValue = (value: string) => value.replace(/[\s=]+/g, "") || "-";

/** One line, without the line break. `target` is already a wiki link, a URL or `-`. */
export function formatEntry(date: Date, action: string, target: string, fields: Record<string, string> = {}, flags: string[] = []) {
  if (!ACTION.test(action)) throw new Error(`Invalid journal action: ${action}`);
  const parts = [`- ${stamp(date)}`, action, target.trim() || "-"];
  for (const [key, value] of Object.entries(fields)) parts.push(`${key.replace(/[\s=]+/g, "")}=${cleanValue(value)}`);
  for (const flag of flags) parts.push(flag.replace(/[\s=]+/g, ""));
  return parts.join(" ");
}

/** Every line that reads as an entry. Others, written by hand or broken by a sync, are skipped. */
export function parseJournal(text: string, file: string): JournalEntry[] {
  const entries: JournalEntry[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const entry = parseLine(lines[index], file, index);
    if (entry) entries.push(entry);
  }
  return entries;
}

export function parseLine(text: string, file = "", line = 0): JournalEntry | null {
  const match = LINE.exec(text);
  if (!match) return null;
  const time = Date.parse(match[1]);
  if (!Number.isFinite(time)) return null;
  let rest = (match[3] ?? "").trim();
  let target = "-";
  if (rest.startsWith("[[")) {
    const end = rest.indexOf("]]");
    if (end < 0) return null;
    target = rest.slice(0, end + 2);
    rest = rest.slice(end + 2);
  } else if (rest) {
    const [first] = rest.split(/\s+/, 1);
    target = first;
    rest = rest.slice(first.length);
  }
  const fields: Record<string, string> = {};
  const flags: string[] = [];
  for (const word of rest.trim().split(/\s+/)) {
    if (!word) continue;
    const eq = word.indexOf("=");
    if (eq > 0) fields[word.slice(0, eq)] = word.slice(eq + 1);
    else flags.push(word);
  }
  return { time, action: match[2], target, fields, flags, file, line };
}

/** By time; entries of the same second keep the order of their file, and files sort by name. */
export function compareEntries(a: JournalEntry, b: JournalEntry) {
  return a.time - b.time || (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line);
}

/**
 * What changed between two states of progress, as journal events. A diff, not a list of calls, so
 * every way of changing progress is covered the same: buttons, commands, Undo, the example map.
 * Moving a concept to mastered or skipped also takes it out of learning; that is one event.
 */
export function progressEvents(before: Progress, after: Progress, cause?: ChangeCause): JournalEvent[] {
  const events: JournalEvent[] = [];
  const flags = cause === "undo" ? [UNDO] : undefined;
  const push = (action: JournalAction, id: string | null, fields?: Record<string, string>) =>
    events.push({ action, id, ...(fields ? { fields } : {}), ...(flags ? { flags: [...flags] } : {}) });

  // `goal` names the goal the route now leads to; a goal added with it needs no line of its own.
  if (before.goal !== after.goal) push("goal", after.goal);
  const [goalsBefore, goalsAfter] = [allGoalsOf(before), allGoalsOf(after)];
  for (const id of goalsAfter) if (!goalsBefore.includes(id) && id !== after.goal) push("goal-added", id);
  for (const id of goalsBefore) if (!goalsAfter.includes(id)) push("goal-removed", id);
  // A deadline that goes with its goal needs no line either. Routing to all goals is a view, not written.
  for (const [id, date] of after.deadlines) if (before.deadlines.get(id) !== date) push("deadline", id, { date });
  for (const id of before.deadlines.keys()) {
    if (!after.deadlines.has(id) && goalsAfter.includes(id)) push("deadline", id, { date: "none" });
  }
  if (before.paceHours !== after.paceHours) push("pace", null, { hours: after.paceHours === null ? "none" : String(after.paceHours) });

  const ids = new Set([...before.mastered, ...after.mastered, ...before.skipped, ...after.skipped, ...before.learning, ...after.learning]);
  for (const id of ids) {
    const gained = (key: "mastered" | "skipped" | "learning") => after[key].has(id) && !before[key].has(id);
    const lost = (key: "mastered" | "skipped" | "learning") => before[key].has(id) && !after[key].has(id);
    if (gained("mastered")) push(cause === "known" ? "known" : "mastered", id);
    else if (gained("skipped")) push("skipped", id);
    else {
      if (lost("mastered")) push("unmastered", id);
      if (lost("skipped")) push("unskipped", id);
      if (gained("learning")) push("started", id);
      if (lost("learning")) push("stopped", id);
    }
  }

  for (const id of after.done) if (!before.done.has(id)) push("done", id);
  for (const id of before.done) if (!after.done.has(id)) push("undone", id);

  // Confidence that goes away with the mark it belonged to needs no line of its own.
  const kept = (id: string) => after.mastered.has(id) || after.learning.has(id);
  for (const [id, level] of after.confidence) {
    if (before.confidence.get(id) !== level) push("confidence", id, { level: String(level) });
  }
  for (const id of before.confidence.keys()) {
    if (!after.confidence.has(id) && kept(id)) push("confidence", id, { level: "none" });
  }
  return events;
}

/** A review of a concept, for the scheduler: when, and how well it was recalled (1 to 4). */
export interface Review {
  time: number;
  rating: number;
  action: "reviewed" | "checked";
}

export interface JournalStats {
  /** Concepts mastered in the period and still mastered at its end. Marked known ones are not counted. */
  mastered: number;
  /** Minutes of materials finished in the period, as their durations say. */
  minutes: number;
  /** Reviews and self-checks in the period. */
  reviews: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** Reverses of each action: a later one of these cancels it. */
const UNDONE_BY: Record<string, string[]> = {
  mastered: ["unmastered", "skipped"],
  known: ["unmastered", "skipped"],
  done: ["undone"],
};

/**
 * Entries of all journals, merged and resolved, with lookups by id. Built once per change of the
 * files; everything else is a pass over the entries of one id.
 */
export class JournalHistory {
  readonly entries: readonly ResolvedEntry[];
  private readonly byId = new Map<string, ResolvedEntry[]>();

  constructor(entries: ResolvedEntry[]) {
    this.entries = [...entries].sort(compareEntries);
    for (const entry of this.entries) {
      if (!entry.id) continue;
      let list = this.byId.get(entry.id);
      if (!list) this.byId.set(entry.id, (list = []));
      list.push(entry);
    }
  }

  /** Everything about one concept or material, oldest first. */
  of(id: string): readonly ResolvedEntry[] {
    return this.byId.get(id) ?? [];
  }

  /**
   * Reviews and self-checks of a concept, oldest first. A review line flagged `undo` takes back
   * the last review before it. Lines without a valid rating are left out.
   */
  reviews(id: string): Review[] {
    const reviews: Review[] = [];
    for (const entry of this.of(id)) {
      if (entry.action !== "reviewed" && entry.action !== "checked") continue;
      if (entry.flags.includes(UNDO)) {
        reviews.pop();
        continue;
      }
      const rating = Number(entry.fields.rating);
      if (Number.isInteger(rating) && rating >= 1 && rating <= 4) reviews.push({ time: entry.time, rating, action: entry.action });
    }
    return reviews;
  }

  /** When the concept was last marked mastered or known, if that mark still stands. */
  masteredAt(id: string): number | null {
    let at: number | null = null;
    for (const entry of this.of(id)) {
      if (entry.action === "mastered" || entry.action === "known") at = entry.time;
      else if (entry.action === "unmastered" || entry.action === "skipped") at = null;
    }
    return at;
  }

  /** Activity in the last `days` days up to `now`. `minutesOf` gives a material's duration, if known. */
  stats(now: number, days: number, minutesOf: (id: string) => number | undefined): JournalStats {
    const since = now - days * DAY;
    const stats: JournalStats = { mastered: 0, minutes: 0, reviews: 0 };
    for (const [id, list] of this.byId) {
      let mastered = false;
      let minutes = 0;
      let reviews = 0;
      list.forEach((entry, index) => {
        if (entry.time > now) return;
        if (entry.action === "reviewed" || entry.action === "checked") {
          if (entry.time < since) return;
          reviews += entry.flags.includes(UNDO) ? -1 : 1;
          return;
        }
        if (entry.time < since || entry.flags.includes(UNDO)) return;
        const reverses = UNDONE_BY[entry.action];
        if (!reverses || list.slice(index + 1).some((later) => later.time <= now && reverses.includes(later.action))) return;
        if (entry.action === "mastered") mastered = true;
        if (entry.action === "done") minutes = minutesOf(id) ?? 0;
      });
      if (mastered) stats.mastered++;
      stats.minutes += minutes;
      stats.reviews += Math.max(0, reviews);
    }
    return stats;
  }
}
