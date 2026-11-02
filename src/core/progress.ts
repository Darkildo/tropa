import { emptyProgress } from "./graph";
import { linkTargets } from "./links";
import type { Progress } from "./types";

export const CONFIDENCE_LEVELS = [1, 2, 3, 4, 5] as const;

const confidenceKey = (level: number) => `confidence-${level}`;

/**
 * Reads the frontmatter of the progress file. Files written before skipping and
 * confidence existed have no such lists and read as they are.
 */
export function readProgress(frontmatter: Record<string, unknown> | null | undefined, resolve: (target: string) => string): Progress {
  const progress = emptyProgress();
  if (!frontmatter) return progress;
  const ids = (key: string) => new Set(linkTargets(frontmatter[key]).map(resolve));
  const [goal] = linkTargets(frontmatter.goal).map(resolve);
  progress.goal = goal ?? null;
  progress.mastered = ids("mastered");
  progress.learning = ids("learning");
  progress.done = ids("done");
  progress.skipped = ids("skipped");
  // A higher level wins if a concept somehow sits in two lists.
  for (const level of CONFIDENCE_LEVELS) {
    for (const id of ids(confidenceKey(level))) progress.confidence.set(id, level);
  }
  return progress;
}

/**
 * Writes progress into the frontmatter object in place. The original lists are always
 * written, the newer ones only when they hold something, so older versions of the
 * plugin and hand-made files see nothing new until it is used.
 */
export function writeProgress(frontmatter: Record<string, unknown>, progress: Progress, link: (id: string) => string) {
  frontmatter.type = "learning-progress";
  frontmatter.goal = progress.goal ? link(progress.goal) : null;
  frontmatter.mastered = [...progress.mastered].map(link);
  frontmatter.learning = [...progress.learning].map(link);
  frontmatter.done = [...progress.done].map(link);
  setOrDrop(frontmatter, "skipped", [...progress.skipped].map(link));
  for (const level of CONFIDENCE_LEVELS) {
    const ids = [...progress.confidence].filter(([, value]) => value === level).map(([id]) => id);
    setOrDrop(frontmatter, confidenceKey(level), ids.map(link));
  }
}

function setOrDrop(frontmatter: Record<string, unknown>, key: string, list: string[]) {
  if (list.length) frontmatter[key] = list;
  else delete frontmatter[key];
}
