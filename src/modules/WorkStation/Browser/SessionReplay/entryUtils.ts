/** Classifies browser events for replay categories. */
import type { BrowserEntry } from "./types";

export type EntryCategory =
  | "browser"
  | "web_search"
  | "web_fetch"
  | "internal_browser";

export function categorizeBrowserEntry(entry: BrowserEntry): EntryCategory {
  const fn = entry.event.functionName;
  if (fn === "web_search" || fn === "WebSearch") return "web_search";
  if (fn === "web_fetch" || fn === "WebFetch") return "web_fetch";
  return "browser";
}
