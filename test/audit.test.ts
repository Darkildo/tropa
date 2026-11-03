import { describe, expect, it } from "vitest";
import { auditCount, auditGraph, cycleChain, normalizeTitle } from "../src/core/audit";
import { LearningGraph } from "../src/core/graph";
import { sample } from "../src/sample";
import type { NoteInput, NoteRef } from "../src/core/types";
import { parse } from "yaml";

const ref = (id: string): NoteRef => ({ id, title: id.replace(/^ghost:/, "") });
const concept = (id: string, requires: string[] = [], recommends: string[] = []): NoteInput => ({
  id, title: id, kind: "concept", requires: requires.map(ref), recommends: recommends.map(ref), teaches: [],
});
const source = (id: string, teaches: string[]): NoteInput => ({
  id, title: id, kind: "source", requires: [], recommends: [], teaches: teaches.map(ref),
});
const titled = (note: NoteInput, title: string): NoteInput => ({ ...note, title });

describe("map audit", () => {
  it("lists linked concepts that nothing teaches", () => {
    const audit = auditGraph(new LearningGraph([concept("a"), concept("b", ["a"]), source("s", ["a"])]));
    expect(audit.noMaterials).toEqual(["b"]);
  });

  it("lists notes with no link at all, and not again as concepts without materials", () => {
    const graph = new LearningGraph([concept("alone"), source("lonely material", []), concept("a"), concept("b", [], ["a"])]);
    const audit = auditGraph(graph);
    expect(audit.orphans).toEqual(["alone", "lonely material"]);
    // A soft link connects both ends: neither is an orphan.
    expect(audit.noMaterials).toEqual(["a", "b"]);
  });

  it("lists missing notes with how many notes link to them", () => {
    const graph = new LearningGraph([
      concept("a", ["ghost:Missing"]),
      concept("b", ["ghost:Missing"], ["ghost:Later"]),
      source("s", ["ghost:Missing"]),
    ]);
    expect(auditGraph(graph).ghosts).toEqual([
      { id: "ghost:Missing", linkedFrom: 3 },
      { id: "ghost:Later", linkedFrom: 1 },
    ]);
  });

  it("groups names that differ only in case, accents or spaces, within one kind", () => {
    const graph = new LearningGraph([
      titled(concept("x/Ёлка.md"), "Ёлка"),
      titled(concept("y/елка.md", ["ghost:ЕЛКА"]), "елка"),
      titled(concept("Café.md"), "Café"),
      titled(concept("cafe.md"), "cafe  "),
      titled(source("Café note.md", ["Café.md"]), "Café"),
      titled(concept("Other.md"), "Other"),
    ]);
    const groups = auditGraph(graph).duplicates;
    expect(groups).toHaveLength(2);
    expect([...groups.find((group) => group.includes("Café.md"))!].sort()).toEqual(["Café.md", "cafe.md"]);
    // A link to a missing note with the same name counts as a duplicate of the concept.
    expect([...groups.find((group) => group.includes("x/Ёлка.md"))!].sort()).toEqual(["ghost:ЕЛКА", "x/Ёлка.md", "y/елка.md"]);
  });

  it("lists concepts without self-check questions only when asked", () => {
    const graph = new LearningGraph([concept("a"), concept("b", ["a", "ghost:Missing"]), source("s", ["a"])]);
    expect(auditGraph(graph).noQuestions).toEqual([]);
    const audit = auditGraph(graph, (id) => (id === "a" ? 2 : 0));
    // A ghost has no note to hold questions; a material is not asked for them.
    expect(audit.noQuestions).toEqual(["b"]);
    expect(auditCount(audit)).toBe(auditCount(auditGraph(graph)) + 1);
  });

  it("normalizes names for comparison", () => {
    expect(normalizeTitle("  Ünïcode   Façade ")).toBe("unicode facade");
    expect(normalizeTitle("Ёж")).toBe(normalizeTitle("еж"));
  });

  it("shows each cycle as a chain that leads back to its start", () => {
    const graph = new LearningGraph([concept("a", ["b"]), concept("b", ["c"]), concept("c", ["a", "d"]), concept("d", ["c"]), concept("self", ["self"])]);
    const audit = auditGraph(graph);
    expect(audit.cycles).toHaveLength(2);
    for (const chain of audit.cycles) {
      chain.forEach((id, i) => expect(graph.nodes.get(id)!.requires).toContain(chain[(i + 1) % chain.length]));
    }
    expect(audit.cycles.find((chain) => chain.includes("self"))).toEqual(["self"]);
    // The shortest way back: c → a would skip d.
    const big = audit.cycles.find((chain) => chain.includes("a"))!;
    expect(big).toHaveLength(big.includes("d") ? 2 : 3);
  });

  it("finds the shortest loop through the first member", () => {
    const graph = new LearningGraph([concept("a", ["b", "c"]), concept("b", ["c"]), concept("c", ["a"])]);
    expect(cycleChain(graph, ["a", "b", "c"])).toEqual(["a", "c"]);
  });

  it("counts findings, a cycle or a group of duplicates once", () => {
    const graph = new LearningGraph([concept("a", ["b"]), concept("b", ["a"]), titled(concept("c"), "A"), concept("alone")]);
    const audit = auditGraph(graph);
    expect(audit.cycles).toHaveLength(1);
    expect(audit.duplicates).toHaveLength(1);
    expect(audit.orphans).toEqual(["c", "alone"].sort((x, y) => graph.nodes.get(x)!.title.localeCompare(graph.nodes.get(y)!.title)));
    expect(auditCount(audit)).toBe(audit.noMaterials.length + 2 + 1 + 1);
  });

  it("finds nothing to fix in the example map", () => {
    const { files } = sample("en");
    const byTitle = new Map(files.map((file) => [file.path.split("/").pop()!.replace(/\.md$/, ""), file.path]));
    const refs = (value: unknown): NoteRef[] =>
      (Array.isArray(value) ? value : []).map((link) => {
        const title = String(link).replace(/^\[\[|\]\]$/g, "");
        return { id: byTitle.get(title) ?? `ghost:${title}`, title };
      });
    const notes = files.map((file): NoteInput => {
      const front = parse(file.content.split("---")[1]) as Record<string, unknown>;
      return {
        id: file.path,
        title: file.path.split("/").pop()!.replace(/\.md$/, ""),
        kind: front.type === "source" ? "source" : "concept",
        requires: refs(front.requires),
        recommends: refs(front.recommends),
        teaches: refs(front.teaches),
      };
    });
    const audit = auditGraph(new LearningGraph(notes));
    expect(audit.cycles).toEqual([]);
    expect(audit.ghosts).toEqual([]);
    expect(audit.duplicates).toEqual([]);
    expect(audit.orphans).toEqual([]);
  });
});
