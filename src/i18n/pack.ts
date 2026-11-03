// Translation files travel in main.js packed by locales.esbuild.mjs: as a JSON array of their values
// in the order of the English keys, so the keys are not repeated in every language. This turns one back.

const CATEGORIES = new Set<string>(["zero", "one", "two", "few", "many", "other"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Plural forms: only CLDR category keys, `other` included. Groups such as `format` have other keys too. */
export function isPlural(value: unknown): value is Record<string, string> {
  return isRecord(value) && typeof value.other === "string" && Object.keys(value).every((key) => CATEGORIES.has(key));
}

/** The translation as nested objects again, shaped by the English strings. */
export function unpackLocale(packed: string, en: Record<string, unknown>): Record<string, unknown> | undefined {
  return unflatten(JSON.parse(packed), en);
}

function unflatten(values: unknown, base: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!Array.isArray(values)) return undefined;
  const out: Record<string, unknown> = {};
  Object.entries(base).forEach(([key, value], index) => {
    const item: unknown = values[index];
    if (item === null || item === undefined) return;
    if (typeof value === "string" || isPlural(value)) out[key] = item;
    else if (isRecord(value)) {
      const nested = unflatten(item, value);
      if (nested) out[key] = nested;
    }
  });
  return out;
}
