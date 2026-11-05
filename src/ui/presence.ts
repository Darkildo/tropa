import { Keymap, MarkdownRenderChild, Modal, Platform, TFile, type App, type HoverParent, type HoverPopover } from "obsidian";
import type TropaPlugin from "../main";
import { attempt } from "../attempt";
import { formatDate, formatMinutes } from "../core/format";
import { parseDate } from "../core/plan";
import { BLOCK_LIMIT_DEFAULT, blockErrorText, onTheWayTo, parseBlockOptions, statusLine, type BlockOptions, type StatusAction } from "../core/presence";
import type { GraphNode, Route } from "../core/types";
import { isRtl, t } from "../i18n";
import type { Reviews } from "../review";
import { reviewBlock } from "./detail";
import { formatRelative } from "./when";

export const HOVER_SOURCE = "tropa";

/**
 * Today's reviews and the next step, at the bottom of the window. Desktop only: Obsidian on a
 * phone has no status bar. It follows the store and the review queue, and hides when there is
 * nothing to say or it is turned off.
 */
export class StatusBar {
  private readonly el: HTMLElement;
  private action: StatusAction = "queue";

  constructor(private readonly plugin: TropaPlugin) {
    this.el = plugin.addStatusBarItem();
    this.el.addClass("tropa-status", "mod-clickable");
    this.el.setAttr("data-tooltip-position", "top");
    this.el.addEventListener("click", () => this.open());
    plugin.registerEvent(plugin.store.on("change", () => this.update()));
    plugin.registerEvent(plugin.reviews.on("change", () => this.update()));
    this.update();
  }

  update() {
    const { settings, reviews, store } = this.plugin;
    const day = reviews.enabled && reviews.ready ? reviews.day() : null;
    const next = store.route?.next;
    const line = settings.statusBar
      ? statusLine({
          due: day?.queue.length ?? 0,
          pausedUntil: day?.paused?.until ?? null,
          next: next ? (store.graph.nodes.get(next)?.title ?? null) : null,
        })
      : null;
    this.el.toggleClass("is-hidden", !line);
    if (!line) return;
    this.action = line.action;
    this.el.setText(line.text);
    this.el.setAttr("aria-label", line.action === "queue" ? t.presence.statusQueue : t.presence.statusStep);
  }

  private open() {
    if (this.action === "queue") attempt(this.plugin.showReviewQueue(), "open the review queue");
    else attempt(this.plugin.showNextStep(), "show the next step");
  }
}

/** The four ratings of a concept under review, as in its details; closes once one is chosen. */
class ReviewModal extends Modal {
  constructor(app: App, private readonly reviews: Reviews, private readonly node: GraphNode) {
    super(app);
    if (isRtl()) this.modalEl.dir = "rtl";
  }

