import * as obsidian from "obsidian";
import { Notice, Plugin, TFile, debounce, normalizePath } from "obsidian";
import { STATE_ICON } from "./core/format";
import { setLang, t, type Lang } from "./i18n";
import { LEGACY_PROGRESS, defaultSettings, type TropaSettings } from "./defaults";
import { TropaSettingTab } from "./settings";
import { Store } from "./store";
import { sample } from "./sample";
import { MAP_VIEW, MapView } from "./ui/map-view";
import { PANEL_VIEW, PanelView } from "./ui/panel-view";
import { PickModal } from "./ui/pick";

export default class TropaPlugin extends Plugin {
  settings!: TropaSettings;
  defaults!: TropaSettings;
  store!: Store;
  lang: Lang = "en";

  async onload() {
    this.lang = detectLang();
    setLang(this.lang);
    await this.loadSettings();
    this.store = new Store(this.app, () => this.settings);

    this.registerView(MAP_VIEW, (leaf) => new MapView(leaf, this));
    this.registerView(PANEL_VIEW, (leaf) => new PanelView(leaf, this));
    this.addSettingTab(new TropaSettingTab(this.app, this));
    this.addRibbonIcon("route", t.mapTitle, () => void this.showMap());

    const rebuild = debounce(() => this.store.rebuild(), 120, true);
    this.app.workspace.onLayoutReady(() => {
      this.store.rebuild(true);
      this.registerEvent(this.app.metadataCache.on("resolved", rebuild));
      this.registerEvent(
        this.app.metadataCache.on("changed", (file) => {
          if (file.path === normalizePath(this.settings.progressPath)) this.store.onProgressFileChanged();
          else rebuild();
        }),
      );
      this.registerEvent(this.app.vault.on("delete", rebuild));
      this.registerEvent(this.app.vault.on("rename", rebuild));
    });

    this.registerEvent(
      this.store.on("mastered", (id, unlocked) => {
        if (this.app.workspace.getLeavesOfType(MAP_VIEW).length > 0) return;
        const title = this.store.graph.nodes.get(id)?.title ?? "";
        const names = unlocked.map((u) => this.store.graph.nodes.get(u)?.title).join(", ");
        new Notice(names ? t.unlocked(names) : t.mastered(title));
      }),
    );

    this.addCommands();
  }

