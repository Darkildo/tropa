import { normalizeUrl } from "./materials";
import type {
  ConceptState,
  GraphNode,
  NoteInput,
  NoteRef,
  Progress,
  Route,
  RouteStep,
  SourceState,
} from "./types";

export const GHOST_PREFIX = "ghost:";

export const isGhostId = (id: string) => id.startsWith(GHOST_PREFIX);
export const ghostId = (title: string) => GHOST_PREFIX + title;

export function emptyProgress(): Progress {
  return {
    goal: null,
    goals: [],
    allGoals: false,
    deadlines: new Map(),
    paceHours: null,
    mastered: new Set(),
    learning: new Set(),
    done: new Set(),
    skipped: new Set(),
    confidence: new Map(),
  };
}

export function cloneProgress(progress: Progress): Progress {
  return {
    goal: progress.goal,
    goals: [...progress.goals],
    allGoals: progress.allGoals,
    deadlines: new Map(progress.deadlines),
    paceHours: progress.paceHours,
    mastered: new Set(progress.mastered),
    learning: new Set(progress.learning),
    done: new Set(progress.done),
    skipped: new Set(progress.skipped),
    confidence: new Map(progress.confidence),
  };
}

/** The same marks, goal and confidence, whatever order the lists were read in. */
export function sameProgress(a: Progress, b: Progress) {
  const sameSet = (x: Set<string>, y: Set<string>) => x.size === y.size && [...x].every((id) => y.has(id));
  const sameMap = <V>(x: Map<string, V>, y: Map<string, V>) => x.size === y.size && [...x].every(([id, value]) => y.get(id) === value);
  // A goal missing from the list is still a goal: files from before the list read that way.
  const [goalsA, goalsB] = [allGoalsOf(a), allGoalsOf(b)];
  return (
    a.goal === b.goal &&
    goalsA.length === goalsB.length &&
    goalsA.every((id, index) => goalsB[index] === id) &&
    a.allGoals === b.allGoals &&
    a.paceHours === b.paceHours &&
    sameMap(a.deadlines, b.deadlines) &&
    sameSet(a.mastered, b.mastered) &&
    sameSet(a.learning, b.learning) &&
    sameSet(a.done, b.done) &&
    sameSet(a.skipped, b.skipped) &&
    sameMap(a.confidence, b.confidence)
  );
}

/** Every goal kept, the active one included even when an older file or a hand edit left it out of the list. */
export function allGoalsOf(progress: Progress): string[] {
  const goals = [...progress.goals];
  if (progress.goal && !goals.includes(progress.goal)) goals.push(progress.goal);
  return goals;
}

export function isGoal(progress: Progress, id: string) {
  return progress.goal === id || progress.goals.includes(id);
}

/** What the route leads to: the active goal, or every goal when the route goes to all of them. */
export function routeTargets(progress: Progress): string[] {
  if (progress.allGoals) return allGoalsOf(progress);
  return progress.goal ? [progress.goal] : [];
}

/** A concept no longer stands in the way: mastered, or skipped on purpose. */
export function isPassed(progress: Progress, id: string) {
  return progress.mastered.has(id) || progress.skipped.has(id);
}

export class LearningGraph {
  readonly nodes = new Map<string, GraphNode>();
  /** Strongly connected groups of `requires` links. Each one can never be finished in order. */
  readonly cycles: string[][] = [];
  private readonly inCycle = new Set<string>();

