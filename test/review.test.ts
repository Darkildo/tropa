import { describe, expect, it } from "vitest";
import { default_w, fsrs, generatorParameters, createEmptyCard, Rating } from "ts-fsrs";
import type { JournalEntry } from "../src/core/journal";
import { baselineSpread, hashId, Scheduler, type Baseline } from "../src/core/review";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-11-03T09:00:00Z");

let line = 0;
function entry(action: string, time: number, fields: Record<string, string> = {}, flags: string[] = []): JournalEntry {
  return { time, action, target: "[[X]]", fields, flags, file: "Tropa/Journal/2026-11 desktop-0000.md", line: line++ };
}

const scheduler = new Scheduler(0.9);

describe("FSRS schedule from the journal", () => {
  it("starts when the concept is mastered, rated Good", () => {
    const schedule = scheduler.schedule("a.md", [entry("mastered", T0)], null)!;
    expect(schedule.anchor).toBe(T0);
    expect(schedule.reviews).toBe(0);
    // FSRS-6 default: the first stability of a Good answer is w[2] (2.3 days); the interval is a whole number of days near it.
    expect(schedule.card.stability).toBeCloseTo(default_w[2], 4);
    const days = (schedule.due - T0) / DAY;
    expect(Number.isInteger(days) && days >= 2 && days <= 3).toBe(true);
  });

  it("a known mark starts as Easy, so it comes back later", () => {
    const known = scheduler.schedule("a.md", [entry("known", T0)], null)!;
    expect(known.card.stability).toBeCloseTo(default_w[3], 4);
    expect(known.due).toBeGreaterThan(scheduler.schedule("a.md", [entry("mastered", T0)], null)!.due);
  });

  it("replays reviews as ts-fsrs does", () => {
    const entries = [entry("mastered", T0), entry("reviewed", T0 + 3 * DAY, { rating: "3" }), entry("reviewed", T0 + 15 * DAY, { rating: "1" })];
    const schedule = scheduler.schedule("a.md", entries, null)!;
    // The same steps straight through ts-fsrs. Fuzz moves the due date, never stability or difficulty.
    const f = fsrs(generatorParameters({ request_retention: 0.9, enable_short_term: false, maximum_interval: 3650 }));
    let card = f.next(createEmptyCard(new Date(T0)), new Date(T0), Rating.Good).card;
    card = f.next(card, new Date(T0 + 3 * DAY), Rating.Good).card;
    card = f.next(card, new Date(T0 + 15 * DAY), Rating.Again).card;
    expect(schedule.reviews).toBe(2);
    expect(schedule.last).toBe(T0 + 15 * DAY);
    expect(schedule.card.stability).toBeCloseTo(card.stability, 8);
    expect(schedule.card.difficulty).toBeCloseTo(card.difficulty, 8);
    expect(schedule.card.lapses).toBe(1);
  });

  it("is the same every time it is replayed", () => {
    const entries = [entry("mastered", T0), entry("reviewed", T0 + 3 * DAY, { rating: "4" }), entry("reviewed", T0 + 30 * DAY, { rating: "3" })];
    expect(scheduler.schedule("a.md", entries, null)).toEqual(scheduler.schedule("a.md", entries, null));
  });

  it("chance to recall is the target recall once the stability has passed", () => {
    const schedule = scheduler.schedule("a.md", [entry("mastered", T0)], null)!;
    expect(scheduler.retrievability(schedule, T0)).toBeCloseTo(1, 6);
    expect(scheduler.retrievability(schedule, T0 + schedule.card.stability * DAY)).toBeCloseTo(0.9, 3);
  });

  it("a higher target recall brings the concept back sooner", () => {
    const entries = [entry("mastered", T0), entry("reviewed", T0 + 3 * DAY, { rating: "3" })];
    const strict = new Scheduler(0.95).schedule("a.md", entries, null)!;
    const loose = new Scheduler(0.8).schedule("a.md", entries, null)!;
    expect(strict.due).toBeLessThan(loose.due);
  });

  it("previews when each rating would bring it back, in order", () => {
    const schedule = scheduler.schedule("a.md", [entry("mastered", T0)], null)!;
    const preview = scheduler.preview(schedule, schedule.due);
    expect(preview[1]).toBeLessThanOrEqual(preview[2]);
    expect(preview[2]).toBeLessThan(preview[3]);
    expect(preview[3]).toBeLessThan(preview[4]);
  });

  it("nothing to review before the concept is mastered, or after it is unmarked", () => {
    expect(scheduler.schedule("a.md", [entry("started", T0)], null)).toBeNull();
    expect(scheduler.schedule("a.md", [entry("mastered", T0), entry("unmastered", T0 + DAY)], null)).toBeNull();
    expect(scheduler.schedule("a.md", [entry("mastered", T0), entry("skipped", T0 + DAY)], null)).toBeNull();
  });

  it("mastered again starts afresh", () => {
    const entries = [entry("mastered", T0), entry("reviewed", T0 + 3 * DAY, { rating: "4" }), entry("unmastered", T0 + 4 * DAY), entry("mastered", T0 + 10 * DAY)];
    const schedule = scheduler.schedule("a.md", entries, null)!;
    expect(schedule.anchor).toBe(T0 + 10 * DAY);
    expect(schedule.reviews).toBe(0);
  });
});

describe("Other lines of the journal", () => {
  it("goals, deadlines and pace do not change the schedule", () => {
    const plain = [entry("mastered", T0), entry("reviewed", T0 + 3 * DAY, { rating: "3" })];
    const mixed = [
      entry("goal", T0 - DAY),
      entry("mastered", T0),
      entry("goal-added", T0 + DAY),
      entry("deadline", T0 + DAY, { date: "2026-12-31" }),
      entry("pace", T0 + DAY, { hours: "5" }),
      entry("confidence", T0 + 2 * DAY, { level: "4" }),
      entry("reviewed", T0 + 3 * DAY, { rating: "3" }),
      entry("goal-removed", T0 + 4 * DAY),
      entry("some-future-action", T0 + 5 * DAY, { x: "1" }),
    ];
    expect(scheduler.schedule("a.md", mixed, null)).toEqual(scheduler.schedule("a.md", plain, null));
  });
});

