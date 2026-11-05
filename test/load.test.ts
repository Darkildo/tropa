import { describe, expect, it } from "vitest";
import { JournalHistory, parseJournal, type JournalEntry, type ResolvedEntry } from "../src/core/journal";
import {
  afterPause,
  allowedShift,
  catchUpDays,
  chooseShift,
  dayNumber,
  dayQueue,
  isPaused,
  latestPause,
  loadByDay,
  reviewsOn,
  type Pause,
} from "../src/core/load";
import { formatDateKey } from "../src/core/plan";
import { Scheduler, type ReviewRating, type Schedule } from "../src/core/review";

const DAY = 24 * 60 * 60 * 1000;
// Local noon, so day numbers do not depend on the time zone the tests run in.
const T0 = new Date(2026, 10, 3, 12, 0, 0).getTime();
const scheduler = new Scheduler(0.9);

let line = 0;
function entry(action: string, time: number, fields: Record<string, string> = {}, flags: string[] = [], id: string | null = "a.md"): ResolvedEntry {
  return { time, action, target: id ? `[[${id}]]` : "-", fields, flags, file: "Tropa/Journal/2026-11 desktop-0000.md", line: line++, id };
}

const dateKey = (time: number) => formatDateKey(new Date(time));

describe("balancing a review", () => {
  it("moves at most 5% of the interval, three days at most", () => {
    expect(allowedShift(10)).toBe(0);
    expect(allowedShift(19)).toBe(0);
    expect(allowedShift(20)).toBe(1);
    expect(allowedShift(45)).toBe(2);
    expect(allowedShift(60)).toBe(3);
    expect(allowedShift(3000)).toBe(3);
  });

  it("picks the least busy day nearby, the smaller shift and then the earlier day on a tie", () => {
    const due = T0 + 40 * DAY;
    const base = dayNumber(due);
    const busy = new Map([
      [base, 5],
      [base - 1, 3],
      [base + 1, 3],
      [base - 2, 1],
      [base + 2, 1],
    ]);
    const load = (day: number) => busy.get(day) ?? 4;
    // Interval 40 days: two days either way. -2 and +2 tie at 1; the earlier wins.
    expect(chooseShift(due, 40, load)).toBe(-2);
    // A short interval never moves.
    expect(chooseShift(due, 10, load)).toBe(0);
    // Nothing quieter than the day itself: it stays.
    expect(chooseShift(due, 60, () => 0)).toBe(0);
  });

  it("counts concepts per local day", () => {
    const load = loadByDay([T0, T0 + 1000, T0 + DAY]);
    expect(load(dayNumber(T0))).toBe(2);
    expect(load(dayNumber(T0 + DAY))).toBe(1);
    expect(load(dayNumber(T0 + 2 * DAY))).toBe(0);
  });
});

