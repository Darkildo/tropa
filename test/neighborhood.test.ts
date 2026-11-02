import { describe, expect, it } from "vitest";
import { LearningGraph } from "../src/core/graph";
import { prepareLayout } from "../src/core/layout";
import { fold, foldersOf, neighborhood } from "../src/core/neighborhood";
import type { NoteInput, NoteRef } from "../src/core/types";

const ref = (id: string): NoteRef => ({ id, title: id });
const concept = (id: string, requires: string[] = [], recommends: string[] = []): NoteInput => ({
  id, title: id, kind: "concept", requires: requires.map(ref), recommends: recommends.map(ref), teaches: [],
});
const source = (id: string, teaches: string[], requires: string[] = []): NoteInput => ({
  id, title: id, kind: "source", requires: requires.map(ref), recommends: [], teaches: teaches.map(ref),
});
const sorted = (ids: Iterable<string>) => [...ids].sort();

// a → b → c → d → e, with x needing b and soft links r ⇢ c and c ⇢ s.
const chain = new LearningGraph([
  concept("a"),
  concept("b", ["a"]),
  concept("c", ["b"], ["s"]),
  concept("d", ["c"]),
  concept("e", ["d"]),
  concept("x", ["b"]),
  concept("r", [], ["c"]),
  concept("s"),
  source("m", ["d"], ["a"]),
]);

describe("neighborhood", () => {
  it("walks both ways and through soft links, step by step", () => {
    expect(sorted(neighborhood(chain, "c", 1))).toEqual(["b", "c", "d", "r", "s"]);
    expect(sorted(neighborhood(chain, "c", 2))).toEqual(["a", "b", "c", "d", "e", "r", "s", "x"]);
  });

  it("keeps concepts only and starts from what a material teaches and needs", () => {
    expect(sorted(neighborhood(chain, "m", 1))).toEqual(["a", "d"]);
    expect(sorted(neighborhood(chain, "m", 2))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("is empty for an unknown node and stops in a cycle", () => {
    expect(neighborhood(chain, "nope", 2).size).toBe(0);
    const loop = new LearningGraph([concept("p", ["q"]), concept("q", ["p"]), concept("z", ["q"])]);
    expect(sorted(neighborhood(loop, "p", 3))).toEqual(["p", "q", "z"]);
  });

  it("limits the map that is laid out, with the materials of what is shown", () => {
    const only = neighborhood(chain, "e", 1);
    const prepared = prepareLayout(chain, { showSources: true, only });
    expect(sorted(prepared.ids)).toEqual(["d", "e", "m"]);
  });
});

describe("fold", () => {
  const all = new Set([...chain.nodes.values()].filter((node) => node.kind === "concept").map((node) => node.id));

  it("hides what a folded concept opens and counts it", () => {
    const { hidden, counts } = fold(chain, all, ["c"]);
    expect(sorted(hidden)).toEqual(["d", "e"]);
    expect(counts.get("c")).toBe(2);
  });

  it("hides everything that needs the folded concept, even with other prerequisites", () => {
    expect(sorted(fold(chain, all, ["b"]).hidden)).toEqual(["c", "d", "e", "x"]);
    const diamond = new LearningGraph([concept("a"), concept("b", ["a"]), concept("k"), concept("c", ["b", "k"])]);
    const base = new Set(["a", "b", "k", "c"]);
    expect(sorted(fold(diamond, base, ["b"]).hidden)).toEqual(["c"]);
    expect(fold(diamond, base, ["b"]).counts.get("b")).toBe(1);
    expect(fold(diamond, base, ["b", "k"]).counts.get("k")).toBe(1);
  });

  it("ignores folded concepts outside the map and nests folds", () => {
    expect(fold(chain, new Set(["a", "b"]), ["c"]).hidden.size).toBe(0);
    const { hidden, counts } = fold(chain, all, ["b", "d"]);
    expect(sorted(hidden)).toEqual(["c", "d", "e", "x"]);
    expect(counts.get("b")).toBe(4);
    expect(counts.get("d")).toBe(1);
  });

  it("does not loop or hide the folded concept in a cycle", () => {
    const loop = new LearningGraph([concept("p", ["q"]), concept("q", ["p"]), concept("z", ["q"])]);
    const base = new Set(["p", "q", "z"]);
    const { hidden } = fold(loop, base, ["p"]);
    expect(hidden.has("p")).toBe(false);
    expect(sorted(hidden)).toEqual(["q", "z"]);
    // Folding both ends of the loop keeps both in sight, or nothing would be left to unfold.
    expect(sorted(fold(loop, base, ["p", "q"]).hidden)).toEqual(["z"]);
  });

  it("names the folds that keep a concept out of sight", () => {
    expect(sorted(foldersOf(chain, ["b", "d", "x"], "e"))).toEqual(["b", "d"]);
    expect(foldersOf(chain, ["c"], "c")).toEqual([]);
  });

  it("gives a folded map its own layout key: the hidden concepts are not laid out", () => {
    const { hidden } = fold(chain, all, ["c"]);
    const only = new Set([...all].filter((id) => !hidden.has(id)));
    const prepared = prepareLayout(chain, { showSources: false, only });
    expect(prepared.ids).not.toContain("d");
    expect(prepared.ids).toContain("c");
  });
});
