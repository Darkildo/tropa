export type NodeKind = "concept" | "source";

export type ConceptState = "mastered" | "learning" | "available" | "locked" | "cycle";
export type SourceState = "done" | "ready" | "locked";

export type SourceFormat = "video" | "article" | "book" | "paper" | "course" | "note" | "other";

/** A link found in frontmatter, already resolved by the host. */
export interface NoteRef {
  /** Vault path, or `ghost:<title>` when the note does not exist yet. */
  id: string;
  title: string;
}

/** What the graph needs to know about one note. Free of any Obsidian type. */
export interface NoteInput {
  id: string;
  title: string;
  kind: NodeKind;
  requires: NoteRef[];
  recommends: NoteRef[];
  teaches: NoteRef[];
  format?: SourceFormat;
  minutes?: number;
  url?: string;
  summary?: string;
}

export interface GraphNode {
  id: string;
  title: string;
  kind: NodeKind;
  ghost: boolean;
  /** Hard prerequisites. Concepts point at concepts, sources at concepts or sources. */
  requires: string[];
  /** Reverse of `requires`. */
  requiredBy: string[];
  /** Soft links: useful but never blocking. Cycles are allowed here. */
  recommends: string[];
  /** Source: the concepts it teaches. */
  teaches: string[];
  /** Concept: the sources that teach it. */
  taughtBy: string[];
  format?: SourceFormat;
  minutes?: number;
  url?: string;
  summary?: string;
}

export interface Progress {
  goal: string | null;
  mastered: Set<string>;
  learning: Set<string>;
  /** Finished sources. */
  done: Set<string>;
}

export interface RouteStep {
  id: string;
  state: ConceptState;
  /** Recommended material for this step, if any. */
  material: string | null;
}

export interface Route {
  goal: string;
  /** Everything the goal depends on, mastered parts included. */
  closure: Set<string>;
  /** Unmastered concepts in the order they should be studied. */
  steps: RouteStep[];
  /** First step that can be started right now. */
  next: string | null;
  masteredCount: number;
  total: number;
  /** Sum of the recommended materials' durations. */
  remainingMinutes: number;
  /** Steps with no estimate, so the total above is a lower bound. */
  unestimated: number;
  /** Steps with no material at all. */
  gaps: string[];
}
