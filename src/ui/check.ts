import { Component, MarkdownRenderer, Modal, Platform, type App } from "obsidian";
import { GRADES, scoreOf, suggestRating, type Grade, type Question } from "../core/questions";
import { RATINGS, type ReviewRating } from "../core/review";
import { attempt } from "../attempt";
import { isRtl, locale, t } from "../i18n";

const RATING_NAME: Record<ReviewRating, "again" | "hard" | "good" | "easy"> = { 1: "again", 2: "hard", 3: "good", 4: "easy" };

/**
 * `review`: the concept is mastered, the result is one of the four review ratings.
 * `master`: it is not mastered yet, the result says whether to mark it so now.
 */
export type CheckMode = "review" | "master";

export interface CheckResult {
  rating: ReviewRating;
  /** In `master` mode: mark the concept mastered. */
  master: boolean;
}

/**
 * The questions one at a time: the answer opens on a press and the person grades it. The grades
 * suggest a rating, which they can change before it is saved. Closing the window saves nothing.
 */
export class CheckModal extends Modal {
  private index = 0;
  private revealed = false;
  private readonly grades: Grade[] = [];
  private readonly renderer = new Component();
  private keys: Partial<Record<string, () => void>> = {};
  private done = false;

  constructor(
    app: App,
    private readonly title: string,
    private readonly sourcePath: string,
    private readonly questions: readonly Question[],
    private readonly mode: CheckMode,
    private readonly onResult: (result: CheckResult | null) => void,
  ) {
    super(app);
    if (isRtl()) this.modalEl.dir = "rtl";
  }

  onOpen() {
    this.setTitle(t.check.title({ title: this.title }));
    this.titleEl.setAttr("dir", "auto");
    this.modalEl.addClass("tropa-check-modal");
    this.modalEl.toggleClass("is-phone", Platform.isPhone);
    this.renderer.load();
    this.modalEl.addEventListener("keydown", (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key === " " ? "Space" : event.key;
      const run = this.keys[key];
      if (!run) return;
      event.preventDefault();
      run();
    });
    this.show();
  }

  onClose() {
    this.renderer.unload();
    this.contentEl.empty();
    this.finish(null);
  }

  private finish(result: CheckResult | null) {
    if (this.done) return;
    this.done = true;
    this.onResult(result);
  }

  private choose(result: CheckResult) {
    this.finish(result);
    this.close();
  }

  private show() {
    if (this.index < this.questions.length) this.showQuestion();
    else this.showSummary();
  }

  private markdown(parent: HTMLElement, cls: string, text: string) {
    const el = parent.createDiv({ cls: `tropa-check-markdown ${cls}`, attr: { dir: "auto" } });
    attempt(MarkdownRenderer.render(this.app, text, el, this.sourcePath, this.renderer), "show a self-check question");
    return el;
  }

  private showQuestion() {
    const { contentEl } = this;
    contentEl.empty();
    this.keys = {};
    const question = this.questions[this.index];
    contentEl.createDiv({ cls: "tropa-check-progress tropa-hint", text: t.check.progress({ index: this.index + 1, count: this.questions.length }) });
    this.markdown(contentEl, "tropa-check-question", question.question);

    const buttons = contentEl.createDiv({ cls: "tropa-check-buttons" });
    if (!this.revealed) {
      const reveal = buttons.createEl("button", { cls: "mod-cta tropa-check-reveal", text: t.check.showAnswer });
      const run = () => {
        this.revealed = true;
        this.showQuestion();
      };
      reveal.addEventListener("click", run);
      this.keys = { Space: run, Enter: run };
      if (!Platform.isMobile) contentEl.createDiv({ cls: "tropa-hint tropa-check-keys", text: t.check.keys });
      window.setTimeout(() => reveal.focus());
      return;
    }

    if (question.answer.trim()) this.markdown(contentEl, "tropa-check-answer", question.answer);
    else contentEl.createDiv({ cls: "tropa-check-answer tropa-hint", text: t.check.noAnswer });
    contentEl.appendChild(buttons);
    buttons.createDiv({ cls: "tropa-check-prompt", text: t.check.gradePrompt });
    const row = buttons.createDiv({ cls: "tropa-check-grades", attr: { role: "group", "aria-label": t.check.gradePrompt } });
    GRADES.forEach((grade, position) => {
      const button = row.createEl("button", { cls: `tropa-check-grade is-${grade}`, text: t.check[grade], attr: { "data-grade": grade } });
      const run = () => this.grade(grade);
      button.addEventListener("click", run);
      this.keys[String(position + 1)] = run;
      if (position === 0) window.setTimeout(() => button.focus());
    });
  }

