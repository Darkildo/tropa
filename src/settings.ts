import { Notice, PluginSettingTab, type App, type SettingDefinitionItem, type SettingGroupItem } from "obsidian";
import { inFolders, parseFolders, parseTags } from "./core/scope";
import { t } from "./i18n";
import type TropaPlugin from "./main";

const FILES = ["progressPath", "conceptsFolder", "sourcesFolder"] as const;
const PROPERTIES = ["typeKey", "requiresKey", "recommendsKey", "teachesKey", "materialsKey"] as const;
const SCOPE = ["excludeFolders", "excludeTags"] as const;
type TextSetting = (typeof FILES)[number] | (typeof PROPERTIES)[number] | "journalFolder";
type ScopeSetting = (typeof SCOPE)[number];
type Key = TextSetting | ScopeSetting | "journal";

const TEXT_SETTINGS: readonly string[] = [...FILES, ...PROPERTIES, "journalFolder"];
const isTextSetting = (key: string): key is TextSetting => TEXT_SETTINGS.includes(key);
const isScopeSetting = (key: string): key is ScopeSetting => (SCOPE as readonly string[]).includes(key);

/** Declarative settings (Obsidian 1.13+): rendered by the app and found by settings search. */
export class TropaSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TropaPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem<Key>[] {
    return [
      { type: "group", heading: t.settings.files, items: FILES.map((key) => this.text(key)) },
      {
        type: "group",
        heading: t.settings.properties,
        items: [{ name: t.settings.ownMarkup, desc: t.settings.propertiesDesc, searchable: false }, ...PROPERTIES.map((key) => this.text(key))],
      },
      { type: "group", heading: t.settings.scope, items: SCOPE.map((key) => this.list(key)) },
      {
        type: "group",
        heading: t.settings.journalGroup,
        items: [
          { name: t.settings.journal, desc: t.settings.journalDesc, control: { type: "toggle", key: "journal" } },
          this.text("journalFolder"),
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    if (key === "journal") return this.plugin.settings.journal;
    if (isScopeSetting(key)) return this.plugin.settings[key].map((value) => (key === "excludeTags" ? `#${value}` : value)).join("\n");
    return isTextSetting(key) ? this.plugin.settings[key] : undefined;
  }

  /** An empty field falls back to the default. Names, paths and scope change what counts as the graph, so it is read again. */
  async setControlValue(key: string, value: unknown) {
    if (key === "journal") {
      this.plugin.settings.journal = value === true || value === "true";
      await this.plugin.saveSettings();
      return;
    }
    if (isScopeSetting(key)) this.plugin.settings[key] = key === "excludeTags" ? parseTags(value) : parseFolders(value);
    else if (isTextSetting(key)) this.plugin.settings[key] = (typeof value === "string" ? value.trim() : "") || this.plugin.defaults[key];
    else return;
    await this.plugin.saveSettings();
    this.plugin.store.rebuild(true);
    if (key === "excludeFolders") this.warnOwnFolders();
    if (key === "journalFolder") await this.plugin.journal.load();
  }

  /** Concepts and materials made from the map would land in an excluded folder and vanish from it. */
  private warnOwnFolders() {
    const { settings } = this.plugin;
    for (const folder of new Set([settings.conceptsFolder, settings.sourcesFolder])) {
      if (inFolders(folder, settings.excludeFolders)) new Notice(t.scope.ownFolderExcluded({ folder }));
    }
  }

  private text(key: TextSetting): SettingGroupItem<Key> {
    return {
      name: t.settings[key],
      desc: t.settings[`${key}Desc`],
      control: { type: "text", key, placeholder: this.plugin.defaults[key] },
    };
  }

  /** One entry per line: folder names may contain commas, and a list reads better than a long line. */
  private list(key: ScopeSetting): SettingGroupItem<Key> {
    return {
      name: t.settings[key],
      desc: t.settings[`${key}Desc`],
      control: { type: "textarea", key, rows: 3, placeholder: t.settings[`${key}Placeholder`] },
    };
  }
}
