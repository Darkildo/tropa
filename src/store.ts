import { Events, Notice, TFile, getAllTags, normalizePath, type App, type EventRef } from "obsidian";
import { formatMinutes, parseFormat, safeFileName } from "./core/format";
import {
  allGoalsOf,
  cloneProgress,
  computeRoute,
  computeStates,
  emptyProgress,
  ghostId,
  isGhostId,
  isGoal,
  LearningGraph,
  newlyAvailable,
  sameProgress,
  unlockedBy,
} from "./core/graph";
import type { ChangeCause } from "./core/journal";
import { readProgress, writeProgress } from "./core/progress";
import { inFolders, isExcluded, type Scope } from "./core/scope";
import { basename, linkTargets, parseLinkTarget, toList } from "./core/links";
import {
  entryFormat,
  isMaterialId,
  materialId,
  materialKey,
  normalizeUrl,
  parseMaterials,
  urlTitle,
  type MaterialEntry,
} from "./core/materials";
import type { ConceptState, InlineMaterial, NoteInput, NoteRef, Progress, Route, SourceFormat } from "./core/types";
import { t } from "./i18n";
import type { TropaSettings } from "./defaults";

export type LinkKind = "requiresKey" | "recommendsKey" | "teachesKey";

/** The progress before a change, and the revision right after it: undo is offered only while nothing has changed since. */
export interface Undo {
  progress: Progress;
  revision: number;
}

export interface SourceDraft {
  title: string;
  url: string;
  format: SourceFormat;
  minutes?: number;
  teaches?: string[];
}

/** Everything the views read. Rebuilt from the vault, never edited in place. */
export class Store extends Events {
  graph = new LearningGraph([]);
  progress: Progress = emptyProgress();
  states = new Map<string, ConceptState>();
  route: Route | null = null;
  /** Changes when the shape of the graph changes, so views can keep their layout otherwise. */
  topologyKey = "";
  /** Counts changes of the progress, made here or read from the file (another device, a hand edit). */
  revision = 0;

