import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { en } from "../src/i18n/en";
import { ru } from "../src/i18n/ru";
import type { Lang } from "../src/i18n";
import { sample } from "../src/sample";
import { defaultSettings } from "../src/defaults";

const START: Record<Lang, { name: string; text: string }> = {
  en: {
    name: "Start here.md",
    text: `# Tropa\n\nOpen the map with the route icon in the left ribbon or with the command “Tropa: ${en.mapTitle}”.\n\nTry this:\n\n1. Choose another goal in the top left corner of the map.\n2. Click a concept and mark it as mastered.\n3. Drag from the dot on the bottom edge of a concept to another concept.\n4. Open the sidebar with “Tropa: ${en.openPanel}” and look at this note.\n`,
  },
  ru: {
    name: "Начните здесь.md",
    text: `# Tropa\n\nОткройте карту значком маршрута на левой панели или командой «Tropa: ${ru.mapTitle}».\n\nПопробуйте:\n\n1. Выбрать другую цель в левом верхнем углу карты.\n2. Нажать на концепт и отметить его освоенным.\n3. Потянуть от точки на нижнем краю концепта к другому концепту.\n4. Открыть боковую панель командой «Tropa: ${ru.openPanel}» и посмотреть эту заметку.\n`,
  },
};

function makeVault(vault: string, language: Lang) {
  rmSync(vault, { recursive: true, force: true });
  const write = (path: string, content: string) => {
    const target = join(vault, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };

  const example = sample(language);
  const settings = defaultSettings(language);
  const text = language === "ru" ? ru : en;
  for (const { path, content } of example.files) write(path, content);

  const links = (paths: string[]) => paths.map((path) => `  - "[[${path}]]"`).join("\n");
  write(
    settings.progressPath,
    `---\ntype: learning-progress\ngoal: "[[${example.goal}]]"\nmastered:\n${links(example.mastered)}\nlearning: []\ndone: []\n---\n\n${text.progressFileText}\n`,
  );
  write(START[language].name, START[language].text);
  write(".obsidian/community-plugins.json", JSON.stringify(["tropa"]));
  write(".obsidian/app.json", "{}\n");
  write(".obsidian/plugins/tropa/data.json", `${JSON.stringify(settings, null, 2)}\n`);
  for (const file of ["main.js", "manifest.json", "styles.css"]) copyFileSync(file, join(vault, ".obsidian/plugins/tropa", file));
  console.log(`Demo vault: ${vault}`);
}

makeVault(process.argv[2] ?? "dist/Tropa Demo", "en");
makeVault(process.argv[3] ?? "dist/Tropa Demo RU", "ru");
