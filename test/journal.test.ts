import { describe, expect, it } from "vitest";
import { emptyProgress } from "../src/core/graph";
import {
  formatEntry,
  JournalHistory,
  monthOf,
  parseJournal,
  parseLine,
  progressEvents,
  stamp,
  type ResolvedEntry,
} from "../src/core/journal";
import type { Progress } from "../src/core/types";

const progress = (over: Partial<Progress> = {}): Progress => ({ ...emptyProgress(), ...over });
const at = (iso: string) => new Date(iso);

describe("journal lines", () => {
  it("carry local time with its offset and read back as the same moment", () => {
    const date = at("2026-11-03T11:05:12Z");
    const line = formatEntry(date, "mastered", "[[Gradient]]");
    expect(line).toMatch(/^- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} mastered \[\[Gradient\]\]$/);
    expect(parseLine(line)?.time).toBe(date.getTime());
    expect(stamp(date)).toBe(line.slice(2, 27));
  });

  it("keep fields and flags, and a link with spaces in one piece", () => {
    const line = formatEntry(at("2026-11-03T10:00:00Z"), "checked", "[[Folder/Gradient descent|alias]]", { rating: "3", right: "2", of: "3" }, ["undo"]);
    const entry = parseLine(line, "J/2026-11 phone-0a1b.md", 7)!;
    expect(entry).toMatchObject({
      action: "checked",
      target: "[[Folder/Gradient descent|alias]]",
      fields: { rating: "3", right: "2", of: "3" },
      flags: ["undo"],
      file: "J/2026-11 phone-0a1b.md",
      line: 7,
    });
  });

  it("write URLs as they are and nothing as a dash", () => {
    const url = parseLine(formatEntry(at("2026-11-03T10:00:00Z"), "done", "https://ru.wikipedia.org/wiki/Градиент"))!;
    expect(url.target).toBe("https://ru.wikipedia.org/wiki/Градиент");
    const goal = parseLine(formatEntry(at("2026-11-03T10:00:00Z"), "goal", ""))!;
    expect(goal.target).toBe("-");
  });

  it("drop spaces and `=` from values so a line always splits the same way", () => {
    const line = formatEntry(at("2026-11-03T10:00:00Z"), "confidence", "[[A]]", { level: "4 =x" });
    expect(parseLine(line)?.fields).toEqual({ level: "4x" });
    expect(() => formatEntry(new Date(), "Bad action", "[[A]]")).toThrow();
  });

  it("skip whatever is not an entry: frontmatter, notes, broken lines", () => {
    const text = [
      "---",
      "type: learning-journal",
      "---",
      "",
      "Tropa adds a line here.",
      "- 2026-11-03T10:00:00+03:00 mastered [[A]]",
      "- a note written by hand",
      "- 2026-13-45T99:00:00+03:00 mastered [[B]]",
      "- 2026-11-03T10:00:00 mastered [[no zone]]",
      "- 2026-11-03T10:01:00+03:00 started [[C",
      "* 2026-11-03T10:02:00Z skipped [[D]]",
      "  - 2026-11-03T10:03:00+0300 started [[E]] future-flag key=value",
      "- 2026-11-03T10:04:00+03:00 some-new-action [[F]]",
    ].join("\r\n");
    const entries = parseJournal(text, "j.md");
    expect(entries.map((entry) => [entry.action, entry.target])).toEqual([
      ["mastered", "[[A]]"],
      ["skipped", "[[D]]"],
      ["started", "[[E]]"],
      ["some-new-action", "[[F]]"],
    ]);
    expect(entries[2]).toMatchObject({ flags: ["future-flag"], fields: { key: "value" }, line: 11 });
  });

  it("name the month in local time", () => {
    expect(monthOf(new Date(2026, 0, 31, 23, 59))).toBe("2026-01");
    expect(monthOf(new Date(2026, 11, 1, 0, 0))).toBe("2026-12");
  });
});

