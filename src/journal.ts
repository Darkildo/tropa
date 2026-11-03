import { Events, Platform, TFile, normalizePath, type App, type EventRef, type TAbstractFile } from "obsidian";
import {
  formatEntry,
  JournalHistory,
  monthOf,
  parseJournal,
  progressEvents,
  type ChangeCause,
  type JournalEntry,
  type JournalEvent,
  type ResolvedEntry,
} from "./core/journal";
import { inFolders } from "./core/scope";
import type { Progress } from "./core/types";
import { t } from "./i18n";
import type { TropaSettings } from "./defaults";
import type { Store } from "./store";

/** Kept by Obsidian per vault and per device, outside the vault, so it never syncs. */
const DEVICE_KEY = "tropa-device";
const DEVICE_NAME = /^[\p{L}\p{N}_-]{1,40}$/u;

/**
 * Writes the learning journal and reads all of it back, from every device. Files are parsed once
 * and again only when they change; the merged history is rebuilt when a file or the graph changes.
 */
export class Journal extends Events {
  readonly device: string;
  private files = new Map<string, JournalEntry[]>();
  private history: JournalHistory | null = null;
  private topologyKey = "";
  private queue: { date: Date; event: JournalEvent }[] = [];
  private flushing: Promise<void> = Promise.resolve();
  private scheduled = false;

  constructor(
    private readonly app: App,
    private readonly settings: () => TropaSettings,
    private readonly store: Store,
  ) {
    super();
    this.device = deviceName(app);
  }

  on(name: "change", callback: () => void): EventRef;
  on(name: string, callback: (...data: never[]) => void): EventRef {
    return super.on(name, callback as (...data: unknown[]) => unknown);
  }

  get folder() {
    return normalizePath(this.settings().journalFolder);
  }

  contains(path: string) {
    return this.folder !== "" && path.endsWith(".md") && inFolders(path, [this.folder]);
  }

  /** Merged history of all devices, resolved against the graph as it is now. */
  get entries(): JournalHistory {
    if (this.history && this.topologyKey === this.store.topologyKey) return this.history;
    const resolved: ResolvedEntry[] = [];
    const ids = new Map<string, string | null>();
    for (const [path, entries] of this.files) {
      for (const entry of entries) {
        // Links resolve relative to their file; all journal files share a folder, so the target alone is the key.
        let id = ids.get(entry.target);
        if (id === undefined) ids.set(entry.target, (id = this.store.journalId(entry.target, path)));
        resolved.push({ ...entry, id });
      }
    }
    this.topologyKey = this.store.topologyKey;
    this.history = new JournalHistory(resolved);
    return this.history;
  }

  /** Reads every journal file. Called once the vault is ready and when the folder setting changes. */
  async load() {
    this.files.clear();
    const files = this.app.vault.getMarkdownFiles().filter((file) => this.contains(file.path));
    await Promise.all(files.map((file) => this.read(file)));
    this.changed();
  }

  /** A journal file was created or changed, here or by a sync from another device. */
  async reread(file: TAbstractFile) {
    if (!(file instanceof TFile) || !this.contains(file.path)) return;
    await this.read(file);
    this.changed();
  }

  forget(path: string) {
    if (this.files.delete(path)) this.changed();
  }

  /** Called by the store for every change of progress made on this device. */
  recordProgress(before: Progress, after: Progress, cause: ChangeCause | undefined) {
    this.record(progressEvents(before, after, cause));
  }

  /** Appends events with the current time. Several calls in one task end up in one write. */
  record(events: JournalEvent[]) {
    if (!this.settings().journal || events.length === 0) return;
    const date = new Date();
    for (const event of events) this.queue.push({ date, event });
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const batch = this.queue.splice(0);
      this.flushing = this.flushing
        .then(() => this.write(batch))
        .catch((error: unknown) => console.error("Tropa: failed to write the learning journal", error));
    });
  }

  /** Resolves when everything recorded so far is on disk. */
  async settled() {
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await this.flushing;
  }

  private async read(file: TFile) {
    this.files.set(file.path, parseJournal(await this.app.vault.cachedRead(file), file.path));
  }

  private changed() {
    this.history = null;
    this.trigger("change");
  }

  private async write(batch: { date: Date; event: JournalEvent }[]) {
    const byFile = new Map<string, string[]>();
    for (const { date, event } of batch) {
      const path = normalizePath(`${this.folder}/${monthOf(date)} ${this.device}.md`);
      const target = this.store.journalTarget(event.id, path);
      const line = formatEntry(date, event.action, target, event.fields, event.flags);
      let lines = byFile.get(path);
      if (!lines) byFile.set(path, (lines = []));
      lines.push(line);
    }
    for (const [path, lines] of byFile) {
      const text = `${lines.join("\n")}\n`;
      const existing = this.app.vault.getAbstractFileByPath(path);
      let content: string;
      if (existing instanceof TFile) {
        content = await this.app.vault.process(existing, (data) => `${data}${data === "" || data.endsWith("\n") ? "" : "\n"}${text}`);
      } else {
        await this.store.ensureFolder(this.folder);
        content = `---\ntype: learning-journal\ndevice: ${this.device}\n---\n\n${t.journal.fileText}\n\n${text}`;
        await this.app.vault.create(path, content);
      }
      // Seen at once, without waiting for the vault event that follows the write.
      this.files.set(path, parseJournal(content, path));
    }
    this.changed();
  }
}

/** `desktop-3f9a`, `phone-07c1`: the kind of device, for people, and a random part, so two phones differ. */
function deviceName(app: App): string {
  const saved: unknown = app.loadLocalStorage(DEVICE_KEY);
  if (typeof saved === "string" && DEVICE_NAME.test(saved)) return saved;
  const kind = Platform.isPhone ? "phone" : Platform.isTablet ? "tablet" : "desktop";
  const random = [...crypto.getRandomValues(new Uint8Array(2))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const name = `${kind}-${random}`;
  app.saveLocalStorage(DEVICE_KEY, name);
  return name;
}
