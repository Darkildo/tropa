import type { LearningGraph } from "./graph";

export const MAX_FOCUS_DEPTH = 3;

/**
 * Concepts within `depth` links of `center`: what it needs, what it opens and soft links either way.
 * A material counts as one step away from the concepts it teaches and needs.
 */
export function neighborhood(graph: LearningGraph, center: string, depth: number): Set<string> {
  const start = graph.nodes.get(center);
  const found = new Set<string>();
  if (!start) return found;
  const recommendedBy = new Map<string, string[]>();
  for (const node of graph.nodes.values()) {
    if (node.kind !== "concept") continue;
    for (const id of node.recommends) push(recommendedBy, id, node.id);
  }
  const isConcept = (id: string) => graph.nodes.get(id)?.kind === "concept";

  let frontier: string[];
  let steps = depth;
  if (start.kind === "concept") {
    found.add(center);
    frontier = [center];
  } else {
    frontier = [...new Set([...start.teaches, ...start.requires])].filter(isConcept);
    frontier.forEach((id) => found.add(id));
    steps -= 1;
  }
  for (let step = 0; step < steps && frontier.length; step++) {
    const next: string[] = [];
    for (const id of frontier) {
      const node = graph.nodes.get(id)!;
      for (const other of [...node.requires, ...node.requiredBy, ...node.recommends, ...(recommendedBy.get(id) ?? [])]) {
        if (found.has(other) || !isConcept(other)) continue;
        found.add(other);
        next.push(other);
      }
    }
    frontier = next;
  }
  return found;
}

export interface Folded {
  /** Concepts of `base` left out because they need a folded concept. */
  hidden: Set<string>;
  /** For each folded concept, how many of the hidden ones need it. */
  counts: Map<string, number>;
}

/**
 * Folding a concept hides everything that needs it, transitively: prerequisites are all required, so
 * none of that can be learned before the folded concept. Two folded concepts in one cycle hide each
 * other's branch but stay visible themselves, so they can always be unfolded.
 */
export function fold(graph: LearningGraph, base: Set<string>, folded: Iterable<string>): Folded {
  const roots = [...folded].filter((id) => base.has(id));
  const below = new Map(roots.map((id) => [id, graph.descendants(id)]));
  const hidden = new Set<string>();
  below.forEach((ids) => ids.forEach((id) => base.has(id) && !below.has(id) && hidden.add(id)));
  for (const [id, ids] of below) {
    if (roots.some((other) => other !== id && below.get(other)!.has(id) && !ids.has(other))) hidden.add(id);
  }
  const counts = new Map<string, number>();
  for (const [id, ids] of below) {
    let count = 0;
    ids.forEach((other) => hidden.has(other) && count++);
    counts.set(id, count);
  }
  return { hidden, counts };
}

/** The folded concepts that keep `id` out of sight. */
export function foldersOf(graph: LearningGraph, folded: Iterable<string>, id: string): string[] {
  return [...folded].filter((folder) => folder !== id && graph.descendants(folder).has(id));
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
