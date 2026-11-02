// Runs the benchmark in Chromium: `node bench/chromium.mjs [--full]` for timings,
// `--shots` for pictures of one graph laid out by both engines (dist/bench/shots).
// CHROMIUM_PATH points at an installed browser when its revision differs from Playwright's.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const html = (body) => `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">${body}</body>`;

if (!process.argv.includes("--shots")) {
  const page = await browser.newPage();
  page.on("console", (message) => console.log(message.text()));
  await page.setContent(html(""));
  await page.evaluate((full) => (window.benchFull = full), process.argv.includes("--full"));
  await page.addScriptTag({ content: readFileSync("dist/bench/browser.js", "utf8"), type: "module" });
  await page.waitForFunction(() => window.benchDone, null, { timeout: 0, polling: 1000 });
  const results = await page.evaluate(() => window.benchDone);
  mkdirSync("dist/bench", { recursive: true });
  writeFileSync("dist/bench/chromium.json", JSON.stringify({ ...results, browser: browser.version() }, null, 1));
  console.log("wrote dist/bench/chromium.json");
} else {
  mkdirSync("dist/bench/shots", { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.setContent(html(""));
  await page.addScriptTag({ content: readFileSync("dist/bench/render.js", "utf8"), type: "module" });
  await page.waitForFunction(() => window.renders, null, { timeout: 0 });
  for (const render of await page.evaluate(() => window.renders)) {
    // The whole map scaled to 2400 px wide, then a 1:1 crop around the same concept.
    const width = Number(render.svg.match(/width="([\d.]+)"/)[1]);
    const height = Number(render.svg.match(/height="([\d.]+)"/)[1]);
    const scale = 2400 / width;
    await page.setViewportSize({ width: 2400, height: Math.ceil(height * scale) });
    await page.setContent(html(`<div style="transform:scale(${scale});transform-origin:0 0">${render.svg}</div>`));
    await page.screenshot({ path: `dist/bench/shots/${render.name}-overview.png` });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.setContent(html(`<div style="position:absolute;left:${800 - render.anchor.x}px;top:${400 - render.anchor.y}px">${render.svg}</div>`));
    await page.screenshot({ path: `dist/bench/shots/${render.name}-detail.png` });
    console.log(`shot ${render.name}`);
  }
}
await browser.close();
