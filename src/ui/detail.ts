import { setIcon, type App } from "obsidian";
import { FORMAT_ICON, STATE_ICON, formatMinutes } from "../core/format";
import { isGhostId, isPassed, knownCandidates, recommendMaterial, sourceState } from "../core/graph";
import { ATTACHMENT_EXTENSIONS, fileFormat, materialId } from "../core/materials";
import { CONFIDENCE_LEVELS } from "../core/progress";
import type { GraphNode } from "../core/types";
import { attempt } from "../attempt";
import { locale, t } from "../i18n";
import type { Store } from "../store";
import { KnownModal, PickModal, SourceModal, type PickItem } from "./pick";

export interface DetailHost {
  app: App;
  store: Store;
  select(id: string | null): void;
  openNote(id: string, newTab?: boolean): void;
  /** True when the map does not show this concept right now: folded away or outside the focus. */
  isHidden?(id: string): boolean;
  /** Called when the person leaves the details of a selected item. */
  canGoBack: boolean;
}

function row(parent: HTMLElement, cls = "") {
  return parent.createDiv({ cls: `tropa-row ${cls}`.trim() });
}

function iconButton(parent: HTMLElement, icon: string, label: string, onClick: (event: MouseEvent) => void) {
  const button = parent.createEl("button", { cls: "tropa-icon-button clickable-icon", attr: { "aria-label": label } });
  setIcon(button, icon);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick(event);
  });
  return button;
}

function section(parent: HTMLElement, title: string, count?: number) {
  const el = parent.createDiv({ cls: "tropa-section" });
  const head = el.createDiv({ cls: "tropa-section-head" });
  head.createSpan({ text: title });
  if (count) head.createSpan({ cls: "tropa-section-count", text: String(count) });
  return el;
}

function addButton(parent: HTMLElement, label: string, onClick: () => void) {
  const button = parent.createEl("button", { cls: "tropa-add" });
  setIcon(button.createSpan(), "plus");
  button.createSpan({ text: label });
  button.addEventListener("click", onClick);
}

function stateGlyph(parent: HTMLElement, host: DetailHost, id: string) {
  const state = host.store.states.get(id) ?? "locked";
  const glyph = parent.createSpan({ cls: `tropa-glyph is-small state-${state}` });
  setIcon(glyph, STATE_ICON[state]);
}

function conceptItems(host: DetailHost, except: Set<string>): PickItem[] {
  return host.store.graph.concepts
    .filter((node) => !except.has(node.id))
    .sort((a, b) => a.title.localeCompare(b.title, locale()))
    .map((node) => ({ id: node.id, title: node.title, icon: STATE_ICON[host.store.states.get(node.id) ?? "locked"] }));
}

async function linkedConcept(host: DetailHost, item: PickItem) {
  return item.create ? (await host.store.createConcept(item.title)).path : item.id;
}

export function pickPrerequisite(host: DetailHost, node: GraphNode) {
  const { store, app } = host;
  const items = conceptItems(host, new Set([node.id, ...node.requires, ...store.graph.descendants(node.id)]));
  new PickModal(app, items, t.knowBeforePrompt({ title: node.title }), async (item) => {
    await store.addLink(node.id, "requiresKey", await linkedConcept(host, item));
  }, (name) => t.createConcept({ name })).open();
}

function pickUnlock(host: DetailHost, node: GraphNode) {
  const { store, app } = host;
  const items = conceptItems(host, new Set([node.id, ...node.requiredBy, ...store.graph.ancestors(node.id)]));
  new PickModal(app, items, t.unlocksPrompt({ title: node.title }), async (item) => {
    if (item.create) await store.createConcept(item.title, [node.id]);
    else await store.addLink(item.id, "requiresKey", node.id);
  }, (name) => t.createConcept({ name })).open();
}

