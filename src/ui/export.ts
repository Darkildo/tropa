import { Modal, Setting, type App } from "obsidian";
import { attempt } from "../attempt";
import { exportPath, freePath } from "../core/export-path";
import { isRtl, t } from "../i18n";

export interface ExportRequest {
  title: string;
  path: string;
  extension: "canvas" | "svg";
  /** Offer to color nodes by progress; the canvas can be shared, so this is a choice. */
  offerProgress: boolean;
  exists: (path: string) => boolean;
  save: (path: string, withProgress: boolean, replace: boolean) => Promise<void>;
}

/** Where to save an export. An existing file is only replaced when the person says so. */
export class ExportModal extends Modal {
  private path: string;
  private withProgress = true;

  constructor(app: App, private readonly request: ExportRequest) {
    super(app);
    if (isRtl()) this.modalEl.dir = "rtl";
    this.path = request.path;
  }

  onOpen() {
    const { contentEl, request } = this;
    this.setTitle(request.title);
    contentEl.addClass("tropa-export-modal");
    let input: HTMLInputElement | undefined;
    const pathSetting = new Setting(contentEl)
      .setName(t.exportPath)
      .setDesc(t.exportPathDesc)
      .addText((text) => {
        input = text.inputEl;
        text.inputEl.addClass("tropa-export-path");
        text.inputEl.dir = "auto";
        text.setValue(this.path).onChange((value) => {
          this.path = value;
          refresh();
        });
        window.setTimeout(() => text.inputEl.focus());
      });
    pathSetting.settingEl.addClass("tropa-export-path-setting");
    if (request.offerProgress) {
      new Setting(contentEl)
        .setName(t.exportProgress)
        .setDesc(t.exportProgressDesc)
        .addToggle((toggle) => toggle.setValue(this.withProgress).onChange((value) => (this.withProgress = value)));
    }
    const warning = contentEl.createDiv({ cls: "tropa-hint is-warning tropa-export-exists", attr: { role: "alert" } });
    const actions = contentEl.createDiv({ cls: "tropa-actions" });
    const save = actions.createEl("button", { cls: "mod-cta tropa-export-save" });
    const rename = actions.createEl("button", { cls: "tropa-export-rename", text: t.exportKeepBoth });
    const cancel = actions.createEl("button", { text: t.cancel });

    const refresh = () => {
      const path = this.target();
      const exists = path !== null && request.exists(path);
      warning.textContent = path === null ? t.exportPathInvalid : exists ? t.exportExists({ path }) : "";
      warning.toggleClass("is-hidden", warning.textContent === "");
      save.textContent = exists ? t.exportReplace : t.exportSave;
      save.toggleClass("mod-warning", exists);
      save.toggleClass("mod-cta", !exists);
      save.disabled = path === null;
      rename.toggleClass("is-hidden", !exists);
    };
    save.addEventListener("click", () => {
      const path = this.target();
      if (path === null) return;
      const replace = request.exists(path);
      this.close();
      attempt(request.save(path, this.withProgress, replace), `export to ${path}`);
    });
    rename.addEventListener("click", () => {
      const path = this.target();
      if (path === null || !input) return;
      this.path = freePath(path, request.exists);
      input.value = this.path;
      refresh();
    });
    cancel.addEventListener("click", () => this.close());
    contentEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target === input) save.click();
    });
    refresh();
  }

  onClose() {
    this.contentEl.empty();
  }

  /** The path as typed, inside the vault and with the right extension, or null when it cannot be one. */
  private target() {
    return exportPath(this.path, this.request.extension);
  }
}
