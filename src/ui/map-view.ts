import { ItemView, Menu, Notice, Platform, setIcon, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { FORMAT_ICON, STATE_ICON, formatDate, formatMinutes } from "../core/format";
import { finishLayout, prepareLayout, type Layout, type LaidOutNode } from "../core/layout";
import { LayoutRunner } from "../core/layout-runner";
import layoutWorker from "tropa:layout-worker";
import { auditCount, auditGraph, type Audit } from "../core/audit";
import { allGoalsOf, isGoal, isPassed, knownCandidates, sourceState, type LearningGraph } from "../core/graph";
import { MAX_FOCUS_DEPTH, fold, foldersOf, neighborhood } from "../core/neighborhood";
import type { GraphNode } from "../core/types";
import { attempt } from "../attempt";
import { isRtl, locale, t } from "../i18n";
import type TropaPlugin from "../main";
import type { Undo } from "../store";
import { REVIEW_ICON, openKnownModal, pickUnlock, renderConcept, renderRoute, renderSource, type DetailHost } from "./detail";
import { PickModal } from "./pick";
import { PlanModal } from "./plan";
import { parseDate } from "../core/plan";
import { basename } from "../core/links";
import { navbarOverlap } from "./phone";
import { ExportModal } from "./export";
import { fileName } from "../core/export-path";
import { buildCanvas, canvasText, CANVAS_COLOR, type ExportNode } from "../core/canvas";
import { buildSvg, wrapText, type SvgBox, type SvgIcon, type SvgPath, type SvgText } from "../core/svg";

export const MAP_VIEW = "tropa-map";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1.6;
const READABLE_ZOOM = 0.6;
const CLOSE_ZOOM = 0.8;
/** On a phone the map never opens or fits smaller than this: below it titles cannot be read. */
const PHONE_MIN_ZOOM = 0.7;
const DOUBLE_TAP_MS = 320;
const LONG_PRESS_MS = 500;
/** A finger moves a little even when it means to stay put. */
const TOUCH_SLOP = 10;
/** Heights of the panel on a phone: the title, half the map, nearly all of it. */
const SHEET_PEEK = 92;
type SheetState = "peek" | "half" | "full";
/**
 * A zoomed-out map with more edges than this draws them without dashes. Dashed paths are slow to
 * rasterise: on a 1700-node map (3400 edges) the browser froze for over 30 s. Maps of 400 concepts
 * (about 970 edges) or of 200 concepts with their materials (about 740) keep their dashes.
 */
const DASHED_EDGES_MAX = 1000;
const SVG_NS = "http://www.w3.org/2000/svg";

interface Viewport {
  x: number;
  y: number;
  k: number;
  userMoved: boolean;
}

interface MapState {
  selected?: string | null;
  focus?: { center?: unknown; depth?: unknown } | null;
  folded?: unknown;
}

interface Press {
  nodeId: string | null;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
  touch: boolean;
}

/** Two fingers: where they started, so the map under them follows both zoom and pan. */
interface Pinch {
  distance: number;
  centerX: number;
  centerY: number;
  k: number;
  x: number;
  y: number;
}

export class MapView extends ItemView implements DetailHost {
  private root!: HTMLElement;
  private bar!: HTMLElement;
  private stage!: HTMLElement;
  private canvas!: HTMLElement;
  private world!: HTMLElement;
  private svg!: SVGSVGElement;
  private side!: HTMLElement;
  private body!: HTMLElement;
  private toastEl: HTMLElement | null = null;
  private toastTimer = 0;
  /** The progress change the toast offers to undo, if any. */
  private toastUndo: Undo | null = null;

  private readonly nodeEls = new Map<string, HTMLElement>();
  private layout: Layout | null = null;
  private layoutKey = "";
  private readonly layouts = new LayoutRunner(layoutWorker);
  /** The worker is still laying out the graph for `layoutKey`; the map shows the previous layout. */
  private layoutPending = false;
  /** The layout the nodes and edges were last placed by: an unchanged one only needs repainting. */
  private drawnLayout: Layout | null = null;
  /** The audit of the current graph, kept until the graph changes. */
  private audited: { graph: LearningGraph; audit: Audit } | null = null;
  /** Callers of `layoutReady` waiting for the layout in the worker. */
  private readonly layoutWaiters: (() => void)[] = [];
  private selected: string | null = null;
  private x = 40;
  private y = 40;
  private k = 1;

  private press: Press | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: Pinch | null = null;
  private lastTap: { time: number; x: number; y: number } | null = null;
  /** When a finger last touched the map: the browser's own long-press menu and double-click are ignored then. */
  private lastTouch = 0;
  private longPress = 0;
  /** After a long press the lifted finger makes a click, which would close the menu it just opened. */
  private swallowClick: ((event: Event) => void) | null = null;
  private sheet: SheetState = "peek";
  private sheetDrag: { startY: number; height: number; moved: boolean } | null = null;
  /** How much of the bottom of the view Obsidian's own bar on a phone covers. */
  private bottomInset = 0;
  private needsFit = true;
  private sideCollapsed = false;
  /** Until the person pans or zooms, the view keeps itself framed. */
  private userMoved = false;
  private overview = false;

  /** Only what is near one node. Kept with the view, never in notes or progress. */
  private focus: { center: string; depth: number } | null = null;
  private focusDepth = 1;
  /** Where the map was before focusing, to come back to. */
  private beforeFocus: Viewport | null = null;
  private restoreView: Viewport | null = null;
  /** Concepts whose branch of what they open is folded away. */
  private readonly folded = new Set<string>();
  /** On the current map: concepts left out by folds, how many each fold hides, and of those on the route. */
  private hidden = new Set<string>();
  private foldCounts = new Map<string, number>();
  private foldedRoute = new Map<string, number>();
  /** Concepts that open something on the current map, so they can be folded. */
  private foldable = new Set<string>();
  /** Concepts on the current map before folds: the focus, the route or all of them. */
  private inScope = new Set<string>();

  canGoBack = true;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TropaPlugin) {
    super(leaf);
    this.navigation = false;
  }

  get store() {
    return this.plugin.store;
  }

  get reviews() {
    return this.plugin.reviews;
  }

  getViewType() {
    return MAP_VIEW;
  }

  getDisplayText() {
    return t.mapTitle;
  }

  getIcon() {
    return "route";
  }

  async onOpen() {
    this.root = this.contentEl.createDiv({ cls: "tropa-map", attr: { dir: isRtl() ? "rtl" : "ltr" } });
    // Badges are drawn in CSS, so their text comes in through custom properties.
    this.root.style.setProperty("--tropa-next-label", JSON.stringify(t.nextBadge));
    this.root.style.setProperty("--tropa-goal-label", JSON.stringify(t.goalBadge));
    this.contentEl.addClass("tropa-host");
    this.bar = this.root.createDiv({ cls: "tropa-bar" });
    const body = (this.body = this.root.createDiv({ cls: "tropa-body" }));
    this.stage = body.createDiv({ cls: "tropa-stage" });
    this.canvas = this.stage.createDiv({ cls: "tropa-canvas" });
    this.world = this.canvas.createDiv({ cls: "tropa-world" });
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.addClass("tropa-edges");
    this.world.appendChild(this.svg);
    this.side = body.createDiv({ cls: "tropa-side" });
    this.root.toggleClass("is-phone", Platform.isPhone);

    this.buildControls();
    this.bindCanvas();

    const observer = new ResizeObserver(() => {
      this.root.toggleClass("is-narrow", this.root.clientWidth < 760);
      this.placeSheet();
      if (!this.userMoved && this.layout) this.frame();
    });
    observer.observe(this.root);
    this.register(() => observer.disconnect());
    this.register(() => this.layouts.dispose());
    this.register(() => this.releaseClick());

    // Obsidian's bar at the bottom of a phone can appear after the view; measure again once it has.
    this.registerEvent(this.app.workspace.on("layout-change", () => this.placeSheet()));
    window.setTimeout(() => this.placeSheet(), 400);
    this.registerEvent(
      this.store.on("change", () => {
        this.dropStaleUndo();
        this.render();
      }),
    );
    // Reviews change the badges and the queue, never the layout.
    this.registerEvent(
      this.reviews.on("change", () => {
        if (!this.layout || this.store.isEmpty) return;
        this.paintNodes();
        this.renderSide(this.side.scrollTop);
      }),
    );
    this.registerEvent(this.store.on("mastered", (id, unlocked, undo) => this.celebrate(id, unlocked, undo)));
    this.registerEvent(this.store.on("undoable", (message, unlocked, undo) => this.announce(message, unlocked, undo)));
    this.render();
  }

  getState() {
    const { graph } = this.store;
    // Folds of concepts that are gone are dropped once the vault has been read.
    const folded = [...this.folded].filter((id) => graph.nodes.size === 0 || graph.nodes.has(id));
    return { selected: this.selected, focus: this.focus, folded };
  }

  async setState(state: MapState, result: ViewStateResult) {
    if (Array.isArray(state?.folded)) {
      this.folded.clear();
      state.folded.forEach((id) => typeof id === "string" && this.folded.add(id));
    }
    const center = state?.focus?.center;
    if (typeof center === "string") {
      this.focusDepth = clamp(Math.round(Number(state.focus?.depth) || 1), 1, MAX_FOCUS_DEPTH);
      this.focus = { center, depth: this.focusDepth };
      this.needsFit = true;
      this.overview = true;
    }
    if (state?.selected && this.store.graph.nodes.has(state.selected)) this.select(state.selected);
    else this.render();
    await super.setState(state, result);
  }

  private saveViewState() {
    this.app.workspace.requestSaveLayout();
  }

  /** Route steps that the map does not show right now: folded away or outside the focus. */
  isHidden(id: string) {
    return this.hidden.has(id) || (this.focus !== null && !this.inScope.has(id));
  }

  // DetailHost

  select(id: string | null) {
    if (id) this.bringIntoView(id);
    // On a phone the details of what was picked show in the panel, so it opens halfway.
    if (id && this.sheet === "peek" && this.root?.classList.contains("is-phone")) this.setSheet("half");
    this.selected = id;
    this.sideCollapsed = false;
    this.renderSide();
    this.paintNodes();
    this.renderFocusControls();
    if (id) this.reveal(id);
  }

  /**
   * A note picked from the route list, the audit or a command may sit in a folded branch or outside
   * the focus. A material stands with the concepts it teaches, so those decide for it.
   */
  private bringIntoView(id: string) {
    const { graph } = this.store;
    const node = graph.nodes.get(id);
    const concepts = node?.kind === "source" ? node.teaches : [id];
    if (!concepts.length) return;
    if (this.focus && !concepts.some((concept) => this.inScope.has(concept))) {
      this.focus = null;
      this.beforeFocus = null;
      this.needsFit = false;
      this.saveViewState();
      this.render();
    }
    if (concepts.every((concept) => this.hidden.has(concept))) {
      foldersOf(graph, this.folded, concepts[0]).forEach((folder) => this.folded.delete(folder));
      this.saveViewState();
      this.render();
    }
  }

  /** Resolves once the map shows the layout it asked for last; at once when none is on its way. */
  layoutReady(): Promise<void> {
    if (!this.layoutPending) return Promise.resolve();
    return new Promise((resolve) => this.layoutWaiters.push(resolve));
  }

  openNote(id: string, newTab = false) {
    this.plugin.openNote(id, newTab);
  }

  /**
   * Centres a note for commands such as "find on the map" or the audit. Whatever hides it gives way
   * first: the route, materials being off, a fold or the focus. A large map may then be laid out
   * in the worker, so the note is centred once that layout is on screen.
   */
  async focusNode(id: string) {
    const { settings } = this.plugin;
    const { graph, route } = this.store;
    const node = graph.nodes.get(id);
    if (!node) return;
    const onRoute = node.kind === "source" ? node.teaches.length === 0 || node.teaches.some((concept) => route?.closure.has(concept)) : route?.closure.has(id);
    const mode = this.effectiveMode() === "route" && !onRoute;
    const sources = node.kind === "source" && !settings.showSources;
    if (mode) settings.mapMode = "all";
    if (sources) settings.showSources = true;
    if (mode || sources) {
      attempt(this.plugin.saveSettings(), "save settings");
      this.render();
    }
    this.bringIntoView(id);
    await this.layoutReady();
    this.select(id);
    const placed = this.layout?.nodes.get(id);
    if (placed) this.centerOn(placed);
    this.nodeEls.get(id)?.focus({ preventScroll: true });
  }

  /** Picks a goal in place of the active one, the way choosing a goal always worked. */
  pickGoal = () => this.pickConcept(t.goalPrompt, new Set(), (id) => this.chooseGoal(id));

  private pickConcept(prompt: string, except: Set<string>, run: (id: string) => void) {
    const items = this.store.graph.concepts
      .filter((node) => !except.has(node.id))
      .sort((a, b) => a.title.localeCompare(b.title, "ru"))
      .map((node) => ({ id: node.id, title: node.title, icon: STATE_ICON[this.store.states.get(node.id) ?? "locked"] }));
    new PickModal(this.app, items, prompt, (item) => run(item.id)).open();
  }

  /** Every change of what the route leads to starts with a fresh view of it. */
  private changeGoals(run: () => void) {
    this.needsFit = true;
    this.selected = null;
    this.drawTrail();
    run();
  }

  private chooseGoal(id: string) {
    this.changeGoals(() => this.store.setGoal(id));
  }

  private goalTitle(id: string) {
    return this.store.graph.nodes.get(id)?.title ?? basename(id).replace(/\.md$/, "");
  }

  /** The goal button: with no goal it picks one, otherwise it lists the goals and what can be done with them. */
  private openGoalMenu(anchor: HTMLElement) {
    const { store } = this;
    const { progress } = store;
    const goals = allGoalsOf(progress);
    if (goals.length === 0) {
      this.pickGoal();
      return;
    }
    const menu = new Menu();
    for (const id of goals) {
      const deadline = progress.deadlines.get(id);
      const title = deadline ? t.goals.until({ title: this.goalTitle(id), date: formatDate(parseDate(deadline)) }) : this.goalTitle(id);
      menu.addItem((item) =>
        item
          .setTitle(title)
          .setIcon("flag")
          .setChecked(!progress.allGoals && progress.goal === id)
          .onClick(() => this.changeGoals(() => store.setActiveGoal(id))),
      );
    }
    if (goals.length > 1) {
      menu.addItem((item) =>
        item.setTitle(t.goals.all).setIcon("flag-triangle-right").setChecked(progress.allGoals).onClick(() => this.changeGoals(() => store.setAllGoals(true))),
      );
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t.goals.replace).setIcon("replace").onClick(this.pickGoal));
    menu.addItem((item) =>
      item.setTitle(t.goals.addMore).setIcon("plus").onClick(() =>
        this.pickConcept(t.goals.addPrompt, new Set(goals), (id) => this.changeGoals(() => store.addGoal(id))),
      ),
    );
    menu.addItem((item) => item.setTitle(t.plan.menu).setIcon("calendar-clock").onClick(() => new PlanModal(this.app, store).open()));
    const active = progress.allGoals ? null : progress.goal;
    if (active) {
      menu.addItem((item) =>
        item.setTitle(t.goals.remove({ title: this.goalTitle(active) })).setIcon("x").onClick(() => this.changeGoals(() => store.removeGoal(active))),
      );
    }
    const box = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: isRtl() ? box.right : box.left, y: box.bottom });
  }

  // Rendering

  private effectiveMode() {
    return this.plugin.settings.mapMode === "route" && this.store.route ? "route" : "all";
  }

  render() {
    if (!this.root) return;
    // Read before anything changes: reading it after the nodes are repainted would lay out the whole map.
    const sideScroll = this.side.scrollTop;
    // A focus restored with the workspace waits for the vault to be read.
    if (!this.store.isEmpty) this.dropGoneFocus();
    const empty = this.store.isEmpty;
    this.root.toggleClass("is-empty", empty);
    this.renderBar();
    if (empty) {
      this.renderEmpty();
      return;
    }
    this.canvas.querySelector(".tropa-empty")?.remove();
    this.computeLayout();
    if (this.layoutPending) {
      // Nodes that left the graph stay drawn until the new layout arrives; painting skips them.
      this.paintNodes();
      this.renderSide(sideScroll);
      return;
    }
    this.syncNodes();
    this.paintNodes();
    this.drawEdges();
    this.renderSide(sideScroll);
    if (this.restoreView) {
      const view = this.restoreView;
      this.restoreView = null;
      this.needsFit = false;
      this.overview = false;
      ({ x: this.x, y: this.y, k: this.k, userMoved: this.userMoved } = view);
      this.animate();
      this.applyTransform();
    } else if (this.needsFit && this.stage.clientWidth > 0) {
      this.needsFit = false;
      this.userMoved = false;
      if (this.overview) this.fit(true);
      else this.frame();
      this.overview = false;
    }
  }

  private computeLayout() {
    const { store } = this;
    const { showSources } = this.plugin.settings;
    const mode = this.effectiveMode();
    const only = this.shownConcepts(mode);
    const key = [store.topologyKey, mode, showSources, only ? [...only].sort().join("|") : ""].join("#");
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    const prepared = prepareLayout(store.graph, { showSources, only });
    const laidOut = this.layouts.run(prepared.input);
    if (!(laidOut instanceof Promise)) {
      this.setLayout(finishLayout(prepared, laidOut));
      return;
    }
    this.setPending(true);
    attempt(
      laidOut.then((result) => {
        if (!result || key !== this.layoutKey) return;
        this.setLayout(finishLayout(prepared, result));
        this.render();
      }),
      "lay out the map",
    );
  }

  /** Concepts to lay out: the focus, the route or everything, without folded branches. `undefined` is all. */
  private shownConcepts(mode: "route" | "all"): Set<string> | undefined {
    const { graph, route } = this.store;
    let only: Set<string> | undefined;
    if (this.focus) only = neighborhood(graph, this.focus.center, this.focus.depth);
    else if (mode === "route") only = route!.closure;
    const concepts = only ?? new Set(graph.concepts.map((node) => node.id));
    this.inScope = concepts;
    this.foldable = new Set([...concepts].filter((id) => graph.nodes.get(id)!.requiredBy.some((child) => concepts.has(child))));
    const { hidden, counts } = fold(graph, concepts, this.folded);
    this.hidden = hidden;
    this.foldCounts = counts;
    this.foldedRoute = new Map();
    if (route && hidden.size) {
      for (const id of counts.keys()) {
        let count = 0;
        graph.descendants(id).forEach((other) => hidden.has(other) && route.closure.has(other) && count++);
        if (count) this.foldedRoute.set(id, count);
      }
    }
    return hidden.size ? new Set([...concepts].filter((id) => !hidden.has(id))) : only;
  }

  private setLayout(layout: Layout) {
    if (this.layout) this.needsFit = true;
    this.layout = layout;
    this.setPending(false);
  }

  private setPending(pending: boolean) {
    this.layoutPending = pending;
    if (!pending) this.layoutWaiters.splice(0).forEach((resolve) => resolve());
    this.canvas.toggleClass("is-laying-out", pending);
    this.canvas.setAttribute("aria-busy", String(pending));
  }

  private syncNodes() {
    const layout = this.layout!;
    if (layout === this.drawnLayout) {
      // Same places: only a title can have changed.
      for (const [id, el] of this.nodeEls) {
        const title = el.querySelector(".tropa-node-title")!;
        const text = this.store.graph.nodes.get(id)?.title ?? "";
        if (title.textContent !== text) title.textContent = text;
      }
      return;
    }
    for (const [id, el] of this.nodeEls) {
      if (!layout.nodes.has(id) || el.dataset.kind !== this.store.graph.nodes.get(id)?.kind) {
        el.remove();
        this.nodeEls.delete(id);
      }
    }
    for (const placed of layout.nodes.values()) {
      const node = this.store.graph.nodes.get(placed.id)!;
      let el = this.nodeEls.get(placed.id);
      if (!el) {
        el = this.createNode(node);
        this.nodeEls.set(node.id, el);
        this.world.appendChild(el);
      }
      el.style.transform = `translate(${placed.x}px, ${placed.y}px)`;
      el.style.width = `${placed.width}px`;
      el.style.height = `${placed.height}px`;
      el.querySelector(".tropa-node-title")!.textContent = node.title;
    }
  }

  private createNode(node: GraphNode) {
    const el = createDiv({ cls: `tropa-node is-${node.kind}` });
    el.dataset.id = node.id;
    el.dataset.kind = node.kind;
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.createSpan({ cls: "tropa-glyph" });
    const text = el.createSpan({ cls: "tropa-node-text" });
    text.createSpan({ cls: "tropa-node-title", attr: { dir: "auto" } });
    text.createSpan({ cls: "tropa-node-meta" });
    if (node.kind === "concept") {
      el.createSpan({ cls: "tropa-port", attr: { "aria-hidden": "true", title: t.portTitle } });
      // Shown by the is-due class: a mastered concept that is time to review. An icon, not only a color.
      setIcon(el.createSpan({ cls: "tropa-due", attr: { "aria-hidden": "true", title: t.review.dueNow } }), REVIEW_ICON);
      // The node itself is the keyboard target (C folds), so the badge stays out of the tab order.
      const toggle = el.createEl("button", { cls: "tropa-fold", attr: { tabindex: "-1" } });
      toggle.addEventListener("pointerdown", (event) => event.stopPropagation());
      toggle.addEventListener("dblclick", (event) => event.stopPropagation());
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        this.toggleFold(node.id);
      });
    }
    el.addEventListener("pointerenter", () => this.highlight(node.id));
    el.addEventListener("pointerleave", () => this.highlight(null));
    el.addEventListener("focus", () => this.highlight(node.id));
    el.addEventListener("blur", () => this.highlight(null));
    el.addEventListener("keydown", (event) => this.onNodeKey(event, node.id));
    el.addEventListener("dblclick", () => {
      // A double tap zooms the map; it does not open the note.
      if (Date.now() - this.lastTouch < 1000) return;
      if (this.store.graph.nodes.get(node.id)?.ghost) attempt(this.store.materialize(node.id), `create ${node.title}`);
      else this.openNote(node.id);
    });
    el.addEventListener("contextmenu", (event) => this.openContextMenu(event, node.id));
    return el;
  }

  private paintNodes() {
    const { store } = this;
    const route = store.route;
    const reviews = this.reviews.enabled ? this.reviews : null;
    const now = Date.now();
    this.root.toggleClass("has-review", reviews !== null);
    for (const [id, el] of this.nodeEls) {
      const node = store.graph.nodes.get(id);
      if (!node) continue;
      const glyph = el.querySelector<HTMLElement>(".tropa-glyph")!;
      const meta = el.querySelector<HTMLElement>(".tropa-node-meta")!;
      const isSelected = id === this.selected;

      if (node.kind === "source") {
        const state = sourceState(store.graph, store.progress, id);
        setClass(el, `tropa-node is-source state-${state}${isSelected ? " is-selected" : ""}`);
        setGlyph(glyph, state === "done" ? "check" : FORMAT_ICON[node.format ?? "other"]);
        meta.textContent = node.minutes ? formatMinutes(node.minutes) : "";
        el.setAttribute("aria-label", t.materialLabel({ title: node.title }));
        continue;
      }

      const state = store.states.get(id) ?? "locked";
      const goal = route?.goals.includes(id) ?? false;
      const isNext = route?.next === id;
      const classes = ["tropa-node", "is-concept", `state-${state}`];
      if (isSelected) classes.push("is-selected");
      if (goal) classes.push("is-goal");
      if (isNext) classes.push("is-next");
      if (node.ghost) classes.push("is-ghost");
      if (route?.closure.has(id)) classes.push("is-on-route");
      const isFolded = this.foldable.has(id) && this.folded.has(id);
      if (isFolded) classes.push("is-folded");
      const isDue = state === "mastered" && reviews !== null && reviews.isDue(id, now);
      if (isDue) classes.push("is-due");
      setClass(el, classes.join(" "));
      setGlyph(glyph, STATE_ICON[state]);
      setText(meta, this.nodeMeta(node));
      this.paintFold(el, id, isFolded);
      const label = `${node.title}. ${t.state[state]}${isDue ? t.review.dueSuffix : ""}${goal ? t.goalSuffix : ""}${isNext ? t.nextSuffix : ""}`;
      el.setAttribute("aria-label", isFolded ? `${label}. ${t.folded({ count: this.foldCounts.get(id) ?? 0 })}` : label);
    }
    this.paintEdgeRoute();
  }

  /** The badge under a concept that opens something: a fold control, and "+K" once folded. */
  private paintFold(el: HTMLElement, id: string, isFolded: boolean) {
    const toggle = el.querySelector<HTMLElement>(".tropa-fold");
    if (!toggle) return;
    const canFold = this.foldable.has(id);
    toggle.toggleClass("is-hidden", !canFold);
    if (!canFold) {
      el.removeAttribute("aria-expanded");
      return;
    }
    el.setAttribute("aria-expanded", String(!isFolded));
    const count = this.foldCounts.get(id) ?? 0;
    const onRoute = isFolded ? (this.foldedRoute.get(id) ?? 0) : 0;
    toggle.toggleClass("has-route", onRoute > 0);
    const label = isFolded ? t.unfold({ count }) : t.fold;
    const title = onRoute ? `${label}. ${t.foldedRoute({ count: onRoute })}` : label;
    toggle.setAttribute("aria-label", title);
    toggle.setAttribute("title", title);
    if (isFolded) {
      delete toggle.dataset.icon;
      setText(toggle, t.foldBadge({ count }));
    } else {
      setGlyph(toggle, "chevron-up");
    }
  }

  private toggleFold(id: string) {
    const wasFolded = this.folded.has(id);
    if (!wasFolded && !this.foldable.has(id)) return;
    const before = this.foldCounts.get(id) ?? 0;
    if (wasFolded) this.folded.delete(id);
    else this.folded.add(id);
    this.saveViewState();
    this.render();
    const count = wasFolded ? before : (this.foldCounts.get(id) ?? 0);
    this.toast(wasFolded ? t.unfolded({ count }) : t.folded({ count }), t.undo, () => this.toggleFold(id));
  }

  private nodeMeta(node: GraphNode) {
    const { store } = this;
    const state = store.states.get(node.id);
    if (state === "mastered" || state === "skipped") return "";
    if (node.ghost) return t.noNoteYet;
    if (state === "locked") {
      const left = node.requires.filter((id) => !isPassed(store.progress, id)).length;
      return t.conceptsFirst({ count: left });
    }
    const count = node.taughtBy.length;
    if (count === 0) return t.noMaterials;
    const open = node.taughtBy
      .filter((id) => !store.progress.done.has(id))
      .map((id) => store.graph.nodes.get(id)?.minutes)
      .filter((minutes): minutes is number => minutes !== undefined);
    if (open.length === 0) return t.materialCount({ count });
    const shortest = formatMinutes(Math.min(...open));
    return open.length > 1 ? t.from({ duration: shortest }) : shortest;
  }

  private drawEdges() {
    const layout = this.layout!;
    // Painting already updated the route on the edges; rebuilding thousands of paths is for a new layout.
    if (layout === this.drawnLayout) return;
    this.drawnLayout = layout;
    this.svg.empty();
    this.world.toggleClass("is-dense", layout.edges.length > DASHED_EDGES_MAX);
    const pad = 200;
    this.svg.setAttribute("width", String(layout.width + pad * 2));
    this.svg.setAttribute("height", String(layout.height + pad * 2));
    this.svg.setAttribute("viewBox", `${-pad} ${-pad} ${layout.width + pad * 2} ${layout.height + pad * 2}`);
    this.svg.style.left = `${-pad}px`;
    this.svg.style.top = `${-pad}px`;

    const height = Math.max(1, layout.height);
    for (const edge of layout.edges) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", edge.path);
      path.dataset.from = edge.from;
      path.dataset.to = edge.to;
      path.dataset.kind = edge.kind;
      const startY = layout.nodes.get(edge.from)?.y ?? 0;
      path.style.setProperty("--tropa-delay", `${Math.round((startY / height) * 520)}ms`);
      this.svg.appendChild(path);
    }
    this.paintEdgeRoute();
  }

  private paintEdgeRoute() {
    const { store } = this;
    const route = store.route;
    this.svg.querySelectorAll<SVGPathElement>("path").forEach((path) => {
      const { from, to, kind } = path.dataset as { from: string; to: string; kind: string };
      const onRoute = kind === "requires" && route?.closure.has(from) && route.closure.has(to);
      const classes = ["tropa-edge", `is-${kind}`];
      if (onRoute) {
        classes.push("is-route");
        if (isPassed(store.progress, from)) classes.push(isPassed(store.progress, to) ? "is-walked" : "is-frontier");
      }
      if (kind === "requires" && store.graph.isInCycle(from) && store.graph.isInCycle(to)) classes.push("is-loop");
      const className = classes.join(" ");
      if (path.getAttribute("class") !== className) path.setAttribute("class", className);
    });
  }

  /** The one moment of motion on the map: the trail draws itself towards the goal. */
  private drawTrail() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    window.setTimeout(() => {
      this.svg.querySelectorAll<SVGPathElement>(".is-route").forEach((path) => path.setAttribute("pathLength", "1"));
      this.world.addClass("is-drawing");
      window.setTimeout(() => {
        this.world.removeClass("is-drawing");
        this.svg.querySelectorAll<SVGPathElement>(".is-route").forEach((path) => path.removeAttribute("pathLength"));
      }, 1200);
    }, 340);
  }

  private highlight(id: string | null) {
    this.world.toggleClass("has-focus", id !== null);
    this.nodeEls.forEach((el) => el.removeClass("is-related"));
    this.svg.querySelectorAll(".is-related").forEach((path) => path.classList.remove("is-related"));
    if (!id) return;
    const { graph } = this.store;
    const node = graph.nodes.get(id);
    const related = new Set([id, ...graph.ancestors(id), ...graph.descendants(id), ...(node?.teaches ?? []), ...(node?.taughtBy ?? [])]);
    related.forEach((relatedId) => this.nodeEls.get(relatedId)?.addClass("is-related"));
    this.svg.querySelectorAll<SVGPathElement>("path").forEach((path) => {
      if (related.has(path.dataset.from!) && related.has(path.dataset.to!)) path.classList.add("is-related");
    });
  }

  /** The audit button: how many findings, in warning colours when there is a cycle. */
  private renderAuditButton() {
    const button = this.bar.querySelector<HTMLElement>(".tropa-audit-button")!;
    const { graph } = this.store;
    if (this.audited?.graph !== graph) this.audited = { graph, audit: auditGraph(graph) };
    const { audit } = this.audited;
    const count = auditCount(audit);
    const cycles = audit.cycles.length > 0;
    button.toggleClass("is-hidden", count === 0);
    button.toggleClass("has-cycles", cycles);
    if (!count) return;
    const icon = button.querySelector<HTMLElement>(".tropa-audit-button-icon")!;
    if (icon.dataset.icon !== String(cycles)) {
      icon.empty();
      setIcon(icon, cycles ? "alert-triangle" : "list-checks");
      icon.dataset.icon = String(cycles);
    }
    button.querySelector<HTMLElement>(".tropa-audit-button-count")!.textContent = new Intl.NumberFormat(locale()).format(count);
    const label = `${t.audit.title}: ${t.audit.summary({ count })}`;
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  }

  private renderBar() {
    this.renderAuditButton();
    const goalButton = this.bar.querySelector<HTMLElement>(".tropa-goal")!;
    const label = goalButton.querySelector<HTMLElement>(".tropa-goal-label")!;
    const { route, graph } = this.store;
    const goal = route ? graph.nodes.get(route.goal) : null;
    const kept = allGoalsOf(this.store.progress).length;
    const all = !!route && route.goals.length > 1;
    label.textContent = all ? t.goals.count({ count: route.goals.length }) : goal ? goal.title : t.chooseGoal;
    const others = goalButton.querySelector<HTMLElement>(".tropa-goal-more")!;
    others.textContent = !all && kept > 1 ? t.goals.more({ count: kept - 1 }) : "";
    others.toggleClass("is-hidden", all || kept < 2);
    goalButton.toggleClass("has-goal", !!goal);
    goalButton.toggleClass("mod-cta", !goal);

    const meter = this.bar.querySelector<HTMLElement>(".tropa-progress")!;
    meter.toggleClass("is-hidden", !route);
    if (route) {
      const percent = route.total ? (route.masteredCount / route.total) * 100 : 0;
      meter.querySelector<HTMLElement>(".tropa-meter-fill")!.style.width = `${percent}%`;
      meter.querySelector<HTMLElement>(".tropa-meter")!.setAttribute("aria-valuenow", String(Math.round(percent)));
      const done = t.progressOf({ done: route.masteredCount, total: route.total });
      const skipped = route.skippedCount ? `${t.listSeparator}${t.skippedCount({ count: route.skippedCount })}` : "";
      meter.querySelector<HTMLElement>(".tropa-progress-text")!.textContent = done + skipped;
      meter.querySelector<HTMLElement>(".tropa-progress-time")!.textContent = this.store.describeRemaining();
      // On a phone only the line shows; its words are for screen readers and a long press.
      const words = `${done}${skipped}${t.listSeparator}${this.store.describeRemaining()}`;
      meter.querySelector<HTMLElement>(".tropa-meter")!.setAttribute("aria-valuetext", words);
      meter.setAttribute("title", words);
    }
    const count = this.audited ? auditCount(this.audited.audit) : 0;
    const more = this.bar.querySelector<HTMLElement>(".tropa-more")!;
    const badge = more.querySelector<HTMLElement>(".tropa-more-badge")!;
    badge.toggleClass("is-hidden", count === 0);
    badge.toggleClass("has-cycles", (this.audited?.audit.cycles.length ?? 0) > 0);
    badge.textContent = count ? new Intl.NumberFormat(locale()).format(count) : "";
    more.setAttribute("aria-label", count ? `${t.moreActions}. ${t.audit.title}: ${t.audit.summary({ count })}` : t.moreActions);

    const mode = this.effectiveMode();
    this.bar.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
      const active = button.dataset.mode === mode;
      button.toggleClass("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      if (button.dataset.mode === "route") button.disabled = !route;
    });
    const sources = this.bar.querySelector<HTMLElement>(".tropa-toggle-sources")!;
    sources.toggleClass("is-active", this.plugin.settings.showSources);
    sources.setAttribute("aria-pressed", String(this.plugin.settings.showSources));
    this.renderFocusControls();
  }

  private toggleSources() {
    this.plugin.settings.showSources = !this.plugin.settings.showSources;
    attempt(this.plugin.saveSettings(), "save settings");
    this.needsFit = true;
    this.overview = true;
    this.render();
  }

  /** What the bar holds on a wider screen, as one menu on a phone. */
  private openMore(event: MouseEvent) {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(t.materials).setIcon("book-open").setChecked(this.plugin.settings.showSources).onClick(() => this.toggleSources()));
    const focus = this.focus;
    if (focus) {
      menu.addItem((item) => item.setTitle(t.exitFocus).setIcon("x").onClick(() => this.exitFocus()));
      for (let depth = 1; depth <= MAX_FOCUS_DEPTH; depth++) {
        menu.addItem((item) => item.setTitle(t.focusSteps({ count: depth })).setChecked(depth === focus.depth).onClick(() => this.setFocusDepth(depth)));
      }
    } else {
      menu.addItem((item) => item.setTitle(t.focus).setIcon("focus").setDisabled(!this.selected).onClick(() => this.enterFocus(this.selected)));
    }
    const count = this.audited ? auditCount(this.audited.audit) : 0;
    menu.addItem((item) =>
      item.setTitle(count ? `${t.audit.title}: ${t.audit.summary({ count })}` : t.audit.title).setIcon("list-checks").onClick(() => attempt(this.plugin.showAudit(), "open the map audit")),
    );
    menu.addItem((item) => item.setTitle(t.exportCanvas).setIcon("layout-dashboard").onClick(() => this.exportCanvas()));
    menu.addItem((item) => item.setTitle(t.exportSvg).setIcon("image").onClick(() => this.exportSvg()));
    menu.addItem((item) => item.setTitle(t.newConcept).setIcon("plus").onClick(() => this.plugin.promptNewConcept()));
    menu.showAtMouseEvent(event);
  }

  private renderFocusControls() {
    const group = this.bar.querySelector<HTMLElement>(".tropa-focus");
    if (!group) return;
    const { graph } = this.store;
    const focus = this.focus;
    group.toggleClass("is-active", focus !== null);
    const toggle = group.querySelector<HTMLButtonElement>(".tropa-focus-toggle")!;
    const center = focus ? graph.nodes.get(focus.center) : null;
    const target = this.selected ? graph.nodes.get(this.selected) : null;
    toggle.disabled = !focus && !target;
    toggle.setAttribute("aria-pressed", String(focus !== null));
    const title = center ? t.focusOn({ title: center.title }) : target ? t.focusTitle : t.focusHint;
    toggle.setAttribute("aria-label", title);
    toggle.setAttribute("title", title);
    group.querySelectorAll<HTMLButtonElement>("[data-depth]").forEach((button) => {
      const active = Number(button.dataset.depth) === (focus?.depth ?? this.focusDepth);
      button.toggleClass("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  private enterFocus(id: string | null) {
    const node = id ? this.store.graph.nodes.get(id) : null;
    // A material that teaches nothing has nothing around it.
    if (!node || neighborhood(this.store.graph, node.id, 1).size === 0) return;
    if (!this.focus) this.beforeFocus = { x: this.x, y: this.y, k: this.k, userMoved: this.userMoved };
    this.focus = { center: node.id, depth: this.focusDepth };
    this.selected = node.id;
    this.needsFit = true;
    this.overview = true;
    this.saveViewState();
    this.render();
    this.toast(t.focusOn({ title: node.title }), t.exitFocus, () => this.exitFocus());
  }

  private setFocusDepth(depth: number) {
    this.focusDepth = depth;
    if (this.focus) {
      this.focus = { ...this.focus, depth };
      this.needsFit = true;
      this.overview = true;
      this.saveViewState();
      this.render();
    } else {
      this.renderFocusControls();
    }
  }

  /**
   * The focused note can leave the graph: deleted, or left out by the map scope. The focus ends with it before
   * the bar is drawn, and the map goes back to where it was, as when leaving the focus by hand.
   */
  private dropGoneFocus() {
    if (!this.focus || this.store.graph.nodes.has(this.focus.center)) return;
    this.focus = null;
    this.restoreView = this.beforeFocus;
    this.beforeFocus = null;
    this.needsFit = !this.restoreView;
    this.saveViewState();
  }

  private exitFocus() {
    if (!this.focus) return;
    this.focus = null;
    this.restoreView = this.beforeFocus;
    this.beforeFocus = null;
    this.needsFit = !this.restoreView;
    this.overview = false;
    this.saveViewState();
    this.render();
  }

  private renderSide(scroll = this.side.scrollTop) {
    const { side, store } = this;
    const previous = side.dataset.showing;
    side.empty();
    side.toggleClass("is-collapsed", this.sideCollapsed);

    const node = this.selected ? store.graph.nodes.get(this.selected) : null;
    if (this.selected && !node) this.selected = null;

    if (this.root.classList.contains("is-phone")) {
      this.sheetHandle(side.createDiv({ cls: "tropa-sheet-handle", attr: { role: "button", tabindex: "0", "aria-label": t.sheetHandle } }));
    } else {
      const collapse = side.createEl("button", {
        cls: "tropa-collapse clickable-icon",
        attr: { "aria-label": this.sideCollapsed ? t.expandPanel : t.collapsePanel },
      });
      setIcon(collapse, this.sideCollapsed ? "chevron-up" : "chevron-down");
      collapse.addEventListener("click", () => {
        this.sideCollapsed = !this.sideCollapsed;
        this.renderSide();
      });
    }

    if (node?.kind === "concept") renderConcept(side, this, node);
    else if (node) renderSource(side, this, node);
    else renderRoute(side, this, this.pickGoal);

    const showing = node?.id ?? "route";
    side.dataset.showing = showing;
    // Setting it lays the page out, so only when there is somewhere to scroll back to.
    const target = previous === showing ? scroll : 0;
    if (target > 0 || scroll > 0) side.scrollTop = target;
  }

  // The panel on a phone: a sheet over the bottom of the map, above Obsidian's own bar

  private sheetHandle(handle: HTMLElement) {
    handle.createSpan({ cls: "tropa-sheet-grip" });
    handle.setAttribute("aria-expanded", String(this.sheet !== "peek"));
    handle.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      this.setSheet(nextSheet(this.sheet));
    });
    handle.addEventListener("pointerdown", (event) => {
      handle.setPointerCapture(event.pointerId);
      this.sheetDrag = { startY: event.clientY, height: this.sheetHeight(), moved: false };
      this.side.addClass("is-dragging");
    });
    handle.addEventListener("pointermove", (event) => {
      const drag = this.sheetDrag;
      if (!drag) return;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.abs(dy) < TOUCH_SLOP) return;
      if (!drag.moved) drag.height = this.sheetHeight();
      drag.moved = true;
      this.root.style.setProperty("--tropa-sheet-height", `${this.clampSheet(drag.height - dy)}px`);
    });
    const end = (event: PointerEvent) => {
      const drag = this.sheetDrag;
      if (!drag) return;
      this.sheetDrag = null;
      this.side.removeClass("is-dragging");
      if (!drag.moved) {
        if (event.type === "pointerup") this.setSheet(nextSheet(this.sheet));
        return;
      }
      // Lands on the nearest of the three heights.
      const height = this.clampSheet(drag.height - (event.clientY - drag.startY));
      const states: SheetState[] = ["peek", "half", "full"];
      const nearest = states.reduce((best, state) => (Math.abs(this.sheetHeightOf(state) - height) < Math.abs(this.sheetHeightOf(best) - height) ? state : best));
      this.setSheet(nearest);
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  private setSheet(state: SheetState) {
    this.sheet = state;
    this.placeSheet();
    this.side.querySelector(".tropa-sheet-handle")?.setAttribute("aria-expanded", String(state !== "peek"));
  }

  private sheetHeightOf(state: SheetState) {
    const full = Math.max(SHEET_PEEK, this.body.clientHeight - this.bottomInset - 8);
    return state === "peek" ? SHEET_PEEK : state === "half" ? Math.max(SHEET_PEEK, Math.round(full * 0.5)) : full;
  }

  private sheetHeight() {
    return this.root?.classList.contains("is-phone") ? this.sheetHeightOf(this.sheet) : 0;
  }

  private clampSheet(height: number) {
    return clamp(height, SHEET_PEEK, this.sheetHeightOf("full"));
  }

  /** Sizes the sheet and keeps it, and the zoom buttons above it, clear of Obsidian's bar. */
  private placeSheet() {
    if (!this.root) return;
    const phone = this.root.classList.contains("is-phone");
    this.bottomInset = phone ? navbarOverlap(this.root) : 0;
    this.root.style.setProperty("--tropa-bottom-inset", `${this.bottomInset}px`);
    this.root.style.setProperty("--tropa-sheet-height", `${this.sheetHeight()}px`);
    this.side.dataset.sheet = this.sheet;
    this.root.toggleClass("is-sheet-full", phone && this.sheet === "full");
  }

  private renderEmpty() {
    this.side.empty();
    if (this.canvas.querySelector(".tropa-empty")) return;
    const empty = this.canvas.createDiv({ cls: "tropa-empty" });
    empty.createEl("h2", { text: t.emptyTitle });
    empty.createEl("p", {
      text: t.emptyText,
    });
    const actions = empty.createDiv({ cls: "tropa-actions" });
    const sample = actions.createEl("button", { cls: "mod-cta", text: t.showExample });
    sample.addEventListener("click", () => attempt(this.plugin.installSample(), "add the example map"));
    const create = actions.createEl("button", { text: t.createFirstConcept });
    create.addEventListener("click", () => this.plugin.promptNewConcept());
  }

  private buildControls() {
    const goal = this.bar.createEl("button", { cls: "tropa-goal", attr: { "aria-label": t.goalButton } });
    setIcon(goal.createSpan({ cls: "tropa-goal-icon" }), "flag");
    goal.createSpan({ cls: "tropa-goal-label", attr: { dir: "auto" } });
    goal.createSpan({ cls: "tropa-goal-more is-hidden" });
    goal.setAttr("aria-haspopup", "menu");
    goal.addEventListener("click", () => this.openGoalMenu(goal));

    const progress = this.bar.createDiv({ cls: "tropa-progress" });
    progress.createSpan({ cls: "tropa-progress-text" });
    const meter = progress.createDiv({
      cls: "tropa-meter",
      attr: { role: "progressbar", "aria-label": t.routeProgress, "aria-valuemin": "0", "aria-valuemax": "100" },
    });
    meter.createDiv({ cls: "tropa-meter-fill" });
    progress.createSpan({ cls: "tropa-progress-time" });

    this.bar.createDiv({ cls: "tropa-spacer" });

    const setMode = (mode: "route" | "all") => {
      this.plugin.settings.mapMode = mode;
      attempt(this.plugin.saveSettings(), "save settings");
      this.needsFit = true;
      this.overview = true;
      this.render();
    };
    const segment = this.bar.createDiv({ cls: "tropa-segment tropa-modes", attr: { role: "group", "aria-label": t.viewMode } });
    for (const [mode, text] of [["route", t.modeRoute], ["all", t.modeAll]] as const) {
      const button = segment.createEl("button", { text });
      button.dataset.mode = mode;
      button.addEventListener("click", () => setMode(mode));
    }
    // A phone has room for one row: the same switch as icons, the rest in a menu.
    const icons = this.bar.createDiv({ cls: "tropa-segment tropa-mode-icons", attr: { role: "group", "aria-label": t.viewMode } });
    for (const [mode, text, icon] of [["route", t.modeRoute, "route"], ["all", t.modeAll, "map"]] as const) {
      const button = icons.createEl("button", { attr: { "aria-label": text, title: text } });
      setIcon(button, icon);
      button.dataset.mode = mode;
      button.addEventListener("click", () => setMode(mode));
    }

    const sources = this.bar.createEl("button", { cls: "tropa-toggle-sources", text: t.materials });
    sources.addEventListener("click", () => this.toggleSources());

    const focus = this.bar.createDiv({ cls: "tropa-focus", attr: { role: "group", "aria-label": t.focus } });
    const enter = focus.createEl("button", { cls: "tropa-focus-toggle" });
    setIcon(enter.createSpan({ cls: "tropa-focus-icon" }), "focus");
    enter.createSpan({ text: t.focus });
    enter.addEventListener("click", () => (this.focus ? this.exitFocus() : this.enterFocus(this.selected)));
    const depths = focus.createDiv({ cls: "tropa-segment tropa-focus-depth", attr: { role: "group", "aria-label": t.focusDepth } });
    const number = new Intl.NumberFormat(locale());
    for (let depth = 1; depth <= MAX_FOCUS_DEPTH; depth++) {
      const button = depths.createEl("button", { text: number.format(depth), attr: { "aria-label": t.focusSteps({ count: depth }) } });
      button.dataset.depth = String(depth);
      button.addEventListener("click", () => this.setFocusDepth(depth));
    }
    const exit = focus.createEl("button", { cls: "tropa-focus-exit clickable-icon", attr: { "aria-label": t.exitFocus, title: t.exitFocus } });
    setIcon(exit, "x");
    exit.addEventListener("click", () => this.exitFocus());

    // Shown only when the audit finds something; it reads the graph, not the layout.
    const audit = this.bar.createEl("button", { cls: "tropa-audit-button is-hidden" });
    audit.createSpan({ cls: "tropa-audit-button-icon" });
    audit.createSpan({ cls: "tropa-audit-button-count" });
    audit.addEventListener("click", () => attempt(this.plugin.showAudit(), "open the map audit"));

    const share = this.bar.createEl("button", { cls: "tropa-export clickable-icon", attr: { "aria-label": t.exportMap, title: t.exportMap } });
    setIcon(share, "download");
    share.addEventListener("click", (event) => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle(t.exportCanvas).setIcon("layout-dashboard").onClick(() => this.exportCanvas()));
      menu.addItem((item) => item.setTitle(t.exportSvg).setIcon("image").onClick(() => this.exportSvg()));
      menu.showAtMouseEvent(event);
    });

    const add = this.bar.createEl("button", { cls: "tropa-add-concept clickable-icon", attr: { "aria-label": t.newConcept } });
    setIcon(add, "plus");
    add.addEventListener("click", () => this.plugin.promptNewConcept());

    const more = this.bar.createEl("button", { cls: "tropa-more clickable-icon", attr: { "aria-label": t.moreActions } });
    setIcon(more.createSpan({ cls: "tropa-more-icon" }), "more-horizontal");
    more.createSpan({ cls: "tropa-more-badge is-hidden" });
    more.addEventListener("click", (event) => this.openMore(event));

    const zoom = this.stage.createDiv({ cls: "tropa-zoom", attr: { role: "group", "aria-label": t.zoom } });
    const zoomButton = (icon: string, label: string, run: () => void) => {
      const button = zoom.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
      setIcon(button, icon);
      button.addEventListener("click", run);
    };
    zoomButton("plus", t.zoomIn, () => this.zoomBy(1.25));
    zoomButton("minus", t.zoomOut, () => this.zoomBy(0.8));
    zoomButton("maximize", t.fitAll, () => {
      this.userMoved = true;
      this.fit(true);
    });

    const legend = this.stage.createDiv({ cls: "tropa-legend" });
    for (const state of ["mastered", "learning", "available", "locked", "skipped"] as const) {
      const item = legend.createDiv({ cls: "tropa-legend-item" });
      setGlyph(item.createSpan({ cls: `tropa-glyph is-small state-${state}` }), STATE_ICON[state]);
      item.createSpan({ text: t.state[state] });
    }
    // Only while review is on: the map's root carries has-review then.
    const due = legend.createDiv({ cls: "tropa-legend-item is-review" });
    setGlyph(due.createSpan({ cls: "tropa-glyph is-small is-due" }), REVIEW_ICON);
    due.createSpan({ text: t.review.legend });
  }

  // Export: the map as it is drawn now, with its mode, materials, focus and folds

  exportCanvas() {
    const layout = this.readyLayout();
    if (!layout) return;
    new ExportModal(this.app, {
      title: t.exportCanvas,
      path: this.exportPath("canvas"),
      extension: "canvas",
      offerProgress: true,
      exists: (path) => this.app.vault.getAbstractFileByPath(path) !== null,
      save: async (path, withProgress, replace) => {
        const nodes = [...layout.nodes.values()].map((placed) => this.exportNode(placed, withProgress));
        const file = await this.store.writeExport(path, canvasText(buildCanvas(nodes, layout.edges, t.canvasSoftLabel)), replace);
        new Notice(t.exportSaved({ path }));
        await this.app.workspace.getLeaf("tab").openFile(file);
      },
    }).open();
  }

  exportSvg() {
    const layout = this.readyLayout();
    if (!layout) return;
    new ExportModal(this.app, {
      title: t.exportSvg,
      path: this.exportPath("svg"),
      extension: "svg",
      offerProgress: false,
      exists: (path) => this.app.vault.getAbstractFileByPath(path) !== null,
      save: async (path, _withProgress, replace) => {
        await this.store.writeExport(path, buildSvg(this.drawing(layout)), replace);
        new Notice(t.exportSaved({ path }));
      },
    }).open();
  }

  private readyLayout() {
    if (this.store.isEmpty) return null;
    if (!this.layout || this.layoutPending) {
      new Notice(t.exportNotReady);
      return null;
    }
    return this.layout;
  }

  /** Next to the progress file, named after the goal of the route or the map, and dated. */
  private exportPath(extension: string) {
    const { route, graph } = this.store;
    const goal = this.effectiveMode() === "route" && route ? (route.goals.length > 1 ? t.goals.all : graph.nodes.get(route.goal)?.title) : null;
    const folder = this.plugin.settings.progressPath.split("/").slice(0, -1).join("/");
    const name = `${fileName(`${goal ?? t.mapTitle} ${today()}`)}.${extension}`;
    return folder ? `${folder}/${name}` : name;
  }

  private exportNode(placed: LaidOutNode, withProgress: boolean): ExportNode {
    const { store } = this;
    const node = store.graph.nodes.get(placed.id)!;
    const out: ExportNode = { id: node.id, x: placed.x, y: placed.y, width: placed.width, height: placed.height };
    if (node.ghost) out.text = node.title;
    else if (node.inline && node.file) out.file = node.file;
    else if (node.inline && node.url) out.url = node.url;
    else if (node.inline) out.text = node.title;
    else out.file = node.id;
    if (!withProgress) return out;
    if (node.kind === "source") {
      if (store.progress.done.has(node.id)) out.color = CANVAS_COLOR.mastered;
    } else if (store.route?.goals.includes(node.id) && !store.progress.mastered.has(node.id)) {
      out.color = CANVAS_COLOR.goal;
    } else {
      const state = store.states.get(node.id);
      if (state === "mastered") out.color = CANVAS_COLOR.mastered;
      if (state === "learning") out.color = CANVAS_COLOR.learning;
    }
    return out;
  }

  /**
   * The map as drawn in the current theme, measured from the page: colors, borders, fonts and icons
   * come from the styles in use, so the file looks like the view. Zoom-dependent simplifications
   * (hidden details, plain lines on dense maps, hover highlight) are switched off while measuring.
   */
  private drawing(layout: Layout) {
    const transient = ["is-far", "is-dense", "has-focus", "is-drawing", "is-moving"].filter((cls) => this.world.classList.contains(cls));
    transient.forEach((cls) => this.world.removeClass(cls));
    try {
      const color = colorReader();
      const boxes: SvgBox[] = [];
      const icons: SvgIcon[] = [];
      const texts: SvgText[] = [];
      const measure = textMeasure();
      const place = (el: HTMLElement, node: LaidOutNode) => ({ x: node.x + el.offsetLeft, y: node.y + el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });

      for (const placed of layout.nodes.values()) {
        const el = this.nodeEls.get(placed.id);
        if (!el) continue;
        boxes.push(boxOf(getComputedStyle(el), { x: placed.x, y: placed.y, width: placed.width, height: placed.height }, color));
        for (const pseudo of ["::before", "::after"] as const) {
          const badge = badgeOf(el, pseudo, placed, color, measure);
          if (badge) {
            boxes.push(badge.box);
            texts.push(badge.text);
          }
        }
        const glyph = el.querySelector<HTMLElement>(".tropa-glyph");
        if (glyph) {
          const box = place(glyph, placed);
          const style = getComputedStyle(glyph);
          boxes.push(boxOf(style, box, color));
          const svg = glyph.querySelector("svg");
          if (svg) {
            const size = parseFloat(getComputedStyle(svg).width) || 16;
            icons.push({
              x: box.x + (box.width - size) / 2,
              y: box.y + (box.height - size) / 2,
              size,
              color: color(style.color),
              viewBox: svg.getAttribute("viewBox") ?? "0 0 24 24",
              markup: [...svg.children].map((child) => new XMLSerializer().serializeToString(child)).join(""),
            });
          }
        }
        for (const [selector, lines] of [[".tropa-node-title", 2], [".tropa-node-meta", 1]] as const) {
          const textEl = el.querySelector<HTMLElement>(selector);
          if (!textEl?.textContent || textEl.offsetWidth === 0) continue;
          texts.push(...textLines(textEl, place(textEl, placed), lines, color, measure));
        }
        const fold = el.querySelector<HTMLElement>(".tropa-fold");
        if (fold?.textContent && getComputedStyle(fold).display !== "none" && getComputedStyle(fold).opacity === "1") {
          const box = place(fold, placed);
          const style = getComputedStyle(fold);
          boxes.push(boxOf(style, box, color));
          texts.push(...textLines(fold, { ...box, x: box.x + parseFloat(style.paddingLeft), width: box.width - parseFloat(style.paddingLeft) * 2 }, 1, color, measure));
        }
      }

      const edges: SvgPath[] = [];
      this.svg.querySelectorAll<SVGPathElement>("path[data-kind]").forEach((path) => {
        const style = getComputedStyle(path);
        const dash = style.strokeDasharray;
        edges.push({
          d: path.getAttribute("d") ?? "",
          stroke: color(style.stroke),
          strokeWidth: parseFloat(style.strokeWidth) || 1,
          opacity: (parseFloat(style.opacity) || 1) * (parseFloat(style.strokeOpacity) || 1),
          dash: dash && dash !== "none" ? dash.replace(/px/g, "").replace(/,/g, " ") : undefined,
        });
      });

      const { route, graph } = this.store;
      const goal = route ? route.goals.map((id) => graph.nodes.get(id)?.title ?? "").join(t.listSeparator) : null;
      return {
        title: goal ? `${t.mapTitle}: ${goal}` : t.mapTitle,
        width: layout.width,
        height: layout.height,
        margin: 40,
        background: backgroundOf(this.canvas, color),
        edges,
        boxes,
        icons,
        texts,
      };
    } finally {
      transient.forEach((cls) => this.world.addClass(cls));
    }
  }

  // Interaction

  private bindCanvas() {
    this.guardSwipes(this.stage);
    this.guardSwipes(this.side);
    this.registerDomEvent(this.canvas, "pointerdown", (event) => this.onPointerDown(event));
    this.registerDomEvent(this.canvas, "pointermove", (event) => this.onPointerMove(event));
    this.registerDomEvent(this.canvas, "pointerup", (event) => this.onPointerUp(event));
    this.registerDomEvent(this.canvas, "pointercancel", (event) => this.onPointerUp(event));
    this.registerDomEvent(this.canvas, "wheel", (event) => this.onWheel(event), { passive: false });
    this.registerDomEvent(this.root, "keydown", (event) => this.onKey(event));
  }

  /**
   * Obsidian on a phone opens its side panels with a horizontal swipe, built from touch events that
   * bubble up to the document. On the map a drag pans and two fingers zoom, and the panel at the
   * bottom is dragged by its handle, so their touches stop here; the map itself works with pointer
   * events, which this does not touch. `data-ignore-swipe` is Obsidian's own opt-out for an element.
   */
  private guardSwipes(el: HTMLElement) {
    el.setAttribute("data-ignore-swipe", "");
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"] as const) {
      this.registerDomEvent(el, type, (event) => event.stopPropagation(), { passive: true });
    }
  }

  /** Map-wide keys. F and C act on the focused node, or on the selected one. */
  private onKey(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (event.ctrlKey || event.metaKey || event.altKey || target.closest("input, textarea, [contenteditable]")) return;
    const key = event.key.toLowerCase();
    const id = target.closest<HTMLElement>(".tropa-node")?.dataset.id ?? this.selected;
    if (event.key === "Escape") {
      if (this.focus) this.exitFocus();
      else if (this.selected) this.select(null);
    } else if (key === "f" || key === "а") {
      if (this.focus && (!id || id === this.focus.center)) this.exitFocus();
      else this.enterFocus(id);
    } else if ((key === "c" || key === "с") && id) {
      this.toggleFold(id);
    } else if (this.focus && /^[1-9]$/.test(event.key) && Number(event.key) <= MAX_FOCUS_DEPTH) {
      this.setFocusDepth(Number(event.key));
    } else {
      return;
    }
    event.preventDefault();
  }

  private onPointerDown(event: PointerEvent) {
    if (this.store.isEmpty || (event.button !== 0 && event.button !== 1)) return;
    const target = event.target as HTMLElement;
    if (target.closest(".tropa-empty")) return;
    const touch = event.pointerType === "touch";
    if (touch) this.lastTouch = Date.now();
    const port = target.closest(".tropa-port");
    const nodeEl = target.closest<HTMLElement>(".tropa-node");
    if (port && nodeEl && !touch) {
      event.stopPropagation();
      this.startConnecting(event, nodeEl.dataset.id!);
      return;
    }
    this.canvas.setPointerCapture(event.pointerId);
    // A new gesture starts clean, even if a finger of the last one never reported lifting.
    if (event.isPrimary) {
      this.pointers.clear();
      this.pinch = null;
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      this.startPinch();
      return;
    }
    if (this.pointers.size > 2) return;
    this.press = {
      nodeId: nodeEl?.dataset.id ?? null,
      startX: event.clientX,
      startY: event.clientY,
      originX: this.x,
      originY: this.y,
      moved: false,
      touch,
    };
    const nodeId = nodeEl?.dataset.id;
    if (touch && nodeId) {
      const at = { x: event.clientX, y: event.clientY };
      this.longPress = window.setTimeout(() => {
        if (!this.press || this.press.moved || this.pointers.size !== 1) return;
        this.press = null;
        this.select(nodeId);
        this.swallowNextClick();
        this.openContextMenu(at, nodeId);
      }, LONG_PRESS_MS);
    }
  }

  private swallowNextClick() {
    this.releaseClick();
    const swallow = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
      this.releaseClick();
    };
    this.swallowClick = swallow;
    window.addEventListener("click", swallow, { capture: true });
    // If no click follows the finger lifting, the next real tap is not lost.
    window.setTimeout(() => this.swallowClick === swallow && this.releaseClick(), 1500);
  }

  private releaseClick() {
    if (this.swallowClick) window.removeEventListener("click", this.swallowClick, { capture: true });
    this.swallowClick = null;
  }

  private startPinch() {
    window.clearTimeout(this.longPress);
    const [a, b] = [...this.pointers.values()];
    const rect = this.canvas.getBoundingClientRect();
    this.pinch = {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      centerX: (a.x + b.x) / 2 - rect.left,
      centerY: (a.y + b.y) / 2 - rect.top,
      k: this.k,
      x: this.x,
      y: this.y,
    };
    this.press = null;
  }

  private onPointerMove(event: PointerEvent) {
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinch = this.pinch;
    if (pinch && this.pointers.size === 2) {
      // The point of the map that was under the fingers stays under them: zoom and pan at once.
      const [a, b] = [...this.pointers.values()];
      const rect = this.canvas.getBoundingClientRect();
      const k = clamp((pinch.k * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.distance, MIN_ZOOM, MAX_ZOOM);
      const worldX = (pinch.centerX - pinch.x) / pinch.k;
      const worldY = (pinch.centerY - pinch.y) / pinch.k;
      this.k = k;
      this.x = (a.x + b.x) / 2 - rect.left - worldX * k;
      this.y = (a.y + b.y) / 2 - rect.top - worldY * k;
      this.userMoved = true;
      this.applyTransform();
      return;
    }
    const press = this.press;
    if (!press) return;
    const dx = event.clientX - press.startX;
    const dy = event.clientY - press.startY;
    if (!press.moved && Math.hypot(dx, dy) < (press.touch ? TOUCH_SLOP : 4)) return;
    if (!press.moved) window.clearTimeout(this.longPress);
    press.moved = true;
    this.userMoved = true;
    this.canvas.addClass("is-panning");
    this.x = press.originX + dx;
    this.y = press.originY + dy;
    this.applyTransform();
  }

  private onPointerUp(event: PointerEvent) {
    this.pointers.delete(event.pointerId);
    window.clearTimeout(this.longPress);
    const swallow = this.swallowClick;
    if (swallow) window.setTimeout(() => this.swallowClick === swallow && this.releaseClick(), 400);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      // The finger that stays carries on panning from where the map is now.
      const [rest] = [...this.pointers.values()];
      this.press = rest ? { nodeId: null, startX: rest.x, startY: rest.y, originX: this.x, originY: this.y, moved: true, touch: true } : null;
      return;
    }
    const press = this.press;
    this.press = null;
    this.canvas.removeClass("is-panning");
    if (!press || press.moved || event.type === "pointercancel") return;
    if (press.touch) {
      const tap = { time: Date.now(), x: event.clientX, y: event.clientY };
      const last = this.lastTap;
      if (last && tap.time - last.time < DOUBLE_TAP_MS && Math.hypot(tap.x - last.x, tap.y - last.y) < 30) {
        this.lastTap = null;
        const rect = this.canvas.getBoundingClientRect();
        this.animate();
        this.zoomAt(this.k * 1.6, tap.x - rect.left, tap.y - rect.top);
        return;
      }
      this.lastTap = tap;
    }
    this.select(press.nodeId);
  }

  private onWheel(event: WheelEvent) {
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const isTrackpadPan = !event.ctrlKey && event.deltaMode === 0 && (Math.abs(event.deltaX) > 0 || Math.abs(event.deltaY) < 40);
    if (isTrackpadPan) {
      this.userMoved = true;
      this.x -= event.deltaX;
      this.y -= event.deltaY;
      this.applyTransform();
      return;
    }
    const speed = event.ctrlKey ? 0.01 : 0.0015;
    this.zoomAt(this.k * Math.exp(-event.deltaY * speed), event.clientX - rect.left, event.clientY - rect.top);
  }

  private zoomAt(next: number, px: number, py: number) {
    this.userMoved = true;
    const k = clamp(next, MIN_ZOOM, MAX_ZOOM);
    this.x = px - ((px - this.x) / this.k) * k;
    this.y = py - ((py - this.y) / this.k) * k;
    this.k = k;
    this.applyTransform();
  }

  private zoomBy(factor: number) {
    this.animate();
    this.zoomAt(this.k * factor, this.canvas.clientWidth / 2, this.visibleHeight() / 2);
  }

  /** The part of the map not under the panel and Obsidian's bar at the bottom of a phone. */
  private visibleHeight() {
    if (!this.root.classList.contains("is-phone")) return this.canvas.clientHeight;
    return Math.max(120, this.canvas.clientHeight - this.bottomInset - this.sheetHeight());
  }

  private applyTransform() {
    this.world.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.k})`;
    this.world.toggleClass("is-far", this.k < 0.55);
    this.canvas.style.backgroundPosition = `${this.x}px ${this.y}px`;
    this.canvas.style.backgroundSize = `${28 * this.k}px ${28 * this.k}px`;
  }

  private animate() {
    this.world.addClass("is-moving");
    window.setTimeout(() => this.world.removeClass("is-moving"), 340);
  }

  private fit(animated: boolean) {
    const layout = this.layout;
    if (!layout) return;
    const phone = this.root.classList.contains("is-phone");
    const margin = phone ? 16 : 56;
    const width = this.canvas.clientWidth;
    const height = this.visibleHeight();
    this.k = clamp(Math.min((width - margin * 2) / layout.width, (height - margin * 2) / layout.height), MIN_ZOOM, 1.05);
    this.x = (width - layout.width * this.k) / 2;
    this.y = (height - layout.height * this.k) / 2;
    // A whole map too small to read is no use on a phone: it stays readable and shows where to go on.
    if (phone && this.k < PHONE_MIN_ZOOM) {
      const node = this.anchorNode(layout);
      this.k = PHONE_MIN_ZOOM;
      if (node) {
        this.x = width / 2 - (node.x + node.width / 2) * this.k;
        this.y = height * 0.35 - (node.y + node.height / 2) * this.k;
      }
    }
    if (animated) this.animate();
    this.applyTransform();
  }

  /** Where to look first on a map too big for the screen: the selection, the next step, the goal. */
  private anchorNode(layout: Layout) {
    const id = (this.selected && layout.nodes.has(this.selected) ? this.selected : null) ?? this.store.route?.next ?? this.store.route?.goal;
    return (id ? layout.nodes.get(id) : undefined) ?? [...layout.nodes.values()][0];
  }

  /** Opening view: the whole map if it stays readable, otherwise the place to continue from. */
  private frame() {
    const layout = this.layout;
    if (!layout) return;
    this.fit(true);
    if (this.k >= READABLE_ZOOM && !(this.root.classList.contains("is-phone") && this.k <= PHONE_MIN_ZOOM)) return;
    const node = this.anchorNode(layout);
    if (!node) return;
    this.k = Math.max(this.k, CLOSE_ZOOM);
    this.x = this.canvas.clientWidth / 2 - (node.x + node.width / 2) * this.k;
    this.y = this.visibleHeight() * 0.3 - (node.y + node.height / 2) * this.k;
    this.applyTransform();
  }

  private centerOn(node: LaidOutNode) {
    this.animate();
    this.x = this.canvas.clientWidth / 2 - (node.x + node.width / 2) * this.k;
    this.y = this.visibleHeight() / 2 - (node.y + node.height / 2) * this.k;
    this.applyTransform();
  }

  private reveal(id: string) {
    const node = this.layout?.nodes.get(id);
    if (!node) return;
    const left = node.x * this.k + this.x;
    const top = node.y * this.k + this.y;
    const right = left + node.width * this.k;
    const bottom = top + node.height * this.k;
    if (left < 8 || top < 8 || right > this.canvas.clientWidth - 8 || bottom > this.visibleHeight() - 8) this.centerOn(node);
  }

  private onNodeKey(event: KeyboardEvent, id: string) {
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (event.shiftKey) this.openNote(id);
      else this.select(id);
    } else if (event.key.toLowerCase() === "m" || event.key.toLowerCase() === "ь") {
      if (this.store.graph.nodes.get(id)?.kind === "concept") this.store.setMastered(id, !this.store.progress.mastered.has(id));
    } else if (directions[event.key]) {
      event.preventDefault();
      this.moveFocus(id, directions[event.key]);
    }
  }

  private moveFocus(id: string, [dx, dy]: [number, number]) {
    const origin = this.layout?.nodes.get(id);
    if (!origin || !this.layout) return;
    let best: string | null = null;
    let bestScore = Infinity;
    for (const node of this.layout.nodes.values()) {
      if (node.id === id) continue;
      const vx = node.x - origin.x;
      const vy = node.y - origin.y;
      const along = vx * dx + vy * dy;
      if (along <= 0) continue;
      const score = along + Math.abs(vx * dy + vy * dx) * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = node.id;
      }
    }
    if (!best) return;
    this.nodeEls.get(best)?.focus({ preventScroll: true });
    this.reveal(best);
  }

  private openContextMenu(event: MouseEvent | { x: number; y: number }, id: string) {
    if (event instanceof MouseEvent) {
      event.preventDefault();
      // A long press on a phone opens the menu from its own timer; the browser's one would come twice.
      if (Date.now() - this.lastTouch < 1000) return;
    }
    const { store } = this;
    const node = store.graph.nodes.get(id);
    if (!node) return;
    const menu = new Menu();
    if (node.ghost) menu.addItem((item) => item.setTitle(t.createNote).setIcon("file-plus").onClick(() => attempt(store.materialize(id), `create ${node.title}`)));
    else if (node.inline) menu.addItem((item) => item.setTitle(t.openSource).setIcon("external-link").onClick(() => this.openNote(id)));
    else menu.addItem((item) => item.setTitle(t.openNote).setIcon("file-text").onClick(() => this.openNote(id)));
    if (this.focus?.center !== id && neighborhood(store.graph, id, 1).size > 0) {
      menu.addItem((item) => item.setTitle(t.focusHere).setIcon("focus").onClick(() => this.enterFocus(id)));
    }
    if (this.foldable.has(id)) {
      const isFolded = this.folded.has(id);
      const title = isFolded ? t.unfold({ count: this.foldCounts.get(id) ?? 0 }) : t.fold;
      menu.addItem((item) => item.setTitle(title).setIcon(isFolded ? "chevron-down" : "chevron-up").onClick(() => this.toggleFold(id)));
    }

    if (node.kind === "concept") {
      const mastered = store.progress.mastered.has(id);
      const goal = isGoal(store.progress, id);
      const skipped = store.progress.skipped.has(id);
      menu.addItem((item) =>
        item.setTitle(mastered ? t.clearMastered : t.markMastered).setIcon("check").onClick(() => store.setMastered(id, !mastered)),
      );
      if (!mastered && knownCandidates(store.graph, store.progress, id).length > 1) {
        menu.addItem((item) => item.setTitle(t.knowWithPrerequisites).setIcon("list-checks").onClick(() => openKnownModal(this.app, store, id)));
      }
      if (skipped) menu.addItem((item) => item.setTitle(t.unskip).setIcon("undo-2").onClick(() => store.setSkipped(id, false)));
      else if (!mastered && !goal) menu.addItem((item) => item.setTitle(t.skip).setIcon("skip-forward").onClick(() => store.setSkipped(id, true)));
      if (goal) menu.addItem((item) => item.setTitle(t.removeGoal).setIcon("flag").onClick(() => this.changeGoals(() => store.removeGoal(id))));
      else {
        const title = store.progress.goal ? t.goals.add : t.makeGoal;
        menu.addItem((item) => item.setTitle(title).setIcon("flag").onClick(() => this.changeGoals(() => store.addGoal(id))));
      }
      // On a phone there is no dot to drag a link from.
      menu.addItem((item) => item.setTitle(t.linkNext).setIcon("git-branch-plus").onClick(() => pickUnlock(this, node)));
    } else {
      const done = store.progress.done.has(id);
      menu.addItem((item) =>
        item.setTitle(done ? t.markNotDone : t.markDone).setIcon("check").onClick(() => store.setDone(id, !done)),
      );
    }
    if (event instanceof MouseEvent) menu.showAtMouseEvent(event);
    else menu.showAtPosition(event);
  }

  // Drawing a link by hand

  private startConnecting(event: PointerEvent, fromId: string) {
    const from = this.layout?.nodes.get(fromId);
    if (!from) return;
    const wire = document.createElementNS(SVG_NS, "path");
    wire.setAttribute("class", "tropa-edge is-wire");
    this.svg.appendChild(wire);
    this.root.addClass("is-connecting");
    const startX = from.x + from.width / 2;
    const startY = from.y + from.height;
    let target: string | null = null;
    let allowed = false;

    const clear = () => this.world.querySelectorAll(".is-drop-ok, .is-drop-bad").forEach((el) => el.classList.remove("is-drop-ok", "is-drop-bad"));

    const move = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - this.x) / this.k;
      const y = (e.clientY - rect.top - this.y) / this.k;
      const bend = Math.max(30, Math.abs(y - startY) / 2);
      wire.setAttribute("d", `M${startX},${startY} C${startX},${startY + bend} ${x},${y - bend} ${x},${y}`);
      clear();
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".tropa-node.is-concept");
      target = over && over.dataset.id !== fromId ? over.dataset.id! : null;
      if (target && over) {
        allowed = !this.store.graph.wouldCreateCycle(target, fromId);
        over.classList.add(allowed ? "is-drop-ok" : "is-drop-bad");
      }
    };

    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key, true);
      this.root.removeClass("is-connecting");
      wire.remove();
      clear();
    };

    const up = () => {
      stop();
      if (!target) {
        this.plugin.promptNewConcept([fromId]);
      } else if (!allowed) {
        new Notice(t.cycleRefused);
      } else if (this.store.graph.nodes.get(target)?.requires.includes(fromId)) {
        new Notice(t.linkExists);
      } else {
        attempt(this.store.addLink(target, "requiresKey", fromId), "link concepts");
      }
    };

    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key, true);
  }

  // Feedback

  private celebrate(id: string, unlocked: string[], undo: Undo) {
    const { store } = this;
    const title = store.graph.nodes.get(id)?.title ?? "";
    const names = unlocked.map((unlockedId) => store.graph.nodes.get(unlockedId)?.title).filter(Boolean);
    let text = t.mastered({ title });
    if (store.route && store.route.steps.length === 0) text = t.goalReached;
    else if (names.length) text = t.unlocked({ names: `${names.slice(0, 3).join(t.listSeparator)}${names.length > 3 ? t.andMore({ count: names.length - 3 }) : ""}` });

    this.toast(text, t.undo, () => store.undo(undo), undo);
    this.flash(unlocked);
  }

  /** Skipping or marking several concepts at once. What opened up is highlighted on the map. */
  private announce(message: string, unlocked: string[], undo: Undo) {
    const { store } = this;
    const text = store.route && store.route.steps.length === 0 ? t.goalReached : message;
    this.toast(text, t.undo, () => store.undo(undo), undo);
    this.flash(unlocked);
  }

  private flash(unlocked: string[]) {
    for (const unlockedId of unlocked) {
      const el = this.nodeEls.get(unlockedId);
      if (!el) continue;
      el.addClass("just-unlocked");
      window.setTimeout(() => el.removeClass("just-unlocked"), 1500);
    }
  }

  /** Once anything else has changed the progress, undoing would revert that too, so the offer goes. */
  private dropStaleUndo() {
    if (!this.toastUndo || this.store.canUndo(this.toastUndo)) return;
    this.toastEl?.remove();
    this.toastUndo = null;
  }

  private toast(text: string, action: string, run: () => void, undo: Undo | null = null) {
    this.toastEl?.remove();
    window.clearTimeout(this.toastTimer);
    this.toastUndo = undo;
    const el = this.stage.createDiv({ cls: "tropa-toast", attr: { role: "status" } });
    el.createSpan({ text });
    const button = el.createEl("button", { text: action });
    button.addEventListener("click", () => {
      el.remove();
      run();
    });
    this.toastEl = el;
    this.toastTimer = window.setTimeout(() => el.remove(), 6000);
  }
}

// Measuring the drawing for the SVG export

/** Any CSS color, including color-mix() and color(), as a color every SVG viewer reads. */
function colorReader() {
  const context = createEl("canvas", { attr: { width: "1", height: "1" } }).getContext("2d", { willReadFrequently: true })!;
  const known = new Map<string, string>();
  return (css: string) => {
    let out = known.get(css);
    if (out !== undefined) return out;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#000";
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    const hex = `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    out = a === 0 ? "none" : a === 255 ? hex : `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 100) / 100})`;
    known.set(css, out);
    return out;
  };
}