describe("progress events", () => {
  it("name each change once", () => {
    const before = progress({ learning: new Set(["a", "s"]), mastered: new Set(["m"]), skipped: new Set(["k"]), done: new Set(["x"]) });
    const after = progress({
      goal: "g",
      learning: new Set(["n"]),
      mastered: new Set(["a"]),
      skipped: new Set(["s"]),
      done: new Set(["material:https://e.com"]),
    });
    expect(progressEvents(before, after)).toEqual([
      { action: "goal", id: "g" },
      { action: "unmastered", id: "m" },
      { action: "mastered", id: "a" },
      { action: "unskipped", id: "k" },
      { action: "skipped", id: "s" },
      { action: "started", id: "n" },
      { action: "done", id: "material:https://e.com" },
      { action: "undone", id: "x" },
    ]);
  });

  it("tell known from mastered and flag what Undo puts back", () => {
    const before = progress({ learning: new Set(["a"]) });
    const after = progress({ mastered: new Set(["a", "b"]) });
    expect(progressEvents(before, after, "known").map((event) => event.action)).toEqual(["known", "known"]);
    expect(progressEvents(after, before, "undo")).toEqual([
      { action: "unmastered", id: "a", flags: ["undo"] },
      { action: "started", id: "a", flags: ["undo"] },
      { action: "unmastered", id: "b", flags: ["undo"] },
    ]);
  });

  it("report confidence, but not when it goes with the mark it belonged to", () => {
    const before = progress({ mastered: new Set(["a", "b"]), confidence: new Map([["a", 2], ["b", 4]]) });
    const set = progress({ mastered: new Set(["a", "b"]), confidence: new Map([["a", 5], ["b", 4]]) });
    expect(progressEvents(before, set)).toEqual([{ action: "confidence", id: "a", fields: { level: "5" } }]);
    const cleared = progress({ mastered: new Set(["a", "b"]), confidence: new Map([["b", 4]]) });
    expect(progressEvents(before, cleared)).toEqual([{ action: "confidence", id: "a", fields: { level: "none" } }]);
    const unmastered = progress({ mastered: new Set(["b"]), confidence: new Map([["b", 4]]) });
    expect(progressEvents(before, unmastered)).toEqual([{ action: "unmastered", id: "a" }]);
  });

  it("are empty when nothing changed", () => {
    const same = progress({ goal: "g", mastered: new Set(["a"]) });
    expect(progressEvents(same, progress({ goal: "g", mastered: new Set(["a"]) }))).toEqual([]);
  });
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-30T12:00:00Z");
let counter = 0;
const entry = (daysAgo: number, action: string, id: string | null, fields: Record<string, string> = {}, flags: string[] = [], file = "a.md"): ResolvedEntry => ({
  time: NOW - daysAgo * DAY,
  action,
  target: id ? `[[${id}]]` : "-",
  fields,
  flags,
  file,
  line: counter++,
  id,
});

describe("journal history", () => {
  it("merges devices by time and keeps the order of one file within a second", () => {
    const history = new JournalHistory([
      entry(1, "mastered", "a", {}, [], "phone.md"),
      entry(3, "started", "a", {}, [], "desktop.md"),
      { ...entry(1, "unmastered", "a", {}, ["undo"], "phone.md") },
    ]);
    expect(history.of("a").map((e) => e.action)).toEqual(["started", "mastered", "unmastered"]);
    expect(history.of("missing")).toEqual([]);
  });

  it("lists reviews with their ratings, takes back undone ones and skips bad ratings", () => {
    const history = new JournalHistory([
      entry(20, "reviewed", "a", { rating: "3" }),
      entry(10, "checked", "a", { rating: "2", right: "1", of: "2" }),
      entry(9, "reviewed", "a", { rating: "4" }),
      entry(9, "reviewed", "a", {}, ["undo"]),
      entry(5, "reviewed", "a", { rating: "7" }),
      entry(4, "reviewed", "a", { rating: "x" }),
      entry(2, "reviewed", "b", { rating: "1" }),
    ]);
    expect(history.reviews("a")).toEqual([
      { time: NOW - 20 * DAY, rating: 3, action: "reviewed" },
      { time: NOW - 10 * DAY, rating: 2, action: "checked" },
    ]);
    expect(history.reviews("b")).toHaveLength(1);
  });

  it("knows when a mark that still stands was made", () => {
    const history = new JournalHistory([
      entry(10, "mastered", "a"),
      entry(9, "unmastered", "a", {}, ["undo"]),
      entry(8, "known", "a"),
      entry(5, "mastered", "b"),
      entry(4, "skipped", "b"),
    ]);
    expect(history.masteredAt("a")).toBe(NOW - 8 * DAY);
    expect(history.masteredAt("b")).toBeNull();
    expect(history.masteredAt("c")).toBeNull();
  });

  it("counts what was mastered, finished and reviewed in a period and still stands", () => {
    const minutes: Record<string, number> = { m1: 30, m2: 45, m3: 20 };
    const history = new JournalHistory([
      entry(2, "mastered", "a"),
      entry(3, "mastered", "b"),
      entry(3, "unmastered", "b", {}, ["undo"]),
      entry(12, "mastered", "c"),
      entry(1, "known", "d"),
      entry(1, "mastered", "e"),
      entry(1, "mastered", "e"),
      entry(2, "done", "m1"),
      entry(20, "done", "m2"),
      entry(1, "done", "m3"),
      entry(0.5, "undone", "m3"),
      entry(1, "reviewed", "a", { rating: "3" }),
      entry(1, "reviewed", "a", { rating: "4" }),
      entry(1, "reviewed", "a", {}, ["undo"]),
      entry(15, "checked", "c", { rating: "2" }),
      entry(-1, "mastered", "future"),
    ]);
    const of = (id: string) => minutes[id];
    expect(history.stats(NOW, 7, of)).toEqual({ mastered: 2, minutes: 30, reviews: 1 });
    expect(history.stats(NOW, 30, of)).toEqual({ mastered: 3, minutes: 75, reviews: 2 });
    expect(new JournalHistory([]).stats(NOW, 7, of)).toEqual({ mastered: 0, minutes: 0, reviews: 0 });
  });

  it("reads and merges 20 000 lines quickly", () => {
    const lines: string[] = [];
    const start = Date.parse("2026-01-01T00:00:00Z");
    for (let i = 0; i < 20000; i++) {
      const action = ["started", "mastered", "done", "reviewed"][i % 4];
      lines.push(formatEntry(new Date(start + i * 60000), action, `[[Concept ${i % 700}]]`, action === "reviewed" ? { rating: String(1 + (i % 4)) } : {}));
    }
    const text = lines.join("\n");
    const began = performance.now();
    const parsed = [...parseJournal(text.slice(0, text.length / 2), "a.md"), ...parseJournal(text.slice(text.length / 2), "b.md")];
    const history = new JournalHistory(parsed.map((e) => ({ ...e, id: e.target })));
    const stats = history.stats(start + 20000 * 60000, 30, () => 10);
    for (let i = 0; i < 700; i++) history.reviews(`[[Concept ${i}]]`);
    const took = performance.now() - began;
    expect(parsed.length).toBeGreaterThanOrEqual(19999);
    expect(stats.reviews).toBeGreaterThan(0);
    expect(took).toBeLessThan(400);
  });
});
