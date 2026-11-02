import { describe, expect, it } from "vitest";
import { computeRoute, computeStates, emptyProgress, LearningGraph } from "../src/core/graph";
import { hasTag, inFolders, isExcluded, parseFolders, parseTags } from "../src/core/scope";
import type { NoteInput, NoteRef } from "../src/core/types";

describe("reading the scope settings", () => {
  it("takes one folder per line and keeps commas in names", () => {
    expect(parseFolders(" Archive/ \n\n/Templates\nNotes, old\nArchive")).toEqual(["Archive", "Templates", "Notes, old"]);
  });

  it("normalizes slashes and ignores the vault root", () => {
    expect(parseFolders("a\\b//c/\n/\n  ")).toEqual(["a/b/c"]);
  });

  it("splits tags by lines, spaces and commas, drops # and case", () => {
    expect(parseTags("#Draft, private\n##Old/  #draft")).toEqual(["draft", "private", "old"]);
  });

  it("accepts lists from hand-edited data", () => {
    expect(parseFolders(["Archive", " "])).toEqual(["Archive"]);
    expect(parseTags(["#A", "b"])).toEqual(["a", "b"]);
    expect(parseFolders(undefined)).toEqual([]);
  });
});

describe("matching notes", () => {
  it("covers a folder and everything below it, segment by segment", () => {
    const folders = ["Archive", "Work/Old"];
    expect(inFolders("Archive/Note.md", folders)).toBe(true);
    expect(inFolders("Archive/2024/Note.md", folders)).toBe(true);
    expect(inFolders("Archive 2/Note.md", folders)).toBe(false);
    expect(inFolders("Work/Older/Note.md", folders)).toBe(false);
    expect(inFolders("Work/Old/Note.md", folders)).toBe(true);
    expect(inFolders("archive/Note.md", folders)).toBe(false);
  });

  it("covers nested tags and ignores case", () => {
    expect(hasTag(["#Draft/Old"], ["draft"])).toBe(true);
    expect(hasTag(["#drafts"], ["draft"])).toBe(false);
    expect(hasTag(["#topic/draft"], ["draft"])).toBe(false);
  });

  it("excludes by folder or by tag", () => {
    const scope = { folders: ["Archive"], tags: ["private"] };
    expect(isExcluded("Archive/a.md", [], scope)).toBe(true);
    expect(isExcluded("Notes/a.md", ["#private"], scope)).toBe(true);
    expect(isExcluded("Notes/a.md", ["#public"], scope)).toBe(false);
    expect(isExcluded("Notes/a.md", [], { folders: [], tags: [] })).toBe(false);
  });
});

describe("links to excluded notes", () => {
  const ref = (id: string): NoteRef => ({ id, title: id });
  const excluded: NoteRef = { id: "ghost:Old basics", title: "Old basics", excluded: "Archive/Old basics.md" };
  const notes: NoteInput[] = [
    { id: "Goal", title: "Goal", kind: "concept", requires: [excluded, ref("Base")], recommends: [], teaches: [] },
    { id: "Base", title: "Base", kind: "concept", requires: [], recommends: [], teaches: [] },
  ];

  it("become placeholders that remember the note", () => {
    const graph = new LearningGraph(notes);
    const node = graph.nodes.get("ghost:Old basics")!;
    expect(node.ghost).toBe(true);
    expect(node.excluded).toBe("Archive/Old basics.md");
    expect(graph.nodes.get("Base")?.excluded).toBeUndefined();
  });

  it("block the route like any placeholder until marked", () => {
    const graph = new LearningGraph(notes);
    const progress = { ...emptyProgress(), goal: "Goal" };
    const states = computeStates(graph, progress);
    expect(states.get("ghost:Old basics")).toBe("available");
    expect(computeRoute(graph, progress, states)?.steps.map((step) => step.id)).toEqual(expect.arrayContaining(["ghost:Old basics", "Base", "Goal"]));
  });
});
