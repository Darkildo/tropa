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

/*
  A phone, as Obsidian mobile sets it up: classes on the body, a navigation bar floating over the
  bottom of the view, and side panels that open on a horizontal swipe. Obsidian builds that swipe
  from touch events that reach the document; touches inside an element with data-ignore-swipe do
  not count. `swipeAll` drops that opt-out, to check that the map holds its touches back anyway.
*/
const swipes: string[] = [];
if (params.has("phone")) {
  document.body.classList.add("is-mobile", "is-phone");
  document.body.createDiv({ cls: "mobile-navbar" });
  const honour = !params.has("swipeAll");
  let start: { x: number; y: number } | null = null;
  document.addEventListener("touchstart", (event) => {
    const touch = event.touches[0];
    const ignored = honour && (event.target as Element).closest?.("[data-ignore-swipe]");
    start = event.touches.length === 1 && !ignored ? { x: touch.clientX, y: touch.clientY } : null;
  });
  document.addEventListener("touchmove", (event) => {
    if (!start) return;
    const touch = event.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swipes.push(dx > 0 ? "open-left" : "open-right");
      start = null;
    }
  });
  document.addEventListener("touchend", () => (start = null));
}

// `holdlayout` lets a test keep the worker's answer back while it acts on the map, so the action is sure to
// land while the layout is pending. The worker still computes as usual; only the delivery waits.
if (params.has("holdlayout")) {
  const hold = { on: false, since: 0, arrived: 0, held: [] as (() => void)[] };
  const release = () => {
    hold.on = false;
    hold.held.splice(0).forEach((deliver) => deliver());
  };
  Object.assign(window, { layoutHold: Object.assign(hold, { release }) });
  const Real = window.Worker;
  window.Worker = class extends Real {
    private handler: ((event: MessageEvent) => void) | null = null;
    get onmessage() {
      return this.handler;
    }
    set onmessage(handler: ((event: MessageEvent) => void) | null) {
      this.handler = handler;
      super.onmessage = (event: MessageEvent) => {
        if (!hold.on) return handler?.call(this, event);
        hold.arrived = performance.now();
        hold.held.push(() => handler?.call(this, event));
      };
    }
  } as typeof Worker;
}

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
    // `archive` puts every tenth note in a folder, for the map scope checks.
    const folder = params.has("archive") && i % 10 === 5 ? "Archive/" : "";
    vault.seed(`${folder}Node ${i}.md`, `---\ntype: concept\nrequires: ${links(reqs)}\n${soft}---\n`);
  }
  if (params.has("materials")) {
    for (let i = 0; i < Math.round(count * 0.7); i++) {
      const needs = i % 3 ? "" : `requires: ${links([(i * 13) % count])}\n`;
      vault.seed(`Material ${i}.md`, `---\ntype: source\nformat: article\nminutes: ${10 + (i % 50)}\nteaches: ${links([(i * 7) % count])}\n${needs}---\n`);
    }
  }
  // A material that teaches nothing yet, for the audit to point at.
  if (params.has("lone")) vault.seed("Lone material.md", "---\ntype: source\nformat: video\n---\n");
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
  // Left out of the map by the scope: neither a lone note nor a missing one in the audit.
  vault.seed("Archive/Old idea.md", "---\ntype: concept\n---\n");
  note("Uses the archive", 'type: concept\nrequires: ["[[Old idea]]", "[[Algebra]]"]\n');
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
// Plain notes with links but no Tropa properties yet, for suggested links.
if (scenario === "links") {
  vault.seed("Course/Calculus course.md", "# Calculus\n\nIn this order:\n\n1. [[Limits]]\n2. [[Derivatives]]\n3. [[Integrals]]\n");
  vault.seed("Course/Limits.md", "Builds on [[Functions]]. Read [[Calculus book]] and see ![[graph.png]].\n");
  vault.seed("Course/Functions.md", "A function maps inputs to outputs. Far away: [[Far note]].\n");
  vault.seed("Course/Derivatives.md", "Leads to [[Integrals]].\n");
  vault.seed("Course/Integrals.md", "Related: [[Series]].\n");
  vault.seed("Course/Series.md", "Back to [[Integrals]].\n");
  vault.seed("Course/Calculus book.md", '---\ntype: source\nformat: book\nteaches: ["[[Limits]]"]\n---\n');
  vault.seed("Course/Daily 2026-11-05.md", "---\ntype: daily\n---\nStudied [[Limits]].\n");
  vault.seed("Course/graph.png", "");
  vault.seed("Other/Far note.md", "Unrelated.\n");
  // Already on the map: Old A needs Old B, Old B needs Wrap-up; a link from Wrap-up back to Old A would close a loop.
  vault.seed("Course/Old A.md", '---\ntype: concept\nrequires: ["[[Old B]]"]\n---\n');
  vault.seed("Course/Old B.md", '---\ntype: concept\nrequires: ["[[Wrap-up]]"]\n---\n');
  vault.seed("Course/Wrap-up.md", "---\ntype: concept\n---\nAll of [[Old A]] again.\n");
}
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
if (scenario === "audit") plugin.data = { excludeFolders: ["Archive"] };
if (scenario === "scope") plugin.data = { excludeFolders: ["Archive", "Attachments", "Tropa"], excludeTags: ["private"] };
await plugin.onload();
await new Promise((resolve) => setTimeout(resolve, 20));
await workspace.center.setViewState({ type: "tropa-map" });
await workspace.right.setViewState({ type: "tropa-panel" });
requestAnimationFrame(() => workspace.center.view.render());

Object.assign(window, { tropa: { app, plugin, notices, missingIcons, swipes } });
