import { parse } from "yaml";
import { LearningGraph } from "../src/core/graph";
import type { NoteInput, NoteRef, SourceFormat } from "../src/core/types";
import { sample } from "../src/sample";

export interface BenchCase {
  name: string;
  graph: LearningGraph;
  showSources: boolean;
}

/** Small, fast and deterministic. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FORMATS: SourceFormat[] = ["video", "article", "book", "paper", "course", "note"];

/**
 * A map shaped like the hand-made ones: topics build on recent topics, a few roots, now and then a
 * link back to something learnt long ago. Concepts require 1–3 earlier concepts, recommend 0–1
 * others; about 0.7 materials per concept, each teaching one concept and sometimes requiring one.
 */
export function generate(concepts: number, materials: boolean, seed = 7): NoteInput[] {
  const random = mulberry32(seed * 1_000_003 + concepts);
  const pick = (n: number) => Math.floor(random() * n);
  const conceptId = (i: number) => `c/${i}`;
  const ref = (id: string): NoteRef => ({ id, title: id });
  const notes: NoteInput[] = [];
  const roots = Math.max(3, Math.round(concepts * 0.04));

  for (let i = 0; i < concepts; i++) {
    const requires = new Set<number>();
    if (i >= roots) {
      const count = 1 + pick(3);
      for (let k = 0; k < count; k++) {
        // Mostly the last few dozen topics, sometimes anything before.
        const back = random() < 0.8 ? 1 + pick(Math.min(i, 24)) : 1 + pick(i);
        requires.add(i - back);
      }
    }
    const recommends = random() < 0.5 ? [ref(conceptId(pick(concepts)))].filter((r) => r.id !== conceptId(i)) : [];
    notes.push({
      id: conceptId(i),
      title: `Concept ${i}`,
      kind: "concept",
      requires: [...requires].map((r) => ref(conceptId(r))),
      recommends,
      teaches: [],
    });
  }

  if (materials) {
    const count = Math.round(concepts * 0.7);
    for (let i = 0; i < count; i++) {
      const taught = new Set([pick(concepts)]);
      if (random() < 0.2) taught.add(pick(concepts));
      const requires = random() < 0.3 ? [ref(conceptId(pick(concepts)))] : [];
      notes.push({
        id: `s/${i}`,
        title: `Material ${i}`,
        kind: "source",
        requires,
        recommends: [],
        teaches: [...taught].map((t) => ref(conceptId(t))),
        format: FORMATS[pick(FORMATS.length)],
        minutes: 10 + pick(300),
      });
    }
  }
  return notes;
}

/** The example map that ships with the plugin, read the way the store reads notes. */
export function sampleNotes(): NoteInput[] {
  const { files } = sample("en");
  const byTitle = new Map(files.map((file) => [file.path.split("/").pop()!.replace(/\.md$/, ""), file.path]));
  const refs = (value: unknown): NoteRef[] =>
    (Array.isArray(value) ? value : []).map((link) => {
      const title = String(link).replace(/^\[\[|\]\]$/g, "");
      return { id: byTitle.get(title) ?? `ghost:${title}`, title };
    });
  return files.map((file) => {
    const front = parse(file.content.split("---")[1]) as Record<string, unknown>;
    return {
      id: file.path,
      title: file.path.split("/").pop()!.replace(/\.md$/, ""),
      kind: front.type === "source" ? "source" : "concept",
      requires: refs(front.requires),
      recommends: refs(front.recommends),
      teaches: refs(front.teaches),
    };
  });
}

export const SIZES = [100, 200, 400, 1000];

export function benchCases(sizes = SIZES): BenchCase[] {
  const cases: BenchCase[] = [
    { name: "sample", graph: new LearningGraph(sampleNotes()), showSources: false },
    { name: "sample+m", graph: new LearningGraph(sampleNotes()), showSources: true },
  ];
  for (const size of sizes) {
    cases.push({ name: `${size}`, graph: new LearningGraph(generate(size, false)), showSources: false });
    cases.push({ name: `${size}+m`, graph: new LearningGraph(generate(size, true)), showSources: true });
  }
  return cases;
}