  constructor(notes: NoteInput[]) {
    for (const note of notes) {
      this.nodes.set(note.id, {
        id: note.id,
        title: note.title,
        kind: note.kind,
        ghost: false,
        requires: [],
        requiredBy: [],
        recommends: [],
        teaches: [],
        taughtBy: [],
        format: note.format,
        minutes: note.minutes,
        url: note.url,
        summary: note.summary,
      });
    }

    const ensure = (ref: NoteRef) => {
      if (!this.nodes.has(ref.id)) {
        this.nodes.set(ref.id, {
          id: ref.id,
          title: ref.title,
          kind: "concept",
          ghost: true,
          requires: [],
          requiredBy: [],
          recommends: [],
          teaches: [],
          taughtBy: [],
        });
      }
      return ref.id;
    };

    for (const note of notes) {
      if (note.kind !== "source") continue;
      const node = this.nodes.get(note.id)!;
      for (const ref of note.teaches) {
        const id = ensure(ref);
        const target = this.nodes.get(id)!;
        if (target.kind !== "concept" || id === note.id) continue;
        pushUnique(node.teaches, id);
        pushUnique(target.taughtBy, note.id);
      }
    }

    this.attachInlineMaterials(notes);

    for (const note of notes) {
      const node = this.nodes.get(note.id)!;
      for (const ref of note.requires) {
        const id = ensure(ref);
        const target = this.nodes.get(id)!;
        // A concept cannot wait for a source directly: it waits for what the source teaches.
        const prerequisites = note.kind === "concept" && target.kind === "source" ? target.teaches : [id];
        for (const prerequisite of prerequisites) pushUnique(node.requires, prerequisite);
      }
      for (const ref of note.recommends) pushUnique(node.recommends, ensure(ref));
    }

    for (const node of this.nodes.values()) {
      for (const id of node.requires) pushUnique(this.nodes.get(id)!.requiredBy, node.id);
    }

    this.findCycles();
  }

  /**
   * Materials listed in a concept become source nodes. One that is already a material
   * note, by its link or by the same URL, is shown as that note instead of twice.
   */
  private attachInlineMaterials(notes: NoteInput[]) {
    const byUrl = new Map<string, string>();
    for (const note of notes) if (note.kind === "source" && note.url) byUrl.set(normalizeUrl(note.url), note.id);

    for (const note of notes) {
      if (note.kind !== "concept" || !note.materials?.length) continue;
      const concept = this.nodes.get(note.id)!;
      for (const material of note.materials) {
        const existing =
          (material.file && this.nodes.get(material.file)?.kind === "source" ? material.file : undefined) ??
          (material.url ? byUrl.get(normalizeUrl(material.url)) : undefined);
        const id = existing ?? material.id;
        let source = this.nodes.get(id);
        if (!source) {
          source = {
            id,
            title: material.title,
            kind: "source",
            ghost: false,
            inline: true,
            requires: [],
            requiredBy: [],
            recommends: [],
            teaches: [],
            taughtBy: [],
            format: material.format,
            minutes: material.minutes,
            url: material.url,
            file: material.file,
          };
          this.nodes.set(id, source);
        } else if (source.inline) {
          // The same link in several concepts: the first title wins, a later estimate fills a gap.
          source.minutes ??= material.minutes;
        }
        if (source.kind !== "source") continue;
        pushUnique(source.teaches, concept.id);
        pushUnique(concept.taughtBy, id);
      }
    }
  }

  get concepts(): GraphNode[] {
    return [...this.nodes.values()].filter((node) => node.kind === "concept");
  }

  get sources(): GraphNode[] {
    return [...this.nodes.values()].filter((node) => node.kind === "source");
  }

  isInCycle(id: string) {
    return this.inCycle.has(id);
  }

  /** Every node that `id` depends on, transitively, without `id` itself. */
  ancestors(id: string): Set<string> {
    return this.walk(id, (node) => node.requires);
  }

  /** Every node that depends on `id`, transitively, without `id` itself. */
  descendants(id: string): Set<string> {
    return this.walk(id, (node) => node.requiredBy);
  }

  /** True when `dependent` requiring `prerequisite` would close a loop. */
  wouldCreateCycle(dependent: string, prerequisite: string) {
    return dependent === prerequisite || this.ancestors(prerequisite).has(dependent);
  }

