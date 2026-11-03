import type { ReviewRating } from "./review";

/*
  Self-check questions live in the body of a concept's note as callouts:

    > [!question]- What does the gradient point to?
    > The direction of the steepest ascent.

  The title of the callout is the question and its body is the answer, folded or not. Tropa only
  reads them: the note is never changed.
*/

export interface Question {
  /** The callout's title, as Markdown. */
  question: string;
  /** The callout's body with one level of `>` taken off, as Markdown. May be empty. */
  answer: string;
  /** Line of the callout in the note, from 0. */
  line: number;
}

/** What Tropa needs of Obsidian's `SectionCache`. */
export interface SectionLike {
  type: string;
  position: { start: { line: number }; end: { line: number } };
}

export const DEFAULT_CALLOUT = "question";

/** A callout type as written in settings: `question`, `[!question]` or `!Question` all mean the same. */
export function calloutType(value: string | undefined) {
  const type = (value ?? "").trim().replace(/^\[?!?/, "").replace(/\]$/, "").trim().toLowerCase();
  return type || DEFAULT_CALLOUT;
}

/** `> [!type]` with an optional fold sign and title; the line belongs to the top level of the quote. */
const HEAD = /^[ \t]{0,3}>[ \t]?\[!([^\]\s]+)\][+-]?[ \t]*(.*)$/;
const QUOTE = /^[ \t]{0,3}>/;
const FENCE = /^[ \t]{0,3}(```|~~~)/;

/**
 * The questions of a note. With the sections from Obsidian's metadata cache only quotes and
 * callouts are looked at; without them (a note that is not indexed yet) the text is scanned,
 * outside code blocks and the front matter.
 */
export function parseQuestions(text: string, type: string, sections?: readonly SectionLike[] | null): Question[] {
  const lines = text.split(/\r?\n/);
  const wanted = calloutType(type);
  const blocks = sections ? blocksFromSections(sections, lines.length) : blocksFromText(lines);
  const questions: Question[] = [];
  for (const [start, end] of blocks) {
    let current: { question: string; line: number; body: string[] } | null = null;
    const flush = () => {
      if (current && current.question) questions.push({ question: current.question, answer: trimBlank(current.body).join("\n"), line: current.line });
      current = null;
    };
    for (let index = start; index <= end && index < lines.length; index++) {
      const line = lines[index];
      if (!QUOTE.test(line)) break;
      const head = HEAD.exec(line);
      if (head) {
        flush();
        if (head[1].toLowerCase() === wanted) current = { question: head[2].trim(), line: index, body: [] };
        continue;
      }
      current?.body.push(line.replace(/^[ \t]{0,3}>[ \t]?/, ""));
    }
    flush();
  }
  return questions;
}

function blocksFromSections(sections: readonly SectionLike[], count: number): [number, number][] {
  return sections
    .filter((section) => section.type === "callout" || section.type === "blockquote")
    .map((section) => [section.position.start.line, Math.min(section.position.end.line, count - 1)]);
}

function blocksFromText(lines: string[]): [number, number][] {
  const blocks: [number, number][] = [];
  let index = 0;
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
    if (close > 0) index = close + 1;
  }
  let fence: string | null = null;
  let start = -1;
  for (; index <= lines.length; index++) {
    const line = lines[index] ?? "";
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      if (marker === fence) fence = null;
      continue;
    }
    if (marker) {
      if (start >= 0) blocks.push([start, index - 1]);
      start = -1;
      fence = marker;
      continue;
    }
    const quoted = index < lines.length && QUOTE.test(line);
    if (quoted && start < 0) start = index;
    if (!quoted && start >= 0) {
      blocks.push([start, index - 1]);
      start = -1;
    }
  }
  return blocks;
}

function trimBlank(lines: string[]) {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines.slice(start, end);
}

/** How the person judged their own answer. */
export type Grade = "right" | "partly" | "wrong";
export const GRADES: readonly Grade[] = ["right", "partly", "wrong"];

/**
 * The FSRS rating a self-check earns. A partly right answer counts as half. Easy needs every one of
 * at least three questions right: one or two right answers say less than a recall that took no
 * effort, so they stay at Recalled. The person can still pick another rating before it is saved.
 */
export function suggestRating(grades: readonly Grade[]): ReviewRating {
  if (grades.length === 0) return 3;
  const score = grades.reduce((sum, grade) => sum + (grade === "right" ? 1 : grade === "partly" ? 0.5 : 0), 0) / grades.length;
  if (score === 1 && grades.length >= 3) return 4;
  if (score >= 0.75) return 3;
  if (score >= 0.4) return 2;
  return 1;
}

/** Right answers, a partly right one counting as half: "2.5 of 3". */
export function scoreOf(grades: readonly Grade[]) {
  return grades.reduce((sum, grade) => sum + (grade === "right" ? 1 : grade === "partly" ? 0.5 : 0), 0);
}
