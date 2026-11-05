import type { LearningGraph } from "./graph";

export type LinkKindName = "requires" | "recommends";

/** Where a suggested link was found: in the notes (list, link, mutual) or in a pasted outline (nest, order). */
export type LinkOrigin = "list" | "link" | "mutual" | "nest" | "order";

/** A link to add to a note: `from` gets `to` in its `requires` or `recommends`. Both are vault paths. */
export interface LinkEdit {
  from: string;
  to: string;
  kind: LinkKindName;
}

export interface LinkCandidate extends LinkEdit {
  origin: LinkOrigin;
  /** The note whose list the link comes from. */
  via?: string;
  /** Ticked when the preview opens. */
  checked: boolean;
}

/** The body of one note as the suggestions read it, with its links already resolved by the host. */
export interface NoteText {
  id: string;
  /** Links in the text to Markdown notes, in order, with the line each is on. Embeds are not links. */
  links: { to: string; line: number }[];
  /**
   * List items as Obsidian's cache gives them: the line of the item, and the line of its parent item,
   * or minus the line of the first item for an item at the top of its list.
   */
  lists: { line: number; parent: number }[];
}

export interface SuggestInput {
  /** The notes whose text is read. */
  notes: NoteText[];
  /** Link targets in the text of any note, so a link back can be seen outside the scope too. */
  linksOf: (id: string) => readonly string[];
  /** A note that can be a concept: not a material, not Tropa's own file, not left out of the map. */
  eligible: (id: string) => boolean;
  /** A target close enough for a link in the text: a concept on the map, or a note in the scope. Lists may point anywhere. */
  nearby: (id: string) => boolean;
  graph: LearningGraph;
}

/** A list counts as an ordered outline from this many items that link to a note. */
export const LIST_MIN_LINKS = 3;
/** More than this many suggestions are cut, so the preview stays usable; a smaller scope shows the rest. */
export const MAX_SUGGESTIONS = 500;

const ORIGIN_RANK: Record<LinkOrigin, number> = { list: 0, link: 1, mutual: 2, nest: 3, order: 4 };

/**
 * Links the notes already imply, as candidates for `requires` and `recommends`:
 * - list: consecutive items of a list with links to notes, each needs the one before it;
 * - link: a note links to another in its text and that note does not link back, so it is needed first;
 * - mutual: two notes link to each other, so neither clearly comes first: recommended.
 * A pair that is already linked either way is left out, and a pair is offered once, by the first origin above.
 */
export function suggestLinks(input: SuggestInput): { candidates: LinkCandidate[]; more: number } {
  const { graph, eligible, nearby } = input;
  const found: LinkCandidate[] = [];
  const pairs = new Set<string>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);
  const offer = (candidate: LinkCandidate) => {
    const { from, to } = candidate;
    if (from === to || !eligible(from) || !eligible(to) || linked(graph, from, to)) return;
    const key = pairKey(from, to);
    if (pairs.has(key)) return;
    pairs.add(key);
    found.push(candidate);
  };

  // Lists first, so a pair from a list keeps its direction against a link in the text.
  const listLines = new Map<string, Set<number>>();
  for (const note of input.notes) listLines.set(note.id, outlines(note, eligible, offer));

  for (const note of input.notes) {
    if (!eligible(note.id)) continue;
    const skip = listLines.get(note.id)!;
    for (const link of note.links) {
      if (skip.has(link.line) || link.to === note.id || !nearby(link.to)) continue;
      const back = input.linksOf(link.to).includes(note.id);
      offer(
        back
          ? { from: note.id, to: link.to, kind: "recommends", origin: "mutual", checked: false }
          : { from: note.id, to: link.to, kind: "requires", origin: "link", checked: false },
      );
    }
  }

  found.sort((a, b) => ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin]);
  return { candidates: found.slice(0, MAX_SUGGESTIONS), more: Math.max(0, found.length - MAX_SUGGESTIONS) };
}