function pickMaterial(host: DetailHost, node: GraphNode) {
  const { store, app } = host;
  const attached = new Set(node.taughtBy);
  const sources = store.graph.sources.filter((source) => !attached.has(source.id));
  const known = new Set(sources.map((source) => source.id));
  const items: PickItem[] = [
    ...sources.map((source) => ({
      id: source.id,
      title: source.title,
      icon: FORMAT_ICON[source.format ?? "other"],
      hint: source.format ? t.format[source.format] : undefined,
    })),
    ...app.vault
      .getMarkdownFiles()
      .filter((file) => !known.has(file.path) && !attached.has(file.path) && !store.graph.nodes.has(file.path))
      .map((file) => ({ id: file.path, title: file.basename, icon: "file", hint: t.note })),
  ];
  // Attachments go into the concept's own list: a PDF or a video needs no note to be a material.
  const attachments = new Map(
    app.vault
      .getFiles()
      .filter((file) => ATTACHMENT_EXTENSIONS.has(file.extension.toLowerCase()) && !attached.has(materialId(file.path)))
      .map((file) => [file.path, file] as const),
  );
  for (const file of attachments.values()) {
    items.push({ id: file.path, title: file.name, icon: FORMAT_ICON[fileFormat(file.path)], hint: t.attachment });
  }
  new PickModal(app, items, t.materialForPrompt({ title: node.title }), (item) => {
    const attachment = item.create ? undefined : attachments.get(item.id);
    if (attachment) {
      const link = `[[${app.metadataCache.fileToLinktext(attachment, node.id, false)}]]`;
      attempt(store.addInlineMaterial(node.id, { title: "", url: link, format: fileFormat(attachment.path) }), `attach ${item.title}`);
      return;
    }
    if (!item.create) {
      attempt(store.attachSource(item.id, node.id), `attach ${item.title}`);
      return;
    }
    new SourceModal(app, item.title, async (draft, inline) => {
      if (inline) await store.addInlineMaterial(node.id, draft);
      else await store.createSource({ ...draft, teaches: [(await store.materialize(node.id)).path] });
    }).open();
  }, (name) => t.newMaterialNamed({ name })).open();
}

/** "I know this and what it needs": the concept and its unmastered prerequisites, after a look at the list. */
export function openKnownModal(app: App, store: Store, id: string) {
  const items = knownCandidates(store.graph, store.progress, id).map((conceptId) => ({
    id: conceptId,
    title: store.graph.nodes.get(conceptId)?.title ?? conceptId,
    icon: STATE_ICON[store.states.get(conceptId) ?? "locked"],
  }));
  if (items.length) new KnownModal(app, items, (ids) => store.markKnown(ids)).open();
}

/** Five buttons; pressing the current level again clears it. */
function confidenceControl(parent: HTMLElement, store: Store, id: string) {
  const current = store.progress.confidence.get(id) ?? 0;
  const el = parent.createDiv({ cls: "tropa-confidence", attr: { role: "group", "aria-label": t.confidence } });
  el.createSpan({ cls: "tropa-confidence-label", text: t.confidence });
  for (const level of CONFIDENCE_LEVELS) {
    const dot = el.createEl("button", {
      cls: `tropa-confidence-dot${level <= current ? " is-on" : ""}`,
      attr: { "aria-label": t.confidenceLevel({ level }), "aria-pressed": String(level === current) },
    });
    dot.addEventListener("click", () => store.setConfidence(id, level === current ? null : level));
  }
}

function conceptRow(parent: HTMLElement, host: DetailHost, id: string, onRemove?: () => void) {
  const node = host.store.graph.nodes.get(id);
  if (!node) return;
  const el = row(parent, "is-link");
  el.tabIndex = 0;
  el.setAttr("role", "button");
  stateGlyph(el, host, id);
  el.createSpan({ cls: "tropa-row-title", text: node.title, attr: { dir: "auto" } });
  el.addEventListener("click", () => host.select(id));
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter") host.select(id);
  });
  if (onRemove) iconButton(el, "x", t.unlink({ title: node.title }), onRemove);
}

