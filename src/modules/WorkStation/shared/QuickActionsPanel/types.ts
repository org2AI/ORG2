/**
 * Quick action types
 *
 * Shared quick-action item type used by the work station placeholders.
 */
import type { IconSvgElement } from "@src/icons";

/**
 * A single quick action item
 */
export interface QuickAction {
  /** Unique identifier for the action */
  id: string;
  /** Display label for the action */
  label: string;
  /** Keyboard shortcut (e.g., "⇧⌘L", "Cmd+J") */
  shortcut?: string;
  /** Optional icon to display */
  icon?: IconSvgElement;
  /** Handler when action is triggered */
  onAction?: () => void;
  /** Whether the action is disabled */
  disabled?: boolean;
}
