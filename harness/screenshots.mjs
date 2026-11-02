// README screenshots in both themes. Run with: npm run screenshots
import { mkdirSync } from "node:fs";
import { node, start } from "./serve.mjs";

const OUT = "docs/screenshots/";
mkdirSync(OUT, { recursive: true });
const { open, stop } = await start();

for (const theme of ["light", "dark"]) {
  const shot = async (name, prepare) => {
    const { page, errors } = await open({ scale: 2, query: `?theme=${theme}` });
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
}

await stop();
console.log(`Screenshots: ${OUT}`);
