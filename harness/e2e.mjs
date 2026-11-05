// UI checks: real plugin code on the mocked API in Chromium. Run with: npm run e2e
import { mkdirSync } from "node:fs";
import { node, start } from "./serve.mjs";

const SHOTS = "dist/shots/";
mkdirSync(SHOTS, { recursive: true });
const PROG = "tropa.app.vault.contents.get('Tropa/Progress.md')";
const CONCEPTS = "Tropa/Example/Concepts";

const results = [];
function ok(name, cond, extra = "") {
  results.push(Boolean(cond));
  console.log(cond ? "PASS" : "FAIL", name, cond ? "" : extra);
}
const state = (page, title) => node(page, title).getAttribute("class");
const wait = (page, ms) => page.waitForTimeout(ms);
const note = (page, path) => page.evaluate((p) => tropa.app.vault.contents.get(p) ?? "", path);

const { open, stop } = await start();

// --- core learning loop
{
  const { page, errors } = await open();
  await page.screenshot({ path: SHOTS + "10-start-light.png" });
  await node(page, "Gradient").click(); await wait(page, 150);
  const padding = await page.evaluate("getComputedStyle(document.querySelector('#center .view-content.tropa-host')).padding");
  ok("map view has no padding", padding === "0px", padding);
  ok("inspector opens", (await page.locator(".tropa-side .tropa-title").innerText()) === "Gradient");
  await page.screenshot({ path: SHOTS + "11-detail.png" });
  await page.click('.tropa-side button:text-is("Start learning")'); await wait(page, 200);
  ok("learning state", (await state(page, "Gradient")).includes("state-learning"));
  await page.click('.tropa-side button:text-is("Mark as mastered")'); await wait(page, 250);
  ok("mastered state", (await state(page, "Gradient")).includes("state-mastered"));
  const toast = await page.locator(".tropa-toast").innerText();
  ok("unlock toast", toast.includes("Unlocked: Gradient descent"), toast);
  ok("next unlocked", (await state(page, "Gradient descent")).includes("state-available"));
  await page.screenshot({ path: SHOTS + "12-unlocked.png" });
  await wait(page, 300);
  const progress = await page.evaluate(PROG);
  ok("saved to progress file", progress.includes("[[Gradient]]"), progress.slice(0, 300));
  ok("note files untouched by progress", !(await note(page, `${CONCEPTS}/Gradient.md`)).includes("learning-progress"));
  await page.click(".tropa-toast button"); await wait(page, 300);
  ok("undo restores", !(await state(page, "Gradient")).includes("state-mastered"));
  // material checkbox
  await node(page, "Tokenization").click(); await wait(page, 150);
  await page.locator(".tropa-material input").first().check(); await wait(page, 250);
  ok("done material starts concept", (await state(page, "Tokenization")).includes("state-learning"));
  // back to route, keyboard
  await page.keyboard.press("Escape"); await wait(page, 100);
  await node(page, "Tokenization").focus(); await page.keyboard.press("ArrowUp"); await wait(page, 60);
  ok("arrow keys move focus", (await page.evaluate("document.activeElement.dataset.id||''")) !== "");
  await node(page, "Chain rule").focus(); await page.keyboard.press("m"); await wait(page, 200);
  ok("m key masters", (await state(page, "Chain rule")).includes("state-mastered"));
  await page.keyboard.press("Enter"); await wait(page, 100);
  ok("enter selects", (await page.locator(".tropa-side .tropa-title").innerText()) === "Chain rule");
  // whole map + materials
  await page.keyboard.press("Escape");
  await page.click('button:text-is("Whole map")'); await wait(page, 500);
  ok("all map shows off-route", (await node(page, "Convolutional networks").count()) === 1);
  await page.screenshot({ path: SHOTS + "13-all.png" });
  await page.click(".tropa-toggle-sources"); await wait(page, 500);
  const sources = await page.locator(".tropa-node.is-source").count();
  ok("materials shown", sources === 13, String(sources));
  await page.screenshot({ path: SHOTS + "14-materials.png" });
  await page.click(".tropa-toggle-sources"); await wait(page, 300);
  // goal change: the goal button lists the goals, and replacing one works as choosing a goal always did
  await page.click(".tropa-goal"); await wait(page, 100);
  ok("goal button opens the goal menu", (await page.locator('.menu-item:text-is("Transformer")').getAttribute("aria-checked")) === "true");
  await page.click('.menu-item:text-is("Replace with another goal…")'); await wait(page, 100);
  await page.keyboard.type("Convol"); await wait(page, 100); await page.keyboard.press("Enter"); await wait(page, 1500);
  ok("goal switched", (await page.locator(".tropa-goal-label").innerText()) === "Convolutional networks");
  await wait(page, 300);
  ok("goal persisted", (await page.evaluate(PROG)).includes("Convolutional networks"));
  await page.click('button:text-is("Route")'); await wait(page, 500);
  ok("route excludes transformer", (await node(page, "Transformer").count()) === 0);
  await page.click('button:text-is("Whole map")'); await wait(page, 500);
  // drag connect: valid link
  const drag = async (from, to, shot) => {
    const a = node(page, from);
    const c = node(page, to);
    await a.scrollIntoViewIfNeeded(); await a.hover();
    const port = await a.locator(".tropa-port").boundingBox();
    const box = await c.boundingBox();
    await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 }); await wait(page, 80);
    if (shot) await page.screenshot({ path: SHOTS + shot });
    await page.mouse.up(); await wait(page, 350);
  };
  await drag("Embeddings", "Convolutional networks", "15-connect.png");
  ok("drag creates link", (await note(page, `${CONCEPTS}/Convolutional networks.md`)).includes("[[Embeddings]]"));
  // drag connect: cycle refused
  await page.click('[aria-label="Show whole map"]'); await wait(page, 450);
  await drag("Transformer", "Embeddings");
  const notices = await page.evaluate("tropa.notices");
  ok("cycle refused", notices.some((text) => text.includes("cycle")), JSON.stringify(notices));
  ok("cycle not written", !(await note(page, `${CONCEPTS}/Embeddings.md`)).includes("Transformer"));
  // add material by link
  await node(page, "Probability").click(); await wait(page, 200);
  await page.click('.tropa-side button:has-text("Add material")'); await wait(page, 100);
  await page.keyboard.type("Seeing Theory"); await wait(page, 100); await page.keyboard.press("Enter"); await wait(page, 200);
  await page.screenshot({ path: SHOTS + "16-source-modal.png" });
  await page.locator('.modal input[placeholder="https://example.com"]').fill("https://www.youtube.com/watch?v=x");
  ok("format guessed", (await page.locator(".modal select").inputValue()) === "video");
  await page.locator(".modal input[type=number]").fill("30");
  await page.click('.modal button:text-is("Add material")'); await wait(page, 350);
  ok("material attached", (await page.locator('.tropa-material:has-text("Seeing Theory")').count()) === 1);
  await page.locator('.tropa-material:has-text("Seeing Theory") button[aria-label^="Detach"]').click({ force: true }); await wait(page, 300);
  ok("material detached", (await page.locator('.tropa-material:has-text("Seeing Theory")').count()) === 0);
  // add prerequisite + create new
  await page.click('.tropa-side button:has-text("Add prerequisite")'); await wait(page, 100);
  await page.keyboard.type("Combinatorics"); await wait(page, 100); await page.keyboard.press("Enter"); await wait(page, 400);
  ok("new prerequisite node", (await node(page, "Combinatorics").count()) === 1);
  ok("no console errors", errors.length === 0, JSON.stringify(errors));
  await page.close();
}

// --- cycle + ghost + off-map note
{
  const { page, errors } = await open({ query: "?scenario=cycle&panel=1" });
  await wait(page, 200);
  ok("cycle banner", (await page.locator(".tropa-side .tropa-callout.is-danger").count()) === 1);
  ok("cycle state", (await state(page, "A")).includes("state-cycle"));
  ok("ghost node", (await state(page, "No note yet")).includes("is-ghost"));
  await page.screenshot({ path: SHOTS + "20-cycle.png" });
  await node(page, "No note yet").click(); await wait(page, 120);
  await page.click('.tropa-side button:text-is("Create note")'); await wait(page, 350);
  ok("ghost materialised", await page.evaluate("tropa.app.vault.files.has('Tropa/Concepts/No note yet.md')"));
  ok("ghost becomes real node", !(await state(page, "No note yet")).includes("is-ghost"));
  await page.evaluate("(()=>{const f=tropa.app.vault.files.get('Loose note.md'); tropa.app.workspace.setActive(f)})()"); await wait(page, 120);
  ok("offmap prompt", (await page.locator("#right .tropa-offmap").count()) === 1);
  await page.click('#right .tropa-offmap button:has-text("Concept")'); await wait(page, 350);
  ok("note added to map", (await node(page, "Loose note").count()) === 1);
  ok("panel follows note", (await page.locator("#right .tropa-title").first().innerText()) === "Loose note");
  ok("no console errors (cycle)", errors.length === 0, JSON.stringify(errors));
  await page.close();
}

// --- empty vault onboarding
{
  const { page, errors } = await open({ query: "?scenario=empty" });
  ok("empty state", (await page.locator(".tropa-empty").count()) === 1);
  await page.screenshot({ path: SHOTS + "30-empty.png" });
  const settings = await page.evaluate("tropa.plugin.data");
  ok("defaults saved on first launch", settings?.progressPath === "Tropa/Progress.md", JSON.stringify(settings));
  await page.click('.tropa-empty button:text-is("Show example")'); await wait(page, 1200);
  const count = await page.locator(".tropa-node").count();
  ok("sample installed", count >= 15, String(count));
  ok("sample route", (await page.locator(".tropa-goal-label").innerText()) === "Transformer");
  ok("no console errors (empty)", errors.length === 0, JSON.stringify(errors));
  await page.close();
}

// --- declarative settings
{
  const { page, errors } = await open({ query: "?panel=1" });
  await page.evaluate(() => {
    const tab = tropa.plugin.settingTab;
    tab.display();
    tab.containerEl.id = "settings";
    document.getElementById("note").replaceChildren(tab.containerEl);
    document.getElementById("note").dataset.open = "";
  });
  const headings = await page.locator("#settings .setting-item-heading").allInnerTexts();
  ok("settings groups", headings.join("|") === "Files|Note properties|Map scope|Learning journal|Review|Self-check|Status bar", headings.join("|"));
  ok("scope settings are text areas", (await page.locator("#settings textarea[data-key]").count()) === 2);
  const field = (key) => page.locator(`#settings input[data-key="${key}"]`);
  ok("scope settings empty by default", (await page.locator('#settings textarea[data-key="excludeFolders"]').inputValue()) === "");
  ok("settings controls", (await page.locator("#settings input[data-key]").count()) === 16);
  ok("the status bar is on by default", await page.locator('#settings input[data-key="statusBar"]').isChecked());
  ok("self-check settings: offered by default, audit off", await page.locator('#settings input[data-key="offerCheck"]').isChecked() &&
    !(await page.locator('#settings input[data-key="auditQuestions"]').isChecked()) && (await field("checkCallout").inputValue()) === "question");
  ok("review is on by default", await page.locator('#settings input[data-key="review"]').isChecked());
  ok("target recall is a choice, 90% by default", (await page.locator('#settings select[data-key="retention"]').inputValue()) === "0.9" &&
    (await page.locator('#settings select[data-key="retention"] option').allInnerTexts()).join("|") === "80%|85%|90%|95%");
  ok("journal is on by default", await page.locator('#settings input[data-key="journal"]').isChecked());
  ok("journal folder follows the language", (await field("journalFolder").inputValue()) === "Tropa/Journal");
  ok("materials key setting", (await page.locator('#settings input[data-key="materialsKey"]').inputValue()) === "materials");
  ok("settings show values", (await field("conceptsFolder").inputValue()) === "Tropa/Concepts");
  ok("settings show defaults as placeholders", (await field("progressPath").getAttribute("placeholder")) === "Tropa/Progress.md");
  await field("conceptsFolder").fill("Learning/Concepts"); await field("conceptsFolder").dispatchEvent("change"); await wait(page, 150);
  ok("setting saved", (await page.evaluate("tropa.plugin.data.conceptsFolder")) === "Learning/Concepts");
  await field("conceptsFolder").fill("  "); await field("conceptsFolder").dispatchEvent("change"); await wait(page, 150);
  ok("empty setting falls back to default", (await page.evaluate("tropa.plugin.settings.conceptsFolder")) === "Tropa/Concepts");
  const before = await page.evaluate("tropa.plugin.store.topologyKey");
  await field("requiresKey").fill("needs"); await field("requiresKey").dispatchEvent("change"); await wait(page, 300);
  ok("graph reread after setting change", (await page.evaluate("tropa.plugin.store.topologyKey")) !== before);
  ok("no console errors (settings)", errors.length === 0, JSON.stringify(errors));
  await page.close();
}

// --- map scope: excluded folders and tags
const openSettings = (page) =>
  page.evaluate(() => {
    const tab = tropa.plugin.settingTab;
    tab.display();
    tab.containerEl.id = "settings";
    document.getElementById("note").replaceChildren(tab.containerEl);
    document.getElementById("note").dataset.open = "";
  });
const setScope = async (page, key, value) => {
  await openSettings(page);
  const area = page.locator(`#settings textarea[data-key="${key}"]`);
  await area.fill(value); await area.dispatchEvent("change"); await wait(page, 300);
};
{
  const { page, errors } = await open({ query: "?scenario=scope&panel=1" });
  await page.click('button:text-is("Whole map")'); await wait(page, 400);
  const absent = async (title) => (await node(page, title).count()) === 0;
  ok("scope: note in an excluded folder is not on the map", await absent("Archived"));
  ok("scope: folder rule matches whole segments", !(await absent("Kept")));
  ok("scope: nested frontmatter tag excluded", await absent("Private note"));
  ok("scope: inline tag excluded", await absent("Inline tagged"));
  ok("scope: no placeholder for excluded notes", (await page.locator(".tropa-node.is-ghost").count()) === 0);
  ok("scope: what needed only an excluded note is available", (await state(page, "Next")).includes("state-available"), await state(page, "Next"));
  ok("scope: progress read from an excluded folder", (await page.locator(".tropa-goal-label").innerText()) === "Goal");
  await page.click('button:text-is("Route")'); await wait(page, 300);
  const steps = (await page.locator(".tropa-side .tropa-step-title").allInnerTexts()).join("|");
  ok("scope: excluded notes are not route steps", steps === "Base|Kept|Goal", steps);

  await node(page, "Base").click(); await wait(page, 150);
  ok("scope: attachment in an excluded folder stays a material", (await page.locator(".tropa-side .tropa-material").allInnerTexts()).join(" ").includes("scan"),
    (await page.locator(".tropa-side .tropa-material").allInnerTexts()).join(" | "));
  await page.click('.tropa-side button:text-is("I already know this")'); await wait(page, 400);
  const written = await page.evaluate("tropa.app.vault.contents.get('Tropa/Progress.md')");
  ok("scope: marks on excluded notes stay in the progress file", written.includes("[[Archived]]") && written.includes("[[Base]]"), written);

  await page.evaluate("tropa.app.workspace.setActive(tropa.app.vault.files.get('Private note.md'))"); await wait(page, 200);
  ok("scope: panel says the open note is left out", (await page.locator("#right .tropa-callout").allInnerTexts()).some((text) => text.includes("left out of the map")) &&
    (await page.locator("#right .tropa-offmap").count()) === 0);
  await page.screenshot({ path: SHOTS + "80-scope.png" });

  await page.click('button:text-is("Whole map")'); await wait(page, 300);
  const layoutKey = () => page.evaluate("tropa.app.workspace.center.view.layoutKey");
  const before = await layoutKey();
  await setScope(page, "excludeFolders", "Attachments\nTropa");
  ok("scope: folders saved as a list", JSON.stringify(await page.evaluate("tropa.plugin.data.excludeFolders")) === '["Attachments","Tropa"]');
  ok("scope: a new shape is laid out again", (await layoutKey()) !== before);
  ok("scope: removing a folder brings the note back", (await page.evaluate("tropa.app.workspace.center.view.layout.nodes.has('Archive/Archived.md')")) && !(await absent("Archived")));
  ok("scope: its mark comes back with it", (await state(page, "Archived")).includes("state-mastered"));
  const notices = await page.evaluate("tropa.notices");
  ok("scope: excluding the concepts folder is warned about", notices.some((text) => text.includes("Tropa/Concepts is excluded")) &&
    notices.some((text) => text.includes("Tropa/Materials is excluded")), JSON.stringify(notices));

  await setScope(page, "excludeTags", "#Private\ncourse");
  ok("scope: tags saved without # in lower case", JSON.stringify(await page.evaluate("tropa.plugin.data.excludeTags")) === '["private","course"]');
  ok("scope: excluded goal is announced", (await page.evaluate("tropa.notices")).some((text) => text.includes("The goal Goal is left out")),
    JSON.stringify(await page.evaluate("tropa.notices")));
  await page.evaluate("tropa.app.workspace.setActive(null)"); await wait(page, 150);
  const hints = (await page.locator(".tropa-callout").allInnerTexts()).join(" | ");
  ok("scope: route explains the excluded goal", hints.includes("Choose another goal or change the settings"), hints);
  ok("scope: goal mark stays in the progress file", (await page.evaluate("tropa.app.vault.contents.get('Tropa/Progress.md')")).includes("[[Goal]]"));
  await page.screenshot({ path: SHOTS + "81-scope-goal.png" });
  ok("no console errors (scope)", errors.length === 0, JSON.stringify(errors));
  await page.close();
}
for (const [lang, callout, heading] of [["ru", "Эта заметка не попадает на карту", "Область карты"], ["ar", "هذه الملاحظة خارج الخريطة", "نطاق الخريطة"]]) {
  const { page, errors } = await open({ query: `?scenario=scope&panel=1&lang=${lang}` });
  // The map opens on the route, where Next is not shown, so the graph is asked directly.
  ok(`${lang}: excluded note not in the graph`, !(await page.evaluate("tropa.plugin.store.graph.nodes.has('Private note.md')")));
  ok(`${lang}: what needed it is available`, (await page.evaluate("tropa.plugin.store.states.get('Next.md')")) === "available");
  await page.evaluate("tropa.app.workspace.setActive(tropa.app.vault.files.get('Private note.md'))"); await wait(page, 200);
  const box = page.locator("#right .tropa-callout").first();
  ok(`${lang}: left-out callout translated`, (await box.innerText()).includes(callout), await box.innerText());
  if (lang === "ar") {
    ok("ar: callout right to left", (await box.evaluate((el) => getComputedStyle(el).direction)) === "rtl");
    await page.screenshot({ path: SHOTS + "82-scope-ar.png" });
  }
  await openSettings(page);
  const headings = await page.locator("#settings .setting-item-heading").allInnerTexts();
  ok(`${lang}: scope settings heading`, headings.includes(heading), headings.join("|"));
  ok(`no console errors (scope ${lang})`, errors.length === 0, JSON.stringify(errors));
  await page.close();
}

