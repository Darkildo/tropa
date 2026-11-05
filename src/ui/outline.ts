import { Modal, Setting, type App } from "obsidian";
import { parseOutline, type OutlineItem, type OutlineOptions, type OutlineOrder } from "../core/outline";
import { isRtl, t } from "../i18n";

export interface OutlineRequest extends OutlineOptions {
  text: string;
  folder: string;
}

/**
 * Where a map from a list starts: paste the list, choose how nesting reads and where new notes go.
 * The count of items follows the text, so a paste that reads as nothing shows it before the preview.
 */
export class OutlineModal extends Modal {
  private readonly request: OutlineRequest;

  constructor(app: App, initial: OutlineRequest, private readonly onPreview: (request: OutlineRequest, items: OutlineItem[]) => void) {
    super(app);
    if (isRtl()) this.modalEl.dir = "rtl";
    this.request = { ...initial };
  }

  onOpen() {
    const { contentEl, request } = this;
    this.setTitle(t.outline.title);
    this.modalEl.addClass("tropa-outline-modal");
    contentEl.createEl("p", { cls: "tropa-hint", text: t.outline.intro });
    const text = contentEl.createEl("textarea", {
      cls: "tropa-outline-text",
      attr: { rows: "12", dir: "auto", placeholder: t.outline.placeholder, "aria-label": t.outline.title, spellcheck: "false" },
    });
    text.value = request.text;
    const count = contentEl.createDiv({ cls: "tropa-hint tropa-outline-count", attr: { "aria-live": "polite" } });

    new Setting(contentEl)
      .setName(t.outline.order)
      .addDropdown((dropdown) =>
        dropdown
          .addOption("parts", t.outline.orderParts)
          .addOption("topic", t.outline.orderTopic)
          .setValue(request.order)
          .onChange((value) => (request.order = value as OutlineOrder)),
      )
      .settingEl.addClass("tropa-outline-order");
    new Setting(contentEl)
      .setName(t.outline.chain)
      .setDesc(t.outline.chainDesc)
      .addToggle((toggle) => toggle.setValue(request.chain).onChange((value) => (request.chain = value)))
      .settingEl.addClass("tropa-outline-chain");
    new Setting(contentEl)
      .setName(t.outline.folder)
      .addText((input) => {
        input.inputEl.addClass("tropa-outline-folder");
        input.inputEl.dir = "auto";
        input.setValue(request.folder).onChange((value) => (request.folder = value));
      });

    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    const preview = actions.createEl("button", { cls: "mod-cta tropa-outline-preview", text: t.outline.preview });
    actions.createEl("button", { text: t.cancel }).addEventListener("click", () => this.close());

    let items: OutlineItem[] = [];
    const refresh = () => {
      request.text = text.value;
      items = parseOutline(text.value);
      count.setText(text.value.trim() ? (items.length ? t.outline.count({ count: items.length }) : t.outline.nothing) : "");
      preview.disabled = items.length === 0;
    };
    text.addEventListener("input", refresh);
    preview.addEventListener("click", () => {
      if (!items.length) return;
      this.close();
      this.onPreview({ ...request, folder: request.folder.trim() }, items);
    });
    refresh();
    window.setTimeout(() => text.focus());
  }

  onClose() {
    this.contentEl.empty();
  }
}
