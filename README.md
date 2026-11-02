# Tropa

[Русская версия](README.ru.md)

Tropa turns ordinary notes into a graph of concepts and learning materials, and builds a personal route to any goal from what you do not know yet.

![Learning route, light theme](docs/screenshots/route-light.png)

## Features

- **Route to a goal.** Pick a concept you want to learn. Tropa shows only the steps that lead to it, in order, with the next one highlighted.
- **Concepts and materials.** A concept is something you want to understand. A material is an article, video, book, paper, course or your own note that teaches it.
- **Progress you can see.** Mark concepts as learning or mastered and materials as done. Mastering a concept unlocks the ones that depend on it. Every action can be undone.
- **Time estimate.** Material durations add up to the time left on the route.
- **Edit on the map.** Drag from the dot under a concept to another concept to link them, or to empty space to create the next one. Links that would create a cycle are refused.
- **Plain files.** The graph lives in note properties, so it syncs and travels like any other notes. Your goal and marks live in a separate file, so you can share a map without your progress.
- **Sidebar panel.** Shows where the open note sits in the graph, and adds any note to the map in one click.
- **Keyboard.** Arrow keys move between concepts, Enter opens details, Shift+Enter opens the note, M toggles mastered, Esc returns to the route.
- **English and Russian.** The interface follows Obsidian's language.

## Screenshots

| | Light | Dark |
|---|---|---|
| Route | ![Route, light](docs/screenshots/route-light.png) | ![Route, dark](docs/screenshots/route-dark.png) |
| Concept details | ![Concept, light](docs/screenshots/concept-light.png) | ![Concept, dark](docs/screenshots/concept-dark.png) |
| Whole map with materials | ![Map, light](docs/screenshots/map-light.png) | ![Map, dark](docs/screenshots/map-dark.png) |

## Installation

Tropa requires Obsidian 1.13.0 or later.

### From Community plugins

Once Tropa is listed: open **Settings → Community plugins → Browse**, search for **Tropa**, install it and enable it.

### Manually

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/Darkildo/tropa/releases/latest).
2. Put them in `<your vault>/.obsidian/plugins/tropa/`.
3. Reload Obsidian and enable **Tropa** in **Settings → Community plugins**.

### With BRAT

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), run **BRAT: Add a beta plugin for testing** and enter `Darkildo/tropa`.

## Usage

1. Open the map with the route icon in the left ribbon or the command **Tropa: Learning map**.
2. In an empty vault, choose **Show example** to add an example map, or **Create first concept**.
3. Choose a goal in the top left corner. The panel on the right lists the steps and what to study first.
4. Click a concept, press **Start learning**, then **Mark as mastered** when you are done.
5. Switch between **Route** and **Whole map**, and turn on **Materials** to see them on the map.

Other commands: open the sidebar panel, create a concept, find a concept on the map, make the open note a concept, a material or the goal, and mark it mastered.

## Data model

```yaml
# Concept
---
type: concept
requires: ["[[Derivatives]]"]     # must be mastered first
recommends: ["[[Probability]]"]   # useful, does not block access
summary: Short description
---

# Material
---
type: source
format: video                     # video, article, book, paper, course, note, other
minutes: 45
url: https://example.com
teaches: ["[[Gradient descent]]"]
requires: ["[[Derivatives]]"]     # a concept or another material
---
```

Your goal and marks are stored in `Tropa/Progress.md`. A link to a note that does not exist yet becomes a placeholder concept, and you can create the note with one button. Property names, folders and the progress file can be changed in the settings. Default paths follow Obsidian's language on first launch and are saved, so they do not move later.

## Demo vault (optional)

Each release has ready-made vaults with the example map and the plugin already installed: [`tropa-demo-vault.zip`](https://github.com/Darkildo/tropa/releases/latest/download/tropa-demo-vault.zip) (English) and [`tropa-demo-vault-ru.zip`](https://github.com/Darkildo/tropa/releases/latest/download/tropa-demo-vault-ru.zip) (Russian). Unzip one, choose **Open folder as vault** in Obsidian, then **Trust author and enable plugins**. You do not need them to use Tropa.

## Development

```bash
npm install
npm run lint         # ESLint with the Obsidian plugin rules
npm test             # core: graph, states, cycles, route, layout, example map, i18n
npm run build        # main.js
npm run dev          # rebuild on change
npm run demo         # demo vaults in dist/Tropa Demo and dist/Tropa Demo RU
npm run preview      # browser build on a mocked API in dist/preview
npm run e2e          # UI checks in Chromium (Playwright)
npm run screenshots  # README images in docs/screenshots
```

`npm run e2e` and `npm run screenshots` need a Chromium for Playwright: `npx playwright install chromium`, or set `CHROMIUM_PATH` to an installed one.

- `src/core`: logic with no dependency on Obsidian.
- `src/i18n`: English and Russian strings.
- `src/store.ts`: reads the vault, keeps progress, writes links.
- `src/ui`: map, sidebar panel, modals.
- `harness`: a mock of the Obsidian API that runs the real plugin code in a browser.

To release, run `npm version patch` (or `minor`, `major`) and push the tag: `git push --follow-tags`. The workflow builds the plugin and publishes a release with `main.js`, `manifest.json`, `styles.css` and the demo vaults.

## Limitations

- Node positions are computed automatically and cannot be dragged.
- A material must be a note. Link a PDF or video in your vault from a note.
- Layout blocks the interface when the shape of the graph changes: about 0.4 s for 100 concepts, 1 s for 200 and 3.5 s for 400 with dense links.

## License

[MIT](LICENSE)
