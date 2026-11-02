import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { computeRoute, computeStates, emptyProgress, LearningGraph, recommendMaterial, sourceState } from "../src/core/graph";
import { entryFormat, materialId, normalizeUrl, parseMaterials, urlTitle } from "../src/core/materials";
import { readProgress, writeProgress } from "../src/core/progress";
import type { InlineMaterial, NoteInput, NoteRef, Progress } from "../src/core/types";

const ref = (id: string): NoteRef => ({ id, title: id });
const concept = (id: string, requires: string[] = [], materials: InlineMaterial[] = []): NoteInput => ({
  id, title: id, kind: "concept", requires: requires.map(ref), recommends: [], teaches: [], materials,
});
const source = (id: string, teaches: string[], url?: string, minutes?: number): NoteInput => ({
  id, title: id, kind: "source", requires: [], recommends: [], teaches: teaches.map(ref), url, minutes,
});
const link = (url: string, minutes?: number, title = url): InlineMaterial => ({
  id: materialId(normalizeUrl(url)), title, url, format: "article", minutes,
});
const attachment = (path: string, minutes?: number): InlineMaterial => ({
  id: materialId(path), title: path, file: path, format: "paper", minutes,
});
const progress = (over: Partial<Progress> = {}): Progress => ({ ...emptyProgress(), ...over });

describe("parsing a concept's materials", () => {
  it("reads links, attachments, markdown links and objects", () => {
    expect(
      parseMaterials([
        "https://example.com/a",
        "[[Deep Learning.pdf]]",
        "[Illustrated Transformer](https://jalammar.github.io/illustrated-transformer/)",
        { url: "https://youtu.be/x", title: "Lecture", format: "video", minutes: "45" },
        { file: "[[notes/scan.pdf|Scan]]", minutes: 20 },
      ]),
    ).toEqual([
      { url: "https://example.com/a" },
      { link: "Deep Learning.pdf" },
      { url: "https://jalammar.github.io/illustrated-transformer/", title: "Illustrated Transformer" },
      { url: "https://youtu.be/x", title: "Lecture", format: "video", minutes: 45 },
      { link: "notes/scan.pdf", title: undefined, format: undefined, minutes: 20 },
    ]);
  });

  it("accepts a single value and ignores what is not a link", () => {
    expect(parseMaterials("https://example.com")).toEqual([{ url: "https://example.com" }]);
    expect(parseMaterials(["just text", 42, null, { title: "no link" }, { url: "https://a.b", format: "podcast" }])).toEqual([
      { url: "https://a.b", title: undefined, format: undefined, minutes: undefined },
    ]);
    expect(parseMaterials(undefined)).toEqual([]);
  });

  it("guesses the format from the link when none is given", () => {
    expect(entryFormat({ url: "https://www.youtube.com/watch?v=1" })).toBe("video");
    expect(entryFormat({ link: "book.epub" })).toBe("book");
    expect(entryFormat({ link: "scan" }, "Files/scan.pdf")).toBe("paper");
    expect(entryFormat({ url: "https://example.com", format: "course" })).toBe("course");
  });
});

describe("normalizing links", () => {
  it("gives one key to the same page written two ways", () => {
    expect(normalizeUrl("HTTPS://Example.COM/guide/")).toBe(normalizeUrl("https://example.com/guide"));
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeUrl("https://example.com/a?b=1#c")).toBe("https://example.com/a?b=1#c");
    expect(normalizeUrl("  not a url ")).toBe("not a url");
  });

  it("names a bare link by its host and path", () => {
    expect(urlTitle("https://www.example.com/guide/intro/")).toBe("example.com/guide/intro");
    expect(urlTitle("https://example.com/")).toBe("example.com");
  });
});

