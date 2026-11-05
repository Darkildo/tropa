import { UNDO, type JournalEntry } from "./journal";
import { formatDateKey, parseDate, startOfDay } from "./plan";

/*
  How many reviews a day asks for. Three things keep it bearable, and none of them changes what
  FSRS knows about a concept, only when it is shown:

  - A daily limit. The queue of the day takes the concepts that are easiest to forget first; the
    rest wait for the next days. Reviews already done today count against the limit, so the queue
    does not refill as it empties.
  - Balancing. When a concept is rated, its next date may move by up to 5% of the interval (three
    days at most) to the least busy day nearby. The shift is written into the review line
    (`shift=-1`), so every device replays the same date, and a shift that no longer fits the
    interval (after a change of target recall) is ignored.
  - A pause. `pause - until=YYYY-MM-DD` in the journal empties the queue until that day (or a
    `resume` line); what came due meanwhile is then spread over as many days as the pause lasted,
    two weeks at most, instead of all at once.
*/

const DAY = 24 * 60 * 60 * 1000;
/** A shift is at most this part of the interval, and never more than MAX_SHIFT days. */
const SHIFT_SHARE = 0.05;
export const MAX_SHIFT = 3;
/** The debt of a pause is spread over its length in days, up to this. */
export const MAX_CATCH_UP = 14;
export const LIMITS = [0, 10, 20, 30, 50, 100] as const;
export const DEFAULT_LIMIT = 20;

/** Days a review may move for an interval of `days`: 5% of it, rounded down, three at most. */
export function allowedShift(days: number) {
  return Math.min(MAX_SHIFT, Math.max(0, Math.floor(days * SHIFT_SHARE)));
}

/** A number for the local calendar day of `time`, the same all day whatever the hour. */
export function dayNumber(time: number) {
  const date = new Date(time);
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
}

/**
 * The shift in days for a review due at `due`, given how many concepts come due on each local
 * day. The least busy day within the allowed shift wins; on a tie the smaller shift, then the
 * earlier day, so the choice is the same on every device that sees the same load.
 */
export function chooseShift(due: number, intervalDays: number, load: (day: number) => number) {
  const allowed = allowedShift(intervalDays);
  if (allowed === 0) return 0;
  const base = dayNumber(due);
  let best = 0;
  let bestLoad = load(base);
  for (let distance = 1; distance <= allowed; distance++) {
    for (const shift of [-distance, distance]) {
      const busy = load(base + shift);
      if (busy < bestLoad) {
        best = shift;
        bestLoad = busy;
      }
    }
  }
  return best;
}

/** The shift a review line carries, or 0. */
export function parseShift(value: string | undefined) {
  const shift = Number(value);
  return Number.isInteger(shift) && Math.abs(shift) <= MAX_SHIFT ? shift : 0;
}

