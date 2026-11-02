import type { SourceFormat } from "./core/types";

export const SAMPLE_FOLDER = "Tropa/Пример";
export const SAMPLE_GOAL = "Трансформер";
export const SAMPLE_MASTERED = ["Производная", "Векторы и матрицы", "Python и NumPy"];

interface SampleConcept {
  title: string;
  requires?: string[];
  recommends?: string[];
  summary: string;
}

interface SampleSource {
  title: string;
  format: SourceFormat;
  minutes: number;
  url?: string;
  teaches: string[];
  requires?: string[];
}

const concepts: SampleConcept[] = [
  { title: "Векторы и матрицы", summary: "Язык, на котором записаны данные и веса нейросети." },
  { title: "Производная", summary: "Как быстро меняется функция при малом изменении входа." },
  { title: "Вероятность", summary: "Распределения, условная вероятность и ожидание." },
  { title: "Python и NumPy", summary: "Минимум кода, чтобы проверять идеи на практике." },
  { title: "Цепное правило", requires: ["Производная"], summary: "Производная сложной функции. Основа обратного распространения." },
  { title: "Градиент", requires: ["Производная", "Векторы и матрицы"], summary: "Направление самого быстрого роста функции многих переменных." },
  { title: "Градиентный спуск", requires: ["Градиент"], summary: "Обучение как движение вниз по функции потерь." },
  { title: "Функция потерь", requires: ["Вероятность"], summary: "Число, которое показывает, насколько модель ошибается." },
  { title: "Линейная регрессия", requires: ["Векторы и матрицы", "Функция потерь", "Python и NumPy"], summary: "Простейшая обучаемая модель." },
  { title: "Логистическая регрессия", requires: ["Линейная регрессия", "Вероятность"], summary: "Классификация и связь с одним нейроном." },
  { title: "Нейрон и слои", requires: ["Логистическая регрессия"], summary: "Как из простых элементов собирается сеть." },
  { title: "Обратное распространение", requires: ["Цепное правило", "Нейрон и слои", "Градиентный спуск"], summary: "Как эффективно посчитать градиент по всем весам сети." },
  { title: "Обучение сети на практике", requires: ["Обратное распространение"], summary: "Батчи, переобучение, регуляризация и отладка." },
  { title: "Эмбеддинги", requires: ["Обучение сети на практике"], summary: "Представление слов и объектов векторами." },
  { title: "Токенизация", requires: ["Python и NumPy"], summary: "Как текст превращается в последовательность чисел." },
  { title: "Рекуррентные сети", requires: ["Обучение сети на практике"], summary: "Модели последовательностей до появления трансформеров." },
  { title: "Механизм внимания", requires: ["Эмбеддинги", "Векторы и матрицы"], recommends: ["Рекуррентные сети"], summary: "Как модель выбирает, на какие части входа смотреть." },
  { title: "Трансформер", requires: ["Механизм внимания", "Токенизация"], summary: "Архитектура, лежащая в основе современных языковых моделей." },
  { title: "Свёрточные сети", requires: ["Обучение сети на практике"], summary: "Сети для изображений. Не нужны для цели, но остаются на карте." },
  { title: "Дообучение моделей", requires: ["Трансформер"], summary: "Как адаптировать готовую модель под свою задачу." },
];

const sources: SampleSource[] = [
  { title: "3Blue1Brown, Essence of linear algebra", format: "video", minutes: 180, url: "https://www.3blue1brown.com/topics/linear-algebra", teaches: ["Векторы и матрицы"] },
  { title: "3Blue1Brown, Essence of calculus", format: "video", minutes: 210, url: "https://www.3blue1brown.com/topics/calculus", teaches: ["Производная", "Цепное правило"] },
  { title: "3Blue1Brown, Neural networks", format: "video", minutes: 150, url: "https://www.3blue1brown.com/topics/neural-networks", teaches: ["Нейрон и слои", "Градиентный спуск", "Обратное распространение", "Механизм внимания"], requires: ["Цепное правило"] },
  { title: "NumPy quickstart", format: "article", minutes: 60, url: "https://numpy.org/doc/stable/user/quickstart.html", teaches: ["Python и NumPy"] },
  { title: "Deep Learning, глава 3", format: "book", minutes: 180, url: "https://www.deeplearningbook.org/", teaches: ["Вероятность"] },
  { title: "Dive into Deep Learning", format: "book", minutes: 1500, url: "https://d2l.ai/", teaches: ["Линейная регрессия", "Логистическая регрессия", "Функция потерь", "Обучение сети на практике", "Рекуррентные сети", "Свёрточные сети"] },
  { title: "Мой конспект про градиент", format: "note", minutes: 20, teaches: ["Градиент"] },
  { title: "Andrej Karpathy, Neural Networks: Zero to Hero", format: "course", minutes: 900, url: "https://karpathy.ai/zero-to-hero.html", teaches: ["Обратное распространение", "Обучение сети на практике", "Эмбеддинги", "Токенизация", "Трансформер"], requires: ["Python и NumPy"] },
  { title: "The Illustrated Transformer", format: "article", minutes: 45, url: "https://jalammar.github.io/illustrated-transformer/", teaches: ["Трансформер"], requires: ["Механизм внимания"] },
  { title: "Attention Is All You Need", format: "paper", minutes: 120, url: "https://arxiv.org/abs/1706.03762", teaches: ["Трансформер"], requires: ["The Illustrated Transformer"] },
  { title: "CS231n, Convolutional Neural Networks", format: "course", minutes: 600, url: "https://cs231n.github.io/", teaches: ["Свёрточные сети"] },
  { title: "Hugging Face, LLM Course", format: "course", minutes: 600, url: "https://huggingface.co/learn/llm-course", teaches: ["Дообучение моделей", "Токенизация"] },
];

const list = (key: string, titles: string[] = []) =>
  titles.length ? `${key}:\n${titles.map((title) => `  - "[[${title}]]"`).join("\n")}\n` : `${key}: []\n`;

export function sampleFiles() {
  const files = concepts.map((concept) => ({
    path: `${SAMPLE_FOLDER}/Концепты/${concept.title}.md`,
    content: `---\ntype: concept\n${list("requires", concept.requires)}${concept.recommends ? list("recommends", concept.recommends) : ""}summary: ${concept.summary}\n---\n\n${concept.summary}\n`,
  }));
  for (const source of sources) {
    const url = source.url ? `url: ${source.url}\n` : "";
    const requires = source.requires ? list("requires", source.requires) : "";
    files.push({
      path: `${SAMPLE_FOLDER}/Материалы/${source.title}.md`,
      content: `---\ntype: source\nformat: ${source.format}\nminutes: ${source.minutes}\n${url}${list("teaches", source.teaches)}${requires}---\n\n${source.url ?? "Личный конспект. Подойдёт любая заметка из вашего хранилища."}\n`,
    });
  }
  return files;
}
