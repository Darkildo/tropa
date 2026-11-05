import { Modal, Notice, Setting, type App } from "obsidian";
import { formatDate } from "../core/format";
import { pauseDate } from "../core/load";
import { parseDate } from "../core/plan";
import { isDate } from "../core/progress";
import { isRtl, t } from "../i18n";
import type { Reviews } from "../review";

/** A week off by default. */
const DEFAULT_DAYS = 7;

/** The day review comes back. The pause goes to the journal, so every device keeps it. */
export class PauseModal extends Modal {
  private until: string;

  constructor(app: App, private readonly reviews: Reviews) {
    super(app);
    if (isRtl()) this.modalEl.dir = "rtl";
    this.until = pauseDate(Date.now(), DEFAULT_DAYS);
  }

  onOpen() {
    this.setTitle(t.review.pauseCommand);
    const { contentEl } = this;
    contentEl.addClass("tropa-pause");
    contentEl.createEl("p", { cls: "setting-item-description", text: t.review.pauseText });
    new Setting(contentEl).setName(t.review.pauseUntil).addText((text) => {
      text.inputEl.type = "date";
      text.inputEl.addClass("tropa-pause-until");
      text.inputEl.min = pauseDate(Date.now(), 1);
      text.setValue(this.until).onChange((value) => (this.until = value));
    });
    new Setting(contentEl).addButton((button) =>
      button.setButtonText(t.review.pause).setCta().onClick(() => {
        if (!isDate(this.until) || this.until < pauseDate(Date.now(), 1)) {
          new Notice(t.review.pauseInvalid);
          return;
        }
        this.close();
        this.reviews.pauseUntil(this.until);
        new Notice(t.review.pausedUntil({ date: formatDate(parseDate(this.until)) }));
      }),
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** Pauses review, or says why it cannot. */
export function openPause(app: App, reviews: Reviews) {
  if (!reviews.enabled) return;
  new PauseModal(app, reviews).open();
}

export function resumeReview(reviews: Reviews) {
  if (!reviews.paused()) {
    new Notice(t.review.notPaused);
    return;
  }
  reviews.resume();
  new Notice(t.review.resumed);
}
