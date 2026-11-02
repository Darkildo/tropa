import { PluginSettingTab, type App, type SettingDefinitionItem, type SettingGroupItem } from "obsidian";
import { t } from "./i18n";
import type TropaPlugin from "./main";

const FILES = ["progressPath", "conceptsFolder", "sourcesFolder"] as const;
const PROPERTIES = ["typeKey", "requiresKey", "recommendsKey", "teachesKey", "materialsKey"] as const;
type TextSetting = (typeof FILES)[number] | (typeof PROPERTIES)[number];

const TEXT_SETTINGS: readonly string[] = [...FILES, ...PROPERTIES];
const isTextSetting = (key: string): key is TextSetting => TEXT_SETTINGS.includes(key);

/** Declarative settings (Obsidian 1.13+): rendered by the app and found by settings search. */
export class TropaSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TropaPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem<TextSetting>[] {
    return [
      { type: "group", heading: t.settings.files, items: FILES.map((key) => this.text(key)) },
      {
        type: "group",
        heading: t.settings.properties,
        items: [{ name: t.settings.ownMarkup, desc: t.settings.propertiesDesc, searchable: false }, ...PROPERTIES.map((key) => this.text(key))],
      },
    ];
  }

  getControlValue(key: string): unknown {
    return isTextSetting(key) ? this.plugin.settings[key] : undefined;
  }

  /** An empty field falls back to the default. Names and paths change what counts as the graph, so it is read again. */
  async setControlValue(key: string, value: unknown) {
    if (!isTextSetting(key)) return;
    this.plugin.settings[key] = (typeof value === "string" ? value.trim() : "") || this.plugin.defaults[key];
    await this.plugin.saveSettings();
    this.plugin.store.rebuild(true);
  }

  private text(key: TextSetting): SettingGroupItem<TextSetting> {
    return {
      name: t.settings[key],
      desc: t.settings[`${key}Desc`],
      control: { type: "text", key, placeholder: this.plugin.defaults[key] },
    };
  }
}
