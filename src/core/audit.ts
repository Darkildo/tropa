import type { LearningGraph } from "./graph";
import type { GraphNode } from "./types";

/** What on the map needs a look. Built from the graph alone: links, ghosts and the cycles it found. */
export interface Audit {
  /** Concepts with a note and links, but nothing that teaches them. */
  noMaterials: string[];
  /** Notes on the map with no link to or from anything. A lone concept is here, not under `noMaterials`. */
  orphans: string[];
  /** Concepts other notes link to that have no note, with how many notes link to each. */
  ghosts: { id: string; linkedFrom: number }[];
  /** Notes of one kind whose names differ only in case, accents or spacing. A ghost counts as a concept. */
  duplicates: string[][];
  /** Each dependency cycle as a chain: every concept requires the next, and the last requires the first. */
  cycles: string[][];
  /** Concepts with a note but no self-check questions; empty unless the audit was asked to look. */
  noQuestions: string[];
}

/** `questions` counts the self-check questions of a concept; without it the audit leaves them out. */
export function auditGraph(graph: LearningGraph, questions?: (id: string) => number): Audit {
  const recommendedBy = new Map<string, Set<string>>();
  for (const node of graph.nodes.values()) {
    for (const id of node.recommends) {
      const from = recommendedBy.get(id) ?? new Set();
      from.add(node.id);
      recommendedBy.set(id, from);
    }
  }
  const byTitle = (ids: string[]) => ids.sort((a, b) => compareTitles(graph.nodes.get(a)!, graph.nodes.get(b)!));

  const orphans: string[] = [];
  const noMaterials: string[] = [];
  const ghosts: Audit["ghosts"] = [];
  const noQuestions: string[] = [];
  for (const node of graph.nodes.values()) {
    if (node.ghost) {
      const from = new Set([...node.requiredBy, ...node.taughtBy, ...(recommendedBy.get(node.id) ?? [])]);
      ghosts.push({ id: node.id, linkedFrom: from.size });
      continue;
    }
    const linked =
      node.requires.length || node.requiredBy.length || node.recommends.length || node.teaches.length || node.taughtBy.length || recommendedBy.has(node.id);
    if (!linked) orphans.push(node.id);
    else if (node.kind === "concept" && node.taughtBy.length === 0) noMaterials.push(node.id);
    if (questions && node.kind === "concept" && !questions(node.id)) noQuestions.push(node.id);
  }

  const groups = new Map<string, string[]>();
  for (const node of graph.nodes.values()) {
    const key = `${node.kind}\0${normalizeTitle(node.title)}`;
    const group = groups.get(key);
    if (group) group.push(node.id);
    else groups.set(key, [node.id]);
  }
  const duplicates = [...groups.values()].filter((group) => group.length > 1).map(byTitle);
  duplicates.sort((a, b) => compareTitles(graph.nodes.get(a[0])!, graph.nodes.get(b[0])!));

  ghosts.sort((a, b) => b.linkedFrom - a.linkedFrom || compareTitles(graph.nodes.get(a.id)!, graph.nodes.get(b.id)!));

  return {
    noMaterials: byTitle(noMaterials),
    orphans: byTitle(orphans),
    ghosts,
    duplicates,
    cycles: graph.cycles.map((component) => cycleChain(graph, component)),
    noQuestions: byTitle(noQuestions),
  };
}

/** How many findings the audit has, a cycle or a group of duplicates counting once. */
export function auditCount(audit: Audit) {
  return (
    audit.noMaterials.length + audit.orphans.length + audit.ghosts.length + audit.duplicates.length + audit.cycles.length + audit.noQuestions.length
  );
}

/** A name for comparing: no case, no accents or other marks, single spaces. */
export function normalizeTitle(title: string) {
  return title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * One loop through a group of concepts that require each other, starting at its first member:
 * the shortest way back to it along `requires` links inside the group.
 */
export function cycleChain(graph: LearningGraph, component: string[]): string[] {
  const start = component[0];
  const members = new Set(component);
  const parent = new Map<string, string>();
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const next of graph.nodes.get(id)!.requires) {
      if (!members.has(next)) continue;
      if (next === start) {
        const chain = [id];
        while (chain[0] !== start) chain.unshift(parent.get(chain[0])!);
        return chain;
      }
      if (parent.has(next)) continue;
      parent.set(next, id);
      queue.push(next);
    }
  }
  return [start];
}

function compareTitles(a: GraphNode, b: GraphNode) {
  return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}