function materialRow(parent: HTMLElement, host: DetailHost, id: string, concept: GraphNode | null, recommended: boolean) {
  const { store } = host;
  const source = store.graph.nodes.get(id);
  if (!source) return;
  const state = sourceState(store.graph, store.progress, id);
  const el = row(parent, `tropa-material is-${state}${recommended ? " is-recommended" : ""}`);

  const check = el.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
  check.checked = state === "done";
  check.setAttr("aria-label", t.materialDone({ title: source.title }));
  check.addEventListener("change", () => store.setDone(id, check.checked));

  const body = el.createDiv({ cls: "tropa-material-body" });
  const title = body.createEl("a", { cls: "tropa-row-title", text: source.title, href: "#", attr: { dir: "auto" } });
  title.addEventListener("click", (event) => {
    event.preventDefault();
    host.openNote(id, event.ctrlKey || event.metaKey);
  });

  const meta = body.createDiv({ cls: "tropa-material-meta" });
  setIcon(meta.createSpan(), FORMAT_ICON[source.format ?? "other"]);
  const parts = [t.format[source.format ?? "other"]];
  if (source.minutes) parts.push(formatMinutes(source.minutes));
  meta.createSpan({ text: parts.join(t.listSeparator) });

  if (state === "locked") {
    const missing = source.requires
      .filter((req) => (store.graph.nodes.get(req)?.kind === "source" ? !store.progress.done.has(req) : !isPassed(store.progress, req)))
      .map((req) => store.graph.nodes.get(req)?.title)
      .join(t.listSeparator);
    body.createDiv({ cls: "tropa-material-note", text: t.first({ titles: missing }) });
  } else if (recommended) {
    body.createDiv({ cls: "tropa-material-note is-accent", text: t.startHere });
  }

  if (source.url) {
    const link = el.createEl("a", {
      cls: "tropa-icon-button clickable-icon",
      href: source.url,
      attr: { "aria-label": t.openSource, target: "_blank", rel: "noopener" },
    });
    setIcon(link, "external-link");
  }
  if (concept) iconButton(el, "x", t.detachMaterial({ title: source.title }), () => attempt(store.detachMaterial(id, concept.id), "detach a material"));
}

function header(parent: HTMLElement, host: DetailHost, node: GraphNode) {
  if (host.canGoBack) {
    const back = parent.createEl("button", { cls: "tropa-back" });
    setIcon(back.createSpan(), "arrow-left");
    back.createSpan({ text: host.store.route ? t.backToRoute : t.backToList });
    back.addEventListener("click", () => host.select(null));
  }
  const title = parent.createEl("h3", { cls: "tropa-title", attr: { dir: "auto" } });
  if (node.ghost) title.setText(node.title);
  else {
    const link = title.createEl("a", { text: node.title, href: "#" });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      host.openNote(node.id, event.ctrlKey || event.metaKey);
    });
  }
}

