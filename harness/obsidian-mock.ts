// Browser stand-in for the parts of the Obsidian API that Tropa uses.
// It exists to run the real plugin code in a plain browser for UI checks.
import * as lucide from "lucide";
import { parse, stringify } from "yaml";

type Callback = (...args: any[]) => any;

const proto = HTMLElement.prototype as any;
const elementProto = Element.prototype as any;
const nodeProto = Node.prototype as any;

function create(this: HTMLElement, tag: string, options: any = {}, callback?: Callback) {
  const el = document.createElement(tag) as HTMLElement;
  if (typeof options === "string") el.className = options;
  else {
    if (options.cls) el.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
    if (options.text !== undefined) el.textContent = options.text;
    if (options.href) el.setAttribute("href", options.href);
    if (options.type) el.setAttribute("type", options.type);
    if (options.title) el.setAttribute("title", options.title);
    for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, String(value));
  }
  this.appendChild(el);
  callback?.(el);
  return el;
}

// Obsidian adds the same helpers to elements and document fragments.
for (const target of [proto, DocumentFragment.prototype as any]) {
  target.createEl = create;
  target.createDiv = function (options?: any, cb?: Callback) { return create.call(this, "div", options, cb); };
  target.createSpan = function (options?: any, cb?: Callback) { return create.call(this, "span", options, cb); };
}
// Obsidian's global helpers return detached elements.
const detached = (tag: string) => (options?: any, cb?: Callback) => {
  const el = create.call(document.createDocumentFragment(), tag, options, cb);
  el.remove();
  return el;
};
Object.assign(globalThis, {
  createDiv: detached("div"),
  createSpan: detached("span"),
  createEl: (tag: string, options?: any, cb?: Callback) => detached(tag)(options, cb),
  createFragment: (cb?: (fragment: DocumentFragment) => void) => {
    const fragment = document.createDocumentFragment();
    cb?.(fragment);
    return fragment;
  },
});
nodeProto.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
elementProto.addClass = function (...c: string[]) { this.classList.add(...c); };
elementProto.removeClass = function (...c: string[]) { this.classList.remove(...c); };
elementProto.toggleClass = function (c: string, on: boolean) { this.classList.toggle(c, on); };
elementProto.setText = function (text: string) { this.textContent = text; };
elementProto.setAttr = function (k: string, v: string) { this.setAttribute(k, v); };

const pascal = (name: string) => name.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
export const missingIcons = new Set<string>();

export function setIcon(el: HTMLElement, name: string) {
  const node = (lucide as any)[pascal(name)];
  el.innerHTML = "";
  if (!node) {
    missingIcons.add(name);
    console.error(`Unknown icon: ${name}`);
    return;
  }
  el.appendChild(lucide.createElement(node));
}

export class Events {
  private handlers = new Map<string, Set<Callback>>();
  on(name: string, callback: Callback, ctx?: any) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name)!.add(callback);
    return { emitter: this, name, callback, ctx } as any;
  }
  offref(ref: any) {
    this.handlers.get(ref.name)?.delete(ref.callback);
  }
  trigger(name: string, ...data: any[]) {
    [...(this.handlers.get(name) ?? [])].forEach((callback) => callback(...data));
  }
}

export class Component {
  private cleanups: Callback[] = [];
  load() { (this as any).onload?.(); }
  unload() { this.cleanups.forEach((c) => c()); (this as any).onunload?.(); }
  register(cb: Callback) { this.cleanups.push(cb); }
  registerEvent(ref: any) { this.cleanups.push(() => ref.emitter.offref(ref)); }
  registerInterval(id: number) { this.cleanups.push(() => window.clearInterval(id)); return id; }
  registerDomEvent(el: any, name: string, cb: any, options?: any) {
    el.addEventListener(name, cb, options);
    this.cleanups.push(() => el.removeEventListener(name, cb, options));
  }
}

export class TAbstractFile { path = ""; name = ""; }