/** Offers the links of the note's ordered lists and returns the lines they took, which the text heuristic then skips. */
function outlines(note: NoteText, eligible: (id: string) => boolean, offer: (candidate: LinkCandidate) => void) {
  const firstLink = new Map<number, string>();
  for (const link of note.links) if (!firstLink.has(link.line)) firstLink.set(link.line, link.to);
  const groups = new Map<number, number[]>();
  for (const item of note.lists) {
    const group = groups.get(item.parent);
    if (group) group.push(item.line);
    else groups.set(item.parent, [item.line]);
  }

  const taken = new Set<number>();
  for (const lines of groups.values()) {
    lines.sort((a, b) => a - b);
    const targets = lines.map((line) => {
      const to = firstLink.get(line);
      return to && to !== note.id && eligible(to) ? to : null;
    });
    if (targets.filter(Boolean).length < LIST_MIN_LINKS) continue;
    targets.forEach((to, index) => {
      if (to) taken.add(lines[index]);
      const before = index > 0 ? targets[index - 1] : null;
      // An item without a link breaks the chain: what comes after it is not known to follow.
      if (to && before && to !== before) offer({ from: to, to: before, kind: "requires", origin: "list", via: note.id, checked: true });
    });
  }
  return taken;
}

/** Already linked in either direction, hard or soft. */
export function linked(graph: LearningGraph, a: string, b: string) {
  const one = graph.nodes.get(a);
  const other = graph.nodes.get(b);
  return Boolean(one?.requires.includes(b) || one?.recommends.includes(b) || other?.requires.includes(a) || other?.recommends.includes(a));
}

export interface BatchRow extends LinkCandidate {
  /** The loop a `requires` link of this row would close, from the last time it was refused. */
  loop: string[] | null;
}

/**
 * Suggested links being chosen. A `requires` link is refused when, with the graph and the other
 * chosen links, it would close a loop; `recommends` never blocks, so it can always be chosen.
 */
export class LinkBatch {
  readonly rows: BatchRow[];

  constructor(private readonly graph: LearningGraph, candidates: LinkCandidate[]) {
    this.rows = candidates.map((candidate) => ({ ...candidate, checked: false, loop: null }));
    // Ticked ones are taken in order; one that would close a loop with those before it stays unticked.
    candidates.forEach((candidate, index) => {
      if (candidate.checked) this.set(index, true, candidate.kind);
    });
  }

  /** Ticks or unticks a row with a kind. Returns the loop when a `requires` link is refused; the row then stays unticked. */
  set(index: number, checked: boolean, kind: LinkKindName): string[] | null {
    const row = this.rows[index];
    if (checked && kind === "requires") {
      const loop = this.loop(row.from, row.to, index);
      row.loop = loop;
      if (loop) {
        row.checked = false;
        row.kind = kind;
        return loop;
      }
    } else row.loop = null;
    row.checked = checked;
    row.kind = kind;
    return null;
  }

  get chosen(): LinkEdit[] {
    return this.rows.filter((row) => row.checked).map(({ from, to, kind }) => ({ from, to, kind }));
  }

  /**
   * The loop that `from` requiring `to` would close, as a chain where each requires the next and the
   * last requires `from`: the new link first. Null when there is none. Row `except` is left out.
   */
  loop(from: string, to: string, except = -1): string[] | null {
    if (from === to) return [from];
    const extra = new Map<string, string[]>();
    this.rows.forEach((row, index) => {
      if (index === except || !row.checked || row.kind !== "requires") return;
      const list = extra.get(row.from);
      if (list) list.push(row.to);
      else extra.set(row.from, [row.to]);
    });
    const parent = new Map<string, string>([[to, from]]);
    const queue = [to];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      for (const next of [...(this.graph.nodes.get(id)?.requires ?? []), ...(extra.get(id) ?? [])]) {
        if (next === from) {
          const chain = [id];
          while (chain[0] !== to) chain.unshift(parent.get(chain[0])!);
          return [from, ...chain];
        }
        if (parent.has(next)) continue;
        parent.set(next, id);
        queue.push(next);
      }
    }
    return null;
  }
}
