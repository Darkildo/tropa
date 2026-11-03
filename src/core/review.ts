import {
  computeDecayFactor,
  createEmptyCard,
  fsrs,
  generatorParameters,
  State,
  StrategyMode,
  type Card,
  type FSRS,
  type TSeedStrategy,
} from "ts-fsrs";
import { UNDO, type JournalEntry } from "./journal";

/*
  Review of mastered concepts with FSRS. Nothing is stored but the journal: the state of a concept
  is replayed from its lines every time, so a review on another device, an undo or a new target
  recall are all taken into account the same way.

  The memory of a concept starts when it is marked mastered (rated Good) or known (rated Easy),
  and each review after that is one more FSRS step. A mark with no date in the journal (made
  before the journal existed, or on a device that keeps none) starts on the day review was first
  turned on, spread over a few weeks, so an old map does not come due all at once.
*/

/** 1 forgot, 2 hard, 3 recalled, 4 easy: the FSRS grades. */
export type ReviewRating = 1 | 2 | 3 | 4;
export const RATINGS: readonly ReviewRating[] = [1, 2, 3, 4];
const GOOD: ReviewRating = 3;
const EASY: ReviewRating = 4;

export const RETENTIONS = [0.8, 0.85, 0.9, 0.95] as const;
export const DEFAULT_RETENTION = 0.9;

const DAY = 24 * 60 * 60 * 1000;
/** A self-check just before the mastered mark is the first review: its rating sets how well it starts. */
const CHECK_BEFORE_MASTERED = DAY;

/** Where the memory of marks with no date starts, kept in the settings once review is first on. */
export interface Baseline {
  /** Milliseconds since the epoch. */
  since: number;
  /** Days over which those marks come due, one concept after another. */
  spread: number;
}

/** Old marks come due a few a day: three a day, from one week up to two months. */
export function baselineSpread(count: number) {
  return Math.min(60, Math.max(7, Math.ceil(count / 3)));
}

export interface Schedule {
  id: string;
  /** When the current memory started: the mastered or known mark, or the baseline. */
  anchor: number;
  card: Card;
  /** When the concept should be reviewed, milliseconds since the epoch. */
  due: number;
  /** Reviews since the anchor. */
  reviews: number;
  /** The last review, or the anchor when there was none. */
  last: number;
}

/** FNV-1a: a stable number for an id, to spread old marks and seed the fuzz. */
export function hashId(id: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

interface Anchor {
  time: number;
  rating: ReviewRating;
  /** Days to the first review for a baseline, instead of FSRS's first interval. */
  days?: number;
}

const SEED = "tropaSeed";

/** Fuzz is seeded by the concept, so concepts marked in one batch still come due on different days. */
const seedStrategy: TSeedStrategy = function () {
  const seed: unknown = Reflect.get(this.current, SEED);
  return `${this.review_time.getTime()}_${this.current.reps}_${typeof seed === "number" ? seed : 0}`;
};

export class Scheduler {
  private readonly f: FSRS;
  private readonly decay: { decay: number; factor: number };

  constructor(readonly retention: number = DEFAULT_RETENTION) {
    const params = generatorParameters({
      request_retention: retention,
      enable_fuzz: true,
      // A concept is reviewed in days, not in minutes: no learning steps.
      enable_short_term: false,
      maximum_interval: 3650,
    });
    this.f = fsrs(params).useStrategy(StrategyMode.SEED, seedStrategy);
    this.decay = computeDecayFactor(params.w);
  }

  /**
   * The schedule of a concept from its journal entries (oldest first), or null when it has no
   * memory to review: never mastered, or unmastered since. `baseline` is used when it is mastered
   * but the journal does not say when.
   */
  schedule(id: string, entries: readonly JournalEntry[], baseline: Baseline | null): Schedule | null {
    let anchor: Anchor | null = null;
    let reviews: { time: number; rating: ReviewRating }[] = [];
    // An undone unmark gives back the memory it took, reviews included.
    let lost: { anchor: Anchor; reviews: typeof reviews } | null = null;
    let check: { time: number; rating: ReviewRating } | null = null;
    // Reviews of a mark that has no date: they count from the baseline on.
    let undated: typeof reviews = [];

    for (const entry of entries) {
      const undo = entry.flags.includes(UNDO);
      switch (entry.action) {
        case "mastered":
        case "known":
          if (undo && lost) {
            ({ anchor, reviews } = lost);
            lost = null;
            break;
          }
          anchor = {
            time: entry.time,
            rating: check && entry.time - check.time <= CHECK_BEFORE_MASTERED ? check.rating : entry.action === "known" ? EASY : GOOD,
          };
          reviews = [];
          undated = [];
          check = null;
          break;
        case "unmastered":
        case "skipped":
          if (anchor) lost = { anchor, reviews };
          anchor = null;
          reviews = [];
          undated = [];
          break;
        case "reviewed":
        case "checked": {
          if (undo) {
            if (anchor) reviews.pop();
            else {
              undated.pop();
              check = null;
            }
            break;
          }
          const rating = parseRating(entry.fields.rating);
          if (!rating) break;
          if (anchor) reviews.push({ time: entry.time, rating });
          else {
            undated.push({ time: entry.time, rating });
            if (entry.action === "checked") check = { time: entry.time, rating };
          }
          break;
        }
      }
    }

    if (!anchor && baseline) {
      anchor = { time: baseline.since, rating: GOOD, days: 1 + (hashId(id) % Math.max(1, baseline.spread)) };
      reviews = undated.filter((review) => review.time >= baseline.since);
    }
    if (!anchor) return null;

    const seed = hashId(id);
    let card = this.start(anchor, seed);
    let last = anchor.time;
    for (const review of reviews) {
      if (review.time < anchor.time) continue;
      card = { ...this.f.next(card, new Date(review.time), review.rating).card, [SEED]: seed } as Card;
      last = review.time;
    }
    return { id, anchor: anchor.time, card, due: card.due.getTime(), reviews: reviews.length, last };
  }

  /** The chance to recall the concept at `now`, 0 to 1. */
  retrievability(schedule: Schedule, now: number) {
    const elapsed = Math.max(0, (now - schedule.last) / DAY);
    const { decay, factor } = this.decay;
    return Math.pow(1 + (factor * elapsed) / Math.max(schedule.card.stability, 0.01), decay);
  }

  /** When the concept would come due after each rating given at `now`. */
  preview(schedule: Schedule, now: number): Record<ReviewRating, number> {
    const result = {} as Record<ReviewRating, number>;
    for (const rating of RATINGS) result[rating] = this.f.next(schedule.card, new Date(now), rating).card.due.getTime();
    return result;
  }

  private start(anchor: Anchor, seed: number): Card {
    const at = new Date(anchor.time);
    const empty = { ...createEmptyCard(at), [SEED]: seed } as Card;
    const first = { ...this.f.next(empty, at, anchor.rating).card, [SEED]: seed } as Card;
    if (anchor.days === undefined) return first;
    // A baseline mark comes due after its own number of days: its stability is set so that the
    // chance to recall falls to the target recall right then.
    const { decay, factor } = this.decay;
    const stability = (factor * anchor.days) / (Math.pow(this.retention, 1 / decay) - 1);
    return {
      ...first,
      state: State.Review,
      stability,
      scheduled_days: anchor.days,
      due: new Date(anchor.time + anchor.days * DAY),
      last_review: at,
    };
  }
}

export function parseRating(value: string | undefined): ReviewRating | null {
  const rating = Number(value);
  return rating === 1 || rating === 2 || rating === 3 || rating === 4 ? rating : null;
}