export class TFile extends TAbstractFile {
  basename = "";
  extension = "md";
  constructor(path: string) {
    super();
    this.path = path;
    this.name = path.split("/").pop()!;
    const dot = this.name.lastIndexOf(".");
    this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
    this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  constructor(path: string) { super(); this.path = path; }
}

export const normalizePath = (path: string) => path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");

export const getLanguage = () => localStorage.getItem("language") ?? "en";

/** The note part of a link: no heading or block. */
export const getLinkpath = (link: string) => link.split(/[#^]/)[0];

export function debounce(fn: Callback, wait = 0) {
  let timer = 0;
  return (...args: any[]) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

const FRONTMATTER = /^---\n([\s\S]*?)\n?---\n?/;

export class Vault extends Events {
  files = new Map<string, TFile>();
  folders = new Set<string>();
  contents = new Map<string, string>();
  adapter = { exists: async (path: string) => this.files.has(path) || this.folders.has(path) };

  getMarkdownFiles() { return [...this.files.values()].filter((file) => file.extension === "md"); }
  getFiles() { return [...this.files.values()]; }
  getAbstractFileByPath(path: string) { return this.files.get(path) ?? (this.folders.has(path) ? new TFolder(path) : null); }
  getFolderByPath(path: string) {
    const prefix = `${path}/`;
    const known = this.folders.has(path) || [...this.files.keys()].some((file) => file.startsWith(prefix));
    return known ? this.folderAt(path) : null;
  }
  static recurseChildren(root: TFolder, cb: (file: TAbstractFile) => void) {
    cb(root);
    for (const child of root.children) {
      if (child instanceof TFolder) Vault.recurseChildren(child, cb);
      else cb(child);
    }
  }
  /** A folder with its children, built from the flat lists of files and folders. */
  private folderAt(path: string): TFolder {
    const folder = new TFolder(path);
    const prefix = `${path}/`;
    const subfolders = new Set<string>();
    for (const [file, entry] of this.files) {
      if (!file.startsWith(prefix)) continue;
      const slash = file.indexOf("/", prefix.length);
      if (slash < 0) folder.children.push(entry);
      else subfolders.add(file.slice(0, slash));
    }
    for (const sub of this.folders) {
      if (!sub.startsWith(prefix)) continue;
      const slash = sub.indexOf("/", prefix.length);
      subfolders.add(slash < 0 ? sub : sub.slice(0, slash));
    }
    for (const sub of subfolders) folder.children.push(this.folderAt(sub));
    return folder;
  }
  async read(file: TFile) { return this.contents.get(file.path) ?? ""; }
  async cachedRead(file: TFile) { return this.contents.get(file.path) ?? ""; }
  async process(file: TFile, fn: (data: string) => string) {
    const content = fn(this.contents.get(file.path) ?? "");
    await this.modify(file, content);
    return content;
  }

  seed(path: string, content: string) {
    this.files.set(path, new TFile(path));
    this.contents.set(path, content);
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) this.folders.add(parts.slice(0, i).join("/"));
  }

  async create(path: string, content: string) {
    if (this.files.has(path)) throw new Error(`File already exists: ${path}`);
    this.seed(path, content);
    const file = this.files.get(path)!;
    this.trigger("create", file);
    app.metadataCache.reindex(file);
    return file;
  }

  async createFolder(path: string) {
    if (this.folders.has(path)) throw new Error(`Folder already exists: ${path}`);
    this.folders.add(path);
  }

  async modify(file: TFile, content: string) {
    this.contents.set(file.path, content);
    this.trigger("modify", file);
    app.metadataCache.reindex(file);
  }

  async delete(file: TFile) {
    this.files.delete(file.path);
    this.contents.delete(file.path);
    this.trigger("delete", file);
    app.metadataCache.trigger("resolved");
  }
}

type Position = { start: { line: number }; end: { line: number } };
type Cache = {
  frontmatter?: any;
  tags?: { tag: string }[];
  links?: { link: string; position: Position }[];
  listItems?: { parent: number; position: Position }[];
};

const at = (line: number): Position => ({ start: { line }, end: { line } });

/**
 * Links and list items of the body, by file line as Obsidian counts them. A list item's parent is the
 * line of the item it is nested in, or minus the line of the list's first item at the top of a list.
 */
function bodyCache(lines: string[], from: number) {
  const links: NonNullable<Cache["links"]> = [];
  const listItems: NonNullable<Cache["listItems"]> = [];
  const stack: { indent: number; line: number }[] = [];
  let first = -1;
  for (let line = from; line < lines.length; line++) {
    const text = lines[line];
    // Embeds (![[...]]) are not links.
    for (const match of text.matchAll(/(!?)\[\[([^\]]+)\]\]/g)) if (!match[1]) links.push({ link: match[2].split("|")[0], position: at(line) });
    const item = /^(\s*)(?:[-*+]|\d+\.)\s/.exec(text);
    if (!item) {
      if (text.trim()) {
        stack.length = 0;
        first = -1;
      }
      continue;
    }
    const indent = item[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (!stack.length && first < 0) first = line;
    listItems.push({ parent: stack.length ? stack[stack.length - 1].line : -first, position: at(line) });
    stack.push({ indent, line });
  }
  return { ...(links.length ? { links } : {}), ...(listItems.length ? { listItems } : {}) };
}

// Inline tags of the body, as Obsidian lists them in the cache: `#` included, nested parts kept.
const INLINE_TAG = /(?:^|\s)(#[\p{L}\p{N}_/-]+)/gu;

/** Frontmatter `tags` (list or string, `#` optional) and inline tags, each with `#`, as in Obsidian. */
export function getAllTags(cache: Cache): string[] | null {
  const raw = cache.frontmatter?.tags ?? cache.frontmatter?.tag;
  const own = (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,]+/) : []).map(String).filter(Boolean);
  const tags = [...own.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)), ...(cache.tags ?? []).map((entry) => entry.tag)];
  return tags.length ? tags : null;
}