describe("Undo", () => {
  const base = [entry("mastered", T0), entry("reviewed", T0 + 3 * DAY, { rating: "3" })];

  it("an undone review is as if it never happened", () => {
    const undone = scheduler.schedule("a.md", [...base, entry("reviewed", T0 + 9 * DAY, { rating: "1" }), entry("reviewed", T0 + 9 * DAY, {}, ["undo"])], null)!;
    expect(undone).toEqual(scheduler.schedule("a.md", base, null));
  });

  it("undoing an unmark gives back the memory and its reviews", () => {
    const back = scheduler.schedule("a.md", [...base, entry("unmastered", T0 + 5 * DAY), entry("mastered", T0 + 5 * DAY, {}, ["undo"])], null)!;
    expect(back).toEqual(scheduler.schedule("a.md", base, null));
  });

  it("undoing a mark takes the memory away", () => {
    expect(scheduler.schedule("a.md", [entry("mastered", T0), entry("unmastered", T0, {}, ["undo"])], null)).toBeNull();
  });
});

describe("Self-check before the mastered mark", () => {
  it("sets how well the memory starts", () => {
    const weak = scheduler.schedule("a.md", [entry("checked", T0 - 60_000, { rating: "1" }), entry("mastered", T0)], null)!;
    expect(weak.card.stability).toBeCloseTo(default_w[0], 4);
  });

  it("an old one does not", () => {
    const old = scheduler.schedule("a.md", [entry("checked", T0 - 3 * DAY, { rating: "1" }), entry("mastered", T0)], null)!;
    expect(old.card.stability).toBeCloseTo(default_w[2], 4);
  });

  it("undoing it, after the mark, gives the mark its own rating back", () => {
    const entries = [
      entry("checked", T0 - 60_000, { rating: "1" }),
      entry("mastered", T0),
      entry("reviewed", T0 + 1000, {}, ["undo"]),
    ];
    const schedule = scheduler.schedule("a.md", entries, null)!;
    expect(schedule.card.stability).toBeCloseTo(default_w[2], 4);
    expect(schedule.reviews).toBe(0);
  });

  it("undoing it before the mark leaves the mark's own rating", () => {
    const entries = [entry("checked", T0 - 60_000, { rating: "4" }), entry("reviewed", T0 - 30_000, {}, ["undo"]), entry("mastered", T0)];
    expect(scheduler.schedule("a.md", entries, null)!.card.stability).toBeCloseTo(default_w[2], 4);
  });

  it("a self-check after the mark is a review", () => {
    const schedule = scheduler.schedule("a.md", [entry("mastered", T0), entry("checked", T0 + 3 * DAY, { rating: "3" })], null)!;
    expect(schedule.reviews).toBe(1);
  });
});

describe("Marks with no date: no flood of reviews", () => {
  const since = Date.parse("2026-11-03T00:00:00Z");

  it("spreads old marks a few a day, over one week to two months", () => {
    expect(baselineSpread(0)).toBe(7);
    expect(baselineSpread(30)).toBe(10);
    expect(baselineSpread(1000)).toBe(60);
  });

  it("an old map of 150 mastered concepts comes due a few a day, none at once", () => {
    const baseline: Baseline = { since, spread: baselineSpread(150) };
    const days = new Map<number, number>();
    for (let index = 0; index < 150; index++) {
      const schedule = scheduler.schedule(`Concepts/Concept ${index}.md`, [], baseline)!;
      const day = Math.round((schedule.due - since) / DAY);
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(baseline.spread);
      days.set(day, (days.get(day) ?? 0) + 1);
    }
    expect(Math.max(...days.values())).toBeLessThanOrEqual(10);
    expect(days.size).toBeGreaterThan(baseline.spread / 2);
  });

  it("is due at the target recall on its day", () => {
    const baseline: Baseline = { since, spread: 20 };
    const schedule = scheduler.schedule("x.md", [], baseline)!;
    expect(scheduler.retrievability(schedule, schedule.due)).toBeCloseTo(0.9, 3);
    expect(new Scheduler(0.8).retrievability(new Scheduler(0.8).schedule("x.md", [], baseline)!, schedule.due)).toBeCloseTo(0.8, 3);
  });

  it("a dated mark in the journal wins over the baseline", () => {
    const schedule = scheduler.schedule("x.md", [entry("mastered", since + 5 * DAY)], { since, spread: 20 })!;
    expect(schedule.anchor).toBe(since + 5 * DAY);
  });

  it("reviews after the baseline count", () => {
    const schedule = scheduler.schedule("x.md", [entry("reviewed", since + 2 * DAY, { rating: "3" })], { since, spread: 20 })!;
    expect(schedule.reviews).toBe(1);
  });

  it("concepts marked known in one batch still come back on different days", () => {
    const dues = new Set<number>();
    for (let index = 0; index < 20; index++) dues.add(Math.round(scheduler.schedule(`k${index}.md`, [entry("known", T0)], null)!.due / DAY));
    expect(dues.size).toBeGreaterThan(1);
  });

  it("the spread follows the id, so it stays put", () => {
    expect(hashId("Concepts/Gradient.md")).toBe(hashId("Concepts/Gradient.md"));
    expect(hashId("Concepts/Gradient.md")).not.toBe(hashId("Concepts/Gradient 2.md"));
  });
});
