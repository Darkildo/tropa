# Changelog

All notable changes to Tropa are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). The release workflow publishes the section of the tagged version as the release notes.

## [0.4.0] - 2026-11-03

Tropa now teaches, not only plans: several goals with a deadline and a pace, a learning journal, review of mastered concepts with FSRS and self-check questions in concept notes. Requires Obsidian 1.13.0 or later. The new strings are machine translations into all 33 languages and wait for review by native speakers, especially Arabic, Persian, Hebrew, Bengali and Thai. New dependency: [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) 5.4.2 (MIT, no dependencies of its own).

### Added
- **Learning journal.** Every change of progress made in Tropa is appended as a line to `Tropa/Journal/<YYYY-MM> <device>.md`: the local time with its offset, the action, the note as a link (or the URL of a material listed in a concept) and optional fields. One file per month and device, written only by that device, so a sync never has to merge them; the device name is kept outside the vault. Undo appends lines flagged `undo` instead of erasing any. Lines that do not parse are skipped.
- **Activity in the side panel:** concepts mastered, time with finished materials and reviews over the last 7 and 30 days, read from the journals of all devices. Files that change by sync are read again on their own.
- **Settings → Learning journal** turns the journal off or moves its folder. The folder is never on the map and its files are not offered as materials.
- **Several goals.** The goal button lists your goals: switch between them, route to all of them at once, add one more, replace or remove the active one. A route to several goals takes each prerequisite once, starts with the goal due first, and a step only some of the goals need names them. **Add as goal** in a concept's details and menu, and the commands **Add this note to your goals** (the former "Make this note the goal", same hotkey) and **Remove this note from your goals**.
- **Deadline and pace.** Hours of study a week and a deadline for each goal, from the route panel, the goal button or the command **Set deadline and pace**. The route then says when you finish at that pace, the hours a week each deadline needs or whether you are on track, and how many steps have no time estimate.
- The progress file gains `goals`, `all-goals`, `deadline-YYYY-MM-DD` lists of goals and `pace-hours`, written only when used. `goal` stays the goal the route leads to, so older versions read the file as before. The journal adds `goal-added`, `goal-removed`, `deadline` and `pace` lines; `goal` still names the goal the route leads to, and routing to all goals is not written.
- **Review of mastered concepts with FSRS** ([ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) 5.4.2, MIT, no dependencies).
  - The schedule of each concept is replayed from the journal: it starts with the mastered mark (as **Recalled**, FSRS Good) or the known mark (as **Easy**), and every `reviewed` or `checked` line after it is one FSRS step. Nothing else is stored, so reviews on other devices, Undo and a new target recall all count the same way.
  - A concept is due when the chance to recall it falls below the target recall (90% by default; 80, 85 or 95% in the settings). It stays mastered and blocks nothing; the map shows a badge on it and in the legend, and **Review today** above the route lists the due concepts, the longest overdue first, in the side panel and in the map's panel, on a phone too.
  - Four ratings, **Forgot**, **Hard**, **Recalled**, **Easy**, each with the interval it would give. Not due yet: **Review now**. A notice says when the concept comes back and offers Undo, which appends a `reviewed … undo` line.
  - Marks with no date in the journal (made before it, or on a device without one) start on the day review is first on, spread over one week to two months, a few a day, so an old map is not due all at once.
  - Commands **Review the next concept** and **Open the review queue**. The activity in the panel counts reviews.
  - **Settings → Review** turns it off and sets the target recall. Review needs the journal and is off without it.
- **Self-check.** Questions are `> [!question]-` callouts in a concept's note, the answer inside; Tropa reads them and never changes the note.
  - **Check yourself** in a concept's details, on a row of **Review today** and as a command asks them one at a time: the answer opens on a press (Space), and you grade your own answer **Right**, **Partly** or **Wrong** (1 to 3). On a phone the buttons are finger-sized; right-to-left languages are mirrored.
  - The grades suggest a rating: all right is **Recalled**, or **Easy** with three questions or more; three quarters right **Recalled**, about half **Hard**, less **Forgot**. On a mastered concept the check is a review with the four ratings, the suggested one first in line. On one not mastered yet it ends with **Mark as mastered** or **Not yet**, and the result starts the memory when the mark follows within a day.
  - Results go to the journal as `checked … rating=N`, before the mastered mark too and with review off; Undo appends `reviewed … undo`, and undoing a check right before the mark gives the mark its own rating back. Closing the window saves nothing.
  - **Mark as mastered**, the M key, the node menu and the command offer a check first on a concept with questions, with **Mark mastered without a check** and **Do not offer again**.
  - The details count a concept's questions. **Settings → Self-check** sets the callout type, turns the offer off, and adds **Concepts without questions** to the map audit (off by default).
  - The example map and the demo vaults have questions on a few concepts.

