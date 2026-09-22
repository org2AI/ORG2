import type { SpotlightItem } from "../types";

export const MAX_SPOTLIGHT_PINS = 200;

export function togglePinnedId(ids: readonly string[], id: string): string[] {
  return ids.includes(id)
    ? ids.filter((value) => value !== id)
    : ids.length < MAX_SPOTLIGHT_PINS
      ? [...ids, id]
      : [...ids];
}

/** Move matching live rows, preserving their actions and section-relative order. */
export function buildPinnedItems(
  items: SpotlightItem[],
  pinnedIds: readonly string[],
  onToggle: (id: string) => void,
  pinnedLabel: string,
  canPin: (item: SpotlightItem) => boolean
): SpotlightItem[] {
  const pins = new Set(pinnedIds);
  const pinned = new Map<string, SpotlightItem>();
  const remaining: SpotlightItem[] = [];
  for (const item of items) {
    if (item.data?.isHeader || !canPin(item)) {
      remaining.push(item);
      continue;
    }
    const id = item.data?.pinId ?? item.id;
    const row = {
      ...item,
      data: {
        ...item.data,
        pinState: {
          pinned: pins.has(id),
          disabled: !pins.has(id) && pinnedIds.length >= MAX_SPOTLIGHT_PINS,
          onToggle: () => onToggle(id),
        },
      },
    };
    if (pins.has(id)) {
      if (!pinned.has(id)) pinned.set(id, row);
    } else {
      remaining.push(row);
    }
  }
  // A moved row may have been its section's only entry.
  const populated = remaining.filter(
    (item, index) =>
      !item.data?.isHeader ||
      (index + 1 < remaining.length && !remaining[index + 1].data?.isHeader)
  );
  if (!pinned.size) return populated;
  return [
    {
      id: "section-user-pinned",
      label: pinnedLabel,
      type: "option",
      data: { isHeader: true },
    },
    ...pinnedIds.flatMap((id) => pinned.get(id) ?? []),
    ...populated,
  ];
}
