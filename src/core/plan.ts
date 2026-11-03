import type { Route } from "./types";

const DAY = 24 * 60 * 60 * 1000;

/** What the time left means against a pace and a deadline. Dates are local calendar days. */
export interface Forecast {
  /** Hours of study left, from the materials with a duration. */
  hours: number;
  /** Steps whose material has no duration, so the hours above are a lower bound. */
  unestimated: number;
  /** At the planned pace, the day the route is done. */
  finish: Date | null;
  deadline: Date | null;
  /** Hours a week needed to finish by the deadline. */
  needed: number | null;
  /** The deadline is before today. */
  overdue: boolean;
  /** The planned pace finishes on or before the deadline. */
  onTrack: boolean | null;
}

/** Midnight of the given day in local time. */
export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** A YYYY-MM-DD string as a local date. */
export function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whole days from one local date to another; daylight saving changes do not shift the count. */
function daysBetween(from: Date, to: Date) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);
}

/**
 * The finish date at `paceHours` a week, counted from today, and the pace a deadline asks for.
 * The deadline day itself is counted as a day to study.
 */
export function forecast(
  route: Pick<Route, "remainingMinutes" | "unestimated" | "steps">,
  paceHours: number | null,
  deadline: string | null,
  today: Date,
): Forecast {
  const hours = route.remainingMinutes / 60;
  const start = startOfDay(today);
  const finish =
    paceHours && paceHours > 0 && route.steps.length > 0
      ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + Math.ceil((hours / paceHours) * 7))
      : null;
  const due = deadline ? parseDate(deadline) : null;
  const overdue = due ? daysBetween(start, due) < 0 : false;
  const days = due && !overdue ? daysBetween(start, due) + 1 : 0;
  const needed = due && !overdue && hours > 0 ? hours / (days / 7) : null;
  const onTrack = finish && due && !overdue ? finish.getTime() <= due.getTime() : null;
  return { hours, unestimated: route.unestimated, finish, deadline: due, needed, overdue, onTrack };
}

/** A pace as people say it: whole hours above 10, otherwise up to one decimal, rounded up so it is enough. */
export function roundPace(hours: number) {
  return hours >= 10 ? Math.ceil(hours) : Math.ceil(hours * 10) / 10;
}

/** "5", "2.5" or "2,5" hours a week; empty means no pace. Anything else is `NaN`. */
export function parsePace(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (!text) return null;
  const hours = Number(text);
  return Number.isFinite(hours) && hours > 0 && hours <= 168 ? hours : Number.NaN;
}
