# Changelog

All notable changes to Tropa are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). The release workflow publishes the section of the tagged version as the release notes.

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

[0.2.0]: https://github.com/Darkildo/tropa/compare/0.1.1...0.2.0
[0.1.1]: https://github.com/Darkildo/tropa/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/Darkildo/tropa/releases/tag/0.1.0
