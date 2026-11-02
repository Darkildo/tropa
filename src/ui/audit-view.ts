import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { attempt } from "../attempt";
import { auditCount, auditGraph } from "../core/audit";
import { FORMAT_ICON, STATE_ICON } from "../core/format";
import { isRtl, t } from "../i18n";
import type TropaPlugin from "../main";

export const AUDIT_VIEW = "tropa-audit";

/**
 * Everything on the map that needs a look, in one list that follows the vault. A view of its own
 * rather than a mode of the side panel: the lists can be long, and they stay open beside the map
 * while the notes get fixed.
 */
export class AuditView extends ItemView {
  private body!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TropaPlugin) {
    super(leaf);
  }

  get store() {
    return this.plugin.store;
  }

  getViewType() {
    return AUDIT_VIEW;
  }

  getDisplayText() {
    return t.audit.title;
  }

  getIcon() {
    return "list-checks";
  }

  async onOpen() {
    this.contentEl.addClass("tropa-host");
    this.body = this.contentEl.createDiv({ cls: "tropa-audit", attr: { dir: isRtl() ? "rtl" : "ltr" } });
    this.registerEvent(this.store.on("change", () => this.render()));
    this.render();
  }

  render() {
    if (!this.body) return;
    const scroll = this.body.scrollTop;
    this.body.empty();
    const audit = auditGraph(this.store.graph);
    const count = auditCount(audit);

    this.body.createEl("h2", { cls: "tropa-title", text: t.audit.title });
    this.body.createEl("p", {
      cls: `tropa-audit-summary${count ? "" : " is-clean"}`,
      text: this.store.isEmpty ? t.emptyText : count ? t.audit.summary({ count }) : t.audit.clean,
    });

    this.section("cycles", t.audit.cycles, t.audit.cyclesHint, audit.cycles, (list, chain) => this.cycleRow(list, chain));
    this.section("ghosts", t.audit.ghosts, t.audit.ghostsHint, audit.ghosts, (list, ghost) =>
      this.row(list, ghost.id, t.audit.linkedFrom({ count: ghost.linkedFrom })),
    );
    this.section("duplicates", t.audit.duplicates, t.audit.duplicatesHint, audit.duplicates, (list, group) => {
      const block = list.createDiv({ cls: "tropa-audit-group" });
      for (const id of group) this.row(block, id);
    });
    this.section("no-materials", t.audit.noMaterials, t.audit.noMaterialsHint, audit.noMaterials, (list, id) => this.row(list, id));
    this.section("orphans", t.audit.orphans, t.audit.orphansHint, audit.orphans, (list, id) => this.row(list, id));
    this.body.scrollTop = scroll;
  }

  private section<T>(kind: string, title: string, hint: string, items: T[], render: (list: HTMLElement, item: T) => void) {
    if (!items.length) return;
    const section = this.body.createDiv({ cls: `tropa-audit-section is-${kind}` });
    const head = section.createEl("h3", { cls: "tropa-audit-head" });
    head.createSpan({ text: title });
    head.createSpan({ cls: "tropa-audit-count", text: String(items.length) });
    section.createEl("p", { cls: "tropa-audit-hint", text: hint });
    const list = section.createDiv({ cls: "tropa-audit-list" });
    for (const item of items) render(list, item);
  }

  /** A note: the row opens it, a ghost's row shows it on the map. */
  private row(list: HTMLElement, id: string, meta?: string) {
    const node = this.store.graph.nodes.get(id);
    if (!node) return;
    const row = list.createDiv({ cls: "tropa-audit-row" });
    row.dataset.id = id;
    const main = row.createEl("button", { cls: "tropa-audit-main" });
    setIcon(main.createSpan({ cls: "tropa-audit-icon" }), node.kind === "source" ? FORMAT_ICON[node.format ?? "other"] : STATE_ICON[this.store.states.get(id) ?? "locked"]);
    const text = main.createSpan({ cls: "tropa-audit-text" });
    text.createSpan({ cls: "tropa-audit-name", text: node.title, attr: { dir: "auto" } });
    // A file path tells apart duplicates that share a name.
    if (!node.ghost && !node.inline) text.createSpan({ cls: "tropa-audit-path", text: id, attr: { dir: "ltr" } });
    if (meta) text.createSpan({ cls: "tropa-audit-meta", text: meta });
    main.setAttribute("aria-label", node.ghost ? `${node.title}. ${t.audit.showOnMap}` : `${node.title}. ${t.openNote}`);
    main.addEventListener("click", () => (node.ghost ? this.showOnMap(id) : this.plugin.openNote(id)));

    const actions = row.createDiv({ cls: "tropa-audit-actions" });
    if (node.ghost) {
      const create = actions.createEl("button", { cls: "mod-cta tropa-audit-create", text: t.createNote });
      create.addEventListener("click", () => attempt(this.store.materialize(id), `create ${node.title}`));
    } else {
      const map = actions.createEl("button", { cls: "clickable-icon tropa-audit-map", attr: { "aria-label": t.audit.showOnMap } });
      setIcon(map, "map-pin");
      map.addEventListener("click", () => this.showOnMap(id));
    }
  }

  /** A loop as chips in order, back to the first one; each chip opens its note. */
  private cycleRow(list: HTMLElement, chain: string[]) {
    const row = list.createDiv({ cls: "tropa-audit-cycle" });
    const chips = row.createDiv({ cls: "tropa-audit-chain" });
    [...chain, chain[0]].forEach((id, i) => {
      if (i > 0) setIcon(chips.createSpan({ cls: "tropa-audit-arrow", attr: { "aria-hidden": "true" } }), "arrow-right");
      const node = this.store.graph.nodes.get(id);
      const chip = chips.createEl("button", { cls: "tropa-audit-chip", text: node?.title ?? id, attr: { dir: "auto" } });
      chip.dataset.id = id;
      chip.addEventListener("click", () => this.plugin.openNote(id));
    });
    const map = row.createEl("button", { cls: "clickable-icon tropa-audit-map", attr: { "aria-label": t.audit.showOnMap } });
    setIcon(map, "map-pin");
    map.addEventListener("click", () => this.showOnMap(chain[0]));
  }

  private showOnMap(id: string) {
    const { settings } = this.plugin;
    const showMaterial = this.store.graph.nodes.get(id)?.kind === "source" && !settings.showSources;
    if (showMaterial) {
      settings.showSources = true;
      attempt(this.plugin.saveSettings(), "save settings");
    }
    attempt(
      this.plugin.showMap((map) => {
        if (showMaterial) map.render();
        map.focusNode(id);
      }),
      "show a note on the map",
    );
  }
}
