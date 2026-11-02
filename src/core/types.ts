export type NodeKind = "concept" | "source";

export type ConceptState = "mastered" | "skipped" | "learning" | "available" | "locked" | "cycle";
export type SourceState = "done" | "ready" | "locked";

export type SourceFormat = "video" | "article" | "book" | "paper" | "course" | "note" | "other";

/** A link found in frontmatter, already resolved by the host. */
export interface NoteRef {
  /** Vault path, or `ghost:<title>` when the note does not exist yet. */
  id: string;
  title: string;
}

/** A material listed inside a concept, with its link already resolved by the host. */
export interface InlineMaterial {
  /** `material:` and the normalized URL or the vault path of the attachment. */
  id: string;
  title: string;
  url?: string;
  /** Vault path of an attachment, when the link resolves to a file. */
  file?: string;
  format: SourceFormat;
  minutes?: number;
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
  /** Concept: materials listed in the concept itself instead of separate notes. */
  materials?: InlineMaterial[];
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
  /** A material that lives in a concept's `materials` list and has no note of its own. */
  inline?: boolean;
  /** Inline material: vault path of the attachment it points to. */
  file?: string;
}

export interface Progress {
  goal: string | null;
  mastered: Set<string>;
  learning: Set<string>;
  /** Finished sources. */
  done: Set<string>;
  /** Concepts left out on purpose: they open what depends on them but never count as mastered. */
  skipped: Set<string>;
  /** Optional self-assessment from 1 to 5, kept for mastered and learning concepts only. */
  confidence: Map<string, number>;
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
  /** Concepts to master for the goal: the closure without skipped ones. */
  total: number;
  skippedCount: number;
  /** Sum of the recommended materials' durations. */
  remainingMinutes: number;
  /** Steps with no estimate, so the total above is a lower bound. */
  unestimated: number;
  /** Steps with no material at all. */
  gaps: string[];
}