  private walk(id: string, next: (node: GraphNode) => string[]) {
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const node = this.nodes.get(stack.pop()!);
      if (!node) continue;
      for (const neighbour of next(node)) {
        if (seen.has(neighbour) || neighbour === id) continue;
        seen.add(neighbour);
        stack.push(neighbour);
      }
    }
    return seen;
  }

  /** Iterative Tarjan, so a very long chain of notes cannot overflow the stack. */
  private findCycles() {
    let counter = 0;
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];

    for (const root of this.nodes.keys()) {
      if (index.has(root)) continue;
      const work: { id: string; next: number }[] = [{ id: root, next: 0 }];
      while (work.length) {
        const frame = work[work.length - 1];
        if (frame.next === 0) {
          index.set(frame.id, counter);
          low.set(frame.id, counter);
          counter++;
          stack.push(frame.id);
          onStack.add(frame.id);
        }
        const requires = this.nodes.get(frame.id)!.requires;
        if (frame.next < requires.length) {
          const neighbour = requires[frame.next++];
          if (!index.has(neighbour)) {
            work.push({ id: neighbour, next: 0 });
          } else if (onStack.has(neighbour)) {
            low.set(frame.id, Math.min(low.get(frame.id)!, index.get(neighbour)!));
          }
          continue;
        }
        work.pop();
        const parent = work[work.length - 1];
        if (parent) low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
        if (low.get(frame.id) !== index.get(frame.id)) continue;

        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.id);

        const selfLoop = this.nodes.get(frame.id)!.requires.includes(frame.id);
        if (component.length > 1 || selfLoop) {
          this.cycles.push(component.reverse());
          component.forEach((id) => this.inCycle.add(id));
        }
      }
    }
  }
}

function pushUnique(list: string[], value: string) {
  if (!list.includes(value)) list.push(value);
}

export function computeStates(graph: LearningGraph, progress: Progress) {
  const states = new Map<string, ConceptState>();
  for (const node of graph.concepts) {
    if (progress.mastered.has(node.id)) states.set(node.id, "mastered");
    else if (progress.skipped.has(node.id)) states.set(node.id, "skipped");
    else if (graph.isInCycle(node.id)) states.set(node.id, "cycle");
    else if (progress.learning.has(node.id) || node.taughtBy.some((id) => progress.done.has(id))) states.set(node.id, "learning");
    else if (node.requires.every((id) => isPassed(progress, id))) states.set(node.id, "available");
    else states.set(node.id, "locked");
  }
  return states;
}

export function sourceState(graph: LearningGraph, progress: Progress, id: string): SourceState {
  if (progress.done.has(id)) return "done";
  const node = graph.nodes.get(id);
  if (!node) return "locked";
  const ready = node.requires.every((requirement) =>
    graph.nodes.get(requirement)?.kind === "source" ? progress.done.has(requirement) : isPassed(progress, requirement),
  );
  return ready ? "ready" : "locked";
}

/** Picks what to study a concept from: ready sources first, then the shortest. */
export function recommendMaterial(graph: LearningGraph, progress: Progress, conceptId: string): string | null {
  const concept = graph.nodes.get(conceptId);
  if (!concept) return null;
  const open = concept.taughtBy.filter((id) => !progress.done.has(id));
  const rank = (id: string) => (sourceState(graph, progress, id) === "ready" ? 0 : 1);
  const length = (id: string) => graph.nodes.get(id)?.minutes ?? Number.POSITIVE_INFINITY;
  return [...open].sort((a, b) => rank(a) - rank(b) || length(a) - length(b) || a.localeCompare(b))[0] ?? null;
}

