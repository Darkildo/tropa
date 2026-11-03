import { emptyProgress } from "./graph";
import { linkTargets, parseLinkTarget, toList } from "./links";
import { isMaterialId, materialId, materialKey, normalizeUrl } from "./materials";
import type { Progress } from "./types";

export const CONFIDENCE_LEVELS = [1, 2, 3, 4, 5] as const;

const confidenceKey = (level: number) => `confidence-${level}`;

/** Finished materials that live inside concepts: plain URLs, and attachments as links so renames follow them. */
const DONE_MATERIALS = "done-materials";

/** Every goal, written only once there is more than one: until then `goal` says it all. */
const GOALS = "goals";
/** Route to every goal at once. */
const ALL_GOALS = "all-goals";
/** Planned study time in hours a week. */
const PACE = "pace-hours";
/** `deadline-2026-12-31: ["[[Goal]]"]`: plain links grouped by date, so renames and the Properties editor work as usual. */
const DEADLINE = /^deadline-(\d{4}-\d{2}-\d{2})$/;
const deadlineKey = (date: string) => `deadline-${date}`;

/** By default a URL is its own key and a link names the file as written. */
const plainMaterial = (value: string) => {
  const link = /^\s*\[\[/.test(value) ? parseLinkTarget(value) : null;
  return materialId(link ?? normalizeUrl(value));
};

/**
 * Reads the frontmatter of the progress file. Files written before skipping and
 * confidence existed have no such lists and read as they are.
 */
export function readProgress(
  frontmatter: Record<string, unknown> | null | undefined,
  resolve: (target: string) => string,
  material: (value: string) => string = plainMaterial,
): Progress {
  const progress = emptyProgress();
  if (!frontmatter) return progress;
  const ids = (key: string) => new Set(linkTargets(frontmatter[key]).map(resolve));
  const [goal] = linkTargets(frontmatter.goal).map(resolve);
  // `goal` is the active goal and the only one older versions know; a goal they set is added to the list.
  const goals = [...new Set(linkTargets(frontmatter[GOALS]).map(resolve))];
  if (goal && !goals.includes(goal)) goals.push(goal);
  progress.goals = goals;
  progress.goal = goal ?? goals[0] ?? null;
  progress.allGoals = frontmatter[ALL_GOALS] === true && goals.length > 1;
  for (const [key, value] of Object.entries(frontmatter)) {
    const date = DEADLINE.exec(key)?.[1];
    if (!date || !isDate(date)) continue;
    for (const id of linkTargets(value).map(resolve)) if (goals.includes(id)) progress.deadlines.set(id, date);
  }
  const pace = Number(frontmatter[PACE]);
  progress.paceHours = frontmatter[PACE] != null && Number.isFinite(pace) && pace > 0 ? pace : null;
  progress.mastered = ids("mastered");
  progress.learning = ids("learning");
  progress.done = ids("done");
  for (const value of toList(frontmatter[DONE_MATERIALS])) {
    if (typeof value === "string" && value.trim()) progress.done.add(material(value));
  }
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
export function writeProgress(
  frontmatter: Record<string, unknown>,
  progress: Progress,
  link: (id: string) => string,
  material: (id: string) => string = materialKey,
) {
  frontmatter.type = "learning-progress";
  frontmatter.goal = progress.goal ? link(progress.goal) : null;
  const goals = progress.goals.length ? progress.goals : progress.goal ? [progress.goal] : [];
  setOrDrop(frontmatter, GOALS, goals.length > 1 ? goals.map(link) : []);
  if (progress.allGoals && goals.length > 1) frontmatter[ALL_GOALS] = true;
  else delete frontmatter[ALL_GOALS];
  for (const key of Object.keys(frontmatter)) if (DEADLINE.test(key)) delete frontmatter[key];
  const byDate = new Map<string, string[]>();
  for (const [id, date] of progress.deadlines) {
    if (goals.includes(id) && isDate(date)) byDate.set(date, [...(byDate.get(date) ?? []), link(id)]);
  }
  for (const date of [...byDate.keys()].sort()) frontmatter[deadlineKey(date)] = byDate.get(date);
  if (progress.paceHours) frontmatter[PACE] = progress.paceHours;
  else delete frontmatter[PACE];
  frontmatter.mastered = [...progress.mastered].map(link);
  frontmatter.learning = [...progress.learning].map(link);
  const done = [...progress.done];
  frontmatter.done = done.filter((id) => !isMaterialId(id)).map(link);
  setOrDrop(frontmatter, DONE_MATERIALS, done.filter(isMaterialId).map(material));
  setOrDrop(frontmatter, "skipped", [...progress.skipped].map(link));
  for (const level of CONFIDENCE_LEVELS) {
    const ids = [...progress.confidence].filter(([, value]) => value === level).map(([id]) => id);
    setOrDrop(frontmatter, confidenceKey(level), ids.map(link));
  }
}

/** A real calendar day written as YYYY-MM-DD. */
export function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function setOrDrop(frontmatter: Record<string, unknown>, key: string, list: string[]) {
  if (list.length) frontmatter[key] = list;
  else delete frontmatter[key];
}
