// Checks that the translations packed into main.js are exactly src/i18n/locales/*.json:
// every base64 string in main.js that unpacks to a translation must match one of the files, and every file must be there.
// Usage: npm run build && npm run locales:check [-- path/to/main.js]
import { readFileSync, readdirSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { flattenLocale, loadEnglish } from "../locales.esbuild.mjs";

const bundle = readFileSync(process.argv[2] ?? "main.js", "utf8");
const en = await loadEnglish();
const dir = "src/i18n/locales";
const expected = new Map(
  readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [JSON.stringify(flattenLocale(JSON.parse(readFileSync(`${dir}/${name}`, "utf8")), en)), name]),
);

const found = new Set();
const strange = [];
for (const [, text] of bundle.matchAll(/["'`]([A-Za-z0-9+/]{64,}={0,2})["'`]/g)) {
  // The layout engine's WebAssembly (see "For reviewers of the community catalog" in the README).
  if (text.startsWith("AGFzbQ")) continue;
  let unpacked;
  try {
    unpacked = inflateRawSync(Buffer.from(text, "base64")).toString("utf8");
  } catch {
    strange.push(text.slice(0, 24));
    continue;
  }
  const name = expected.get(unpacked);
  if (name) found.add(name);
  else strange.push(text.slice(0, 24));
}

const missing = [...expected.values()].filter((name) => !found.has(name));
console.log(`${found.size} of ${expected.size} translation files found in the bundle, packed exactly as in ${dir}.`);
if (missing.length) console.error(`Missing: ${missing.join(", ")}`);
if (strange.length) console.error(`Base64 strings that are not a translation file: ${strange.join(", ")}`);
if (missing.length || strange.length) process.exit(1);
