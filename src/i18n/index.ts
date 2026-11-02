import { en } from "./en";
import { LOCALES } from "./locales";

/** Languages of the example map and default paths. Other interface languages use the English ones. */
export type Lang = "en" | "ru";

type Placeholders<S> = S extends `${string}{${infer P}}${infer R}` ? P | Placeholders<R> : never;
type Params<S> = { [P in Placeholders<S>]: string | number };
type Category = Intl.LDMLPluralRule;
type Compiled<M> = M extends string
  ? [Placeholders<M>] extends [never]
    ? string
    : (params: Params<M>) => string
  : M extends { readonly other: string }
    ? [Exclude<keyof M, Category>] extends [never]
      ? (params: Params<M["other"]> & { count: number }) => string
      : { [K in keyof M]: Compiled<M[K]> }
    : { [K in keyof M]: Compiled<M[K]> };

export type Strings = Compiled<typeof en>;

const RTL = new Set(["ar", "fa", "he", "ur", "dv"]);
const CATEGORIES = new Set<string>(["zero", "one", "two", "few", "many", "other"]);
const PLACEHOLDER = /\{(\w+)\}/g;

let current = "en";

/** Live dictionary: the views read it on every render. */
export const t = compile("en");

/** Active locale code, as returned by getLanguage(). */
export function locale() {
  return current;
}

export function exampleLang(): Lang {
  return baseOf(current) === "ru" ? "ru" : "en";
}

export function isRtl() {
  return RTL.has(baseOf(current));
}

/** Exact code, then the base language (pt-BR → pt), then English. */
export function resolveLocale(code: string) {
  const known = Object.keys(LOCALES);
  const exact = known.find((key) => key.toLowerCase() === code.toLowerCase());
  if (exact) return exact;
  const base = known.find((key) => key === baseOf(code));
  return base ?? "en";
}

export function setLocale(code: string) {
  current = resolveLocale(code);
  Object.assign(t, compile(current));
}

function baseOf(code: string) {
  return code.split(/[-_]/)[0].toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Plural forms: only CLDR category keys, `other` included. Groups such as `format` have other keys too. */
export function isPlural(value: unknown): value is Record<string, string> {
  return isRecord(value) && typeof value.other === "string" && Object.keys(value).every((key) => CATEGORIES.has(key));
}

/** Only the active language is parsed. Anything missing or malformed falls back to English. */
function compile(code: string): Strings {
  const raw = code === "en" ? null : LOCALES[code];
  let own: unknown = null;
  try {
    own = raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error(`Tropa: broken translation file ${code}.json`, error);
  }
  const numbers = new Intl.NumberFormat(code);
  // Note titles are often Latin: in a right-to-left sentence they are isolated so punctuation stays in place.
  const isolate = RTL.has(baseOf(code)) ? (text: string) => `\u2068${text}\u2069` : (text: string) => text;
  const fill = (template: string, params: Record<string, string | number>) =>
    template.replace(PLACEHOLDER, (match, name: string) => {
      const value = params[name];
      if (value === undefined) return match;
      return typeof value === "number" ? numbers.format(value) : isolate(value);
    });
  const rules = { own: new Intl.PluralRules(code), en: new Intl.PluralRules("en") };

  const build = (base: Record<string, unknown>, local: unknown): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(base)) {
      const mine = isRecord(local) ? local[key] : undefined;
      if (typeof value === "string") {
        const template = typeof mine === "string" ? mine : value;
        out[key] = value.match(PLACEHOLDER) ? (params: Record<string, string | number>) => fill(template, params) : template;
      } else if (isPlural(value)) {
        const forms = isPlural(mine) ? mine : value;
        const pick = isPlural(mine) ? rules.own : rules.en;
        out[key] = (params: Record<string, string | number> & { count: number }) => fill(forms[pick.select(params.count)] ?? forms.other, params);
      } else if (isRecord(value)) {
        out[key] = build(value, mine);
      }
    }
    return out;
  };
  return build(en, own) as Strings;
}