function textMeasure() {
  const context = createEl("canvas").getContext("2d")!;
  return (text: string, style: CSSStyleDeclaration) => {
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return context.measureText(text).width;
  };
}

type Measure = ReturnType<typeof textMeasure>;
type Box = { x: number; y: number; width: number; height: number };

/** A CSS box as a rectangle; the border is drawn inside, as in CSS. */
function boxOf(style: CSSStyleDeclaration, box: Box, color: (css: string) => string): SvgBox {
  const width = style.borderTopStyle === "none" ? 0 : parseFloat(style.borderTopWidth) || 0;
  return {
    x: box.x + width / 2,
    y: box.y + width / 2,
    width: box.width - width,
    height: box.height - width,
    radius: Math.min(parseFloat(style.borderTopLeftRadius) || 0, box.height / 2),
    fill: color(style.backgroundColor),
    stroke: color(style.borderTopColor),
    strokeWidth: width,
    dash: style.borderTopStyle === "dashed" ? `${width * 3} ${width * 2}` : undefined,
  };
}

/** "Next step" and "Goal" are drawn in CSS as pseudo-elements; their box is worked out from their style. */
function badgeOf(el: HTMLElement, pseudo: "::before" | "::after", node: LaidOutNode, color: (css: string) => string, measure: Measure) {
  const style = getComputedStyle(el, pseudo);
  if (style.content === "none" || style.content === "normal" || style.position !== "absolute") return null;
  let text = style.content;
  try {
    text = JSON.parse(text) as string;
  } catch {
    // An unquoted content value is used as it is.
  }
  const border = parseFloat(style.borderTopWidth) || 0;
  const padX = parseFloat(style.paddingLeft) || 0;
  const padY = parseFloat(style.paddingTop) || 0;
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
  const width = measure(text, style) + padX * 2 + border * 2;
  const height = lineHeight + padY * 2 + border * 2;
  const x = style.left !== "auto" ? parseFloat(style.left) : node.width - parseFloat(style.right) - width;
  const box = { x: node.x + x, y: node.y + parseFloat(style.top), width, height };
  return {
    box: boxOf(style, box, color),
    text: { x: box.x + border + padX, y: box.y + height / 2, text, fill: color(style.color), fontSize: parseFloat(style.fontSize), fontWeight: style.fontWeight, fontFamily: style.fontFamily, rtl: false },
  };
}

