const WIKILINK = /^\s*\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]\s*$/;

/** Reads `[[Note]]`, `[[Note|alias]]`, `[[Note#heading]]` or a bare `Note` from a property. */
export function parseLinkTarget(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = WIKILINK.exec(value);
  const target = (match ? match[1] : value).trim();
  return target.length ? target : null;
}

export function toList(value: unknown): unknown[] {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

export function linkTargets(value: unknown): string[] {
  return toList(value)
    .map(parseLinkTarget)
    .filter((target): target is string => target !== null);
}

export function basename(linkTarget: string) {
  return linkTarget.split("/").pop()!.replace(/\.md$/i, "");
}