export function renderConcept(parent: HTMLElement, host: DetailHost, node: GraphNode) {
  const { store } = host;
  const state = store.states.get(node.id) ?? "locked";
  const isGoal = store.progress.goal === node.id;

  header(parent, host, node);

  const statusRow = parent.createDiv({ cls: "tropa-status-row" });
  const status = statusRow.createDiv({ cls: `tropa-status state-${state}` });
  setIcon(status.createSpan(), STATE_ICON[state]);
  status.createSpan({ text: t.state[state] });
  if (isGoal) {
    const goal = statusRow.createDiv({ cls: "tropa-status is-goal" });
    setIcon(goal.createSpan(), "flag");
    goal.createSpan({ text: t.yourGoal });
  }

  if (state === "mastered" || state === "learning") confidenceControl(parent, store, node.id);

  if (node.summary) parent.createEl("p", { cls: "tropa-summary", text: node.summary, attr: { dir: "auto" } });

  if (state === "skipped") parent.createEl("p", { cls: "tropa-callout", text: t.skippedCallout });
  if (state === "cycle") {
    parent.createEl("p", {
      cls: "tropa-callout is-danger",
      text: t.cycleCallout,
    });
  }
  if (node.ghost) {
    parent.createEl("p", {
      cls: "tropa-callout",
      text: t.ghostCallout,
    });
  }

  const actions = parent.createDiv({ cls: "tropa-actions" });
  const action = (label: string, cta: boolean, run: () => void) => {
    const button = actions.createEl("button", { text: label, cls: cta ? "mod-cta" : "" });
    button.addEventListener("click", run);
  };

  if (node.ghost) action(t.createNote, state !== "available", () => attempt(store.materialize(node.id), `create ${node.title}`));
  if (state === "available") {
    action(t.startLearning, true, () => store.startLearning(node.id));
    action(t.alreadyKnow, false, () => store.setMastered(node.id, true));
  } else if (state === "learning") {
    action(t.markMastered, true, () => store.setMastered(node.id, true));
  } else if (state === "locked" || state === "cycle") {
    action(t.alreadyKnow, false, () => store.setMastered(node.id, true));
  } else if (state === "skipped") {
    action(t.unskip, false, () => store.setSkipped(node.id, false));
    action(t.alreadyKnow, false, () => store.setMastered(node.id, true));
  } else {
    action(t.unmark, false, () => store.setMastered(node.id, false));
  }
  if (state !== "mastered" && knownCandidates(store.graph, store.progress, node.id).length > 1) {
    action(t.knowWithPrerequisites, false, () => openKnownModal(host.app, store, node.id));
  }
  // The goal is what the route leads to, so it cannot be skipped.
  if (state !== "mastered" && state !== "skipped" && !isGoal) action(t.skip, false, () => store.setSkipped(node.id, true));
  action(isGoal ? t.removeGoal : t.makeGoal, false, () => store.setGoal(isGoal ? null : node.id));

  const blockers = node.requires.filter((id) => !isPassed(store.progress, id));
  if (state === "locked" && blockers.length) {
    parent.createEl("p", { cls: "tropa-hint", text: t.leftToUnlock({ count: blockers.length }) });
  }

  const recommended = recommendMaterial(store.graph, store.progress, node.id);
  const materials = section(parent, t.materials, node.taughtBy.length);
  if (node.taughtBy.length === 0) {
    materials.createEl("p", { cls: "tropa-hint", text: t.nothingToLearnFrom });
  }
  const showRecommended = state !== "mastered" && node.taughtBy.length > 1;
  // The order stays fixed: rows must not jump under the cursor when one is ticked.
  for (const id of node.taughtBy) materialRow(materials, host, id, node, showRecommended && id === recommended);
  addButton(materials, t.addMaterial, () => pickMaterial(host, node));

  const requires = section(parent, t.knowBefore, node.requires.length);
  for (const id of node.requires) {
    conceptRow(requires, host, id, node.ghost ? undefined : () => attempt(store.removeLink(node.id, "requiresKey", id), "remove a link"));
  }
  addButton(requires, t.addPrerequisite, () => pickPrerequisite(host, node));

  const unlocks = section(parent, t.unlocks, node.requiredBy.length);
  for (const id of node.requiredBy) {
    const dependent = store.graph.nodes.get(id);
    if (dependent?.kind === "concept") {
      conceptRow(unlocks, host, id, isGhostId(id) ? undefined : () => attempt(store.removeLink(id, "requiresKey", node.id), "remove a link"));
    }
  }
  addButton(unlocks, t.addNextConcept, () => pickUnlock(host, node));

  if (node.recommends.length) {
    const soft = section(parent, t.goodToKnow, node.recommends.length);
    for (const id of node.recommends) conceptRow(soft, host, id);
  }
}

export function renderSource(parent: HTMLElement, host: DetailHost, node: GraphNode) {
  const { store } = host;
  const state = sourceState(store.graph, store.progress, node.id);
  header(parent, host, node);

  const status = parent.createDiv({ cls: "tropa-status" });
  setIcon(status.createSpan(), FORMAT_ICON[node.format ?? "other"]);
  const parts = [t.format[node.format ?? "other"]];
  if (node.minutes) parts.push(formatMinutes(node.minutes));
  status.createSpan({ text: parts.join(t.listSeparator) });

  if (node.summary) parent.createEl("p", { cls: "tropa-summary", text: node.summary, attr: { dir: "auto" } });
  if (node.inline) parent.createEl("p", { cls: "tropa-hint", text: t.inlineMaterialHint });

  const actions = parent.createDiv({ cls: "tropa-actions" });
  const done = actions.createEl("button", {
    text: state === "done" ? t.markNotDone : t.markDone,
    cls: state === "done" ? "" : "mod-cta",
  });
  done.addEventListener("click", () => store.setDone(node.id, state !== "done"));
  if (node.url) {
    actions.createEl("a", { cls: "tropa-link-button", text: t.openSource, href: node.url, attr: { target: "_blank", rel: "noopener" } });
  }

  const teaches = section(parent, t.teaches, node.teaches.length);
  for (const id of node.teaches) conceptRow(teaches, host, id, () => attempt(store.detachMaterial(node.id, id), "detach a material"));
  addButton(teaches, t.addConcept, () => {
    const items = conceptItems(host, new Set(node.teaches));
    new PickModal(host.app, items, t.teachesPrompt({ title: node.title }), async (item) => {
      const concept = await linkedConcept(host, item);
      if (node.inline) await store.copyInlineMaterial(node.id, concept);
      else await store.addLink(node.id, "teachesKey", concept);
    }, (name) => t.createConcept({ name })).open();
  });

  if (node.requires.length) {
    const requires = section(parent, t.neededBefore, node.requires.length);
    for (const id of node.requires) {
      const target = store.graph.nodes.get(id);
      if (target?.kind === "concept") conceptRow(requires, host, id, () => attempt(store.removeLink(node.id, "requiresKey", id), "remove a link"));
      else if (target) materialRow(requires, host, id, null, false);
    }
  }
}

