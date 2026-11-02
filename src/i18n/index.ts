import { en, type Strings } from "./en";
import { ru } from "./ru";

export type Lang = "en" | "ru";

let current: Lang = "en";

/** Live dictionary: the views read it on every render. */
export const t: Strings = { ...en };

export function lang() {
  return current;
}

export function setLang(next: Lang) {
  current = next;
  Object.assign(t, next === "ru" ? ru : en);
}