describe("a shift in the journal", () => {
  const reviews = (shift?: string): JournalEntry[] => [
    entry("mastered", T0),
    entry("reviewed", T0 + 3 * DAY, { rating: "4" }),
    entry("reviewed", T0 + 20 * DAY, { rating: "4", ...(shift ? { shift } : {}) }),
  ];

  it("moves the due date by whole days when it fits the interval", () => {
    const plain = scheduler.schedule("a.md", reviews(), null)!;
    const shifted = scheduler.schedule("a.md", reviews("-1"), null)!;
    expect(plain.card.scheduled_days).toBeGreaterThanOrEqual(20);
    expect(shifted.due).toBe(plain.due - DAY);
    expect(shifted.card.stability).toBe(plain.card.stability);
    expect(shifted.card.difficulty).toBe(plain.card.difficulty);
  });

  it("is ignored when it no longer fits the interval", () => {
    const plain = scheduler.schedule("a.md", reviews(), null)!;
    expect(scheduler.schedule("a.md", reviews("3"), null)!.due).toBe(allowedShift(plain.card.scheduled_days) >= 3 ? plain.due + 3 * DAY : plain.due);
    // A short first interval allows no shift at all.
    const early = [entry("mastered", T0), entry("reviewed", T0 + 3 * DAY, { rating: "3", shift: "1" })];
    const unshifted = [entry("mastered", T0), entry("reviewed", T0 + 3 * DAY, { rating: "3" })];
    expect(scheduler.schedule("a.md", early, null)!.due).toBe(scheduler.schedule("a.md", unshifted, null)!.due);
    // Nonsense is ignored.
    expect(scheduler.schedule("a.md", reviews("ten"), null)!.due).toBe(plain.due);
  });

  it("does not change what later reviews compute", () => {
    const later = (shift?: string) => [...reviews(shift), entry("reviewed", T0 + 80 * DAY, { rating: "3" })];
    const plain = scheduler.schedule("a.md", later(), null)!;
    const shifted = scheduler.schedule("a.md", later("1"), null)!;
    expect(shifted.card.stability).toBe(plain.card.stability);
    expect(shifted.due).toBe(plain.due);
  });

  it("what the review is rated with is what the replay gives", () => {
    const schedule = scheduler.schedule("a.md", reviews(), null)!;
    const at = T0 + 70 * DAY;
    for (const rating of [1, 2, 3, 4] as ReviewRating[]) {
      const { due } = scheduler.rated(schedule, at, rating);
      const replayed = scheduler.schedule("a.md", [...reviews(), entry("reviewed", at, { rating: String(rating) })], null)!;
      expect(replayed.due).toBe(due);
    }
  });
});

describe("pause", () => {
  const until = dateKey(T0 + 10 * DAY);

  it("lasts until local midnight of the day it names", () => {
    const pause = latestPause([entry("pause", T0, { until }, [], null)])!;
    expect(pause.until).toBe(until);
    expect(new Date(pause.end).getHours()).toBe(0);
    expect(isPaused(pause, T0 + DAY)).toBe(true);
    expect(isPaused(pause, pause.end - 1)).toBe(true);
    expect(isPaused(pause, pause.end)).toBe(false);
    expect(isPaused(pause, T0 - 1)).toBe(false);
  });

  it("a resume ends it early, a later pause replaces it, broken lines are skipped", () => {
    const resumed = latestPause([entry("pause", T0, { until }, [], null), entry("resume", T0 + 2 * DAY, {}, [], null)])!;
    expect(resumed.end).toBe(T0 + 2 * DAY);
    expect(isPaused(resumed, T0 + 3 * DAY)).toBe(false);
    const later = dateKey(T0 + 20 * DAY);
    expect(latestPause([entry("pause", T0, { until }, [], null), entry("pause", T0 + DAY, { until: later }, [], null)])!.until).toBe(later);
    expect(latestPause([entry("pause", T0, { until: "soon" }, [], null), entry("pause", T0, { until: dateKey(T0 - DAY) }, [], null)])).toBeNull();
    expect(latestPause([entry("resume", T0, {}, [], null)])).toBeNull();
  });

  it("lines from a newer version are read as lines with no note, and change no schedule", () => {
    const text = [
      `- ${new Date(T0).toISOString()} mastered [[a]]`,
      `- ${new Date(T0 + DAY).toISOString()} pause - until=${until}`,
      `- ${new Date(T0 + 2 * DAY).toISOString()} resume -`,
      `- ${new Date(T0 + 3 * DAY).toISOString()} reviewed [[a]] rating=3 shift=0`,
    ].join("\n");
    const parsed = parseJournal(text, "f.md");
    expect(parsed.map((item) => [item.action, item.target])).toEqual([
      ["mastered", "[[a]]"],
      ["pause", "-"],
      ["resume", "-"],
      ["reviewed", "[[a]]"],
    ]);
    const history = new JournalHistory(parsed.map((item) => ({ ...item, id: item.target === "-" ? null : "a.md" })));
    expect(history.of("a.md").map((item) => item.action)).toEqual(["mastered", "reviewed"]);
    expect(history.stats(T0 + 4 * DAY, 30, () => undefined).reviews).toBe(1);
  });

  it("spreads its debt over as many days as it lasted, two weeks at most", () => {
    expect(catchUpDays({ start: T0, end: T0 + 3 * DAY, until: "" })).toBe(3);
    expect(catchUpDays({ start: T0, end: T0 + 30 * DAY, until: "" })).toBe(14);
    expect(catchUpDays({ start: T0, end: T0 + 1000, until: "" })).toBe(1);
  });

  it("after 30 days off, 200 concepts due meanwhile come back over 14 days, evenly", () => {
    const pause: Pause = { start: T0, end: new Date(2026, 11, 3).getTime(), until: "2026-12-03" };
    const items = Array.from({ length: 200 }, (_, index) => ({ id: `Concept ${index}.md`, due: T0 + (index % 30) * DAY, last: T0 - DAY }));
    const moved = afterPause(items, pause);
    expect(moved.size).toBe(200);
    const perDay = new Map<string, number>();
    for (const time of moved.values()) perDay.set(dateKey(time), (perDay.get(dateKey(time)) ?? 0) + 1);
    expect(perDay.size).toBe(14);
    expect(Math.min(...moved.values())).toBe(pause.end);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(25);
    // Reviewing one concept never moves another.
    const rest = afterPause(items.slice(1), pause);
    for (const [id, time] of rest) expect(time).toBe(moved.get(id));
    // What comes due after the pause, or was reviewed since, keeps its date.
    expect(afterPause([{ id: "x", due: pause.end + DAY, last: T0 }, { id: "y", due: T0, last: pause.end + 1 }], pause).size).toBe(0);
  });
});

