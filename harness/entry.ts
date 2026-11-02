import { app, WorkspaceLeaf, missingIcons, notices } from "obsidian";
import TropaPlugin from "../src/main";
import { sample } from "../src/sample";
import { defaultSettings } from "../src/defaults";

const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") ?? "demo";
const language = params.get("lang") ?? "en";
localStorage.setItem("language", language);
document.documentElement.lang = language;
document.body.classList.add(params.get("theme") === "dark" ? "theme-dark" : "theme-light");
document.body.classList.toggle("is-right-open", params.has("panel"));

const vault = (app as any).vault;
// The example can be in another language than the interface, as in a vault set up before translation.
const sampleLanguage = (params.get("sample") ?? language).startsWith("ru") ? "ru" : "en";
const seedDemo = () => {
  const example = sample(sampleLanguage);
  for (const { path, content } of example.files) vault.seed(path, content);
  const link = (path: string) => `"[[${path}]]"`;
  vault.seed(
    defaultSettings(sampleLanguage).progressPath,
    `---\ntype: learning-progress\ngoal: ${link(example.goal)}\nmastered: [${example.mastered.map(link).join(", ")}]\nlearning: []\ndone: []\n---\n`,
  );
};

if (scenario === "demo") seedDemo();
if (scenario === "cycle") {
  vault.seed("A.md", `---\ntype: concept\nrequires: ["[[C]]"]\n---\n`);
  vault.seed("B.md", `---\ntype: concept\nrequires: ["[[A]]"]\n---\n`);
  vault.seed("C.md", `---\ntype: concept\nrequires: ["[[B]]"]\n---\n`);
  vault.seed("D.md", `---\ntype: concept\nrequires: ["[[C]]", "[[No note yet]]"]\n---\n`);
  vault.seed("Loose note.md", `A plain note without properties.\n`);
}
if (scenario === "large") {
  const count = Number(params.get("n") ?? 300);
  const links = (ids: number[], prefix = "Node") => `[${[...new Set(ids)].map((n) => `"[[${prefix} ${n}]]"`).join(", ")}]`;
  for (let i = 0; i < count; i++) {
    const reqs = [i - 1 - (i % 7), i - 3 - (i % 11), Math.floor(i / 2)].filter((n) => n >= 0 && n < i);
    // `materials` adds soft links and about 0.7 materials per concept, like the benchmark's "+m" graphs.
    const soft = params.has("materials") && i % 2 ? `recommends: ${links([(i * 37) % count].filter((n) => n !== i))}\n` : "";
    vault.seed(`Node ${i}.md`, `---\ntype: concept\nrequires: ${links(reqs)}\n${soft}---\n`);
  }
  if (params.has("materials")) {
    for (let i = 0; i < Math.round(count * 0.7); i++) {
      const needs = i % 3 ? "" : `requires: ${links([(i * 13) % count])}\n`;
      vault.seed(`Material ${i}.md`, `---\ntype: source\nformat: article\nminutes: ${10 + (i % 50)}\nteaches: ${links([(i * 7) % count])}\n${needs}---\n`);
    }
  }
}
// The plugin must still work where workers are not available.
if (params.has("noworker")) Reflect.deleteProperty(window, "Worker");
if (scenario === "empty") vault.seed("Plain note.md", "Text.\n");
// Folder and tag exclusions: the progress file and an attachment sit in excluded folders but must keep working.
if (scenario === "scope") {
  vault.seed("Goal.md", `---\ntype: concept\ntags: [course]\nrequires: ["[[Base]]", "[[Archived]]", "[[Private note]]", "[[Inline tagged]]", "[[Kept]]"]\n---\n`);
  vault.seed("Base.md", `---\ntype: concept\nmaterials: ["[[scan.pdf]]"]\n---\n`);
  vault.seed("Archive/Archived.md", `---\ntype: concept\n---\n`);
  vault.seed("Archive 2/Kept.md", `---\ntype: concept\nrequires: ["[[Base]]"]\n---\n`);
  vault.seed("Private note.md", `---\ntype: concept\ntags: [private/old]\n---\n`);
  vault.seed("Inline tagged.md", `---\ntype: concept\n---\nSome text #private\n`);
  vault.seed("Next.md", `---\ntype: concept\nrequires: ["[[Private note]]"]\n---\n`);
  vault.seed("Attachments/scan.pdf", "");
  vault.seed(defaultSettings(sampleLanguage).progressPath, `---\ntype: learning-progress\ngoal: "[[Goal]]"\nmastered: ["[[Archived]]"]\n---\n`);
}
vault.getMarkdownFiles().forEach((file: any) => (app as any).metadataCache.index(file));

const workspace = (app as any).workspace;
workspace.center = new WorkspaceLeaf(document.getElementById("center")!, "center");
workspace.right = new WorkspaceLeaf(document.getElementById("right")!, "right");
workspace.note = new WorkspaceLeaf(document.getElementById("note")!, "note");

const plugin = new (TropaPlugin as any)(app, {});
if (scenario === "scope") plugin.data = { excludeFolders: ["Archive", "Attachments", "Tropa"], excludeTags: ["private"] };
await plugin.onload();
await new Promise((resolve) => setTimeout(resolve, 20));
await workspace.center.setViewState({ type: "tropa-map" });
await workspace.right.setViewState({ type: "tropa-panel" });
requestAnimationFrame(() => workspace.center.view.render());

Object.assign(window, { tropa: { app, plugin, notices, missingIcons } });
