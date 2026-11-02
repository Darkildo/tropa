import { describe, expect, it } from "vitest";
import { computeRoute, computeStates, emptyProgress, ghostId, LearningGraph, recommendMaterial, sourceState, unlockedBy } from "../src/core/graph";
import { layoutGraph } from "../src/core/layout";
import { linkTargets, parseLinkTarget } from "../src/core/links";
import type { NoteInput, NoteRef } from "../src/core/types";

const ref = (id: string): NoteRef => ({ id, title: id });
const concept = (id: string, ...requires: string[]): NoteInput => ({
  id, title: id, kind: "concept", requires: requires.map(ref), recommends: [], teaches: [],
});
const source = (id: string, teaches: string[], extra: Partial<NoteInput> = {}): NoteInput => ({
  id, title: id, kind: "source", requires: [], recommends: [], teaches: teaches.map(ref), ...extra,
});
const progress = (over: Partial<ReturnType<typeof emptyProgress>> = {}) => ({ ...emptyProgress(), ...over });

describe("links", () => {
  it("reads every link shape found in properties", () => {
    expect(parseLinkTarget("[[Производная]]")).toBe("Производная");
    expect(parseLinkTarget("[[Папка/Заметка|подпись]]")).toBe("Папка/Заметка");
    expect(parseLinkTarget("[[Заметка#Раздел]]")).toBe("Заметка");
    expect(parseLinkTarget("Просто текст")).toBe("Просто текст");
    expect(parseLinkTarget(42)).toBeNull();
    expect(linkTargets("[[A]]")).toEqual(["A"]);
    expect(linkTargets(["[[A]]", null, "B"])).toEqual(["A", "B"]);
    expect(linkTargets(undefined)).toEqual([]);
  });
});

describe("states", () => {
  const graph = new LearningGraph([concept("a"), concept("b", "a"), concept("c", "a", "b")]);

  it("locks a concept until every prerequisite is mastered", () => {
    const states = computeStates(graph, progress({ mastered: new Set(["a"]) }));
    expect(states.get("a")).toBe("mastered");
    expect(states.get("b")).toBe("available");
    expect(states.get("c")).toBe("locked");
  });

  it("treats a finished material as started", () => {
    const g = new LearningGraph([concept("a"), source("s", ["a"])]);
    expect(computeStates(g, progress({ done: new Set(["s"]) })).get("a")).toBe("learning");
  });

  it("lets a person confirm knowledge out of order", () => {
    expect(computeStates(graph, progress({ mastered: new Set(["c"]) })).get("c")).toBe("mastered");
  });

  it("reports what mastering a concept unlocks", () => {
    expect(unlockedBy(graph, progress({ mastered: new Set(["a"]) }), "b")).toEqual(["c"]);
  });
});

describe("cycles", () => {
  it("finds loops and never reports soft links as loops", () => {
    const soft = { ...concept("a"), recommends: [ref("b")] };
    const clean = new LearningGraph([soft, concept("b", "a")]);
    expect(clean.cycles).toEqual([]);

    const looped = new LearningGraph([concept("a", "c"), concept("b", "a"), concept("c", "b"), concept("d", "c")]);
    expect(looped.cycles).toHaveLength(1);
    expect(new Set(looped.cycles[0])).toEqual(new Set(["a", "b", "c"]));
    expect(computeStates(looped, progress()).get("a")).toBe("cycle");
    expect(computeStates(looped, progress()).get("d")).toBe("locked");
  });

  it("catches a note requiring itself", () => {
    expect(new LearningGraph([concept("a", "a")]).cycles).toEqual([["a"]]);
  });

  it("predicts a loop before the link is written", () => {
    const graph = new LearningGraph([concept("a"), concept("b", "a"), concept("c", "b")]);
    expect(graph.wouldCreateCycle("a", "c")).toBe(true);
    expect(graph.wouldCreateCycle("a", "a")).toBe(true);
    expect(graph.wouldCreateCycle("c", "a")).toBe(false);
  });

  it("survives a very long chain", () => {
    const notes = [concept("n0")];
    for (let i = 1; i < 20000; i++) notes.push(concept(`n${i}`, `n${i - 1}`));
    expect(new LearningGraph(notes).cycles).toEqual([]);
  });
});

