import { Notice, Platform, Plugin, TFile, debounce, getLanguage, normalizePath, type TAbstractFile } from "obsidian";
import { STATE_ICON } from "./core/format";
import { attempt } from "./attempt";
import { exampleLang, setLocale, t } from "./i18n";
import { LEGACY_PROGRESS, defaultSettings, type TropaSettings } from "./defaults";
import { Journal } from "./journal";
import { Reviews } from "./review";
import { parseFolders, parseTags } from "./core/scope";
import { TropaSettingTab } from "./settings";
import { Store } from "./store";
import { sample } from "./sample";
import { MAP_VIEW, MapView } from "./ui/map-view";
import { AUDIT_VIEW, AuditView } from "./ui/audit-view";
import { PANEL_VIEW, PanelView } from "./ui/panel-view";
import { openKnownModal } from "./ui/detail";
import { PickModal } from "./ui/pick";

/** How long a notice with an undo button stays. */
const NOTICE_MS = 6000;
/** Concepts come due as time passes: the views are told every few minutes when the set changes. */
const REVIEW_TICK_MS = 5 * 60 * 1000;

export default class TropaPlugin extends Plugin {
  settings!: TropaSettings;
  defaults!: TropaSettings;
  store!: Store;
  journal!: Journal;
  reviews!: Reviews;

