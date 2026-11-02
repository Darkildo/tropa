import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
  // harness is a mock of the Obsidian API for browser checks, not plugin code.
  globalIgnores(["node_modules", "dist", "main.js", "harness", "*.mjs"]),
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
    // The demo vault script runs in Node and writes a vault from outside, so it uses Node APIs and the default config folder.
    files: ["scripts/**"],
    languageOptions: { globals: globals.node },
    rules: {
      "obsidianmd/no-nodejs-modules": "off",
      "obsidianmd/hardcoded-config-path": "off",
      "obsidianmd/rule-custom-message": "off",
    },
  },
]);
