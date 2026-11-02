import { ItemView, setIcon, type TFile, type WorkspaceLeaf } from "obsidian";
import type TropaPlugin from "../main";
import { t } from "../i18n";
import { renderConcept, renderRoute, renderSource, type DetailHost } from "./detail";

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
    this.body = this.contentEl.createDiv({ cls: "tropa-panel" });
    this.registerEvent(this.store.on("change", () => this.render()));
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
      if (file?.extension === "md" && file.path !== this.plugin.settings.progressPath) this.renderOffMap(file);
      renderRoute(body, this, () => this.plugin.showMap((map) => map.pickGoal()));
    }
    body.scrollTop = scroll;
  }

  private renderOffMap(file: TFile) {
    const block = this.body.createDiv({ cls: "tropa-offmap" });
    block.createDiv({ cls: "tropa-section-head", text: t.notOnMap });
    const actions = block.createDiv({ cls: "tropa-actions" });
    const add = (label: string, icon: string, kind: "concept" | "source") => {
      const button = actions.createEl("button");
      setIcon(button.createSpan(), icon);
      button.createSpan({ text: label });
      button.addEventListener("click", () => void this.store.classifyNote(file, kind));
    };
    add(t.concept, "lightbulb", "concept");
    add(t.material, "book-open", "source");
  }
}
