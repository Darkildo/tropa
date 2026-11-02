import { App, PluginSettingTab, Setting } from "obsidian";
import type TropaPlugin from "./main";

export type MapMode = "route" | "all";

export interface TropaSettings {
  typeKey: string;
  requiresKey: string;
  recommendsKey: string;
  teachesKey: string;
  progressPath: string;
  conceptsFolder: string;
  sourcesFolder: string;
  mapMode: MapMode;
  showSources: boolean;
}

export const DEFAULT_SETTINGS: TropaSettings = {
  typeKey: "type",
  requiresKey: "requires",
  recommendsKey: "recommends",
  teachesKey: "teaches",
  progressPath: "Tropa/Прогресс.md",
  conceptsFolder: "Tropa/Концепты",
  sourcesFolder: "Tropa/Материалы",
  mapMode: "route",
  showSources: false,
};

export class TropaSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TropaPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Файлы").setHeading();
    this.text("Файл прогресса", "Личная часть: цель и отметки об освоении. Концепты и материалы в нём не хранятся, поэтому карту можно передать другому человеку без вашего прогресса.", "progressPath");
    this.text("Папка концептов", "Сюда попадают концепты, созданные из карты.", "conceptsFolder");
    this.text("Папка материалов", "Сюда попадают материалы, созданные из карты.", "sourcesFolder");

    new Setting(containerEl)
      .setName("Свойства заметок")
      .setDesc("Если в хранилище уже есть своя разметка, укажите её названия.")
      .setHeading();
    this.text("Тип заметки", "Значения свойства: concept или source.", "typeKey");
    this.text("Обязательная связь", "Что нужно знать до этой заметки.", "requiresKey");
    this.text("Желательная связь", "Полезно, но не закрывает доступ.", "recommendsKey");
    this.text("Чему учит материал", "Концепты, которые раскрывает материал.", "teachesKey");
  }

  private text(name: string, desc: string, key: keyof TropaSettings) {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) =>
        text
          .setPlaceholder(String(DEFAULT_SETTINGS[key]))
          .setValue(String(this.plugin.settings[key]))
          .onChange(async (value) => {
            (this.plugin.settings[key] as string) = value.trim() || String(DEFAULT_SETTINGS[key]);
            await this.plugin.saveSettings();
            this.plugin.store.rebuild(true);
          }),
      );
  }
}
