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
if (scenario === "audit") {
  // One of each finding: a concept without materials, a lone note, a missing note, duplicate names, a loop.
  const note = (title: string, front: string) => vault.seed(`${title}.md`, `---\n${front}---\n`);
  note("Algebra", "type: concept\n");
  note("Algebra course", 'type: source\nformat: course\nteaches: ["[[Algebra]]"]\n');
  note("Calculus", 'type: concept\nrequires: ["[[Algebra]]", "[[Missing note]]"]\n');
  note("Lonely", "type: concept\n");
  note("Café", 'type: concept\nrequires: ["[[Algebra]]"]\n');
  note("cafe", 'type: concept\nrequires: ["[[Algebra]]"]\n');
  note("Loop A", 'type: concept\nrequires: ["[[Loop B]]"]\n');
  note("Loop B", 'type: concept\nrequires: ["[[Loop C]]"]\n');
  note("Loop C", 'type: concept\nrequires: ["[[Loop A]]"]\n');
}
// The plugin must still work where workers are not available, or WebAssembly is not.
if (params.has("noworker")) Reflect.deleteProperty(window, "Worker");
if (params.has("nowasm")) {
  const Native = window.Worker;
  window.Worker = class extends Native {
    constructor(url: string | URL, options?: WorkerOptions) {
      const script = `self.WebAssembly = undefined; importScripts(${JSON.stringify(String(url))});`;
      super(URL.createObjectURL(new Blob([script], { type: "text/javascript" })), options);
    }
  };
}
if (scenario === "empty") vault.seed("Plain note.md", "Text.\n");
vault.getMarkdownFiles().forEach((file: any) => (app as any).metadataCache.index(file));

const workspace = (app as any).workspace;
workspace.center = new WorkspaceLeaf(document.getElementById("center")!, "center");
workspace.right = new WorkspaceLeaf(document.getElementById("right")!, "right");
workspace.note = new WorkspaceLeaf(document.getElementById("note")!, "note");

const plugin = new (TropaPlugin as any)(app, {});
await plugin.onload();
await new Promise((resolve) => setTimeout(resolve, 20));
await workspace.center.setViewState({ type: "tropa-map" });
await workspace.right.setViewState({ type: "tropa-panel" });
requestAnimationFrame(() => workspace.center.view.render());

Object.assign(window, { tropa: { app, plugin, notices, missingIcons } });
