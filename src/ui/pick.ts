import { App, Modal, Notice, Setting, SuggestModal, setIcon } from "obsidian";
import { guessFormat } from "../core/format";
import type { SourceFormat } from "../core/types";
import { t } from "../i18n";
import { attempt } from "../attempt";
import type { SourceDraft } from "../store";

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
    text.createDiv({ text: item.create ? item.hint : item.title });
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
    this.draft = { title, url: "", format: "article" };
  }

  onOpen() {
    this.setTitle(t.newMaterial);
    const { contentEl } = this;
    let formatControl: { setValue(value: string): unknown } | undefined;

    new Setting(contentEl).setName(t.name).addText((text) => {
      text.setValue(this.draft.title).onChange((value) => (this.draft.title = value));
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