class MetadataCache extends Events {
  private cache = new Map<string, Cache>();
  index(file: TFile) {
    const content = app.vault.contents.get(file.path) ?? "";
    const match = FRONTMATTER.exec(content);
    const body = match ? content.slice(match[0].length) : content;
    const tags = [...body.matchAll(INLINE_TAG)].map((found) => ({ tag: found[1] }));
    const lines = content.split("\n");
    const from = match ? match[0].split("\n").length - (match[0].endsWith("\n") ? 1 : 0) : 0;
    this.cache.set(file.path, {
      ...(match ? { frontmatter: parse(match[1]) ?? {} } : {}),
      ...(tags.length ? { tags } : {}),
      ...bodyCache(lines, from),
    });
  }
  reindex(file: TFile) {
    // Real indexing is asynchronous, so this is too.
    window.setTimeout(() => {
      this.index(file);
      this.trigger("changed", file);
      this.trigger("resolved");
    }, 30);
  }
  getFileCache(file: TFile) { return this.cache.get(file.path) ?? null; }
  // Notes match without ".md", attachments by their full name, as in Obsidian.
  getFirstLinkpathDest(link: string) {
    const files = app.vault.getFiles();
    return (
      files.find((f) => f.path === link || f.path === `${link}.md`) ??
      files.find((f) => (f.extension === "md" ? f.basename : f.name) === link) ??
      null
    );
  }
  fileToLinktext(file: TFile) {
    if (file.extension !== "md") {
      const unique = app.vault.getFiles().filter((f) => f.name === file.name).length === 1;
      return unique ? file.name : file.path;
    }
    const unique = app.vault.getMarkdownFiles().filter((f) => f.basename === file.basename).length === 1;
    return unique ? file.basename : file.path.replace(/\.md$/, "");
  }
}

class FileManager {
  async processFrontMatter(file: TFile, fn: (frontmatter: any) => void) {
    const content = app.vault.contents.get(file.path) ?? "";
    const match = FRONTMATTER.exec(content);
    const frontmatter = match ? parse(match[1]) ?? {} : {};
    fn(frontmatter);
    const body = match ? content.slice(match[0].length) : content;
    await app.vault.modify(file, `---\n${stringify(frontmatter)}---\n${body}`);
  }
}

export class WorkspaceLeaf {
  view: any = null;
  file: TFile | null = null;
  constructor(readonly containerEl: HTMLElement, readonly side: "center" | "right" | "note") {}
  async setViewState(state: { type: string }) {
    const factory = app.workspace.factories.get(state.type)!;
    this.view = factory(this);
    this.containerEl.empty();
    if (this.side === "note") this.containerEl.dataset.open = "true";
    this.containerEl.appendChild(this.view.containerEl);
    await this.view.onOpen();
  }
  async openFile(file: TFile) {
    this.file = file;
    this.containerEl.empty();
    this.containerEl.dataset.open = "true";
    const title = this.containerEl.createEl("h1", { cls: "note-title", text: file.basename });
    title.dataset.path = file.path;
    const text = this.containerEl.createEl("textarea", { cls: "note-source" }) as HTMLTextAreaElement;
    text.value = app.vault.contents.get(file.path) ?? "";
    text.addEventListener("change", () => void app.vault.modify(file, text.value));
    app.workspace.setActive(file);
  }
}