### Changed
- **Translations in `main.js` no longer repeat their keys:** each language is a JSON array of its values in the order of the English keys, and only the active one is parsed at startup, as before. The files in `src/i18n/locales` stay ordinary JSON.
- **Set as goal** on a concept, when there is a goal already, is now **Add as goal**: the earlier goal is kept. Choosing a goal from the goal button still replaces the active one.

### Fixed
- Writing the progress file and a journal at the same moment no longer fails with "Folder already exists" when the folder is new.

### Performance
- Translations without repeated keys take 457 KB instead of 590 KB in `main.js` (measured before self-check added its strings).
- `main.js` is 867 KB (0.3.2: 738 KB). The new features and their strings in 33 languages make up the growth; ts-fsrs adds about 21 KB.
- The journal of 20 000 lines is read and summed in about 0.15 s; one language is parsed at startup.

## [0.3.2] - 2026-11-03

### Fixed
- **Undo** reverts only its own change. Before, it brought back the whole progress from before that change, so anything changed after it was lost too: a concept started from a command or the side panel, or an edit synced from another device. Now the toast on the map and the notice outside it close as soon as the progress changes in any other way. Reading back Tropa's own save does not count as a change, so the offer stays for its usual six seconds.

## [0.3.1] - 2026-11-02

Phone fixes, after trying 0.3.0 on Android. The three new strings are machine translations into all 33 languages.

### Fixed
- Swiping or zooming on the map no longer opens Obsidian's side panels on a phone. Touches inside the map and its panel stay there (they also carry Obsidian's `data-ignore-swipe`); swipes on the bar still open the panels.
- The panel at the bottom no longer slides under Obsidian's navigation bar: it sits above it, measured at run time, or above the safe area.
- The zoom buttons stay above the panel instead of covering it and the nodes, and hide when the panel takes the whole screen.
- Fitting the map on a phone no longer shrinks it past reading: below 70% it stays readable and centres on the selection, the next step or the goal.

### Changed
- On a phone the bar is one row: the goal, the route and whole-map switch as icons, and a **⋯** menu with materials, focus, the audit (with its count on the button), export and a new concept. The progress is a thin line under it.
- Touch gestures on the map: pinch to zoom around the fingers while panning, double tap to zoom in, hold a node for its menu.
- The panel on a phone has a handle: tap or drag it between the title, half the screen and nearly all of it. Picking a concept opens it halfway.
- Nodes on a phone have no link dots; **Link to the next concept…** in the node's menu does that. Fold badges show only on the selected or a folded concept, smaller, with a finger-sized target.

## [0.3.0] - 2026-11-02

Requires Obsidian 1.13.0 or later. The strings added in this release are machine translations into all 33 languages and wait for review by native speakers, especially Arabic, Persian, Hebrew, Bengali and Thai. See [Fix or add a translation](https://github.com/Darkildo/tropa#fix-or-add-a-translation).

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
- When the note at the center of the focus is left out by the map scope or deleted, the focus closes and the map goes back to where it was. Before, the Focus button stayed pressed while the map already showed everything.
- Folds follow changes of the map scope: the "+K" badge counts only what is still on the map, and a fold on a note that was left out is dropped.

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

[0.4.0]: https://github.com/Darkildo/tropa/compare/0.3.2...0.4.0
[0.3.2]: https://github.com/Darkildo/tropa/compare/0.3.1...0.3.2
[0.3.1]: https://github.com/Darkildo/tropa/compare/0.3.0...0.3.1
[0.3.0]: https://github.com/Darkildo/tropa/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/Darkildo/tropa/compare/0.1.1...0.2.0
[0.1.1]: https://github.com/Darkildo/tropa/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/Darkildo/tropa/releases/tag/0.1.0
