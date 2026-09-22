import type { OptimizedChatItem } from "../chatItemPipeline/types";

export interface GroupItemRendererProps {
  flatIndex: number;
  groupIndex: number;
  turnId: string | null;
  /** The item at `flatIndex`. Passed directly to avoid the full array reference. */
  chatItem: OptimizedChatItem | undefined;
  /**
   * The nearest preceding non-structural, non-unloaded item before
   * `flatIndex`. Pre-resolved by the call site so this renderer does not
   * need to scan the full flat list on every render.
   */
  previousChatItem: OptimizedChatItem | undefined;
  /** Whether this row is the final body item in its group. */
  isLastItemInGroup: boolean;
  /** Whether this row belongs to the latest group. */
  isLastGroup: boolean;
  isWpGeneWorking: boolean;
  onRegenerate?: (groupIndex: number) => void;
  onEditUserMessage?: (
    item: OptimizedChatItem,
    newText: string,
    imageDataUrls?: string[]
  ) => Promise<void> | void;
  /**
   * When set, the renderer paints a `NewEventDivider` immediately
   * above each group's *last* item. Subagent panes use this so the
   * latest assistant event in every turn is visually called out —
   * matches the "---- New event ----" divider in
   * `Communication > messages`. `null` / undefined leaves the
   * divider off (default).
   */
  newEventDividerLabel?: string | null;
}
