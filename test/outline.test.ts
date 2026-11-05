import { describe, expect, it } from "vitest";
import { LinkBatch } from "../src/core/batch-links";
import { safeFileName } from "../src/core/format";
import { LearningGraph } from "../src/core/graph";
import { parseOutline, planOutline, type OutlineHost, type OutlineItem, type OutlineOptions } from "../src/core/outline";
import type { NoteInput, NoteRef } from "../src/core/types";

/** Each item as "parent > title", or the title alone at the top. */
const tree = (items: OutlineItem[]) => items.map((item) => (item.parent < 0 ? item.title : `${items[item.parent].title} > ${item.title}`));

describe("parseOutline", () => {
  it("nests a Markdown list by indent, with mixed markers, tabs and tasks", () => {
    const items = parseOutline(["- Machine learning", "  * Linear algebra", "\t+ Vectors", "  1. Probability", "    - [ ] Bayes' theorem", "- Deep learning"].join("\n"));
    expect(tree(items)).toEqual([
      "Machine learning",
      "Machine learning > Linear algebra",
      "Linear algebra > Vectors",
      "Machine learning > Probability",
      "Probability > Bayes' theorem",
      "Deep learning",
    ]);
  });

  it("nests headings by level and lists under the last heading", () => {
    const items = parseOutline(["# Calculus", "## Limits", "- Epsilon-delta", "- One-sided limits", "## Derivatives ##", "### Chain rule", "# Algebra"].join("\n"));
    expect(tree(items)).toEqual([
      "Calculus",
      "Calculus > Limits",
      "Limits > Epsilon-delta",
      "Limits > One-sided limits",
      "Calculus > Derivatives",
      "Derivatives > Chain rule",
      "Algebra",
    ]);
  });

  it("reads a table of contents: numbers nest by their parts, page numbers go", () => {
    const text = [
      "Preface ........ xi",
      "1 Introduction 1",
      "1.1 What is learning? ..... 3",
      "1.2 Overfitting\t12",
      "1.2.1 Regularization   15",
      "2. Linear models 21",
      "2.1 Least squares 23",
      "Index ......... 301",
    ].join("\n");
    expect(tree(parseOutline(text))).toEqual([
      "Preface",
      "Introduction",
      "Introduction > What is learning?",
      "Introduction > Overfitting",
      "Overfitting > Regularization",
      "Linear models",
      "Linear models > Least squares",
      "Index",
    ]);
  });

  it("keeps a numbered list a list when nothing is numbered like 1.2", () => {
    const items = parseOutline(["1. Sets", "2. Functions", "   1. Injective", "3 musketeers"].join("\n"));
    expect(tree(items)).toEqual(["Sets", "Functions", "Functions > Injective", "3 musketeers"]);
  });

  it("cleans titles: links, aliases, emphasis, code and a trailing colon", () => {
    const items = parseOutline(["- [[Gradient descent]]", "- [[Backprop|Backpropagation]]:", "- **Loss** functions and `softmax`", "- [Attention](https://example.com) _heads_", "- ![[diagram.png]] Diagrams"].join("\n"));
    expect(items.map((item) => item.title)).toEqual(["Gradient descent", "Backpropagation", "Loss functions and softmax", "Attention heads", "diagram.png Diagrams"]);
    expect(items.map((item) => item.link)).toEqual(["Gradient descent", "Backprop", undefined, undefined, "diagram.png"]);
  });

  it("skips blank lines, rules, quotes and code blocks", () => {
    const items = parseOutline(["- A", "", "---", "> a quote", "```", "- not an item", "```", "- B"].join("\n"));
    expect(items.map((item) => item.title)).toEqual(["A", "B"]);
  });

  it("reads right-to-left text and Windows line ends", () => {
    const items = parseOutline("- التعلم الآلي\r\n  - الجبر الخطي\r\n  - الاحتمالات\r\n");
    expect(tree(items)).toEqual(["التعلم الآلي", "التعلم الآلي > الجبر الخطي", "التعلم الآلي > الاحتمالات"]);
  });
});

const ref = (id: string): NoteRef => ({ id, title: id });
const concept = (id: string, requires: string[] = []): NoteInput => ({ id, title: id, kind: "concept", requires: requires.map(ref), recommends: [], teaches: [] });

