import { describe, expect, it } from "vitest";
import { LIST_MIN_LINKS, LinkBatch, MAX_SUGGESTIONS, suggestLinks, type NoteText, type SuggestInput } from "../src/core/batch-links";
import { LearningGraph } from "../src/core/graph";
import type { NoteInput, NoteRef } from "../src/core/types";

const ref = (id: string): NoteRef => ({ id, title: id });
const concept = (id: string, requires: string[] = [], recommends: string[] = []): NoteInput => ({
  id, title: id, kind: "concept", requires: requires.map(ref), recommends: recommends.map(ref), teaches: [],
});
const source = (id: string, teaches: string[]): NoteInput => ({
  id, title: id, kind: "source", requires: [], recommends: [], teaches: teaches.map(ref),
});

/**
 * A note from its Markdown body, read the way Obsidian's cache reads it: `[[links]]` with their line,
 * and list items (`-`, `*`, `1.`) with the line of their parent, nesting by indentation.
 */
function note(id: string, body: string): NoteText {
  const lines = body.split("\n");
  const links: NoteText["links"] = [];
  const lists: NoteText["lists"] = [];
  const stack: { indent: number; line: number }[] = [];
  let first = -1;
  lines.forEach((text, line) => {
    for (const match of text.matchAll(/\[\[([^\]|#]+)/g)) links.push({ to: match[1], line });
    const item = /^(\s*)(?:[-*+]|\d+\.)\s/.exec(text);
    if (!item) {
      if (text.trim()) {
        stack.length = 0;
        first = -1;
      }
      return;
    }
    const indent = item[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (!stack.length && first < 0) first = line;
    lists.push({ line, parent: stack.length ? stack[stack.length - 1].line : -first });
    stack.push({ indent, line });
  });
  return { id, links, lists };
}

function input(notes: NoteText[], options: Partial<SuggestInput> = {}): SuggestInput {
  const byId = new Map(notes.map((n) => [n.id, n]));
  return {
    notes,
    linksOf: (id) => byId.get(id)?.links.map((link) => link.to) ?? [],
    eligible: () => true,
    nearby: () => true,
    graph: new LearningGraph([]),
    ...options,
  };
}

const pairs = (result: ReturnType<typeof suggestLinks>) =>
  result.candidates.map((c) => `${c.from} ${c.kind} ${c.to} (${c.origin}${c.checked ? ", ticked" : ""})`);

describe("suggested links", () => {
  it("reads an ordered list of links as a chain, each item needing the one before, ticked", () => {
    const moc = note("Course", ["# Course", "1. [[Limits]]", "2. [[Derivatives]]", "3. [[Integrals]]"].join("\n"));
    const result = suggestLinks(input([moc]));
    expect(pairs(result)).toEqual([
      "Derivatives requires Limits (list, ticked)",
      "Integrals requires Derivatives (list, ticked)",
    ]);
    expect(result.candidates[0].via).toBe("Course");
  });

  it(`needs ${LIST_MIN_LINKS} linked items before a list counts, and a plain item breaks the chain`, () => {
    const short = note("See also", "- [[A]]\n- [[B]]");
    expect(suggestLinks(input([short])).candidates.filter((c) => c.origin === "list")).toEqual([]);

    const broken = note("Plan", ["- [[A]]", "- [[B]]", "- read the intro", "- [[C]]", "- [[D]]"].join("\n"));
    expect(pairs(suggestLinks(input([broken]))).filter((p) => p.includes("list"))).toEqual([
      "B requires A (list, ticked)",
      "D requires C (list, ticked)",
    ]);
  });

  it("keeps separate lists and nested lists apart", () => {
    const body = [
      "- [[A]]",
      "- [[B]]",
      "  - [[B1]]",
      "  - [[B2]]",
      "  - [[B3]]",
      "- [[C]]",
      "",
      "Other list:",
      "- [[X]]",
      "- [[Y]]",
      "- [[Z]]",
    ].join("\n");
    expect(pairs(suggestLinks(input([note("MOC", body)]))).filter((p) => p.includes("list"))).toEqual([
      "B requires A (list, ticked)",
      "C requires B (list, ticked)",
      "B2 requires B1 (list, ticked)",
      "B3 requires B2 (list, ticked)",
      "Y requires X (list, ticked)",
      "Z requires Y (list, ticked)",
    ]);
  });

  it("turns a one-way link in the text into a required link and a link both ways into a recommended one, unticked", () => {
    const a = note("Backprop", "Uses the [[Chain rule]] and [[Gradient descent]].");
    const chain = note("Chain rule", "A rule of calculus.");
    const gd = note("Gradient descent", "See [[Backprop]].");
    expect(pairs(suggestLinks(input([a, chain, gd])))).toEqual([
      "Backprop requires Chain rule (link)",
      "Backprop recommends Gradient descent (mutual)",
    ]);
  });

  it("sees a link back from a note outside the scope", () => {
    const a = note("A", "[[B]]");
    const outside = new Map([["B", ["A"]]]);
    const result = suggestLinks(input([a], { linksOf: (id) => outside.get(id) ?? [] }));
    expect(pairs(result)).toEqual(["A recommends B (mutual)"]);
  });

  it("leaves out pairs the map already links either way, hard or soft", () => {
    const graph = new LearningGraph([concept("A", ["B"]), concept("B"), concept("C", [], ["A"]), concept("D")]);
    const a = note("A", "[[B]] [[C]] [[D]]");
    expect(pairs(suggestLinks(input([a], { graph })))).toEqual(["A requires D (link)"]);
  });

  it("offers a pair once, a list keeping its direction over a link in the text", () => {
    const moc = note("MOC", "- [[A]]\n- [[B]]\n- [[C]]");
    const a = note("A", "Then [[B]].");
    expect(pairs(suggestLinks(input([moc, a])))).toEqual([
      "B requires A (list, ticked)",
      "C requires B (list, ticked)",
    ]);
  });

  it("does not read the links of a list item again as links in the text", () => {
    const moc = note("MOC", "- [[A]]\n- [[B]]\n- [[C]]\n\nIntro to [[D]].");
    expect(pairs(suggestLinks(input([moc]))).filter((p) => p.startsWith("MOC"))).toEqual(["MOC requires D (link)"]);
  });

  it("skips notes that cannot be concepts and targets too far away", () => {
    const a = note("A", "[[Book]] [[Far]] [[Near]] [[A]]");
    const result = suggestLinks(
      input([a], { eligible: (id) => id !== "Book", nearby: (id) => id !== "Far" }),
    );
    expect(pairs(result)).toEqual(["A requires Near (link)"]);
  });

  it("reads a list in a note that is not a concept itself", () => {
    const moc = note("Index", "- [[A]]\n- [[B]]\n- [[C]]");
    const result = suggestLinks(input([moc], { eligible: (id) => id !== "Index" }));
    expect(result.candidates.map((c) => c.from)).toEqual(["B", "C"]);
  });

  it(`stops at ${MAX_SUGGESTIONS} and counts the rest`, () => {
    const notes = Array.from({ length: MAX_SUGGESTIONS + 20 }, (_, i) => note(`N${i}`, `[[T${i}]]`));
    const result = suggestLinks(input(notes));
    expect(result.candidates).toHaveLength(MAX_SUGGESTIONS);
    expect(result.more).toBe(20);
  });
});

describe("choosing suggested links", () => {
  const edge = (from: string, to: string, kind: "requires" | "recommends" = "requires", checked = false) =>
    ({ from, to, kind, origin: "link" as const, checked });

  it("refuses a required link that closes a loop with the map, and says which", () => {
    const graph = new LearningGraph([concept("B", ["C"]), concept("C", ["A"]), concept("A")]);
    const batch = new LinkBatch(graph, [edge("A", "B")]);
    expect(batch.set(0, true, "requires")).toEqual(["A", "B", "C"]);
    expect(batch.rows[0]).toMatchObject({ checked: false, loop: ["A", "B", "C"] });
    expect(batch.chosen).toEqual([]);
  });

  it("lets the same pair through as recommended: soft links may loop", () => {
    const graph = new LearningGraph([concept("B", ["A"]), concept("A")]);
    const batch = new LinkBatch(graph, [edge("A", "B")]);
    expect(batch.set(0, true, "recommends")).toBeNull();
    expect(batch.chosen).toEqual([{ from: "A", to: "B", kind: "recommends" }]);
  });

  it("counts the other chosen links, and frees the pair once they are dropped", () => {
    const batch = new LinkBatch(new LearningGraph([]), [edge("B", "A"), edge("C", "B"), edge("A", "C")]);
    batch.set(0, true, "requires");
    batch.set(1, true, "requires");
    expect(batch.set(2, true, "requires")).toEqual(["A", "C", "B"]);
    batch.set(1, false, "requires");
    expect(batch.set(2, true, "requires")).toBeNull();
    expect(batch.chosen.map((e) => `${e.from}>${e.to}`)).toEqual(["B>A", "A>C"]);
  });

  it("ticks the ticked candidates in order and leaves the one that would loop unticked", () => {
    const moc = suggestLinks(input([note("MOC", "- [[A]]\n- [[B]]\n- [[C]]\n- [[A]]")])).candidates;
    // A, B, C, A: the last step "A requires C" would close A → C → B → A.
    const batch = new LinkBatch(new LearningGraph([]), moc);
    expect(batch.rows.map((row) => [row.from, row.to, row.checked])).toEqual([
      ["B", "A", true],
      ["C", "B", true],
      ["A", "C", false],
    ]);
    expect(batch.rows[2].loop).toEqual(["A", "C", "B"]);
  });

  it("refuses a link of a note to itself", () => {
    expect(new LinkBatch(new LearningGraph([]), [edge("A", "A")]).set(0, true, "requires")).toEqual(["A"]);
  });

  it("ignores materials when looking for a loop", () => {
    const graph = new LearningGraph([concept("B"), source("Book", ["B"]), concept("A")]);
    expect(new LinkBatch(graph, [edge("A", "B")]).set(0, true, "requires")).toBeNull();
  });
});
