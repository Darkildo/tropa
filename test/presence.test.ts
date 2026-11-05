import { afterEach, describe, expect, it } from "vitest";
import { BLOCK_LIMIT_MAX, blockErrorText, linkText, parseBlockOptions, statusLine } from "../src/core/presence";
import { setLocale } from "../src/i18n";

afterEach(() => setLocale("en"));

describe("tropa block options", () => {
  it("default to the route to the active goal", () => {
    expect(parseBlockOptions("")).toEqual({ options: { show: "route", goal: null, limit: null } });
  });

  it("read show, goal and limit, keys in any case, comments and blank lines skipped", () => {
    const source = "# today\nShow: Review\n\ngoal: [[Transformer|the goal]]\nLIMIT: 5\n";
    expect(parseBlockOptions(source)).toEqual({ options: { show: "review", goal: "Transformer", limit: 5 } });
  });

  it("take the goal as a link, a quoted link or plain text", () => {
    expect(linkText('"[[Folder/Note]]"')).toBe("Folder/Note");
    expect(linkText("Note")).toBe("Note");
    expect(linkText("[[]]")).toBeNull();
    expect(linkText("  ")).toBeNull();
  });

  it("refuse an unknown option, naming it", () => {
    expect(parseBlockOptions("show: next\ncolour: red")).toEqual({ error: { kind: "unknown", key: "colour" } });
    expect(parseBlockOptions("route")).toEqual({ error: { kind: "unknown", key: "route" } });
  });

  it("refuse a show that is not route, review or next", () => {
    expect(parseBlockOptions("show: map")).toEqual({ error: { kind: "show", value: "map" } });
  });

  it("refuse a limit that is not a whole number from 1 to the maximum", () => {
    for (const value of ["0", "-1", "2.5", "ten", "", String(BLOCK_LIMIT_MAX + 1)]) {
      expect(parseBlockOptions(`limit: ${value}`)).toEqual({ error: { kind: "limit", value } });
    }
    expect(parseBlockOptions(`limit: ${BLOCK_LIMIT_MAX}`)).toEqual({ options: { show: "route", goal: null, limit: BLOCK_LIMIT_MAX } });
  });

  it("say what is wrong in words", () => {
    expect(blockErrorText({ kind: "unknown", key: "colour" })).toBe("Tropa block: unknown option colour. Use show, goal and limit.");
    expect(blockErrorText({ kind: "show", value: "map" })).toBe("Tropa block: show takes route, review or next.");
    expect(blockErrorText({ kind: "limit", value: "0" })).toBe(`Tropa block: limit takes a whole number from 1 to ${BLOCK_LIMIT_MAX}.`);
    setLocale("ru");
    expect(blockErrorText({ kind: "unknown", key: "colour" })).toBe("Блок Tropa: неизвестный параметр colour. Используйте show, goal и limit.");
  });
});

describe("status bar line", () => {
  const today = new Date(2026, 10, 5, 12);

  it("puts reviews first and opens the queue", () => {
    expect(statusLine({ due: 3, pausedUntil: null, next: "Derivatives" }, today)).toEqual({ text: "To review: 3 · Next: Derivatives", action: "queue" });
  });

  it("shows the next step alone when nothing is due, and opens it", () => {
    expect(statusLine({ due: 0, pausedUntil: null, next: "Derivatives" }, today)).toEqual({ text: "Next: Derivatives", action: "next" });
  });

  it("says review is paused instead of a count", () => {
    expect(statusLine({ due: 0, pausedUntil: "2026-11-12", next: "Derivatives" }, today)).toEqual({
      text: "Review paused until November 12 · Next: Derivatives",
      action: "next",
    });
    expect(statusLine({ due: 0, pausedUntil: "2026-11-12", next: null }, today)?.action).toBe("queue");
  });

  it("is empty with nothing due and no next step", () => {
    expect(statusLine({ due: 0, pausedUntil: null, next: null }, today)).toBeNull();
  });

  it("follows the interface language", () => {
    setLocale("ru");
    expect(statusLine({ due: 2, pausedUntil: null, next: "Производные" }, today)?.text).toBe("К повторению: 2 · Дальше: Производные");
  });
});
