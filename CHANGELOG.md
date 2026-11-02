# Changelog

All notable changes to Tropa are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). The release workflow publishes the section of the tagged version as the release notes.

## [0.3.0] - 2026-11-02

Requires Obsidian 1.13.0 or later. The strings added in this release are machine translations into all 33 languages and wait for review by native speakers, especially Arabic, Persian, Hebrew, Bengali and Thai. See [Fix or add a translation](README.md#fix-or-add-a-translation).

### Added
- **Skip, confidence and "I know this".**
  - **Skip** leaves a concept out of the route: it opens what depends on it but never counts as mastered, and the progress line counts it apart.
  - **I know this and what it needs** marks a concept with its unmastered prerequisites in one step. The list shows them in learning order, anything can be unticked, and one Undo reverts the batch.
  - An optional confidence from 1 to 5 can be set on mastered and learning concepts.
  - New commands skip the open note, return it to the route, and mark it known with everything it needs.
  - The progress file gains `skipped` and `confidence-N` lists, written only when used.
- **Materials without a note.** A concept can list links and attachments in its `materials` property, with an optional title, format and duration. The same link in several concepts is one material, and a link that already has a material note is shown as that note. They count in the route time like any material, and finished ones go to `done-materials` in the progress file. **Add material** offers attachments from the vault, and the new material dialog can keep the link in the concept instead of creating a note.
- **Map scope.** Settings leave whole folders and notes with certain tags out of the map: nested tags count, folders are matched by whole path segments. Links to an excluded note are dropped, so it blocks nothing, while progress marks stay in the file and come back with the note.
- **Focus and fold.**
  - **Focus** (F, or the context menu) shows only what is near a concept: one to three steps both ways, soft links included, with their materials. Esc puts the map back where it was.
  - A badge under a concept folds away everything that needs it and then shows how many concepts it hides. Route steps hidden this way are marked in the route list, and picking one unfolds its branch.
  - Focus and folds are view state, kept with Obsidian's workspace layout.
- **Map audit.**
  - The command **Audit the map**, and a button in the map's bar with the number of findings, open one list: dependency cycles as a chain back to their start, links to missing notes (with a button to create them), possible duplicate names (case and accents ignored), concepts without materials and notes with no links.
  - The button turns red when there is a cycle. Each row opens its note or shows it on the map.
- **Export.** The map as it is drawn now, with focus and folds, can be saved to a JSON Canvas file or to SVG, from the bar or two commands.
  - The canvas points at your notes, keeps the positions and can be colored by progress (optional).
  - The SVG uses the current theme.
  - An existing file is never replaced without asking.

### Changed
- **Own layout engine instead of dagre.** On the benchmark graphs it draws with 15–26% fewer edge crossings and no edge through a node it does not belong to. Edges run straight down through each row and bend only between rows; soft links take part in ordering.
- **WebAssembly in a worker.** Large maps (150 nodes and more) are laid out off the main thread by the engine's Rust port compiled to WebAssembly. It draws the same map to the last bit as the TypeScript engine, which stays as the fallback where WebAssembly or workers are unavailable.
  - The module is built from source in CI; its sha256 is printed in the release log and listed below these notes.
  - While a large map is laid out, the previous one stays on screen with a thin bar along the top.
- **Showing a note on the map** (from the audit, the route list or a command) first turns on materials, opens folds or leaves the focus as needed, waits for the new layout, then centers the note.
- **Dashes when zoomed out.** A map with more than 1000 edges drops the dashes of "teaches" and soft links when zoomed out, and soft links fade instead; smaller maps keep their dashes.

### Performance
- **Layout time,** in Chromium on the benchmark graphs (dense, synthetic):

  | graph | 0.2 (dagre) | 0.3 |
  | --- | --- | --- |
  | 400 concepts | 0.6 s | 23 ms |
  | 400 concepts with materials | 5.7 s | 0.16 s |
  | 1000 concepts with materials | 39.5 s | 0.7 s |

  The interface keeps responding meanwhile: the longest pause is under 20 ms.
- Recently used layouts are kept by the shape of the graph, so switching between the route, the whole map and materials does not lay the map out again.
- Changes on a large map repaint only what changed. On 1000 concepts with materials, a mark takes 20–36 ms instead of 58–108 ms: edges are no longer rebuilt, and the side panel no longer forces the page to lay out.
- `main.js` is 724 KB (0.2.0: 364 KB). dagre is gone; the WebAssembly module adds 137 KB as base64, and the new features and their strings in 33 languages make up the rest.

### Fixed
- Maps zoomed out with thousands of dashed edges no longer freeze the browser for many seconds while it draws them.

## [0.2.0] - 2026-11-02

### Added
- The interface in 33 languages: Arabic, Bengali, Catalan, Chinese (Simplified and Traditional), Czech, Danish, Dutch, English, Finnish, French, German, Greek, Hebrew, Hungarian, Indonesian, Italian, Japanese, Korean, Norwegian, Persian, Polish, Portuguese (Portugal and Brazil), Romanian, Russian, Slovak, Spanish, Swedish, Thai, Turkish, Ukrainian and Vietnamese. Tropa follows Obsidian's language: the exact code first, then the base language (`pt-PT` → `pt`), then English.
- Right-to-left layout for Arabic, Hebrew and Persian: the bar, side panel, step list, badges, toasts and dialogs are mirrored. The graph keeps its top-to-bottom geometry.
- Plural forms by the CLDR rules of each language (`Intl.PluralRules`) and localized numbers and durations.

### Changed
- Translations ship inside `main.js`, and only the active language is parsed at startup. Nothing is downloaded.

### Fixed
- Text from notes (titles, summaries, material names, the goal) keeps its own direction in right-to-left languages, so "What is AI?" no longer turns into "?What is AI".
- A duration in a route step no longer wraps in the middle.

## [0.1.1] - 2026-11-02

### Changed
- Requires Obsidian 1.13.0 or later.
- Settings use the declarative settings API, so they appear in Obsidian's settings search.
- The language comes from Obsidian's `getLanguage()`.

### Fixed
- Warnings from the Obsidian community catalog review: unsafe `any` values in the layout and front matter code, promises in event handlers, a `TFile` cast, `document.createElement` and `!important` in the styles.
- Failed actions show a notice and log the error with context instead of failing silently.

### Added
- ESLint with the Obsidian plugin rules in CI.

## [0.1.0] - 2026-11-02

### Added
- First release: a graph of concepts and materials built from note properties, a personal route to any goal, progress kept in `Tropa/Progress.md`.
- English and Russian interface, example map and demo vaults in both languages.

[0.3.0]: https://github.com/Darkildo/tropa/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/Darkildo/tropa/compare/0.1.1...0.2.0
[0.1.1]: https://github.com/Darkildo/tropa/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/Darkildo/tropa/releases/tag/0.1.0
