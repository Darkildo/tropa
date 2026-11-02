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

// --- large graph performance
{
  const { page } = await open({ query: "?scenario=large&n=400" });
  const ms = await page.evaluate("(()=>{const t=performance.now(); const v=tropa.app.workspace.center.view; v.layoutKey=''; v.render(); return performance.now()-t})()");
  console.log("400 nodes render ms", Math.round(ms));
  await page.screenshot({ path: SHOTS + "50-large.png" });
  ok("large graph renders", (await page.locator(".tropa-node").count()) === 400);
  await page.close();
}

await stop();
const passed = results.filter(Boolean).length;
console.log(passed, "/", results.length);
process.exit(passed === results.length ? 0 : 1);
