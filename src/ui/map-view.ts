import { ItemView, Menu, Notice, setIcon, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { FORMAT_ICON, STATE_ICON, formatMinutes } from "../core/format";
import { finishLayout, prepareLayout, type Layout, type LaidOutNode } from "../core/layout";
import { LayoutRunner } from "../core/layout-runner";
import layoutWorker from "tropa:layout-worker";
import { isPassed, knownCandidates, sourceState } from "../core/graph";
import type { GraphNode, Progress } from "../core/types";
import { attempt } from "../attempt";
import { isRtl, t } from "../i18n";
import type TropaPlugin from "../main";
import { openKnownModal, renderConcept, renderRoute, renderSource, type DetailHost } from "./detail";
import { PickModal } from "./pick";

export const MAP_VIEW = "tropa-map";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1.6;
const READABLE_ZOOM = 0.6;
const CLOSE_ZOOM = 0.8;
/**
 * A zoomed-out map with more edges than this draws them without dashes. Dashed paths are slow to
 * rasterise: on a 1700-node map (3400 edges) the browser froze for over 30 s, while maps of 400
 * concepts, even with their materials (about 1400 edges), keep their dashes.
 */
const DASHED_EDGES_MAX = 1500;
const SVG_NS = "http://www.w3.org/2000/svg";

interface Press {
  nodeId: string | null;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

export class MapView extends ItemView implements DetailHost {
  private root!: HTMLElement;
  private bar!: HTMLElement;
  private stage!: HTMLElement;
  private canvas!: HTMLElement;
  private world!: HTMLElement;
  private svg!: SVGSVGElement;
  private side!: HTMLElement;
  private toastEl: HTMLElement | null = null;
  private toastTimer = 0;

  private readonly nodeEls = new Map<string, HTMLElement>();
  private layout: Layout | null = null;
  private layoutKey = "";
  private readonly layouts = new LayoutRunner(layoutWorker);
  /** The worker is still laying out the graph for `layoutKey`; the map shows the previous layout. */
  private layoutPending = false;
  private selected: string | null = null;
  private x = 40;
  private y = 40;
  private k = 1;

  private press: Press | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { distance: number; k: number } | null = null;
  private needsFit = true;
  private sideCollapsed = false;
  /** Until the person pans or zooms, the view keeps itself framed. */
  private userMoved = false;
  private overview = false;

  canGoBack = true;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TropaPlugin) {
    super(leaf);
    this.navigation = false;
  }

  get store() {
    return this.plugin.store;
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
    const body = this.root.createDiv({ cls: "tropa-body" });
    this.stage = body.createDiv({ cls: "tropa-stage" });
    this.canvas = this.stage.createDiv({ cls: "tropa-canvas" });
    this.world = this.canvas.createDiv({ cls: "tropa-world" });
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.addClass("tropa-edges");
    this.world.appendChild(this.svg);
    this.side = body.createDiv({ cls: "tropa-side" });

    this.buildControls();
    this.bindCanvas();

    const observer = new ResizeObserver(() => {
      this.root.toggleClass("is-narrow", this.root.clientWidth < 760);
      if (!this.userMoved && this.layout) this.frame();
    });
    observer.observe(this.root);
    this.register(() => observer.disconnect());
    this.register(() => this.layouts.dispose());

    this.registerEvent(this.store.on("change", () => this.render()));
    this.registerEvent(this.store.on("mastered", (id, unlocked, undo) => this.celebrate(id, unlocked, undo)));
    this.registerEvent(this.store.on("undoable", (message, unlocked, undo) => this.announce(message, unlocked, undo)));
    this.render();
  }

  getState() {
    return { selected: this.selected };
  }

  async setState(state: { selected?: string | null }, result: ViewStateResult) {
    if (state?.selected && this.store.graph.nodes.has(state.selected)) this.select(state.selected);
    await super.setState(state, result);
  }

  // DetailHost

  select(id: string | null) {
    this.selected = id;
    this.sideCollapsed = false;
    this.renderSide();
    this.paintNodes();
    if (id) this.reveal(id);
  }

  openNote(id: string, newTab = false) {
    this.plugin.openNote(id, newTab);
  }

  /** Centres a concept for commands such as "find on the map". */
  focusNode(id: string) {
    if (this.effectiveMode() === "route" && !this.store.route?.closure.has(id)) {
      this.plugin.settings.mapMode = "all";
      attempt(this.plugin.saveSettings(), "save settings");
      this.render();
    }
    this.select(id);
    const node = this.layout?.nodes.get(id);
    if (node) this.centerOn(node);
    this.nodeEls.get(id)?.focus({ preventScroll: true });
  }

  pickGoal = () => {
    const items = this.store.graph.concepts
      .sort((a, b) => a.title.localeCompare(b.title, "ru"))
      .map((node) => ({ id: node.id, title: node.title, icon: STATE_ICON[this.store.states.get(node.id) ?? "locked"] }));
    new PickModal(this.app, items, t.goalPrompt, (item) => this.chooseGoal(item.id)).open();
  };

  private chooseGoal(id: string) {
    this.needsFit = true;
    this.selected = null;
    this.drawTrail();
    this.store.setGoal(id);
  }

  // Rendering

  private effectiveMode() {
    return this.plugin.settings.mapMode === "route" && this.store.route ? "route" : "all";
  }

  render() {
    if (!this.root) return;
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
      this.renderSide();
      return;
    }
    this.syncNodes();
    this.paintNodes();
    this.drawEdges();
    this.renderSide();
    if (this.needsFit && this.stage.clientWidth > 0) {
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
    const only = mode === "route" ? store.route!.closure : undefined;
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

  private setLayout(layout: Layout) {
    if (this.layout) this.needsFit = true;
    this.layout = layout;
    this.setPending(false);
  }

  private setPending(pending: boolean) {
    this.layoutPending = pending;
    this.canvas.toggleClass("is-laying-out", pending);
    this.canvas.setAttribute("aria-busy", String(pending));
  }

  private syncNodes() {
    const layout = this.layout!;
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
    }
    el.addEventListener("pointerenter", () => this.highlight(node.id));
    el.addEventListener("pointerleave", () => this.highlight(null));
    el.addEventListener("focus", () => this.highlight(node.id));
    el.addEventListener("blur", () => this.highlight(null));
    el.addEventListener("keydown", (event) => this.onNodeKey(event, node.id));
    el.addEventListener("dblclick", () => {
      if (this.store.graph.nodes.get(node.id)?.ghost) attempt(this.store.materialize(node.id), `create ${node.title}`);
      else this.openNote(node.id);
    });
    el.addEventListener("contextmenu", (event) => this.openContextMenu(event, node.id));
    return el;
  }

  private paintNodes() {
    const { store } = this;
    const route = store.route;
    for (const [id, el] of this.nodeEls) {
      const node = store.graph.nodes.get(id);
      if (!node) continue;
      const glyph = el.querySelector<HTMLElement>(".tropa-glyph")!;
      const meta = el.querySelector<HTMLElement>(".tropa-node-meta")!;
      const isSelected = id === this.selected;

      if (node.kind === "source") {
        const state = sourceState(store.graph, store.progress, id);
        el.className = `tropa-node is-source state-${state}${isSelected ? " is-selected" : ""}`;
        setGlyph(glyph, state === "done" ? "check" : FORMAT_ICON[node.format ?? "other"]);
        meta.textContent = node.minutes ? formatMinutes(node.minutes) : "";
        el.setAttribute("aria-label", t.materialLabel({ title: node.title }));
        continue;
      }

      const state = store.states.get(id) ?? "locked";
      const isGoal = route?.goal === id;
      const isNext = route?.next === id;
      const classes = ["tropa-node", "is-concept", `state-${state}`];
      if (isSelected) classes.push("is-selected");
      if (isGoal) classes.push("is-goal");
      if (isNext) classes.push("is-next");
      if (node.ghost) classes.push("is-ghost");
      if (route?.closure.has(id)) classes.push("is-on-route");
      el.className = classes.join(" ");
      setGlyph(glyph, STATE_ICON[state]);
      meta.textContent = this.nodeMeta(node);
      el.setAttribute("aria-label", `${node.title}. ${t.state[state]}${isGoal ? t.goalSuffix : ""}${isNext ? t.nextSuffix : ""}`);
    }
    this.paintEdgeRoute();
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
    this.svg.empty();
    this.world.toggleClass("is-dense", layout.edges.length > DASHED_EDGES_MAX);
    const pad = 200;
    this.svg.setAttribute("width", String(layout.width + pad * 2));
    this.svg.setAttribute("height", String(layout.height + pad * 2));
    this.svg.setAttribute("viewBox", `${-pad} ${-pad} ${layout.width + pad * 2} ${layout.height + pad * 2}`);
    this.svg.style.left = `${-pad}px`;
    this.svg.style.top = `${-pad}px`;

    for (const edge of layout.edges) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", edge.path);
      path.dataset.from = edge.from;
      path.dataset.to = edge.to;
      path.dataset.kind = edge.kind;
      this.svg.appendChild(path);
    }
    this.paintEdgeRoute();
  }

  private paintEdgeRoute() {
    const { store } = this;
    const route = store.route;
    const height = Math.max(1, this.layout?.height ?? 1);
    this.svg.querySelectorAll<SVGPathElement>("path").forEach((path) => {
      const { from, to, kind } = path.dataset as { from: string; to: string; kind: string };
      const onRoute = kind === "requires" && route?.closure.has(from) && route.closure.has(to);
      const classes = ["tropa-edge", `is-${kind}`];
      if (onRoute) {
        classes.push("is-route");
        if (isPassed(store.progress, from)) classes.push(isPassed(store.progress, to) ? "is-walked" : "is-frontier");
      }
      if (kind === "requires" && store.graph.isInCycle(from) && store.graph.isInCycle(to)) classes.push("is-loop");
      path.setAttribute("class", classes.join(" "));
      const startY = this.layout?.nodes.get(from)?.y ?? 0;
      path.style.setProperty("--tropa-delay", `${Math.round((startY / height) * 520)}ms`);
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

  private renderBar() {
    const goalButton = this.bar.querySelector<HTMLElement>(".tropa-goal")!;
    const label = goalButton.querySelector<HTMLElement>(".tropa-goal-label")!;
    const { route, graph } = this.store;
    const goal = route ? graph.nodes.get(route.goal) : null;
    label.textContent = goal ? goal.title : t.chooseGoal;
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
    }

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
  }

  private renderSide() {
    const { side, store } = this;
    const scroll = side.scrollTop;
    const previous = side.dataset.showing;
    side.empty();
    side.toggleClass("is-collapsed", this.sideCollapsed);

    const node = this.selected ? store.graph.nodes.get(this.selected) : null;
    if (this.selected && !node) this.selected = null;

    const collapse = side.createEl("button", {
      cls: "tropa-collapse clickable-icon",
      attr: { "aria-label": this.sideCollapsed ? t.expandPanel : t.collapsePanel },
    });
    setIcon(collapse, this.sideCollapsed ? "chevron-up" : "chevron-down");
    collapse.addEventListener("click", () => {
      this.sideCollapsed = !this.sideCollapsed;
      this.renderSide();
    });

    if (node?.kind === "concept") renderConcept(side, this, node);
    else if (node) renderSource(side, this, node);
    else renderRoute(side, this, this.pickGoal);

    const showing = node?.id ?? "route";
    side.dataset.showing = showing;
    side.scrollTop = previous === showing ? scroll : 0;
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
    goal.addEventListener("click", this.pickGoal);

    const progress = this.bar.createDiv({ cls: "tropa-progress" });
    progress.createSpan({ cls: "tropa-progress-text" });
    const meter = progress.createDiv({
      cls: "tropa-meter",
      attr: { role: "progressbar", "aria-label": t.routeProgress, "aria-valuemin": "0", "aria-valuemax": "100" },
    });
    meter.createDiv({ cls: "tropa-meter-fill" });
    progress.createSpan({ cls: "tropa-progress-time" });

    this.bar.createDiv({ cls: "tropa-spacer" });

    const segment = this.bar.createDiv({ cls: "tropa-segment", attr: { role: "group", "aria-label": t.viewMode } });
    for (const [mode, text] of [["route", t.modeRoute], ["all", t.modeAll]] as const) {
      const button = segment.createEl("button", { text });
      button.dataset.mode = mode;
      button.addEventListener("click", () => {
        this.plugin.settings.mapMode = mode;
        attempt(this.plugin.saveSettings(), "save settings");
        this.needsFit = true;
        this.overview = true;
        this.render();
      });
    }

    const sources = this.bar.createEl("button", { cls: "tropa-toggle-sources", text: t.materials });
    sources.addEventListener("click", () => {
      this.plugin.settings.showSources = !this.plugin.settings.showSources;
      attempt(this.plugin.saveSettings(), "save settings");
      this.needsFit = true;
      this.overview = true;
      this.render();
    });

    const add = this.bar.createEl("button", { cls: "tropa-add-concept clickable-icon", attr: { "aria-label": t.newConcept } });
    setIcon(add, "plus");
    add.addEventListener("click", () => this.plugin.promptNewConcept());

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
  }

  // Interaction

  private bindCanvas() {
    this.registerDomEvent(this.canvas, "pointerdown", (event) => this.onPointerDown(event));
    this.registerDomEvent(this.canvas, "pointermove", (event) => this.onPointerMove(event));
    this.registerDomEvent(this.canvas, "pointerup", (event) => this.onPointerUp(event));
    this.registerDomEvent(this.canvas, "pointercancel", (event) => this.onPointerUp(event));
    this.registerDomEvent(this.canvas, "wheel", (event) => this.onWheel(event), { passive: false });
    this.registerDomEvent(this.root, "keydown", (event) => {
      if (event.key === "Escape" && this.selected) this.select(null);
    });
  }

  private onPointerDown(event: PointerEvent) {
    if (this.store.isEmpty || (event.button !== 0 && event.button !== 1)) return;
    const target = event.target as HTMLElement;
    if (target.closest(".tropa-empty")) return;
    const port = target.closest(".tropa-port");
    const nodeEl = target.closest<HTMLElement>(".tropa-node");
    if (port && nodeEl) {
      event.stopPropagation();
      this.startConnecting(event, nodeEl.dataset.id!);
      return;
    }
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), k: this.k };
      this.press = null;
      return;
    }
    this.press = {
      nodeId: nodeEl?.dataset.id ?? null,
      startX: event.clientX,
      startY: event.clientY,
      originX: this.x,
      originY: this.y,
      moved: false,
    };
  }

  private onPointerMove(event: PointerEvent) {
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const rect = this.canvas.getBoundingClientRect();
      const scale = (this.pinch.k * Math.hypot(a.x - b.x, a.y - b.y)) / this.pinch.distance;
      this.zoomAt(scale, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      return;
    }
    const press = this.press;
    if (!press) return;
    const dx = event.clientX - press.startX;
    const dy = event.clientY - press.startY;
    if (!press.moved && Math.hypot(dx, dy) < 4) return;
    press.moved = true;
    this.userMoved = true;
    this.canvas.addClass("is-panning");
    this.x = press.originX + dx;
    this.y = press.originY + dy;
    this.applyTransform();
  }

  private onPointerUp(event: PointerEvent) {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const press = this.press;
    this.press = null;
    this.canvas.removeClass("is-panning");
    if (!press || press.moved || event.type === "pointercancel") return;
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
    this.zoomAt(this.k * factor, this.canvas.clientWidth / 2, this.canvas.clientHeight / 2);
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
    const margin = 56;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.k = clamp(Math.min((width - margin * 2) / layout.width, (height - margin * 2) / layout.height), MIN_ZOOM, 1.05);
    this.x = (width - layout.width * this.k) / 2;
    this.y = (height - layout.height * this.k) / 2;
    if (animated) this.animate();
    this.applyTransform();
  }

  /** Opening view: the whole map if it stays readable, otherwise the place to continue from. */
  private frame() {
    const layout = this.layout;
    if (!layout) return;
    this.fit(true);
    if (this.k >= READABLE_ZOOM) return;
    const anchor = this.store.route?.next ?? this.store.route?.goal;
    const node = anchor ? layout.nodes.get(anchor) : [...layout.nodes.values()][0];
    if (!node) return;
    this.k = CLOSE_ZOOM;
    this.x = this.canvas.clientWidth / 2 - (node.x + node.width / 2) * this.k;
    this.y = this.canvas.clientHeight * 0.3 - (node.y + node.height / 2) * this.k;
    this.applyTransform();
  }

  private centerOn(node: LaidOutNode) {
    this.animate();
    this.x = this.canvas.clientWidth / 2 - (node.x + node.width / 2) * this.k;
    this.y = this.canvas.clientHeight / 2 - (node.y + node.height / 2) * this.k;
    this.applyTransform();
  }

  private reveal(id: string) {
    const node = this.layout?.nodes.get(id);
    if (!node) return;
    const left = node.x * this.k + this.x;
    const top = node.y * this.k + this.y;
    const right = left + node.width * this.k;
    const bottom = top + node.height * this.k;
    if (left < 8 || top < 8 || right > this.canvas.clientWidth - 8 || bottom > this.canvas.clientHeight - 8) this.centerOn(node);
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

  private openContextMenu(event: MouseEvent, id: string) {
    event.preventDefault();
    const { store } = this;
    const node = store.graph.nodes.get(id);
    if (!node) return;
    const menu = new Menu();
    if (node.ghost) menu.addItem((item) => item.setTitle(t.createNote).setIcon("file-plus").onClick(() => attempt(store.materialize(id), `create ${node.title}`)));
    else if (node.inline) menu.addItem((item) => item.setTitle(t.openSource).setIcon("external-link").onClick(() => this.openNote(id)));
    else menu.addItem((item) => item.setTitle(t.openNote).setIcon("file-text").onClick(() => this.openNote(id)));

    if (node.kind === "concept") {
      const mastered = store.progress.mastered.has(id);
      const isGoal = store.progress.goal === id;
      const skipped = store.progress.skipped.has(id);
      menu.addItem((item) =>
        item.setTitle(mastered ? t.clearMastered : t.markMastered).setIcon("check").onClick(() => store.setMastered(id, !mastered)),
      );
      if (!mastered && knownCandidates(store.graph, store.progress, id).length > 1) {
        menu.addItem((item) => item.setTitle(t.knowWithPrerequisites).setIcon("list-checks").onClick(() => openKnownModal(this.app, store, id)));
      }
      if (skipped) menu.addItem((item) => item.setTitle(t.unskip).setIcon("undo-2").onClick(() => store.setSkipped(id, false)));
      else if (!mastered && !isGoal) menu.addItem((item) => item.setTitle(t.skip).setIcon("skip-forward").onClick(() => store.setSkipped(id, true)));
      menu.addItem((item) =>
        item.setTitle(isGoal ? t.removeGoal : t.makeGoal).setIcon("flag").onClick(() => (isGoal ? store.setGoal(null) : this.chooseGoal(id))),
      );
    } else {
      const done = store.progress.done.has(id);
      menu.addItem((item) =>
        item.setTitle(done ? t.markNotDone : t.markDone).setIcon("check").onClick(() => store.setDone(id, !done)),
      );
    }
    menu.showAtMouseEvent(event);
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

  private celebrate(id: string, unlocked: string[], undo: Progress) {
    const { store } = this;
    const title = store.graph.nodes.get(id)?.title ?? "";
    const names = unlocked.map((unlockedId) => store.graph.nodes.get(unlockedId)?.title).filter(Boolean);
    let text = t.mastered({ title });
    if (store.route && store.route.steps.length === 0) text = t.goalReached;
    else if (names.length) text = t.unlocked({ names: `${names.slice(0, 3).join(t.listSeparator)}${names.length > 3 ? t.andMore({ count: names.length - 3 }) : ""}` });

    this.toast(text, t.undo, () => store.restore(undo));
    this.flash(unlocked);
  }

  /** Skipping or marking several concepts at once. What opened up is highlighted on the map. */
  private announce(message: string, unlocked: string[], undo: Progress) {
    const { store } = this;
    const text = store.route && store.route.steps.length === 0 ? t.goalReached : message;
    this.toast(text, t.undo, () => store.restore(undo));
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

  private toast(text: string, action: string, run: () => void) {
    this.toastEl?.remove();
    window.clearTimeout(this.toastTimer);
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

function setGlyph(el: HTMLElement, icon: string) {
  if (el.dataset.icon === icon) return;
  el.dataset.icon = icon;
  el.empty();
  setIcon(el, icon);
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