  onOpen() {
    this.setTitle(this.node.title);
    this.contentEl.addClass("tropa-host", "tropa-review-modal");
    reviewBlock(this.contentEl, this.reviews, this.node, () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * A `tropa` code block: the route, today's reviews or the next step, in any note. It draws again
 * when the progress or the queue changes, and lets go of both when the block goes away.
 */
export class TropaBlock extends MarkdownRenderChild implements HoverParent {
  hoverPopover: HoverPopover | null = null;

  constructor(
    containerEl: HTMLElement,
    private readonly plugin: TropaPlugin,
    private readonly source: string,
    private readonly sourcePath: string,
  ) {
    super(containerEl);
  }

  onload() {
    this.registerEvent(this.plugin.store.on("change", () => this.render()));
    this.registerEvent(this.plugin.reviews.on("change", () => this.render()));
    this.render();
  }

  private get store() {
    return this.plugin.store;
  }

  private render() {
    const root = this.containerEl;
    root.empty();
    root.addClass("tropa-host", "tropa-block");
    root.setAttr("dir", isRtl() ? "rtl" : "ltr");
    const parsed = parseBlockOptions(this.source);
    if ("error" in parsed) {
      this.error(blockErrorText(parsed.error));
      return;
    }
    // Until the vault has been read there is no map to look goals up in.
    if (!this.store.loaded) return;
    const { options } = parsed;
    let goal: string | null = null;
    if (options.goal) {
      const file = this.plugin.app.metadataCache.getFirstLinkpathDest(options.goal, this.sourcePath);
      if (!file || this.store.graph.nodes.get(file.path)?.kind !== "concept") {
        this.error(t.presence.errGoal({ goal: options.goal }));
        return;
      }
      goal = file.path;
    }
    if (options.show === "review") {
      this.renderReview(options, goal);
      return;
    }
    const route = goal ? this.store.routeTo(goal) : this.store.route;
    if (!route) {
      const line = root.createDiv({ cls: "tropa-block-hint" });
      line.createSpan({ text: `${t.presence.noGoal} ` });
      this.mapButton(line, t.presence.openMap);
      return;
    }
    this.goalLine(route.goals);
    if (route.steps.length === 0) {
      root.createDiv({ cls: "tropa-block-hint", text: t.goalReached });
      return;
    }
    if (options.show === "next") this.renderNext(route);
    else this.renderRoute(route, options);
  }

  private error(text: string) {
    this.containerEl.createDiv({ cls: "tropa-block-error", text });
  }

  /** "Goal: X", the title a link to the note; several goals each a link. */
  private goalLine(goals: readonly string[]) {
    const line = this.containerEl.createDiv({ cls: "tropa-block-goal" });
    const [before, after = ""] = t.presence.goal({ title: "\u0000" }).split("\u0000");
    line.createSpan({ text: before });
    goals.forEach((id, index) => {
      if (index > 0) line.createSpan({ text: t.listSeparator });
      this.link(line, id);
    });
    if (after) line.createSpan({ text: after });
  }

  private renderRoute(route: Route, options: BlockOptions) {
    const root = this.containerEl;
    const count = route.steps.length;
    const several = route.goals.length > 1;
    const head = several ? t.goals.stepsToGoals({ count }) : t.stepsToGoal({ count });
    root.createDiv({
      cls: "tropa-block-count",
      text: route.remainingMinutes ? `${head} · ${formatMinutes(route.remainingMinutes)}` : head,
    });
    const limit = options.limit ?? BLOCK_LIMIT_DEFAULT;
    const list = root.createEl("ul", { cls: "tropa-block-list contains-task-list" });
    for (const step of route.steps.slice(0, limit)) this.stepItem(list, route, step.id, step.material);
    if (count > limit) this.mapButton(root.createDiv({ cls: "tropa-block-more" }), t.presence.more({ count: count - limit }));
  }

  private renderNext(route: Route) {
    if (!route.next) {
      this.containerEl.createDiv({ cls: "tropa-block-hint", text: t.presence.nextNone });
      return;
    }
    const step = route.steps.find((item) => item.id === route.next);
    const list = this.containerEl.createEl("ul", { cls: "tropa-block-list contains-task-list" });
    this.stepItem(list, route, route.next, step?.material ?? null, true);
  }

  private stepItem(list: HTMLElement, route: Route, id: string, material: string | null, always = false) {
    const node = this.store.graph.nodes.get(id);
    if (!node) return;
    const state = this.store.states.get(id) ?? "locked";
    const isNext = id === route.next;
    const item = list.createEl("li", { cls: `task-list-item tropa-block-item state-${state}${isNext ? " is-next" : ""}` });
    const box = this.checkbox(item, t.presence.master({ title: node.title }));
    box.addEventListener("change", () => {
      box.checked = false;
      attempt(this.plugin.checks.master(id), "mark a concept mastered");
    });
    this.link(item, id);
    const source = material ? this.store.graph.nodes.get(material) : null;
    if (source && (always || isNext || state === "learning")) {
      const meta = item.createDiv({ cls: "tropa-block-meta" });
      this.link(meta, source.id);
      if (source.minutes) meta.createSpan({ cls: "tropa-nowrap", text: `${t.listSeparator}${formatMinutes(source.minutes)}` });
    }
  }

  /** Today's queue; with a goal, only what lies on the way to it (see `onTheWayTo`). */
  private renderReview(options: BlockOptions, goal: string | null) {
    const root = this.containerEl;
    const { reviews, settings } = this.plugin;
    if (!reviews.enabled) {
      root.createDiv({ cls: "tropa-block-hint", text: settings.journal ? t.review.off : t.review.needsJournal });
      return;
    }
    const now = Date.now();
    const day = reviews.day(now);
    if (goal) this.goalLine([goal]);
    if (day.paused) {
      root.createDiv({ cls: "tropa-block-hint", text: t.presence.statusPaused({ date: formatDate(parseDate(day.paused.until), new Date(now)) }) });
      return;
    }
    const { queue, waiting } = goal ? onTheWayTo(day, new Set([goal, ...this.store.graph.ancestors(goal)])) : day;
    const waitingText = waiting > 0 ? (goal ? t.presence.waitingGoal({ count: waiting }) : t.review.waiting({ count: waiting })) : "";
    if (queue.length === 0) {
      root.createDiv({
        cls: "tropa-block-hint",
        text: waiting > 0 ? `${t.review.limitDone} ${waitingText}` : goal ? t.presence.nothingGoal : t.review.nothingDue,
      });
      return;
    }
    const total = queue.length + waiting;
    root.createDiv({
      cls: "tropa-block-count",
      text: `${t.review.queue}: ${queue.length < total ? t.review.queueCount({ shown: queue.length, total }) : queue.length}`,
    });
    const limit = options.limit ?? BLOCK_LIMIT_DEFAULT;
    const list = root.createEl("ul", { cls: "tropa-block-list contains-task-list" });
    for (const schedule of queue.slice(0, limit)) {
      const node = this.store.graph.nodes.get(schedule.id);
      if (!node) continue;
      const item = list.createEl("li", { cls: "task-list-item tropa-block-item is-due" });
      const box = this.checkbox(item, t.presence.review({ title: node.title }));
      box.addEventListener("change", () => {
        box.checked = false;
        new ReviewModal(this.plugin.app, reviews, node).open();
      });
      this.link(item, node.id);
      item.createSpan({ cls: "tropa-block-when tropa-nowrap", text: formatRelative(schedule.due, now) });
    }
    if (queue.length > limit) {
      const more = root.createDiv({ cls: "tropa-block-more" });
      this.button(more, t.presence.more({ count: queue.length - limit }), () => attempt(this.plugin.showReviewQueue(), "open the review queue"));
    }
    if (waitingText) root.createDiv({ cls: "tropa-block-hint tropa-block-waiting", text: waitingText });
  }

  private checkbox(item: HTMLElement, label: string) {
    const box = item.createEl("input", { cls: "task-list-item-checkbox", type: "checkbox", attr: { "aria-label": label } });
    // In Live Preview a click would otherwise move the cursor into the block's source.
    box.addEventListener("click", (event) => event.stopPropagation());
    return box;
  }

  /**
   * A link to the note of a node, as Obsidian draws one: it opens on a click (in a new tab with
   * the modifier) and shows a preview on hover. A material without a note links to its URL.
   */
  private link(parent: HTMLElement, id: string) {
    const node = this.store.graph.nodes.get(id);
    if (!node) return;
    if (node.inline && !node.file) {
      const a = parent.createEl("a", { cls: "external-link", text: node.title, href: node.url ?? "", attr: { dir: "auto", target: "_blank", rel: "noopener" } });
      a.addEventListener("click", (event) => event.stopPropagation());
      return;
    }
    const path = node.inline ? node.file! : id;
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    const linktext = file instanceof TFile ? this.plugin.app.metadataCache.fileToLinktext(file, this.sourcePath, true) : node.title;
    const a = parent.createEl("a", {
      cls: `internal-link${file ? "" : " is-unresolved"}`,
      text: node.title,
      href: linktext,
      attr: { "data-href": linktext, dir: "auto" },
    });
    a.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      attempt(this.plugin.app.workspace.openLinkText(linktext, this.sourcePath, Keymap.isModEvent(event)), `open ${linktext}`);
    });
    a.addEventListener("mouseover", (event) => {
      event.stopPropagation();
      this.plugin.app.workspace.trigger("hover-link", { event, source: HOVER_SOURCE, hoverParent: this, targetEl: a, linktext, sourcePath: this.sourcePath });
    });
  }

  private mapButton(parent: HTMLElement, text: string) {
    this.button(parent, text, () => attempt(this.plugin.showMap(), "open the map"));
  }

  private button(parent: HTMLElement, text: string, onClick: () => void) {
    const button = parent.createEl("button", { cls: "tropa-block-button", text });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
  }
}

/** Hover previews of notes on the map: nothing to hover on a phone. */
export function hoverNote(app: App, parent: HoverParent, event: MouseEvent, targetEl: HTMLElement, path: string) {
  if (Platform.isMobile) return;
  app.workspace.trigger("hover-link", { event, source: HOVER_SOURCE, hoverParent: parent, targetEl, linktext: path, sourcePath: "" });
}