  async onload() {
    setLocale(getLanguage());
    await this.loadSettings();
    this.store = new Store(this.app, () => this.settings);
    this.journal = new Journal(this.app, () => this.settings, this.store);
    this.registerEvent(this.store.on("commit", (before, after, cause) => this.journal.recordProgress(before, after, cause)));
    this.reviews = new Reviews(() => this.settings, () => this.saveSettings(), this.store, this.journal);
    this.registerEvent(this.journal.on("change", () => this.reviews.refresh()));
    this.registerEvent(this.store.on("change", () => this.reviews.tick()));
    this.registerInterval(window.setInterval(() => this.reviews.tick(), REVIEW_TICK_MS));

    this.registerView(MAP_VIEW, (leaf) => new MapView(leaf, this));
    this.registerView(PANEL_VIEW, (leaf) => new PanelView(leaf, this));
    this.registerView(AUDIT_VIEW, (leaf) => new AuditView(leaf, this));
    this.addSettingTab(new TropaSettingTab(this.app, this));
    this.addRibbonIcon("route", t.mapTitle, () => attempt(this.showMap(), "open the map"));

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
      this.watchJournal();
    });

    this.registerEvent(
      this.store.on("mastered", (id, unlocked) => {
        if (this.app.workspace.getLeavesOfType(MAP_VIEW).length > 0) return;
        const title = this.store.graph.nodes.get(id)?.title ?? "";
        const names = unlocked.map((u) => this.store.graph.nodes.get(u)?.title).join(t.listSeparator);
        new Notice(names ? t.unlocked({ names }) : t.mastered({ title }));
      }),
    );
    this.registerEvent(
      this.store.on("undoable", (message, _unlocked, undo) => {
        if (this.app.workspace.getLeavesOfType(MAP_VIEW).length > 0) return;
        const content = createFragment((fragment) => {
          fragment.createSpan({ text: message });
          const button = fragment.createEl("button", { cls: "tropa-notice-undo", text: t.undo });
          button.addEventListener("click", () => this.store.undo(undo));
        });
        const notice = new Notice(content, NOTICE_MS);
        // Another change to the progress makes this undo stale: it would revert that change too.
        const watch = this.store.on("change", () => {
          if (this.store.canUndo(undo)) return;
          notice.hide();
          this.store.offref(watch);
        });
        window.setTimeout(() => this.store.offref(watch), NOTICE_MS);
      }),
    );

    this.addCommands();
  }

  /** Journal files come and change from other devices through sync; each is read again on its own. */
  private watchJournal() {
    const { vault } = this.app;
    attempt(
      this.journal.load().then(() => {
        this.reviews.ready = true;
        this.reviews.refresh();
      }),
      "read the learning journal",
    );
    const reread = (file: TAbstractFile) => {
      if (this.journal.contains(file.path)) attempt(this.journal.reread(file), "read the learning journal");
    };
    this.registerEvent(vault.on("create", reread));
    this.registerEvent(vault.on("modify", reread));
    this.registerEvent(vault.on("delete", (file) => this.journal.forget(file.path)));
    this.registerEvent(
      vault.on("rename", (file, oldPath) => {
        this.journal.forget(oldPath);
        reread(file);
      }),
    );
  }

  /** Saved settings win. On first launch the defaults follow the language and are saved, so paths stay put. */
  private async loadSettings() {
    const saved = (await this.loadData()) as Partial<TropaSettings> | null;
    const legacy = !saved && (await this.app.vault.adapter.exists(LEGACY_PROGRESS));
    this.defaults = defaultSettings(legacy ? "ru" : exampleLang());
    this.settings = { ...this.defaults, ...saved };
    // Hand-edited data can hold a string or stray `#`: the store expects clean lists.
    this.settings.excludeFolders = parseFolders(this.settings.excludeFolders);
    this.settings.excludeTags = parseTags(this.settings.excludeTags);
    // Settings saved before the journal get its folder now, in the language of their progress file, so it stays put.
    if (saved && !saved.journalFolder) {
      this.settings.journalFolder = defaultSettings(saved.progressPath === LEGACY_PROGRESS ? "ru" : exampleLang()).journalFolder;
    }
    if (!saved || !saved.journalFolder) await this.saveSettings();
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private addCommands() {
    this.addCommand({ id: "open-map", name: t.mapTitle, callback: () => attempt(this.showMap(), "open the map") });
    this.addCommand({ id: "open-panel", name: t.openPanel, callback: () => attempt(this.showPanel(), "open the panel") });
    this.addCommand({ id: "new-concept", name: t.newConcept, callback: () => this.promptNewConcept() });
    this.addCommand({ id: "install-sample", name: t.installSample, callback: () => attempt(this.installSample(), "add the example map") });
    this.addCommand({ id: "audit-map", name: t.audit.command, callback: () => attempt(this.showAudit(), "open the map audit") });
    this.addCommand({ id: "export-canvas", name: t.exportCanvas, callback: () => attempt(this.showMap((map) => map.exportCanvas()), "export the map") });
    this.addCommand({ id: "export-svg", name: t.exportSvg, callback: () => attempt(this.showMap((map) => map.exportSvg()), "export the map") });

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
          attempt(this.showMap((map) => map.focusNode(item.id)), "show a concept");
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
          if (!checking) attempt(this.store.classifyNote(file, kind), `mark ${file.path} as ${kind}`);
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
    onActiveConcept("toggle-skipped", t.toggleSkipped, (id) =>
      this.store.setSkipped(id, !this.store.progress.skipped.has(id)),
    );
    onActiveConcept("mark-known", t.markKnownCommand, (id) => openKnownModal(this.app, this.store, id));

    this.addCommand({ id: "review-next", name: t.review.nextCommand, callback: () => attempt(this.reviewNext(), "open the next review") });
    this.addCommand({ id: "review-queue", name: t.review.queueCommand, callback: () => attempt(this.showReviewQueue(), "open the review queue") });
  }

  /** The longest overdue concept, in the panel; on a phone, on the map, whose sheet is the panel there. */
  async reviewNext() {
    if (!this.reviews.enabled) {
      new Notice(this.settings.journal ? t.review.off : t.review.needsJournal);
      return;
    }
    const id = this.reviews.next();
    if (!id) {
      new Notice(t.review.nothingDue);
      return;
    }
    if (Platform.isPhone) await this.showMap((map) => map.focusNode(id));
    else {
      await this.showPanel();
      const panel = this.app.workspace.getLeavesOfType(PANEL_VIEW)[0]?.view;
      if (panel instanceof PanelView) panel.select(id);
    }
  }

  /** The queue heads the route, in the panel or, on a phone, in the map's sheet. */
  async showReviewQueue() {
    if (!this.reviews.enabled) {
      new Notice(this.settings.journal ? t.review.off : t.review.needsJournal);
      return;
    }
    if (Platform.isPhone) await this.showMap((map) => map.select(null));
    else {
      await this.showPanel();
      const panel = this.app.workspace.getLeavesOfType(PANEL_VIEW)[0]?.view;
      if (panel instanceof PanelView) panel.showQueue();
    }
  }

  async showMap(then?: (map: MapView) => unknown) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(MAP_VIEW)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: MAP_VIEW, active: true });
    }
    await workspace.revealLeaf(leaf);
    if (leaf.view instanceof MapView) await then?.(leaf.view);
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

  /** The audit opens in a tab of its own, next to the map. */
  async showAudit() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(AUDIT_VIEW)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: AUDIT_VIEW, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  /** Opens the note behind a node. A material listed in a concept opens its attachment or its link. */
  openNote(id: string, newTab = false) {
    const node = this.store.graph.nodes.get(id);
    if (node?.inline && !node.file) {
      if (node.url) window.open(node.url, "_blank", "noopener");
      return;
    }
    const file = this.store.fileOf(node?.inline ? node.file! : id);
    if (!file) return;
    const { workspace } = this.app;
    const noteLeaf = workspace.getLeavesOfType("markdown")[0];
    const leaf = newTab ? workspace.getLeaf("tab") : noteLeaf ?? workspace.getLeaf("split", "vertical");
    attempt(leaf.openFile(file).then(() => workspace.revealLeaf(leaf)), `open ${file.path}`);
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
    }, (name) => t.createConcept({ name })).open();
  }

  async installSample() {
    const { vault } = this.app;
    const example = sample(exampleLang());
    if (vault.getAbstractFileByPath(normalizePath(example.folder))) {
      new Notice(t.sampleExists({ folder: example.folder }));
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
      // The example comes with a few concepts known already: the journal says so, not that they were mastered now.
      this.store.setGoal(`${example.goal}.md`, "known");
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
