import { describe, expect, it } from "vitest";
import { sample } from "../src/sample";

describe.each(["en", "ru"] as const)("sample map (%s)", (language) => {
  const example = sample(language);
  const titles = new Set(example.files.map((file) => file.path.split("/").pop()!.replace(/\.md$/, "")));

  it("links only to notes of the same map", () => {
    const links = example.files.flatMap((file) => [...file.content.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1]));
    expect(links.length).toBeGreaterThan(30);
    expect(links.filter((link) => !titles.has(link))).toEqual([]);
  });

  it("keeps everything under one folder", () => {
    expect(example.files.every((file) => file.path.startsWith(`${example.folder}/`))).toBe(true);
    expect(titles.has(example.goal.split("/").pop()!)).toBe(true);
  });
});
