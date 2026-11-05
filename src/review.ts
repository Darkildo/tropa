import { Events, Notice, type EventRef } from "obsidian";
import { baselineSpread, DEFAULT_RETENTION, RATINGS, Scheduler, type Baseline, type ReviewRating, type Schedule } from "./core/review";
import { UNDO } from "./core/journal";
import { chooseShift, dayQueue, DEFAULT_LIMIT, isPaused, latestPause, loadByDay, reviewsOn, type Pause } from "./core/load";
import { routeTargets } from "./core/graph";
import { formatDate } from "./core/format";
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

/** What review asks for today. */
export interface ReviewDay {
  /** Due and within today's limit, the easiest to forget first. */
  queue: Schedule[];
  /** Due but over today's limit: they wait for the next days. */
  waiting: number;
  /** Reviews already done today, which count against the limit. */
  done: number;
  /** Reviews a day, 0 for no limit. */
  limit: number;
  /** The pause in force now, if any: the queue is empty until it ends. */
  paused: Pause | null;
}

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

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
  private dayCache: { key: unknown[]; day: ReviewDay; due: Set<string> } | null = null;
  private pauseCache: { history: unknown; pause: Pause | null } | null = null;
  private checks: ReviewCheck[] = [];
  /** The review the open notice can take back. */
  private undoable: { id: string; count: number } | null = null;
  private lastAction: "reviewed" | "checked" = "reviewed";
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

  /** Due now and in today's queue: within the limit and not paused. */
  isDue(id: string, now = Date.now()) {
    return this.today(now).due.has(id);
  }

  /** Concepts to review now: today's queue, the easiest to forget first. */
  due(now = Date.now()): Schedule[] {
    return this.today(now).day.queue;
  }

  /** Today's queue with what it leaves out. Cached for the minute, as the map asks for every node. */
  day(now = Date.now()): ReviewDay {
    return this.today(now).day;
  }

  /** The latest pause in the journal of any device, if any. */
  get pause(): Pause | null {
    const history = this.journal.entries;
    if (this.pauseCache?.history !== history) this.pauseCache = { history, pause: latestPause(history.entries) };
    return this.pauseCache.pause;
  }

  paused(now = Date.now()) {
    return isPaused(this.pause, now);
  }

  /** Pauses review until the local day `until` (YYYY-MM-DD), on every device. */
  pauseUntil(until: string) {
    if (!this.enabled) return;
    this.journal.record([{ action: "pause", id: null, fields: { until } }]);
  }

  resume() {
    if (!this.enabled || !this.paused()) return;
    this.journal.record([{ action: "resume", id: null }]);
  }

  private today(now: number) {
    const schedules = this.schedules;
    const settings = this.settings();
    const limit = Math.max(0, Math.floor(settings.reviewLimit ?? DEFAULT_LIMIT));
    const history = this.journal.entries;
    const key = [schedules, Math.floor(now / MINUTE), limit, history, this.store.revision];
    const cached = this.dayCache;
    if (cached && key.every((part, index) => part === cached.key[index])) return cached;

    const done = reviewsOn(history.entries, now, (id) => schedules.has(id));
    const { queue, waiting, paused } = dayQueue(schedules.values(), now, {
      limit,
      done,
      pause: this.pause,
      recall: (schedule) => this.retrievability(schedule, now),
      needed: this.neededByGoals(),
    });
    const day: ReviewDay = { queue, waiting, done, limit, paused };
    this.dayCache = { key, day, due: new Set(queue.map((schedule) => schedule.id)) };
    return this.dayCache;
  }

  /** Concepts the goals lead through: at the same chance to recall, they come first. */
  private neededByGoals() {
    const { graph, progress } = this.store;
    const needed = new Set<string>();
    for (const goal of routeTargets(progress)) {
      if (!graph.nodes.has(goal)) continue;
      needed.add(goal);
      for (const id of graph.ancestors(goal)) needed.add(id);
    }
    return needed;
  }

  retrievability(schedule: Schedule, now = Date.now()) {
    return this.engine.retrievability(schedule, now);
  }

  /** When the concept would come back after each rating, balanced as the review will be. */
  preview(schedule: Schedule, now = Date.now()) {
    const result = {} as Record<ReviewRating, number>;
    const load = this.load(schedule.id);
    for (const rating of RATINGS) {
      const { due, days } = this.engine.rated(schedule, now, rating);
      result[rating] = due + (load ? chooseShift(due, days, load) : 0) * DAY;
    }
    return result;
  }

  /** Concepts due on each day but this one, to balance against; null when balancing is off. */
  private load(except: string) {
    if (!this.settings().reviewBalance) return null;
    const dues: number[] = [];
    for (const schedule of this.schedules.values()) if (schedule.id !== except) dues.push(schedule.due);
    return loadByDay(dues);
  }

  /**
   * Writes the review to the journal and offers to take it back. A self-check is kept even before
   * the concept is mastered, or with review off: marked mastered within a day, it sets how well
   * the concept starts.
   */
  rate(id: string, rating: ReviewRating, action: "reviewed" | "checked" = "reviewed") {
    if (action === "checked" ? !this.settings().journal : !this.enabled || !this.schedule(id)) return;
    // The line keeps this second, so the replay sees the same fuzz and the shift lands where it was chosen.
    const at = new Date(Math.floor(Date.now() / 1000) * 1000);
    const fields: Record<string, string> = { rating: String(rating) };
    const schedule = this.enabled ? this.schedule(id) : null;
    const load = schedule ? this.load(id) : null;
    if (schedule && load) {
      const { due, days } = this.engine.rated(schedule, at.getTime(), rating);
      const shift = chooseShift(due, days, load);
      if (shift !== 0) fields.shift = String(shift);
    }
    this.journal.record([{ action, id, fields }], at);
    this.lastAction = action;
    const count = (this.undoable?.id === id ? this.undoable.count : 0) + 1;
    const token = { id, count };
    this.undoable = token;
    // The journal is written in a microtask; the new schedule is there once it is.
    void this.journal.settled().then(() => this.announce(id, token));
  }

  private announce(id: string, token: { id: string; count: number }) {
    const schedule = this.schedule(id);
    const title = this.store.graph.nodes.get(id)?.title ?? "";
    const text =
      this.lastAction === "checked"
        ? t.check.saved({ title })
        : schedule
          ? t.review.recorded({ title, date: formatDate(new Date(schedule.due)) })
          : t.review.recordedPlain({ title });
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

  /** The concept to review next: the first in today's queue. */
  next(now = Date.now()) {
    return this.due(now)[0]?.id ?? null;
  }

  /** Called when the journal, the progress or the settings change, and every few minutes, as time makes concepts due. */
  refresh() {
    this.dueKey = this.dayKey();
    this.trigger("change");
  }

  /** Only reports when the set of due concepts changed since the last look. */
  tick() {
    if (!this.enabled) return;
    const key = this.dayKey();
    if (key === this.dueKey) return;
    this.dueKey = key;
    this.trigger("change");
  }

  /** What the queue shows: its concepts, how many wait, and whether a pause holds it. */
  private dayKey() {
    const day = this.day();
    return [...day.queue.map((schedule) => schedule.id), day.waiting, day.paused?.until ?? ""].join("\n");
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