describe("materials inside a concept", () => {
  it("become materials of that concept and count in the route time", () => {
    const g = new LearningGraph([concept("a", [], [link("https://a.dev", 30)]), concept("goal", ["a"], [attachment("goal.pdf", 90)])]);
    const a = g.nodes.get("a")!;
    expect(a.taughtBy).toEqual([materialId("https://a.dev")]);
    expect(g.nodes.get(materialId("https://a.dev"))).toMatchObject({ kind: "source", inline: true, teaches: ["a"], minutes: 30 });
    expect(g.nodes.get(materialId("goal.pdf"))).toMatchObject({ inline: true, file: "goal.pdf" });

    const p = progress({ goal: "goal" });
    const route = computeRoute(g, p, computeStates(g, p))!;
    expect(route.remainingMinutes).toBe(120);
    expect(route.gaps).toEqual([]);
  });

  it("are one node when several concepts list the same link", () => {
    const g = new LearningGraph([
      concept("a", [], [link("https://book.dev/", undefined, "Book")]),
      concept("b", [], [link("https://BOOK.dev", 600, "Other title")]),
    ]);
    const id = materialId("https://book.dev");
    expect(g.sources.map((node) => node.id)).toEqual([id]);
    expect(g.nodes.get(id)).toMatchObject({ title: "Book", teaches: ["a", "b"], minutes: 600 });
  });

  it("show the material note instead when it has the same link", () => {
    const g = new LearningGraph([
      source("Notes/Book.md", [], "https://book.dev/", 300),
      concept("a", [], [link("https://book.dev")]),
    ]);
    expect(g.sources.map((node) => node.id)).toEqual(["Notes/Book.md"]);
    expect(g.nodes.get("a")!.taughtBy).toEqual(["Notes/Book.md"]);
    expect(g.nodes.get("Notes/Book.md")!.teaches).toEqual(["a"]);
  });

  it("show the material note instead when they link to it", () => {
    const g = new LearningGraph([source("Notes/Book.md", []), concept("a", [], [attachment("Notes/Book.md")])]);
    expect(g.sources.map((node) => node.id)).toEqual(["Notes/Book.md"]);
    expect(g.nodes.get("a")!.taughtBy).toEqual(["Notes/Book.md"]);
  });

  it("are ready from the start and done once ticked", () => {
    const g = new LearningGraph([concept("a", [], [link("https://a.dev"), link("https://b.dev", 5)])]);
    expect(sourceState(g, progress(), materialId("https://a.dev"))).toBe("ready");
    expect(recommendMaterial(g, progress(), "a")).toBe(materialId("https://b.dev"));
    const done = progress({ done: new Set([materialId("https://b.dev")]) });
    expect(sourceState(g, done, materialId("https://b.dev"))).toBe("done");
    expect(computeStates(g, done).get("a")).toBe("learning");
  });
});

describe("finished inline materials in the progress file", () => {
  const resolve = (target: string) => target;

  it("go to their own list and only when there is something to write", () => {
    const frontmatter: Record<string, unknown> = {};
    writeProgress(frontmatter, progress({ done: new Set(["Notes/Book.md"]) }), (id) => `[[${id}]]`);
    expect(frontmatter.done).toEqual(["[[Notes/Book.md]]"]);
    expect("done-materials" in frontmatter).toBe(false);

    const both = progress({ done: new Set(["Notes/Book.md", materialId("https://a.dev"), materialId("Files/scan.pdf")]) });
    writeProgress(frontmatter, both, (id) => `[[${id}]]`, (id) => (id.endsWith(".pdf") ? "[[scan.pdf]]" : id.slice("material:".length)));
    expect(frontmatter.done).toEqual(["[[Notes/Book.md]]"]);
    expect(frontmatter["done-materials"]).toEqual(["https://a.dev", "[[scan.pdf]]"]);

    writeProgress(frontmatter, progress(), (id) => `[[${id}]]`);
    expect("done-materials" in frontmatter).toBe(false);
  });

  it("read back through YAML, and older files read as they are", () => {
    const written: Record<string, unknown> = { goal: null };
    writeProgress(written, progress({ done: new Set(["n.md", materialId("https://a.dev/x")]) }), (id) => `[[${id}]]`);
    const back = readProgress(parse(stringify(written)) as Record<string, unknown>, (target) => target.replace(/^\[\[|\]\]$/g, ""));
    expect([...back.done].sort()).toEqual(["n.md", materialId("https://a.dev/x")].sort());

    const old = readProgress({ type: "learning-progress", done: ["[[n.md]]"], mastered: [] }, resolve);
    expect([...old.done]).toEqual(["n.md"]);
  });

  it("key a URL the way the graph does and resolve attachments through the host", () => {
    const p = readProgress({ "done-materials": ["HTTPS://A.dev/x/", "[[scan.pdf]]", "", 3] }, resolve, (value) =>
      value.startsWith("[[") ? materialId("Files/scan.pdf") : materialId(normalizeUrl(value)),
    );
    expect([...p.done]).toEqual([materialId("https://a.dev/x"), materialId("Files/scan.pdf")]);
  });
});
