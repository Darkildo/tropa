import { describe, expect, it } from "vitest";
import { calloutType, parseQuestions, scoreOf, suggestRating, type Grade, type SectionLike } from "../src/core/questions";
import { sample } from "../src/sample";

const note = `---
type: concept
summary: "> [!question]- Not a question: this is front matter"
---

The direction of the steepest ascent.

> [!question]- Where does the gradient point?
> Towards the fastest growth.
>
> - nested **Markdown** stays
> > [!tip] a callout inside the answer
> > stays in the answer

> [!question]+ Unfolded question
> Its answer

> [!QUESTION] Any case, no fold sign
> Yes

> [!note] Not a question
> Ignored

\`\`\`
> [!question]- Inside a code block
> ignored
\`\`\`

> [!question]- No answer at all

> [!question]-
> A callout with no title is not a question
`;

describe("self-check questions in a note", () => {
  it("reads question callouts, folded or not, in any case", () => {
    const questions = parseQuestions(note, "question");
    expect(questions.map((question) => question.question)).toEqual([
      "Where does the gradient point?",
      "Unfolded question",
      "Any case, no fold sign",
      "No answer at all",
    ]);
  });

  it("keeps the answer's Markdown, nested callouts included, one level of quote taken off", () => {
    const [first, second, , empty] = parseQuestions(note, "question");
    expect(first.answer).toBe("Towards the fastest growth.\n\n- nested **Markdown** stays\n> [!tip] a callout inside the answer\n> stays in the answer");
    expect(second.answer).toBe("Its answer");
    expect(empty.answer).toBe("");
    expect(first.line).toBe(7);
  });

  it("with sections from the metadata cache, looks only at quotes", () => {
    const lines = note.split("\n");
    const at = (text: string) => lines.findIndex((line) => line.includes(text));
    const sections: SectionLike[] = [
      { type: "paragraph", position: { start: { line: 5 }, end: { line: 5 } } },
      { type: "callout", position: { start: { line: at("Where does") }, end: { line: at("stays in the answer") } } },
      { type: "code", position: { start: { line: at("Inside a code") - 1 }, end: { line: at("Inside a code") + 2 } } },
      { type: "callout", position: { start: { line: at("No answer at all") }, end: { line: at("No answer at all") } } },
    ];
    expect(parseQuestions(note, "question", sections).map((question) => question.question)).toEqual(["Where does the gradient point?", "No answer at all"]);
  });

  it("follows the callout type from the settings", () => {
    expect(parseQuestions(note, "note").map((question) => question.question)).toEqual(["Not a question"]);
    expect(calloutType("[!Faq]")).toBe("faq");
    expect(calloutType(" !question ")).toBe("question");
    expect(calloutType("")).toBe("question");
  });

  it("reads Windows line ends", () => {
    expect(parseQuestions("> [!question]- Q\r\n> A\r\n", "question")).toEqual([{ question: "Q", answer: "A", line: 0 }]);
  });

  it("finds the questions of the example map", () => {
    for (const language of ["en", "ru"] as const) {
      const files = sample(language).files.filter((file) => file.content.includes("[!question]"));
      expect(files.length).toBeGreaterThanOrEqual(4);
      for (const file of files) {
        const questions = parseQuestions(file.content, "question");
        expect(questions.length).toBeGreaterThan(0);
        for (const question of questions) expect(question.answer).not.toBe("");
      }
    }
  });
});

describe("rating from the answers", () => {
  const grades = (text: string) => [...text].map((c): Grade => (c === "r" ? "right" : c === "p" ? "partly" : "wrong"));

  it.each([
    ["rrr", 4],
    ["rrrr", 4],
    ["r", 3],
    ["rr", 3],
    ["rrrp", 3],
    ["rrw", 2],
    ["p", 2],
    ["rw", 2],
    ["pw", 1],
    ["w", 1],
    ["www", 1],
  ])("%s → %i", (text, rating) => {
    expect(suggestRating(grades(text))).toBe(rating);
  });

  it("counts a partly right answer as half", () => {
    expect(scoreOf(grades("rpw"))).toBe(1.5);
  });

  it("with no answers suggests Recalled", () => {
    expect(suggestRating([])).toBe(3);
  });
});
