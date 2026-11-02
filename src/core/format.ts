import type { ConceptState, SourceFormat } from "./types";

export function plural(count: number, one: string, few: string, many: string) {
  const tens = Math.abs(count) % 100;
  const units = tens % 10;
  if (tens > 10 && tens < 20) return many;
  if (units === 1) return one;
  if (units >= 2 && units <= 4) return few;
  return many;
}

export function formatMinutes(minutes: number) {
  if (minutes < 60) return `${Math.round(minutes)} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes - hours * 60);
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

export const STATE_LABEL: Record<ConceptState, string> = {
  mastered: "Освоено",
  learning: "Изучаю",
  available: "Можно начинать",
  locked: "Закрыто",
  cycle: "Цикл",
};

export const STATE_ICON: Record<ConceptState, string> = {
  mastered: "check",
  learning: "book-open",
  available: "circle-dot",
  locked: "lock",
  cycle: "alert-triangle",
};

export const FORMAT_LABEL: Record<SourceFormat, string> = {
  video: "Видео",
  article: "Статья",
  book: "Книга",
  paper: "Научная статья",
  course: "Курс",
  note: "Своя заметка",
  other: "Другое",
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

const FORMATS = Object.keys(FORMAT_LABEL) as SourceFormat[];

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
