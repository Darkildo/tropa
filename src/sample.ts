import type { SourceFormat } from "./core/types";
import type { Lang } from "./i18n";

type Text = Record<Lang, string>;

interface SampleConcept {
  title: Text;
  requires?: string[];
  recommends?: string[];
  summary: Text;
  /** Materials listed in the concept itself, as YAML entries of its `materials` property. */
  materials?: Partial<Record<Lang, string[]>>;
}

interface SampleSource {
  title: Text;
  format: SourceFormat;
  minutes: number;
  url?: string;
  teaches: string[];
  requires?: string[];
}

const same = (title: string): Text => ({ en: title, ru: title });

const concepts: Record<string, SampleConcept> = {
  vectors: {
    title: { en: "Vectors and matrices", ru: "Векторы и матрицы" },
    summary: { en: "The language of data and neural network weights.", ru: "Язык, на котором записаны данные и веса нейросети." },
  },
  derivative: {
    title: { en: "Derivatives", ru: "Производная" },
    summary: { en: "How fast a function changes when its input changes a little.", ru: "Как быстро меняется функция при малом изменении входа." },
  },
  probability: {
    title: { en: "Probability", ru: "Вероятность" },
    summary: { en: "Distributions, conditional probability and expectation.", ru: "Распределения, условная вероятность и ожидание." },
  },
  numpy: {
    title: { en: "Python and NumPy", ru: "Python и NumPy" },
    summary: { en: "Just enough code to test ideas in practice.", ru: "Минимум кода, чтобы проверять идеи на практике." },
  },
  chain: {
    title: { en: "Chain rule", ru: "Цепное правило" },
    requires: ["derivative"],
    summary: { en: "The derivative of a composite function. The core of backpropagation.", ru: "Производная сложной функции. Основа обратного распространения." },
  },
  gradient: {
    title: { en: "Gradient", ru: "Градиент" },
    requires: ["derivative", "vectors"],
    summary: { en: "The direction of fastest growth of a function of many variables.", ru: "Направление самого быстрого роста функции многих переменных." },
  },
  descent: {
    title: { en: "Gradient descent", ru: "Градиентный спуск" },
    requires: ["gradient"],
    summary: { en: "Training as walking downhill on the loss function.", ru: "Обучение как движение вниз по функции потерь." },
  },
  loss: {
    title: { en: "Loss function", ru: "Функция потерь" },
    requires: ["probability"],
    summary: { en: "A number that shows how wrong the model is.", ru: "Число, которое показывает, насколько модель ошибается." },
  },
  linear: {
    title: { en: "Linear regression", ru: "Линейная регрессия" },
    requires: ["vectors", "loss", "numpy"],
    summary: { en: "The simplest trainable model.", ru: "Простейшая обучаемая модель." },
  },
  logistic: {
    title: { en: "Logistic regression", ru: "Логистическая регрессия" },
    requires: ["linear", "probability"],
    summary: { en: "Classification, and how it relates to a single neuron.", ru: "Классификация и связь с одним нейроном." },
  },
  layers: {
    title: { en: "Neurons and layers", ru: "Нейрон и слои" },
    requires: ["logistic"],
    summary: { en: "How a network is built from simple units.", ru: "Как из простых элементов собирается сеть." },
  },
  backprop: {
    title: { en: "Backpropagation", ru: "Обратное распространение" },
    requires: ["chain", "layers", "descent"],
    summary: { en: "How to compute the gradient for every weight of a network efficiently.", ru: "Как эффективно посчитать градиент по всем весам сети." },
  },
  practice: {
    title: { en: "Training networks in practice", ru: "Обучение сети на практике" },
    requires: ["backprop"],
    summary: { en: "Batches, overfitting, regularization and debugging.", ru: "Батчи, переобучение, регуляризация и отладка." },
  },
  embeddings: {
    title: { en: "Embeddings", ru: "Эмбеддинги" },
    requires: ["practice"],
    summary: { en: "Representing words and objects as vectors.", ru: "Представление слов и объектов векторами." },
  },
  tokenization: {
    title: { en: "Tokenization", ru: "Токенизация" },
    requires: ["numpy"],
    summary: { en: "How text becomes a sequence of numbers.", ru: "Как текст превращается в последовательность чисел." },
  },
  rnn: {
    title: { en: "Recurrent networks", ru: "Рекуррентные сети" },
    requires: ["practice"],
    summary: { en: "Sequence models from before transformers.", ru: "Модели последовательностей до появления трансформеров." },
    // A material without a note of its own: just a link listed in the concept.
    materials: { en: ['{ url: "https://colah.github.io/posts/2015-08-Understanding-LSTMs/", title: "Understanding LSTM Networks", format: article, minutes: 40 }'] },
  },
  attention: {
    title: { en: "Attention", ru: "Механизм внимания" },
    requires: ["embeddings", "vectors"],
    recommends: ["rnn"],
    summary: { en: "How a model chooses which parts of the input to look at.", ru: "Как модель выбирает, на какие части входа смотреть." },
  },
  transformer: {
    title: { en: "Transformer", ru: "Трансформер" },
    requires: ["attention", "tokenization"],
    summary: { en: "The architecture behind modern language models.", ru: "Архитектура, лежащая в основе современных языковых моделей." },
  },
  cnn: {
    title: { en: "Convolutional networks", ru: "Свёрточные сети" },
    requires: ["practice"],
    summary: { en: "Networks for images. Not needed for the goal, but they stay on the map.", ru: "Сети для изображений. Не нужны для цели, но остаются на карте." },
  },
  finetuning: {
    title: { en: "Fine-tuning", ru: "Дообучение моделей" },
    requires: ["transformer"],
    summary: { en: "How to adapt a pretrained model to your own task.", ru: "Как адаптировать готовую модель под свою задачу." },
  },
};