export function computeRoute(
  graph: LearningGraph,
  progress: Progress,
  states: Map<string, ConceptState>,
  targets: string[] = routeTargets(progress),
): Route | null {
  const deadline = (id: string) => progress.deadlines.get(id) ?? "\uffff";
  // The goal due first gets its steps first; without deadlines the goals keep their order.
  const goals = targets
    .filter((id, index) => graph.nodes.get(id)?.kind === "concept" && targets.indexOf(id) === index)
    .map((id, index) => ({ id, index }))
    .sort((a, b) => deadline(a.id).localeCompare(deadline(b.id)) || a.index - b.index)
    .map(({ id }) => id);
  if (goals.length === 0) return null;

  const closures = new Map<string, Set<string>>();
  for (const goal of goals) {
    const own = new Set([goal, ...graph.ancestors(goal)]);
    for (const id of [...own]) if (graph.nodes.get(id)?.kind !== "concept") own.delete(id);
    closures.set(goal, own);
  }
  const closure = new Set(goals.flatMap((goal) => [...closures.get(goal)!]));

  const byPriority = (a: string, b: string) => {
    const started = Number(states.get(b) === "learning") - Number(states.get(a) === "learning");
    return started || graph.nodes.get(a)!.title.localeCompare(graph.nodes.get(b)!.title, "ru");
  };

  // Depth-first post-order keeps one chain of prerequisites together instead of
  // hopping between unrelated branches the way a plain Kahn sort would.
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    if (isPassed(progress, id)) return;
    const prerequisites = graph.nodes.get(id)!.requires.filter((req) => graph.nodes.get(req)?.kind === "concept");
    for (const prerequisite of [...prerequisites].sort(byPriority)) visit(prerequisite);
    order.push(id);
  };
  for (const goal of goals) visit(goal);

  // Prefer a material the route already uses: one book covering three steps is one book to read.
  const chosen = new Set<string>();
  const steps: RouteStep[] = order.map((id) => {
    const material =
      graph.nodes.get(id)!.taughtBy.find((source) => chosen.has(source) && !progress.done.has(source)) ??
      recommendMaterial(graph, progress, id);
    if (material) chosen.add(material);
    return { id, state: states.get(id) ?? "locked", material, goals: goals.filter((goal) => closures.get(goal)!.has(id)) };
  });

  let remainingMinutes = 0;
  let unestimated = 0;
  const gaps: string[] = [];
  const counted = new Set<string>();
  for (const step of steps) {
    if (graph.nodes.get(step.id)!.taughtBy.length === 0) gaps.push(step.id);
    if (step.material && counted.has(step.material)) continue;
    const minutes = step.material ? graph.nodes.get(step.material)?.minutes : undefined;
    if (step.material) counted.add(step.material);
    if (minutes === undefined) unestimated++;
    else remainingMinutes += minutes;
  }

  return {
    goal: goals[0],
    goals,
    closure,
    steps,
    next: steps.find((step) => step.state === "learning" || step.state === "available")?.id ?? null,
    masteredCount: [...closure].filter((id) => progress.mastered.has(id)).length,
    total: [...closure].filter((id) => !progress.skipped.has(id)).length,
    skippedCount: [...closure].filter((id) => progress.skipped.has(id)).length,
    remainingMinutes,
    unestimated,
    gaps,
  };
}

/** Concepts that become available once `id` is mastered. */
export function unlockedBy(graph: LearningGraph, progress: Progress, id: string): string[] {
  const after = cloneProgress(progress);
  after.mastered.add(id);
  return newlyAvailable(graph, progress, after);
}

/** Concepts that were locked before a change of progress and can be started after it. */
export function newlyAvailable(graph: LearningGraph, before: Progress, after: Progress): string[] {
  const was = computeStates(graph, before);
  const now = computeStates(graph, after);
  return graph.concepts
    .map((node) => node.id)
    .filter((conceptId) => was.get(conceptId) === "locked" && now.get(conceptId) === "available");
}

/** The concept and every concept it needs that is not mastered yet, in the order they would be learned. */
export function knownCandidates(graph: LearningGraph, progress: Progress, id: string): string[] {
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (current: string) => {
    if (visited.has(current)) return;
    visited.add(current);
    const node = graph.nodes.get(current);
    if (node?.kind !== "concept" || progress.mastered.has(current)) return;
    const prerequisites = node.requires.filter((req) => graph.nodes.get(req)?.kind === "concept");
    for (const prerequisite of [...prerequisites].sort((a, b) => graph.nodes.get(a)!.title.localeCompare(graph.nodes.get(b)!.title)))
      visit(prerequisite);
    order.push(current);
  };
  visit(id);
  return order;
}
