import { t } from "../i18n";
import type { ConceptState, SourceFormat } from "./types";

export function formatMinutes(minutes: number) {
  if (minutes < 60) return t.minutes({ minutes: Math.round(minutes) });
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes - hours * 60);
  return rest ? t.hoursMinutes({ hours, minutes: rest }) : t.hours({ hours });
}

export const STATE_ICON: Record<ConceptState, string> = {
  mastered: "check",
  skipped: "skip-forward",
  learning: "book-open",
  available: "circle-dot",
  locked: "lock",
  cycle: "alert-triangle",
};

export const FORMAT_ICON: Record<SourceFormat, string> = {
  video: "video",
  article: "newspaper",
  book: "book",
  paper: "file-text",
  course: "graduation-cap",
  note: "pencil",
  other: "file",
};

const FORMATS = Object.keys(FORMAT_ICON) as SourceFormat[];

export function parseFormat(value: unknown): SourceFormat {
  return typeof value === "string" && (FORMATS as string[]).includes(value) ? (value as SourceFormat) : "other";
}

export function guessFormat(url: string): SourceFormat {
  const text = url.toLowerCase();
  if (/youtube\.com|youtu\.be|vimeo\.com|rutube\.ru/.test(text)) return "video";
  if (/arxiv\.org|doi\.org|\.pdf($|\?)/.test(text)) return "paper";
  if (/coursera\.org|stepik\.org|udemy\.com|edx\.org/.test(text)) return "course";
  return text ? "article" : "other";
}

const FORBIDDEN_IN_NAME = /[\\/:*?"<>|#^[\]]/g;

export function safeFileName(title: string) {
  return title.replace(FORBIDDEN_IN_NAME, " ").replace(/\s+/g, " ").trim();
}
