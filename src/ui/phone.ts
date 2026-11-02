/**
 * How far Obsidian's navigation bar on a phone reaches into an element from its bottom. The bar floats
 * over the content, so it is measured rather than assumed; the safe area is added in CSS.
 */
export function navbarOverlap(el: HTMLElement) {
  const bottom = el.getBoundingClientRect().bottom;
  let inset = 0;
  for (const bar of document.querySelectorAll<HTMLElement>(".mobile-navbar")) {
    const rect = bar.getBoundingClientRect();
    if (rect.height === 0 || rect.top >= bottom || rect.bottom < bottom - 240) continue;
    inset = Math.max(inset, bottom - rect.top + 8);
  }
  return Math.round(inset);
}
