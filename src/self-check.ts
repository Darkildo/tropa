import { Events, TFile, type App, type EventRef } from "obsidian";
import { calloutType, parseQuestions, type Question } from "./core/questions";
import type { ReviewRating } from "./core/review";
import { attempt } from "./attempt";
import type { TropaSettings } from "./defaults";
import type { Reviews } from "./review";
import type { Store } from "./store";
import { CheckModal, OfferModal, type CheckMode, type CheckResult } from "./ui/check";

interface Entry {
  /** What the questions were read from: the file's time and size, and the callout type. */
  stamp: string | null;
  questions: Question[];
}

/**
 * Self-check questions of concepts, read from their notes and kept while the notes stay the same.
 * Reading is asynchronous; views hear "change" once questions appeared, changed or went away.
 */
export class SelfChecks extends Events {
  private entries = new Map<string, Entry>();
  private syncing: Promise<void> | null = null;
  private again = false;
  /** Grows whenever any concept's questions change: the audit is cached by it. */
  version = 0;

  constructor(
    private readonly app: App,
    private readonly settings: () => TropaSettings,
    private readonly saveSettings: () => Promise<void>,
    private readonly store: Store,
    private readonly reviews: Reviews,
  ) {
    super();
  }

  on(name: "change", callback: () => void): EventRef;
  on(name: string, callback: (...data: never[]) => void): EventRef {
    return super.on(name, callback as (...data: unknown[]) => unknown);
  }

  of(id: string): readonly Question[] {
    return this.entries.get(id)?.questions ?? [];
  }

  count(id: string) {
    return this.of(id).length;
  }

  /** For the audit: how many questions a concept has, or nothing when the audit leaves them out. */
  get forAudit(): ((id: string) => number) | undefined {
    return this.settings().auditQuestions ? (id) => this.count(id) : undefined;
  }

  /** Reads the questions of concepts whose notes changed since the last look. */
  sync(): Promise<void> {
    if (this.syncing) {
      this.again = true;
      return this.syncing;
    }
    this.syncing = this.read().finally(() => {
      this.syncing = null;
      if (this.again) {
        this.again = false;
        attempt(this.sync(), "read self-check questions");
      }
    });
    return this.syncing;
  }

  private async read() {
    const type = calloutType(this.settings().checkCallout);
    const seen = new Set<string>();
    let changed = false;
    for (const node of this.store.graph.concepts) {
      if (node.ghost) continue;
      const file = this.store.fileOf(node.id);
      if (!(file instanceof TFile)) continue;
      seen.add(node.id);
      const stat = (file as Partial<TFile>).stat;
      const stamp = stat ? `${stat.mtime}:${stat.size}:${type}` : null;
      const old = this.entries.get(node.id);
      if (old && stamp !== null && old.stamp === stamp) continue;
      const sections = this.app.metadataCache.getFileCache(file)?.sections;
      // A note with no quote at all has no questions: no need to read it.
      const questions =
        sections && !sections.some((section) => section.type === "callout" || section.type === "blockquote")
          ? []
          : parseQuestions(await this.app.vault.cachedRead(file), type, sections);
      if (!old || !sameQuestions(old.questions, questions)) changed = true;
      this.entries.set(node.id, { stamp, questions });
    }
    for (const id of [...this.entries.keys()]) {
      if (seen.has(id)) continue;
      if (this.entries.get(id)!.questions.length) changed = true;
      this.entries.delete(id);
    }
    if (changed) {
      this.version++;
      this.trigger("change");
    }
  }

  /** The audit setting changed: views look again. */
  touch() {
    this.version++;
    this.trigger("change");
  }

  /** Forgets what was read, for a new callout type. */
  reset() {
    this.entries.clear();
    return this.sync();
  }

  /** The check review runs for a mastered concept: the rating it earned, or null when it was left. */
  reviewCheck(id: string): (() => Promise<ReviewRating | null>) | null {
    if (!this.count(id)) return null;
    return () => this.open(id, "review").then((result) => result?.rating ?? null);
  }

  /** "Check yourself" from the details or the queue: a review of a mastered concept, otherwise a check before marking it. */
  async checkNow(id: string) {
    const mastered = this.store.progress.mastered.has(id);
    const result = await this.open(id, mastered ? "review" : "master");
    if (!result) return;
    this.reviews.rate(id, result.rating, "checked");
    if (result.master && !mastered) this.store.setMastered(id, true);
  }

  /** Marks a concept mastered, offering a self-check first when it has questions. */
  async master(id: string) {
    if (!this.count(id) || !this.settings().offerCheck) {
      this.store.setMastered(id, true);
      return;
    }
    const title = this.store.graph.nodes.get(id)?.title ?? "";
    const choice = await new Promise<"check" | "skip" | null>((resolve) => {
      new OfferModal(this.app, title, (picked, dontAsk) => {
        if (picked && dontAsk) {
          this.settings().offerCheck = false;
          attempt(this.saveSettings(), "save the settings");
        }
        resolve(picked);
      }).open();
    });
    if (choice === "skip") this.store.setMastered(id, true);
    if (choice === "check") await this.checkNow(id);
  }

  /** Marks or unmarks, as the M key, the menu and the command do. */
  toggle(id: string) {
    if (this.store.progress.mastered.has(id)) this.store.setMastered(id, false);
    else attempt(this.master(id), "mark a concept mastered");
  }

  private open(id: string, mode: CheckMode) {
    const node = this.store.graph.nodes.get(id);
    const questions = this.of(id);
    if (!node || !questions.length) return Promise.resolve(null);
    return new Promise<CheckResult | null>((resolve) => {
      new CheckModal(this.app, node.title, id, questions, mode, resolve).open();
    });
  }
}

function sameQuestions(a: readonly Question[], b: readonly Question[]) {
  return a.length === b.length && a.every((question, index) => question.question === b[index].question && question.answer === b[index].answer);
}