  private grade(grade: Grade) {
    this.grades.push(grade);
    this.index++;
    this.revealed = false;
    this.show();
  }

  private showSummary() {
    const { contentEl } = this;
    contentEl.empty();
    this.keys = {};
    const suggested = suggestRating(this.grades);
    const score = new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(scoreOf(this.grades));
    contentEl.createDiv({ cls: "tropa-check-summary", text: t.check.summary({ score, count: this.grades.length }) });
    contentEl.createDiv({ cls: "tropa-hint tropa-check-suggested", text: t.check.suggested({ rating: t.review[RATING_NAME[suggested]] }) });

    const buttons = contentEl.createDiv({ cls: "tropa-check-buttons" });
    if (this.mode === "review") {
      buttons.createDiv({ cls: "tropa-check-prompt", text: t.review.howWell });
      const row = buttons.createDiv({ cls: "tropa-check-ratings", attr: { role: "group", "aria-label": t.review.howWell } });
      for (const rating of RATINGS) {
        const button = row.createEl("button", {
          cls: `tropa-check-rating is-${RATING_NAME[rating]}${rating === suggested ? " mod-cta" : ""}`,
          text: t.review[RATING_NAME[rating]],
          attr: { "data-rating": String(rating) },
        });
        const run = () => this.choose({ rating, master: false });
        button.addEventListener("click", run);
        this.keys[String(rating)] = run;
        if (rating === suggested) {
          this.keys.Enter = run;
          window.setTimeout(() => button.focus());
        }
      }
      return;
    }

    buttons.createDiv({ cls: "tropa-check-prompt", text: t.check.masterPrompt });
    const row = buttons.createDiv({ cls: "tropa-check-ratings" });
    // A forgotten concept is not offered as mastered first; both choices keep the result.
    const master = row.createEl("button", { cls: `tropa-check-master${suggested > 1 ? " mod-cta" : ""}`, text: t.markMastered });
    const later = row.createEl("button", { cls: `tropa-check-later${suggested > 1 ? "" : " mod-cta"}`, text: t.check.notYet });
    const runMaster = () => this.choose({ rating: suggested, master: true });
    const runLater = () => this.choose({ rating: suggested, master: false });
    master.addEventListener("click", runMaster);
    later.addEventListener("click", runLater);
    this.keys.Enter = suggested > 1 ? runMaster : runLater;
    window.setTimeout(() => (suggested > 1 ? master : later).focus());
  }
}

export type OfferChoice = "check" | "skip";

/** Before a concept with questions is marked mastered: check yourself first, or skip it. */
export class OfferModal extends Modal {
  private chosen = false;

  constructor(
    app: App,
    private readonly title: string,
    private readonly onChoice: (choice: OfferChoice | null, dontAsk: boolean) => void,
  ) {
    super(app);
    if (isRtl()) this.modalEl.dir = "rtl";
  }

  onOpen() {
    this.setTitle(t.check.offerTitle);
    this.modalEl.addClass("tropa-check-offer");
    this.modalEl.toggleClass("is-phone", Platform.isPhone);
    const { contentEl } = this;
    contentEl.createEl("p", { text: t.check.offerText({ title: this.title }), attr: { dir: "auto" } });
    const label = contentEl.createEl("label", { cls: "tropa-check-dont-ask" });
    const dontAsk = label.createEl("input", { type: "checkbox" });
    label.createSpan({ text: t.check.dontAsk });
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const check = buttons.createEl("button", { cls: "mod-cta tropa-check-start", text: t.review.check });
    const skip = buttons.createEl("button", { cls: "tropa-check-skip", text: t.check.skip });
    const pick = (choice: OfferChoice) => {
      this.chosen = true;
      this.close();
      this.onChoice(choice, dontAsk.checked);
    };
    check.addEventListener("click", () => pick("check"));
    skip.addEventListener("click", () => pick("skip"));
    window.setTimeout(() => check.focus());
  }

  onClose() {
    this.contentEl.empty();
    if (!this.chosen) this.onChoice(null, false);
  }
}
