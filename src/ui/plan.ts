import { Modal, Notice, Setting, type App } from "obsidian";
import { allGoalsOf } from "../core/graph";
import { parsePace } from "../core/plan";
import { isDate } from "../core/progress";
import { isRtl, t } from "../i18n";
import type { Store } from "../store";

/** Hours a week for the whole route and a deadline for each goal. */
export class PlanModal extends Modal {
  private pace: string;
  private readonly deadlines: Map<string, string>;

  constructor(app: App, private readonly store: Store) {
    super(app);
    if (isRtl()) this.modalEl.dir = "rtl";
    this.pace = store.progress.paceHours ? String(store.progress.paceHours) : "";
    this.deadlines = new Map(store.progress.deadlines);
  }

  onOpen() {
    this.setTitle(t.plan.title);
    const { contentEl, store } = this;
    contentEl.addClass("tropa-plan");
    contentEl.createEl("p", { cls: "setting-item-description", text: t.plan.intro });

    new Setting(contentEl)
      .setName(t.plan.pace)
      .setDesc(t.plan.paceDesc)
      .addText((text) => {
        text.inputEl.inputMode = "decimal";
        text.inputEl.addClass("tropa-plan-pace");
        text.setPlaceholder("5").setValue(this.pace).onChange((value) => (this.pace = value));
        window.setTimeout(() => text.inputEl.focus());
      });

    const goals = allGoalsOf(store.progress).filter((id) => store.graph.nodes.has(id));
    for (const id of goals) {
      const title = store.graph.nodes.get(id)!.title;
      const setting = new Setting(contentEl)
        .setName(goals.length > 1 ? t.plan.deadlineFor({ title }) : t.plan.deadline)
        .setDesc(t.plan.deadlineDesc)
        .addText((text) => {
          text.inputEl.type = "date";
          text.inputEl.addClass("tropa-plan-deadline");
          text.inputEl.dataset.goal = id;
          text.setValue(this.deadlines.get(id) ?? "").onChange((value) => {
            if (value && isDate(value)) this.deadlines.set(id, value);
            else this.deadlines.delete(id);
          });
        });
      setting.nameEl.setAttr("dir", "auto");
    }

    new Setting(contentEl).addButton((button) =>
      button.setButtonText(t.plan.save).setCta().onClick(() => {
        const pace = parsePace(this.pace);
        if (Number.isNaN(pace)) {
          new Notice(t.plan.paceInvalid);
          return;
        }
        this.close();
        store.setPlan(pace, this.deadlines);
      }),
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