class Workspace extends Events {
  factories = new Map<string, (leaf: WorkspaceLeaf) => any>();
  center!: WorkspaceLeaf;
  right!: WorkspaceLeaf;
  note!: WorkspaceLeaf;
  private active: TFile | null = null;
  onLayoutReady(cb: Callback) { window.setTimeout(cb); }
  getActiveFile() { return this.active; }
  setActive(file: TFile | null) { this.active = file; this.trigger("file-open", file); }
  getLeavesOfType(type: string) {
    if (type === "markdown") return this.note?.file ? [this.note] : [];
    return [this.center, this.right, this.note].filter((leaf) => leaf?.view?.getViewType() === type);
  }
  getLeaf() { return this.note; }
  getRightLeaf() { return this.right; }
  async revealLeaf() {}
  /** Counts saves, so checks can see that view state changes ask for one. */
  layoutSaves = 0;
  requestSaveLayout = () => {
    this.layoutSaves++;
  };
}

export class App {
  vault = new Vault();
  metadataCache = new MetadataCache();
  fileManager = new FileManager();
  workspace = new Workspace();
  // Per vault and device in Obsidian; here the page's own storage, so a reload keeps the device.
  loadLocalStorage(key: string) {
    const value = localStorage.getItem(`vault:${key}`);
    return value === null ? null : JSON.parse(value);
  }
  saveLocalStorage(key: string, data: unknown) {
    if (data === null) localStorage.removeItem(`vault:${key}`);
    else localStorage.setItem(`vault:${key}`, JSON.stringify(data));
  }
}

export const app = new App();

export class ItemView extends Component {
  app = app;
  containerEl = document.createElement("div");
  contentEl: HTMLElement;
  navigation = true;
  constructor(readonly leaf: WorkspaceLeaf) {
    super();
    this.containerEl.className = "workspace-leaf-content";
    this.contentEl = (this.containerEl as any).createDiv({ cls: "view-content" });
  }
  async setState() {}
}

export class Plugin extends Component {
  app = app;
  data: any = null;
  commands: any[] = [];
  settingTab: any = null;
  constructor(_app?: any, readonly manifest?: any) { super(); }
  async loadData() { return this.data; }
  async saveData(data: any) { this.data = data; }
  registerView(type: string, factory: any) { app.workspace.factories.set(type, factory); }
  addSettingTab(tab: any) { this.settingTab = tab; }
  addRibbonIcon() { return document.createElement("div"); }
  addCommand(command: any) { this.commands.push(command); return command; }
}

export class PluginSettingTab {
  containerEl = document.createElement("div");
  constructor(readonly app: App, readonly plugin: any) {}
  getSettingDefinitions(): any[] { return []; }
  getControlValue(key: string): unknown { return this.plugin.settings[key]; }
  async setControlValue(key: string, value: unknown) {
    this.plugin.settings[key] = value;
    await this.plugin.saveData(this.plugin.settings);
  }

  // Renders what Tropa uses of the declarative API (1.13): groups, rows, toggles, dropdowns, text and textarea controls.
  display() {
    const root = this.containerEl as any;
    root.empty();
    const row = (parent: any, def: any) => {
      const item = parent.createDiv({ cls: "setting-item" });
      const info = item.createDiv({ cls: "setting-item-info" });
      info.createDiv({ cls: "setting-item-name", text: def.name });
      if (def.desc) info.createDiv({ cls: "setting-item-description", text: def.desc });
      const control = def.control;
      if (control?.type === "toggle") {
        const box = item.createDiv({ cls: "setting-item-control" }).createEl("input", { type: "checkbox" }) as HTMLInputElement;
        box.dataset.key = control.key;
        box.checked = this.getControlValue(control.key) === true;
        box.addEventListener("change", () => void this.setControlValue(control.key, box.checked));
        return;
      }
      if (control?.type === "dropdown") {
        const select = item.createDiv({ cls: "setting-item-control" }).createEl("select", { cls: "dropdown" }) as HTMLSelectElement;
        select.dataset.key = control.key;
        for (const [value, label] of Object.entries(control.options as Record<string, string>)) select.createEl("option", { text: label, attr: { value } });
        select.value = String(this.getControlValue(control.key) ?? "");
        select.addEventListener("change", () => void this.setControlValue(control.key, select.value));
        return;
      }
      if (control?.type !== "text" && control?.type !== "textarea") return;
      const host = item.createDiv({ cls: "setting-item-control" });
      const input = (
        control.type === "textarea"
          ? host.createEl("textarea", { attr: { placeholder: control.placeholder ?? "", rows: String(control.rows ?? 3) } })
          : host.createEl("input", { type: "text", attr: { placeholder: control.placeholder ?? "" } })
      ) as HTMLInputElement | HTMLTextAreaElement;
      input.dataset.key = control.key;
      input.value = String(this.getControlValue(control.key) ?? control.defaultValue ?? "");
      input.addEventListener("change", () => void this.setControlValue(control.key, input.value));
    };
    for (const def of this.getSettingDefinitions()) {
      if (def.type !== "group") {
        row(root, def);
        continue;
      }
      const group = root.createDiv({ cls: "setting-group" });
      if (def.heading) group.createDiv({ cls: "setting-item setting-item-heading", text: def.heading });
      for (const child of def.items ?? []) row(group, child);
    }
  }
}

