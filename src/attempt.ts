import { Notice } from "obsidian";
import { t } from "./i18n";

/** Runs a task started from an event handler, so a failure reaches both the person and the console. */
export function attempt(task: Promise<unknown>, context: string) {
  task.catch((error: unknown) => {
    console.error(`Tropa: failed to ${context}`, error);
    new Notice(t.actionFailed({ reason: error instanceof Error ? error.message : String(error) }));
  });
}
