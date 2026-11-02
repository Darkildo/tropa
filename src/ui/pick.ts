import { App, Modal, Notice, Setting, SuggestModal, setIcon } from "obsidian";
import { guessFormat } from "../core/format";
import type { SourceFormat } from "../core/types";
import { isRtl, t } from "../i18n";
import { attempt } from "../attempt";
import type { SourceDraft } from "../store";


// Typed text takes its own direction, so "What is AI?" keeps its question mark at the end.
// An empty field keeps the interface's direction, so a right-to-left placeholder stays in place.
export function typedDirection(input: HTMLInputElement) {
  const update = () => (input.value ? (input.dir = "auto") : input.removeAttribute("dir"));
  input.addEventListener("input", update);
  update();
}
export interface PickItem {
  id: string;
  title: string;
  hint?: string;
  icon?: string;
  /** Marks the row that creates a new item from the typed text. */
  create?: boolean;
}

export class PickModal extends SuggestModal<PickItem> {
  constructor(
    app: App,
    private readonly items: PickItem[],
    placeholder: string,
    private readonly onPick: (item: PickItem) => void | Promise<void>,
    private readonly createLabel?: (query: string) => string,
  ) {
    super(app);
    if (isRtl()) this.modalEl.dir = "rtl";
    typedDirection(this.inputEl);
    this.setPlaceholder(placeholder);
    this.emptyStateText = t.nothingFound;
    this.setInstructions([
      { command: "↑↓", purpose: t.toNavigate },
      { command: "↵", purpose: t.toChoose },
      { command: "esc", purpose: t.toDismiss },
    ]);
  }

  getSuggestions(query: string): PickItem[] {
    const text = query.trim().toLowerCase();
    const found = this.items.filter((item) => item.title.toLowerCase().includes(text));
    const exact = found.some((item) => item.title.toLowerCase() === text);
    if (this.createLabel && query.trim() && !exact) {
      found.push({ id: "", title: query.trim(), hint: this.createLabel(query.trim()), icon: "plus", create: true });
    }
    return found;
  }

  renderSuggestion(item: PickItem, el: HTMLElement) {
    el.addClass("tropa-pick");
    if (item.icon) setIcon(el.createSpan({ cls: "tropa-pick-icon" }), item.icon);
    const text = el.createDiv({ cls: "tropa-pick-text" });
    text.createDiv({ text: item.create ? item.hint : item.title, attr: item.create ? {} : { dir: "auto" } });
    if (item.hint && !item.create) text.createDiv({ cls: "tropa-pick-hint", text: item.hint });
  }

  onChooseSuggestion(item: PickItem) {
    attempt(Promise.resolve(this.onPick(item)), `apply "${item.title}"`);
  }
}

export class SourceModal extends Modal {
  private draft: SourceDraft;
  private formatTouched = false;

  constructor(app: App, title: string, private readonly onSave: (draft: SourceDraft) => void | Promise<void>) {
    super(app);
    if (isRtl()) this.modalEl.dir = "rtl";
    this.draft = { title, url: "", format: "article" };
  }