/** A vault with these notes, new notes going to `New/`. */
function host(graph: LearningGraph, files: string[] = []): OutlineHost {
  const byName = new Map(files.map((path) => [path.split("/").pop()!.replace(/\.md$/, "").toLowerCase(), path]));
  return {
    graph,
    fileName: (title) => safeFileName(title),
    find: (title, link) => byName.get((link ?? title).toLowerCase()) ?? null,
    newPath: (title, taken) => {
      let path = `New/${safeFileName(title)}.md`;
      for (let i = 2; taken.has(path) || files.includes(path); i++) path = `New/${safeFileName(title)} ${i}.md`;
      return path;
    },
  };
}

const parts: OutlineOptions = { order: "parts", chain: false };
const links = (plan: ReturnType<typeof planOutline>) => plan.candidates.map((c) => `${c.from} -> ${c.to} ${c.origin}${c.checked ? "" : " (off)"}`);

describe("planOutline", () => {
  const items = parseOutline(["- ML", "  - Algebra", "  - Probability", "  - Statistics"].join("\n"));

  it("a topic needs its parts, and neighbours are offered unticked", () => {
    const plan = planOutline(items, parts, host(new LearningGraph([])));
    expect(plan.notes.map((note) => note.path)).toEqual(["New/ML.md", "New/Algebra.md", "New/Probability.md", "New/Statistics.md"]);
    expect(links(plan)).toEqual([
      "New/ML.md -> New/Algebra.md nest",
      "New/ML.md -> New/Probability.md nest",
      "New/ML.md -> New/Statistics.md nest",
      "New/Probability.md -> New/Algebra.md order (off)",
      "New/Statistics.md -> New/Probability.md order (off)",
    ]);
  });

  it("the other way round, parts need their topic, and the chain is ticked when asked", () => {
    const plan = planOutline(items, { order: "topic", chain: true }, host(new LearningGraph([])));
    expect(links(plan)).toEqual([
      "New/Algebra.md -> New/ML.md nest",
      "New/Probability.md -> New/ML.md nest",
      "New/Statistics.md -> New/ML.md nest",
      "New/Probability.md -> New/Algebra.md order",
      "New/Statistics.md -> New/Probability.md order",
    ]);
  });

  it("matches notes in the vault, merges repeated names and leaves out pairs the map has", () => {
    const graph = new LearningGraph([concept("Old/Algebra.md"), concept("Old/ML.md", ["Old/Algebra.md"])]);
    const outline = parseOutline(["- ML", "  - algebra", "  - Probability", "- Probability", "  - [[ML]]"].join("\n"));
    const plan = planOutline(outline, parts, host(graph, ["Old/Algebra.md", "Old/ML.md"]));
    expect(plan.notes.map((note) => `${note.path}${note.existing ? " (existing)" : ""}`)).toEqual(["Old/ML.md (existing)", "Old/Algebra.md (existing)", "New/Probability.md"]);
    // ML already needs Algebra; Probability under ML and ML under Probability are one pair, offered once.
    expect(links(plan)).toEqual(["Old/ML.md -> New/Probability.md nest", "New/Probability.md -> Old/Algebra.md order (off)"]);
  });

  it("names a file without the characters a file name cannot have", () => {
    const plan = planOutline(parseOutline("- C++: templates?\n- Plain"), parts, host(new LearningGraph([])));
    expect(plan.notes.map((note) => [note.path, note.renamed])).toEqual([["New/C++ templates.md", true], ["New/Plain.md", false]]);
  });

  it("two titles with one file name get two files", () => {
    const plan = planOutline(parseOutline("- A/B\n- A:B"), parts, host(new LearningGraph([])));
    expect(plan.notes.map((note) => note.path)).toEqual(["New/A B.md", "New/A B 2.md"]);
  });

  it("a loop with the map is refused in the batch", () => {
    // The map says ML needs Algebra.
    const graph = new LearningGraph([concept("Old/ML.md", ["Old/Algebra.md"]), concept("Old/Algebra.md")]);
    const plan = planOutline(parseOutline("- ML\n  - Algebra"), parts, host(graph, ["Old/Algebra.md", "Old/ML.md"]));
    expect(links(plan)).toEqual([]);
    const loopy = planOutline(parseOutline("- Algebra\n  - Calculus\n    - ML"), parts, host(graph, ["Old/Algebra.md", "Old/ML.md"]));
    const batch = new LinkBatch(graph, loopy.candidates);
    expect(batch.rows.map((row) => [row.from, row.to, row.checked])).toEqual([
      ["Old/Algebra.md", "New/Calculus.md", true],
      ["New/Calculus.md", "Old/ML.md", false],
    ]);
    expect(batch.loop("New/Calculus.md", "Old/ML.md")).toEqual(["New/Calculus.md", "Old/ML.md", "Old/Algebra.md"]);
  });
});
