/**
 * Pinned passages as conversation-navigator marks.
 *
 * A pin records the transcript anchor it was taken from; the navigator works
 * in group indices. This resolves one to the other against the groups
 * currently projected, and orders the marks the way the rail reads them —
 * top to bottom, in transcript order — rather than newest-first as the pin
 * store keeps them.
 */
import {
  type PinnedChatSelection,
  derivePinnedSelectionLabel,
} from "./pinnedSelections";

export interface PinnedMinimapMark {
  id: string;
  /** One-line excerpt for the mark's tooltip and label. */
  label: string;
  text: string;
  /**
   * Group the passage sits in, or null when its turn is outside the
   * projection currently rendered (an older page, or history not loaded).
   * Such a mark still shows and can be removed; it just cannot navigate.
   */
  groupIndex: number | null;
}

export function resolvePinnedMinimapMarks(
  pins: readonly PinnedChatSelection[],
  groupRenderKeys: readonly string[]
): PinnedMinimapMark[] {
  const indexByKey = new Map<string, number>();
  groupRenderKeys.forEach((key, index) => {
    if (!indexByKey.has(key)) indexByKey.set(key, index);
  });

  const marks = pins.map((pin) => ({
    id: pin.id,
    label: derivePinnedSelectionLabel(pin.text),
    text: pin.text,
    groupIndex:
      pin.anchorId === undefined
        ? null
        : (indexByKey.get(pin.anchorId) ?? null),
  }));

  return marks.sort((left, right) => {
    if (left.groupIndex === right.groupIndex) return 0;
    // Unplaceable marks collect at the end rather than jumping the rail.
    if (left.groupIndex === null) return 1;
    if (right.groupIndex === null) return -1;
    return left.groupIndex - right.groupIndex;
  });
}
