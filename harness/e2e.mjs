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
  ok("materials shown", sources === 12, String(sources));
  await page.screenshot({ path: SHOTS + "14-materials.png" });
  await page.click(".tropa-toggle-sources"); await wait(page, 300);
  // goal change
  await page.click(".tropa-goal"); await wait(page, 100);
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
  ok("settings groups", headings.join("|") === "Files|Note properties|Map scope", headings.join("|"));
  ok("scope settings are text areas", (await page.locator("#settings textarea[data-key]").count()) === 2);
  ok("scope settings empty by default", (await page.locator('#settings textarea[data-key="excludeFolders"]').inputValue()) === "");
  ok("settings controls", (await page.locator("#settings input[data-key]").count()) === 8);
  ok("materials key setting", (await page.locator('#settings input[data-key="materialsKey"]').inputValue()) === "materials");
  const field = (key) => page.locator(`#settings input[data-key="${key}"]`);
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
  const legend = await page.locator(".tropa-legend-item").allInnerTexts();
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
  ok("engine choice is logged once", logs.filter((line) => line.startsWith("Tropa: map layout by")).join() === "Tropa: map layout by wasm in a worker", logs.join(" | "));
  const ms = await page.evaluate(`(()=>{const t=performance.now(); const v=${view}; v.layoutKey=''; v.render(); return performance.now()-t})()`);
  console.log("400 nodes, cached layout, render ms", Math.round(ms));
  ok("same shape comes from the cache", (await page.evaluate(`${view}.layouts.stats.cached`)) >= 1);
  await page.screenshot({ path: SHOTS + "50-large.png" });
  ok("large graph: no errors", errors.length === 0, errors.join("; "));
  await page.close();
}
{
  // 1000 concepts; materials on make it 1700 nodes: about 0.7 s for the WebAssembly engine, 1.5 s for TypeScript.
  const { page, errors } = await open({ query: "?scenario=large&n=1000&materials" });
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
  await layoutDone(page);
  const total = await page.evaluate(() => ((window.freeze.on = false), window.freeze.pending));
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
  ok("1000 concepts: no errors", errors.length === 0, errors.join("; "));
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
  ok("without WebAssembly the choice is logged", logs.some((line) => line === "Tropa: map layout by ts in a worker"), logs.join(" | "));
  ok("without WebAssembly: no page errors", errors.length === 0, errors.join("; "));
  await page.close();
}

await stop();
const passed = results.filter(Boolean).length;
console.log(passed, "/", results.length);
process.exit(passed === results.length ? 0 : 1);