// --- skipping, confidence and marking what is known
{
  const { page, errors } = await open();
  const side = (label) => page.locator(`.tropa-side button:text-is("${label}")`);
  const legend = await page.locator(".tropa-legend-item:not(.is-review)").allInnerTexts();
  ok("legend shows skipped", legend.length === 5 && legend.at(-1) === "Skipped", legend.join("|"));

  await node(page, "Transformer").click(); await wait(page, 150);
  ok("goal cannot be skipped", (await side("Skip").count()) === 0);
  await page.evaluate("tropa.plugin.store.setSkipped(tropa.plugin.store.progress.goal, true)"); await wait(page, 150);
  ok("goal is not skipped from a command either", !(await state(page, "Transformer")).includes("state-skipped"));

  await node(page, "Probability").click(); await wait(page, 150);
  await side("Skip").click(); await wait(page, 300);
  ok("skip marks the concept", (await state(page, "Probability")).includes("state-skipped"));
  ok("skip toast", (await page.locator(".tropa-toast").innerText()).includes("Skipped: Probability"));
  ok("skip opens what depends on it", (await state(page, "Loss function")).includes("state-available"));
  ok("skipped is not counted as mastered", (await page.locator(".tropa-progress-text").innerText()) === "3 of 16, 1 skipped",
    await page.locator(".tropa-progress-text").innerText());
  ok("skipped leaves the route steps", !(await page.locator(".tropa-panel .tropa-step-title, .tropa-side .tropa-step-title").allInnerTexts()).includes("Probability"));
  await wait(page, 300);
  ok("skip saved as its own list", /skipped:\s*\n\s*- "?\[\[Probability\]\]/.test(await page.evaluate(PROG)), await page.evaluate(PROG));
  await page.screenshot({ path: SHOTS + "60-skipped.png" });
  await page.click(".tropa-toast button"); await wait(page, 400);
  ok("undo returns the concept", !(await state(page, "Probability")).includes("state-skipped"));
  ok("empty list leaves the file", !(await page.evaluate(PROG)).includes("skipped"), await page.evaluate(PROG));

  await node(page, "Probability").click(); await wait(page, 150);
  await side("Skip").click(); await wait(page, 250);
  ok("skipped callout", (await page.locator(".tropa-side .tropa-callout").innerText()).includes("does not count as mastered"));
  await side("Return to route").click(); await wait(page, 250);
  ok("return to route", (await state(page, "Probability")).includes("state-available"));

  // Confidence on a mastered concept: a level, then the same level again to clear it.
  await page.click('button:text-is("Whole map")'); await wait(page, 400);
  await node(page, "Derivatives").click(); await wait(page, 150);
  const dots = page.locator(".tropa-side .tropa-confidence-dot");
  ok("confidence shown for mastered", (await dots.count()) === 5);
  await dots.nth(3).click(); await wait(page, 300);
  ok("confidence pressed", (await page.locator(".tropa-side .tropa-confidence-dot").nth(3).getAttribute("aria-pressed")) === "true");
  ok("confidence saved", /confidence-4:\s*\n\s*- "?\[\[Derivatives\]\]/.test(await page.evaluate(PROG)), await page.evaluate(PROG));
  await page.screenshot({ path: SHOTS + "61-confidence.png" });
  await page.locator(".tropa-side .tropa-confidence-dot").nth(3).click(); await wait(page, 300);
  ok("confidence cleared", !(await page.evaluate(PROG)).includes("confidence-"));
  await node(page, "Probability").click(); await wait(page, 150);
  ok("no confidence for an unstarted concept", (await page.locator(".tropa-side .tropa-confidence").count()) === 0);

  // I know this and what it needs: the list, a filter, one box left out, one undo.
  await node(page, "Backpropagation").click(); await wait(page, 150);
  await side("I know this and what it needs").click(); await wait(page, 200);
  const modal = page.locator(".tropa-known-modal");
  const rows = modal.locator(".tropa-known-row");
  const listed = await rows.allInnerTexts();
  ok("known list starts with prerequisites and ends with the concept", listed.length > 2 && listed.at(-1).trim() === "Backpropagation", listed.join("|"));
  ok("mastered prerequisites are not offered", !listed.some((text) => text.trim() === "Derivatives"));
  ok("focus inside the dialog", await page.evaluate("!!document.activeElement.closest('.tropa-known-modal')"));
  const confirm = modal.locator("button.mod-cta");
  ok("confirm counts the concepts", (await confirm.innerText()) === `Mark ${listed.length} concepts`, await confirm.innerText());
  await page.screenshot({ path: SHOTS + "62-known.png" });
  await modal.locator(".tropa-known-filter").fill("descent"); await wait(page, 100);
  ok("filter narrows the list", (await modal.locator(".tropa-known-row:not(.is-hidden)").count()) === 1);
  await modal.locator(".tropa-known-row:not(.is-hidden) input").press("Space"); await wait(page, 100);
  ok("space unticks a concept", (await confirm.innerText()) === `Mark ${listed.length - 1} concepts`, await confirm.innerText());
  await modal.locator(".tropa-known-filter").press("Enter"); await wait(page, 400);
  ok("dialog closes on confirm", (await page.locator(".tropa-known-modal").count()) === 0);
  ok("concept marked known", (await state(page, "Backpropagation")).includes("state-mastered"));
  ok("prerequisite marked known", (await state(page, "Loss function")).includes("state-mastered"));
  ok("unticked concept left alone", !(await state(page, "Gradient descent")).includes("state-mastered"));
  ok("bulk toast", (await page.locator(".tropa-toast").innerText()).includes(`${listed.length - 1} concepts marked as known`), await page.locator(".tropa-toast").innerText());
  await wait(page, 300);
  ok("bulk saved", (await page.evaluate(PROG)).includes("[[Backpropagation]]"));
  await page.click(".tropa-toast button"); await wait(page, 400);
  ok("one undo for the whole batch", !(await state(page, "Backpropagation")).includes("state-mastered") && !(await state(page, "Loss function")).includes("state-mastered"));

  // The same from the context menu, closed with Escape.
  await node(page, "Backpropagation").click({ button: "right" }); await wait(page, 100);
  await page.click('.menu-item:text-is("I know this and what it needs")'); await wait(page, 200);
  ok("context menu opens the list", (await page.locator(".tropa-known-modal").count()) === 1);
  await page.keyboard.press("Escape"); await wait(page, 100);
  ok("escape closes without marking", (await page.locator(".tropa-known-modal").count()) === 0 && !(await state(page, "Backpropagation")).includes("state-mastered"));
  ok("no console errors (statuses)", errors.length === 0, JSON.stringify(errors));
  await page.close();
}
{
  const { page, errors } = await open({ query: "?lang=ru" });
  await node(page, "Вероятность").click(); await wait(page, 150);
  await page.click('.tropa-side button:text-is("Пропустить")'); await wait(page, 300);
  ok("ru: skip", (await state(page, "Вероятность")).includes("state-skipped"));
  ok("ru: skip toast", (await page.locator(".tropa-toast").innerText()).includes("Пропущено: Вероятность"));
  ok("ru: skipped count", (await page.locator(".tropa-progress-text").innerText()).endsWith("1 пропущен"), await page.locator(".tropa-progress-text").innerText());
  await node(page, "Обратное распространение").click(); await wait(page, 150);
  await page.click('.tropa-side button:text-is("Знаю это и всё, что нужно до него")'); await wait(page, 200);
  const count = await page.locator(".tropa-known-row").count();
  const label = await page.locator(".tropa-known-modal button.mod-cta").innerText();
  const forms = new Intl.PluralRules("ru").select(count);
  const word = { one: "концепт", few: "концепта", many: "концептов", other: "концепта" }[forms];
  ok("ru: plural in confirm", label === `Отметить ${count} ${word}`, label);
  await page.keyboard.press("Escape");
  ok("no console errors (ru statuses)", errors.length === 0, JSON.stringify(errors));
  await page.close();
}
{
  const { page, errors } = await open({ query: "?lang=ar" });
  await node(page, "Probability").click(); await wait(page, 150);
  await page.click('.tropa-side button:text-is("تخطٍّ")'); await wait(page, 300);
  ok("ar: skip", (await state(page, "Probability")).includes("state-skipped"));
  await node(page, "Backpropagation").click(); await wait(page, 150);
  await page.click('.tropa-side button:text-is("أعرف هذا وكل ما يسبقه")'); await wait(page, 200);
  const modal = page.locator(".tropa-known-modal");
  ok("ar: dialog is right to left", (await modal.getAttribute("dir")) === "rtl");
  const titleDir = await modal.locator(".tropa-known-title").first().evaluate((el) => getComputedStyle(el).direction);
  ok("ar: English titles keep their direction", titleDir === "ltr", titleDir);
  ok("ar: no raw placeholders", !/[{}]/.test(await modal.innerText()));
  await page.screenshot({ path: SHOTS + "63-known-ar.png" });
  await page.keyboard.press("Escape");
  ok("no console errors (ar statuses)", errors.length === 0, JSON.stringify(errors));
  await page.close();
}

// --- materials listed in the concept itself
const GRADIENT = `${CONCEPTS}/Gradient.md`;
const setMaterials = (page, path, list) =>
  page.evaluate(([p, l]) => {
    const vault = tropa.app.vault;
    if (!vault.getAbstractFileByPath("Files/scan.pdf")) vault.seed("Files/scan.pdf", "");
    return tropa.app.fileManager.processFrontMatter(vault.getAbstractFileByPath(p), (fm) => (fm.materials = l));
  }, [path, list]);
const rowTitles = (page) => page.locator(".tropa-side .tropa-material .tropa-row-title").allInnerTexts();
{
  const { page, errors } = await open();
  await node(page, "Gradient").click(); await wait(page, 150);
  const before = await rowTitles(page);
  const minutesBefore = await page.evaluate("tropa.plugin.store.route.remainingMinutes");
  await setMaterials(page, GRADIENT, [
    { url: "https://www.khanacademy.org/math/multivariable-calculus/gradient", title: "Khan Academy, Gradient", format: "video", minutes: 15 },
    "[[scan.pdf]]",
    "https://NUMPY.org/doc/stable/user/quickstart.html/",
  ]);
  await wait(page, 300);
  const after = await rowTitles(page);
  ok("inline link shown", after.includes("Khan Academy, Gradient"), after.join("|"));
  ok("inline attachment shown", after.includes("scan"), after.join("|"));
  ok("same URL as a note shows the note", after.includes("NumPy quickstart") && after.length === before.length + 3, after.join("|"));
  ok("one node for the note", (await page.evaluate("tropa.plugin.store.graph.sources.filter((n) => n.title === 'NumPy quickstart').length")) === 1);
  const meta = await page.locator('.tropa-side .tropa-material:has-text("Khan Academy") .tropa-material-meta').innerText();
  ok("inline material format and time", meta.includes("Video") && meta.includes("15 min"), meta);
  const pdfMeta = await page.locator('.tropa-side .tropa-material:has-text("scan") .tropa-material-meta').innerText();
  ok("attachment format guessed", pdfMeta.includes("Paper"), pdfMeta);
  // The shortest ready material is recommended, so the 15-minute video replaces a longer one in the estimate.
  const step = await page.evaluate(`tropa.plugin.store.route.steps.find((s) => s.id === "${GRADIENT}")?.material`);
  ok("route uses the inline material", step === "material:https://www.khanacademy.org/math/multivariable-calculus/gradient", step);
  ok("route time follows it", (await page.evaluate("tropa.plugin.store.route.remainingMinutes")) !== minutesBefore);

  // Ticking: the URL is kept as it is, the attachment as a link that follows renames.
  await page.locator('.tropa-side .tropa-material:has-text("Khan Academy") input').check(); await wait(page, 300);
  await page.locator('.tropa-side .tropa-material:has-text("scan") input').check(); await wait(page, 300);
  const progress = await page.evaluate(PROG);
  ok("done-materials saved", /done-materials:\s*\n\s*- https:\/\/www\.khanacademy\.org\/math\/multivariable-calculus\/gradient\s*\n\s*- "?\[\[scan\.pdf\]\]/.test(progress), progress);
  ok("note materials stay in done", !/done:\s*\n\s*- https/.test(progress), progress);
  ok("ticking starts the concept", (await state(page, "Gradient")).includes("state-learning"));
  await page.evaluate("tropa.plugin.store.rebuild(true)"); await wait(page, 200);
  ok("done survives a reread", await page.locator('.tropa-side .tropa-material:has-text("scan") input').isChecked());

  // Opening: the attachment in Obsidian, the link outside.
  await page.evaluate("window.opened = []; window.open = (url) => { window.opened.push(url); return null; }");
  await page.locator('.tropa-side .tropa-material:has-text("scan") .tropa-row-title').click(); await wait(page, 150);
  ok("attachment opens in Obsidian", (await page.locator("#note .note-title").getAttribute("data-path")) === "Files/scan.pdf");
  await page.locator('.tropa-side .tropa-material:has-text("Khan Academy") .tropa-row-title').click(); await wait(page, 100);
  ok("link opens outside", (await page.evaluate("window.opened")).includes("https://www.khanacademy.org/math/multivariable-calculus/gradient"));

  // The map shows them as materials, and their details say where they live.
  await page.click('.tropa-toggle-sources'); await wait(page, 500);
  ok("inline material on the map", (await node(page, "Khan Academy, Gradient").count()) === 1);
  await node(page, "Khan Academy, Gradient").click(); await wait(page, 150);
  ok("inline hint", (await page.locator(".tropa-side").innerText()).includes("Listed in the concept itself"));
  await node(page, "Khan Academy, Gradient").click({ button: "right" }); await wait(page, 100);
  ok("context menu opens the source", (await page.locator('.menu-item:text-is("Open source")').count()) === 1);
  await page.keyboard.press("Escape");
  await page.click('.tropa-toggle-sources'); await wait(page, 400);

  // Detaching edits the concept's own list; the note keeps teaching its own concept.
  await node(page, "Gradient").click(); await wait(page, 150);
  await page.locator('.tropa-side .tropa-material:has-text("NumPy quickstart") button[aria-label^="Detach"]').click({ force: true }); await wait(page, 350);
  ok("detached from the concept list", !(await note(page, GRADIENT)).includes("numpy"), await note(page, GRADIENT));
  ok("note material untouched", (await note(page, "Tropa/Example/Materials/NumPy quickstart.md")).includes("[[Python and NumPy]]"));
  ok("inline row removed", !(await rowTitles(page)).includes("NumPy quickstart"));

  // Adding a link without a note.
  await page.click('.tropa-side button:has-text("Add material")'); await wait(page, 100);
  await page.keyboard.type("Wikipedia, Gradient"); await wait(page, 100); await page.keyboard.press("Enter"); await wait(page, 200);
  await page.locator('.modal input[placeholder="https://example.com"]').fill("https://en.wikipedia.org/wiki/Gradient");
  await page.locator(".modal .checkbox-container input").check();
  await page.screenshot({ path: SHOTS + "70-inline-modal.png" });
  await page.click('.modal button:text-is("Add material")'); await wait(page, 400);
  ok("inline material added", (await rowTitles(page)).includes("Wikipedia, Gradient"));
  ok("no note created", (await page.evaluate("tropa.app.vault.getMarkdownFiles().filter((f) => f.basename.startsWith('Wikipedia')).length")) === 0);
  ok("written to the concept", (await note(page, GRADIENT)).includes("https://en.wikipedia.org/wiki/Gradient"), await note(page, GRADIENT));
  // Keeping a material in the concept needs a link.
  await page.click('.tropa-side button:has-text("Add material")'); await wait(page, 100);
  await page.keyboard.type("Nothing"); await wait(page, 100); await page.keyboard.press("Enter"); await wait(page, 200);
  await page.locator(".modal .checkbox-container input").check();
  await page.click('.modal button:text-is("Add material")'); await wait(page, 150);
  ok("link required", (await page.evaluate("tropa.notices")).some((text) => text.includes("[[file.pdf]]")));
  await page.keyboard.press("Escape"); await wait(page, 100);

  // Picking an attachment puts it into the concept.
  await node(page, "Derivatives").click(); await wait(page, 150);
  await page.click('.tropa-side button:has-text("Add material")'); await wait(page, 100);
  await page.keyboard.type("scan"); await wait(page, 150);
  ok("attachment offered", (await page.locator('.suggestion-item:has-text("Attachment")').count()) === 1);
  await page.click('.suggestion-item:has-text("Attachment")'); await wait(page, 400);
  ok("attachment attached", (await rowTitles(page)).includes("scan"));
  ok("attachment written as a link", (await note(page, `${CONCEPTS}/Derivatives.md`)).includes("[[scan.pdf]]"), await note(page, `${CONCEPTS}/Derivatives.md`));
  ok("shared attachment is one node", (await page.evaluate("tropa.plugin.store.graph.nodes.get('material:Files/scan.pdf').teaches.length")) === 2);
  await page.screenshot({ path: SHOTS + "71-inline-materials.png" });
  ok("no console errors (inline materials)", errors.length === 0, JSON.stringify(errors));
  await page.close();
}
{
  const { page, errors } = await open({ query: "?lang=ru" });
  await setMaterials(page, "Tropa/Пример/Концепты/Градиент.md", [{ url: "https://ru.wikipedia.org/wiki/Градиент", title: "Википедия", minutes: 10 }]);
  await wait(page, 300);
  await node(page, "Градиент").click(); await wait(page, 150);
  ok("ru: inline material", (await rowTitles(page)).includes("Википедия"));
  await page.click('.tropa-side button:has-text("Добавить материал")'); await wait(page, 100);
  await page.keyboard.type("Конспект"); await wait(page, 100); await page.keyboard.press("Enter"); await wait(page, 200);
  ok("ru: toggle label", (await page.locator('.modal .setting-item-name:text-is("Оставить в концепте")').count()) === 1);
  await page.keyboard.press("Escape");
  await page.click('.tropa-toggle-sources'); await wait(page, 500);
  await node(page, "Википедия").click(); await wait(page, 150);
  ok("ru: inline hint", (await page.locator(".tropa-side").innerText()).includes("Указан прямо в концепте"));
  ok("no console errors (ru inline materials)", errors.length === 0, JSON.stringify(errors));
  await page.close();
}
{
  const { page, errors } = await open({ query: "?lang=ar" });
  await setMaterials(page, GRADIENT, [{ url: "https://example.com/gradient", title: "What is a gradient?", minutes: 10 }]);
  await wait(page, 300);
  await node(page, "Gradient").click(); await wait(page, 150);
  const title = page.locator('.tropa-side .tropa-material:has-text("What is a gradient?") .tropa-row-title');
  ok("ar: inline material", (await title.count()) === 1);
  ok("ar: English title keeps its direction", (await title.evaluate((el) => getComputedStyle(el).direction)) === "ltr");
  await page.click('.tropa-side .tropa-add:has-text("إضافة مادة")'); await wait(page, 100);
  await page.keyboard.type("x"); await wait(page, 100); await page.keyboard.press("Enter"); await wait(page, 200);
  const modal = page.locator(".modal");
  ok("ar: modal right to left", (await page.locator(".modal-container .modal, .modal").first().evaluate((el) => el.closest("[dir]")?.getAttribute("dir"))) === "rtl");
  ok("ar: toggle translated", (await modal.locator('.setting-item-name:text-is("إبقاؤها في المفهوم")').count()) === 1);
  ok("ar: no raw placeholders", !/[{}]/.test(await modal.innerText()));
  await page.screenshot({ path: SHOTS + "72-inline-modal-ar.png" });
  await page.keyboard.press("Escape");
  ok("no console errors (ar inline materials)", errors.length === 0, JSON.stringify(errors));
  await page.close();
}

// --- Russian interface and vaults made before translation
{
  const { page, errors } = await open({ query: "?lang=ru" });
  ok("russian interface", (await page.locator('button:text-is("Вся карта")').count()) === 1);
  ok("russian example", (await page.locator(".tropa-goal-label").innerText()) === "Трансформер");
  ok("russian paths", (await page.evaluate("tropa.plugin.settings.conceptsFolder")) === "Tropa/Концепты");
  ok("no console errors (ru)", errors.length === 0, JSON.stringify(errors));
  await page.close();
}
{
  const { page, errors } = await open({ query: "?sample=ru" });
  ok("legacy vault keeps russian paths", (await page.evaluate("tropa.plugin.settings.progressPath")) === "Tropa/Прогресс.md");
  ok("legacy progress is read", (await page.locator(".tropa-goal-label").innerText()) === "Трансформер");
  ok("english interface on legacy vault", (await page.locator('button:text-is("Whole map")').count()) === 1);
  ok("no console errors (legacy)", errors.length === 0, JSON.stringify(errors));
  await page.close();
}

// --- other languages: translated, no raw placeholders, no errors
const KEYS = /\b(mapTitle|stepsToGoal|leftToUnlock|materialCount|conceptsFirst|progressOf)\b|[{}]/;
for (const [lang, wholeMap] of [["de", "Ganze Karte"], ["ja", "マップ全体"], ["ar", "الخريطة كاملة"], ["zh-TW", "整張地圖"], ["pt-PT", "Mapa completo"]]) {
  const { page, errors } = await open({ query: `?lang=${lang}&panel=1` });
  await node(page, "Tokenization").click(); await wait(page, 200);
  const text = await page.locator("body").innerText();
  ok(`${lang}: translated`, (await page.locator(`button:text-is("${wholeMap}")`).count()) === 1);
  ok(`${lang}: no raw keys`, !KEYS.test(text), text.match(KEYS)?.[0]);
  ok(`${lang}: example stays English`, (await page.locator(".tropa-goal-label").innerText()) === "Transformer");
  ok(`${lang}: direction`, (await page.locator(".tropa-map").getAttribute("dir")) === (lang === "ar" ? "rtl" : "ltr"));
  if (lang === "ar") {
    // Text from notes keeps its own direction inside the right-to-left interface.
    // The step title is renamed in place to a title that ends with punctuation, the visible case of the defect.
    const bidi = await page.evaluate(() => {
      const first = (el) => el.querySelector("[dir=auto]") ?? el;
      const side = document.querySelector(".tropa-side");
      const step = document.querySelector(".tropa-panel .tropa-step-title");
      step.textContent = "What is AI?";
      // x of the first and the last character as drawn: in left-to-right text the last one is further right.
      const ends = (el) => {
        const text = el.firstChild, range = document.createRange();
        range.setStart(text, 0); range.setEnd(text, 1); const head = range.getBoundingClientRect().left;
        range.setStart(text, text.length - 1); range.setEnd(text, text.length); const tail = range.getBoundingClientRect().left;
        return tail > head;
      };
      const dir = (el) => getComputedStyle(el).direction;
      const meta = document.querySelector(".tropa-panel .tropa-step-meta");
      const summary = side.querySelector(".tropa-summary");
      const box = summary.getBoundingClientRect(), range = document.createRange();
      range.selectNodeContents(summary);
      return {
        summary: dir(summary) === "ltr" && ends(summary) && summary.textContent.endsWith("."),
        summaryAligned: Math.abs(box.right - range.getBoundingClientRect().right) < 2,
        title: dir(first(side.querySelector(".tropa-title"))) === "ltr",
        step: dir(step) === "ltr" && ends(step),
        rows: [...side.querySelectorAll(".tropa-row-title")].every((el) => dir(el) === "ltr" && ends(el)),
        nodes: [...document.querySelectorAll(".tropa-node-title")].every((el) => dir(el) === "ltr"),
        goal: dir(document.querySelector(".tropa-goal-label")) === "ltr",
        // A mixed line stays right to left; the material name inside it is isolated and comes first.
        meta: (() => {
          const [name, separator, time] = [...meta.children].map((el) => el.getBoundingClientRect());
          return dir(meta) === "rtl" && dir(meta.children[0]) === "ltr" && name.left >= separator.right - 1
            && (time.top > separator.top + 1 || time.right <= separator.left + 1);
        })(),
        hint: [...document.querySelectorAll(".tropa-panel .tropa-hint")].some((el) => el.textContent.includes("\u2068Transformer\u2069")),
      };
    });
    for (const [name, pass] of Object.entries(bidi)) ok(`ar: note text direction (${name})`, pass);
    await page.click('.tropa-goal'); await wait(page, 150);
    await page.click('.menu-item:text-is("استبداله بهدف آخر…")'); await wait(page, 150);
    ok("ar: picker items take their own direction", await page.evaluate(() =>
      [...document.querySelectorAll(".modal .tropa-pick-text > div[dir=auto]")].length > 0
      && [...document.querySelectorAll(".modal .tropa-pick-text > div[dir=auto]")].every((el) => getComputedStyle(el).direction === "ltr")));
    await page.keyboard.press("Escape"); await wait(page, 100);
    await page.evaluate(() => { document.querySelector(".tropa-panel .tropa-step-title").textContent = "Chain rule"; });
  }
  if (lang === "ar" || lang === "ja") {
    for (const theme of ["light", "dark"]) {
      await page.evaluate((dark) => document.body.classList.replace(dark ? "theme-light" : "theme-dark", dark ? "theme-dark" : "theme-light"), theme === "dark");
      await page.screenshot({ path: `${SHOTS}60-${lang}-${theme}.png` });
    }
    await page.click('.tropa-side button:has-text("' + (lang === "ar" ? "إضافة مادة" : "教材を追加") + '")'); await wait(page, 150);
    ok(`${lang}: modal direction`, (await page.locator(".modal").getAttribute("dir")) === (lang === "ar" ? "rtl" : null));
    await page.screenshot({ path: `${SHOTS}61-${lang}-modal.png` });
    if (lang === "ar") {
      const input = page.locator(".modal input").first();
      ok("ar: empty search keeps the interface direction", (await input.evaluate((el) => getComputedStyle(el).direction)) === "rtl");
      await input.fill("What is AI?");
      ok("ar: typed Latin text runs left to right", (await input.evaluate((el) => getComputedStyle(el).direction)) === "ltr");
      await input.fill("");
      ok("ar: cleared search returns to right to left", (await input.evaluate((el) => getComputedStyle(el).direction)) === "rtl");
    }
  }
  ok(`no console errors (${lang})`, errors.length === 0, JSON.stringify(errors));
  await page.close();
}

// --- dark, narrow, phone
{
  const { page } = await open({ query: "?theme=dark", scale: 2 });
  await node(page, "Tokenization").click(); await wait(page, 200);
  await page.screenshot({ path: SHOTS + "40-dark.png" });
  await page.close();
}
{
  const { page } = await open({ width: 420, height: 860, query: "?theme=dark" });
  await page.screenshot({ path: SHOTS + "41-narrow.png" });
  ok("no horizontal overflow", await page.evaluate("document.documentElement.scrollWidth<=innerWidth"));
  ok("narrow class", (await page.locator(".tropa-map.is-narrow").count()) === 1);
  await page.close();
}

// --- dashes on a small map stay when zoomed out
const dashes = (page, kind) => page.evaluate((k) => getComputedStyle(document.querySelector(`.tropa-edge.is-${k}`)).strokeDasharray, kind);
{
  const { page } = await open();
  await page.click('button:text-is("Whole map")');
  await page.click(".tropa-toggle-sources"); await wait(page, 400);
  for (let i = 0; i < 8 && !(await page.locator(".tropa-world.is-far").count()); i++) {
    await page.click(".tropa-zoom button >> nth=1"); await wait(page, 120);
  }
  ok("example zoomed out", (await page.locator(".tropa-world.is-far").count()) === 1);
  const teaches = await dashes(page, "teaches");
  ok("example keeps dashes zoomed out", teaches !== "none" && (await page.locator(".tropa-world.is-dense").count()) === 0, teaches);
  await page.close();
}

// --- the side panel keeps its scroll when the map changes
{
  const { page, errors } = await open({ height: 500 });
  await node(page, "Backpropagation").click(); await wait(page, 200);
  const side = page.locator(".tropa-side");
  await side.evaluate((el) => (el.scrollTop = 120));
  await page.evaluate(() => tropa.app.workspace.center.view.store.setMastered("Tropa/Example/Concepts/Chain rule.md", true)); await wait(page, 200);
  const kept = await side.evaluate((el) => el.scrollTop);
  ok("side panel keeps its scroll on a change", kept === 120, String(kept));
  await page.keyboard.press("Escape"); await wait(page, 200);
  ok("another item starts at the top", (await side.evaluate((el) => el.scrollTop)) === 0);
  ok("side scroll: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}

// --- map audit
{
  const { page } = await open();
  ok("no audit button on a clean map", (await page.locator("#center .tropa-audit-button.is-hidden").count()) === 1 && !(await page.locator("#center .tropa-audit-button").isVisible()));
  await page.close();
}
const runCommand = (page, id) => page.evaluate((cid) => tropa.plugin.commands.find((c) => c.id === cid).callback(), id);
const auditCount = (page, kind) => page.evaluate((k) => document.querySelector(`.tropa-audit-section.is-${k} .tropa-audit-count`)?.textContent ?? "0", kind);
{
  const { page, errors } = await open({ query: "?scenario=audit" });
  const button = page.locator("#center .tropa-audit-button");
  ok("audit button shows the count", (await button.isVisible()) && (await button.innerText()).trim() === "11" && (await button.getAttribute("aria-label")) === "Map audit: 11 things to look at", await button.getAttribute("aria-label"));
  ok("audit button warns about the cycle", (await button.getAttribute("class")).includes("has-cycles"));
  await button.click(); await wait(page, 200);
  ok("audit button opens the audit", (await page.locator("#note .tropa-audit h2").count()) === 1);
  await page.screenshot({ path: SHOTS + "62-audit-button.png", clip: { x: 0, y: 0, width: 1120, height: 60 } });
  ok("audit command is registered", await page.evaluate(() => tropa.plugin.commands.some((c) => c.id === "audit-map" && c.name === "Audit the map")));
  await runCommand(page, "audit-map"); await wait(page, 200);
  ok("audit opens", (await page.locator(".tropa-audit h2").innerText()) === "Map audit");
  ok("audit summary counts findings", (await page.locator(".tropa-audit-summary").innerText()) === "11 things to look at", await page.locator(".tropa-audit-summary").innerText());
  const counts = {};
  for (const kind of ["cycles", "ghosts", "duplicates", "no-materials", "orphans"]) counts[kind] = await auditCount(page, kind);
  ok("audit groups", JSON.stringify(counts) === JSON.stringify({ cycles: "1", ghosts: "1", duplicates: "1", "no-materials": "7", orphans: "1" }), JSON.stringify(counts));
  const chain = await page.locator(".tropa-audit-chip").allInnerTexts();
  ok("cycle shown as a chain back to its start", chain.length === 4 && chain[0] === chain[3] && new Set(chain).size === 3, chain.join(" → "));
  ok("ghost shows who links to it", (await page.locator(".is-ghosts .tropa-audit-meta").innerText()) === "Linked from 1 note");
  ok("notes out of the map's scope are not in the audit", (await page.locator('.tropa-audit [data-id="Archive/Old idea.md"], .tropa-audit-name:text-is("Old idea")').count()) === 0);
  ok("duplicates listed together", (await page.locator(".is-duplicates .tropa-audit-name").allInnerTexts()).sort().join() === "Café,cafe");
  await page.screenshot({ path: SHOTS + "60-audit.png" });
  // Show on the map: the lone note gets selected on the map.
  await page.locator('.is-orphans .tropa-audit-row[data-id="Lonely.md"] .tropa-audit-map').click(); await wait(page, 300);
  ok("show on map selects the note", (await page.locator("#center .tropa-side .tropa-title").innerText()) === "Lonely");
  // Create the missing note: the audit follows the vault.
  await page.locator(".is-ghosts .tropa-audit-create").click(); await wait(page, 500);
  ok("missing note created", await page.evaluate(() => [...tropa.app.vault.contents.keys()].some((path) => path.endsWith("/Missing note.md"))));
  ok("audit updates after a fix", (await page.locator(".tropa-audit-section.is-ghosts").count()) === 0 && (await auditCount(page, "no-materials")) === "8");
  // A row opens its note.
  await page.locator('.is-no-materials .tropa-audit-row[data-id="Calculus.md"] .tropa-audit-main').click(); await wait(page, 200);
  ok("row opens its note", (await page.locator("#note .note-title").innerText()) === "Calculus");
  ok("audit: no console errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  const { page } = await open({ query: "?scenario=audit&lang=ru" });
  await runCommand(page, "audit-map"); await wait(page, 200);
  ok("ru: audit in Russian", (await page.locator(".tropa-audit h2").innerText()) === "Проверка карты" && (await page.locator(".tropa-audit-summary").innerText()) === "11 мест требуют внимания", await page.locator(".tropa-audit-summary").innerText());
  ok("ru: audit button label", (await page.locator("#center .tropa-audit-button").getAttribute("aria-label")) === "Проверка карты: 11 мест требуют внимания");
  ok("ru: command name", await page.evaluate(() => tropa.plugin.commands.find((c) => c.id === "audit-map").name === "Проверить карту"));
  await page.close();
}
{
  const { page, errors } = await open({ query: "?scenario=audit&lang=ar&theme=dark" });
  await runCommand(page, "audit-map"); await wait(page, 200);
  const arButton = await page.evaluate(() => {
    const button = document.querySelector("#center .tropa-audit-button");
    const add = document.querySelector("#center .tropa-add-concept");
    const eleven = new Intl.NumberFormat("ar").format(11);
    return { label: button.getAttribute("aria-label"), expected: `فحص الخريطة: ${eleven} أمرًا للمراجعة`, rtl: getComputedStyle(button).direction === "rtl", order: button.getBoundingClientRect().left > add.getBoundingClientRect().left, count: button.textContent.trim(), eleven };
  });
  ok("ar: audit button right to left, with a plural label", arButton.rtl && arButton.order && arButton.label === arButton.expected && arButton.count === arButton.eleven, JSON.stringify(arButton));
  ok("ar: audit right to left", (await page.locator(".tropa-audit[dir=rtl]").count()) === 1 && (await page.locator(".tropa-audit h2").innerText()) === "فحص الخريطة");
  ok("ar: Latin names keep their own direction", await page.evaluate(() => getComputedStyle(document.querySelector(".tropa-audit-name")).direction === "ltr"));
  ok("ar: arrows point along the chain", await page.evaluate(() => getComputedStyle(document.querySelector(".tropa-audit-arrow svg")).transform !== "none"));
  await page.screenshot({ path: SHOTS + "61-audit-ar.png" });
  ok("ar audit: no console errors", errors.length === 0, errors.join("; "));
  await page.close();
}

// --- focus on what is near, fold branches
const mapView = "tropa.app.workspace.center.view";
const nodeCount = (page) => page.locator(".tropa-node").count();
const worldTransform = (page) => page.evaluate(() => document.querySelector(".tropa-world").style.transform);
const fold = (page, title) => node(page, title).locator(".tropa-fold");
{
  const { page, errors } = await open();
  const all = await nodeCount(page);
  ok("focus needs a selection", await page.locator(".tropa-focus-toggle").isDisabled());
  await node(page, "Gradient").click(); await wait(page, 300);
  const view = await worldTransform(page);
  await node(page, "Gradient").focus(); await page.keyboard.press("f"); await wait(page, 500);
  ok("F focuses on what is near", (await nodeCount(page)) === 4 && (await node(page, "Derivatives").count()) === 1 && (await node(page, "Gradient descent").count()) === 1 && (await node(page, "Transformer").count()) === 0, String(await nodeCount(page)));
  ok("focus bar shows the focus", (await page.locator(".tropa-focus.is-active .tropa-focus-toggle[aria-pressed=true]").count()) === 1 && (await page.locator(".tropa-toast").innerText()).includes("Focus: Gradient"));
  await page.keyboard.press("2"); await wait(page, 500);
  ok("two steps around", (await nodeCount(page)) === 8 && (await page.locator('.tropa-focus-depth button[data-depth="2"][aria-pressed=true]').count()) === 1, String(await nodeCount(page)));
  await page.click(".tropa-toggle-sources"); await wait(page, 500);
  const sources = await page.locator(".tropa-node.is-source").count();
  ok("materials of what is in focus", sources > 0 && (await page.locator(".tropa-node.is-concept").count()) === 8, String(sources));
  await page.click(".tropa-toggle-sources"); await wait(page, 400);
  ok("focus lays out its own shape", (await page.evaluate(`${mapView}.layoutKey`)).split("#").pop().split("|").length === 8);
  ok("focus kept with the view", (await page.evaluate(`${mapView}.getState().focus?.depth`)) === 2 && (await page.evaluate("tropa.app.workspace.layoutSaves")) > 0);
  await page.screenshot({ path: SHOTS + "90-focus.png" });
  await page.keyboard.press("Escape"); await wait(page, 600);
  ok("Esc leaves focus where the map was", (await nodeCount(page)) === all && (await worldTransform(page)) === view && (await page.locator(".tropa-focus.is-active").count()) === 0, `${await worldTransform(page)} vs ${view}`);
  ok("leaving focus keeps the selection", (await page.locator(".tropa-side .tropa-title").innerText()) === "Gradient");
  await page.keyboard.press("Escape"); await wait(page, 200);

  // Fold Backpropagation on the route: what needs it goes, the route list says so.
  await node(page, "Backpropagation").hover();
  await fold(page, "Backpropagation").click(); await wait(page, 500);
  ok("fold hides what needs it", (await node(page, "Transformer").count()) === 0 && (await node(page, "Embeddings").count()) === 0 && (await node(page, "Chain rule").count()) === 1);
  const badge = await fold(page, "Backpropagation").innerText();
  ok("fold badge counts what it hides", badge === "+4", badge);
  ok("folded node is collapsed", (await node(page, "Backpropagation").getAttribute("aria-expanded")) === "false" && (await fold(page, "Backpropagation").getAttribute("class")).includes("has-route"));
  ok("fold is announced", (await page.locator(".tropa-toast[role=status]").innerText()).includes("4 concepts hidden"));
  ok("route list marks hidden steps", (await page.locator(".tropa-side .tropa-step.is-hidden-on-map").count()) === 4);
  await page.screenshot({ path: SHOTS + "91-folded.png" });
  await page.locator('.tropa-side .tropa-step:has-text("Transformer")').click(); await wait(page, 500);
  ok("picking a hidden step unfolds it", (await node(page, "Transformer").count()) === 1 && (await node(page, "Backpropagation").getAttribute("aria-expanded")) === "true");
  await page.keyboard.press("Escape"); await wait(page, 200);
  await node(page, "Backpropagation").focus(); await page.keyboard.press("c"); await wait(page, 500);
  ok("C folds the focused concept", (await node(page, "Transformer").count()) === 0);
  await page.click(".tropa-toast button"); await wait(page, 500);
  ok("undo unfolds", (await node(page, "Transformer").count()) === 1);
  ok("a concept that opens nothing has no fold", (await fold(page, "Transformer").getAttribute("class")).includes("is-hidden") && (await node(page, "Transformer").getAttribute("aria-expanded")) === null);
  await node(page, "Gradient").click({ button: "right" }); await wait(page, 100);
  ok("context menu offers focus and fold", (await page.locator('.menu-item:text-is("Show what is near")').count()) === 1 && (await page.locator('.menu-item:text-is("Hide what it opens")').count()) === 1);
  await page.click('.menu-item:text-is("Hide what it opens")'); await wait(page, 500);
  ok("context menu folds", (await node(page, "Gradient descent").count()) === 0);
  ok("focus and fold: no errors", errors.length === 0 && (await page.evaluate("tropa.missingIcons.size")) === 0, errors.join("; "));
  await page.close();
}
// Focus and folds on a map with excluded folders, and excluding what is focused or folded.
{
  const { page, errors } = await open({ query: "?scenario=scope" });
  await page.click('button:text-is("Whole map")'); await wait(page, 400);
  const titles = async () => (await page.locator(".tropa-node .tropa-node-title").allInnerTexts()).sort().join("|");
  ok("scope+focus: whole map without excluded notes", (await titles()) === "Base|Goal|Kept|Next", await titles());

  await node(page, "Base").click(); await wait(page, 200);
  await node(page, "Base").focus(); await page.keyboard.press("f"); await wait(page, 500);
  ok("scope+focus: focus leaves excluded notes out", (await titles()) === "Base|Goal|Kept", await titles());
  await setScope(page, "excludeFolders", "Archive\nAttachments\nTropa\nArchive 2");
  ok("scope+focus: excluding a note in focus keeps the focus", (await titles()) === "Base|Goal" && (await page.locator(".tropa-focus.is-active").count()) === 1, await titles());
  await setScope(page, "excludeFolders", "Archive\nAttachments\nTropa");
  ok("scope+focus: it comes back into focus", (await titles()) === "Base|Goal|Kept", await titles());
  await node(page, "Kept").click(); await wait(page, 200);
  await node(page, "Kept").focus(); await page.keyboard.press("f"); await wait(page, 500);
  ok("scope+focus: focus moves to Kept", (await page.evaluate(`${mapView}.getState().focus?.center`)) === "Archive 2/Kept.md");
  await setScope(page, "excludeFolders", "Archive\nAttachments\nTropa\nArchive 2");
  ok("scope+focus: excluding the focused note ends the focus", (await page.locator(".tropa-focus.is-active").count()) === 0 && (await titles()) === "Base|Goal|Next", await titles());

  await setScope(page, "excludeFolders", "Archive\nAttachments\nTropa");
  await page.keyboard.press("Escape"); await wait(page, 200);
  await node(page, "Base").hover();
  await fold(page, "Base").click(); await wait(page, 500);
  ok("scope+fold: fold hides what Base opens", (await titles()) === "Base|Next" && (await fold(page, "Base").innerText()) === "+2", `${await titles()} ${await fold(page, "Base").innerText()}`);
  await setScope(page, "excludeFolders", "Archive\nAttachments\nTropa\nArchive 2");
  ok("scope+fold: the badge counts only what is left", (await fold(page, "Base").innerText()) === "+1", await fold(page, "Base").innerText());
  await setScope(page, "excludeFolders", "Archive\nAttachments\nTropa");
  await fold(page, "Base").click(); await wait(page, 500);
  await node(page, "Kept").hover();
  await fold(page, "Kept").click(); await wait(page, 500);
  ok("scope+fold: fold Kept", (await titles()) === "Base|Kept|Next", await titles());
  await setScope(page, "excludeFolders", "Archive\nAttachments\nTropa\nArchive 2");
  ok("scope+fold: excluding the folded note shows what it hid", (await titles()) === "Base|Goal|Next", await titles());
  ok("scope+fold: a gone fold is not kept with the view", !(await page.evaluate(`${mapView}.getState().folded`)).includes("Archive 2/Kept.md"));
  ok("scope+focus+fold: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  const { page, errors } = await open({ query: "?lang=ru" });
  await node(page, "Градиент").click(); await wait(page, 200);
  await node(page, "Градиент").focus(); await page.keyboard.press("f"); await wait(page, 500);
  ok("ru: focus", (await nodeCount(page)) === 4 && (await page.locator(".tropa-focus-toggle").innerText()).includes("Фокус"));
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await wait(page, 300);
  await node(page, "Обратное распространение").focus(); await page.keyboard.press("c"); await wait(page, 500);
  const label = await fold(page, "Обратное распространение").getAttribute("aria-label");
  ok("ru: fold in plural forms", label.startsWith("Показать 4 скрытых концепта") && (await page.locator(".tropa-toast").innerText()).includes("Скрыто 4 концепта"), label);
  ok("ru: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  const { page, errors } = await open({ query: "?lang=ar" });
  await node(page, "Backpropagation").focus(); await page.keyboard.press("c"); await wait(page, 500);
  const box = await node(page, "Backpropagation").boundingBox();
  const badge = await fold(page, "Backpropagation").boundingBox();
  ok("ar: fold badge on the inline end, inside the node", badge.x < box.x + box.width / 2 && badge.x >= box.x, JSON.stringify({ box, badge }));
  await node(page, "Gradient").click(); await wait(page, 200);
  await page.click(".tropa-focus-toggle"); await wait(page, 500);
  ok("ar: focus from the bar", (await nodeCount(page)) === 4 && (await page.locator(".tropa-focus.is-active").count()) === 1);
  await page.screenshot({ path: SHOTS + "92-focus-ar.png" });
  await page.click(".tropa-focus-exit"); await wait(page, 500);
  ok("ar: exit button leaves focus", (await page.locator(".tropa-focus.is-active").count()) === 0);
  ok("ar: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}

// --- showing a note from the audit when the map has to change first
{
  // 1000 concepts with materials off: showing a material turns them on, and the new layout of
  // 1700 nodes takes the worker a moment. The material is centred once it is on screen.
  const { page, errors } = await open({ query: "?scenario=large&n=1000&materials&lone" });
  await page.waitForFunction(() => !document.querySelector(".tropa-canvas.is-laying-out"), null, { timeout: 60_000 });
  ok("large map starts without materials", (await page.locator(".tropa-node.is-source").count()) === 0);
  await runCommand(page, "audit-map"); await wait(page, 300);
  await page.locator('.is-orphans .tropa-audit-row[data-id="Lone material.md"] .tropa-audit-map').click();
  await page.waitForFunction(() => document.querySelector("#center .tropa-side .tropa-title")?.textContent === "Lone material", null, { timeout: 60_000 });
  // The map glides to the note and the nodes to their new places: wait until it settles inside the view.
  const inside = () => {
    const canvas = document.querySelector("#center .tropa-canvas").getBoundingClientRect();
    const node = document.querySelector('#center .tropa-node.is-selected[data-id="Lone material.md"]')?.getBoundingClientRect();
    return node && node.left >= canvas.left && node.right <= canvas.right && node.top >= canvas.top && node.bottom <= canvas.bottom;
  };
  await page.waitForFunction(inside, null, { timeout: 5000 }).catch(() => {});
  const placed = await page.evaluate(() => {
    const canvas = document.querySelector("#center .tropa-canvas").getBoundingClientRect();
    const node = document.querySelector('#center .tropa-node.is-selected[data-id="Lone material.md"]')?.getBoundingClientRect();
    return node && { inside: node.left >= canvas.left && node.right <= canvas.right && node.top >= canvas.top && node.bottom <= canvas.bottom, sources: document.querySelectorAll(".tropa-node.is-source").length };
  });
  ok("audit shows a material on a large map once it is laid out", placed?.inside && placed.sources === 701, JSON.stringify(placed));
  ok("large audit: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  // On the example: a folded branch and a focus give way to the note asked for.
  const { page, errors } = await open();
  const show = (path) => page.evaluate((p) => tropa.app.workspace.center.view.focusNode(p), path);
  await node(page, "Backpropagation").focus(); await page.keyboard.press("c"); await wait(page, 500);
  ok("fold hides Transformer", (await node(page, "Transformer").count()) === 0);
  await show("Tropa/Example/Concepts/Transformer.md"); await wait(page, 300);
  ok("showing a folded concept unfolds its branch", (await page.locator('.tropa-node.is-selected:has(.tropa-node-title:text-is("Transformer"))').count()) === 1);
  await node(page, "Backpropagation").focus(); await page.keyboard.press("c"); await wait(page, 500);
  await show("Tropa/Example/Materials/The Illustrated Transformer.md"); await wait(page, 500);
  ok("showing a material of a folded concept turns materials on and unfolds", (await page.locator('.tropa-node.is-source.is-selected:has(.tropa-node-title:text-is("The Illustrated Transformer"))').count()) === 1);
  await page.evaluate(() => tropa.app.workspace.center.view.select("Tropa/Example/Concepts/Gradient.md"));
  await node(page, "Gradient").focus(); await page.keyboard.press("f"); await wait(page, 500);
  ok("focus is on", (await page.locator(".tropa-focus.is-active").count()) === 1 && (await node(page, "Tokenization").count()) === 0);
  await show("Tropa/Example/Concepts/Tokenization.md"); await wait(page, 500);
  ok("showing a concept outside the focus leaves the focus", (await page.locator(".tropa-focus.is-active").count()) === 0 && (await page.locator('.tropa-node.is-selected:has(.tropa-node-title:text-is("Tokenization"))').count()) === 1);
  ok("show on map: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}

// --- export to Canvas and SVG
const today = () => { const d = new Date(); return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((p) => String(p).padStart(2, "0")).join("-"); };
const exportVia = async (page, item) => {
  await page.click(".tropa-export"); await wait(page, 100);
  await page.click(`.menu-item:text-is("${item}")`); await wait(page, 150);
};
const vaultFile = (page, path) => page.evaluate((p) => tropa.app.vault.contents.get(p) ?? null, path);
const command = (page, id) => page.evaluate((i) => tropa.plugin.commands.find((c) => c.id === i).callback(), id);
{
  const { page, errors } = await open();
  const canvasPath = `Tropa/Transformer ${today()}.canvas`;
  await exportVia(page, "Export map to Canvas");
  ok("export asks where to save", (await page.locator(".tropa-export-path").inputValue()) === canvasPath && (await page.locator(".modal-title").innerText()) === "Export map to Canvas");
  ok("a new file is saved, not replaced", (await page.locator(".tropa-export-save").innerText()) === "Save" && (await page.locator(".tropa-export-exists.is-hidden").count()) === 1);
  await page.screenshot({ path: SHOTS + "95-export-modal.png" });
  await page.click(".tropa-export-save"); await wait(page, 300);
  const text = await vaultFile(page, canvasPath);
  const canvas = JSON.parse(text);
  const shown = await page.evaluate(() => {
    const view = tropa.app.workspace.center.view;
    return { nodes: view.layout.nodes.size, edges: view.layout.edges.length, gradient: view.layout.nodes.get("Tropa/Example/Concepts/Gradient.md") };
  });
  ok("canvas has the map's nodes and edges", canvas.nodes.length === shown.nodes && canvas.edges.length === shown.edges, `${canvas.nodes.length}/${shown.nodes} ${canvas.edges.length}/${shown.edges}`);
  const gradient = canvas.nodes.find((n) => n.file === "Tropa/Example/Concepts/Gradient.md");
  ok("canvas keeps the map's positions", gradient && gradient.x === Math.round(shown.gradient.x) && gradient.y === Math.round(shown.gradient.y) && gradient.width === Math.round(shown.gradient.width), JSON.stringify(gradient));
  const files = await page.evaluate(() => [...tropa.app.vault.files.keys()]);
  ok("canvas file nodes point at vault files", canvas.nodes.filter((n) => n.type === "file").every((n) => files.includes(n.file)));
  const ids = new Set(canvas.nodes.map((n) => n.id));
  ok("canvas edges join its nodes", canvas.edges.every((e) => ids.has(e.fromNode) && ids.has(e.toNode) && ["top", "bottom", "left", "right"].includes(e.fromSide)));
  ok("canvas colors mastered concepts and the goal", canvas.nodes.some((n) => n.color === "4") && canvas.nodes.filter((n) => n.color === "6").length === 1);
  ok("export is written with tabs and opened", text.startsWith('{\n\t"nodes"') && (await page.locator(`#note .note-title[data-path="${canvasPath}"]`).count()) === 1);
  ok("export is reported", (await page.evaluate("tropa.notices")).includes(`Saved to ${canvasPath}`));

  // The same path again: nothing is replaced until asked.
  await page.evaluate((p) => tropa.app.vault.contents.set(p, "kept"), canvasPath);
  await exportVia(page, "Export map to Canvas");
  ok("an existing file is named", (await page.locator(".tropa-export-exists").innerText()).includes("already exists") && (await page.locator(".tropa-export-save").innerText()) === "Replace");
  await page.click(".tropa-export-rename"); await wait(page, 100);
  const second = `Tropa/Transformer ${today()} 2.canvas`;
  ok("keep both suggests a free name", (await page.locator(".tropa-export-path").inputValue()) === second && (await page.locator(".tropa-export-save").innerText()) === "Save");
  await page.locator(".checkbox-container input").uncheck();
  await page.click(".tropa-export-save"); await wait(page, 300);
  ok("keep both leaves the first file alone", (await vaultFile(page, canvasPath)) === "kept" && (await vaultFile(page, second)) !== null);
  ok("without progress there are no colors", JSON.parse(await vaultFile(page, second)).nodes.every((n) => n.color === undefined));
  await exportVia(page, "Export map to Canvas");
  await page.click(".tropa-export-save"); await wait(page, 300);
  ok("replace is explicit and writes the map", (await vaultFile(page, canvasPath)).startsWith("{"));
  await exportVia(page, "Export map to Canvas");
  await page.locator(".tropa-export-path").fill("../outside");
  ok("a path outside the vault cannot be saved", await page.locator(".tropa-export-save").isDisabled());
  await page.keyboard.press("Escape");

  // SVG of the current view, from the command.
  await page.click('button:text-is("Whole map")'); await wait(page, 400);
  await command(page, "export-svg"); await wait(page, 200);
  const svgPath = `Tropa/Learning map ${today()}.svg`;
  ok("svg export is named after the map", (await page.locator(".tropa-export-path").inputValue()) === svgPath);
  await page.click(".tropa-export-save"); await wait(page, 300);
  const svg = await vaultFile(page, svgPath);
  const check = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    return {
      error: doc.querySelector("parsererror")?.textContent ?? "",
      texts: [...doc.querySelectorAll("text")].map((el) => el.textContent),
      paths: doc.querySelectorAll("path").length,
      background: doc.querySelector("rect")?.getAttribute("fill"),
      edges: document.querySelectorAll(".tropa-edges path").length,
    };
  }, svg);
  ok("svg is well-formed", check.error === "", check.error);
  ok("svg has the titles, badges and edges", check.texts.includes("Probability") && check.texts.includes("Transformer") && check.texts.includes("Next step") && check.texts.includes("Goal") && check.paths >= check.edges, JSON.stringify({ paths: check.paths, edges: check.edges }));
  ok("svg uses the light theme", check.background === "#ffffff", check.background);
  await page.evaluate((text) => {
    const img = document.createElement("img");
    img.id = "svg-preview";
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
    Object.assign(img.style, { position: "fixed", inset: "0", zIndex: 9999, background: "#888", maxWidth: "100vw", maxHeight: "100vh" });
    document.body.appendChild(img);
  }, svg);
  await wait(page, 300);
  await page.screenshot({ path: SHOTS + "96-svg-light.png" });
  ok("export: no errors", errors.length === 0 && (await page.evaluate("tropa.missingIcons.size")) === 0, errors.join("; "));
  await page.close();
}
{
  const { page, errors } = await open({ query: "?theme=dark" });
  await command(page, "export-svg"); await wait(page, 200);
  await page.click(".tropa-export-save"); await wait(page, 300);
  const svg = await vaultFile(page, `Tropa/Transformer ${today()}.svg`);
  const background = await page.evaluate((text) => new DOMParser().parseFromString(text, "image/svg+xml").querySelector("rect").getAttribute("fill"), svg);
  ok("svg uses the dark theme", background !== "#ffffff" && /^#[0-3]/.test(background), background);
  await page.evaluate((text) => {
    const img = document.createElement("img");
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
    Object.assign(img.style, { position: "fixed", inset: "0", zIndex: 9999, maxWidth: "100vw", maxHeight: "100vh" });
    document.body.appendChild(img);
  }, svg);
  await wait(page, 300);
  await page.screenshot({ path: SHOTS + "97-svg-dark.png" });
  // While the worker lays the map out there is nothing finished to export.
  await page.evaluate(() => (tropa.app.workspace.center.view.layoutPending = true));
  await command(page, "export-canvas"); await wait(page, 200);
  ok("export waits for the layout", (await page.evaluate("tropa.notices")).some((t) => t.includes("still being laid out")) && (await page.locator(".tropa-export-path").count()) === 0);
  ok("dark export: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  const { page, errors } = await open({ query: "?lang=ru" });
  await exportVia(page, "Экспортировать карту в Canvas");
  ok("ru: export dialog", (await page.locator(".tropa-export-save").innerText()) === "Сохранить" && (await page.locator(".tropa-export-path").inputValue()).startsWith("Tropa/Трансформер"));
  await page.click(".tropa-export-save"); await wait(page, 300);
  ok("ru: saved", (await page.evaluate("tropa.notices")).some((t) => t.startsWith("Сохранено: Tropa/Трансформер")));
  ok("ru: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  const { page, errors } = await open({ query: "?lang=ar" });
  await exportVia(page, "تصدير الخريطة بصيغة SVG");
  ok("ar: export dialog is right to left", (await page.locator(".modal").getAttribute("dir")) === "rtl" && (await page.locator(".tropa-export-save").innerText()) === "حفظ");
  await page.screenshot({ path: SHOTS + "98-export-ar.png" });
  await page.click(".tropa-export-save"); await wait(page, 300);
  const svg = await page.evaluate(() => [...tropa.app.vault.contents.entries()].find(([p]) => p.endsWith(".svg"))?.[1] ?? "");
  const error = await page.evaluate((text) => new DOMParser().parseFromString(text, "image/svg+xml").querySelector("parsererror")?.textContent ?? "", svg);
  ok("ar: svg saved and well-formed", svg.length > 0 && error === "", error);
  ok("ar: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}

// --- export follows the map: scope, focus, folds; the bar stays out of the drawing
const lastExport = (page, extension) => page.evaluate((ext) => [...tropa.app.vault.contents.entries()].filter(([p]) => p.endsWith(ext)).pop()?.[1] ?? "", extension);
const svgTexts = (page, text) => page.evaluate((t) => [...new DOMParser().parseFromString(t, "image/svg+xml").querySelectorAll("text")].map((el) => el.textContent), text);
const saveExport = async (page, id) => {
  await command(page, id); await wait(page, 200);
  await page.click(".tropa-export-save"); await wait(page, 300);
};
{
  const { page, errors } = await open({ query: "?scenario=scope" });
  await page.click('button:text-is("Whole map")'); await wait(page, 400);
  await saveExport(page, "export-canvas");
  const canvas = JSON.parse(await lastExport(page, ".canvas"));
  const targets = canvas.nodes.map((n) => n.file ?? n.url ?? n.text);
  ok("export leaves out what the map scope excludes", !targets.some((f) => /Archived|Private note|Inline tagged/.test(f)) && targets.includes("Archive 2/Kept.md") && targets.length === (await nodeCount(page)), targets.join("|"));
  await saveExport(page, "export-svg");
  const texts = await svgTexts(page, await lastExport(page, ".svg"));
  ok("svg leaves out what the map scope excludes", texts.includes("Kept") && !texts.some((t) => /Archived|Private note|Inline tagged/.test(t)), texts.join("|"));
  ok("scope export: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  const { page, errors } = await open({ query: "?scenario=audit" });
  ok("audit button is shown", await page.locator("#center .tropa-audit-button").isVisible());
  await saveExport(page, "export-svg");
  const svg = await lastExport(page, ".svg");
  const texts = await svgTexts(page, svg);
  ok("the bar and the audit button stay out of the svg", !texts.includes("11") && !svg.includes("Map audit") && !texts.includes("Whole map"), texts.join("|"));
  ok("audit export: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  const { page, errors } = await open();
  await node(page, "Gradient").click(); await wait(page, 200);
  await node(page, "Gradient").focus(); await page.keyboard.press("f"); await wait(page, 500);
  await saveExport(page, "export-canvas");
  const focused = JSON.parse(await lastExport(page, ".canvas"));
  ok("export in focus has only what is near", focused.nodes.length === 4 && focused.nodes.length === (await nodeCount(page)), String(focused.nodes.length));
  await page.click(".tropa-focus-exit"); await wait(page, 400);
  await node(page, "Backpropagation").focus(); await page.keyboard.press("c"); await wait(page, 500);
  await saveExport(page, "export-canvas");
  const folded = JSON.parse(await lastExport(page, ".canvas"));
  const files = folded.nodes.map((n) => n.file ?? n.text);
  ok("export of a folded map leaves the branch out", !files.some((f) => /Transformer|Embeddings/.test(f)) && folded.nodes.length === (await nodeCount(page)), files.join("|"));
  await saveExport(page, "export-svg");
  ok("svg shows the fold badge", (await svgTexts(page, await lastExport(page, ".svg"))).includes("+4"));
  ok("focus and fold export: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}

// --- phone: touches through CDP on a 390×844 screen with Obsidian's bar and side-panel swipe
const touchPad = async (page) => {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })) });
  const frames = (n) => page.waitForTimeout(n * 16);
  return {
    async drag(from, to, steps = 10) {
      await send("touchStart", [from]);
      for (let i = 1; i <= steps; i++) { await send("touchMove", [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]); await frames(1); }
      await send("touchEnd", []);
    },
    async tap(p) { await send("touchStart", [p]); await frames(3); await send("touchEnd", []); },
    async hold(p, ms) { await send("touchStart", [p]); await page.waitForTimeout(ms); await send("touchEnd", []); },
    async pinch(c, from, to, steps = 10) {
      const at = (d) => [{ x: c.x - d / 2, y: c.y }, { x: c.x + d / 2, y: c.y }];
      await send("touchStart", at(from));
      for (let i = 1; i <= steps; i++) { await send("touchMove", at(from + ((to - from) * i) / steps)); await frames(1); }
      await send("touchEnd", []);
    },
  };
};
const phone = (query) => open({ width: 390, height: 844, touch: true, query: `?phone&${query}` });
const box = (page, selector) => page.evaluate((sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height } : null; }, selector);
const nodeBox = async (page, title) => { const b = await node(page, title).boundingBox(); return b && { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height, width: b.width, height: b.height }; };
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const mapState = (page) => page.evaluate(() => { const v = tropa.app.workspace.center.view; return { x: v.x, y: v.y, k: v.k }; });
const swipeCount = (page) => page.evaluate("tropa.swipes.length");
const conceptPath = (page, title) => page.evaluate((t) => [...tropa.app.vault.files.keys()].find((p) => p.endsWith(`/${t}.md`)), title);
/** Scrolls a panel to its end: its last control must sit fully above Obsidian's navigation bar. */
async function scrolledEndClear(page, selector) {
  return page.evaluate((sel) => {
    const panel = document.querySelector(sel);
    panel.scrollTop = panel.scrollHeight;
    const nav = document.querySelector(".mobile-navbar").getBoundingClientRect();
    const view = panel.getBoundingClientRect();
    const controls = [...panel.querySelectorAll("button, a, input, [role=button], [tabindex]")].filter((el) => el.getClientRects().length);
    const last = controls.reduce((low, el) => (el.getBoundingClientRect().bottom > low.getBoundingClientRect().bottom ? el : low));
    const box = last.getBoundingClientRect();
    return { clear: box.bottom <= nav.top && box.bottom <= view.bottom, last: last.textContent.trim().slice(0, 40), bottom: Math.round(box.bottom), nav: Math.round(nav.top), panel: Math.round(view.bottom) };
  }, selector);
}
async function phonePanelEnds(page, label) {
  const view = "tropa.app.workspace.center.view";
  for (const state of ["half", "full"]) {
    await page.evaluate((s) => tropa.app.workspace.center.view.setSheet(s), state); await wait(page, 350);
    const end = await scrolledEndClear(page, "#center .tropa-side");
    ok(`${label}: the panel's last control scrolls clear of Obsidian's bar (${state})`, end.clear, JSON.stringify(end));
  }
  await page.evaluate(`${view}.setSheet("peek")`); await wait(page, 350);
  const sheet = await box(page, "#center .tropa-side");
  const nav = await box(page, ".mobile-navbar");
  ok(`${label}: the panel ends above Obsidian's bar (peek)`, sheet.bottom <= nav.top, JSON.stringify({ sheet: sheet.bottom, nav: nav.top }));
}
async function phoneLayoutChecks(page, label, title) {
  const bar = await box(page, "#center .tropa-bar");
  const rows = await page.evaluate(() => [...document.querySelectorAll("#center .tropa-bar > *")]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).position !== "absolute")
    .map((el) => Math.round(el.getBoundingClientRect().top)));
  ok(`${label}: the bar is one row`, bar.height <= 56 && Math.max(...rows) - Math.min(...rows) <= 4, JSON.stringify({ height: bar.height, rows }));
  ok(`${label}: no horizontal overflow`, await page.evaluate("document.documentElement.scrollWidth <= innerWidth"));
  const nav = await box(page, ".mobile-navbar");
  for (const state of ["peek", "half", "full"]) {
    const heading = await box(page, `#center .tropa-side ${title}`);
    const sheet = await box(page, "#center .tropa-side");
    const zoom = await box(page, "#center .tropa-zoom");
    const zoomShown = await page.evaluate(() => getComputedStyle(document.querySelector("#center .tropa-zoom")).display !== "none");
    ok(`${label}: panel title above Obsidian's bar (${state})`, heading && heading.bottom <= nav.top && heading.top >= bar.bottom && sheet.bottom <= nav.top + 1, JSON.stringify({ heading, nav: nav.top, sheet }));
    ok(`${label}: zoom buttons clear of the panel (${state})`, state === "full" ? !zoomShown : zoomShown && zoom.bottom <= sheet.top, JSON.stringify({ zoom, sheet: sheet.top }));
    await (await touchPad(page)).tap({ x: 195, y: sheet.top + 12 }); await wait(page, 350);
  }
  ok(`${label}: the handle cycles back to the title`, (await page.locator("#center .tropa-side[data-sheet=peek]").count()) === 1);
}
{
  const { page, errors } = await phone("lang=ru&theme=dark");
  await page.screenshot({ path: SHOTS + "70-phone-ru-dark.png" });
  const pad = await touchPad(page);
  await phoneLayoutChecks(page, "phone ru", ".tropa-title");
  const nextNode = await box(page, '.tropa-node.is-next');
  const zoom = await box(page, "#center .tropa-zoom");
  ok("phone: opens readable, on the next step", (await mapState(page)).k >= 0.7 && nextNode && nextNode.top > 50 && nextNode.bottom < 680 && !overlaps(nextNode, zoom), JSON.stringify({ k: (await mapState(page)).k, nextNode }));
  ok("phone: no dots to drag links from", await page.evaluate(() => [...document.querySelectorAll(".tropa-port")].every((el) => getComputedStyle(el).display === "none")));
  ok("phone: fold badges stay out of the way", await page.evaluate(() => [...document.querySelectorAll(".tropa-fold:not(.is-hidden)")].every((el) => getComputedStyle(el).opacity === "0")));

  // Swipes: inside the map they pan and never reach Obsidian's side panels; on the bar they still do.
  const before = await mapState(page);
  await pad.drag({ x: 60, y: 300 }, { x: 330, y: 310 });
  await wait(page, 100);
  const after = await mapState(page);
  ok("phone: a swipe on the map pans it", after.x - before.x > 200, JSON.stringify({ before, after }));
  ok("phone: a swipe on the map does not open a side panel", (await swipeCount(page)) === 0, String(await swipeCount(page)));
  await pad.drag({ x: 40, y: 640 }, { x: 330, y: 645 });
  ok("phone: a swipe on the panel does not open a side panel", (await swipeCount(page)) === 0);
  await pad.drag({ x: 100, y: 24 }, { x: 360, y: 26 });
  ok("phone: a swipe on the bar still opens a side panel", (await swipeCount(page)) === 1, String(await swipeCount(page)));

  // Pinch zooms around the fingers and pans with them.
  const center = { x: 195, y: 380 };
  const start = await mapState(page);
  const worldX = (center.x - start.x) / start.k;
  await pad.pinch(center, 100, 160);
  await wait(page, 100);
  const pinched = await mapState(page);
  ok("phone: pinch zooms", Math.abs(pinched.k / start.k - 1.6) < 0.08 || pinched.k === 1.6, JSON.stringify({ start, pinched }));
  ok("phone: pinch keeps the map under the fingers", Math.abs(center.x - (pinched.x + worldX * pinched.k)) < 3, JSON.stringify({ worldX, pinched }));
  ok("phone: pinch does not open a side panel", (await swipeCount(page)) === 1);
  await page.locator(".tropa-zoom button >> nth=2").click(); await wait(page, 400);
  const fitted = await mapState(page);
  ok("phone: fit stays readable", fitted.k >= 0.7, String(fitted.k));
  await pad.tap({ x: 30, y: 560 }); await page.waitForTimeout(80); await pad.tap({ x: 30, y: 560 }); await wait(page, 400);
  const tapped = await mapState(page);
  ok("phone: double tap zooms in", Math.abs(tapped.k / fitted.k - 1.6) < 0.05 || tapped.k === 1.6, JSON.stringify({ fitted, tapped }));
  await page.locator(".tropa-zoom button >> nth=2").click(); await wait(page, 400);

  // Long press on a concept: its menu, with the way to link it now that there are no dots.
  await page.screenshot({ path: SHOTS + "71-phone-ru-light-before-menu.png" });
  const descent = await nodeBox(page, "Градиентный спуск");
  await pad.hold({ x: descent.left + 40, y: descent.top + 20 }, 750); await wait(page, 150);
  ok("phone: long press opens the concept's menu", (await page.locator('.menu-item:text-is("Связать со следующим концептом…")').count()) === 1,
    JSON.stringify({ descent, menus: await page.locator(".menu-item").allInnerTexts(), pointers: await page.evaluate("tropa.app.workspace.center.view.pointers.size"), at: await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, { x: descent.left + 40, y: descent.top + 20 }) }));
  ok("phone: long press selects the concept", (await page.locator("#center .tropa-side .tropa-title").innerText()) === "Градиентный спуск");
  await page.screenshot({ path: SHOTS + "72-phone-ru-dark-menu.png" });
  await page.click('.menu-item:text-is("Связать со следующим концептом…")'); await wait(page, 150);
  await page.locator(".prompt-input").fill("Токениз"); await wait(page, 100);
  await page.click('.suggestion-item:has-text("Токенизация")'); await wait(page, 400);
  ok("phone: link to the next concept from the menu", (await note(page, await conceptPath(page, "Токенизация"))).includes("[[Градиентный спуск]]"));
  const moved = await mapState(page);
  await pad.hold({ x: 30, y: 300 }, 200);
  await pad.drag({ x: descent.left + 40, y: descent.top + 20 }, { x: descent.left + 140, y: descent.top + 60 }, 6);
  await wait(page, 600);
  ok("phone: moving the finger cancels the long press", (await page.locator(".menu").count()) === 0 && (await mapState(page)).x !== moved.x);

  // The menu behind "⋯": what the bar holds on a wider screen.
  await page.click("#center .tropa-more"); await wait(page, 150);
  const items = await page.locator(".menu-item").allInnerTexts();
  ok("phone: ⋯ holds materials, focus, audit, export and a new concept", ["Материалы", "Фокус", "Проверка карты", "Экспортировать карту в Canvas", "Экспортировать карту в SVG", "Новый концепт"].every((text) => items.some((item) => item.startsWith(text))), items.join(" | "));
  await page.click('.menu-item:text-is("Материалы")'); await wait(page, 500);
  ok("phone: materials from the menu", (await page.locator(".tropa-node.is-source").count()) > 0);
  await page.click("#center .tropa-more"); await wait(page, 150);
  ok("phone: the menu marks materials as on", (await page.locator(".menu-item.mod-checked").allInnerTexts()).some((text) => text.startsWith("Материалы")));
  await page.click('.menu-item:text-is("Материалы")'); await wait(page, 400);
  await page.click('#center .tropa-mode-icons button[data-mode="all"]'); await wait(page, 500);
  ok("phone: whole map from the icon", (await page.locator('#center .tropa-mode-icons button[data-mode="all"][aria-pressed=true]').count()) === 1 && (await page.locator('#center .tropa-mode-icons button[data-mode="all"]').getAttribute("aria-label")) === "Вся карта");
  ok("phone: progress reads out", (await page.locator("#center .tropa-meter").getAttribute("aria-valuetext")).includes("из"));
  ok("phone ru: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  const { page, errors } = await phone("lang=ru");
  await page.screenshot({ path: SHOTS + "73-phone-ru-light.png" });
  await node(page, "Градиент").click(); await wait(page, 400);
  ok("phone: picking a concept opens the panel halfway", (await page.locator("#center .tropa-side[data-sheet=half]").count()) === 1);
  const fold = page.locator('.tropa-node:has(.tropa-node-title:text-is("Градиент")) .tropa-fold');
  // On screen: the badge and its invisible margin, both scaled with the map.
  const target = await fold.evaluate((el) => {
    const k = tropa.app.workspace.center.view.k;
    const after = getComputedStyle(el, "::after");
    return { width: (el.offsetWidth - parseFloat(after.left) - parseFloat(after.right)) * k, height: (el.offsetHeight - parseFloat(after.top) - parseFloat(after.bottom)) * k, opacity: getComputedStyle(el).opacity };
  });
  ok("phone: fold badge is small, its target finger-sized", target.opacity === "1" && target.width >= 32 && target.height >= 32, JSON.stringify({ target, k: (await mapState(page)).k }));
  await page.evaluate(() => { const side = document.querySelector("#center .tropa-side"); side.scrollTop = side.scrollHeight; }); await wait(page, 150);
  await page.screenshot({ path: SHOTS + "74-phone-ru-light-half.png" });
  await phonePanelEnds(page, "phone ru");
  ok("phone ru light: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
for (const lang of ["ru", "ar"]) {
  // The route panel in Obsidian's drawer: its end scrolls clear of the navigation bar too.
  const { page, errors } = await phone(`lang=${lang}&panel`);
  const gradient = await conceptPath(page, lang === "ru" ? "Градиент" : "Gradient");
  await page.evaluate((id) => tropa.app.workspace.right.view.select(id), gradient); await wait(page, 300);
  const end = await scrolledEndClear(page, "#right .tropa-panel");
  ok(`phone ${lang}: the sidebar panel's last control scrolls clear of Obsidian's bar`, end.clear, JSON.stringify(end));
  if (lang === "ru") await page.screenshot({ path: SHOTS + "76-phone-ru-panel.png" });
  ok(`phone ${lang} panel: no errors`, errors.length === 0, errors.join("; "));
  await page.close();
}
{
  // Without Obsidian's own opt-out the map still keeps its touches from the side-panel swipe.
  const { page } = await phone("lang=ru&swipeAll");
  const pad = await touchPad(page);
  await pad.drag({ x: 60, y: 300 }, { x: 330, y: 310 });
  ok("phone: the map holds its touches back even without data-ignore-swipe", (await swipeCount(page)) === 0);
  await pad.drag({ x: 100, y: 24 }, { x: 360, y: 26 });
  ok("phone: swipes elsewhere still reach Obsidian", (await swipeCount(page)) === 1);
  await page.close();
}
{
  const { page, errors } = await phone("lang=ar&theme=dark");
  await phoneLayoutChecks(page, "phone ar", ".tropa-title");
  const pad = await touchPad(page);
  const next = await box(page, ".tropa-node.is-next");
  await pad.hold({ x: next.left + 60, y: next.top + 20 }, 750); await wait(page, 150);
  ok("phone ar: long press menu", (await page.locator('.menu-item:text-is("ربط بالمفهوم التالي…")').count()) === 1, JSON.stringify({ next, menus: await page.locator(".menu-item").allInnerTexts() }));
  // The click a lifted finger makes is held back for a moment; a tap after that closes the menu.
  await wait(page, 600); await page.mouse.click(5, 400); await wait(page, 100);
  ok("phone ar: a later tap closes the menu", (await page.locator(".menu").count()) === 0);
  await pad.drag({ x: 330, y: 300 }, { x: 60, y: 310 });
  ok("phone ar: a swipe on the map does not open a side panel", (await swipeCount(page)) === 0,
    JSON.stringify({ swipes: await page.evaluate("tropa.swipes"), at: await page.evaluate(() => { const el = document.elementFromPoint(330, 300); return `${el?.tagName}.${el?.className} ${el?.closest("[data-ignore-swipe]") ? "ignored" : ""}`; }) }));
  ok("phone ar: bar right to left in one row", (await page.locator("#center .tropa-map[dir=rtl]").count()) === 1);
  await page.screenshot({ path: SHOTS + "75-phone-ar-dark.png" });
  await page.evaluate(async (title) => tropa.app.workspace.center.view.select([...tropa.app.vault.files.keys()].find((p) => p.endsWith(`/${title}.md`))), "Gradient"); await wait(page, 400);
  await phonePanelEnds(page, "phone ar");
  ok("phone ar: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  // A tablet or a wide window keeps the full bar.
  const { page } = await open({ width: 1024, height: 768, query: "?theme=dark" });
  ok("desktop: no phone bar", (await page.locator("#center .tropa-map.is-phone").count()) === 0 && (await page.locator("#center .tropa-more").isVisible()) === false && (await page.locator("#center .tropa-toggle-sources").isVisible()));
  await page.close();
}

// --- large graph performance
const view = "tropa.app.workspace.center.view";
const layoutDone = (page) => page.waitForFunction(() => !document.querySelector(".tropa-canvas.is-laying-out"), null, { timeout: 60_000 });
{
  const { page, errors, logs } = await open({ query: "?scenario=large&n=400" });
  await layoutDone(page);
  ok("large graph renders", (await page.locator(".tropa-node").count()) === 400);
  ok("large graph laid out in the worker", (await page.evaluate(`${view}.layouts.stats.inWorker`)) >= 1);
  const engine = await page.evaluate(`${view}.layouts.stats.engine`);
  ok("WebAssembly engine runs in the worker", engine === "wasm in a worker", engine);
  ok("the engine choice stays out of the console", !logs.some((line) => line.startsWith("Tropa")), logs.join(" | "));
  const ms = await page.evaluate(`(()=>{const t=performance.now(); const v=${view}; v.layoutKey=''; v.render(); return performance.now()-t})()`);
  console.log("400 nodes, cached layout, render ms", Math.round(ms));
  ok("same shape comes from the cache", (await page.evaluate(`${view}.layouts.stats.cached`)) >= 1);
  await page.screenshot({ path: SHOTS + "50-large.png" });
  ok("large graph: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
// A scope change on a large map: a new shape, laid out again by WebAssembly in the worker.
{
  const { page, errors } = await open({ query: "?scenario=large&n=400&archive" });
  await layoutDone(page);
  ok("scope (large): all notes before the change", (await page.locator(".tropa-node").count()) === 400);
  const key = await page.evaluate(`${view}.layoutKey`);
  const cached = await page.evaluate(`${view}.layouts.stats.cached`);
  const inWorker = await page.evaluate(`${view}.layouts.stats.inWorker`);
  await setScope(page, "excludeFolders", "Archive");
  await layoutDone(page);
  ok("scope (large): excluded folder leaves the map", (await page.locator(".tropa-node").count()) === 360, String(await page.locator(".tropa-node").count()));
  ok("scope (large): new layout key", (await page.evaluate(`${view}.layoutKey`)) !== key);
  ok("scope (large): the new shape is not taken from the cache", (await page.evaluate(`${view}.layouts.stats.cached`)) === cached);
  ok("scope (large): laid out in the worker", (await page.evaluate(`${view}.layouts.stats.inWorker`)) > inWorker);
  const engine = await page.evaluate(`${view}.layouts.stats.engine`);
  ok("scope (large): by WebAssembly", engine === "wasm in a worker", engine);
  ok("scope (large): no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  // 1000 concepts; materials on make it 1700 nodes: about 0.7 s for the WebAssembly engine, 1.5 s for TypeScript.
  const { page, errors } = await open({ query: "?scenario=large&n=1000&materials&holdlayout" });
  await layoutDone(page);
  ok("1000 concepts render", (await page.locator(".tropa-node").count()) === 1000);
  // Let the browser finish drawing the first map before timing anything.
  await wait(page, 1500);
  await page.evaluate(() => {
    // Longest gap between timer ticks while the worker lays out: how long the interface would freeze.
    const watch = (window.freeze = { longest: 0, pending: 0, last: performance.now(), was: false, on: true });
    const tick = () => {
      const now = performance.now();
      const busy = Boolean(document.querySelector(".tropa-canvas.is-laying-out"));
      if (busy && watch.was) {
        watch.longest = Math.max(watch.longest, now - watch.last);
        watch.pending += now - watch.last;
      }
      watch.was = busy;
      watch.last = now;
      if (watch.on) setTimeout(tick, 4);
    };
    tick();
  });
  // The answer is held until after the click below: the WebAssembly engine can finish 1700 nodes before a
  // click lands on a busy machine, and the click must come while the layout is pending.
  await page.evaluate(() => Object.assign(window.layoutHold, { on: true, since: performance.now(), arrived: 0 }));
  await page.click(".tropa-toggle-sources");
  ok("layout runs in the background", (await page.locator(".tropa-canvas.is-laying-out[aria-busy=true]").count()) === 1);
  // Timers alone first: a click or a screenshot makes the page draw, which is not the layout's doing.
  await wait(page, 250);
  const freeze = await page.evaluate(() => ({ ...window.freeze }));
  const zoom = () => page.evaluate(() => document.querySelector(".tropa-world").style.transform);
  const before = await zoom();
  const t = Date.now();
  await page.click(".tropa-zoom button >> nth=0");
  const clickMs = Date.now() - t;
  const stillLaying = (await page.locator(".tropa-canvas.is-laying-out").count()) === 1;
  ok("a click is handled while the layout runs", (await zoom()) !== before && stillLaying, `${clickMs} ms`);
  await page.screenshot({ path: SHOTS + "51-laying-out.png" });
  await page.evaluate(() => window.layoutHold.release());
  await layoutDone(page);
  // The worker's own time, from the toggle to its answer: the hold only delays the delivery.
  const total = await page.evaluate(() => ((window.freeze.on = false), (window.layoutHold.arrived || performance.now()) - window.layoutHold.since));
  console.log(`1700 nodes in the worker: ${Math.round(total)} ms; first ${Math.round(freeze.pending)} ms: longest pause ${Math.round(freeze.longest)} ms; click ${clickMs} ms`);
  ok("interface stays responsive during layout", freeze.pending > 200 && freeze.longest < 150, JSON.stringify(freeze));
  ok("materials laid out", (await page.locator(".tropa-node").count()) === 1700);
  const teaches = await dashes(page, "teaches");
  ok("large map zoomed out drops dashes", (await page.locator(".tropa-world.is-far.is-dense").count()) === 1 && teaches === "none", teaches);
  await page.click(".tropa-toggle-sources"); await layoutDone(page); await wait(page, 500);
  const drawn = Date.now();
  await page.click(".tropa-toggle-sources");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const drawMs = Date.now() - drawn;
  console.log(`1700 nodes from the cache drawn in ${drawMs} ms`);
  ok("large map draws without a long freeze", drawMs < 5000, `${drawMs} ms`);
  ok("switching back uses the cache", (await page.locator(".tropa-canvas.is-laying-out").count()) === 0 && (await page.locator(".tropa-node").count()) === 1700);
  // A mark changes states, not places: the edges stay as they are and only their route classes change.
  const repaint = await page.evaluate(() => {
    const view = tropa.app.workspace.center.view;
    const first = document.querySelector(".tropa-edges path");
    const t = performance.now();
    view.store.setMastered("Node 0.md", true);
    document.body.offsetHeight;
    return { ms: performance.now() - t, kept: first.isConnected, mastered: document.querySelector('.tropa-node[data-id="Node 0.md"]').className.includes("state-mastered") };
  });
  console.log(`mark on 1700 nodes: ${Math.round(repaint.ms)} ms`);
  ok("a mark repaints without rebuilding the edges", repaint.kept && repaint.mastered, JSON.stringify(repaint));
  ok("1000 concepts: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  // Folding a branch of a big map: the fold itself is cheap, the worker lays out the rest without a freeze,
  // unfolding comes back from the cache.
  const { page, errors, logs } = await open({ query: "?scenario=large&n=1000" });
  await layoutDone(page);
  await wait(page, 1500);
  const shape = () => page.evaluate(`({ key: ${mapView}.layoutKey, ...${mapView}.layouts.stats })`);
  const before = await shape();
  const timing = await page.evaluate(async () => {
    const view = tropa.app.workspace.center.view;
    let foldMs = 0;
    const shown = view.shownConcepts.bind(view);
    view.shownConcepts = (...args) => {
      const t = performance.now();
      const result = shown(...args);
      foldMs += performance.now() - t;
      return result;
    };
    // Longest gap between timer ticks while the worker lays out, as in the check above.
    const watch = { longest: 0, last: performance.now(), was: false, on: true };
    const tick = () => {
      const now = performance.now();
      const busy = Boolean(document.querySelector(".tropa-canvas.is-laying-out"));
      if (busy && watch.was) watch.longest = Math.max(watch.longest, now - watch.last);
      watch.was = busy;
      watch.last = now;
      if (watch.on) setTimeout(tick, 4);
    };
    tick();
    const t = performance.now();
    document.querySelector('.tropa-node[data-id="Node 100.md"] .tropa-fold').click();
    const clickMs = performance.now() - t;
    await new Promise((resolve) => {
      const done = () => (document.querySelector(".tropa-canvas.is-laying-out") ? setTimeout(done, 5) : resolve());
      done();
    });
    watch.on = false;
    view.shownConcepts = shown;
    return { foldMs, clickMs, longest: watch.longest, total: performance.now() - t };
  });
  await wait(page, 300);
  const left = await nodeCount(page);
  const hidden = await page.evaluate(() => Number(document.querySelector('.tropa-node[data-id="Node 100.md"] .tropa-fold').textContent.replace(/\D/g, "")));
  console.log(`fold on 1000 concepts: ${hidden} hidden; fold ${Math.round(timing.foldMs)} ms, click handler ${Math.round(timing.clickMs)} ms, longest pause during layout ${Math.round(timing.longest)} ms, all ${Math.round(timing.total)} ms`);
  ok("fold on a big map hides its branch", left < 1000 && left + hidden === 1000, `${left} + ${hidden}`);
  ok("fold on a big map is cheap and the layout does not freeze", timing.foldMs < 50 && timing.longest < 150, JSON.stringify(timing));
  const after = await shape();
  ok("a fold is a new map shape laid out by wasm in the worker", after.key !== before.key && after.inWorker > before.inWorker && after.engine === "wasm in a worker", JSON.stringify({ before, after }));
  ok("big fold: nothing in the console", !logs.some((line) => line.startsWith("Tropa")), logs.join(" | "));
  await page.evaluate(() => document.querySelector('.tropa-node[data-id="Node 100.md"] .tropa-fold').click());
  ok("unfold comes from the cache", (await page.locator(".tropa-canvas.is-laying-out").count()) === 0 && (await nodeCount(page)) === 1000);
  ok("big fold: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  const { page, errors } = await open({ query: "?scenario=large&n=400&noworker" });
  await layoutDone(page);
  ok("without workers the map still lays out", (await page.locator(".tropa-node").count()) === 400 && (await page.evaluate(`${view}.layouts.stats.inWorker`)) === 0);
  ok("without workers TypeScript runs on the main thread", (await page.evaluate(`${view}.layouts.stats.engine`)) === "ts on the main thread");
  ok("without workers: no page errors", !errors.some((e) => !e.includes("layout worker unavailable")), errors.join("; "));
  await page.close();
}
{
  const { page, errors, logs } = await open({ query: "?scenario=large&n=400&nowasm" });
  await layoutDone(page);
  const engine = await page.evaluate(`${view}.layouts.stats.engine`);
  ok("without WebAssembly the map lays out with TypeScript in the worker", (await page.locator(".tropa-node").count()) === 400 && engine === "ts in a worker", engine);
  const fallback = await page.evaluate(`${view}.layouts.stats.fallback`);
  ok("without WebAssembly the reason is kept in stats", fallback.startsWith("WebAssembly layout unavailable"), fallback);
  ok("without WebAssembly: nothing in the console", !logs.some((line) => line.startsWith("Tropa")), logs.join(" | "));
  ok("without WebAssembly: no page errors", errors.length === 0, errors.join("; "));
  await page.close();
}

// --- undo belongs to its change: anything else that changes the progress takes the offer away
async function undoChecks(page, label) {
  const side = (text) => page.locator(`.tropa-side button:text-is("${text}")`);
  const toasts = () => page.locator(".tropa-toast").count();
  // Picked through the view: on a phone the concept may start off screen.
  const pick = async (title) => page.evaluate((id) => tropa.app.workspace.center.view.select(id), await conceptPath(page, title));
  const chain = await conceptPath(page, "Chain rule");
  await page.evaluate(() => {
    window.undos = [];
    tropa.plugin.store.on("mastered", (_id, _unlocked, undo) => window.undos.push(undo));
  });
  const staleUndo = () => page.evaluate(() => tropa.plugin.store.undo(window.undos.at(-1)));

  await pick("Gradient"); await wait(page, 150);
  await side("I already know this").click(); await wait(page, 500);
  ok(`${label}: the toast outlives its own save`, (await toasts()) === 1 && (await page.evaluate(PROG)).includes("[[Gradient]]"));
  await page.click(".tropa-toast button"); await wait(page, 300);
  ok(`${label}: undo after the save still works`, !(await state(page, "Gradient")).includes("state-mastered"));

  await pick("Gradient"); await wait(page, 150);
  await side("I already know this").click(); await wait(page, 300);
  // Another way in, as from a command or the side panel: the map's toast is not replaced.
  await page.evaluate((id) => tropa.plugin.store.startLearning(id), chain); await wait(page, 300);
  ok(`${label}: another change takes the undo away`, (await toasts()) === 0);
  ok(`${label}: a stale undo does nothing`, (await staleUndo()) === false);
  ok(`${label}: and keeps both changes`, (await state(page, "Gradient")).includes("state-mastered") && (await state(page, "Chain rule")).includes("state-learning"));

  // A change from another device arrives through the progress file.
  await pick("Chain rule"); await wait(page, 150);
  await side("Mark as mastered").click(); await wait(page, 500);
  ok(`${label}: toast for the next change`, (await toasts()) === 1);
  await page.evaluate(() => {
    const file = tropa.app.vault.getAbstractFileByPath("Tropa/Progress.md");
    return tropa.app.vault.modify(file, tropa.app.vault.contents.get(file.path).replace(/^goal:.*$/m, 'goal: "[[Attention]]"'));
  });
  await wait(page, 300);
  ok(`${label}: a synced change takes the undo away`, (await toasts()) === 0 && (await staleUndo()) === false);
  ok(`${label}: and the synced change stays`, (await state(page, "Chain rule")).includes("state-mastered") && (await page.evaluate("tropa.plugin.store.progress.goal")).endsWith("Attention.md"));
}
{
  const { page, errors } = await open();
  await undoChecks(page, "undo");
  ok("no console errors (undo)", errors.length === 0, JSON.stringify(errors));
  await page.close();
}
{
  const { page, errors } = await phone("");
  await undoChecks(page, "phone undo");
  ok("no console errors (phone undo)", errors.length === 0, JSON.stringify(errors));
  await page.close();
}
// Without the map open the undo comes as a notice, and the same rule holds.
{
  const { page, errors } = await open();
  await page.evaluate(() => {
    const leaves = tropa.app.workspace.getLeavesOfType.bind(tropa.app.workspace);
    tropa.app.workspace.getLeavesOfType = (type) => (type === "tropa-map" ? [] : leaves(type));
  });
  const skip = (title) => page.evaluate(async (t) => {
    const id = [...tropa.app.vault.files.keys()].find((p) => p.endsWith(`/${t}.md`));
    tropa.plugin.store.setSkipped(id, true);
  }, title);
  const undoNotices = () => page.locator(".notice:has(.tropa-notice-undo)");
  await skip("Probability"); await wait(page, 400);
  ok("notice undo: offered", (await undoNotices().count()) === 1);
  await skip("Tokenization"); await wait(page, 300);
  const left = await undoNotices().allInnerTexts();
  ok("notice undo: the older notice goes when the progress changes again", left.length === 1 && left[0].includes("Tokenization"), JSON.stringify(left));
  await undoNotices().locator("button").click(); await wait(page, 300);
  ok("notice undo: undoes only its own change", (await state(page, "Probability")).includes("state-skipped") && !(await state(page, "Tokenization")).includes("state-skipped"));
  ok("no console errors (notice undo)", errors.length === 0, JSON.stringify(errors));
  await page.close();
}

// --- several goals, a deadline and a pace
async function goalChecks(page, label, words) {
  const pick = async (title) => page.evaluate((id) => tropa.app.workspace.center.view.select(id), await conceptPath(page, title));
  const side = (text) => page.locator(`.tropa-side button:text-is("${text}")`);
  const menuItem = (text) => page.locator(`.menu-item:text-is("${text}")`);
  const progressFile = () => page.evaluate("tropa.app.vault.contents.get(tropa.plugin.settings.progressPath)");
  const goalMenu = async () => { await page.click(".tropa-goal"); await wait(page, 150); };
  const journal = async () => {
    await page.evaluate(() => tropa.plugin.journal.settled());
    return page.evaluate(() => {
      const folder = tropa.plugin.settings.journalFolder + "/";
      return [...tropa.app.vault.contents].filter(([path]) => path.startsWith(folder)).map(([, text]) => text).join("\n");
    });
  };
  const lines = async (action) => (await journal()).split("\n").filter((line) => line.split(" ")[2] === action);

  // A mark with its undo, then a goal added another way: the undo goes, both changes stay and are written.
  await page.evaluate(async (id) => tropa.plugin.store.setMastered(id, true), await conceptPath(page, words.markFirst)); await wait(page, 300);
  const toastsBefore = await page.locator("#center .tropa-toast").count();
  await pick(words.second); await wait(page, 150);
  await side(words.add).click(); await wait(page, 400);
  ok(`${label}: adding a goal takes a pending undo away`, toastsBefore === 1 && (await page.locator("#center .tropa-toast").count()) === 0, JSON.stringify({ toastsBefore }));
  ok(`${label}: the journal has the mark and the new active goal`, (await lines("mastered")).length >= 1 && (await lines("goal")).some((line) => line.includes(`[[${words.second}]]`)) && (await lines("goal-added")).length === 0, await journal());
  ok(`${label}: adding a goal makes it the active one`, (await page.locator(".tropa-goal-label").innerText()) === words.second);
  ok(`${label}: the bar counts the other goal`, (await page.locator(".tropa-goal-more").innerText()) === "+1");
  const saved = await progressFile();
  ok(`${label}: both goals are saved, the active one in goal`, /^goals:/m.test(saved) && saved.includes(`[[${words.first}]]`) && /^goal: .*Convolutional|^goal: .*Свёрточные/m.test(saved), saved.slice(0, 400));
  ok(`${label}: a goal cannot be skipped`, (await side(words.skip).count()) === 0);

  await goalMenu();
  ok(`${label}: the menu lists both goals and all of them`, (await menuItem(words.first).count()) === 1 && (await menuItem(words.all).count()) === 1);
  const goalLines = (await lines("goal")).length;
  await menuItem(words.all).click(); await wait(page, 1200);
  ok(`${label}: all goals in the bar`, (await page.locator(".tropa-goal-label").innerText()) === words.count2, await page.locator(".tropa-goal-label").innerText());
  ok(`${label}: both goals marked on the map`, (await state(page, words.first)).includes("is-goal") && (await state(page, words.second)).includes("is-goal"));
  ok(`${label}: the route counts the steps to both`, (await page.locator(".tropa-side .tropa-title").innerText()).includes(words.stepsToGoals));
  const named = await page.locator("#center .tropa-step-goals").allInnerTexts();
  const steps = await page.locator("#center .tropa-step").count();
  // Steps both goals need stay unmarked, the others name their goal.
  ok(`${label}: a step one goal needs names it, the shared ones do not`,
    named.length > 0 && named.length < steps && named.every((text) => text.includes(words.first) !== text.includes(words.second)), JSON.stringify({ named, steps }));
  ok(`${label}: the route to all is saved`, (await progressFile()).includes("all-goals: true"));
  ok(`${label}: routing to all goals writes no journal line`, (await lines("goal")).length === goalLines, await journal());

  // Deadline and pace from the route panel.
  await page.locator("#center .tropa-plan-button").click(); await wait(page, 150);
  ok(`${label}: plan modal has a pace and a deadline per goal`, (await page.locator(".modal .tropa-plan-pace").count()) === 1 && (await page.locator(".modal .tropa-plan-deadline").count()) === 2);
  await page.locator(".modal .tropa-plan-pace").fill("abc");
  await page.locator(`.modal button:text-is("${words.save}")`).click(); await wait(page, 150);
  ok(`${label}: a bad pace is refused`, (await page.locator(".modal .tropa-plan-pace").count()) === 1 && (await page.evaluate("tropa.notices")).some((text) => text.includes(words.paceInvalid)));
  await page.locator(".modal .tropa-plan-pace").fill(words.pace);
  const deadline = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 6); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  await page.locator(`.modal .tropa-plan-deadline[data-goal$="${words.first}.md"]`).fill(deadline);
  await page.locator(`.modal button:text-is("${words.save}")`).click(); await wait(page, 500);
  const file = await progressFile();
  const planned = { deadline: await lines("deadline"), pace: await lines("pace") };
  ok(`${label}: the journal has the deadline and the pace`,
    planned.deadline.length === 1 && planned.deadline[0].includes(`[[${words.first}]] date=${deadline}`) && planned.pace.length === 1 && planned.pace[0].endsWith(`pace - hours=${words.paceSaved}`), JSON.stringify(planned));
  ok(`${label}: pace and deadline are saved as plain properties`, file.includes(`pace-hours: ${words.paceSaved}`) && file.includes(`deadline-${deadline}:`), file.slice(0, 600));
  const forecast = await page.locator("#center .tropa-plan-forecast .tropa-hint").allInnerTexts();
  ok(`${label}: the forecast gives a finish date at the pace`, forecast.some((line) => line.startsWith(words.finish)), JSON.stringify(forecast));
  ok(`${label}: and what the deadline asks for, by goal`, forecast.some((line) => line.startsWith(`${words.first}${words.goalLineSep}`)), JSON.stringify(forecast));
  await page.screenshot({ path: `${SHOTS}63-${label.replace(/\s+/g, "-")}-all.png` });
  const unestimated = await page.evaluate("tropa.plugin.store.route.unestimated");
  ok(`${label}: and says what has no estimate, when something has none`, forecast.some((line) => line.includes(words.unestimated)) === unestimated > 0, JSON.stringify({ forecast, unestimated }));
  await goalMenu();
  ok(`${label}: the menu shows the deadline`, (await page.locator(".menu-item").allInnerTexts()).some((text) => text.startsWith(`${words.first}, `)));
  await page.keyboard.press("Escape"); await page.mouse.click(5, 300); await wait(page, 150);

  // Back to one goal, then remove the other one.
  await goalMenu();
  // With its deadline the goal reads "Transformer, until …".
  await page.locator(".menu-item").filter({ hasText: new RegExp(`^${words.first}, `) }).click(); await wait(page, 800);
  ok(`${label}: one goal again`, (await page.locator(".tropa-goal-label").innerText()) === words.first && (await page.evaluate("tropa.plugin.store.route.goals.length")) === 1);
  ok(`${label}: its own deadline is in the forecast`, (await page.locator("#center .tropa-plan-forecast .tropa-hint").allInnerTexts()).some((line) => line.startsWith(words.deadlineStart)));
  await goalMenu();
  await menuItem(words.remove).click(); await wait(page, 800);
  ok(`${label}: removing the active goal shows the other one`, (await page.locator(".tropa-goal-label").innerText()) === words.second);
  const left = await progressFile();
  ok(`${label}: with one goal left the lists go`, !/^goals:/m.test(left) && !left.includes("all-goals") && !left.includes(`deadline-${deadline}`), left.slice(0, 400));
  ok(`${label}: the pace stays`, left.includes(`pace-hours: ${words.paceSaved}`));
  const removed = await lines("goal-removed");
  ok(`${label}: the journal has the removed goal, and no line for its deadline`,
    removed.length === 1 && removed[0].includes(`[[${words.first}]]`) && (await lines("deadline")).length === 1, await journal());
}
const EN_GOALS = {
  first: "Transformer", second: "Convolutional networks", add: "Add as goal", skip: "Skip", all: "All goals", count2: "2 goals",
  stepsToGoals: "to your goals", save: "Save", paceInvalid: "Enter hours a week", pace: "5", paceSaved: "5",
  finish: "At 5 h a week: done by", goalLineSep: ": ", unestimated: "without a time estimate", deadlineStart: "Behind:",
  remove: "Remove goal “Transformer”", markFirst: "Gradient",
};
{
  const { page, errors } = await open();
  await goalChecks(page, "goals", EN_GOALS);
  const ids = await page.evaluate("tropa.plugin.commands.map((c) => c.id)");
  ok("goals: commands to add and remove a goal and to plan", ["set-goal", "remove-goal", "plan"].every((id) => ids.includes(id)), JSON.stringify(ids));
  ok("no console errors (goals)", errors.length === 0, JSON.stringify(errors));
  await page.close();
}
{
  const { page, errors } = await open({ query: "?lang=ru" });
  await goalChecks(page, "ru goals", {
    first: "Трансформер", second: "Свёрточные сети", add: "Добавить в цели", skip: "Пропустить", all: "Все цели", count2: "2 цели",
    stepsToGoals: "до ваших целей", save: "Сохранить", paceInvalid: "Введите часы в неделю", pace: "2,5", paceSaved: "2.5",
    finish: "При 2,5 ч в неделю — к", goalLineSep: ": ", unestimated: "без оценки времени", deadlineStart: "Не успеваете:",
    remove: "Убрать цель «Трансформер»", markFirst: "Градиент",
  });
  ok("no console errors (ru goals)", errors.length === 0, JSON.stringify(errors));
  await page.close();
}
{
  const { page, errors } = await open({ query: "?lang=ar" });
  await page.click(".tropa-goal"); await wait(page, 150);
  ok("ar goals: the goal menu opens", (await page.locator('.menu-item:text-is("إضافة هدف آخر…")').count()) === 1);
  await page.click('.menu-item:text-is("الموعد النهائي والوتيرة…")'); await wait(page, 150);
  ok("ar goals: the plan modal is right to left", (await page.locator(".modal").getAttribute("dir")) === "rtl" && (await page.locator(".modal .tropa-plan-deadline").count()) === 1);
  await page.locator(".modal .tropa-plan-pace").fill("3");
  await page.locator('.modal button:text-is("حفظ")').click(); await wait(page, 400);
  const lines = await page.locator("#center .tropa-plan-forecast .tropa-hint").allInnerTexts();
  ok("ar goals: the forecast is translated", lines.some((line) => line.startsWith("بمعدل ") && line.includes("س في الأسبوع")), JSON.stringify(lines));
  await page.screenshot({ path: SHOTS + "64-ar-plan.png" });
  ok("no console errors (ar goals)", errors.length === 0, JSON.stringify(errors));
  await page.close();
}
{
  const { page, errors } = await phone("");
  await goalChecks(page, "phone goals", EN_GOALS);
  await page.screenshot({ path: SHOTS + "75-phone-goals.png" });
  ok("phone goals: the bar stays one row with the goal count", (await box(page, "#center .tropa-bar")).height <= 56);
  ok("no console errors (phone goals)", errors.length === 0, JSON.stringify(errors));
  await page.close();
}
// --- learning journal: a line per change, one file per month and device, read back from every device
const journalFiles = (page, folder = "Tropa/Journal") =>
  page.evaluate((f) => [...tropa.app.vault.files.keys()].filter((path) => path.startsWith(f + "/")), folder);
const settled = (page) => page.evaluate(() => tropa.plugin.journal.settled());
const statsCell = (page, row, column = 0) => page.locator(`#right .tropa-stats tr.${row} td`).nth(column).innerText();
// An entry from today, as another device would write it.
const todayLine = (page, action, target) =>
  page.evaluate(([a, t]) => `- ${new Date().toISOString().replace(/\.\d+Z$/, "Z")} ${a} ${t}`, [action, target]);
{
  const { page, errors } = await open({ query: "?panel=1" });
  ok("journal: nothing written before any change", (await journalFiles(page)).length === 0);
  ok("journal: no activity block without a journal", (await page.locator("#right .tropa-stats").count()) === 0);
  await node(page, "Gradient").click(); await wait(page, 150);
  await page.click('.tropa-side button:text-is("Start learning")'); await wait(page, 150);
  await page.click('.tropa-side button:text-is("Mark as mastered")'); await wait(page, 150);
  await settled(page); await wait(page, 100);
  const files = await journalFiles(page);
  const device = await page.evaluate(() => tropa.plugin.journal.device);
  ok("journal: one file for the month and this device", files.length === 1 && /^Tropa\/Journal\/\d{4}-\d{2} desktop-[0-9a-f]{4}\.md$/.test(files[0]) && files[0].endsWith(` ${device}.md`), files.join(", "));
  ok("journal: the device name is kept outside the vault", (await page.evaluate(() => tropa.app.loadLocalStorage("tropa-device"))) === device);
  let text = await note(page, files[0]);
  ok("journal: file says what it is", text.startsWith(`---\ntype: learning-journal\ndevice: ${device}\n---\n`), text.slice(0, 120));
  ok("journal: a line per action, with links", /\n- \S+[+-]\d{2}:\d{2} started \[\[Gradient\]\]\n- \S+ mastered \[\[Gradient\]\]\n$/.test(text), text);
  ok("journal: activity shows what was mastered", (await statsCell(page, "is-mastered")) === "1" && (await statsCell(page, "is-mastered", 1)) === "1");
  ok("journal: activity heading and periods", (await page.locator("#right .tropa-stats th[scope=col]").allInnerTexts()).join("|") === "7 days|30 days");
  ok("journal: journal files are not on the map", await page.evaluate((path) => !tropa.plugin.store.graph.nodes.has(path) && tropa.plugin.store.isOwnFile(path), files[0]));
  await page.click(".tropa-toast button"); await wait(page, 150);
  await settled(page); await wait(page, 100);
  text = await note(page, files[0]);
  ok("journal: Undo adds lines that put it back", /mastered \[\[Gradient\]\]\n- \S+ unmastered \[\[Gradient\]\] undo\n- \S+ started \[\[Gradient\]\] undo\n$/.test(text), text);
  ok("journal: an undone mark does not count", (await statsCell(page, "is-mastered")) === "0");

  // Another device's file arrives by sync, with a broken line in it; then it grows, then it is deleted.
  const phoneFile = "Tropa/Journal/2026-11 phone-beef.md";
  const phoneText = `---\ntype: learning-journal\n---\n\n${await todayLine(page, "mastered", "[[Chain rule]]")}\n- this line was mangled\n${await todayLine(page, "done", "[[3Blue1Brown, Essence of calculus]]")}\n`;
  await page.evaluate(([path, content]) => tropa.app.vault.create(path, content), [phoneFile, phoneText]); await wait(page, 150);
  ok("journal: another device's lines count", (await statsCell(page, "is-mastered")) === "1", await statsCell(page, "is-mastered"));
  const minutes = await page.evaluate(() => [...tropa.plugin.store.graph.nodes.values()].find((n) => n.title === "3Blue1Brown, Essence of calculus")?.minutes);
  ok("journal: time with finished materials", minutes > 0 && (await statsCell(page, "is-time")) !== "—", `${minutes} ${await statsCell(page, "is-time")}`);
  await page.evaluate(async ([path, line]) => {
    const vault = tropa.app.vault;
    await vault.modify(vault.files.get(path), vault.contents.get(path) + line + "\n");
  }, [phoneFile, await todayLine(page, "mastered", "[[Embeddings]]")]); await wait(page, 150);
  ok("journal: a synced change is read again", (await statsCell(page, "is-mastered")) === "2");
  await page.evaluate((path) => tropa.app.vault.delete(tropa.app.vault.files.get(path)), phoneFile); await wait(page, 150);
  ok("journal: a deleted file no longer counts", (await statsCell(page, "is-mastered")) === "0");
  ok("journal: the other device's file was never written to", (await journalFiles(page)).length === 1);

  // Journal files are no materials to pick.
  await node(page, "Probability").click(); await wait(page, 150);
  await page.click('.tropa-side button:has-text("Add material")'); await wait(page, 150);
  const picks = await page.locator(".modal, .prompt").allInnerTexts();
  ok("journal: not offered as a material", picks.join(" ").includes("3Blue1Brown") && !picks.join(" ").includes(device), picks.join(" ").slice(0, 200));
  await page.keyboard.press("Escape"); await wait(page, 100);

  // Turned off: nothing more is written, and the activity block goes away.
  await page.evaluate(async () => {
    await tropa.plugin.settingTab.setControlValue("journal", false);
    const store = tropa.plugin.store;
    const id = [...store.graph.nodes.values()].find((n) => n.title === "Gradient").id;
    store.setMastered(id, true);
  });
  await settled(page); await wait(page, 100);
  ok("journal: off writes nothing", (await note(page, files[0])) === text);
  ok("journal: off hides activity", (await page.locator("#right .tropa-stats").count()) === 0);
  // Back on, in another folder: the folder is read anew and written to.
  await page.evaluate(async () => {
    const tab = tropa.plugin.settingTab;
    await tab.setControlValue("journal", true);
    await tab.setControlValue("journalFolder", "Learning/Log");
    const store = tropa.plugin.store;
    store.setMastered([...store.graph.nodes.values()].find((n) => n.title === "Gradient").id, false);
  });
  await settled(page); await wait(page, 100);
  const moved = await journalFiles(page, "Learning/Log");
  ok("journal: a new folder is used", moved.length === 1 && (await note(page, moved[0])).includes("unmastered [[Gradient]]"), moved.join(", "));
  ok("journal: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  // 20 000 lines from another device: read at start and summed without a visible pause.
  const { page, errors } = await open({ query: "?panel=1" });
  const took = await page.evaluate(async () => {
    const lines = [];
    const now = Date.now();
    const titles = [...tropa.plugin.store.graph.nodes.values()].map((n) => n.title);
    for (let i = 0; i < 20000; i++) {
      const time = new Date(now - i * 60000).toISOString().replace(/\.\d+Z$/, "Z");
      lines.push(`- ${time} ${["started", "mastered", "reviewed", "done"][i % 4]} [[${titles[i % titles.length]}]] rating=3`);
    }
    await tropa.app.vault.create("Tropa/Journal/2026-10 desktop-0000.md", lines.join("\n"));
    const journal = tropa.plugin.journal;
    const t = performance.now();
    await journal.load();
    const panel = tropa.app.workspace.right.view;
    panel.render();
    return performance.now() - t;
  });
  const reviews = Number(await statsCell(page, "is-reviews", 1));
  console.log(`journal of 20 000 lines: read and shown in ${Math.round(took)} ms`);
  ok("journal: 20 000 lines read and summed quickly", took < 300 && reviews > 1000, `${took} ms, ${reviews}`);
  ok("journal (large): no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
for (const [lang, folder, heading, row, column, dir] of [
  ["ru", "Tropa/Журнал", "Активность", "Освоено", "7 дней", "ltr"],
  ["ar", "Tropa/Journal", "النشاط", "مُتقَن", "7 أيام", "rtl"],
]) {
  const { page, errors } = await open({ query: `?lang=${lang}&panel=1` });
  await page.evaluate(() => {
    const store = tropa.plugin.store;
    const id = [...store.states].find(([, s]) => s === "available")[0];
    store.setMastered(id, true);
  });
  await settled(page); await wait(page, 100);
  const files = await journalFiles(page, folder);
  ok(`journal ${lang}: file in ${folder}`, files.length === 1, files.join(", "));
  ok(`journal ${lang}: file text translated`, lang !== "ru" || (await note(page, files[0])).includes("Tropa дописывает сюда строку"));
  ok(`journal ${lang}: activity in the panel`, (await page.locator("#right .tropa-stats .tropa-section-head").innerText()) === heading);
  ok(`journal ${lang}: rows and columns`, (await page.locator("#right .tropa-stats tr.is-mastered th").innerText()) === row && (await page.locator("#right .tropa-stats th[scope=col]").first().innerText()) === column);
  ok(`journal ${lang}: direction`, (await page.evaluate(() => getComputedStyle(document.querySelector("#right .tropa-stats")).direction)) === dir);
  if (dir === "rtl") {
    const box = await page.evaluate(() => {
      const head = document.querySelector("#right .tropa-stats tr.is-mastered th").getBoundingClientRect();
      const cell = document.querySelector("#right .tropa-stats tr.is-mastered td").getBoundingClientRect();
      return { head: head.right, cell: cell.right };
    });
    ok("journal ar: row names on the right", box.head > box.cell, JSON.stringify(box));
  }
  ok(`journal ${lang}: no errors`, errors.length === 0, errors.join("; "));
  await page.close();
}
{
  const { page, errors } = await open({ width: 390, height: 844, touch: true, query: "?phone&panel=1" });
  await page.evaluate(() => {
    const store = tropa.plugin.store;
    store.setMastered([...store.states].find(([, s]) => s === "available")[0], true);
  });
  await settled(page); await wait(page, 150);
  const files = await journalFiles(page);
  ok("journal phone: named after the phone", files.length === 1 && / phone-[0-9a-f]{4}\.md$/.test(files[0]), files.join(", "));
  const stats = page.locator("#right .tropa-stats");
  await stats.scrollIntoViewIfNeeded();
  const box = await stats.boundingBox();
  ok("journal phone: activity fits the screen", box && box.width <= 390 && box.x >= 0 && (await stats.isVisible()), JSON.stringify(box));
  await page.screenshot({ path: SHOTS + "90-journal-phone.png" });
  ok("journal phone: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}

// --- review: mastered concepts come back (FSRS), from the journal of every device
// A line from `days` days ago, as another device would have written it.
const pastLine = (page, days, action, target, extra = "") =>
  page.evaluate(([d, a, t, e]) => `- ${new Date(Date.now() - d * 86400000).toISOString().replace(/\.\d+Z$/, "Z")} ${a} ${t}${e}`, [days, action, target, extra]);
const seedOldMark = async (page, title = "Derivatives", days = 40) => {
  await page.evaluate(([path, content]) => tropa.app.vault.create(path, content),
    ["Tropa/Journal/2026-09 phone-beef.md", `---\ntype: learning-journal\n---\n\n${await pastLine(page, days, "mastered", `[[${title}]]`)}\n`]);
  await wait(page, 200);
};
const panelSelect = (page, title) => page.evaluate((t) => {
  const id = [...tropa.plugin.store.graph.nodes.values()].find((n) => n.title === t).id;
  tropa.app.workspace.right.view.select(id);
}, title);
const lastNotice = (page) => page.evaluate(() => tropa.notices.at(-1) ?? "");
{
  const { page, errors } = await open({ query: "?panel=1" });
  const settings = await page.evaluate(() => ({ ...tropa.plugin.settings }));
  ok("review: old marks start today, spread over a week or more", typeof settings.reviewSince === "string" && settings.reviewSpread >= 7, JSON.stringify(settings));
  ok("review: nothing due on the first day", (await page.locator(".tropa-node.is-due").count()) === 0 && (await page.locator("#right .tropa-review-queue").count()) === 0);
  ok("review: nothing written to the journal for it", (await journalFiles(page)).length === 0);
  ok("review: legend shows the review mark", (await page.locator(".tropa-legend-item.is-review").innerText()) === "To review" && (await page.locator(".tropa-legend-item.is-review").isVisible()));

  await seedOldMark(page);
  ok("review: a mark from 40 days ago is due", (await state(page, "Derivatives")).includes("is-due"), await state(page, "Derivatives"));
  ok("review: the due mark is an icon on the node", await node(page, "Derivatives").locator(".tropa-due svg").isVisible());
  ok("review: other mastered concepts are not due", !(await state(page, "Vectors and matrices")).includes("is-due"));
  ok("review: the label says so", (await node(page, "Derivatives").getAttribute("aria-label")).includes("Time to review"));
  ok("review: still mastered, the route is unchanged", (await state(page, "Derivatives")).includes("state-mastered"));
  const queue = page.locator("#right .tropa-review-queue");
  ok("review: queue above the route", (await queue.locator(".tropa-section-head").innerText()).startsWith("Review today") && (await queue.locator(".tropa-review-item").allInnerTexts()).join("|").includes("Derivatives"));
  await page.screenshot({ path: SHOTS + "95-review-queue.png" });

  await queue.locator(".tropa-review-item").first().click(); await wait(page, 150);
  const box = page.locator("#right .tropa-review.is-due");
  ok("review: the concept shows it is time", (await box.locator(".tropa-review-head").innerText()) === "Time to review");
  ok("review: chance to recall in percent", /Chance to recall now: \d+%/.test(await box.locator(".tropa-hint").innerText()));
  const names = await box.locator(".tropa-review-rating-name").allInnerTexts();
  const intervals = await box.locator(".tropa-review-rating-interval").allInnerTexts();
  ok("review: four ratings with their next interval", names.join("|") === "Forgot|Hard|Recalled|Easy" && intervals.every((text) => /\d/.test(text)), `${names} ${intervals}`);
  await page.screenshot({ path: SHOTS + "96-review-ratings.png" });
  await box.locator('button[data-rating="3"]').click();
  await settled(page); await wait(page, 200);
  const own = (await journalFiles(page)).find((path) => !path.includes("phone-beef"));
  ok("review: written to this device's journal", own && /\n- \S+ reviewed \[\[Derivatives\]\] rating=3( shift=-?[1-3])?\n$/.test(await note(page, own)), own);
  ok("review: no longer due", !(await state(page, "Derivatives")).includes("is-due") && (await page.locator("#right .tropa-review-queue").count()) === 0);
  ok("review: says when it comes back", (await lastNotice(page)).startsWith("Review of Derivatives saved. Next one"), await lastNotice(page));
  ok("review: the next review is shown", (await page.locator("#right .tropa-review .tropa-review-head").innerText()).startsWith("Next review"));
  await page.evaluate(() => tropa.app.workspace.right.view.select(null)); await wait(page, 100);
  ok("review: counted in the activity", (await statsCell(page, "is-reviews")) === "1");

  await page.locator(".notice .tropa-notice-undo").last().click();
  await settled(page); await wait(page, 200);
  ok("review: Undo adds a line that takes it back", /reviewed \[\[Derivatives\]\] rating=3( shift=-?[1-3])?\n- \S+ reviewed \[\[Derivatives\]\] undo\n$/.test(await note(page, own)), await note(page, own));
  ok("review: due again after Undo", (await state(page, "Derivatives")).includes("is-due"));
  ok("review: an undone review does not count", (await statsCell(page, "is-reviews")) === "0");

  // Not due yet: the ratings wait behind "Review now".
  await panelSelect(page, "Vectors and matrices"); await wait(page, 100);
  const early = page.locator("#right .tropa-review");
  ok("review: not due shows the next date", (await early.locator(".tropa-review-head").innerText()).startsWith("Next review") && (await early.locator(".tropa-review-rating").count()) === 0);
  await early.locator("button.tropa-review-early").click(); await wait(page, 50);
  ok("review: Review now shows the ratings", (await early.locator(".tropa-review-rating").count()) === 4);
  ok("review: not on a concept that is not mastered", await page.evaluate(() => {
    const view = tropa.app.workspace.right.view;
    const id = [...tropa.plugin.store.states].find(([, s]) => s === "available")[0];
    view.select(id);
    return document.querySelectorAll("#right .tropa-review").length === 0;
  }));

  // Commands: the next review, and the queue.
  await runCommand(page, "review-next"); await wait(page, 200);
  ok("review: command opens the next review", (await page.locator("#right .tropa-title").first().innerText()) === "Derivatives" && (await page.locator("#right .tropa-review.is-due").count()) === 1);
  await runCommand(page, "review-queue"); await wait(page, 200);
  ok("review: command opens the queue", await page.locator("#right .tropa-review-queue").isVisible());

  // A higher target recall makes more concepts due; off removes it all.
  await page.evaluate(() => tropa.plugin.settingTab.setControlValue("retention", "0.95")); await wait(page, 150);
  ok("review: target recall is saved", await page.evaluate(() => tropa.plugin.settings.retention === 0.95));
  await page.evaluate(() => tropa.plugin.settingTab.setControlValue("review", false)); await wait(page, 150);
  ok("review: off clears marks, queue and legend", (await page.locator(".tropa-node.is-due").count()) === 0 && (await page.locator("#right .tropa-review-queue").count()) === 0 &&
    !(await page.locator(".tropa-legend-item.is-review").isVisible()));
  await runCommand(page, "review-next"); await wait(page, 50);
  ok("review: command says it is off", (await lastNotice(page)) === "Review is turned off in the settings.", await lastNotice(page));
  await page.evaluate(async () => {
    await tropa.plugin.settingTab.setControlValue("review", true);
    await tropa.plugin.settingTab.setControlValue("journal", false);
  }); await wait(page, 150);
  ok("review: needs the journal", (await page.locator(".tropa-node.is-due").count()) === 0);
  await runCommand(page, "review-next"); await wait(page, 50);
  ok("review: command says the journal is needed", (await lastNotice(page)).startsWith("Review needs the learning journal"), await lastNotice(page));
  ok("review: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  // Several goals and the route to all of them: review stays the same, on top of it.
  const { page, errors } = await open({ query: "?panel=1" });
  await seedOldMark(page);
  await page.evaluate(() => {
    const store = tropa.plugin.store;
    const id = (title) => [...store.graph.nodes.values()].find((n) => n.title === title).id;
    store.addGoal(id("Convolutional networks"));
    store.setAllGoals(true);
    store.setPlan(5, new Map([[id("Transformer"), "2027-03-01"]]));
  });
  await settled(page); await wait(page, 600);
  ok("review goals: route to all goals", await page.evaluate(() => tropa.plugin.store.route?.goals.length === 2));
  ok("review goals: the due mark stays", (await state(page, "Derivatives")).includes("is-due"));
  ok("review goals: queue above the route to all goals", (await page.locator("#right .tropa-review-queue .tropa-review-item").allInnerTexts()).join("|").includes("Derivatives"));
  const journal = (await journalFiles(page)).find((path) => !path.includes("phone-beef"));
  const lines = await note(page, journal);
  ok("review goals: goal and plan lines are in the journal", lines.includes("goal [[Convolutional networks]]") && lines.includes("pace - hours=5"), lines);
  await page.locator("#right .tropa-review-queue .tropa-review-item").first().click(); await wait(page, 150);
  await page.locator('#right .tropa-review button[data-rating="2"]').click();
  await settled(page); await wait(page, 200);
  ok("review goals: rating works", !(await state(page, "Derivatives")).includes("is-due") && /reviewed \[\[Derivatives\]\] rating=2( shift=-?[1-3])?\n$/.test(await note(page, journal)));
  ok("review goals: the goals are untouched", await page.evaluate(() => tropa.plugin.store.progress.allGoals && tropa.plugin.store.route?.goals.length === 2));
  ok("review goals: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
for (const [lang, queueTitle, ratings, dir] of [
  ["ru", "Повторить сегодня", "Не вспомнил|С трудом|Вспомнил|Легко", "ltr"],
  ["ar", "للمراجعة اليوم", "نسيته|بصعوبة|تذكّرته|بسهولة", "rtl"],
]) {
  const { page, errors } = await open({ query: `?lang=${lang}&panel=1` });
  const title = await page.evaluate(() => tropa.plugin.store.graph.nodes.get([...tropa.plugin.store.progress.mastered][0]).title);
  await page.evaluate(async (t) => {
    const now = new Date(Date.now() - 40 * 86400000).toISOString().replace(/\.\d+Z$/, "Z");
    await tropa.app.vault.create(`${tropa.plugin.settings.journalFolder}/2026-09 phone-beef.md`, `- ${now} mastered [[${t}]]\n`);
  }, title); await wait(page, 200);
  const queue = page.locator("#right .tropa-review-queue");
  ok(`review ${lang}: queue translated`, (await queue.locator(".tropa-section-head").innerText()).startsWith(queueTitle), await queue.locator(".tropa-section-head").innerText());
  await queue.locator(".tropa-review-item").first().click(); await wait(page, 150);
  ok(`review ${lang}: ratings translated`, (await page.locator("#right .tropa-review-rating-name").allInnerTexts()).join("|") === ratings);
  ok(`review ${lang}: direction`, (await page.evaluate(() => getComputedStyle(document.querySelector("#right .tropa-review")).direction)) === dir);
  if (dir === "rtl") {
    const order = await page.evaluate(() => [...document.querySelectorAll("#right .tropa-review-rating")].map((b) => b.getBoundingClientRect().left));
    ok("review ar: ratings run right to left", order[0] > order[3], JSON.stringify(order));
  }
  await page.screenshot({ path: SHOTS + `97-review-${lang}.png` });
  ok(`review ${lang}: no errors`, errors.length === 0, errors.join("; "));
  await page.close();
}
{
  const { page, errors } = await open({ width: 390, height: 844, touch: true, query: "?phone" });
  await seedOldMark(page);
  await runCommand(page, "review-next"); await wait(page, 600);
  const ratings = page.locator("#center .tropa-review-ratings");
  await ratings.scrollIntoViewIfNeeded();
  const box = await ratings.boundingBox();
  const buttons = await page.locator("#center .tropa-review-rating").evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
  ok("review phone: the next review opens on the map's sheet", (await page.locator("#center .tropa-side .tropa-review.is-due").count()) === 1);
  ok("review phone: ratings fit the screen", box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
  ok("review phone: ratings are finger-sized", buttons.length === 4 && buttons.every((b) => b.h >= 44 && b.w >= 60), JSON.stringify(buttons));
  ok("review phone: the due mark on the node", (await state(page, "Derivatives")).includes("is-due"));
  await page.screenshot({ path: SHOTS + "98-review-phone.png" });
  await page.locator('#center .tropa-review-rating[data-rating="4"]').tap();
  await page.evaluate(() => tropa.plugin.journal.settled()); await wait(page, 200);
  ok("review phone: a tap rates it", !(await state(page, "Derivatives")).includes("is-due"));
  ok("review phone: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}

// --- review load: a daily limit, balancing and a pause written to the journal
// The three mastered concepts of the example, all marked 40 days ago on another device.
const seedOldMarks = async (page, days = 40) => {
  await page.evaluate(async (d) => {
    const store = tropa.plugin.store;
    const time = new Date(Date.now() - d * 86400000).toISOString().replace(/\.\d+Z$/, "Z");
    const lines = [...store.progress.mastered].map((id) => `- ${time} mastered [[${store.graph.nodes.get(id).title}]]`);
    await tropa.app.vault.create(`${tropa.plugin.settings.journalFolder}/2026-09 phone-beef.md`, `${lines.join("\n")}\n`);
  }, days);
  await wait(page, 200);
};
const checkCommand = (page, id, checking) => page.evaluate(([cid, c]) => tropa.plugin.commands.find((cmd) => cmd.id === cid).checkCallback(c), [id, checking]);
const dueCount = (page) => page.locator(".tropa-node.is-due").count();
{
  const { page, errors } = await open({ query: "?panel=1" });
  ok("review load: the limit setting, 20 a day by default", (await page.evaluate(() => tropa.plugin.settingTab.getControlValue("reviewLimit"))) === "20");
  ok("review load: balancing is on by default", (await page.evaluate(() => tropa.plugin.settingTab.getControlValue("reviewBalance"))) === true);
  await page.evaluate(() => tropa.plugin.settingTab.setControlValue("reviewLimit", "10"));
  ok("review load: a limit from the list is saved", await page.evaluate(() => tropa.plugin.settings.reviewLimit === 10));
  await page.evaluate(() => tropa.plugin.settingTab.setControlValue("reviewLimit", "7"));
  ok("review load: a limit not in the list falls back to 20", await page.evaluate(() => tropa.plugin.settings.reviewLimit === 20));
  await page.evaluate(() => tropa.plugin.settingTab.setControlValue("reviewBalance", false));
  ok("review load: balancing can be turned off", await page.evaluate(() => tropa.plugin.settings.reviewBalance === false));
  await page.evaluate(() => tropa.plugin.settingTab.setControlValue("reviewBalance", true));

  await seedOldMarks(page);
  ok("review load: without a limit in reach, all three are due", (await dueCount(page)) === 3);
  // Two a day, as data.json could hold it.
  await page.evaluate(() => { tropa.plugin.settings.reviewLimit = 2; tropa.plugin.reviews.refresh(); }); await wait(page, 200);
  const queue = page.locator("#right .tropa-review-queue");
  ok("review load: today's queue keeps to the limit", (await queue.locator(".tropa-review-item").count()) === 2 && (await dueCount(page)) === 2);
  ok("review load: the count says how many of all", (await queue.locator(".tropa-section-count").innerText()) === "2 of 3", await queue.locator(".tropa-section-count").innerText());
  ok("review load: what waits is said", (await queue.locator(".tropa-review-waiting").innerText()) === "Waiting for the next days: 1");
  const held = await page.evaluate(() => {
    const reviews = tropa.plugin.reviews;
    const id = [...reviews.schedules.keys()].find((key) => !reviews.isDue(key));
    tropa.app.workspace.right.view.select(id);
    return tropa.plugin.store.graph.nodes.get(id).title;
  }); await wait(page, 150);
  ok("review load: a concept over the limit says so", (await page.locator("#right .tropa-review .tropa-review-head").innerText()) === "Due, over today's limit");
  ok("review load: its ratings wait behind Review now", (await page.locator("#right .tropa-review-rating").count()) === 0 && (await page.locator("#right button.tropa-review-early").count()) === 1);
  ok("review load: no due mark on it", !(await state(page, held)).includes("is-due"));
  await page.evaluate(() => tropa.app.workspace.right.view.select(null)); await wait(page, 150);
  await queue.locator(".tropa-review-item").first().click(); await wait(page, 150);
  await page.locator('#right .tropa-review button[data-rating="3"]').click();
  await settled(page); await wait(page, 250);
  await page.evaluate(() => tropa.app.workspace.right.view.select(null)); await wait(page, 150);
  ok("review load: a review counts against the limit, the queue does not refill", (await queue.locator(".tropa-review-item").count()) === 1 && (await queue.locator(".tropa-section-count").innerText()) === "1 of 2",
    await queue.locator(".tropa-section-count").innerText());
  const own = (await journalFiles(page)).find((path) => !path.includes("phone-beef"));
  ok("review load: the review line keeps its form, a shift only when there is one", /\n- \S+ reviewed \[\[[^\]]+\]\] rating=3( shift=-?[1-3])?\n$/.test(await note(page, own)), await note(page, own));

  // Pause from the queue's head.
  ok("review load: pause command offered, resume not", (await checkCommand(page, "review-pause", true)) === true && (await checkCommand(page, "review-resume", true)) === false);
  await queue.locator("button.tropa-review-pause").click(); await wait(page, 150);
  const until = await page.locator(".modal .tropa-pause-until").inputValue();
  ok("review load: the pause dialog offers a week", /^\d{4}-\d{2}-\d{2}$/.test(until) && (await page.locator(".modal").innerText()).includes("on all your devices"), until);
  await page.locator(".modal .tropa-pause-until").fill("2000-01-01");
  await page.locator('.modal button:text-is("Pause")').click(); await wait(page, 100);
  ok("review load: a day in the past is refused", (await lastNotice(page)) === "Choose a day after today" && (await page.locator(".modal").count()) === 1);
  await page.locator(".modal .tropa-pause-until").fill(until);
  await page.locator('.modal button:text-is("Pause")').click();
  await settled(page); await wait(page, 250);
  ok("review load: the pause goes to the journal", new RegExp(`\\n- \\S+ pause - until=${until}\\n$`).test(await note(page, own)), await note(page, own));
  ok("review load: paused, the queue says when it comes back", (await queue.locator(".tropa-review-paused").innerText()).startsWith("Review paused, back on") && (await queue.locator(".tropa-review-item").count()) === 0);
  ok("review load: no due marks while paused", (await dueCount(page)) === 0);
  await runCommand(page, "review-next"); await wait(page, 50);
  ok("review load: the next review says it is paused", (await lastNotice(page)).startsWith("Review paused, back on"), await lastNotice(page));
  ok("review load: resume command offered, pause not", (await checkCommand(page, "review-pause", true)) === false && (await checkCommand(page, "review-resume", true)) === true);
  await page.screenshot({ path: SHOTS + "99-review-paused.png" });
  await queue.locator("button.tropa-review-resume").click();
  await settled(page); await wait(page, 250);
  ok("review load: resume goes to the journal", /\n- \S+ resume -\n$/.test(await note(page, own)), await note(page, own));
  ok("review load: the queue is back after resume", (await queue.locator(".tropa-review-item").count()) === 1 && (await dueCount(page)) === 1);
  // The day's limit done: the queue stays, empty, and says what waits.
  await page.evaluate(() => { tropa.plugin.settings.reviewLimit = 1; tropa.plugin.reviews.refresh(); }); await wait(page, 200);
  ok("review load: limit done, the queue says so", (await queue.locator(".tropa-review-done").innerText()) === "Today's reviews are done." && (await queue.locator(".tropa-review-waiting").innerText()) === "Waiting for the next days: 2");
  await runCommand(page, "review-next"); await wait(page, 50);
  ok("review load: the next review says the limit is done", (await lastNotice(page)) === "Today's reviews are done. Waiting for the next days: 2", await lastNotice(page));
  ok("review load: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
for (const [lang, paused, resume, count, dir] of [
  ["ru", "Повторение на паузе, вернётся", "Возобновить", "1 из 3", "ltr"],
  ["ar", "المراجعة متوقفة مؤقتًا، تعود في", "استئناف", "1 من 3", "rtl"],
]) {
  const { page, errors } = await open({ query: `?lang=${lang}&panel=1` });
  await seedOldMarks(page);
  await page.evaluate(() => { tropa.plugin.settings.reviewLimit = 1; tropa.plugin.reviews.refresh(); }); await wait(page, 200);
  const queue = page.locator("#right .tropa-review-queue");
  ok(`review load ${lang}: the count translated`, (await queue.locator(".tropa-section-count").innerText()) === count, await queue.locator(".tropa-section-count").innerText());
  ok(`review load ${lang}: what waits translated, no raw placeholders`, !/[{}]/.test(await queue.innerText()));
  await queue.locator("button.tropa-review-pause").click(); await wait(page, 150);
  ok(`review load ${lang}: the dialog direction`, (await page.locator(".modal").getAttribute("dir")) === (dir === "rtl" ? "rtl" : null));
  await page.locator(".modal button.mod-cta").click();
  await settled(page); await wait(page, 250);
  const line = await queue.locator(".tropa-review-paused").innerText();
  ok(`review load ${lang}: paused translated`, line.startsWith(paused) && line.includes(resume) && !/[{}]/.test(line), line);
  ok(`review load ${lang}: direction`, (await page.evaluate(() => getComputedStyle(document.querySelector("#right .tropa-review-queue")).direction)) === dir);
  await page.screenshot({ path: SHOTS + `99-review-paused-${lang}.png` });
  ok(`review load ${lang}: no errors`, errors.length === 0, errors.join("; "));
  await page.close();
}
{
  const { page, errors } = await open({ width: 390, height: 844, touch: true, query: "?phone" });
  await seedOldMarks(page);
  await page.evaluate(() => { tropa.plugin.settings.reviewLimit = 2; tropa.plugin.reviews.refresh(); }); await wait(page, 300);
  const queue = page.locator("#center .tropa-review-queue");
  await queue.scrollIntoViewIfNeeded();
  ok("review load phone: the queue on the sheet keeps to the limit", (await queue.locator(".tropa-review-item").count()) === 2 && (await queue.locator(".tropa-section-count").innerText()) === "2 of 3");
  const pause = await queue.locator("button.tropa-review-pause").boundingBox();
  ok("review load phone: the pause button is finger-sized and on screen", pause && pause.width >= 36 && pause.height >= 36 && pause.x + pause.width <= 390, JSON.stringify(pause));
  await queue.locator("button.tropa-review-pause").tap(); await wait(page, 200);
  ok("review load phone: the pause dialog opens", (await page.locator(".modal .tropa-pause-until").count()) === 1);
  await page.locator(".modal button.mod-cta").tap();
  await page.evaluate(() => tropa.plugin.journal.settled()); await wait(page, 300);
  ok("review load phone: paused", (await queue.locator(".tropa-review-paused").count()) === 1 && (await dueCount(page)) === 0);
  await page.screenshot({ path: SHOTS + "99-review-paused-phone.png" });
  ok("review load phone: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}

// --- self-check: questions as callouts in the concept's note, before mastering and as a review
const checkModal = (page) => page.locator(".modal.tropa-check-modal");
const offerModal = (page) => page.locator(".modal.tropa-check-offer");
const mapSelect = (page, title) => page.evaluate((t) => {
  const id = [...tropa.plugin.store.graph.nodes.values()].find((n) => n.title === t).id;
  tropa.app.workspace.center.view.select(id);
}, title);
const ownJournal = async (page) => {
  await settled(page);
  const path = (await journalFiles(page)).find((p) => !p.includes("phone-beef"));
  return path ? note(page, path) : "";
};
{
  const { page, errors } = await open({ query: "?panel=1" });
  await page.waitForFunction(() => tropa.plugin.checks.count([...tropa.plugin.store.graph.nodes.values()].find((n) => n.title === "Probability").id) === 1);
  await mapSelect(page, "Probability"); await wait(page, 150);
  ok("check: the details count the questions", (await page.locator(".tropa-side .tropa-check-count").innerText()) === "1 question to check yourself");
  ok("check: no count where there are none", await page.evaluate(() => {
    const id = [...tropa.plugin.store.graph.nodes.values()].find((n) => n.title === "Gradient").id;
    return tropa.plugin.checks.count(id) === 0;
  }));
  await page.click('.tropa-side button:text-is("Start learning")'); await wait(page, 150);
  await page.click('.tropa-side button:text-is("Mark as mastered")'); await wait(page, 150);
  ok("check: marking mastered offers a check first", await offerModal(page).isVisible());
  ok("check: the offer says why", (await offerModal(page).innerText()).includes("Probability has questions to check yourself"));
  await page.screenshot({ path: SHOTS + "99-check-offer.png" });
  await offerModal(page).locator("button.tropa-check-start").click(); await wait(page, 150);
  const modal = checkModal(page);
  ok("check: one question at a time", (await modal.locator(".tropa-check-progress").innerText()) === "Question 1 of 1" &&
    (await modal.locator(".tropa-check-question").innerText()) === "What is P(A | B)?");
  ok("check: the answer is hidden first", (await modal.locator(".tropa-check-answer").count()) === 0);
  await page.keyboard.press("Space"); await wait(page, 100);
  ok("check: Space shows the answer, rendered", (await modal.locator(".tropa-check-answer p").innerText()).startsWith("The probability of A once B"));
  ok("check: three grades", (await modal.locator(".tropa-check-grade").allInnerTexts()).join("|") === "Right|Partly|Wrong");
  await page.screenshot({ path: SHOTS + "99-check-answer.png" });
  await page.keyboard.press("1"); await wait(page, 100);
  ok("check: summary of the answers", (await modal.locator(".tropa-check-summary").innerText()) === "1 of 1 right" &&
    (await modal.locator(".tropa-check-suggested").innerText()) === "Suggested from your answers: Recalled");
  ok("check: offers to mark it mastered", (await modal.locator("button.tropa-check-master").getAttribute("class")).includes("mod-cta"));
  await page.screenshot({ path: SHOTS + "99-check-summary.png" });
  await page.keyboard.press("Enter"); await wait(page, 300);
  ok("check: the window closes", (await modal.count()) === 0);
  ok("check: mastered after the check", (await state(page, "Probability")).includes("state-mastered"));
  let journal = await ownJournal(page);
  ok("check: the result goes to the journal before the mark", /checked \[\[Probability\]\] rating=3\n- \S+ mastered \[\[Probability\]\]\n$/.test(journal), journal);
  ok("check: the note is not changed", (await note(page, `${CONCEPTS}/Probability.md`)).includes("> [!question]- What is P(A | B)?"));
  ok("check: a notice with undo", (await lastNotice(page)).startsWith("Self-check of Probability saved"), await lastNotice(page));
  await page.locator(".notice .tropa-notice-undo").last().click(); await wait(page, 100);
  journal = await ownJournal(page);
  ok("check: Undo takes the result back", /reviewed \[\[Probability\]\] undo\n$/.test(journal) && (await state(page, "Probability")).includes("state-mastered"), journal);

  // Left halfway: nothing is saved.
  await mapSelect(page, "Probability"); await wait(page, 150);
  ok("check: under review, the check sits with the ratings", (await page.locator(".tropa-side button.tropa-check-start").count()) === 0 &&
    (await page.locator(".tropa-side .tropa-check-count").innerText()) === "1 question to check yourself");
  await page.click(".tropa-side button.tropa-review-early"); await wait(page, 50);
  await page.click(".tropa-side button.tropa-review-check"); await wait(page, 150);
  ok("check: a mastered concept checks itself as a review", await checkModal(page).isVisible());
  const before = await ownJournal(page);
  await page.keyboard.press("Escape"); await wait(page, 150);
  ok("check: closing saves nothing", (await checkModal(page).count()) === 0 && (await ownJournal(page)) === before);

  // M on the map offers it too; "do not offer again" sticks.
  await node(page, "Attention").focus(); await page.keyboard.press("m"); await wait(page, 150);
  ok("check: M offers a check", await offerModal(page).isVisible());
  await offerModal(page).locator(".tropa-check-dont-ask input").check();
  await offerModal(page).locator("button.tropa-check-skip").click(); await wait(page, 250);
  ok("check: skipping marks it at once", (await state(page, "Attention")).includes("state-mastered") && !/checked \[\[Attention\]\]/.test(await ownJournal(page)));
  ok("check: do not offer again is saved", await page.evaluate(() => tropa.plugin.settings.offerCheck === false));
  await node(page, "Attention").focus(); await page.keyboard.press("m"); await wait(page, 200);
  await node(page, "Attention").focus(); await page.keyboard.press("m"); await wait(page, 200);
  ok("check: no offer once turned off", (await offerModal(page).count()) === 0 && (await state(page, "Attention")).includes("state-mastered"));

  // A changed note is read again; another callout type finds other questions.
  await page.evaluate((path) => {
    const file = tropa.app.vault.getAbstractFileByPath(path);
    return tropa.app.vault.modify(file, tropa.app.vault.contents.get(path) + "\n> [!question]- Bayes' rule?\n> P(A|B) = P(B|A) P(A) / P(B)\n");
  }, `${CONCEPTS}/Probability.md`); await wait(page, 400);
  await mapSelect(page, "Probability"); await wait(page, 150);
  ok("check: a new question is counted", (await page.locator(".tropa-side .tropa-check-count").innerText()) === "2 questions to check yourself");
  await page.evaluate(() => tropa.plugin.settingTab.setControlValue("checkCallout", "[!FAQ]")); await wait(page, 300);
  ok("check: callout type is saved clean", await page.evaluate(() => tropa.plugin.settings.checkCallout === "faq"));
  ok("check: another type, no questions", (await page.locator(".tropa-side .tropa-check-count").count()) === 0);
  await page.evaluate(() => tropa.plugin.settingTab.setControlValue("checkCallout", "")); await wait(page, 300);
  ok("check: an empty type is the default", (await page.locator(".tropa-side .tropa-check-count").innerText()) === "2 questions to check yourself");

  // The audit lists concepts without questions only when asked to.
  await runCommand(page, "audit-map"); await wait(page, 300);
  ok("check audit: off by default", (await page.locator(".tropa-audit-section.is-no-questions").count()) === 0);
  const plain = await page.evaluate(() => tropa.plugin.store.graph.concepts.filter((n) => !n.ghost).length);
  await page.evaluate(() => tropa.plugin.settingTab.setControlValue("auditQuestions", true)); await wait(page, 300);
  ok("check audit: lists concepts without questions", (await auditCount(page, "no-questions")) === String(plain - 4), await auditCount(page, "no-questions"));
  ok("check audit: hint says how to add one", (await page.locator(".tropa-audit-section.is-no-questions .tropa-audit-hint").innerText()).includes("> [!question]-"));
  ok("check: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  // Review: a due concept with questions checks itself from the queue; the grades suggest, the person picks.
  const { page, errors } = await open({ query: "?panel=1" });
  await seedOldMark(page);
  await page.waitForFunction(() => document.querySelector("#right .tropa-review-queue .tropa-review-check"));
  await page.locator("#right .tropa-review-queue .tropa-review-check").first().click(); await wait(page, 150);
  const modal = checkModal(page);
  ok("check review: from the queue", (await modal.locator(".tropa-check-progress").innerText()) === "Question 1 of 2");
  await modal.locator("button.tropa-check-reveal").click(); await modal.locator('button[data-grade="right"]').click();
  await modal.locator("button.tropa-check-reveal").click(); await modal.locator('button[data-grade="partly"]').click(); await wait(page, 100);
  ok("check review: a partly right answer counts half", (await modal.locator(".tropa-check-summary").innerText()) === "1.5 of 2 right");
  ok("check review: four ratings, the suggested one first in line", (await modal.locator(".tropa-check-rating").allInnerTexts()).join("|") === "Forgot|Hard|Recalled|Easy" &&
    (await modal.locator(".tropa-check-rating.mod-cta").innerText()) === "Recalled");
  await modal.locator('button[data-rating="2"]').click(); await wait(page, 300);
  const journal = await ownJournal(page);
  ok("check review: the picked rating is saved as a check", /checked \[\[Derivatives\]\] rating=2\n$/.test(journal), journal);
  ok("check review: no longer due", !(await state(page, "Derivatives")).includes("is-due"));
  await page.evaluate(() => tropa.app.workspace.right.view.select(null)); await wait(page, 100);
  ok("check review: counted as a review", (await statsCell(page, "is-reviews")) === "1");
  ok("check review: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
for (const [lang, title, reveal, grades, dir] of [
  ["ru", "Вероятность", "Показать ответ", "Верно|Частично|Неверно", "ltr"],
  ["ar", null, "إظهار الإجابة", "صحيح|جزئيًا|خطأ", "rtl"],
]) {
  const { page, errors } = await open({ query: `?lang=${lang}&panel=1` });
  const id = await page.evaluate(async (t) => {
    const nodes = [...tropa.plugin.store.graph.nodes.values()];
    const node = t ? nodes.find((n) => n.title === t) : nodes.find((n) => n.title === "Probability");
    for (let i = 0; i < 50 && !tropa.plugin.checks.count(node.id); i++) await new Promise((r) => setTimeout(r, 50));
    return node.id;
  }, title);
  await page.evaluate((i) => { void tropa.plugin.checks.checkNow(i); }, id); await wait(page, 200);
  const modal = checkModal(page);
  ok(`check ${lang}: the window is translated`, (await modal.locator("button.tropa-check-reveal").innerText()) === reveal);
  await modal.locator("button.tropa-check-reveal").click(); await wait(page, 50);
  ok(`check ${lang}: grades translated`, (await modal.locator(".tropa-check-grade").allInnerTexts()).join("|") === grades, (await modal.locator(".tropa-check-grade").allInnerTexts()).join("|"));
  ok(`check ${lang}: direction`, (await page.evaluate(() => getComputedStyle(document.querySelector(".modal.tropa-check-modal")).direction)) === dir);
  if (lang === "ru") ok("check ru: the example map has Russian questions", (await modal.locator(".tropa-check-question").innerText()) === "Что такое P(A | B)?");
  await page.screenshot({ path: SHOTS + `99-check-${lang}.png` });
  ok(`check ${lang}: no errors`, errors.length === 0, errors.join("; "));
  await page.close();
}
{
  const { page, errors } = await open({ width: 390, height: 844, touch: true, query: "?phone" });
  await page.waitForFunction(() => tropa.plugin.checks.count([...tropa.plugin.store.graph.nodes.values()].find((n) => n.title === "Probability").id) === 1);
  await mapSelect(page, "Probability"); await wait(page, 400);
  const start = page.locator("#center .tropa-side button.tropa-check-start");
  await start.scrollIntoViewIfNeeded();
  await start.tap(); await wait(page, 200);
  const modal = checkModal(page);
  await modal.locator("button.tropa-check-reveal").tap(); await wait(page, 100);
  const sizes = await modal.locator(".tropa-check-grade").evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { h: r.height, left: r.left, right: r.right }; }));
  ok("check phone: grades are finger-sized and on screen", sizes.length === 3 && sizes.every((b) => b.h >= 44 && b.left >= 0 && b.right <= 390), JSON.stringify(sizes));
  await page.screenshot({ path: SHOTS + "99-check-phone.png" });
  await modal.locator('button[data-grade="wrong"]').tap(); await wait(page, 100);
  ok("check phone: forgot, so not yet is the first choice", (await modal.locator("button.tropa-check-later").getAttribute("class")).includes("mod-cta"));
  await modal.locator("button.tropa-check-later").tap(); await wait(page, 300);
  ok("check phone: not mastered, the result kept", !(await state(page, "Probability")).includes("state-mastered") && /checked \[\[Probability\]\] rating=1\n$/.test(await ownJournal(page)));
  ok("check phone: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}

// --- suggested links from plain notes
const linkRows = (page, section) => page.locator(`.tropa-batch-section.is-${section} .tropa-batch-row`);
const linkRow = (page, from, to) => page.locator(`.tropa-batch-row[data-from="Course/${from}.md"][data-to="Course/${to}.md"]`);
const pickScope = async (page, text) => {
  await page.keyboard.type(text); await wait(page, 100); await page.keyboard.press("Enter"); await wait(page, 200);
};
{
  const { page, errors } = await open({ query: "?scenario=links" });
  ok("links: command is registered", await page.evaluate(() => tropa.plugin.commands.some((c) => c.id === "suggest-links" && c.name === "Suggest links from your notes")));
  ok("links: undo command waits for a batch", await page.evaluate(() => tropa.plugin.commands.find((c) => c.id === "undo-links").checkCallback(true) === false));
  await runCommand(page, "suggest-links"); await wait(page, 150);
  const scopes = await page.locator(".modal .tropa-pick-text > div:first-child").allInnerTexts();
  ok("links: scopes are the whole vault and the folders", scopes[0] === "All notes" && scopes.includes("Course") && scopes.includes("Other"), scopes.join(", "));
  await pickScope(page, "Course");
  ok("links: preview opens with the folder in its title", (await page.locator(".tropa-batch-modal .modal-title").innerText()) === "Suggested links: Course");
  const counts = {};
  for (const section of ["list", "link", "mutual"]) counts[section] = await linkRows(page, section).count();
  ok("links: rows by where they were found", JSON.stringify(counts) === JSON.stringify({ list: 2, link: 2, mutual: 1 }), JSON.stringify(counts));
  ok("links: list rows are ticked and read as sentences", (await linkRow(page, "Derivatives", "Limits").locator("input").isChecked())
    && (await linkRow(page, "Derivatives", "Limits").innerText()).replace(/\s+/g, " ").startsWith("Derivatives needs recommends Limits")
    && (await linkRow(page, "Derivatives", "Limits").locator("select").inputValue()) === "requires");
  ok("links: the list is named", (await linkRow(page, "Derivatives", "Limits").locator(".tropa-batch-meta").innerText()) === "In the list of Calculus course");
  ok("links: text links unticked", !(await linkRow(page, "Limits", "Functions").locator("input").isChecked()));
  ok("links: a link both ways is recommended", (await linkRow(page, "Integrals", "Series").locator("select").inputValue()) === "recommends");
  ok("links: a pair from the list is not offered again from the text", (await linkRow(page, "Derivatives", "Integrals").count()) === 0);
  ok("links: materials, other note types, embeds and notes far away are left out", (await page.locator('.tropa-batch-row[data-to="Course/Calculus book.md"], .tropa-batch-row[data-from^="Course/Daily"], .tropa-batch-row[data-to="Other/Far note.md"], .tropa-batch-row[data-to="Course/graph.png"]').count()) === 0);
  ok("links: apply counts the ticked rows", (await page.locator(".tropa-batch-apply").innerText()) === "Add links (2)");
  const loop = linkRow(page, "Wrap-up", "Old A");
  // A refused tick does not stick, so this is a click rather than check().
  await loop.locator("input").click(); await wait(page, 100);
  ok("links: a link that closes a loop is refused", !(await loop.locator("input").isChecked()) && (await loop.getAttribute("class")).includes("is-refused"));
  ok("links: the loop is spelled out", (await loop.locator(".tropa-batch-loop").innerText()) === "Would close a loop: Wrap-up → Old A → Old B → Wrap-up", await loop.locator(".tropa-batch-loop").innerText());
  await loop.locator("select").selectOption("recommends"); await wait(page, 100);
  ok("links: as recommended it is taken", (await loop.locator("input").isChecked()) && !(await loop.getAttribute("class")).includes("is-refused"));
  await linkRow(page, "Limits", "Functions").locator("input").click(); await wait(page, 100);
  await page.locator(".tropa-batch-modal input[type=search]").fill("seri"); await wait(page, 100);
  ok("links: the filter hides other rows", (await page.locator(".tropa-batch-row:not(.is-hidden)").count()) === 1);
  await page.locator(".tropa-batch-modal input[type=search]").fill("");
  await page.screenshot({ path: SHOTS + "70-links.png" });
  ok("links: apply counts the chosen rows", (await page.locator(".tropa-batch-apply").innerText()) === "Add links (4)");
  await page.click(".tropa-batch-apply"); await wait(page, 600);
  const derivatives = await note(page, "Course/Derivatives.md");
  ok("links: required link written with the concept type", /type: concept/.test(derivatives) && /requires:\s*\n\s*- "?\[\[Limits\]\]/.test(derivatives) && derivatives.endsWith("Leads to [[Integrals]].\n"), derivatives);
  ok("links: a target becomes a concept too", /type: concept/.test(await note(page, "Course/Functions.md")));
  ok("links: recommended link written", /recommends:\s*\n\s*- "?\[\[Old A\]\]/.test(await note(page, "Course/Wrap-up.md")));
  ok("links: the notice counts the links", (await page.evaluate("tropa.notices")).includes("Links added: 4Undo"), JSON.stringify(await page.evaluate("tropa.notices")));
  ok("links: the map follows", await page.evaluate(() => tropa.plugin.store.graph.nodes.get("Course/Integrals.md")?.requires.includes("Course/Derivatives.md")));
  await page.locator(".notice .tropa-notice-undo").click(); await wait(page, 600);
  ok("links: undo takes the batch back", !(await note(page, "Course/Derivatives.md")).includes("requires") && !(await note(page, "Course/Functions.md")).includes("type")
    && !(await note(page, "Course/Wrap-up.md")).includes("recommends") && (await note(page, "Course/Wrap-up.md")).includes("type: concept"));
  ok("links: undone", (await page.evaluate("tropa.notices")).includes("The suggested links were removed."));
  // Again, then a hand edit before undoing: that note keeps the edit.
  await runCommand(page, "suggest-links"); await wait(page, 150);
  await pickScope(page, "Course");
  await page.click(".tropa-batch-apply"); await wait(page, 600);
  await page.evaluate(() => tropa.plugin.store.addLink("Course/Derivatives.md", "requiresKey", "Course/Functions.md")); await wait(page, 300);
  ok("links: undo command is offered after a batch", await page.evaluate(() => tropa.plugin.commands.find((c) => c.id === "undo-links").checkCallback(true)));
  await page.evaluate(() => tropa.plugin.commands.find((c) => c.id === "undo-links").checkCallback(false)); await wait(page, 600);
  ok("links: a note edited since keeps its edit", (await note(page, "Course/Derivatives.md")).includes("[[Functions]]") && !(await note(page, "Course/Integrals.md")).includes("requires"));
  ok("links: and the notice says so", (await page.evaluate("tropa.notices")).includes("The suggested links were removed. Notes changed since and left as they are: 1"), JSON.stringify(await page.evaluate("tropa.notices")));
  ok("links: no console errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  const { page, errors } = await open({ query: "?scenario=empty" });
  await page.click('.tropa-empty button:text-is("Suggest links from my notes")'); await wait(page, 150);
  await page.keyboard.press("Enter"); await wait(page, 200);
  ok("links: the empty map offers suggestions, and says when there are none", (await page.evaluate("tropa.notices")).includes("No new links found in All notes."));
  ok("links empty: no console errors", errors.length === 0, errors.join("; "));
  await page.close();
}
for (const [lang, title, dir] of [["ru", "Предложенные связи: Course", "ltr"], ["ar", "روابط مقترحة: ⁨Course⁩", "rtl"]]) {
  const { page, errors } = await open({ query: `?scenario=links&lang=${lang}` });
  await runCommand(page, "suggest-links"); await wait(page, 150);
  await pickScope(page, "Course");
  ok(`links ${lang}: title`, (await page.locator(".tropa-batch-modal .modal-title").innerText()) === title, await page.locator(".tropa-batch-modal .modal-title").innerText());
  ok(`links ${lang}: direction`, (await page.evaluate(() => getComputedStyle(document.querySelector(".modal.tropa-batch-modal")).direction)) === dir);
  ok(`links ${lang}: note names keep their own direction`, await page.evaluate(() => [...document.querySelectorAll(".tropa-batch-note")].every((el) => getComputedStyle(el).direction === "ltr")));
  if (lang === "ru") ok("links ru: the kind reads in Russian", (await linkRow(page, "Derivatives", "Limits").locator("select option:checked").innerText()) === "требует");
  await page.screenshot({ path: SHOTS + `71-links-${lang}.png` });
  ok(`links ${lang}: no errors`, errors.length === 0, errors.join("; "));
  await page.close();
}
{
  const { page, errors } = await open({ width: 390, height: 844, touch: true, query: "?scenario=links&phone" });
  await runCommand(page, "suggest-links"); await wait(page, 150);
  await pickScope(page, "Course");
  const fits = await page.evaluate(() => [...document.querySelectorAll(".tropa-batch-row")].every((row) => row.getBoundingClientRect().right <= innerWidth + 0.5) && document.documentElement.scrollWidth <= innerWidth);
  ok("links phone: rows fit the screen", fits);
  const select = await linkRow(page, "Derivatives", "Limits").locator("select").boundingBox();
  ok("links phone: the kind is finger-sized", select && select.height >= 36, JSON.stringify(select));
  await linkRow(page, "Limits", "Functions").locator("input").tap(); await wait(page, 100);
  ok("links phone: a tap ticks a row", await linkRow(page, "Limits", "Functions").locator("input").isChecked());
  await page.screenshot({ path: SHOTS + "72-links-phone.png" });
  ok("links phone: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}

// --- a map from a pasted list
const OUTLINE = ["- Machine learning", "  - linear algebra", "  - Probability", "    - Bayes' theorem", "  - calculus", "  - Statistics", "  - C++: tools?"].join("\n");
const NEW = "Tropa/Concepts";
const journalText = async (page) => {
  await page.evaluate(() => tropa.plugin.journal.settled());
  return page.evaluate(() => [...tropa.app.vault.contents].filter(([path]) => path.startsWith(tropa.plugin.settings.journalFolder + "/")).map(([, text]) => text).join("\n"));
};
const isGoal = (page, path) => page.evaluate((p) => tropa.plugin.store.progress.goal === p || (tropa.plugin.store.progress.goals ?? []).includes(p), path);
const pasteOutline = async (page, text = OUTLINE) => {
  await runCommand(page, "map-from-list"); await wait(page, 150);
  await page.fill(".tropa-outline-text", text); await wait(page, 100);
};
{
  const { page, errors } = await open({ query: "?scenario=outline" });
  ok("outline: command is registered", await page.evaluate(() => tropa.plugin.commands.some((c) => c.id === "map-from-list" && c.name === "Create a map from a list")));
  ok("outline: undo command waits for a map", await page.evaluate(() => tropa.plugin.commands.find((c) => c.id === "undo-map-from-list").checkCallback(true) === false));
  await runCommand(page, "map-from-list"); await wait(page, 150);
  ok("outline: preview waits for a list", await page.locator(".tropa-outline-preview").isDisabled());
  ok("outline: new notes go to the concepts folder by default", (await page.locator(".tropa-outline-folder").inputValue()) === NEW);
  await page.fill(".tropa-outline-text", "\n\n"); await wait(page, 100);
  ok("outline: blank text is nothing yet", (await page.locator(".tropa-outline-count").innerText()) === "" && await page.locator(".tropa-outline-preview").isDisabled());
  await page.fill(".tropa-outline-text", "```\n- code\n```"); await wait(page, 100);
  ok("outline: says when there are no items", (await page.locator(".tropa-outline-count").innerText()) === "No items found. Put one concept per line.");
  await page.fill(".tropa-outline-text", OUTLINE); await wait(page, 100);
  ok("outline: counts the items", (await page.locator(".tropa-outline-count").innerText()) === "Items: 7");
  await page.screenshot({ path: SHOTS + "73-outline-form.png" });
  ok("outline: nesting reads as parts by default, chain off", (await page.locator(".tropa-outline-order select").inputValue()) === "parts" && !(await page.locator(".tropa-outline-chain input").isChecked()));
  await page.click(".tropa-outline-preview"); await wait(page, 200);
  ok("outline: the preview opens", (await page.locator(".tropa-batch-modal .modal-title").innerText()) === "Map from a list");
  const chips = (cls) => page.locator(`.tropa-outline-notes.${cls} .tropa-outline-chip`).allInnerTexts();
  ok("outline: new notes listed, a ghost spelled as the map has it, a file name cleaned", JSON.stringify(await chips("is-new")) === JSON.stringify(["Machine learning", "Bayes' theorem", "calculus", "Statistics", "C++: tools? (file: C++ tools)"]), JSON.stringify(await chips("is-new")));
  ok("outline: the new notes' folder is named", (await page.locator(".tropa-outline-notes.is-new h3").innerText()) === `New notes in ${NEW}: 5`);
  ok("outline: notes in the vault matched by name, a material passed over", JSON.stringify(await chips("is-existing")) === JSON.stringify(["linear algebra", "Probability"]), JSON.stringify(await chips("is-existing")));
  ok("outline: the ghost's note takes its spelling", (await page.locator(`.tropa-outline-chip[data-path="${NEW}/Calculus.md"]`).count()) === 1);
  ok("outline: nesting rows ticked, order rows not", (await page.locator(".tropa-batch-section.is-nest .tropa-batch-row.is-checked").count()) === 6
    && (await page.locator(".tropa-batch-section.is-order .tropa-batch-row").count()) === 4 && (await page.locator(".tropa-batch-section.is-order .tropa-batch-row.is-checked").count()) === 0);
  const sentence = page.locator(`.tropa-batch-row[data-from="${NEW}/Machine learning.md"][data-to="Algebra/Linear Algebra.md"]`);
  ok("outline: a row reads as a sentence", (await sentence.locator(".tropa-batch-note").allInnerTexts()).join(" | ") === "Machine learning | linear algebra" && (await sentence.locator("select option:checked").innerText()) === "needs");
  ok("outline: apply counts notes and links", (await page.locator(".tropa-batch-apply").innerText()) === "Create notes: 5, links: 6");
  await page.screenshot({ path: SHOTS + "73-outline.png" });
  // Cancel keeps the list for another try.
  await page.click('.tropa-batch-modal button:text-is("Cancel")'); await wait(page, 150);
  await runCommand(page, "map-from-list"); await wait(page, 150);
  ok("outline: the list is kept after a cancel", (await page.locator(".tropa-outline-text").inputValue()) === OUTLINE);
  await page.click(".tropa-outline-preview"); await wait(page, 200);
  await page.locator(`.tropa-batch-row[data-from="${NEW}/Calculus.md"][data-to="Probability.md"] input`).check(); await wait(page, 100);
  ok("outline: an order row can be ticked", (await page.locator(".tropa-batch-apply").innerText()) === "Create notes: 5, links: 7");
  await page.click(".tropa-batch-apply"); await wait(page, 700);
  const ml = await note(page, `${NEW}/Machine learning.md`);
  ok("outline: a new note is a concept with its parts", /type: concept/.test(ml) && /\[\[Linear Algebra\]\]/.test(ml) && /\[\[Probability\]\]/.test(ml) && /\[\[C\+\+ tools\]\]/.test(ml), ml);
  ok("outline: a name shared with a material links by path", /\[\[Tropa\/Concepts\/Statistics\]\]/.test(ml), ml);
  const probability = await note(page, "Probability.md");
  ok("outline: a plain note becomes a concept and keeps its text", /type: concept/.test(probability) && /\[\[Bayes' theorem\]\]/.test(probability) && probability.endsWith("Chance and odds.\n"), probability);
  ok("outline: the order link is written", /\[\[Probability\]\]/.test(await note(page, `${NEW}/Calculus.md`)));
  ok("outline: the ghost is a note now", await page.evaluate((path) => tropa.plugin.store.graph.nodes.get("Old/Goal.md").requires.includes(path) && !tropa.plugin.store.graph.nodes.get(path).ghost, `${NEW}/Calculus.md`));
  ok("outline: the notice counts notes and links", (await page.evaluate("tropa.notices")).includes("Notes created: 5. Links added: 7UndoSet Machine learning as goal"), JSON.stringify(await page.evaluate("tropa.notices")));
  ok("outline: undo is offered", await page.evaluate(() => tropa.plugin.commands.find((c) => c.id === "undo-map-from-list").checkCallback(true)));
  ok("outline: the notice offers the top item as the goal", (await page.locator(".tropa-notice-goal").innerText()) === "Set Machine learning as goal");
  await page.click(".tropa-notice-goal"); await wait(page, 500);
  ok("outline: the top item is the goal", await page.evaluate((p) => tropa.plugin.store.progress.goal === p, `${NEW}/Machine learning.md`));
  ok("outline: the goal is announced, and the button goes", (await page.evaluate("tropa.notices")).includes("Goal: Machine learning") && (await page.locator(".tropa-notice-goal").count()) === 0);
  ok("outline: the goal goes to the journal", /\sgoal \[\[Machine learning\]\]/.test(await journalText(page)), await journalText(page));
  ok("outline: the route leads to it", await page.evaluate(() => document.querySelector(".tropa-goal-label")?.textContent === "Machine learning"));
  await page.click(".tropa-notice-undo"); await wait(page, 700);
  ok("outline: undo takes the goal back too", !(await isGoal(page, `${NEW}/Machine learning.md`)));
  ok("outline: undo trashes the new notes", await page.evaluate((folder) => ![...tropa.app.vault.files.keys()].some((path) => path.startsWith(folder + "/")), NEW));
  const restored = await note(page, "Probability.md");
  ok("outline: and puts the plain note back", !/type|requires/.test(restored) && restored.endsWith("Chance and odds.\n"), restored);
  ok("outline: undone", (await page.evaluate("tropa.notices")).includes("The map from the list was removed."));
  // Again, then an edit to a new note before undoing: that note stays.
  await pasteOutline(page);
  await page.click(".tropa-outline-preview"); await wait(page, 200);
  await page.click(".tropa-batch-apply"); await wait(page, 700);
  await page.evaluate((path) => tropa.app.vault.modify(tropa.app.vault.getAbstractFileByPath(path), tropa.app.vault.contents.get(path) + "My notes.\n"), `${NEW}/Statistics.md`); await wait(page, 300);
  await page.evaluate(() => tropa.plugin.commands.find((c) => c.id === "undo-map-from-list").checkCallback(false)); await wait(page, 700);
  ok("outline: a note changed since stays", (await note(page, `${NEW}/Statistics.md`)).includes("My notes.") && (await note(page, `${NEW}/Bayes' theorem.md`)) === "");
  ok("outline: and the notice says so", (await page.evaluate("tropa.notices")).includes("The map from the list was removed. Notes changed since and left as they are: 1"), JSON.stringify(await page.evaluate("tropa.notices")));
  // A table of contents, the other way round, with the chain.
  await pasteOutline(page, "1 Basics 1\n1.1 Sets ..... 2\n1.2 Logic 5\n2 Proofs 9");
  await page.selectOption(".tropa-outline-order select", "topic");
  await page.locator(".tropa-outline-chain input").check();
  await page.fill(".tropa-outline-folder", "Book"); await wait(page, 100);
  await page.click(".tropa-outline-preview"); await wait(page, 200);
  ok("outline toc: page numbers dropped", JSON.stringify(await chips("is-new")) === JSON.stringify(["Basics", "Sets", "Logic", "Proofs"]), JSON.stringify(await chips("is-new")));
  ok("outline toc: parts need their topic, the chain is ticked", await page.locator('.tropa-batch-row[data-from="Book/Sets.md"][data-to="Book/Basics.md"] input').isChecked()
    && await page.locator('.tropa-batch-row[data-from="Book/Logic.md"][data-to="Book/Sets.md"] input').isChecked()
    && await page.locator('.tropa-batch-row[data-from="Book/Proofs.md"][data-to="Book/Basics.md"] input').isChecked());
  await page.click(".tropa-batch-apply"); await wait(page, 700);
  ok("outline toc: notes in the chosen folder", /\[\[Basics\]\]/.test(await note(page, "Book/Sets.md")));
  ok("outline: no console errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  const { page, errors } = await open({ query: "?scenario=empty" });
  await page.click('.tropa-empty button:text-is("Map from a list")'); await wait(page, 150);
  ok("outline: the empty map offers a map from a list", (await page.locator(".tropa-outline-modal .modal-title").innerText()) === "Map from a list");
  await page.fill(".tropa-outline-text", "- One\n  - Two"); await wait(page, 100);
  await page.click(".tropa-outline-preview"); await wait(page, 200);
  await page.click(".tropa-batch-apply"); await wait(page, 800);
  ok("outline: the empty map fills", await page.evaluate(() => tropa.plugin.store.graph.nodes.get("Tropa/Concepts/One.md")?.requires.includes("Tropa/Concepts/Two.md")));
  ok("outline empty: no console errors", errors.length === 0, errors.join("; "));
  await page.close();
}
for (const [lang, title, dir, apply, goal, goalSet] of [
  ["ru", "Карта из списка", "ltr", "Создать заметок: 5, связей: 6", "Сделать целью: Machine learning", "Цель: Machine learning"],
  ["ar", "خريطة من قائمة", "rtl", "إنشاء ملاحظات: 5، روابط: 6", "تعيين \u2068Machine learning\u2069 هدفًا", "الهدف: \u2068Machine learning\u2069"],
]) {
  const { page, errors } = await open({ query: `?scenario=outline&lang=${lang}` });
  await pasteOutline(page);
  ok(`outline ${lang}: title`, (await page.locator(".tropa-outline-modal .modal-title").innerText()) === title);
  ok(`outline ${lang}: direction`, (await page.evaluate(() => getComputedStyle(document.querySelector(".modal.tropa-outline-modal")).direction)) === dir);
  await page.click(".tropa-outline-preview"); await wait(page, 200);
  ok(`outline ${lang}: apply label`, (await page.locator(".tropa-batch-apply").innerText()) === apply, await page.locator(".tropa-batch-apply").innerText());
  await page.click(".tropa-batch-apply"); await wait(page, 700);
  ok(`outline ${lang}: the goal button`, (await page.locator(".tropa-notice-goal").innerText()) === goal, await page.locator(".tropa-notice-goal").innerText());
  await page.screenshot({ path: SHOTS + `76-outline-goal-${lang}.png` });
  await page.click(".tropa-notice-goal"); await wait(page, 500);
  ok(`outline ${lang}: the goal is set`, await isGoal(page, `${lang === "ru" ? "Tropa/Концепты" : NEW}/Machine learning.md`));
  ok(`outline ${lang}: and announced`, (await page.evaluate("tropa.notices")).includes(goalSet), JSON.stringify(await page.evaluate("tropa.notices")));
  ok(`outline ${lang}: note names keep their own direction`, await page.evaluate(() => [...document.querySelectorAll(".tropa-outline-chip")].every((el) => getComputedStyle(el).direction === "ltr")));
  await page.screenshot({ path: SHOTS + `74-outline-${lang}.png` });
  ok(`outline ${lang}: no errors`, errors.length === 0, errors.join("; "));
  await page.close();
}
{
  const { page, errors } = await open({ width: 390, height: 844, touch: true, query: "?scenario=outline&phone" });
  await pasteOutline(page);
  const fits = () => page.evaluate(() => [...document.querySelectorAll(".modal *")].every((el) => el.getBoundingClientRect().right <= innerWidth + 0.5) && document.documentElement.scrollWidth <= innerWidth);
  ok("outline phone: the form fits the screen", await fits());
  await page.click(".tropa-outline-preview"); await wait(page, 200);
  ok("outline phone: the preview fits the screen", await fits());
  await page.screenshot({ path: SHOTS + "75-outline-phone.png" });
  await page.click(".tropa-batch-apply"); await wait(page, 700);
  const goalButton = await page.locator(".tropa-notice-goal").boundingBox();
  ok("outline phone: the goal button fits the screen", goalButton && goalButton.x >= 0 && goalButton.x + goalButton.width <= 390.5, JSON.stringify(goalButton));
  await page.locator(".tropa-notice-goal").tap(); await wait(page, 500);
  ok("outline phone: a tap sets the goal", await isGoal(page, `${NEW}/Machine learning.md`));
  ok("outline phone: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}

// --- presence: the status bar, the tropa block in notes, page previews
const statusEl = (page) => page.locator(".status-bar-item.tropa-status");
const statusText = async (page) => ((await statusEl(page).getAttribute("class")).includes("is-hidden") ? "" : await statusEl(page).innerText());
// The block just drawn, found by its place, so it stays the same block as others are added.
const renderBlock = async (page, source, path) => {
  const index = await page.locator(".block-language-tropa").count();
  await page.evaluate(([s, p]) => tropa.renderBlock(s, p), [source, path]);
  await wait(page, 150);
  return page.locator(".block-language-tropa").nth(index);
};
const listeners = (page) => page.evaluate(() => ["store", "reviews"].map((name) => tropa.plugin[name].handlers.get("change")?.size ?? 0).join("/"));
{
  const { page, errors } = await open({ query: "?panel=1" });
  ok("presence: the hover source is registered for Page preview", await page.evaluate(() => JSON.stringify(tropa.hoverSources.get("tropa")) === JSON.stringify({ display: "Tropa", defaultMod: true })));
  // The status bar: the next step alone, then reviews first.
  ok("presence: the status bar shows the next step", (await statusText(page)) === "Next: Chain rule", await statusText(page));
  ok("presence: its label says where a click goes", (await statusEl(page).getAttribute("aria-label")) === "Tropa: show the next step");
  await statusEl(page).click(); await wait(page, 200);
  ok("presence: a click shows the next step in the panel", (await page.locator("#right .tropa-title").first().innerText()) === "Chain rule");
  await seedOldMarks(page);
  ok("presence: reviews come first in the status bar", (await statusText(page)) === "To review: 3 · Next: Chain rule", await statusText(page));
  ok("presence: then a click opens the queue", (await statusEl(page).getAttribute("aria-label")) === "Tropa: open today's reviews");
  await statusEl(page).click(); await wait(page, 200);
  ok("presence: the queue is in the panel", (await page.locator("#right .tropa-review-queue .tropa-review-item").count()) === 3);
  await page.evaluate(() => { tropa.plugin.settings.reviewLimit = 2; tropa.plugin.reviews.refresh(); }); await wait(page, 150);
  ok("presence: the status bar keeps to today's limit", (await statusText(page)).startsWith("To review: 2 ·"), await statusText(page));
  await page.evaluate(() => tropa.plugin.settingTab.setControlValue("statusBar", false)); await wait(page, 100);
  ok("presence: the status bar can be turned off", (await statusText(page)) === "" && (await page.evaluate(() => tropa.plugin.settingTab.getControlValue("statusBar"))) === false);
  await page.evaluate(() => tropa.plugin.settingTab.setControlValue("statusBar", true)); await wait(page, 100);
  ok("presence: and on again", (await statusText(page)).startsWith("To review: 2"));

  // A block listens to the store and the queue while it is there, and lets go when it is unloaded.
  const before = await listeners(page);
  await renderBlock(page, "show: next");
  const during = await listeners(page);
  await page.evaluate(() => tropa.unloadBlocks());
  ok("presence: a block listens while drawn and lets go once unloaded", during !== before && (await listeners(page)) === before, `${before} → ${during} → ${await listeners(page)}`);

  // The route block.
  const route = await renderBlock(page, "limit: 3");
  ok("presence: the route block names the goal as a link", (await route.locator(".tropa-block-goal .internal-link").innerText()) === "Transformer");
  ok("presence: it counts the steps and the time left", (await route.locator(".tropa-block-count").innerText()).startsWith("14 steps to the goal · "));
  ok("presence: limit keeps three steps", (await route.locator(".tropa-block-item").count()) === 3);
  ok("presence: the next step comes with its material", (await route.locator(".tropa-block-item.is-next .tropa-block-meta").innerText()).includes("Essence of calculus"));
  ok("presence: the rest is counted", (await route.locator(".tropa-block-more").innerText()) === "More on the map: 11");
  ok("presence: steps are internal links, as in a note", (await route.locator(".tropa-block-item > a.internal-link").first().getAttribute("data-href")) === "Chain rule");
  await route.locator(".tropa-block-item").first().locator("input").click(); await wait(page, 300);
  ok("presence: a ticked step is mastered", await page.evaluate(() => tropa.plugin.store.progress.mastered.has([...tropa.plugin.store.graph.nodes.values()].find((n) => n.title === "Chain rule").id)));
  ok("presence: the block follows: the step is gone", !(await route.innerText()).includes("Chain rule") && (await route.locator(".tropa-block-count").innerText()).startsWith("13 steps"));
  ok("presence: the map, in sight, offers the undo", (await page.locator(".tropa-toast").innerText()).includes("Undo"));
  await page.click(".tropa-toast button"); await wait(page, 300);
  ok("presence: undo brings the step back to the block", (await route.locator(".tropa-block-item").first().innerText()).startsWith("Chain rule"));
  // Out of sight, the map leaves the undo to a notice.
  await page.evaluate(() => (document.getElementById("center").hidden = true));
  await route.locator(".tropa-block-item").first().locator("input").click(); await wait(page, 300);
  ok("presence: with the map out of sight a notice offers the undo", (await page.locator(".notice .tropa-notice-undo").count()) === 1, await lastNotice(page));
  await page.locator(".notice .tropa-notice-undo").click(); await wait(page, 300);
  ok("presence: the notice's undo works", (await route.locator(".tropa-block-item").first().innerText()).startsWith("Chain rule"));
  await page.evaluate(() => (document.getElementById("center").hidden = false));

  // Next, another goal, review.
  const next = await renderBlock(page, "show: next");
  ok("presence: the next block shows one step with its material", (await next.locator(".tropa-block-item").count()) === 1 && (await next.locator(".tropa-block-meta").count()) === 1);
  const other = await renderBlock(page, "goal: [[Gradient descent]]");
  const steps = await page.evaluate(() => tropa.plugin.store.routeTo([...tropa.plugin.store.graph.nodes.values()].find((n) => n.title === "Gradient descent").id).steps.length);
  ok("presence: goal leads the block to that goal", (await other.locator(".tropa-block-goal").innerText()) === "Goal: Gradient descent" && (await other.locator(".tropa-block-count").innerText()).startsWith(`${steps} step`));
  const review = await renderBlock(page, "show: review");
  ok("presence: the review block keeps to today's queue", (await review.locator(".tropa-block-item.is-due").count()) === 2 && (await review.locator(".tropa-block-count").innerText()) === "Review today: 2 of 3", await review.locator(".tropa-block-count").innerText());
  const reviewed = await review.locator(".tropa-block-item a.internal-link").first().innerText();
  await review.locator(".tropa-block-item input").first().click(); await wait(page, 150);
  ok("presence: ticking a review asks how well it was recalled", (await page.locator(".modal .tropa-review-rating").count()) === 4 && (await page.locator(".modal-title").innerText()) === reviewed);
  await page.locator('.modal button[data-rating="3"]').click();
  await settled(page); await wait(page, 250);
  ok("presence: a rating closes the dialog and saves the review", (await page.locator(".modal").count()) === 0 && (await lastNotice(page)).startsWith(`Review of ${reviewed} saved`), await lastNotice(page));
  ok("presence: the review block follows", (await review.locator(".tropa-block-item").count()) === 1 && !(await review.innerText()).includes(reviewed));
  ok("presence: and so does the status bar", (await statusText(page)).startsWith("To review: 1 ·"), await statusText(page));
  await page.evaluate(() => tropa.plugin.reviews.pauseUntil("2099-01-01"));
  await settled(page); await wait(page, 200);
  ok("presence: paused, the review block says so", (await review.innerText()).startsWith("Review paused until January 1, 2099"), await review.innerText());
  ok("presence: paused, the status bar says so", (await statusText(page)) === "Review paused until January 1, 2099 · Next: Chain rule", await statusText(page));
  await page.evaluate(() => tropa.plugin.reviews.resume());
  await settled(page); await wait(page, 200);

  // Mistakes are said in the block.
  for (const [source, text] of [
    ["show: map", "Tropa block: show takes route, review or next."],
    ["limit: 0", "Tropa block: limit takes a whole number from 1 to 100."],
    ["colour: red", "Tropa block: unknown option colour. Use show, goal and limit."],
    ["goal: [[Nowhere]]", "Tropa block: Nowhere is not a concept on the map."],
  ]) {
    const el = await renderBlock(page, source);
    ok(`presence: "${source}" is explained in the block`, (await el.locator(".tropa-block-error").innerText()) === text, await el.innerText());
  }
  await page.screenshot({ path: SHOTS + "80-presence.png" });

  // Previews: a link in a block, a node on the map.
  await route.locator("a.internal-link", { hasText: "Gradient descent" }).first().hover(); await wait(page, 50);
  ok("presence: a link in a block asks for a preview", await page.evaluate(() => { const h = tropa.hovers.at(-1); return h.source === "tropa" && h.linktext === "Gradient descent" && h.sourcePath === "Daily.md" && h.parent; }), JSON.stringify(await page.evaluate(() => tropa.hovers.at(-1))));
  await node(page, "Derivatives").hover(); await wait(page, 50);
  ok("presence: a node on the map asks for a preview of its note", await page.evaluate(() => { const h = tropa.hovers.at(-1); return h.source === "tropa" && h.linktext.endsWith("/Derivatives.md") && h.parent && h.target.includes("tropa-node"); }));
  // A link opens its note, in a new tab with the modifier. The mocked note view replaces the block.
  await page.evaluate(() => tropa.unloadBlocks());
  let linkBlock = await renderBlock(page, "limit: 2");
  await linkBlock.locator("a.internal-link", { hasText: "Gradient" }).last().click({ modifiers: ["Control"] }); await wait(page, 150);
  ok("presence: a link with the modifier opens in a new tab", await page.evaluate(() => { const o = tropa.app.workspace.opened.at(-1); return o.linktext === "Gradient" && o.newLeaf === "tab" && o.sourcePath === "Daily.md"; }));
  await page.evaluate(() => tropa.unloadBlocks());
  linkBlock = await renderBlock(page, "limit: 2");
  await linkBlock.locator("a.internal-link", { hasText: "Chain rule" }).first().click(); await wait(page, 150);
  ok("presence: a click opens the note", (await page.locator("#note .note-title").innerText()) === "Chain rule");
  ok("presence: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  // No goal yet: the block says so and offers the map.
  const { page, errors } = await open({ query: "?scenario=cycle" });
  const el = await renderBlock(page, "show: route");
  ok("presence: without a goal the block says so", (await el.locator(".tropa-block-hint").innerText()).startsWith("No goal yet.") && (await el.locator("button.tropa-block-button").innerText()) === "Open the map");
  ok("presence: without a goal or reviews the status bar hides", (await statusText(page)) === "");
  ok("presence: no goal, no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
// The review block with a goal: today's queue, only what lies on the way to the goal.
const goalQueue = (page, title) => page.evaluate((t) => {
  const { store, reviews } = tropa.plugin;
  const goal = [...store.graph.nodes.values()].find((n) => n.title === t).id;
  const path = new Set([goal, ...store.graph.ancestors(goal)]);
  const day = reviews.day();
  const name = (s) => store.graph.nodes.get(s.id).title;
  return { queue: day.queue.filter((s) => path.has(s.id)).map(name), waiting: day.held.filter((s) => path.has(s.id)).length };
}, title);
const blockTitles = (el) => el.locator(".tropa-block-item a.internal-link").allInnerTexts();
{
  const { page, errors } = await open({ query: "?panel=1" });
  await seedOldMarks(page);
  const gradient = await renderBlock(page, "show: review\ngoal: [[Gradient]]");
  const all = await renderBlock(page, "show: review");
  ok("review by goal: the block names the goal", (await gradient.locator(".tropa-block-goal").innerText()) === "Goal: Gradient");
  ok("review by goal: only what the goal requires, in queue order", JSON.stringify(await blockTitles(gradient)) === JSON.stringify((await goalQueue(page, "Gradient")).queue) &&
    (await blockTitles(gradient)).sort().join("|") === "Derivatives|Vectors and matrices", (await blockTitles(gradient)).join("|"));
  ok("review by goal: the count is of the filtered queue", (await gradient.locator(".tropa-block-count").innerText()) === "Review today: 2");
  ok("review by goal: without a goal the whole queue", (await all.locator(".tropa-block-item").count()) === 3);
  const apart = await renderBlock(page, "show: review\ngoal: [[Probability]]");
  ok("review by goal: nothing on the way says so", (await apart.innerText()) === "Goal: Probability\nNothing on the way to this goal to review right now", await apart.innerText());
  // One review a day: the filter takes the queue as the limit left it, and counts what of the goal waits.
  await page.evaluate(() => { tropa.plugin.settings.reviewLimit = 1; tropa.plugin.reviews.refresh(); }); await wait(page, 200);
  const expected = await goalQueue(page, "Gradient");
  ok("review by goal: the limit applies first, the filter keeps what is left", JSON.stringify(await blockTitles(gradient)) === JSON.stringify(expected.queue), `${await blockTitles(gradient)} vs ${expected.queue}`);
  const waitLine = `Waiting for the next days, on the way to this goal: ${expected.waiting}`;
  ok("review by goal: what of the goal waits is counted", expected.queue.length
    ? (await gradient.locator(".tropa-block-count").innerText()) === `Review today: ${expected.queue.length} of ${expected.queue.length + expected.waiting}` && (await gradient.locator(".tropa-block-waiting").innerText()) === waitLine
    : (await gradient.innerText()).endsWith(`Today's reviews are done. ${waitLine}`), await gradient.innerText());
  ok("review by goal: the whole queue keeps to the limit", (await all.locator(".tropa-block-item").count()) === 1 && (await all.locator(".tropa-block-waiting").innerText()) === "Waiting for the next days: 2");
  await page.screenshot({ path: SHOTS + "80-presence-review-goal.png" });
  ok("review by goal: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  const { page, errors } = await open({ query: "?lang=ar&panel=1" });
  await seedOldMarks(page);
  await page.evaluate(() => { tropa.plugin.settings.reviewLimit = 1; tropa.plugin.reviews.refresh(); }); await wait(page, 200);
  const el = await renderBlock(page, "show: review\ngoal: [[Gradient]]");
  // Names are isolated from the right-to-left text around them.
  const text = (await el.innerText()).replace(/[\u2066-\u2069]/g, "");
  ok("review by goal ar: translated, the goal named, no raw placeholders", text.startsWith("الهدف: Gradient") && text.includes("في الطريق إلى هذا الهدف") && !/[{}]/.test(text), text);
  ok("review by goal ar: right to left", (await el.evaluate((e) => getComputedStyle(e).direction)) === "rtl");
  ok("review by goal ar: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
for (const [lang, goal, next, dir] of [
  ["ru", "Цель: ", "Дальше: ", "ltr"],
  ["ar", "الهدف: ", "التالي: ", "rtl"],
]) {
  const { page, errors } = await open({ query: `?lang=${lang}&panel=1` });
  const el = await renderBlock(page, "limit: 2");
  ok(`presence ${lang}: the block translated`, (await el.locator(".tropa-block-goal").innerText()).startsWith(goal) && !/[{}]/.test(await el.innerText()), await el.innerText());
  ok(`presence ${lang}: the block's direction`, (await el.getAttribute("dir")) === dir && (await el.evaluate((e) => getComputedStyle(e).direction)) === dir);
  ok(`presence ${lang}: the status bar translated`, (await statusText(page)).startsWith(next), await statusText(page));
  const error = await renderBlock(page, "limit: 0");
  ok(`presence ${lang}: mistakes translated`, !/[{}]/.test(await error.innerText()) && (await error.innerText()).includes("100"));
  await page.screenshot({ path: SHOTS + `80-presence-${lang}.png` });
  ok(`presence ${lang}: no errors`, errors.length === 0, errors.join("; "));
  await page.close();
}
{
  const { page, errors } = await open({ width: 390, height: 844, touch: true, query: "?phone" });
  ok("presence phone: no status bar item on a phone", (await page.locator(".status-bar-item").count()) === 0);
  await page.evaluate(() => { document.getElementById("note").style.cssText = "display:block;position:fixed;inset:0;z-index:20;width:auto;background:var(--background-primary)"; });
  const el = await renderBlock(page, "limit: 3");
  const fits = await page.evaluate(() => [...document.querySelectorAll(".block-language-tropa *")].every((e) => e.getBoundingClientRect().right <= innerWidth + 0.5));
  ok("presence phone: the block fits the screen", fits);
  await el.locator(".tropa-block-item input").first().tap(); await wait(page, 300);
  ok("presence phone: a tap ticks a step", await page.evaluate(() => tropa.plugin.store.progress.mastered.size === 4));
  await page.screenshot({ path: SHOTS + "80-presence-phone.png" });
  const hovers = await page.evaluate(() => tropa.hovers.length);
  await page.evaluate(() => document.querySelector("#center .tropa-node").dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  ok("presence phone: no previews on a phone", (await page.evaluate(() => tropa.hovers.length)) === hovers);
  ok("presence phone: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}

await stop();
const passed = results.filter(Boolean).length;
console.log(passed, "/", results.length);
process.exit(passed === results.length ? 0 : 1);