export const notices: string[] = [];

export class Notice {
  noticeEl: HTMLElement;
  constructor(message: string | DocumentFragment, duration = 3000) {
    notices.push(typeof message === "string" ? message : message.textContent ?? "");
    const el = (document.body as any).createDiv({ cls: "notice" });
    if (typeof message === "string") el.textContent = message;
    else el.appendChild(message);
    this.noticeEl = el;
    window.setTimeout(() => this.hide(), duration);
  }
  hide() {
    this.noticeEl.remove();
  }
}

/** Paragraphs as plain text: enough to see that a question or an answer was rendered where it belongs. */
export const MarkdownRenderer = {
  async render(_app: any, markdown: string, el: HTMLElement, _sourcePath: string, _component: any) {
    for (const block of markdown.split(/\n\s*\n/)) {
      if (!block.trim()) continue;
      const p = document.createElement("p");
      p.textContent = block.trim();
      el.appendChild(p);
    }
  },
};

export class Modal {
  app = app;
  containerEl = document.createElement("div");
  modalEl: HTMLElement;
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  constructor(_app: any) {
    this.containerEl.className = "modal-container";
    const bg = (this.containerEl as any).createDiv({ cls: "modal-bg" });
    bg.addEventListener("click", () => this.close());
    this.modalEl = (this.containerEl as any).createDiv({ cls: "modal" });
    this.titleEl = (this.modalEl as any).createDiv({ cls: "modal-title" });
    this.contentEl = (this.modalEl as any).createDiv({ cls: "modal-content" });
    this.containerEl.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.close();
    });
  }
  setTitle(title: string) { this.titleEl.textContent = title; return this; }
  open() { document.body.appendChild(this.containerEl); (this as any).onOpen?.(); }
  close() { this.containerEl.remove(); (this as any).onClose?.(); }
}

export abstract class SuggestModal<T> extends Modal {
  inputEl: HTMLInputElement;
  resultContainerEl: HTMLElement;
  emptyStateText = "";
  private items: T[] = [];
  private index = 0;

  constructor(appRef: any) {
    super(appRef);
    this.modalEl.addClass("prompt");
    this.titleEl.remove();
    this.contentEl.remove();
    this.inputEl = (this.modalEl as any).createEl("input", { cls: "prompt-input", type: "text" });
    this.resultContainerEl = (this.modalEl as any).createDiv({ cls: "prompt-results" });
    this.inputEl.addEventListener("input", () => this.refresh());
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") { this.index = Math.min(this.index + 1, this.items.length - 1); this.paint(); }
      if (event.key === "ArrowUp") { this.index = Math.max(this.index - 1, 0); this.paint(); }
      if (event.key === "Enter" && this.items[this.index]) this.choose(this.items[this.index]);
    });
  }
  setPlaceholder(text: string) { this.inputEl.placeholder = text; }
  setInstructions() {}
  override open() { super.open(); this.refresh(); this.inputEl.focus(); }
  private choose(item: T) { this.close(); this.onChooseSuggestion(item); }
  private refresh() {
    this.items = this.getSuggestions(this.inputEl.value) as T[];
    this.index = 0;
    this.paint();
  }
  private paint() {
    this.resultContainerEl.empty();
    if (!this.items.length) (this.resultContainerEl as any).createDiv({ cls: "suggestion-empty", text: this.emptyStateText });
    this.items.forEach((item, i) => {
      const row = (this.resultContainerEl as any).createDiv({ cls: `suggestion-item${i === this.index ? " is-selected" : ""}` });
      this.renderSuggestion(item, row);
      row.addEventListener("click", () => this.choose(item));
    });
  }
  abstract getSuggestions(query: string): T[];
  abstract renderSuggestion(item: T, el: HTMLElement): void;
  abstract onChooseSuggestion(item: T, evt: any): void;
}

