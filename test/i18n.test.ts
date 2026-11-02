import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { formatMinutes } from "../src/core/format";
import { exampleLang, isPlural, isRtl, locale, resolveLocale, setLocale, t } from "../src/i18n";
import { en } from "../src/i18n/en";
import { LOCALES } from "../src/i18n/locales";

const DIR = "src/i18n/locales";
const files = readdirSync(DIR).filter((name) => name.endsWith(".json"));
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

type Leaf = { path: string; value: unknown };
function leaves(node: unknown, path = ""): Leaf[] {
  if (typeof node === "string" || isPlural(node)) return [{ path, value: node }];
  if (typeof node !== "object" || node === null) return [{ path, value: node }];
  return Object.entries(node).flatMap(([key, value]) => leaves(value, path ? `${path}.${key}` : key));
}
const english = new Map(leaves(en).map(({ path, value }) => [path, value]));

afterEach(() => setLocale("en"));

describe("translation files", () => {
  it("are all registered", () => {
    expect(files.map((name) => name.replace(/\.json$/, "")).sort()).toEqual(Object.keys(LOCALES).sort());
  });

  describe.each(files)("%s", (name) => {
    const code = name.replace(/\.json$/, "");
    const text = readFileSync(`${DIR}/${name}`, "utf8");
    const data: unknown = JSON.parse(text);
    const own = new Map(leaves(data).map(({ path, value }) => [path, value]));

    it("has exactly the English keys", () => {
      expect([...own.keys()].sort()).toEqual([...english.keys()].sort());
    });

    it("keeps placeholders and plural forms", () => {
      const categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
      for (const [path, source] of english) {
        const value = own.get(path);
        if (typeof source === "string") {
          expect(typeof value, path).toBe("string");
          expect(placeholders(value as string), path).toEqual(placeholders(source));
        } else {
          expect(isPlural(value), path).toBe(true);
          const forms = value as Record<string, string>;
          expect(Object.keys(forms).sort(), path).toEqual([...categories].sort());
          // A form may spell the number out ("two concepts"), but must not bring placeholders of its own.
          const allowed = placeholders((source as { other: string }).other);
          expect(placeholders(forms.other), path).toEqual(allowed);
          for (const form of Object.values(forms)) expect(placeholders(form).every((name) => allowed.includes(name)), path).toBe(true);
        }
      }
    });

    it("produces no English leftovers or raw placeholders at runtime", () => {
      setLocale(code);
      expect(locale()).toBe(code);
      expect(t.stepsToGoal({ count: 3 })).not.toMatch(/[{}]/);
      expect(formatMinutes(150)).not.toMatch(/[{}]/);
    });
  });
});

describe("locale choice", () => {
  it("prefers the exact code, then the base language, then English", () => {
    expect(resolveLocale("pt-BR")).toBe("pt-BR");
    expect(resolveLocale("pt-PT")).toBe("pt");
    expect(resolveLocale("zh-TW")).toBe("zh-TW");
    expect(resolveLocale("zh-HK")).toBe("zh");
    expect(resolveLocale("de-AT")).toBe("de");
    expect(resolveLocale("en-GB")).toBe("en");
    expect(resolveLocale("xx")).toBe("en");
  });

  it("keeps the example map in English except for Russian", () => {
    setLocale("ru");
    expect(exampleLang()).toBe("ru");
    setLocale("de");
    expect(exampleLang()).toBe("en");
  });

  it("marks right-to-left languages", () => {
    setLocale("ar");
    expect(isRtl()).toBe(true);
    setLocale("ja");
    expect(isRtl()).toBe(false);
  });
});

describe("messages", () => {
  it("uses CLDR plural forms", () => {
    setLocale("ru");
    expect(t.stepsToGoal({ count: 1 })).toBe("1 шаг до цели");
    expect(t.stepsToGoal({ count: 22 })).toBe("22 шага до цели");
    expect(t.stepsToGoal({ count: 5 })).toBe("5 шагов до цели");
    expect(t.leftToUnlock({ count: 21 })).toBe("До открытия остался 21 концепт.");
    expect(formatMinutes(150)).toBe("2 ч 30 мин");
    setLocale("en");
    expect(t.stepsToGoal({ count: 1 })).toBe("1 step to the goal");
    expect(t.stepsToGoal({ count: 3 })).toBe("3 steps to the goal");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(120)).toBe("2 h");
  });

  it("formats numbers for the locale", () => {
    setLocale("ar");
    const number = new Intl.NumberFormat("ar");
    expect(t.progressOf({ done: 3, total: 17 })).toBe(`${number.format(3)} من ${number.format(17)}`);
    setLocale("de");
    expect(t.materialCount({ count: 1200 })).toContain("1.200");
  });

  it("falls back to English for anything missing", () => {
    setLocale("xx");
    expect(t.mapTitle).toBe(en.mapTitle);
  });
});
