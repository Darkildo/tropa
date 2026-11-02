import { readFile } from "node:fs/promises";

// Translation files go into the bundle as compact JSON text; only the active one is parsed at runtime.
export const localesAsText = {
  name: "locales-as-text",
  setup(build) {
    build.onLoad({ filter: /[\\/]i18n[\\/]locales[\\/][^\\/]+\.json$/ }, async ({ path }) => ({
      contents: JSON.stringify(JSON.parse(await readFile(path, "utf8"))),
      loader: "text",
    }));
  },
};
