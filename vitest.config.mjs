import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { EN_PATH, loadEnglish, packLocale } from "./locales.esbuild.mjs";

// Translation files are bundled packed (see locales.esbuild.mjs); tests load them the same way.
const PREFIX = "\0locale-text:";
let english;

export default defineConfig({
  plugins: [
    {
      name: "locale-text",
      enforce: "pre",
      async resolveId(source, importer) {
        if (!importer || !source.endsWith(".json") || !importer.includes("/i18n/locales/")) return null;
        const resolved = await this.resolve(source, importer, { skipSelf: true });
        // The .js suffix keeps Vite's own JSON plugin away from the id.
        return resolved ? `${PREFIX}${resolved.id}.js` : null;
      },
      async load(id) {
        if (!id.startsWith(PREFIX)) return null;
        this.addWatchFile(EN_PATH);
        const json = readFileSync(id.slice(PREFIX.length, -".js".length), "utf8");
        return `export default ${JSON.stringify(packLocale(json, await (english ??= loadEnglish())))};`;
      },
    },
  ],
});
