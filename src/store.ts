import { Events, Notice, TFile, normalizePath, type App, type EventRef } from "obsidian";
import { formatMinutes, parseFormat, safeFileName } from "./core/format";
import {
  computeRoute,
  computeStates,
  emptyProgress,
  ghostId,
  isGhostId,
  LearningGraph,
  unlockedBy,
} from "./core/graph";
import { basename, linkTargets, toList } from "./core/links";
import type { ConceptState, NoteInput, NoteRef, Progress, Route, SourceFormat } from "./core/types";
import { t } from "./i18n";
import type { TropaSettings } from "./defaults";

export type LinkKind = "requiresKey" | "recommendsKey" | "teachesKey";

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

  private signature = "";
  private pendingWrites = 0;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly app: App, private readonly settings: () => TropaSettings) {
    super();
  }

  on(name: "change", callback: () => void): EventRef;
  on(name: "mastered", callback: (id: string, unlocked: string[], undo: Progress) => void): EventRef;
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

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (file.path === progressPath) continue;
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) continue;
      const kind = this.classify(frontmatter);
      if (!kind) continue;
      const refs = (key: string) => linkTargets(frontmatter[key]).map((target) => this.resolve(target, file.path));
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
  }

  private classify(frontmatter: Record<string, unknown>): "concept" | "source" | null {
    const settings = this.settings();
    const type = frontmatter[settings.typeKey];
    if (type === "concept" || type === "source") return type;
    if (type !== undefined) return null;
    if (settings.teachesKey in frontmatter) return "source";
    if (settings.requiresKey in frontmatter) return "concept";
    return null;
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
    if (!frontmatter) {
      this.progress = emptyProgress();
      return;
    }
    const ids = (key: string) => new Set(linkTargets(frontmatter[key]).map((target) => this.resolve(target, path).id));
    const [goal] = linkTargets(frontmatter.goal).map((target) => this.resolve(target, path).id);
    this.progress = {
      goal: goal ?? null,
      mastered: ids("mastered"),
      learning: ids("learning"),
      done: ids("done"),
    };
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
    return {
      goal: this.progress.goal,
      mastered: new Set(this.progress.mastered),
      learning: new Set(this.progress.learning),
      done: new Set(this.progress.done),
    };
  }

  private commit() {
    this.derive();
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
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter.type = "learning-progress";
      frontmatter.goal = this.progress.goal ? link(this.progress.goal) : null;
      frontmatter.mastered = [...this.progress.mastered].map(link);
      frontmatter.learning = [...this.progress.learning].map(link);
      frontmatter.done = [...this.progress.done].map(link);
    });
  }

  setGoal(id: string | null) {
    this.progress.goal = id;
    this.commit();
  }

  startLearning(id: string) {
    this.progress.learning.add(id);
    this.commit();
  }

  setMastered(id: string, mastered: boolean) {
    const undo = this.snapshot();
    const unlocked = mastered ? unlockedBy(this.graph, this.progress, id) : [];
    if (mastered) {
      this.progress.mastered.add(id);
      this.progress.learning.delete(id);
    } else {
      this.progress.mastered.delete(id);
    }
    this.commit();
    if (mastered) this.trigger("mastered", id, unlocked, undo);
  }

  setDone(id: string, done: boolean) {
    if (done) this.progress.done.add(id);
    else this.progress.done.delete(id);
    this.commit();
  }

  restore(progress: Progress) {
    this.progress = progress;
    this.commit();
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

  private linkTo(id: string, from: string) {
    const node = this.graph.nodes.get(id);
    if (isGhostId(id)) return `[[${node?.title ?? id.slice("ghost:".length)}]]`;
    const file = this.fileOf(id);
    return file ? `[[${this.app.metadataCache.fileToLinktext(file, from, true)}]]` : `[[${node?.title ?? id}]]`;
  }

  async ensureFolder(folder: string) {
    if (!folder) return;
    const parts = normalizePath(folder).split("/");
    for (let depth = 1; depth <= parts.length; depth++) {
      const path = parts.slice(0, depth).join("/");
      if (!(await this.app.vault.adapter.exists(path))) await this.app.vault.createFolder(path);
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
