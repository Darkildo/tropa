import { describe, expect, it } from "vitest";
import { computeRoute, computeStates, emptyProgress, LearningGraph } from "../src/core/graph";
import { readProgress, writeProgress } from "../src/core/progress";
import { hasTag, inFolders, isExcluded, parseFolders, parseTags } from "../src/core/scope";
import type { NoteInput } from "../src/core/types";

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
  // The store drops a link to an excluded note before the graph is built: here Archive/Old basics.md is excluded.
  const goal = (requires: string[]): NoteInput => ({
    id: "Goal", title: "Goal", kind: "concept", requires: requires.map((id) => ({ id, title: id })), recommends: [], teaches: [],
  });
  const base: NoteInput = { id: "Base", title: "Base", kind: "concept", requires: [], recommends: [], teaches: [] };
  const scoped = new LearningGraph([goal(["Base"]), base]);

  it("leave no node and no step on the route", () => {
    expect([...scoped.nodes.keys()].sort()).toEqual(["Base", "Goal"]);
    const progress = { ...emptyProgress(), goal: "Goal" };
    const route = computeRoute(scoped, progress, computeStates(scoped, progress));
    expect(route?.steps.map((step) => step.id)).toEqual(["Base", "Goal"]);
  });

  it("do not block what depended on the excluded note", () => {
    const progress = { ...emptyProgress(), goal: "Goal", mastered: new Set(["Base"]) };
    expect(computeStates(scoped, progress).get("Goal")).toBe("available");
  });

  it("keep their marks in the progress file", () => {
    const frontmatter = { type: "learning-progress", goal: "[[Goal]]", mastered: ["[[Archive/Old basics]]", "[[Base]]"] };
    const progress = readProgress(frontmatter, (target) => (target === "Archive/Old basics" ? "Archive/Old basics.md" : target));
    progress.mastered.add("Goal");
    computeStates(scoped, progress);
    const written: Record<string, unknown> = { ...frontmatter };
    writeProgress(written, progress, (id) => `[[${id.replace(/\.md$/, "")}]]`);
    expect(written.mastered).toEqual(["[[Archive/Old basics]]", "[[Base]]", "[[Goal]]"]);
  });
});
