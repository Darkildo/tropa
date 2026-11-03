import esbuild from "esbuild";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Translation files go into the bundle as JSON text of their values in the order of the English keys,
// so the keys are not repeated in every language. src/i18n/pack.ts turns the active one back into
// nested objects at runtime; the files in src/i18n/locales stay ordinary JSON.

export const EN_PATH = resolve("src/i18n/en.ts");
const CATEGORIES = new Set(["zero", "one", "two", "few", "many", "other"]);

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isPlural = (value) => isRecord(value) && typeof value.other === "string" && Object.keys(value).every((key) => CATEGORIES.has(key));

/** The English strings, read from en.ts as they are now. */
export async function loadEnglish() {
  const result = await esbuild.build({ entryPoints: [EN_PATH], bundle: true, format: "esm", write: false, logLevel: "warning" });
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  return module.en;
}

/** The values of a translation in the order of the English keys; null where it has nothing. */
export function flattenLocale(local, base) {
  return Object.entries(base).map(([key, value]) => {
    const mine = isRecord(local) ? local[key] : undefined;
    if (typeof value === "string" || isPlural(value)) return mine === undefined ? null : mine;
    return isRecord(value) && isRecord(mine) ? flattenLocale(mine, value) : null;
  });
}

export function packLocale(json, en) {
  return JSON.stringify(flattenLocale(JSON.parse(json), en));
}

export const localesAsText = {
  name: "locales-as-text",
  setup(build) {
    let english;
    build.onStart(() => {
      english = undefined;
    });
    build.onLoad({ filter: /[\\/]i18n[\\/]locales[\\/][^\\/]+\.json$/ }, async ({ path }) => {
      english ??= loadEnglish();
      return { contents: packLocale(await readFile(path, "utf8"), await english), loader: "text", watchFiles: [EN_PATH] };
    });
  },
};
