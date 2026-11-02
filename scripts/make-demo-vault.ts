import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sampleFiles, SAMPLE_FOLDER, SAMPLE_GOAL, SAMPLE_MASTERED } from "../src/sample";

const vault = process.argv[2] ?? "dist/Tropa Demo";
rmSync(vault, { recursive: true, force: true });

const write = (path: string, content: string) => {
  const target = join(vault, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
};

for (const { path, content } of sampleFiles()) write(path, content);

const links = (titles: string[]) => titles.map((title) => `  - "[[${SAMPLE_FOLDER}/Концепты/${title}]]"`).join("\n");
write(
  "Tropa/Прогресс.md",
  `---\ntype: learning-progress\ngoal: "[[${SAMPLE_FOLDER}/Концепты/${SAMPLE_GOAL}]]"\nmastered:\n${links(SAMPLE_MASTERED)}\nlearning: []\ndone: []\n---\n\nЭтот файл ведёт плагин Tropa: здесь хранятся ваша цель и отметки об освоении.\n`,
);
write(
  "Начните здесь.md",
  `# Tropa\n\nОткройте карту значком маршрута на левой панели или командой «Tropa: Открыть карту обучения».\n\nПопробуйте:\n\n1. Выбрать другую цель в левом верхнем углу карты.\n2. Нажать на концепт и отметить его освоенным.\n3. Потянуть от точки на нижнем краю концепта к другому концепту.\n4. Открыть боковую панель командой «Tropa: Открыть боковую панель» и посмотреть эту заметку.\n`,
);
write(".obsidian/community-plugins.json", JSON.stringify(["tropa"]));
write(".obsidian/app.json", "{}\n");

for (const file of ["main.js", "manifest.json", "styles.css"]) {
  const target = join(vault, ".obsidian/plugins/tropa", file);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(file, target);
}
console.log(`Demo vault: ${vault}`);
