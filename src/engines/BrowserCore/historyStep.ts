/**
 * Tells a Back/Forward step through a browser session's history from every
 * other kind of navigation.
 *
 * The toolbar's Back/Forward buttons move `historyIndex` by one and leave the
 * `history` array itself alone; a typed URL, a link the agent followed, or a
 * restored session all replace the array. Identity is therefore the signal —
 * comparing entries would also match a URL typed again at the next index,
 * which must stay a fresh load.
 */
import type { WebviewHistoryDirection } from "@src/hooks/platform/useInlineWebview/types";

export interface BrowserHistoryCursor {
  history: readonly string[];
  index: number;
}

export function resolveHistoryStep(
  previous: BrowserHistoryCursor,
  next: BrowserHistoryCursor,
  url: string
): WebviewHistoryDirection | null {
  if (previous.history !== next.history) return null;
  if (next.history[next.index] !== url) return null;

  if (next.index === previous.index - 1) return "back";
  if (next.index === previous.index + 1) return "forward";
  return null;
}
