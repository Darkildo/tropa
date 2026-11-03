import { Events, Notice, type EventRef } from "obsidian";
import { baselineSpread, DEFAULT_RETENTION, Scheduler, type Baseline, type ReviewRating, type Schedule } from "./core/review";
import { UNDO } from "./core/journal";
import { formatDate } from "./ui/when";
import { t } from "./i18n";
import type { TropaSettings } from "./defaults";
import type { Journal } from "./journal";
import type { Store } from "./store";

/** How long the notice after a review offers to take it back. */
const NOTICE_MS = 6000;

/**
 * A self-check of a concept, if it has one: it runs the questions and resolves to the rating they
 * earned, or null when it was left. Registered by the self-check feature; review asks it first.
 */
export type ReviewCheck = (id: string) => (() => Promise<ReviewRating | null>) | null;

/**
 * Schedules of mastered concepts, replayed from the journal. Review needs the journal: it is the
 * only place reviews are kept and the way they reach other devices. With the journal off, review
 * is off too, rather than keeping a second history that other devices never see.
 */
export class Reviews extends Events {
  private cache: Map<string, Schedule> | null = null;
  private cacheKey: unknown[] = [];
  private scheduler: Scheduler | null = null;
  private dueKey = "";
  private checks: ReviewCheck[] = [];
  /** The review the open notice can take back. */
  private undoable: { id: string; count: number } | null = null;
  /** Set once the vault and the journal have been read: until then there is nothing to schedule from. */
  ready = false;

  constructor(
    private readonly settings: () => TropaSettings,
    private readonly saveSettings: () => Promise<void>,
    private readonly store: Store,
    private readonly journal: Journal,
  ) {
    super();
  }

  on(name: "change", callback: () => void): EventRef;
  on(name: string, callback: (...data: never[]) => void): EventRef {
    return super.on(name, callback as (...data: unknown[]) => unknown);
  }

  get enabled() {
    const settings = this.settings();
    return settings.review && settings.journal;
  }

  /** The self-check feature registers here; the first one that has questions for a concept is used. */
  registerCheck(check: ReviewCheck) {
    this.checks.push(check);
    return () => {
      this.checks = this.checks.filter((other) => other !== check);
    };
  }

  checkFor(id: string) {
    for (const check of this.checks) {
      const run = check(id);
      if (run) return run;
    }
    return null;
  }

  get retention() {
    return this.settings().retention || DEFAULT_RETENTION;
  }

  private get engine() {
    if (!this.scheduler || this.scheduler.retention !== this.retention) this.scheduler = new Scheduler(this.retention);
    return this.scheduler;
  }

  /** Schedules of every mastered concept on the map, rebuilt when the journal, the progress or the settings change. */
  get schedules(): Map<string, Schedule> {
    if (!this.enabled || !this.ready) return new Map();
    const history = this.journal.entries;
    const baseline = this.baseline();
    const key = [history, this.store.revision, this.store.topologyKey, this.retention, baseline.since, baseline.spread];
    if (this.cache && key.every((part, index) => part === this.cacheKey[index])) return this.cache;
    const schedules = new Map<string, Schedule>();
    for (const id of this.store.progress.mastered) {
      if (this.store.graph.nodes.get(id)?.kind !== "concept") continue;
      const schedule = this.engine.schedule(id, history.of(id), baseline);
      if (schedule) schedules.set(id, schedule);
    }
    this.cache = schedules;
    this.cacheKey = key;
    return schedules;
  }

  schedule(id: string) {
    return this.schedules.get(id) ?? null;
  }

  isDue(id: string, now = Date.now()) {
    const schedule = this.schedule(id);
    return schedule !== null && schedule.due <= now;
  }

  /** Concepts due now, longest overdue first. */
  due(now = Date.now()): Schedule[] {
    return [...this.schedules.values()].filter((schedule) => schedule.due <= now).sort((a, b) => a.due - b.due || a.id.localeCompare(b.id));
  }

  retrievability(schedule: Schedule, now = Date.now()) {
    return this.engine.retrievability(schedule, now);
  }

  preview(schedule: Schedule, now = Date.now()) {
    return this.engine.preview(schedule, now);
  }

  /** Writes the review to the journal and offers to take it back. */
  rate(id: string, rating: ReviewRating, action: "reviewed" | "checked" = "reviewed") {
    if (!this.enabled || !this.schedule(id)) return;
    this.journal.record([{ action, id, fields: { rating: String(rating) } }]);
    const count = (this.undoable?.id === id ? this.undoable.count : 0) + 1;
    const token = { id, count };
    this.undoable = token;
    // The journal is written in a microtask; the new schedule is there once it is.
    void this.journal.settled().then(() => this.announce(id, token));
  }

  private announce(id: string, token: { id: string; count: number }) {
    const schedule = this.schedule(id);
    const title = this.store.graph.nodes.get(id)?.title ?? "";
    const text = schedule ? t.review.recorded({ title, date: formatDate(schedule.due) }) : t.review.recordedPlain({ title });
    const content = createFragment((fragment) => {
      fragment.createSpan({ text });
      const button = fragment.createEl("button", { cls: "tropa-notice-undo", text: t.undo });
      button.addEventListener("click", () => {
        notice.hide();
        this.undo(token);
      });
    });
    const notice = new Notice(content, NOTICE_MS);
    // A later review makes this one's undo take back the wrong line.
    const watch = this.on("change", () => {
      if (this.undoable === token) return;
      notice.hide();
      this.offref(watch);
    });
    window.setTimeout(() => {
      this.offref(watch);
      if (this.undoable === token) this.undoable = null;
    }, NOTICE_MS);
  }

  /** Takes back the last review of the concept, with a line flagged `undo`. */
  undo(token: { id: string; count: number }) {
    if (this.undoable !== token) return false;
    this.undoable = null;
    this.journal.record([{ action: "reviewed", id: token.id, flags: [UNDO] }]);
    return true;
  }

  /** The concept to review next: the longest overdue one. */
  next(now = Date.now()) {
    return this.due(now)[0]?.id ?? null;
  }

  /** Called when the journal, the progress or the settings change, and every few minutes, as time makes concepts due. */
  refresh() {
    const due = this.due().map((schedule) => schedule.id).join("\n");
    this.dueKey = due;
    this.trigger("change");
  }

  /** Only reports when the set of due concepts changed since the last look. */
  tick() {
    if (!this.enabled) return;
    const due = this.due().map((schedule) => schedule.id).join("\n");
    if (due === this.dueKey) return;
    this.dueKey = due;
    this.trigger("change");
  }

  /**
   * Marks with no date in the journal start on the day review was first on. The day and the spread
   * are saved once, so they stay put, and old marks come due a few a day.
   */
  private baseline(): Baseline {
    const settings = this.settings();
    if (settings.reviewSince && settings.reviewSpread) return { since: Date.parse(settings.reviewSince), spread: settings.reviewSpread };
    const history = this.journal.entries;
    let undated = 0;
    for (const id of this.store.progress.mastered) {
      if (!history.of(id).some((entry) => entry.action === "mastered" || entry.action === "known")) undated++;
    }
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    settings.reviewSince = since.toISOString();
    settings.reviewSpread = baselineSpread(undated);
    void this.saveSettings();
    return { since: since.getTime(), spread: settings.reviewSpread };
  }
}
