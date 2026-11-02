import { app, WorkspaceLeaf, missingIcons, notices } from "obsidian";
import TropaPlugin from "../src/main";
import { sampleFiles, SAMPLE_FOLDER, SAMPLE_GOAL, SAMPLE_MASTERED } from "../src/sample";

const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") ?? "demo";
const theme = params.get("theme");
if (theme) document.documentElement.dataset.theme = theme;
document.body.classList.toggle("is-right-open", params.has("panel"));

const vault = (app as any).vault;
const seedDemo = () => {
  for (const { path, content } of sampleFiles()) vault.seed(path, content);
  const link = (title: string) => `"[[${SAMPLE_FOLDER}/Концепты/${title}]]"`;
  vault.seed(
    "Tropa/Прогресс.md",
    `---\ntype: learning-progress\ngoal: ${link(SAMPLE_GOAL)}\nmastered: [${SAMPLE_MASTERED.map(link).join(", ")}]\nlearning: []\ndone: []\n---\n`,
  );
};

if (scenario === "demo") seedDemo();
if (scenario === "cycle") {
  vault.seed("A.md", `---\ntype: concept\nrequires: ["[[C]]"]\n---\n`);
  vault.seed("B.md", `---\ntype: concept\nrequires: ["[[A]]"]\n---\n`);
  vault.seed("C.md", `---\ntype: concept\nrequires: ["[[B]]"]\n---\n`);
  vault.seed("D.md", `---\ntype: concept\nrequires: ["[[C]]", "[[Заметки ещё нет]]"]\n---\n`);
  vault.seed("Свободная заметка.md", `Обычная заметка без свойств.\n`);
}
if (scenario === "large") {
  const count = Number(params.get("n") ?? 300);
  for (let i = 0; i < count; i++) {
    const reqs = [i - 1 - (i % 7), i - 3 - (i % 11), Math.floor(i / 2)].filter((n) => n >= 0 && n < i);
    vault.seed(`Узел ${i}.md`, `---\ntype: concept\nrequires: [${[...new Set(reqs)].map((n) => `"[[Узел ${n}]]"`).join(", ")}]\n---\n`);
  }
}
if (scenario === "empty") vault.seed("Обычная заметка.md", "Текст.\n");
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
