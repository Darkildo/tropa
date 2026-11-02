import { App, PluginSettingTab, Setting } from "obsidian";
import { t } from "./i18n";
import type TropaPlugin from "./main";

type TextSetting = "progressPath" | "conceptsFolder" | "sourcesFolder" | "typeKey" | "requiresKey" | "recommendsKey" | "teachesKey";

export class TropaSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TropaPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName(t.settings.files).setHeading();
    this.text("progressPath");
    this.text("conceptsFolder");
    this.text("sourcesFolder");

    new Setting(containerEl).setName(t.settings.properties).setDesc(t.settings.propertiesDesc).setHeading();
    this.text("typeKey");
    this.text("requiresKey");
    this.text("recommendsKey");
    this.text("teachesKey");
  }

  private text(key: TextSetting) {
    const fallback = String(this.plugin.defaults[key]);
    new Setting(this.containerEl)
      .setName(t.settings[key])
      .setDesc(t.settings[`${key}Desc`])
      .addText((text) =>
        text
          .setPlaceholder(fallback)
          .setValue(String(this.plugin.settings[key]))
          .onChange(async (value) => {
            (this.plugin.settings[key] as string) = value.trim() || fallback;
            await this.plugin.saveSettings();
            this.plugin.store.rebuild(true);
          }),
      );
  }
}
