// README screenshots in both themes. Run with: npm run screenshots
import { mkdirSync } from "node:fs";
import { node, start } from "./serve.mjs";

const OUT = "docs/screenshots/";
mkdirSync(OUT, { recursive: true });
const { open, stop } = await start();

for (const theme of ["light", "dark"]) {
  const shot = async (name, prepare, query = "") => {
    const { page, errors } = await open({ scale: 2, query: `?theme=${theme}${query}` });
    await prepare?.(page);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}${name}-${theme}.png` });
    if (errors.length) throw new Error(`${name}-${theme}: ${errors.join("; ")}`);
    await page.close();
  };

  await shot("route");
  await shot("concept", async (page) => {
    await node(page, "Tokenization").click();
  });
  await shot("map", async (page) => {
    await page.click('button:text-is("Whole map")');
    await page.click(".tropa-toggle-sources");
    await page.waitForTimeout(600);
    await page.locator(".tropa-node.is-source", { hasText: "The Illustrated Transformer" }).click();
    await page.waitForTimeout(400);
    await page.click('[aria-label="Show whole map"]');
  });
  // A concept mastered 40 days ago on another device is due: the queue and its four ratings.
  await shot("review", async (page) => {
    await page.evaluate(() => {
      const line = `- ${new Date(Date.now() - 40 * 86400000).toISOString().replace(/\.\d+Z$/, "Z")} mastered [[Derivatives]]`;
      return tropa.app.vault.create("Tropa/Journal/2026-09 phone-beef.md", `---\ntype: learning-journal\n---\n\n${line}\n`);
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const store = tropa.plugin.store;
      tropa.app.workspace.center.view.select([...store.graph.nodes.values()].find((n) => n.title === "Derivatives").id);
    });
    await page.waitForTimeout(400);
  });
  // Checking yourself before marking a concept mastered, with the answer shown.
  await shot("check", async (page) => {
    await page.waitForFunction(() => tropa.plugin.checks.count([...tropa.plugin.store.graph.nodes.values()].find((n) => n.title === "Probability").id) === 1);
    await node(page, "Probability").click();
    await page.waitForTimeout(200);
    await page.click('.tropa-side button:text-is("Start learning")');
    await page.waitForTimeout(200);
    await page.click('.tropa-side button:text-is("Mark as mastered")');
    await page.waitForTimeout(200);
    await page.click(".modal.tropa-check-offer button.tropa-check-start");
    await page.waitForTimeout(200);
    await page.keyboard.press("Space");
    await page.waitForTimeout(300);
  });
  // Two goals, the route to both, a pace and a deadline, with the goal menu open.
  await shot("goals", async (page) => {
    await page.evaluate(() => {
      const store = tropa.plugin.store;
      const id = (title) => [...store.graph.nodes.values()].find((n) => n.title === title).id;
      const due = new Date();
      due.setDate(due.getDate() + 90);
      const date = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
      store.addGoal(id("Convolutional networks"));
      store.setAllGoals(true);
      store.setPlan(5, new Map([[id("Transformer"), date]]));
    });
    await page.waitForTimeout(800);
    await page.click(".tropa-goal");
    await page.waitForTimeout(200);
  });
  // Links suggested from a course outline and the notes' own links, in the preview before they are added.
  await shot("links", async (page) => {
    await page.evaluate(() => tropa.plugin.commands.find((c) => c.id === "suggest-links").callback());
    await page.waitForTimeout(200);
    await page.keyboard.type("Course");
    await page.waitForTimeout(100);
    await page.keyboard.press("Enter");
    await page.waitForSelector(".tropa-batch-modal");
    await page.evaluate(() => document.querySelectorAll(".tropa-batch-modal, .tropa-batch-modal *").forEach((el) => { el.scrollTop = 0; }));
    await page.waitForTimeout(300);
  }, "&scenario=links");
  // A pasted outline turned into notes and links, in the preview.
  await shot("outline", async (page) => {
    await page.evaluate(() => tropa.plugin.commands.find((c) => c.id === "map-from-list").callback());
    await page.waitForTimeout(200);
    await page.fill(".tropa-outline-text", ["- Machine learning", "  - Linear algebra", "  - Probability", "    - Bayes' theorem", "  - Calculus", "  - Statistics"].join("\n"));
    await page.waitForTimeout(100);
    await page.click(".tropa-outline-preview");
    await page.waitForSelector(".tropa-batch-modal");
    await page.evaluate(() => document.querySelectorAll(".tropa-batch-modal, .tropa-batch-modal *").forEach((el) => { el.scrollTop = 0; }));
    await page.waitForTimeout(300);
  }, "&scenario=outline");
  // The tropa block in a daily note: the route with the next step's material, and the status bar.
  await shot("block", async (page) => {
    await page.evaluate(() => tropa.renderBlock("show: route\nlimit: 5"));
    await page.waitForTimeout(400);
  });
}

// The audit beside the map, opened from its button in the bar (light theme only).
{
  const { page, errors } = await open({ width: 1600, scale: 2, query: "?scenario=audit" });
  await page.click("#center .tropa-audit-button");
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}audit-light.png` });
  if (errors.length) throw new Error(`audit: ${errors.join("; ")}`);
  await page.close();
}

await stop();
console.log(`Screenshots: ${OUT}`);