export class Menu {
  private el = document.createElement("div");
  constructor() { this.el.className = "menu"; }
  addItem(cb: (item: any) => void) {
    const row = (this.el as any).createDiv({ cls: "menu-item" });
    const item = {
      setTitle(text: string) { row.textContent = text; return item; },
      setIcon() { return item; },
      setChecked(checked: boolean) { row.toggleClass("mod-checked", checked); row.setAttribute("aria-checked", String(checked)); return item; },
      setDisabled(disabled: boolean) { row.toggleClass("is-disabled", disabled); return item; },
      onClick: (fn: Callback) => {
        row.addEventListener("click", () => {
          if (row.classList.contains("is-disabled")) return;
          this.el.remove();
          fn();
        });
        return item;
      },
    };
    cb(item);
    return this;
  }
  addSeparator() {
    (this.el as any).createDiv({ cls: "menu-separator" });
    return this;
  }
  showAtMouseEvent(event: MouseEvent) {
    this.showAtPosition({ x: event.clientX, y: event.clientY });
  }
  showAtPosition(position: { x: number; y: number }) {
    this.el.style.left = `${Math.min(position.x, innerWidth - 200)}px`;
    this.el.style.top = `${position.y}px`;
    document.body.appendChild(this.el);
    window.setTimeout(() => document.addEventListener("click", () => this.el.remove(), { once: true }));
  }
}

/** Obsidian reports the device; the preview takes it from the classes Obsidian puts on the body. */
export const Platform = {
  get isMobile() { return document.body.classList.contains("is-mobile"); },
  get isPhone() { return document.body.classList.contains("is-phone"); },
  get isTablet() { return document.body.classList.contains("is-tablet"); },
  get isDesktop() { return !document.body.classList.contains("is-mobile"); },
};

export class Setting {
  settingEl: HTMLElement;
  nameEl: HTMLElement;
  private info: HTMLElement;
  private control: HTMLElement;
  constructor(parent: HTMLElement) {
    this.settingEl = (parent as any).createDiv({ cls: "setting-item" });
    this.info = (this.settingEl as any).createDiv({ cls: "setting-item-info" });
    this.nameEl = (this.info as any).createDiv({ cls: "setting-item-name" });
    this.control = (this.settingEl as any).createDiv({ cls: "setting-item-control" });
  }
  setName(name: string) { this.nameEl.textContent = name; return this; }
  setDesc(desc: string) { (this.info as any).createDiv({ cls: "setting-item-description", text: desc }); return this; }
  setHeading() { this.settingEl.addClass("setting-item-heading"); return this; }
  addText(cb: (text: any) => void) {
    const inputEl = (this.control as any).createEl("input", { type: "text" }) as HTMLInputElement;
    const api = {
      inputEl,
      setPlaceholder(v: string) { inputEl.placeholder = v; return api; },
      setValue(v: string) { inputEl.value = v; return api; },
      onChange(fn: Callback) { inputEl.addEventListener("input", () => fn(inputEl.value)); return api; },
    };
    cb(api);
    return this;
  }
  addDropdown(cb: (dropdown: any) => void) {
    const select = (this.control as any).createEl("select", { cls: "dropdown" }) as HTMLSelectElement;
    const api = {
      addOptions(options: Record<string, string>) {
        for (const [value, text] of Object.entries(options)) (select as any).createEl("option", { text, attr: { value } });
        return api;
      },
      setValue(v: string) { select.value = v; return api; },
      onChange(fn: Callback) { select.addEventListener("change", () => fn(select.value)); return api; },
    };
    cb(api);
    return this;
  }
  addToggle(cb: (toggle: any) => void) {
    const container = (this.control as any).createDiv({ cls: "checkbox-container" }) as HTMLElement;
    const input = (container as any).createEl("input", { type: "checkbox" }) as HTMLInputElement;
    const api = {
      toggleEl: container,
      getValue: () => input.checked,
      setValue(v: boolean) { input.checked = v; container.toggleClass("is-enabled", v); return api; },
      onChange(fn: Callback) {
        input.addEventListener("change", () => {
          container.toggleClass("is-enabled", input.checked);
          fn(input.checked);
        });
        return api;
      },
    };
    cb(api);
    return this;
  }
  addButton(cb: (button: any) => void) {
    const button = (this.control as any).createEl("button") as HTMLButtonElement;
    const api = {
      setButtonText(v: string) { button.textContent = v; return api; },
      setCta() { button.addClass("mod-cta"); return api; },
      onClick(fn: Callback) { button.addEventListener("click", fn); return api; },
    };
    cb(api);
    return this;
  }
}