/** The lines of a text as the map wraps it. Text in a right-to-left script starts at the right end. */
function textLines(el: HTMLElement, box: Box, maxLines: number, color: (css: string) => string, measure: Measure): SvgText[] {
  const style = getComputedStyle(el);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.25;
  const rtl = /^[^A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]*[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(el.textContent ?? "");
  const lines = wrapText(el.textContent ?? "", box.width + 0.5, (line) => measure(line, style), maxLines);
  return lines.map((line, i) => ({
    x: rtl ? box.x + box.width : box.x,
    y: box.y + lineHeight * (i + 0.5),
    text: line,
    fill: color(style.color),
    fontSize: parseFloat(style.fontSize),
    fontWeight: style.fontWeight,
    fontFamily: style.fontFamily,
    rtl,
  }));
}

function today() {
  const date = new Date();
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, "0")).join("-");
}

function backgroundOf(canvas: HTMLElement, color: (css: string) => string) {
  for (let el: HTMLElement | null = canvas; el; el = el.parentElement) {
    const fill = color(getComputedStyle(el).backgroundColor);
    if (fill !== "none") return fill;
  }
  return "#ffffff";
}

function nextSheet(state: SheetState): SheetState {
  return state === "peek" ? "half" : state === "half" ? "full" : "peek";
}

/** Painting runs for every node on each change; untouched nodes keep their styles. */
function setClass(el: HTMLElement, className: string) {
  if (el.className !== className) el.className = className;
}

function setText(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

function setGlyph(el: HTMLElement, icon: string) {
  if (el.dataset.icon === icon) return;
  el.dataset.icon = icon;
  el.empty();
  setIcon(el, icon);
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
