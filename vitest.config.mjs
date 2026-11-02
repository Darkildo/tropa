import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Translation files are bundled as text (see esbuild.config.mjs); tests load them the same way.
const PREFIX = "\0locale-text:";

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
      load(id) {
        if (!id.startsWith(PREFIX)) return null;
        return `export default ${JSON.stringify(readFileSync(id.slice(PREFIX.length, -".js".length), "utf8"))};`;
      },
    },
  ],
});
