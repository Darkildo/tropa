# Changelog

All notable changes to Tropa are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). The release workflow publishes the section of the tagged version as the release notes.

## [Unreleased]

### Added
- **Suggested links.** The command **Suggest links from your notes**, a button on the empty map and an item in the file menu of a folder or a note read the links your notes already have and offer them as `requires` and `recommends`: consecutive items of a list of at least three linked notes (each needs the one before it, ticked), a link in the text that is not returned (the linked note is needed first) and links both ways (recommended). Pairs the map already links, materials, notes with another `type`, notes out of the map's scope and embeds are left out.
- A preview lists them by where they were found; each row reads "A needs B", with a box and the kind to change. A needed link that would close a loop, with the map or with the other ticked rows, is refused and the loop is shown; it can still be added as recommended. Up to 500 suggestions at once.
- **Add links** writes the batch, one write per note, and gives a note that is not a concept yet `type: concept`. **Undo** in the notice and the command **Undo the last suggested links** put back each property the batch changed, except in notes changed since.
- **Reviews a day.** Today's queue keeps to a daily limit (**Settings → Review**, 20 by default, or no limit): the concepts easiest to forget come first, and at the same chance to recall, those the goals lead through. The rest wait for the next days, and the head of **Review today** says how many of all are shown (`20 of 37`). Reviews already done today count, so the queue does not refill as it empties. A concept over the limit has no badge on the map and keeps its ratings behind **Review now**.
- **Spread reviews evenly** (on by default). A rating may move the next review by up to 5% of the interval, three days at most, to the least busy day nearby. The move is written into the review line as `shift=N`, so every device replays the same day; it changes only the due date, never what FSRS knows, and is ignored once it no longer fits the interval.
- **Pause review** with the day it comes back, from the head of **Review today** or the command, and **Resume review**. Both go to the journal (`pause - until=YYYY-MM-DD`, `resume -`), so every device pauses. While paused nothing is due; afterwards what came due meanwhile is spread over as many days as the pause lasted, two weeks at most.
- **Map from a list.** The command **Create a map from a list** and a button on the empty map take a pasted Markdown list (nesting by indentation), headings (by level) or a book's table of contents (by `1.2.3` numbers, page numbers dropped) and make a concept of each line. An item uses a note already in the vault when its line links to one or a concept or note has its name, case and accents aside; repeated names are one note; characters a file name cannot have are left out of the file name, and a missing note the map links to keeps its spelling.
- Nesting gives `requires` either way, a topic needing what is under it (default) or the reverse; neighbours of one level can need the one before them (off by default). The preview lists the new notes, the notes already in the vault and the links, with the same loop refusal as suggested links. **Create** makes the notes with `type: concept` and writes the links; **Undo** and the command **Undo the last map from a list** move the new notes to the trash and put back the other notes' properties, except notes changed since. The pasted list is kept until it is used.
- The notice after a map from a list also offers **Set … as goal** for the first item at the top: it adds the goal like **Add as goal**, with its journal line, and an undo of the map takes that goal back.
- **The `tropa` block.** A code block in any note shows the route (`show: route`, the default), today's review queue (`show: review`) or the next step alone (`show: next`), to the active goal or to `goal: [[…]]`, `limit` rows at most (10 by default, up to 100). Rows are links that open and preview like any link; a box marks a step mastered (offering a self-check first) or asks how well a review went, with an undo. The block follows the progress and the queue, and says what is wrong with its options instead of failing.
- **The status bar** (desktop) shows how many concepts are due today and the next step, or the day a paused review comes back; a click opens the queue or the next step. **Settings → Status bar** turns it off.
- **Page preview of the map's nodes.** Hovering a node with Ctrl or Cmd shows its note, through the core Page preview plugin, where Tropa is listed as a source.

### Changed
- A concept mastered away from the map, from a command or a `tropa` block, gets a notice with **Undo**, as other changes made there already did. The notice is left to the map only while the map is in sight.
- **Review today** lists the concepts easiest to forget first, instead of the longest overdue first.
- Update Tropa on every device that shares the vault. A device still on 0.4 skips the `pause` and `resume` lines and ignores `shift=N`: it does not see the pause, and its review dates may differ by up to three days. Nothing breaks, and the dates agree again once all devices run 0.5.

## [0.4.1] - 2026-11-05

Fixes for the checks of the community catalog. Nothing changes in how Tropa works.

### Changed
- The release holds only `main.js`, `manifest.json` and `styles.css`, with GitHub artifact attestations for them (`gh attestation verify main.js -R Darkildo/tropa`). The demo vaults moved to a release of their own, [`demo`](https://github.com/Darkildo/tropa/releases/tag/demo), updated with every version; the links in the README point there.
- The layout engine's WebAssembly is kept in git (`assets/wasm/tropa_layout.wasm`), so `npm ci && npm run build` works without Rust and gives the same `main.js` as the release. CI still builds it twice from `crates/tropa-layout` and fails unless both builds match the file in git byte for byte.
- The console stays quiet unless something fails: which layout engine runs, and why WebAssembly was skipped, are kept in the layout statistics instead of the console, and the notices of the bundled ts-fsrs are left out of `main.js`.
- The learning journal is read by walking its own folder instead of every Markdown file of the vault.
- The phone progress bar hides its text without `clip-path`, which the catalog check marks as only partly supported.
- The README has a Privacy section: what Tropa reads and writes, and that it makes no network requests.

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

[Unreleased]: https://github.com/Darkildo/tropa/compare/0.4.1...HEAD
[0.4.1]: https://github.com/Darkildo/tropa/compare/0.4.0...0.4.1
[0.4.0]: https://github.com/Darkildo/tropa/compare/0.3.2...0.4.0
[0.3.2]: https://github.com/Darkildo/tropa/compare/0.3.1...0.3.2
[0.3.1]: https://github.com/Darkildo/tropa/compare/0.3.0...0.3.1
[0.3.0]: https://github.com/Darkildo/tropa/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/Darkildo/tropa/compare/0.1.1...0.2.0
[0.1.1]: https://github.com/Darkildo/tropa/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/Darkildo/tropa/releases/tag/0.1.0
