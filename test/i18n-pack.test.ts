import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale, t } from "../src/i18n";
import { en } from "../src/i18n/en";
import { LOCALES } from "../src/i18n/locales";
import { isPlural, unpackLocale } from "../src/i18n/pack";

const DIR = "src/i18n/locales";
const files = readdirSync(DIR).filter((name) => name.endsWith(".json"));

afterEach(() => setLocale("en"));

const RTL = new Set(["ar", "fa", "he"]);
const PARAMS = { name: "N", title: "T", names: "A, B", folder: "F", total: 17, done: 2 };

/** What each message must read, worked out from the source file alone, against what the plugin shows. */
function compare(code: string, base: Record<string, unknown>, source: Record<string, unknown>, live: Record<string, unknown>, path = "") {
  const numbers = new Intl.NumberFormat(code);
  const rules = new Intl.PluralRules(code);
  const fill = (template: string, params: Record<string, string | number>) =>
    template.replace(/\{(\w+)\}/g, (match, key: string) => {
      const value = params[key];
      if (value === undefined) return match;
      if (typeof value === "number") return numbers.format(value);
      return RTL.has(code) ? `\u2068${value}\u2069` : value;
    });
  let checked = 0;
  for (const [key, value] of Object.entries(base)) {
    const at = path ? `${path}.${key}` : key;
    const mine = source[key];
    const message = live[key];
    if (typeof value === "string") {
      const template = mine as string;
      if (typeof message === "string") expect(message, at).toBe(template);
      else expect((message as (p: unknown) => string)(PARAMS), at).toBe(fill(template, PARAMS));
      checked++;
    } else if (isPlural(value)) {
      const forms = mine as Record<string, string>;
      for (const count of [0, 1, 2, 3, 5, 11, 21, 102, 1.5]) {
        const params = { ...PARAMS, count };
        expect((message as (p: unknown) => string)(params), `${at} (${count})`).toBe(fill(forms[rules.select(count)] ?? forms.other, params));
      }
      checked++;
    } else {
      checked += compare(code, value as Record<string, unknown>, mine as Record<string, unknown>, message as Record<string, unknown>, at);
    }
  }
  return checked;
}

describe("packed translations", () => {
  describe.each(files)("%s", (name) => {
    const code = name.replace(/\.json$/, "");
    const source: unknown = JSON.parse(readFileSync(`${DIR}/${name}`, "utf8"));

    it("unpack to exactly the source file", () => {
      expect(unpackLocale(LOCALES[code], en)).toEqual(source);
    });

    it("give the same messages as the source file", () => {
      setLocale(code);
      expect(compare(code, en, source as Record<string, unknown>, t as unknown as Record<string, unknown>)).toBeGreaterThan(100);
    });
  });

  it("are smaller than the files and stay readable text", () => {
    const plain = files.reduce((sum, name) => sum + Buffer.byteLength(JSON.stringify(JSON.parse(readFileSync(`${DIR}/${name}`, "utf8")))), 0);
    const packed = Object.values(LOCALES).reduce((sum, text) => sum + Buffer.byteLength(text), 0);
    expect(packed).toBeLessThan(plain * 0.85);
    expect(LOCALES.ru).toContain("Карта обучения");
  });

  it("fall back to English when a packed file is broken", () => {
    const saved = LOCALES.de;
    LOCALES.de = "{not json";
    try {
      setLocale("de");
      expect(t.mapTitle).toBe(en.mapTitle);
    } finally {
      LOCALES.de = saved;
    }
  });
});
