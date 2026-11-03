import { ItemView, Platform, setIcon, type TFile, type WorkspaceLeaf } from "obsidian";
import type TropaPlugin from "../main";
import { attempt } from "../attempt";
import { formatMinutes } from "../core/format";
import { isRtl, t } from "../i18n";
import { renderConcept, renderRoute, renderSource, type DetailHost } from "./detail";
import { navbarOverlap } from "./phone";

export const PANEL_VIEW = "tropa-panel";

/** Sidebar companion: follows the open note and shows where it sits in the graph. */
export class PanelView extends ItemView implements DetailHost {
  private body!: HTMLElement;
  private override: string | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TropaPlugin) {
    super(leaf);
  }

  get store() {
    return this.plugin.store;
  }

  get canGoBack() {
    return this.override !== null;
  }

  getViewType() {
    return PANEL_VIEW;
  }

  getDisplayText() {
    return "Tropa";
  }

  getIcon() {
    return "route";
  }

  async onOpen() {
    this.contentEl.addClass("tropa-host");
    this.body = this.contentEl.createDiv({ cls: "tropa-panel", attr: { dir: isRtl() ? "rtl" : "ltr" } });
    if (Platform.isPhone) {
      // On a phone the panel opens as a drawer under Obsidian's navigation bar; its end scrolls clear of it.
      const place = () => this.body.style.setProperty("--tropa-bottom-inset", `${navbarOverlap(this.body)}px`);
      const observer = new ResizeObserver(place);
      observer.observe(this.body);
      this.register(() => observer.disconnect());
      this.registerEvent(this.app.workspace.on("layout-change", place));
    }
    this.registerEvent(this.store.on("change", () => this.render()));
    this.registerEvent(this.plugin.journal.on("change", () => this.render()));
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.override = null;
        this.render();
      }),
    );
    this.render();
  }

  select(id: string | null) {
    this.override = id;
    this.render();
  }

  openNote(id: string, newTab = false) {
    this.plugin.openNote(id, newTab);
  }

  private render() {
    if (!this.body) return;
    const { body, store } = this;
    const scroll = body.scrollTop;
    body.empty();

    const file = this.app.workspace.getActiveFile();
    const id = this.override ?? file?.path ?? null;
    const node = id ? store.graph.nodes.get(id) : null;

    if (node?.kind === "concept") renderConcept(body, this, node);
    else if (node) renderSource(body, this, node);
    else {
      if (file?.extension === "md" && !store.isOwnFile(file.path)) this.renderOffMap(file);
      renderRoute(body, this, () => attempt(this.plugin.showMap((map) => map.pickGoal()), "choose a goal"));
      this.renderStats();
    }
    body.scrollTop = scroll;
  }

  /** What the journal says about the last week and month, when there is a journal to read. */
  private renderStats() {
    const { journal, settings } = this.plugin;
    if (!settings.journal) return;
    const history = journal.entries;
    if (history.entries.length === 0) return;
    const now = Date.now();
    const minutesOf = (id: string) => this.store.graph.nodes.get(id)?.minutes;
    const periods = [
      { name: t.journal.week, stats: history.stats(now, 7, minutesOf) },
      { name: t.journal.month, stats: history.stats(now, 30, minutesOf) },
    ];
    const block = this.body.createDiv({ cls: "tropa-stats" });
    block.createDiv({ cls: "tropa-section-head", text: t.journal.title });
    const table = block.createEl("table");
    const head = table.createEl("tr");
    head.createEl("th");
    for (const period of periods) head.createEl("th", { text: period.name, attr: { scope: "col" } });
    const row = (name: string, cls: string, value: (stats: (typeof periods)[number]["stats"]) => string) => {
      const tr = table.createEl("tr", { cls });
      tr.createEl("th", { text: name, attr: { scope: "row" } });
      for (const period of periods) tr.createEl("td", { cls: "tropa-nowrap", text: value(period.stats) });
    };
    row(t.journal.mastered, "is-mastered", (stats) => String(stats.mastered));
    row(t.journal.time, "is-time", (stats) => (stats.minutes ? formatMinutes(stats.minutes) : "—"));
    row(t.journal.reviews, "is-reviews", (stats) => String(stats.reviews));
  }

  private renderOffMap(file: TFile) {
    if (this.store.isExcluded(file)) {
      this.body.createEl("p", { cls: "tropa-callout", text: t.scope.excludedNote });
      return;
    }
    const block = this.body.createDiv({ cls: "tropa-offmap" });
    block.createDiv({ cls: "tropa-section-head", text: t.notOnMap });
    const actions = block.createDiv({ cls: "tropa-actions" });
    const add = (label: string, icon: string, kind: "concept" | "source") => {
      const button = actions.createEl("button");
      setIcon(button.createSpan(), icon);
      button.createSpan({ text: label });
      button.addEventListener("click", () => attempt(this.store.classifyNote(file, kind), `mark ${file.path} as ${kind}`));
    };
    add(t.concept, "lightbulb", "concept");
    add(t.material, "book-open", "source");
  }
}
