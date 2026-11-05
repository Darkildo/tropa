import { Notice, TFile, TFolder, getLinkpath, type TAbstractFile } from "obsidian";
import { attempt } from "./attempt";
import { LinkBatch, suggestLinks, type BatchRow, type LinkEdit, type NoteText } from "./core/batch-links";
import { inFolders } from "./core/scope";
import { t } from "./i18n";
import { applyLinkEdits, undoLinkEdits, type LinkUndo } from "./link-edits";
import type TropaPlugin from "./main";
import { BatchPreviewModal } from "./ui/batch-preview";
import { PickModal, type PickItem } from "./ui/pick";

/** What the suggestions read: the notes of a folder and below it (`""` is the whole vault), or one note. */
export type LinkScope = { kind: "folder"; path: string } | { kind: "note"; path: string };

/** A batch notice stays longer than a mark's: it can change many notes at once. */
const NOTICE_MS = 10000;

/** Suggested links from the notes' own links, with a preview, and the last batch kept for undo. */
export class LinkSuggestions {
  /** The last batch added in this session, until it is undone. */
  last: LinkUndo | null = null;

  constructor(private readonly plugin: TropaPlugin) {}

  private get app() {
    return this.plugin.app;
  }

  private get store() {
    return this.plugin.store;
  }

  /** Asks which folder or note to read: the open note and its folder come first, then the whole vault. */
  pickScope() {
    const items: PickItem[] = [];
    const active = this.app.workspace.getActiveFile();
    if (active?.extension === "md") {
      items.push({ id: `note:${active.path}`, title: active.basename, hint: t.links.openNote, icon: "file-text" });
      const folder = folderOf(active.path);
      if (folder) items.push({ id: `folder:${folder}`, title: folder, hint: t.links.folder, icon: "folder" });
    }
    items.push({ id: "folder:", title: t.links.wholeVault, icon: "vault" });
    const folders = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      for (let folder = folderOf(file.path); folder; folder = folderOf(folder)) folders.add(folder);
    }
    for (const path of [...folders].sort()) {
      if (!items.some((item) => item.id === `folder:${path}`)) items.push({ id: `folder:${path}`, title: path, hint: t.links.folder, icon: "folder" });
    }
    new PickModal(this.app, items, t.links.scopePrompt, (item) => {
      const [kind, ...rest] = item.id.split(":");
      this.open({ kind: kind === "note" ? "note" : "folder", path: rest.join(":") });
    }).open();
  }

  /** The scope of a file or folder from Obsidian's file menu. */
  scopeOf(file: TAbstractFile): LinkScope | null {
    if (file instanceof TFolder) return { kind: "folder", path: file.path === "/" ? "" : file.path };
    if (file instanceof TFile && file.extension === "md") return { kind: "note", path: file.path };
    return null;
  }

  open(scope: LinkScope) {
    const { candidates, more } = this.suggest(scope);
    const name = this.scopeName(scope);
    if (!candidates.length) {
      new Notice(t.links.nothing({ scope: name }));
      return;
    }
    const titleOf = (id: string) => this.store.graph.nodes.get(id)?.title ?? this.store.fileOf(id)?.basename ?? id;
    const describe = (row: BatchRow) => (row.origin === "list" && row.via ? t.links.inList({ note: titleOf(row.via) }) : "");
    new BatchPreviewModal(this.app, new LinkBatch(this.store.graph, candidates), {
      title: t.links.title({ scope: name }),
      intro: t.links.intro,
      titleOf,
      describe,
      footer: more ? t.links.more({ count: more }) : undefined,
      onApply: (edits) => attempt(this.apply(edits), "add the suggested links"),
    }).open();
  }

  /** Reads the notes of the scope and returns what they suggest, without the links the map already has. */
  suggest(scope: LinkScope) {
    const { vault, metadataCache } = this.app;
    const settings = this.plugin.settings;
    const graph = this.store.graph;
    const texts = new Map<string, NoteText>();
    const textOf = (file: TFile): NoteText => {
      const known = texts.get(file.path);
      if (known) return known;
      const cache = metadataCache.getFileCache(file);
      const links = (cache?.links ?? []).flatMap((link) => {
        const target = metadataCache.getFirstLinkpathDest(getLinkpath(link.link), file.path);
        return target?.extension === "md" ? [{ to: target.path, line: link.position.start.line }] : [];
      });
      const lists = (cache?.listItems ?? []).map((item) => ({ line: item.position.start.line, parent: item.parent }));
      const text = { id: file.path, links, lists };
      texts.set(file.path, text);
      return text;
    };

    const folder = scope.kind === "folder" ? scope.path : folderOf(scope.path);
    const inScope = (path: string) => folder === "" || folder === "/" || inFolders(path, [folder]);
    const notes =
      scope.kind === "note"
        ? [this.store.fileOf(scope.path)].filter((file): file is TFile => file !== null)
        : vault.getMarkdownFiles().filter((file) => inScope(file.path));

    const eligible = (id: string) => {
      const file = this.store.fileOf(id);
      if (!file || file.extension !== "md" || this.store.isOwnFile(id) || this.store.isExcluded(file)) return false;
      if (graph.nodes.get(id)?.kind === "source") return false;
      const frontmatter = metadataCache.getFileCache(file)?.frontmatter;
      const type: unknown = frontmatter?.[settings.typeKey];
      // Another type of note, or a material by its properties, is not a concept to link.
      if (type !== undefined) return type === "concept";
      return !(frontmatter && settings.teachesKey in frontmatter);
    };
    const nearby = (id: string) => {
      const node = graph.nodes.get(id);
      return (node?.kind === "concept" && !node.ghost) || inScope(id);
    };
    const linksOf = (id: string) => {
      const file = this.store.fileOf(id);
      return file ? textOf(file).links.map((link) => link.to) : [];
    };
    return suggestLinks({ notes: notes.map(textOf), linksOf, eligible, nearby, graph });
  }

  private scopeName(scope: LinkScope) {
    if (scope.kind === "note") return this.store.fileOf(scope.path)?.basename ?? scope.path;
    return scope.path === "" || scope.path === "/" ? t.links.wholeVault : scope.path;
  }

  private async apply(edits: LinkEdit[]) {
    const undo = await applyLinkEdits(this.app, this.plugin.settings, this.store.graph, edits);
    this.last = undo;
    const content = createFragment((fragment) => {
      fragment.createSpan({ text: t.links.added({ count: undo.links }) });
      const button = fragment.createEl("button", { cls: "tropa-notice-undo", text: t.undo });
      button.addEventListener("click", () => attempt(this.undo(), "undo the suggested links"));
    });
    new Notice(content, NOTICE_MS);
  }

  /** Takes back the last batch. Notes changed since keep their newer properties. */
  async undo() {
    const undo = this.last;
    if (!undo) return;
    this.last = null;
    const { kept } = await undoLinkEdits(this.app, undo);
    new Notice(kept ? `${t.links.undone} ${t.links.kept({ count: kept })}` : t.links.undone);
  }
}

/** The folder of a path, `""` at the top of the vault. */
function folderOf(path: string) {
  return path.split("/").slice(0, -1).join("/");
}
