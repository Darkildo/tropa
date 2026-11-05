import { Notice, normalizePath } from "obsidian";
import { attempt } from "./attempt";
import { normalizeTitle } from "./core/audit";
import { allGoalsOf } from "./core/graph";
import { LinkBatch, type LinkEdit } from "./core/batch-links";
import { safeFileName } from "./core/format";
import { planOutline, type OutlineItem, type OutlinePlan } from "./core/outline";
import { t } from "./i18n";
import { applyLinkEdits, createConceptNotes, rememberCreated, undoLinkEdits, type LinkUndo } from "./link-edits";
import type TropaPlugin from "./main";
import { BatchPreviewModal } from "./ui/batch-preview";
import { OutlineModal, type OutlineRequest } from "./ui/outline";

/** A batch notice stays longer than a mark's: it can change many notes at once. */
const NOTICE_MS = 10000;

/** A map from a pasted list: concepts from its lines, links from its nesting, with a preview and undo. */
export class OutlineImport {
  /** The last map made in this session, until it is undone. */
  last: LinkUndo | null = null;
  /** The goal set from the notice of the last map, taken back with it. */
  private goal: string | null = null;
  /** What was typed last time, so closing the preview to fix the list does not lose it. */
  private draft: OutlineRequest | null = null;

  constructor(private readonly plugin: TropaPlugin) {}

  private get app() {
    return this.plugin.app;
  }

  private get store() {
    return this.plugin.store;
  }

  open() {
    const initial = this.draft ?? { text: "", order: "parts", chain: false, folder: this.plugin.settings.conceptsFolder };
    new OutlineModal(this.app, initial, (request, items) => {
      this.draft = request;
      this.preview(request, items);
    }).open();
  }

  /** The notes and links of an outline, against the vault as it is now. */
  plan(request: OutlineRequest, items: OutlineItem[]): OutlinePlan {
    const { vault, metadataCache } = this.app;
    const graph = this.store.graph;
    const canBeConcept = (id: string) => this.plugin.links.canBeConcept(id);
    // Concepts first, then any note that could be one; a ghost gives its spelling to the note made for it.
    const byName = new Map<string, string>();
    const ghosts = new Map<string, string>();
    for (const node of graph.concepts) {
      const key = normalizeTitle(node.title);
      if (node.ghost) ghosts.set(key, node.title);
      else if (!byName.has(key)) byName.set(key, node.id);
    }
    const files = vault.getMarkdownFiles();
    for (const file of files) {
      const key = normalizeTitle(file.basename);
      if (!byName.has(key) && canBeConcept(file.path)) byName.set(key, file.path);
    }
    // File systems that ignore case would refuse a second "linear algebra.md" next to "Linear Algebra.md".
    const used = new Set(vault.getFiles().map((file) => file.path.toLowerCase()));
    const folder = request.folder || this.plugin.settings.conceptsFolder;
    const fileName = (title: string) => safeFileName(title) || t.untitled;

    return planOutline(items, request, {
      graph,
      fileName,
      find: (title, link) => {
        if (link) {
          const target = metadataCache.getFirstLinkpathDest(link, "");
          if (target?.extension === "md" && canBeConcept(target.path)) return target.path;
        }
        return byName.get(normalizeTitle(title)) ?? null;
      },
      newPath: (title, taken) => {
        const base = normalizePath(`${folder}/${fileName(ghosts.get(normalizeTitle(title)) ?? title)}`);
        const free = (path: string) => !used.has(path.toLowerCase()) && ![...taken].some((other) => other.toLowerCase() === path.toLowerCase());
        let path = `${base}.md`;
        for (let i = 2; !free(path); i++) path = `${base} ${i}.md`;
        return path;
      },
    });
  }

