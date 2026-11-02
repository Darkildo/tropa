// Serves dist/preview and opens pages of the real plugin running on the mocked API.
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { chromium } from "playwright";

const ROOT = "dist/preview";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

export async function start() {
  const server = createServer((req, res) => {
    const path = join(ROOT, new URL(req.url, "http://x").pathname);
    if (!existsSync(path)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    createReadStream(path).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  // CHROMIUM_PATH points at an already installed browser when its revision differs from Playwright's.
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

  async function open({ width = 1440, height = 900, scale = 1, query = "", touch = false } = {}) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale, hasTouch: touch });
    const errors = [];
    const logs = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
      logs.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(url + query);
    await page.waitForSelector("#center .tropa-map");
    await page.waitForTimeout(500);
    return { page, errors, logs };
  }

  async function stop() {
    await browser.close();
    server.close();
  }

  return { open, stop };
}

export const node = (page, title) => page.locator(`.tropa-node:has(.tropa-node-title:text-is("${title}"))`);