  /** Saved settings win. On first launch the defaults follow the language and are saved, so paths stay put. */
  private async loadSettings() {
    const saved = (await this.loadData()) as Partial<TropaSettings> | null;
    const legacy = !saved && (await this.app.vault.adapter.exists(LEGACY_PROGRESS));
    this.defaults = defaultSettings(legacy ? "ru" : this.lang);
    this.settings = { ...this.defaults, ...saved };
    if (!saved) await this.saveSettings();
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private addCommands() {
    this.addCommand({ id: "open-map", name: t.mapTitle, callback: () => void this.showMap() });
    this.addCommand({ id: "open-panel", name: t.openPanel, callback: () => void this.showPanel() });
    this.addCommand({ id: "new-concept", name: t.newConcept, callback: () => this.promptNewConcept() });
    this.addCommand({ id: "install-sample", name: t.installSample, callback: () => void this.installSample() });

    this.addCommand({
      id: "find-concept",
      name: t.findConcept,
      callback: () => {
        const items = this.store.graph.concepts.map((node) => ({
          id: node.id,
          title: node.title,
          icon: STATE_ICON[this.store.states.get(node.id) ?? "locked"],
        }));
        new PickModal(this.app, items, t.findConceptPrompt, (item) => {
          void this.showMap((map) => map.focusNode(item.id));
        }).open();
      },
    });

    const onActiveNote = (id: string, name: string, kind: "concept" | "source") =>
      this.addCommand({
        id,
        name,
        checkCallback: (checking) => {
          const file = this.app.workspace.getActiveFile();
          if (!file || file.extension !== "md") return false;
          if (!checking) void this.store.classifyNote(file, kind);
          return true;
        },
      });
    onActiveNote("mark-concept", t.markConcept, "concept");
    onActiveNote("mark-source", t.markSource, "source");

    const onActiveConcept = (id: string, name: string, run: (conceptId: string) => void) =>
      this.addCommand({
        id,
        name,
        checkCallback: (checking) => {
          const file = this.app.workspace.getActiveFile();
          if (!file || this.store.graph.nodes.get(file.path)?.kind !== "concept") return false;
          if (!checking) run(file.path);
          return true;
        },
      });
    onActiveConcept("set-goal", t.setGoal, (id) => this.store.setGoal(id));
    onActiveConcept("toggle-mastered", t.toggleMastered, (id) =>
      this.store.setMastered(id, !this.store.progress.mastered.has(id)),
    );
  }

  async showMap(then?: (map: MapView) => void) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(MAP_VIEW)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: MAP_VIEW, active: true });
    }
    await workspace.revealLeaf(leaf);
    if (leaf.view instanceof MapView) then?.(leaf.view);
  }

  async showPanel() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(PANEL_VIEW)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) return;
      leaf = right;
      await leaf.setViewState({ type: PANEL_VIEW, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  openNote(id: string, newTab = false) {
    const file = this.store.fileOf(id);
    if (!file) return;
    const { workspace } = this.app;
    const noteLeaf = workspace.getLeavesOfType("markdown")[0];
    const leaf = newTab ? workspace.getLeaf("tab") : noteLeaf ?? workspace.getLeaf("split", "vertical");
    void leaf.openFile(file).then(() => workspace.revealLeaf(leaf));
  }

  promptNewConcept(requires: string[] = []) {
    const items = this.store.graph.concepts.filter((node) => !requires.includes(node.id));
    const options = items.map((node) => ({ id: node.id, title: node.title, icon: STATE_ICON[this.store.states.get(node.id) ?? "locked"] }));
    const placeholder = requires.length ? t.nextConceptPrompt : t.conceptName;
    new PickModal(this.app, requires.length ? options : [], placeholder, async (item) => {
      if (item.create) {
        await this.store.createConcept(item.title, requires);
      } else if (requires.length && !requires.some((id) => this.store.graph.wouldCreateCycle(item.id, id))) {
        for (const id of requires) await this.store.addLink(item.id, "requiresKey", id);
      } else if (requires.length) {
        new Notice(t.cycleRefused);
      }
    }, t.createConcept).open();
  }

  async installSample() {
    const { vault } = this.app;
    const example = sample(this.lang);
    if (vault.getAbstractFileByPath(normalizePath(example.folder))) {
      new Notice(t.sampleExists(example.folder));
      await this.showMap();
      return;
    }
    for (const { path, content } of example.files) {
      await this.store.ensureFolder(path.split("/").slice(0, -1).join("/"));
      await vault.create(path, content);
    }
    await this.waitForNote(`${example.goal}.md`);
    this.store.rebuild(true);
    if (!this.store.progress.goal) {
      example.mastered.forEach((path) => this.store.progress.mastered.add(`${path}.md`));
      this.store.setGoal(`${example.goal}.md`);
    }
    await this.showMap();
  }

  /** New notes reach the metadata cache a moment after they are written. */
  private async waitForNote(path: string) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile && this.app.metadataCache.getFileCache(file)?.frontmatter) return;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
  }
}

/** Obsidian's interface language. `getLanguage` appeared in 1.8, older builds keep it in local storage. */
function detectLang(): Lang {
  const { getLanguage } = obsidian as { getLanguage?: () => string };
  let code = "";
  try {
    code = getLanguage?.() ?? window.localStorage.getItem("language") ?? "";
  } catch {
    // Local storage can be unavailable.
  }
  return code.toLowerCase().startsWith("ru") ? "ru" : "en";
}