  private preview(request: OutlineRequest, items: OutlineItem[]) {
    const plan = this.plan(request, items);
    const titles = new Map(plan.notes.map((note) => [note.path, note.title]));
    const titleOf = (id: string) => titles.get(id) ?? this.store.graph.nodes.get(id)?.title ?? id;
    const fresh = plan.notes.filter((note) => !note.existing);
    const existing = plan.notes.filter((note) => note.existing);

    new BatchPreviewModal(this.app, new LinkBatch(this.store.graph, plan.candidates), {
      title: t.outline.title,
      intro: t.outline.previewIntro,
      sections: [
        { origin: "nest", title: t.outline.nest, hint: request.order === "parts" ? t.outline.nestParts : t.outline.nestTopic },
        { origin: "order", title: t.outline.sequence, hint: t.outline.sequenceHint },
      ],
      prelude: (el) => {
        const group = (cls: string, heading: string, notes: typeof plan.notes) => {
          if (!notes.length) return;
          const block = el.createDiv({ cls: `tropa-outline-notes ${cls}` });
          block.createEl("h3", { text: heading });
          const list = block.createDiv({ cls: "tropa-outline-chips" });
          for (const note of notes) {
            const chip = list.createSpan({ cls: "tropa-outline-chip", attr: { dir: "auto" } });
            chip.dataset.path = note.path;
            if (note.renamed) {
              chip.addClass("is-renamed");
              chip.setText(t.outline.renamed({ title: note.title, name: note.path.split("/").pop()!.replace(/\.md$/, "") }));
            } else chip.setText(note.title);
          }
        };
        group("is-new", t.outline.newNotes({ count: fresh.length, folder: request.folder || this.plugin.settings.conceptsFolder }), fresh);
        group("is-existing", t.outline.existingNotes({ count: existing.length }), existing);
      },
      titleOf,
      describe: () => "",
      applyLabel: (links) => t.outline.apply({ notes: fresh.length, links }),
      applyEmpty: fresh.length > 0 || existing.length > 0,
      onApply: (edits) => attempt(this.apply(plan, edits), "make the map from the list"),
    }).open();
  }

  private async apply(plan: OutlinePlan, edits: LinkEdit[]) {
    const settings = this.plugin.settings;
    const fresh = plan.notes.filter((note) => !note.existing).map((note) => note.path);
    const { paths, folders } = await createConceptNotes(this.app, settings.typeKey, fresh);
    const where = (path: string) => paths.get(path) ?? path;
    const placed = edits.map((edit) => ({ ...edit, from: where(edit.from), to: where(edit.to) }));
    const existing = plan.notes.filter((note) => note.existing).map((note) => note.path);
    const undo = await applyLinkEdits(this.app, settings, this.store.graph, placed, existing);
    await rememberCreated(this.app, undo, paths.values(), folders);
    this.last = undo;
    this.goal = null;
    this.draft = null;
    const root = plan.root ? where(plan.root) : null;
    const content = createFragment((fragment) => {
      fragment.createSpan({ text: t.outline.done({ notes: paths.size, links: undo.links }) });
      const button = fragment.createEl("button", { cls: "tropa-notice-undo", text: t.undo });
      button.addEventListener("click", () => attempt(this.undo(), "undo the map from the list"));
      if (root && this.store.progress.goal !== root) {
        const title = plan.notes.find((note) => note.path === plan.root)?.title ?? root;
        const goal = fragment.createEl("button", { cls: "tropa-notice-goal", text: t.outline.goal({ title }) });
        goal.addEventListener("click", (event) => {
          // The notice closes on a click; the goal is set first.
          event.stopPropagation();
          goal.remove();
          if (this.last !== undo) return;
          this.goal = allGoalsOf(this.store.progress).includes(root) ? null : root;
          this.store.addGoal(root);
          new Notice(t.outline.goalSet({ title }));
        });
      }
    });
    new Notice(content, NOTICE_MS);
    await this.plugin.showMap();
  }

  /** Takes back the last map: notes it created go to the trash, links it added to other notes are removed. Changed since, they stay. */
  async undo() {
    const undo = this.last;
    if (!undo) return;
    this.last = null;
    // A goal set from the notice goes with the map, as long as it is still a goal.
    const goal = this.goal;
    this.goal = null;
    if (goal && allGoalsOf(this.store.progress).includes(goal)) this.store.removeGoal(goal);
    const { kept } = await undoLinkEdits(this.app, undo);
    new Notice(kept ? `${t.outline.undone} ${t.links.kept({ count: kept })}` : t.outline.undone);
  }
}