describe("route", () => {
  const notes = [
    concept("a"), concept("b", "a"), concept("x"), concept("c", "b", "x"), concept("goal", "c"), concept("other"),
    source("s-short", ["a"], { minutes: 10 }), source("s-long", ["a"], { minutes: 100 }), source("s-c", ["c"]),
  ];

  const route = (over: Partial<ReturnType<typeof emptyProgress>>) => {
    const graph = new LearningGraph(notes);
    const p = progress({ goal: "goal", ...over });
    return computeRoute(graph, p, computeStates(graph, p))!;
  };

  it("always puts prerequisites first and skips unrelated notes", () => {
    const ids = route({}).steps.map((s) => s.id);
    expect(ids).toEqual(["a", "b", "x", "c", "goal"]);
    expect(ids).not.toContain("other");
  });

  it("drops what is already mastered, including what it implied", () => {
    const r = route({ mastered: new Set(["b"]) });
    expect(r.steps.map((s) => s.id)).toEqual(["x", "c", "goal"]);
    expect(r.next).toBe("x");
    expect(r.masteredCount).toBe(1);
    expect(r.total).toBe(6 - 1);
  });

  it("recommends the shortest ready material and adds the time up", () => {
    const r = route({});
    expect(r.steps[0].material).toBe("s-short");
    expect(r.remainingMinutes).toBe(10);
    expect(r.unestimated).toBe(4);
    expect(r.gaps).toEqual(["b", "x", "goal"]);
  });

  it("counts a material once when it covers several steps", () => {
    const graph = new LearningGraph([
      concept("a"), concept("goal", "a"), source("book", ["a", "goal"], { minutes: 300 }),
    ]);
    const p = progress({ goal: "goal" });
    expect(computeRoute(graph, p, computeStates(graph, p))!.remainingMinutes).toBe(300);
  });

  it("does not stall on a loop inside the closure", () => {
    const graph = new LearningGraph([concept("a", "b"), concept("b", "a"), concept("goal", "a")]);
    const p = progress({ goal: "goal" });
    const r = computeRoute(graph, p, computeStates(graph, p))!;
    expect(r.steps).toHaveLength(3);
    expect(r.next).toBeNull();
  });

  it("has no route for a missing goal", () => {
    const graph = new LearningGraph(notes);
    const p = progress({ goal: "nope" });
    expect(computeRoute(graph, p, computeStates(graph, p))).toBeNull();
  });
});

describe("materials", () => {
  it("resolves source prerequisites through concepts and other sources", () => {
    const graph = new LearningGraph([
      concept("a"), concept("b"),
      source("first", ["a"]),
      source("second", ["b"], { requires: [ref("first")] }),
      source("third", ["b"], { requires: [ref("a")] }),
    ]);
    expect(sourceState(graph, progress(), "second")).toBe("locked");
    expect(sourceState(graph, progress({ done: new Set(["first"]) }), "second")).toBe("ready");
    expect(sourceState(graph, progress({ mastered: new Set(["a"]) }), "third")).toBe("ready");
    expect(recommendMaterial(graph, progress({ mastered: new Set(["a"]) }), "b")).toBe("third");
  });

  it("expands a concept that requires a source into what the source teaches", () => {
    const graph = new LearningGraph([concept("a"), source("book", ["a"]), concept("b", "book")]);
    expect(graph.nodes.get("b")!.requires).toEqual(["a"]);
  });
});

describe("ghost notes", () => {
  it("keeps a link to a missing note as a usable concept", () => {
    const missing = { id: ghostId("Позже"), title: "Позже" };
    const note = { ...concept("a"), requires: [missing] };
    const graph = new LearningGraph([note]);
    expect(graph.nodes.get(missing.id)).toMatchObject({ ghost: true, kind: "concept", title: "Позже" });
    expect(computeStates(graph, progress()).get("a")).toBe("locked");
  });
});

describe("layout", () => {
  const graph = new LearningGraph([concept("a"), concept("b", "a"), concept("c", "b"), concept("d", "a"), source("s", ["b"])]);

  it("places every prerequisite above what needs it", () => {
    const { nodes } = layoutGraph(graph, { showSources: false });
    expect(nodes.get("a")!.y).toBeLessThan(nodes.get("b")!.y);
    expect(nodes.get("b")!.y).toBeLessThan(nodes.get("c")!.y);
    expect(nodes.has("s")).toBe(false);
  });

  it("never overlaps nodes", () => {
    const { nodes } = layoutGraph(graph, { showSources: true });
    const list = [...nodes.values()];
    for (const a of list) for (const b of list) {
      if (a === b) continue;
      const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
      expect(apart).toBe(true);
    }
  });

  it("filters to a route", () => {
    const { nodes } = layoutGraph(graph, { showSources: false, only: new Set(["a", "b"]) });
    expect([...nodes.keys()].sort()).toEqual(["a", "b"]);
  });

  it("lays out a loop without failing", () => {
    const looped = new LearningGraph([concept("a", "b"), concept("b", "a")]);
    expect(layoutGraph(looped, { showSources: false }).edges).toHaveLength(2);
  });
});