describe("today's queue", () => {
  const options = { limit: 20, done: 0, pause: null, recall: () => 0.8, needed: new Set<string>() };

  it("takes the easiest to forget first, then what a goal needs, and the limit less what is done today", () => {
    const items = [
      { id: "a", due: T0 - DAY, last: T0 - 10 * DAY, r: 0.85 },
      { id: "b", due: T0 - DAY, last: T0 - 10 * DAY, r: 0.7 },
      { id: "c", due: T0 - DAY, last: T0 - 10 * DAY, r: 0.85 },
      { id: "d", due: T0 + DAY, last: T0, r: 0.95 },
    ];
    const day = dayQueue(items, T0, { ...options, recall: (item) => item.r, needed: new Set(["c"]) });
    expect(day.queue.map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(day.waiting).toBe(0);
    const limited = dayQueue(items, T0, { ...options, limit: 3, done: 1, recall: (item) => item.r });
    expect(limited.queue.map((item) => item.id)).toEqual(["b", "a"]);
    expect(limited.waiting).toBe(1);
    expect(dayQueue(items, T0, { ...options, limit: 0, recall: (item) => item.r }).queue).toHaveLength(3);
  });

  it("is empty while paused", () => {
    const pause = { start: T0 - DAY, end: T0 + DAY, until: dateKey(T0 + DAY) };
    const day = dayQueue([{ id: "a", due: T0 - DAY, last: T0 - 9 * DAY }], T0, { ...options, pause });
    expect(day).toEqual({ queue: [], waiting: 0, paused: pause });
  });

  it("counts today's reviews of scheduled concepts, an undo taking one back", () => {
    const entries = [
      entry("reviewed", T0 - DAY, { rating: "3" }),
      entry("reviewed", T0 - 1000, { rating: "3" }),
      entry("checked", T0 - 500, { rating: "3" }, [], "b.md"),
      entry("reviewed", T0 - 400, {}, ["undo"]),
      entry("reviewed", T0 - 300, { rating: "4" }),
      entry("reviewed", T0 - 200, { rating: "4" }, [], "other.md"),
    ];
    expect(reviewsOn(entries, T0, (id) => id !== "other.md")).toBe(2);
  });
});

/** Replays a vault of concepts day by day: today's queue is rated Recalled, balanced as Tropa does. */
function simulate(count: number, days: number, limit: number, balance: boolean) {
  const marked = new Date(2026, 10, 3, 9, 0, 0).getTime();
  const ids = Array.from({ length: count }, (_, index) => `Concept ${index}.md`);
  const log = new Map(ids.map((id) => [id, [entry("mastered", marked, {}, [], id)] as ResolvedEntry[]]));
  const perDay: number[] = [];
  let left = 0;
  for (let index = 1; index <= days; index++) {
    const now = new Date(2026, 10, 3 + index, 10, 0, 0).getTime();
    const schedules = new Map<string, Schedule>(ids.map((id) => [id, scheduler.schedule(id, log.get(id)!, null)!]));
    const day = dayQueue(schedules.values(), now, { limit, done: 0, pause: null, recall: (s) => scheduler.retrievability(s, now), needed: new Set() });
    perDay.push(day.queue.length);
    left = day.waiting;
    day.queue.forEach((schedule, order) => {
      const at = now + order * 1000;
      const fields: Record<string, string> = { rating: "3" };
      if (balance) {
        const { due, days: interval } = scheduler.rated(schedule, at, 3);
        const load = loadByDay([...schedules.values()].filter((other) => other.id !== schedule.id).map((other) => other.due));
        const shift = chooseShift(due, interval, load);
        if (shift) fields.shift = String(shift);
      }
      log.get(schedule.id)!.push(entry("reviewed", at, fields, [], schedule.id));
      schedules.set(schedule.id, scheduler.schedule(schedule.id, log.get(schedule.id)!, null)!);
    });
  }
  return { perDay, left, log };
}

describe("200 concepts mastered on one day", () => {
  it("never ask for more than the limit a day, and the backlog is worked off", () => {
    const { perDay, left } = simulate(200, 60, 20, true);
    expect(Math.max(...perDay)).toBeLessThanOrEqual(20);
    // Marked on one day, they all come due within a few days: the limit holds them back.
    const first = perDay.findIndex((count) => count > 0);
    expect(perDay.slice(first, first + 5)).toEqual([20, 20, 20, 20, 20]);
    expect(left).toBeLessThan(20);
  });

  it("balancing evens out the busiest days without a limit", () => {
    const plain = simulate(200, 90, 0, false).perDay;
    const balanced = simulate(200, 90, 0, true).perDay;
    const peak = (counts: number[]) => Math.max(...counts.slice(30));
    expect(peak(balanced)).toBeLessThanOrEqual(peak(plain));
  });
});

describe("two devices with one journal", () => {
  it("replay the same schedules and the same queue, whichever file is read first", () => {
    const { log } = simulate(40, 45, 10, true);
    // Split each concept's lines between two device files, then merge in either order.
    const files = { a: [] as ResolvedEntry[], b: [] as ResolvedEntry[] };
    for (const entries of log.values()) entries.forEach((item, index) => (index % 2 ? files.b : files.a).push({ ...item, file: index % 2 ? "b.md" : "a.md" }));
    const one = new JournalHistory([...files.a, ...files.b]);
    const two = new JournalHistory([...files.b.reverse(), ...files.a.reverse()]);
    const now = new Date(2026, 11, 20, 10, 0, 0).getTime();
    const queue = (history: JournalHistory) => {
      const schedules = [...log.keys()].map((id) => scheduler.schedule(id, history.of(id), null)!);
      return dayQueue(schedules, now, { limit: 10, done: reviewsOn(history.entries, now, () => true), pause: null, recall: (s) => scheduler.retrievability(s, now), needed: new Set() });
    };
    expect(queue(one).queue.map((s) => [s.id, s.due])).toEqual(queue(two).queue.map((s) => [s.id, s.due]));
    for (const id of log.keys()) expect(scheduler.schedule(id, one.of(id), null)).toEqual(scheduler.schedule(id, two.of(id), null));
  });
});
