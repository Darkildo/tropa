import { describe, expect, it } from "vitest";
import { formatMinutes } from "../src/core/format";
import { lang, setLang, t } from "../src/i18n";
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

describe("i18n", () => {
  it("switches the live dictionary", () => {
    setLang("ru");
    expect(lang()).toBe("ru");
    expect(t.stepsToGoal(5)).toBe("5 шагов до цели");
    expect(t.stepsToGoal(22)).toBe("22 шага до цели");
    expect(formatMinutes(150)).toBe("2 ч 30 мин");
    setLang("en");
    expect(t.stepsToGoal(1)).toBe("1 step to the goal");
    expect(t.stepsToGoal(3)).toBe("3 steps to the goal");
    expect(formatMinutes(45)).toBe("45 min");
  });
});
