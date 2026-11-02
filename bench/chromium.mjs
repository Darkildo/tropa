// Runs the benchmark (and, with --shots, the screenshots) in Chromium through Playwright.
// CHROMIUM_PATH points at an installed browser when its revision differs from Playwright's.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const shots = process.argv.includes("--shots");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

if (!shots) {
  const page = await browser.newPage();
  page.on("console", (message) => console.log(message.text()));
  await page.setContent("<!doctype html><title>bench</title>");
  await page.addScriptTag({ content: readFileSync("dist/bench/browser.js", "utf8"), type: "module" });
  await page.waitForFunction(() => window.benchDone, null, { timeout: 0, polling: 2000 });
  const results = await page.evaluate(() => window.benchDone);
  results.browserVersion = browser.version();
  writeFileSync("dist/bench/chromium.json", JSON.stringify(results, null, 1));
  console.log("wrote dist/bench/chromium.json");
} else {
  mkdirSync("docs/bench", { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.setContent("<!doctype html><title>render</title><body style='margin:0;background:#fff'></body>");
  await page.addScriptTag({ content: readFileSync("dist/bench/render.js", "utf8"), type: "module" });
  await page.waitForFunction(() => window.renders, null, { timeout: 0 });
  const renders = await page.evaluate(() => window.renders);
  for (const render of renders) {
    // Whole map scaled to 2400 px wide, then a 1:1 crop around the same concept.
    const width = Number(render.svg.match(/width="([\d.]+)"/)[1]);
    const height = Number(render.svg.match(/height="([\d.]+)"/)[1]);
    const scale = 2400 / width;
    await page.setViewportSize({ width: 2400, height: Math.ceil(height * scale) });
    await page.setContent(`<!doctype html><body style="margin:0;background:#fff"><div style="transform:scale(${scale});transform-origin:0 0">${render.svg}</div></body>`);
    await page.screenshot({ path: `docs/bench/200-${render.engine}-overview.png` });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.setContent(`<!doctype html><body style="margin:0;background:#fff;overflow:hidden"><div style="position:absolute;left:${800 - render.anchor.x}px;top:${400 - render.anchor.y}px">${render.svg}</div></body>`);
    await page.screenshot({ path: `docs/bench/200-${render.engine}-detail.png` });
    console.log(`shot ${render.engine}`);
  }
}
await browser.close();