const sources: Record<string, SampleSource> = {
  linalg: { title: same("3Blue1Brown, Essence of linear algebra"), format: "video", minutes: 180, url: "https://www.3blue1brown.com/topics/linear-algebra", teaches: ["vectors"] },
  calculus: { title: same("3Blue1Brown, Essence of calculus"), format: "video", minutes: 210, url: "https://www.3blue1brown.com/topics/calculus", teaches: ["derivative", "chain"] },
  nn: { title: same("3Blue1Brown, Neural networks"), format: "video", minutes: 150, url: "https://www.3blue1brown.com/topics/neural-networks", teaches: ["layers", "descent", "backprop", "attention"], requires: ["chain"] },
  numpyGuide: { title: same("NumPy quickstart"), format: "article", minutes: 60, url: "https://numpy.org/doc/stable/user/quickstart.html", teaches: ["numpy"] },
  dlbook: { title: { en: "Deep Learning, chapter 3", ru: "Deep Learning, глава 3" }, format: "book", minutes: 180, url: "https://www.deeplearningbook.org/", teaches: ["probability"] },
  d2l: { title: same("Dive into Deep Learning"), format: "book", minutes: 1500, url: "https://d2l.ai/", teaches: ["linear", "logistic", "loss", "practice", "rnn", "cnn"] },
  notes: { title: { en: "My notes on gradients", ru: "Мой конспект про градиент" }, format: "note", minutes: 20, teaches: ["gradient"] },
  karpathy: { title: same("Andrej Karpathy, Neural Networks: Zero to Hero"), format: "course", minutes: 900, url: "https://karpathy.ai/zero-to-hero.html", teaches: ["backprop", "practice", "embeddings", "tokenization", "transformer"], requires: ["numpy"] },
  illustrated: { title: same("The Illustrated Transformer"), format: "article", minutes: 45, url: "https://jalammar.github.io/illustrated-transformer/", teaches: ["transformer"], requires: ["attention"] },
  paper: { title: same("Attention Is All You Need"), format: "paper", minutes: 120, url: "https://arxiv.org/abs/1706.03762", teaches: ["transformer"], requires: ["illustrated"] },
  cs231n: { title: same("CS231n, Convolutional Neural Networks"), format: "course", minutes: 600, url: "https://cs231n.github.io/", teaches: ["cnn"] },
  hf: { title: same("Hugging Face, LLM Course"), format: "course", minutes: 600, url: "https://huggingface.co/learn/llm-course", teaches: ["finetuning", "tokenization"] },
};

const FOLDERS: Record<Lang, { root: string; concepts: string; sources: string }> = {
  en: { root: "Tropa/Example", concepts: "Concepts", sources: "Materials" },
  ru: { root: "Tropa/Пример", concepts: "Концепты", sources: "Материалы" },
};

const OWN_NOTE: Text = {
  en: "Personal notes. Any note from your vault will do.",
  ru: "Личный конспект. Подойдёт любая заметка из вашего хранилища.",
};

/** The example map: a route from school maths to transformers. */
export function sample(language: Lang) {
  const folders = FOLDERS[language];
  const conceptPath = (key: string) => `${folders.root}/${folders.concepts}/${concepts[key].title[language]}`;
  // A material may require a concept or another material.
  const title = (key: string) => (concepts[key] ?? sources[key]).title[language];
  const list = (name: string, keys: string[] = []) =>
    keys.length ? `${name}:\n${keys.map((key) => `  - "[[${title(key)}]]"`).join("\n")}\n` : `${name}: []\n`;

  const files = Object.values(concepts).map((concept) => {
    const listed = concept.materials?.[language];
    const materials = listed ? `materials:\n${listed.map((entry) => `  - ${entry}`).join("\n")}\n` : "";
    return {
      path: `${folders.root}/${folders.concepts}/${concept.title[language]}.md`,
      content: `---\ntype: concept\n${list("requires", concept.requires)}${concept.recommends ? list("recommends", concept.recommends) : ""}${materials}summary: ${concept.summary[language]}\n---\n\n${concept.summary[language]}\n`,
    };
  });
  for (const source of Object.values(sources)) {
    const url = source.url ? `url: ${source.url}\n` : "";
    const requires = source.requires ? list("requires", source.requires) : "";
    files.push({
      path: `${folders.root}/${folders.sources}/${source.title[language]}.md`,
      content: `---\ntype: source\nformat: ${source.format}\nminutes: ${source.minutes}\n${url}${list("teaches", source.teaches)}${requires}---\n\n${source.url ?? OWN_NOTE[language]}\n`,
    });
  }

  return {
    folder: folders.root,
    files,
    /** Vault path of a concept note, without the extension. */
    conceptPath,
    goal: conceptPath("transformer"),
    mastered: ["derivative", "vectors", "numpy"].map(conceptPath),
  };
}
