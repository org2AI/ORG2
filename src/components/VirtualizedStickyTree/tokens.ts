/**
 * Sticky Row Tokens
 *
 * Shared class tokens for VS Code-style sticky header rows.
 * Ensures visual parity with TreeRowBase (same chevron size, padding, text style).
 *
 */
import { CHEVRON_SIZE } from "@src/components/TreeRow/config";

export { getTreeRowPadding as stickyRowPadding } from "@src/components/TreeRow/config";

export const STICKY_ROW = {
  /** Row layout without any bg — use when the parent container supplies the bg. */
  rowBase: `flex h-full cursor-pointer items-center gap-1.5 overflow-hidden transition-colors`,
  chevronBox: "flex h-3.5 w-3.5 shrink-0 items-center justify-center",
  chevronIcon: "text-text-3",
  /** Layout + default text-text-2 color */
  name: "min-w-0 flex-1 truncate text-[13px] text-text-2",
} as const;

export { CHEVRON_SIZE };
