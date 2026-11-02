import type { Lang } from "./i18n";

export type MapMode = "route" | "all";

export interface TropaSettings {
  typeKey: string;
  requiresKey: string;
  recommendsKey: string;
  teachesKey: string;
  materialsKey: string;
  progressPath: string;
  conceptsFolder: string;
  sourcesFolder: string;
  mapMode: MapMode;
  showSources: boolean;
}

const FOLDERS: Record<Lang, Pick<TropaSettings, "progressPath" | "conceptsFolder" | "sourcesFolder">> = {
  en: { progressPath: "Tropa/Progress.md", conceptsFolder: "Tropa/Concepts", sourcesFolder: "Tropa/Materials" },
  ru: { progressPath: "Tropa/Прогресс.md", conceptsFolder: "Tropa/Концепты", sourcesFolder: "Tropa/Материалы" },
};

/** Paths depend on the language, so they are fixed in the saved settings on first launch. */
export function defaultSettings(language: Lang): TropaSettings {
  return {
    typeKey: "type",
    requiresKey: "requires",
    recommendsKey: "recommends",
    teachesKey: "teaches",
    materialsKey: "materials",
    ...FOLDERS[language],
    mapMode: "route",
    showSources: false,
  };
}

/** Vaults set up before translation have Russian paths but no saved settings. */
export const LEGACY_PROGRESS = FOLDERS.ru.progressPath;
