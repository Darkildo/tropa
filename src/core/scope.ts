/** Which notes the map leaves out: whole folders and notes with certain tags. */
export interface Scope {
  folders: string[];
  tags: string[];
}

/** One folder per line. Commas are allowed in folder names, so only line breaks separate them. */
export function parseFolders(value: unknown): string[] {
  const lines = Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(/\r?\n/) : [];
  const folders = lines.map((line) => line.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "")).filter(Boolean);
  return [...new Set(folders)];
}

/** Tags cannot hold spaces or commas, so any of them separates. `#` is optional, case does not matter, as in Obsidian. */
export function parseTags(value: unknown): string[] {
  const words = Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(/[\s,]+/) : [];
  const tags = words.map(normalizeTag).filter(Boolean);
  return [...new Set(tags)];
}

export function normalizeTag(tag: string) {
  return tag.trim().replace(/^#+/, "").replace(/\/+$/, "").toLowerCase();
}

/** A folder rule covers the folder itself and everything below it, segment by segment: `Archive` does not cover `Archive 2`. */
export function inFolders(path: string, folders: readonly string[]) {
  return folders.some((folder) => path === folder || path.startsWith(folder + "/"));
}

/** A tag rule covers nested tags too: `#draft` excludes `#draft/old`. */
export function hasTag(tags: readonly string[], rules: readonly string[]) {
  return tags.some((raw) => {
    const tag = normalizeTag(raw);
    return rules.some((rule) => tag === rule || tag.startsWith(rule + "/"));
  });
}

export function isExcluded(path: string, tags: readonly string[], scope: Scope) {
  return inFolders(path, scope.folders) || (scope.tags.length > 0 && hasTag(tags, scope.tags));
}