/** Concepts due on each local day, to balance against. */
export function loadByDay(dues: Iterable<number>) {
  const counts = new Map<number, number>();
  for (const due of dues) {
    const day = dayNumber(due);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return (day: number) => counts.get(day) ?? 0;
}

export interface Pause {
  /** When the pause was written, milliseconds since the epoch. */
  start: number;
  /** When review comes back: local midnight of `until`, or the time of a `resume` line before it. */
  end: number;
  /** `until` as written, YYYY-MM-DD. */
  until: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The latest pause in the journal (entries of all devices, oldest first), or null. A `resume`
 * ends it early; a later `pause` replaces it.
 */
export function latestPause(entries: readonly JournalEntry[]): Pause | null {
  let pause: Pause | null = null;
  for (const entry of entries) {
    if (entry.action === "pause") {
      const until = entry.fields.until;
      if (!until || !DATE.test(until)) continue;
      const end = parseDate(until).getTime();
      if (Number.isFinite(end) && end > entry.time) pause = { start: entry.time, end, until };
    } else if (entry.action === "resume" && pause !== null && entry.time < pause.end) {
      const current: Pause = pause;
      pause = { start: current.start, end: entry.time, until: current.until };
    }
  }
  return pause;
}

export function isPaused(pause: Pause | null, now: number) {
  return pause !== null && pause.start <= now && now < pause.end;
}

/** Days over which the debt of a pause is spread: its length, one day to two weeks. */
export function catchUpDays(pause: Pause) {
  return Math.min(MAX_CATCH_UP, Math.max(1, Math.ceil((pause.end - pause.start) / DAY)));
}

export interface Due {
  id: string;
  /** When FSRS wants the concept back. */
  due: number;
  /** The last review or the mark, milliseconds since the epoch. */
  last: number;
}

/**
 * When each concept is shown, after a pause: what came due before the pause ended and was not
 * reviewed since goes to one of the days after it, picked by its id, so the debt spreads evenly
 * and reviewing one concept never moves another. Others keep their date. Returns the dates that moved.
 */
export function afterPause(items: Iterable<Due>, pause: Pause | null): Map<string, number> {
  const moved = new Map<string, number>();
  if (!pause) return moved;
  const days = catchUpDays(pause);
  const first = startOfDay(new Date(pause.end));
  for (const item of items) {
    if (item.due >= pause.end || item.last >= pause.end) continue;
    const offset = hashId(item.id) % days;
    const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + offset).getTime();
    moved.set(item.id, Math.max(item.due, day));
  }
  return moved;
}

/** FNV-1a: a stable number for an id, to spread marks over days and seed the fuzz. */
export function hashId(id: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface DayOptions<T> {
  /** Reviews a day, 0 for no limit. */
  limit: number;
  /** Reviews already done today. */
  done: number;
  pause: Pause | null;
  /** The chance to recall a concept now, 0 to 1. */
  recall: (item: T) => number;
  /** Concepts a goal leads through: at the same chance to recall, they come first. */
  needed: ReadonlySet<string>;
}

/**
 * Today's queue: what is due once a pause has spread its debt, the easiest to forget first (by
 * whole percent), then what a goal needs, the longest overdue and the id. The limit, less what
 * was already reviewed today, cuts it; the rest wait. Empty while paused.
 */
export function dayQueue<T extends Due>(items: Iterable<T>, now: number, options: DayOptions<T>) {
  const paused = isPaused(options.pause, now) ? options.pause : null;
  if (paused) return { queue: [] as T[], held: [] as T[], waiting: 0, paused };
  const all = [...items];
  const moved = afterPause(all, options.pause);
  const due = all.filter((item) => (moved.get(item.id) ?? item.due) <= now);
  const recall = new Map(due.map((item) => [item.id, Math.round(options.recall(item) * 100)]));
  const needed = (item: T) => Number(options.needed.has(item.id));
  due.sort((a, b) => recall.get(a.id)! - recall.get(b.id)! || needed(b) - needed(a) || a.due - b.due || a.id.localeCompare(b.id));
  const queue = options.limit > 0 ? due.slice(0, Math.max(0, options.limit - options.done)) : due;
  // Due but over today's limit, in the same order: what waits for the next days.
  const held = due.slice(queue.length);
  return { queue, held, waiting: held.length, paused: null };
}

/**
 * Reviews done on the local day of `now`: review and self-check lines of the given concepts, an
 * `undo` line taking one back.
 */
export function reviewsOn(entries: readonly (JournalEntry & { id: string | null })[], now: number, counts: (id: string) => boolean) {
  const today = dayNumber(now);
  let done = 0;
  for (const entry of entries) {
    if (entry.action !== "reviewed" && entry.action !== "checked") continue;
    if (!entry.id || !counts(entry.id) || entry.time > now || dayNumber(entry.time) !== today) continue;
    done += entry.flags.includes(UNDO) ? -1 : 1;
  }
  return Math.max(0, done);
}

/** The pause length a date asks for, for the dialog: the date of the day after `days` from today. */
export function pauseDate(now: number, days: number) {
  const date = startOfDay(new Date(now));
  return formatDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}
