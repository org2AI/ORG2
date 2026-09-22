import { outputImages } from "@src/engines/ChatPanel/rendering/outputImages";

import type { OptimizedChatItem } from "../chatItemPipeline/types";

/** Collect output before turn collapse, preserving provider order and ownership. */
export function turnOutputImages(items: OptimizedChatItem[]): string[] {
  const images = new Set<string>();
  for (const item of items) {
    const events = item.event
      ? [item.event]
      : (item.activityStackGroup?.events ??
        item.readFileEvents ??
        item.actionSummaryItems?.map((entry) => entry.event) ??
        item.actionSummaryEntries?.flatMap((entry) => entry.events) ??
        []);
    for (const event of events) {
      if (event.source === "user") continue;
      for (const image of outputImages(event.result ?? {})) images.add(image);
    }
  }
  return [...images];
}
