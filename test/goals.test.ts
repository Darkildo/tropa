import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { allGoalsOf, computeRoute, computeStates, emptyProgress, LearningGraph, routeTargets, sameProgress } from "../src/core/graph";
import { forecast, parsePace, roundPace } from "../src/core/plan";
import { isDate, readProgress, writeProgress } from "../src/core/progress";
import type { NoteInput, NoteRef, Progress } from "../src/core/types";

const ref = (id: string): NoteRef => ({ id, title: id });
const concept = (id: string, ...requires: string[]): NoteInput => ({
  id, title: id, kind: "concept", requires: requires.map(ref), recommends: [], teaches: [],
});
const source = (id: string, teaches: string[], minutes?: number): NoteInput => ({
  id, title: id, kind: "source", requires: [], recommends: [], teaches: teaches.map(ref), minutes,
});
const progress = (over: Partial<Progress> = {}): Progress => ({ ...emptyProgress(), ...over });
const link = (id: string) => `[[${id}]]`;
const resolve = (target: string) => target;
const roundTrip = (frontmatter: Record<string, unknown>) => parse(stringify(frontmatter)) as Record<string, unknown>;

// base → left → goalA, base → right → goalB, and shared feeds both goals.
const graph = new LearningGraph([
  concept("base"),
  concept("shared"),
  concept("left", "base"),
  concept("right", "base"),
  concept("goalA", "left", "shared"),
  concept("goalB", "right", "shared"),
  source("book", ["base"], 120),
  source("left video", ["left"], 30),
  source("shared article", ["shared"], 30),
]);

describe("goals in the progress file", () => {
  it("reads a file with one goal as a list of one", () => {
    const p = readProgress({ goal: "[[goalA]]" }, resolve);
    expect(p.goal).toBe("goalA");
    expect(p.goals).toEqual(["goalA"]);
    expect(p.allGoals).toBe(false);
    expect(p.paceHours).toBeNull();
  });

  it("writes nothing new while there is one goal and no plan", () => {
    const frontmatter: Record<string, unknown> = { type: "learning-progress" };
    writeProgress(frontmatter, progress({ goal: "goalA", goals: ["goalA"] }), link);
    expect(Object.keys(frontmatter).sort()).toEqual(["done", "goal", "learning", "mastered", "type"]);
  });

  it("keeps several goals, the route to all, deadlines by date and the pace", () => {
    const p = progress({
      goal: "goalB",
      goals: ["goalA", "goalB", "base"],
      allGoals: true,
      deadlines: new Map([["goalA", "2026-12-31"], ["base", "2026-12-31"], ["goalB", "2027-03-01"]]),
      paceHours: 2.5,
    });
    const frontmatter: Record<string, unknown> = { type: "learning-progress" };
    writeProgress(frontmatter, p, link);
    expect(frontmatter.goal).toBe("[[goalB]]");
    expect(frontmatter.goals).toEqual(["[[goalA]]", "[[goalB]]", "[[base]]"]);
    expect(frontmatter["all-goals"]).toBe(true);
    expect(frontmatter["deadline-2026-12-31"]).toEqual(["[[goalA]]", "[[base]]"]);
    expect(frontmatter["deadline-2027-03-01"]).toEqual(["[[goalB]]"]);
    expect(frontmatter["pace-hours"]).toBe(2.5);
    expect(sameProgress(readProgress(roundTrip(frontmatter), resolve), p)).toBe(true);
  });

  it("drops the lists again when one goal is left", () => {
    const frontmatter: Record<string, unknown> = {
      type: "learning-progress", goals: ["[[goalA]]", "[[goalB]]"], "all-goals": true, "deadline-2026-12-31": ["[[goalB]]"], "pace-hours": 3,
    };
    writeProgress(frontmatter, progress({ goal: "goalA", goals: ["goalA"] }), link);
    expect(frontmatter).not.toHaveProperty("goals");
    expect(frontmatter).not.toHaveProperty("all-goals");
    expect(frontmatter).not.toHaveProperty("deadline-2026-12-31");
    expect(frontmatter).not.toHaveProperty("pace-hours");
  });

  // An older version only knows `goal`: what it sets there is kept and shown.
  it("adds a goal an older version set to the list", () => {
    const p = readProgress({ goal: "[[right]]", goals: ["[[goalA]]", "[[goalB]]"] }, resolve);
    expect(p.goal).toBe("right");
    expect(p.goals).toEqual(["goalA", "goalB", "right"]);
  });

  it("falls back to the first goal when `goal` is empty", () => {
    expect(readProgress({ goal: null, goals: ["[[goalA]]", "[[goalB]]"] }, resolve).goal).toBe("goalA");
  });

  it("ignores impossible dates, deadlines of what is not a goal and a bad pace", () => {
    const p = readProgress(
      { goal: "[[goalA]]", "deadline-2026-02-30": ["[[goalA]]"], "deadline-2026-12-01": ["[[base]]"], "pace-hours": "lots", "all-goals": true },
      resolve,
    );
    expect(p.deadlines.size).toBe(0);
    expect(p.paceHours).toBeNull();
    // One goal cannot be "all goals".
    expect(p.allGoals).toBe(false);
  });

  it("sees a change of the goals, the deadlines or the pace", () => {
    const base = () => progress({ goal: "goalA", goals: ["goalA", "goalB"], deadlines: new Map([["goalA", "2026-12-31"]]), paceHours: 4 });
    const changes: ((p: Progress) => void)[] = [
      (p) => (p.goals = ["goalB", "goalA"]),
      (p) => (p.allGoals = true),
      (p) => p.deadlines.set("goalA", "2027-01-01"),
      (p) => (p.paceHours = 5),
    ];
    for (const change of changes) {
      const other = base();
      change(other);
      expect(sameProgress(base(), other)).toBe(false);
    }
  });
});