  private signature = "";
  private scope: Scope = { folders: [], tags: [] };
  /** Excluded goals already announced, so the notice comes once per change. */
  private announcedGoals = new Set<string>();
  private pendingWrites = 0;
  /** Progress as last read or committed: a commit reports what changed since, for the journal. */
  private recorded: Progress = emptyProgress();
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly app: App, private readonly settings: () => TropaSettings) {
    super();
  }

  on(name: "change", callback: () => void): EventRef;
  on(name: "mastered", callback: (id: string, unlocked: string[], undo: Undo) => void): EventRef;
  /** A change that touched more than one mark at once, with the progress to go back to. */
  on(name: "undoable", callback: (message: string, unlocked: string[], undo: Undo) => void): EventRef;
  /** Every change made here, with the progress before and after. Changes read from the file are not reported. */
  on(name: "commit", callback: (before: Progress, after: Progress, cause: ChangeCause | undefined) => void): EventRef;
  on(name: string, callback: (...data: never[]) => void): EventRef {
    return super.on(name, callback as (...data: unknown[]) => unknown);
  }

  get isEmpty() {
    return this.graph.nodes.size === 0;
  }

  // Reading the vault

  rebuild(force = false) {
    const inputs: NoteInput[] = [];
    const settings = this.settings();
    const progressPath = normalizePath(settings.progressPath);
    this.scope = { folders: settings.excludeFolders ?? [], tags: settings.excludeTags ?? [] };

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (this.isOwnFile(file.path) || this.isExcluded(file)) continue;
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) continue;
      const kind = this.classify(frontmatter);
      if (!kind) continue;
      // A link to an excluded note is dropped: no node, no step, nothing to wait for.
      const refs = (key: string) =>
        linkTargets(frontmatter[key])
          .map((target) => this.resolve(target, file.path))
          .filter((ref) => !this.excludedNote(ref.id));
      const minutes = Number(frontmatter.minutes);
      inputs.push({
        id: file.path,
        title: file.basename,
        kind,
        requires: refs(settings.requiresKey),
        recommends: refs(settings.recommendsKey),
        teaches: kind === "source" ? refs(settings.teachesKey) : [],
        format: kind === "source" ? parseFormat(frontmatter.format) : undefined,
        minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : undefined,
        url: typeof frontmatter.url === "string" ? frontmatter.url : undefined,
        summary: typeof frontmatter.summary === "string" ? frontmatter.summary : undefined,
        materials:
          kind === "concept" ? parseMaterials(frontmatter[settings.materialsKey]).map((entry) => this.resolveMaterial(entry, file.path)) : undefined,
      });
    }

    // Progress is part of the signature: it can reach the cache after the notes do.
    const progressFile = this.app.vault.getAbstractFileByPath(progressPath);
    const progressData = progressFile instanceof TFile ? this.app.metadataCache.getFileCache(progressFile)?.frontmatter : null;
    const signature = JSON.stringify([inputs, progressData]);
    if (!force && signature === this.signature) return;
    this.signature = signature;
    this.graph = new LearningGraph(inputs);
    this.topologyKey = [...this.graph.nodes.values()]
      .map((node) => [node.id, node.requires, node.teaches, node.recommends].join("|"))
      .sort()
      .join("\n");
    this.readProgress();
    this.derive();
    this.announceExcludedGoal();
  }

  /**
   * Out of the map by the folder and tag settings. The progress file is read by its path and never
   * becomes a node, so excluding its folder cannot lose progress.
   */
  isExcluded(file: TFile) {
    const { folders, tags } = this.scope;
    if (!folders.length && !tags.length) return false;
    if (file.path === normalizePath(this.settings().progressPath)) return false;
    const cache = tags.length ? this.app.metadataCache.getFileCache(file) : null;
    return isExcluded(file.path, (cache && getAllTags(cache)) ?? [], this.scope);
  }

  /** The progress file and the journal: Tropa's own files, never concepts or materials. */
  isOwnFile(path: string) {
    const settings = this.settings();
    if (path === normalizePath(settings.progressPath)) return true;
    const journal = normalizePath(settings.journalFolder);
    return journal !== "" && inFolders(path, [journal]);
  }

  /** Title of the goal when the scope settings leave its note out. Nothing links to it then, so it is not in the graph. */
  get excludedGoal(): string | null {
    const { goal } = this.progress;
    return goal ? this.excludedNote(goal)?.basename ?? null : null;
  }

  /** Titles of every goal the scope settings leave out. The route leads to the others. */
  get excludedGoals(): string[] {
    return allGoalsOf(this.progress).flatMap((id) => this.excludedNote(id)?.basename ?? []);
  }

  /** The note behind an id when the scope settings leave it out. Progress keeps such ids untouched. */
  private excludedNote(id: string) {
    if (isGhostId(id)) return null;
    const file = this.fileOf(id);
    return file?.extension === "md" && this.isExcluded(file) ? file : null;
  }

  private announceExcludedGoal() {
    const excluded = new Set(allGoalsOf(this.progress).filter((id) => this.excludedNote(id)));
    for (const id of excluded) {
      if (!this.announcedGoals.has(id)) new Notice(t.scope.goalExcluded({ title: this.excludedNote(id)!.basename }));
    }
    this.announcedGoals = excluded;
  }

  private classify(frontmatter: Record<string, unknown>): "concept" | "source" | null {
    const settings = this.settings();
    const type = frontmatter[settings.typeKey];
    if (type === "concept" || type === "source") return type;
    if (type !== undefined) return null;
    if (settings.teachesKey in frontmatter) return "source";
    if (settings.requiresKey in frontmatter || settings.materialsKey in frontmatter) return "concept";
    return null;
  }

  /** An entry of a concept's `materials`: a URL is keyed by its normalized form, an attachment by its path. */
  private resolveMaterial(entry: MaterialEntry, from: string): InlineMaterial {
    if (entry.url) {
      return { id: materialId(normalizeUrl(entry.url)), title: entry.title ?? urlTitle(entry.url), url: entry.url, format: entryFormat(entry), minutes: entry.minutes };
    }
    const link = entry.link ?? "";
    const file = this.app.metadataCache.getFirstLinkpathDest(link, from);
    return {
      id: materialId(file?.path ?? link),
      title: entry.title ?? (file ? file.basename : basename(link)),
      file: file?.path,
      format: entryFormat(entry, file?.path),
      minutes: entry.minutes,
    };
  }

  /** The id a value from the progress file or a concept's list stands for. */
  private materialIdOf(value: string, from: string) {
    if (/^\s*\[\[/.test(value)) {
      const link = parseLinkTarget(value) ?? value;
      return materialId(this.app.metadataCache.getFirstLinkpathDest(link, from)?.path ?? link);
    }
    return materialId(normalizeUrl(value));
  }

  private resolve(target: string, from: string): NoteRef {
    const file = this.app.metadataCache.getFirstLinkpathDest(target, from);
    return file ? { id: file.path, title: file.basename } : { id: ghostId(basename(target)), title: basename(target) };
  }

  private readProgress() {
    if (this.pendingWrites > 0) return;
    const path = normalizePath(this.settings().progressPath);
    const file = this.app.vault.getAbstractFileByPath(path);
    const frontmatter = file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
    const progress = readProgress(
      frontmatter,
      (target) => this.resolve(target, path).id,
      (value) => this.materialIdOf(value, path),
    );
    // Reading back what was just saved changes nothing, so a pending undo stays valid.
    if (!sameProgress(progress, this.progress)) this.revision++;
    this.progress = progress;
    this.recorded = cloneProgress(this.progress);
  }

  onProgressFileChanged() {
    if (this.pendingWrites > 0) return;
    this.readProgress();
    this.derive();
  }

  private derive() {
    this.states = computeStates(this.graph, this.progress);
    this.route = computeRoute(this.graph, this.progress, this.states);
    this.trigger("change");
  }

  // Personal progress

  private snapshot(): Progress {
    return cloneProgress(this.progress);
  }

  /** Called after the change has been committed, so the revision is the one the undo belongs to. */
  private undoTo(progress: Progress): Undo {
    return { progress, revision: this.revision };
  }

  private commit(cause?: ChangeCause) {
    this.dropStaleConfidence();
    this.revision++;
    this.derive();
    const before = this.recorded;
    this.recorded = cloneProgress(this.progress);
    this.trigger("commit", before, this.recorded, cause);
    this.pendingWrites++;
    this.writes = this.writes
      .then(() => this.writeProgress())
      .catch((error) => {
        console.error("Tropa: failed to save progress", error);
        new Notice(t.progressNotSaved({ reason: error instanceof Error ? error.message : String(error) }));
      })
      .finally(() => {
        this.pendingWrites--;
      });
  }

  private async writeProgress() {
    const path = normalizePath(this.settings().progressPath);
    const existing = this.app.vault.getAbstractFileByPath(path);
    let file: TFile;
    if (existing instanceof TFile) file = existing;
    else {
      await this.ensureFolder(path.split("/").slice(0, -1).join("/"));
      file = await this.app.vault.create(
        path,
        `---\ntype: learning-progress\n---\n\n${t.progressFileText}\n`,
      );
    }
    const link = (id: string) => this.linkTo(id, path);
    const material = (id: string) => this.materialLink(id, path);
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      writeProgress(frontmatter, this.progress, link, material);
    });
  }

  /** Confidence belongs to what is mastered or being learned; anything else loses it. */
  private dropStaleConfidence() {
    const { progress } = this;
    const states = computeStates(this.graph, progress);
    for (const id of progress.confidence.keys()) {
      const state = states.get(id);
      const kept = progress.mastered.has(id) || progress.learning.has(id) || state === "learning";
      if (!kept || progress.skipped.has(id)) progress.confidence.delete(id);
    }
  }

  /**
   * Puts `id` in place of the active goal, or makes it the active one if it already is a goal.
   * `null` removes the active goal. A skipped concept chosen as a goal is wanted after all, so it returns to the map.
   */
  setGoal(id: string | null, cause?: ChangeCause) {
    const { progress } = this;
    if (id === null) {
      if (progress.goal) this.removeGoal(progress.goal, cause);
      return;
    }
    const goals = allGoalsOf(progress);
    if (!goals.includes(id)) {
      const index = progress.goal ? goals.indexOf(progress.goal) : -1;
      if (index >= 0) {
        progress.deadlines.delete(goals[index]);
        goals[index] = id;
      } else goals.push(id);
    }
    progress.goals = goals;
    progress.goal = id;
    progress.skipped.delete(id);
    this.commit(cause);
  }

  /** Keeps the goals there are and adds `id`, which becomes the active one. */
  addGoal(id: string) {
    const { progress } = this;
    const goals = allGoalsOf(progress);
    if (!goals.includes(id)) goals.push(id);
    progress.goals = goals;
    progress.goal = id;
    progress.skipped.delete(id);
    this.commit();
  }

  /** Drops a goal with its deadline. The next goal becomes the active one. */
  removeGoal(id: string, cause?: ChangeCause) {
    const { progress } = this;
    const goals = allGoalsOf(progress);
    const index = goals.indexOf(id);
    if (index < 0) return;
    goals.splice(index, 1);
    progress.goals = goals;
    progress.deadlines.delete(id);
    if (progress.goal === id) progress.goal = goals[Math.min(index, goals.length - 1)] ?? null;
    if (goals.length < 2) progress.allGoals = false;
    this.commit(cause);
  }

  /** Shows the route to one goal. */
  setActiveGoal(id: string) {
    const { progress } = this;
    if (!allGoalsOf(progress).includes(id)) return this.addGoal(id);
    progress.goal = id;
    progress.allGoals = false;
    this.commit();
  }

  /** Shows the route to every goal at once. */
  setAllGoals(all: boolean) {
    this.progress.goals = allGoalsOf(this.progress);
    this.progress.allGoals = all && this.progress.goals.length > 1;
    this.commit();
  }

  /** The pace in hours a week and the deadlines by goal. Missing values clear them. */
  setPlan(paceHours: number | null, deadlines: Map<string, string>) {
    const goals = allGoalsOf(this.progress);
    this.progress.paceHours = paceHours && paceHours > 0 ? paceHours : null;
    this.progress.deadlines = new Map([...deadlines].filter(([id]) => goals.includes(id)));
    this.commit();
  }

  /** The route to one goal alone, for its own deadline. */
  routeTo(goal: string) {
    return computeRoute(this.graph, this.progress, this.states, [goal]);
  }

  startLearning(id: string) {
    this.progress.learning.add(id);
    this.progress.skipped.delete(id);
    this.commit();
  }

  setMastered(id: string, mastered: boolean) {
    const undo = this.snapshot();
    const unlocked = mastered ? unlockedBy(this.graph, this.progress, id) : [];
    if (mastered) {
      this.progress.mastered.add(id);
      this.progress.learning.delete(id);
      this.progress.skipped.delete(id);
    } else {
      this.progress.mastered.delete(id);
    }
    this.commit();
    if (mastered) this.trigger("mastered", id, unlocked, this.undoTo(undo));
  }

  /** Skipping opens what depends on the concept without counting it as mastered. The goal cannot be skipped. */
  setSkipped(id: string, skipped: boolean) {
    if (skipped && isGoal(this.progress, id)) {
      new Notice(t.goalNotSkipped);
      return;
    }
    const undo = this.snapshot();
    if (skipped) {
      this.progress.skipped.add(id);
      this.progress.mastered.delete(id);
      this.progress.learning.delete(id);
    } else {
      this.progress.skipped.delete(id);
    }
    const unlocked = newlyAvailable(this.graph, undo, this.progress);
    this.commit();
    if (skipped) this.trigger("undoable", t.skippedToast({ title: this.graph.nodes.get(id)?.title ?? "" }), unlocked, this.undoTo(undo));
  }

  /** Marks several concepts as known in one step that can be undone as one. */
  markKnown(ids: string[]) {
    if (ids.length === 0) return;
    const undo = this.snapshot();
    for (const id of ids) {
      this.progress.mastered.add(id);
      this.progress.learning.delete(id);
      this.progress.skipped.delete(id);
    }
    const unlocked = newlyAvailable(this.graph, undo, this.progress);
    this.commit("known");
    this.trigger("undoable", t.markedKnown({ count: ids.length }), unlocked, this.undoTo(undo));
  }

  /** `null` clears the assessment. */
  setConfidence(id: string, level: number | null) {
    if (level === null) this.progress.confidence.delete(id);
    else this.progress.confidence.set(id, Math.min(5, Math.max(1, Math.round(level))));
    this.commit();
  }

  setDone(id: string, done: boolean) {
    if (done) this.progress.done.add(id);
    else this.progress.done.delete(id);
    this.commit();
  }

  /** False once anything else has changed the progress: going back then would undo that change too. */
  canUndo(undo: Undo) {
    return undo.revision === this.revision;
  }

  undo(undo: Undo) {
    if (!this.canUndo(undo)) return false;
    this.progress = cloneProgress(undo.progress);
    this.commit("undo");
    return true;
  }

  // Editing notes

  /** Adds `target` to a link property of `id`, creating the note for a placeholder first. */
  async addLink(id: string, key: LinkKind, target: string) {
    const file = await this.materialize(id);
    const value = this.linkTo(target, file.path);
    const property = this.settings()[key];
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      const list = toList(frontmatter[property]);
      if (!list.includes(value)) list.push(value);
      frontmatter[property] = list;
    });
  }

  async removeLink(id: string, key: LinkKind, target: string) {
    const file = this.fileOf(id);
    if (!file) return;
    const property = this.settings()[key];
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter[property] = toList(frontmatter[property]).filter((value) => {
        const [link] = linkTargets(value);
        return !link || this.resolve(link, file.path).id !== target;
      });
    });
  }

  /** Turns a placeholder into a real note. Existing notes are returned as they are. */
  async materialize(id: string): Promise<TFile> {
    if (!isGhostId(id)) {
      const file = this.fileOf(id);
      if (!file) throw new Error(t.noteNotFound({ id }));
      return file;
    }
    return this.createConcept(this.graph.nodes.get(id)?.title ?? id.slice("ghost:".length));
  }

  async createConcept(title: string, requires: string[] = []): Promise<TFile> {
    const settings = this.settings();
    const path = await this.freePath(settings.conceptsFolder, title);
    const links = requires.map((id) => `  - "${this.linkTo(id, path)}"`).join("\n");
    const list = links ? `\n${links}` : " []";
    return this.app.vault.create(path, `---\n${settings.typeKey}: concept\n${settings.requiresKey}:${list}\n---\n\n`);
  }

  async createSource(draft: SourceDraft): Promise<TFile> {
    const settings = this.settings();
    const path = await this.freePath(settings.sourcesFolder, draft.title);
    const file = await this.app.vault.create(path, `---\n${settings.typeKey}: source\n---\n\n`);
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter.format = draft.format;
      if (draft.url) frontmatter.url = draft.url;
      if (draft.minutes) frontmatter.minutes = draft.minutes;
      frontmatter[settings.teachesKey] = (draft.teaches ?? []).map((id) => this.linkTo(id, path));
    });
    return file;
  }

  async classifyNote(file: TFile, kind: "concept" | "source") {
    const settings = this.settings();
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter[settings.typeKey] = kind;
      const key = kind === "concept" ? settings.requiresKey : settings.teachesKey;
      frontmatter[key] ??= [];
    });
  }

  /** Attaches any note as a material for a concept. */
  async attachSource(noteId: string, conceptId: string) {
    const file = this.fileOf(noteId);
    if (!file) return;
    if (this.graph.nodes.get(noteId)?.kind !== "source") await this.classifyNote(file, "source");
    await this.addLink(noteId, "teachesKey", conceptId);
  }

  /** Lists a link or an attachment in the concept itself, with no note for the material. */
  async addInlineMaterial(conceptId: string, draft: Omit<SourceDraft, "teaches">) {
    const file = await this.materialize(conceptId);
    const value = draft.url.trim();
    const entry: Record<string, unknown> = /^\s*\[\[/.test(value) ? { file: value } : { url: value };
    if (draft.title.trim()) entry.title = draft.title.trim();
    entry.format = draft.format;
    if (draft.minutes) entry.minutes = draft.minutes;
    const key = this.settings().materialsKey;
    const id = this.materialIdOf(value, file.path);
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      const list = toList(frontmatter[key]).filter((item) => this.entryId(item, file.path) !== id);
      frontmatter[key] = [...list, entry];
    });
  }

  /** Teaches one more concept with an inline material: the same entry goes into that concept's list. */
  async copyInlineMaterial(materialNodeId: string, conceptId: string) {
    const node = this.graph.nodes.get(materialNodeId);
    if (!node?.inline) return;
    const link = node.url ?? `[[${node.file ?? materialKey(node.id)}]]`;
    await this.addInlineMaterial(conceptId, { title: node.title, url: link, format: node.format ?? "other", minutes: node.minutes });
  }

  /**
   * Detaches a material from a concept wherever the link lives: in the material note's
   * `teaches`, in the concept's `materials`, or both.
   */
  async detachMaterial(sourceId: string, conceptId: string) {
    const source = this.graph.nodes.get(sourceId);
    if (source && !source.inline) await this.removeLink(sourceId, "teachesKey", conceptId);
    const concept = this.fileOf(conceptId);
    if (!concept) return;
    const key = this.settings().materialsKey;
    const sourceUrl = source?.url ? normalizeUrl(source.url) : null;
    const matches = (item: unknown) => {
      const id = this.entryId(item, concept.path);
      if (!id) return false;
      if (id === sourceId) return true;
      const target = materialKey(id);
      return target === sourceId || (sourceUrl !== null && target === sourceUrl);
    };
    const listed = toList(this.app.metadataCache.getFileCache(concept)?.frontmatter?.[key]);
    if (!listed.some(matches)) return;
    await this.app.fileManager.processFrontMatter(concept, (frontmatter: Record<string, unknown>) => {
      const list = toList(frontmatter[key]).filter((item) => !matches(item));
      if (list.length) frontmatter[key] = list;
      else delete frontmatter[key];
    });
  }

  private entryId(item: unknown, from: string) {
    const [entry] = parseMaterials(item);
    return entry ? this.resolveMaterial(entry, from).id : null;
  }

  fileOf(id: string) {
    const file = this.app.vault.getAbstractFileByPath(id);
    return file instanceof TFile ? file : null;
  }

  describeRemaining() {
    if (!this.route) return "";
    const { remainingMinutes, unestimated, steps } = this.route;
    if (steps.length === 0) return t.goalReached;
    if (remainingMinutes === 0) return t.noEstimate;
    const duration = formatMinutes(remainingMinutes);
    return unestimated ? t.atLeast({ duration }) : t.about({ duration });
  }

  /** A material from a concept's list as the progress file and the journal write it: an attachment as a link, a URL as it is. */
  private materialLink(id: string, from: string) {
    const attachment = this.fileOf(materialKey(id));
    return attachment ? `[[${this.app.metadataCache.fileToLinktext(attachment, from, false)}]]` : materialKey(id);
  }

  /** How the journal names a concept or material: a link, so renames follow it, or the URL of a listed material. */
  journalTarget(id: string | null, from: string) {
    if (!id) return "-";
    return isMaterialId(id) ? this.materialLink(id, from) : this.linkTo(id, from);
  }

  /**
   * The id a journal target stands for in the current graph, or null. A link to a note that is both
   * a material note and listed in a concept resolves to whichever the graph has.
   */
  journalId(target: string, from: string): string | null {
    if (target === "-") return null;
    if (!/^\s*\[\[/.test(target)) return materialId(normalizeUrl(target));
    const link = parseLinkTarget(target);
    if (!link) return null;
    const file = this.app.metadataCache.getFirstLinkpathDest(link, from);
    if (!file) return ghostId(basename(link));
    if (this.graph.nodes.has(file.path)) return file.path;
    const material = materialId(file.path);
    return file.extension !== "md" || this.graph.nodes.has(material) ? material : file.path;
  }

  private linkTo(id: string, from: string) {
    const node = this.graph.nodes.get(id);
    if (isGhostId(id)) return `[[${node?.title ?? id.slice("ghost:".length)}]]`;
    const file = this.fileOf(id);
    return file ? `[[${this.app.metadataCache.fileToLinktext(file, from, true)}]]` : `[[${node?.title ?? id}]]`;
  }

  /** Writes an exported file. One that exists is replaced only when asked, never by surprise. */
  async writeExport(path: string, content: string, replace: boolean): Promise<TFile> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      if (!replace) throw new Error(`${path} already exists`);
      await this.app.vault.modify(existing, content);
      return existing;
    }
    if (existing) throw new Error(`${path} is a folder`);
    await this.ensureFolder(path.split("/").slice(0, -1).join("/"));
    return this.app.vault.create(path, content);
  }

  async ensureFolder(folder: string) {
    if (!folder) return;
    const parts = normalizePath(folder).split("/");
    for (let depth = 1; depth <= parts.length; depth++) {
      const path = parts.slice(0, depth).join("/");
      if (await this.app.vault.adapter.exists(path)) continue;
      // The progress file and the journal can be written at once: whoever comes second finds the folder made.
      try {
        await this.app.vault.createFolder(path);
      } catch (error) {
        if (!(await this.app.vault.adapter.exists(path))) throw error;
      }
    }
  }

  private async freePath(folder: string, title: string) {
    const name = safeFileName(title) || t.untitled;
    await this.ensureFolder(folder);
    const base = normalizePath(`${folder}/${name}`);
    let path = `${base}.md`;
    for (let i = 2; await this.app.vault.adapter.exists(path); i++) path = `${base} ${i}.md`;
    return path;
  }
}
