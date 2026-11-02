import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
  // harness is a mock of the Obsidian API for browser checks, not plugin code.
  globalIgnores(["node_modules", "dist", "main.js", "harness", "*.mjs", "bench/*.mjs"]),
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Tests, the benchmark and the demo vault script run in Node, outside Obsidian, so they use Node APIs and the default config folder.
    files: ["scripts/**", "test/**", "bench/**"],
    languageOptions: { globals: globals.node },
    rules: {
      "obsidianmd/no-nodejs-modules": "off",
      "obsidianmd/hardcoded-config-path": "off",
      "obsidianmd/rule-custom-message": "off",
    },
  },
]);
