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
  /** Folders left out of the map, with everything below them. */
  excludeFolders: string[];
  /** Tags left out of the map, nested tags included. Stored without `#`, in lower case. */
  excludeTags: string[];
  /** Append every change of progress to the learning journal. */
  journal: boolean;
  /** One file per month and device goes here. */
  journalFolder: string;
  /** Bring mastered concepts back for review (FSRS). Works only with the journal. */
  review: boolean;
  /** Target recall: a concept is due when the chance to recall it falls below this. */
  retention: number;
  /** Where marks with no date in the journal start, set once when review is first on. */
  reviewSince?: string;
  reviewSpread?: number;
  /** Reviews a day, 0 for no limit; the rest wait for the next days. */
  reviewLimit: number;
  /** Move a rated concept's next review by a few days to a less busy one. */
  reviewBalance: boolean;
  /** Self-check questions are callouts of this type in a concept's note. */
  checkCallout: string;
  /** Marking a concept with questions mastered first offers a self-check. */
  offerCheck: boolean;
  /** The map audit also lists concepts without questions. */
  auditQuestions: boolean;
  mapMode: MapMode;
  showSources: boolean;
}

type Paths = "progressPath" | "conceptsFolder" | "sourcesFolder" | "journalFolder";

const FOLDERS: Record<Lang, Pick<TropaSettings, Paths>> = {
  en: { progressPath: "Tropa/Progress.md", conceptsFolder: "Tropa/Concepts", sourcesFolder: "Tropa/Materials", journalFolder: "Tropa/Journal" },
  ru: { progressPath: "Tropa/Прогресс.md", conceptsFolder: "Tropa/Концепты", sourcesFolder: "Tropa/Материалы", journalFolder: "Tropa/Журнал" },
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
    excludeFolders: [],
    excludeTags: [],
    journal: true,
    review: true,
    retention: 0.9,
    reviewLimit: 20,
    reviewBalance: true,
    checkCallout: "question",
    offerCheck: true,
    auditQuestions: false,
    mapMode: "route",
    showSources: false,
  };
}

/** Vaults set up before translation have Russian paths but no saved settings. */
export const LEGACY_PROGRESS = FOLDERS.ru.progressPath;
