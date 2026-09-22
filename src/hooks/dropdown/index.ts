/**
 * Dropdown Hooks
 *
 * Shared hooks for dropdown behavior across the application.
 *
 * - useDropdownEngine: Unified base hook (single source of truth for
 *   positioning, ESC, click-outside, and keyboard navigation).
 * - useDropdownAutoKeyboard: DOM auto-discover keyboard fallback. Wired
 *   automatically by `useDropdownEngine` when `listNavigation` is not
 *   provided.
 * - getDropdownPanelStyle: turns the engine's `panelPosition` into the
 *   panel's inline style (flip side, alignment, width, max height).
 */

export { getDropdownPanelStyle } from "./dropdownPanelStyle";

export {
  useDropdownEngine,
  type DropdownEnginePosition,
} from "./useDropdownEngine";

export { type UseDropdownListNavigationReturn } from "./useDropdownListNavigation";

export { useDropdownAutoKeyboard } from "./useDropdownAutoKeyboard";
