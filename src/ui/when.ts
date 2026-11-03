import { locale } from "../i18n";

const DAY = 24 * 60 * 60 * 1000;

/** "12 November", with the year when it is not this one. */
export function formatDate(time: number, now = Date.now()) {
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) }).format(date);
}

/** "today", "in 3 days", "2 weeks ago": whole days, from the calendar day of `now`. */
export function formatRelative(time: number, now = Date.now()) {
  const startOf = (value: number) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const days = Math.round((startOf(time) - startOf(now)) / DAY);
  const format = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  const size = Math.abs(days);
  if (size < 14) return format.format(days, "day");
  if (size < 60) return format.format(Math.round(days / 7), "week");
  if (size < 730) return format.format(Math.round(days / 30), "month");
  return format.format(Math.round(days / 365), "year");
}

/** A short interval for a button: "1 day", "3 wks", "2 mths". */
export function formatInterval(time: number, now = Date.now()) {
  const days = Math.max(1, Math.round((time - now) / DAY));
  const unit = days < 14 ? "day" : days < 60 ? "week" : days < 730 ? "month" : "year";
  const value = unit === "day" ? days : unit === "week" ? Math.round(days / 7) : unit === "month" ? Math.round(days / 30) : Math.round(days / 365);
  return new Intl.NumberFormat(locale(), { style: "unit", unit, unitDisplay: "short" }).format(value);
}

export function formatPercent(value: number) {
  return new Intl.NumberFormat(locale(), { style: "percent", maximumFractionDigits: 0 }).format(value);
}
