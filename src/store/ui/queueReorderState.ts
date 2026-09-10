/**
 * Module-level flag — set synchronously in onDragStart, cleared in onDragEnd.
 * Accessible by global drag detection to skip file drop overlay during reorder.
 */
export const reorderActiveRef = { current: false };