/** The default state of a panel: what to do next. */
export function renderRoute(parent: HTMLElement, host: DetailHost, pickGoal: () => void) {
  const { store } = host;
  const { route, graph } = store;

  for (const cycle of graph.cycles) {
    const callout = parent.createDiv({ cls: "tropa-callout is-danger" });
    callout.createEl("strong", { text: t.cycleTitle });
    callout.createEl("p", { text: t.cycleText });
    for (const id of cycle) conceptRow(callout, host, id);
  }

  if (store.excludedGoal) parent.createEl("p", { cls: "tropa-callout", text: t.scope.goalExcludedHint });

  if (!route) {
    const available = graph.concepts.filter((node) => store.states.get(node.id) === "available");
    parent.createEl("h3", { cls: "tropa-title", text: t.whereTo });
    parent.createEl("p", {
      cls: "tropa-hint",
      text: t.whereToHint,
    });
    const button = parent.createEl("button", { cls: "mod-cta tropa-wide", text: t.chooseGoal });
    button.addEventListener("click", pickGoal);
    if (available.length) {
      const list = section(parent, t.startNow, available.length);
      for (const node of available) conceptRow(list, host, node.id);
    }
    return;
  }

  const goal = graph.nodes.get(route.goal)!;
  if (route.steps.length === 0) {
    parent.createEl("h3", { cls: "tropa-title", text: t.goalReached });
    parent.createEl("p", { cls: "tropa-hint", text: t.goalReachedText({ title: goal.title }) });
    const button = parent.createEl("button", { cls: "mod-cta tropa-wide", text: t.chooseGoal });
    button.addEventListener("click", pickGoal);
    return;
  }

  const left = route.steps.length;
  parent.createEl("h3", { cls: "tropa-title", text: t.stepsToGoal({ count: left }) });
  parent.createEl("p", { cls: "tropa-hint", text: t.remainingLine({ remaining: store.describeRemaining(), goal: goal.title }) });
  if (route.skippedCount) parent.createEl("p", { cls: "tropa-hint", text: t.skippedCount({ count: route.skippedCount }) });

  if (route.gaps.length) {
    parent.createEl("p", { cls: "tropa-hint is-warning", text: t.gaps({ count: route.gaps.length }) });
  }

  const list = parent.createEl("ol", { cls: "tropa-steps" });
  route.steps.forEach((step) => {
    const node = graph.nodes.get(step.id)!;
    const isNext = step.id === route.next;
    const hidden = host.isHidden?.(step.id) ?? false;
    const item = list.createEl("li", { cls: `tropa-step state-${step.state}${isNext ? " is-next" : ""}${hidden ? " is-hidden-on-map" : ""}` });
    item.tabIndex = 0;
    item.setAttr("role", "button");
    item.addEventListener("click", () => host.select(step.id));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter") host.select(step.id);
    });
    item.createDiv({ cls: "tropa-step-title", text: node.title, attr: { dir: "auto" } });
    if (hidden) {
      const mark = item.createSpan({ cls: "tropa-step-hidden", attr: { title: t.hiddenOnMap } });
      setIcon(mark, "eye-off");
      item.setAttr("aria-description", t.hiddenOnMap);
    }
    const material = step.material ? graph.nodes.get(step.material) : null;
    if (material && (isNext || step.state === "learning")) {
      const meta = item.createDiv({ cls: "tropa-step-meta" });
      meta.createEl("bdi", { text: material.title });
      if (material.minutes) {
        meta.createSpan({ text: t.listSeparator });
        meta.createSpan({ cls: "tropa-nowrap", text: formatMinutes(material.minutes) });
      }
    } else if (!material && node.taughtBy.length === 0) {
      item.createDiv({ cls: "tropa-step-meta", text: t.noMaterials });
    }
  });
}