  onOpen() {
    this.setTitle(t.newMaterial);
    const { contentEl } = this;
    let formatControl: { setValue(value: string): unknown } | undefined;

    new Setting(contentEl).setName(t.name).addText((text) => {
      text.setValue(this.draft.title).onChange((value) => (this.draft.title = value));
      typedDirection(text.inputEl);
      if (!this.draft.title) window.setTimeout(() => text.inputEl.focus());
    });

    new Setting(contentEl)
      .setName(t.link)
      .setDesc(t.linkDesc)
      .addText((text) => {
        text.setPlaceholder("https://example.com").onChange((value) => {
          this.draft.url = value.trim();
          if (!this.formatTouched) {
            this.draft.format = guessFormat(this.draft.url);
            formatControl?.setValue(this.draft.format);
          }
        });
        if (this.draft.title) window.setTimeout(() => text.inputEl.focus());
      });

    new Setting(contentEl).setName(t.formatName).addDropdown((dropdown) => {
      dropdown.addOptions(t.format).setValue(this.draft.format).onChange((value) => {
        this.formatTouched = true;
        this.draft.format = value as SourceFormat;
      });
      formatControl = dropdown;
    });

    new Setting(contentEl)
      .setName(t.duration)
      .setDesc(t.durationDesc)
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.onChange((value) => {
          const minutes = Number(value);
          this.draft.minutes = minutes > 0 ? minutes : undefined;
        });
      });

    new Setting(contentEl).addButton((button) =>
      button.setButtonText(t.addMaterial).setCta().onClick(() => {
        if (!this.draft.title.trim()) {
          new Notice(t.materialNameRequired);
          return;
        }
        this.close();
        attempt(Promise.resolve(this.onSave(this.draft)), `add material "${this.draft.title}"`);
      }),
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

export interface KnownItem {
  id: string;
  title: string;
  icon: string;
}

/** Shows what "I know this and what it needs" is about to mark, so doubtful concepts can be left out. */
export class KnownModal extends Modal {
  private readonly chosen: Set<string>;

  constructor(app: App, private readonly items: KnownItem[], private readonly onConfirm: (ids: string[]) => void) {
    super(app);
    if (isRtl()) this.modalEl.dir = "rtl";
    this.chosen = new Set(items.map((item) => item.id));
  }

  onOpen() {
    this.setTitle(t.knownTitle);
    this.modalEl.addClass("tropa-known-modal");
    const { contentEl } = this;
    contentEl.createEl("p", { cls: "tropa-hint", text: t.knownText });
    const filter = contentEl.createEl("input", {
      type: "search",
      cls: "tropa-known-filter",
      attr: { placeholder: t.knownFilter, "aria-label": t.knownFilter },
    });
    typedDirection(filter);
    const list = contentEl.createDiv({ cls: "tropa-known-list", attr: { role: "group", "aria-label": t.knownTitle } });
    const empty = contentEl.createDiv({ cls: "tropa-hint tropa-known-empty", text: t.nothingFound });
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const confirm = buttons.createEl("button", { cls: "mod-cta" });
    buttons.createEl("button", { text: t.cancel }).addEventListener("click", () => this.close());
    confirm.addEventListener("click", () => this.confirm());

    const refresh = () => {
      const query = filter.value.trim().toLowerCase();
      let shown = 0;
      for (const { item, row } of rows) {
        const visible = item.title.toLowerCase().includes(query);
        row.toggleClass("is-hidden", !visible);
        if (visible) shown++;
      }
      empty.toggleClass("is-hidden", shown > 0);
      confirm.setText(t.knownConfirm({ count: this.chosen.size }));
      confirm.disabled = this.chosen.size === 0;
    };

    const rows = this.items.map((item) => {
      const row = list.createEl("label", { cls: "tropa-known-row" });
      const box = row.createEl("input", { type: "checkbox" });
      box.checked = true;
      box.dataset.id = item.id;
      box.addEventListener("change", () => {
        if (box.checked) this.chosen.add(item.id);
        else this.chosen.delete(item.id);
        refresh();
      });
      setIcon(row.createSpan({ cls: "tropa-pick-icon" }), item.icon);
      row.createSpan({ cls: "tropa-known-title", text: item.title, attr: { dir: "auto" } });
      return { item, row };
    });

    filter.addEventListener("input", refresh);
    // Enter in the filter or Ctrl+Enter anywhere confirms; Space still ticks a focused box.
    contentEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey || event.target === filter)) return;
      event.preventDefault();
      this.confirm();
    });
    refresh();
    window.setTimeout(() => (this.items.length > 8 ? filter : confirm).focus());
  }

  private confirm() {
    if (this.chosen.size === 0) return;
    this.close();
    this.onConfirm(this.items.map((item) => item.id).filter((id) => this.chosen.has(id)));
  }

  onClose() {
    this.contentEl.empty();
  }
}
