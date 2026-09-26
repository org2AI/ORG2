import type { OptimizedChatItem } from "../chatItemPipeline/types";
import type { ChatGroupMeta } from "./useChatGroups";

interface ChatSearchProjectionTarget {
  globalFlatIndex: number;
  groupIndex: number;
  turnId: string | null;
  itemChunkId: string;
}

export function collectChatItemEventIds(item: OptimizedChatItem): string[] {
  const ids = new Set<string>();
  if (item.chunk_id) ids.add(item.chunk_id);
  if (item.event?.id) ids.add(item.event.id);
  if (item.event?.chunk_id) ids.add(item.event.chunk_id);

  for (const event of item.readFileEvents ?? []) {
    if (event.id) ids.add(event.id);
    if (event.chunk_id) ids.add(event.chunk_id);
  }
  for (const entry of item.actionSummaryEntries ?? []) {
    for (const event of entry.events) {
      if (event.id) ids.add(event.id);
      if (event.chunk_id) ids.add(event.chunk_id);
    }
  }
  for (const entry of item.actionSummaryItems ?? []) {
    if (entry.event.id) ids.add(entry.event.id);
    if (entry.event.chunk_id) ids.add(entry.event.chunk_id);
  }
  for (const event of item.activityStackGroup?.events ?? []) {
    if (event.id) ids.add(event.id);
    if (event.chunk_id) ids.add(event.chunk_id);
  }

  return [...ids];
}

function buildFlatIndexToGroupIndex(groupCounts: readonly number[]): number[] {
  const map: number[] = [];
  for (let groupIndex = 0; groupIndex < groupCounts.length; groupIndex++) {
    const count = groupCounts[groupIndex] ?? 0;
    for (let i = 0; i < count; i++) {
      map.push(groupIndex);
    }
  }
  return map;
}

export function buildEventIdProjectionIndex(
  flatItems: readonly OptimizedChatItem[],
  groupCounts: readonly number[],
  groupMeta: readonly Pick<ChatGroupMeta, "turnId">[],
  sourceItems: readonly OptimizedChatItem[] = flatItems,
  originalToFlatIndex?: ReadonlyMap<number, number>,
  groupHeaders: readonly (OptimizedChatItem | null)[] = []
): Map<string, ChatSearchProjectionTarget> {
  const flatToGroup = buildFlatIndexToGroupIndex(groupCounts);
  const headerGroups = new Map(
    groupHeaders.flatMap((item, index) =>
      item ? [[item, index] as const] : []
    )
  );
  const index = new Map<string, ChatSearchProjectionTarget>();

  sourceItems.forEach((item, sourceIndex) => {
    const globalFlatIndex = originalToFlatIndex
      ? originalToFlatIndex.get(sourceIndex)
      : sourceIndex;
    if (globalFlatIndex === undefined) return;
    // Collapsing removes rows, not their message identity. Empty headers must
    // retain their own group even when their flat offset touches another group.
    const groupIndex =
      headerGroups.get(item) ?? flatToGroup[globalFlatIndex] ?? 0;
    const target: ChatSearchProjectionTarget = {
      globalFlatIndex,
      groupIndex,
      turnId: groupMeta[groupIndex]?.turnId ?? null,
      itemChunkId: item.chunk_id,
    };
    for (const eventId of collectChatItemEventIds(item)) {
      index.set(eventId, target);
    }
  });

  return index;
}
