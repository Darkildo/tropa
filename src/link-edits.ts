import { TFile, TFolder, normalizePath, type App } from "obsidian";
import type { LinkEdit } from "./core/batch-links";
import type { LearningGraph } from "./core/graph";
import { linkTargets, toList } from "./core/links";
import type { TropaSettings } from "./defaults";

/** One note as it was before a batch and as the batch left it, in the properties the batch touched. */
interface NoteEdit {
  path: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/** A note a batch created, with its text when the batch was done: changed since, it is not taken back. */
interface CreatedNote {
  path: string;
  content: string;
}

/** What a batch changed, enough to put the notes back as they were. */
export interface LinkUndo {
  notes: NoteEdit[];
  links: number;
  /** Notes the batch created, and folders made for them, newest last. */
  created: CreatedNote[];
  folders: string[];
}

/**
 * Adds a batch of links to the notes' properties, one write per note. A note that is not a concept
 * on the map yet becomes one (`type: concept`), so a recommended link or a link to it shows up too;
 * so do the notes in `also`, links or not.
 */
export async function applyLinkEdits(app: App, settings: TropaSettings, graph: LearningGraph, edits: LinkEdit[], also: string[] = []): Promise<LinkUndo> {
  const keys = [settings.typeKey, settings.requiresKey, settings.recommendsKey];
  const byNote = new Map<string, LinkEdit[]>();
  for (const edit of edits) {
    byNote.set(edit.from, [...(byNote.get(edit.from) ?? []), edit]);
    if (!byNote.has(edit.to)) byNote.set(edit.to, []);
  }
  for (const path of also) if (!byNote.has(path)) byNote.set(path, []);

  const undo: LinkUndo = { notes: [], links: 0, created: [], folders: [] };
  for (const [path, own] of byNote) {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) continue;
    const node = graph.nodes.get(path);
    const onMap = node?.kind === "concept" && !node.ghost;
    let added = 0;
    await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      const before = pick(frontmatter, keys);
      if (!onMap && frontmatter[settings.typeKey] === undefined) frontmatter[settings.typeKey] = "concept";
      for (const edit of own) {
        const target = app.vault.getAbstractFileByPath(edit.to);
        if (!(target instanceof TFile)) continue;
        const property = edit.kind === "requires" ? settings.requiresKey : settings.recommendsKey;
        const list = toList(frontmatter[property]);
        // The same note under another spelling of its link counts as there.
        const there = linkTargets(list).some((link) => app.metadataCache.getFirstLinkpathDest(link, path)?.path === edit.to);
        if (there) continue;
        list.push(`[[${app.metadataCache.fileToLinktext(target, path, true)}]]`);
        frontmatter[property] = list;
        added++;
      }
      const after = pick(frontmatter, keys);
      if (!same(before, after)) undo.notes.push({ path, before, after });
    });
    undo.links += added;
  }
  return undo;
}

/**
 * Puts back each property a batch changed, unless it was changed again since: that note keeps the
 * newer value. Returns how many notes were put back and how many were left as they are.
 */
export async function undoLinkEdits(app: App, undo: LinkUndo): Promise<{ restored: number; kept: number }> {
  let restored = 0;
  let kept = 0;
  const created = new Set(undo.created.map((note) => note.path));
  for (const note of undo.notes) {
    // A note the batch created goes as a whole, below.
    if (created.has(note.path)) continue;
    const file = app.vault.getAbstractFileByPath(note.path);
    if (!(file instanceof TFile)) {
      kept++;
      continue;
    }
    await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      let changedSince = false;
      for (const key of Object.keys(note.after)) {
        if (!same(frontmatter[key], note.after[key])) {
          changedSince = true;
          continue;
        }
        if (note.before[key] === undefined) delete frontmatter[key];
        else frontmatter[key] = clone(note.before[key]);
      }
      if (changedSince) kept++;
      else restored++;
    });
  }
  for (const note of undo.created) {
    const file = app.vault.getAbstractFileByPath(note.path);
    if (!(file instanceof TFile)) continue;
    if ((await app.vault.read(file)) !== note.content) {
      kept++;
      continue;
    }
    await app.fileManager.trashFile(file);
    restored++;
  }
  // Folders made for the notes go too, when nothing else has been put in them.
  for (const path of [...undo.folders].reverse()) {
    const folder = app.vault.getAbstractFileByPath(path);
    if (folder instanceof TFolder && folder.children.length === 0) await app.fileManager.trashFile(folder);
  }
  return { restored, kept };
}

/**
 * Creates concept notes with nothing but their type, making their folders first. A path taken in
 * the meantime gets a free name next to it. Returns the paths as created, in the order given.
 */
export async function createConceptNotes(app: App, typeKey: string, paths: string[]): Promise<{ paths: Map<string, string>; folders: string[] }> {
  const folders: string[] = [];
  const made = new Map<string, string>();
  for (const wanted of paths) {
    const parts = normalizePath(wanted).split("/").slice(0, -1);
    for (let depth = 1; depth <= parts.length; depth++) {
      const folder = parts.slice(0, depth).join("/");
      if (app.vault.getAbstractFileByPath(folder)) continue;
      await app.vault.createFolder(folder);
      folders.push(folder);
    }
    const base = wanted.replace(/\.md$/, "");
    let path = wanted;
    for (let i = 2; app.vault.getAbstractFileByPath(path); i++) path = `${base} ${i}.md`;
    await app.vault.create(path, `---\n${typeKey}: concept\n---\n\n`);
    made.set(wanted, path);
  }
  return { paths: made, folders };
}

/** Remembers the text of the notes a batch created, as the batch left them, so undo can tell whether they were changed since. */
export async function rememberCreated(app: App, undo: LinkUndo, paths: Iterable<string>, folders: string[]) {
  for (const path of paths) {
    const file = app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) undo.created.push({ path, content: await app.vault.read(file) });
  }
  undo.folders.push(...folders);
}

/** The values of `keys`, copied; a missing property is kept as undefined so undo can remove it. */
function pick(frontmatter: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, clone(frontmatter[key])]));
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}
