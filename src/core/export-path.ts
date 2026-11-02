/** A vault path for an export: no leading slash, no parent folders, the extension added when missing. */
export function exportPath(typed: string, extension: string): string | null {
  const parts = typed.trim().replace(/\\/g, "/").split("/").map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) return null;
  let name = parts.pop()!;
  if (!name.toLowerCase().endsWith(`.${extension}`)) name = `${name}.${extension}`;
  if (name === `.${extension}`) return null;
  return [...parts, name].join("/");
}

/** "Map.canvas" taken: "Map 2.canvas", then "Map 3.canvas". */
export function freePath(path: string, exists: (path: string) => boolean) {
  const dot = path.lastIndexOf(".");
  const stem = path.slice(0, dot).replace(/ \d+$/, "");
  const extension = path.slice(dot);
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n}${extension}`;
    if (!exists(candidate)) return candidate;
  }
}

/** A file name from a title: characters that vault paths or links do not allow are dropped. */
export function fileName(title: string) {
  return title.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim() || "Tropa";
}
