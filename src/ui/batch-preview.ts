import { Modal, setIcon, type App } from "obsidian";
import type { BatchRow, LinkBatch, LinkEdit, LinkKindName, LinkOrigin } from "../core/batch-links";
import { isRtl, t } from "../i18n";
import { typedDirection } from "./pick";

export interface BatchPreviewOptions {
  title: string;
  intro: string;
  /** How a note is named in a row. */
  titleOf: (id: string) => string;
  /** The line under a row: where the link was found. */
  describe: (row: BatchRow) => string;
  /** Text under the list, such as how many suggestions were cut. */
  footer?: string;
  onApply: (edits: LinkEdit[]) => void;
}

const SECTIONS: LinkOrigin[] = ["list", "link", "mutual"];

/**
 * A batch of links before it is written: each row reads as a sentence, "A needs B", with a box to
 * take it and the kind to change. Rows come in sections by where they were found.
 */
export class BatchPreviewModal extends Modal {
  private apply!: HTMLButtonElement;
  private readonly boxes: HTMLInputElement[] = [];
  private readonly refreshers: (() => void)[] = [];

  constructor(app: App, private readonly batch: LinkBatch, private readonly options: BatchPreviewOptions) {
    super(app);
    if (isRtl()) this.modalEl.dir = "rtl";
  }

  onOpen() {
    this.setTitle(this.options.title);
    this.modalEl.addClass("tropa-batch-modal");
    const { contentEl } = this;
    contentEl.createEl("p", { cls: "tropa-hint", text: this.options.intro });
    const filter = contentEl.createEl("input", {
      type: "search",
      cls: "tropa-known-filter",
      attr: { placeholder: t.links.filter, "aria-label": t.links.filter },
    });
    typedDirection(filter);
    const list = contentEl.createDiv({ cls: "tropa-batch-list" });
    for (const origin of SECTIONS) this.section(list, origin);
    if (this.options.footer) contentEl.createEl("p", { cls: "tropa-hint tropa-batch-footer", text: this.options.footer });

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    this.apply = buttons.createEl("button", { cls: "mod-cta tropa-batch-apply" });
    buttons.createEl("button", { text: t.cancel }).addEventListener("click", () => this.close());
    this.apply.addEventListener("click", () => this.confirm());

    filter.addEventListener("input", () => {
      const query = filter.value.trim().toLowerCase();
      for (const row of list.querySelectorAll<HTMLElement>(".tropa-batch-row")) {
        row.toggleClass("is-hidden", query !== "" && !(row.dataset.search ?? "").includes(query));
      }
    });
    this.update();
    window.setTimeout(() => (this.batch.rows.length > 8 ? filter : this.apply).focus());
  }

  private section(list: HTMLElement, origin: LinkOrigin) {
    const indices = this.batch.rows.flatMap((row, index) => (row.origin === origin ? [index] : []));
    if (!indices.length) return;
    const section = list.createDiv({ cls: `tropa-batch-section is-${origin}` });
    const head = section.createDiv({ cls: "tropa-batch-head" });
    head.createEl("h3", { text: t.links.section[origin] });
    head.createSpan({ cls: "tropa-audit-count", text: String(indices.length) });
    const all = head.createEl("button", { cls: "tropa-batch-all", text: t.links.selectAll });
    const none = head.createEl("button", { cls: "tropa-batch-none", text: t.links.selectNone });
    section.createEl("p", { cls: "tropa-audit-hint", text: t.links.sectionHint[origin] });
    for (const index of indices) this.row(section, index);

    const setAll = (checked: boolean) => {
      for (const index of indices) {
        const row = this.batch.rows[index];
        this.batch.set(index, checked, row.kind);
      }
      this.update();
    };
    all.addEventListener("click", () => setAll(true));
    none.addEventListener("click", () => setAll(false));
  }

  private row(section: HTMLElement, index: number) {
    const data = this.batch.rows[index];
    const { titleOf } = this.options;
    const row = section.createDiv({ cls: "tropa-batch-row" });
    row.dataset.from = data.from;
    row.dataset.to = data.to;
    row.dataset.search = `${titleOf(data.from)} ${titleOf(data.to)}`.toLowerCase();
    const line = row.createEl("label", { cls: "tropa-batch-line" });
    const box = line.createEl("input", { type: "checkbox", cls: "tropa-batch-box" });
    this.boxes[index] = box;
    line.createSpan({ cls: "tropa-batch-note", text: titleOf(data.from), attr: { dir: "auto" } });
    const kind = row.createEl("select", { cls: "dropdown tropa-batch-kind", attr: { "aria-label": t.links.kindLabel } });
    for (const value of ["requires", "recommends"] as LinkKindName[]) kind.createEl("option", { text: t.links.kind[value], attr: { value } });
    // The kind sits between the two names, so the row reads "A needs B".
    line.after(kind);
    const target = row.createSpan({ cls: "tropa-batch-note is-target", text: titleOf(data.to), attr: { dir: "auto" } });
    kind.after(target);
    const where = this.options.describe(data);
    if (where) row.createDiv({ cls: "tropa-batch-meta", text: where });
    const loop = row.createDiv({ cls: "tropa-batch-loop" });
    setIcon(loop.createSpan({ cls: "tropa-batch-loop-icon" }), "alert-triangle");
    const loopText = loop.createSpan();

    const refresh = () => {
      const current = this.batch.rows[index];
      box.checked = current.checked;
      kind.value = current.kind;
      row.toggleClass("is-checked", current.checked);
      row.toggleClass("is-refused", current.loop !== null);
      loopText.setText(current.loop ? t.links.loop({ chain: [...current.loop, current.loop[0]].map(titleOf).join(" → ") }) : "");
    };
    this.refreshers[index] = refresh;
    const change = (checked: boolean) => {
      this.batch.set(index, checked, kind.value as LinkKindName);
      this.update();
    };
    box.addEventListener("change", () => change(box.checked));
    // Choosing a kind takes the row: that is what the choice is for.
    kind.addEventListener("change", () => change(true));
  }

  private update() {
    for (const refresh of this.refreshers) refresh?.();
    const count = this.batch.chosen.length;
    this.apply.setText(t.links.apply({ count }));
    this.apply.disabled = count === 0;
  }

  private confirm() {
    const edits = this.batch.chosen;
    if (!edits.length) return;
    this.close();
    this.options.onApply(edits);
  }

  onClose() {
    this.contentEl.empty();
  }
}
