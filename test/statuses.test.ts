import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import {
  computeRoute,
  computeStates,
  emptyProgress,
  knownCandidates,
  LearningGraph,
  newlyAvailable,
  sourceState,
} from "../src/core/graph";
import { readProgress, writeProgress } from "../src/core/progress";
import type { NoteInput, NoteRef, Progress } from "../src/core/types";

const ref = (id: string): NoteRef => ({ id, title: id });
const concept = (id: string, ...requires: string[]): NoteInput => ({
  id, title: id, kind: "concept", requires: requires.map(ref), recommends: [], teaches: [],
});
const source = (id: string, teaches: string[], requires: string[] = []): NoteInput => ({
  id, title: id, kind: "source", requires: requires.map(ref), recommends: [], teaches: teaches.map(ref),
});
const progress = (over: Partial<Progress> = {}): Progress => ({ ...emptyProgress(), ...over });

// a → b → c → goal, and d is an unrelated side branch.
const graph = new LearningGraph([concept("a"), concept("b", "a"), concept("c", "b"), concept("goal", "c"), concept("d")]);

describe("skipped concepts", () => {
  it("open what depends on them without counting as mastered", () => {
    const states = computeStates(graph, progress({ skipped: new Set(["a"]) }));
    expect(states.get("a")).toBe("skipped");
    expect(states.get("b")).toBe("available");
    expect(states.get("c")).toBe("locked");
  });

  it("leave the route and the count of what is left to master", () => {
    const p = progress({ goal: "goal", mastered: new Set(["a"]), skipped: new Set(["b"]) });
    const route = computeRoute(graph, p, computeStates(graph, p))!;
    expect(route.steps.map((step) => step.id)).toEqual(["c", "goal"]);
    expect(route.next).toBe("c");
    expect(route.masteredCount).toBe(1);
    expect(route.skippedCount).toBe(1);
    expect(route.total).toBe(3);
  });

  it("let a mastered mark win over a stale skip", () => {
    const states = computeStates(graph, progress({ mastered: new Set(["a"]), skipped: new Set(["a"]) }));
    expect(states.get("a")).toBe("mastered");
  });

  it("count as passed for materials that require them", () => {
    const g = new LearningGraph([concept("a"), concept("b"), source("s", ["b"], ["a"])]);
    expect(sourceState(g, progress(), "s")).toBe("locked");
    expect(sourceState(g, progress({ skipped: new Set(["a"]) }), "s")).toBe("ready");
  });

  it("report what skipping unlocks", () => {
    const before = progress();
    const after = progress({ skipped: new Set(["a"]) });
    expect(newlyAvailable(graph, before, after)).toEqual(["b"]);
  });
});

describe("marking what is known", () => {
  it("offers the concept and its unmastered prerequisites in learning order", () => {
    expect(knownCandidates(graph, progress(), "goal")).toEqual(["a", "b", "c", "goal"]);
  });

  it("stops at what is already mastered and keeps skipped ones on offer", () => {
    expect(knownCandidates(graph, progress({ mastered: new Set(["b"]) }), "goal")).toEqual(["c", "goal"]);
    expect(knownCandidates(graph, progress({ skipped: new Set(["b"]) }), "c")).toEqual(["a", "b", "c"]);
  });

  it("never leaves the prerequisites of the concept", () => {
    expect(knownCandidates(graph, progress(), "b")).not.toContain("d");
  });

  it("returns nothing for a mastered concept or a material", () => {
    const g = new LearningGraph([concept("a"), source("s", ["a"])]);
    expect(knownCandidates(g, progress({ mastered: new Set(["a"]) }), "a")).toEqual([]);
    expect(knownCandidates(g, progress(), "s")).toEqual([]);
  });
});

/** The progress file as Obsidian would store it: YAML frontmatter with links as values. */
const link = (id: string) => `[[${id}]]`;
const resolve = (target: string) => target;
const roundTrip = (frontmatter: Record<string, unknown>) => parse(stringify(frontmatter)) as Record<string, unknown>;

describe("progress file", () => {
  const legacy = parse(`
type: learning-progress
goal: "[[goal]]"
mastered:
  - "[[a]]"
learning:
  - "[[b]]"
done: []
`) as Record<string, unknown>;

  it("reads a file written before skipping and confidence existed", () => {
    const p = readProgress(legacy, resolve);
    expect(p.goal).toBe("goal");
    expect([...p.mastered]).toEqual(["a"]);
    expect([...p.learning]).toEqual(["b"]);
    expect(p.skipped.size).toBe(0);
    expect(p.confidence.size).toBe(0);
  });

  it("writes an untouched old file back without new keys", () => {
    const frontmatter = roundTrip(legacy);
    writeProgress(frontmatter, readProgress(legacy, resolve), link);
    expect(Object.keys(frontmatter).sort()).toEqual(["done", "goal", "learning", "mastered", "type"]);
    expect(frontmatter).toEqual(legacy);
  });

  it("adds new lists only when they are used and survives a round trip", () => {
    const p = readProgress(legacy, resolve);
    p.skipped.add("d");
    p.confidence.set("a", 4);
    p.confidence.set("b", 2);
    const frontmatter = roundTrip(legacy);
    writeProgress(frontmatter, p, link);
    expect(frontmatter.skipped).toEqual(["[[d]]"]);
    expect(frontmatter["confidence-4"]).toEqual(["[[a]]"]);
    expect(frontmatter["confidence-2"]).toEqual(["[[b]]"]);
    expect(frontmatter).not.toHaveProperty("confidence-1");

    const again = readProgress(roundTrip(frontmatter), resolve);
    expect([...again.skipped]).toEqual(["d"]);
    expect([...again.confidence].sort()).toEqual([["a", 4], ["b", 2]]);
  });

  it("drops a list once it is empty and keeps keys it does not own", () => {
    const frontmatter = roundTrip({ ...legacy, skipped: ["[[d]]"], "confidence-3": ["[[a]]"], note: "mine" });
    writeProgress(frontmatter, readProgress(legacy, resolve), link);
    expect(frontmatter).not.toHaveProperty("skipped");
    expect(frontmatter).not.toHaveProperty("confidence-3");
    expect(frontmatter.note).toBe("mine");
  });

  it("reads a hand-edited file with a concept in two confidence lists", () => {
    const p = readProgress({ "confidence-2": ["[[a]]"], "confidence-5": "[[a]]" }, resolve);
    expect(p.confidence.get("a")).toBe(5);
  });

  it("treats a missing file as empty progress", () => {
    expect(readProgress(undefined, resolve)).toEqual(emptyProgress());
  });
});