describe("the route to several goals", () => {
  it("leads to the active goal only, unless all goals are on", () => {
    const one = progress({ goal: "goalA", goals: ["goalA", "goalB"] });
    expect(routeTargets(one)).toEqual(["goalA"]);
    expect(routeTargets({ ...one, allGoals: true })).toEqual(["goalA", "goalB"]);
    expect(allGoalsOf(progress({ goal: "goalA" }))).toEqual(["goalA"]);
  });

  it("covers both goals once, and marks the steps they share", () => {
    const p = progress({ goal: "goalA", goals: ["goalA", "goalB"], allGoals: true });
    const route = computeRoute(graph, p, computeStates(graph, p))!;
    expect(route.goals).toEqual(["goalA", "goalB"]);
    expect(route.steps.map((step) => step.id)).toEqual(["base", "left", "shared", "goalA", "right", "goalB"]);
    expect(route.steps.find((step) => step.id === "base")!.goals).toEqual(["goalA", "goalB"]);
    expect(route.steps.find((step) => step.id === "left")!.goals).toEqual(["goalA"]);
    // The book teaches a step both goals need and is counted once.
    expect(route.remainingMinutes).toBe(180);
    expect(route.total).toBe(6);
  });

  it("puts the goal due first in front", () => {
    const p = progress({ goal: "goalA", goals: ["goalA", "goalB"], allGoals: true, deadlines: new Map([["goalB", "2026-12-01"]]) });
    const route = computeRoute(graph, p, computeStates(graph, p))!;
    expect(route.goals).toEqual(["goalB", "goalA"]);
    expect(route.steps.map((step) => step.id).slice(0, 3)).toEqual(["base", "right", "shared"]);
  });

  it("goes without a goal that is not on the map", () => {
    const p = progress({ goal: "goalA", goals: ["goalA", "gone"], allGoals: true });
    expect(computeRoute(graph, p, computeStates(graph, p))!.goals).toEqual(["goalA"]);
  });
});

describe("forecast", () => {
  const route = (minutes: number, unestimated = 0) => ({ remainingMinutes: minutes, unestimated, steps: [{}] as never[] });
  const today = new Date(2026, 10, 3);

  it("finds the finish date at the planned pace", () => {
    // 10 hours at 5 a week is two weeks.
    const result = forecast(route(600), 5, null, today);
    expect(result.finish).toEqual(new Date(2026, 10, 17));
    expect(result.needed).toBeNull();
    expect(result.onTrack).toBeNull();
  });

  it("works out the pace a deadline needs, counting the deadline day", () => {
    // From 3 to 16 November is 14 days, two weeks: 10 hours need 5 a week.
    expect(forecast(route(600), null, "2026-11-16", today).needed).toBeCloseTo(5);
  });

  it("tells whether the pace keeps the deadline", () => {
    expect(forecast(route(600), 5, "2026-11-17", today).onTrack).toBe(true);
    expect(forecast(route(600), 4, "2026-11-17", today).onTrack).toBe(false);
  });

  it("notices a deadline that has passed", () => {
    const result = forecast(route(600), 5, "2026-11-02", today);
    expect(result.overdue).toBe(true);
    expect(result.needed).toBeNull();
    expect(forecast(route(600), 5, "2026-11-03", today).overdue).toBe(false);
  });

  it("is not thrown off by a change of daylight saving time", () => {
    // Europe moves its clocks on 29 March 2026: still 7 days.
    expect(forecast(route(60), 1, null, new Date(2026, 2, 25)).finish).toEqual(new Date(2026, 3, 1));
  });

  it("reports the steps without an estimate", () => {
    expect(forecast(route(60, 2), 1, null, today).unestimated).toBe(2);
  });

  it("rounds the pace up and reads it as people type it", () => {
    expect(roundPace(4.01)).toBe(4.1);
    expect(roundPace(12.2)).toBe(13);
    expect(parsePace("2,5")).toBe(2.5);
    expect(parsePace(" ")).toBeNull();
    expect(parsePace("abc")).toBeNaN();
    expect(parsePace("0")).toBeNaN();
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2028-02-29")).toBe(true);
  });
});
