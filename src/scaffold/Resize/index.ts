/**
 * Resize Feature - Main Export
 *
 * Pure-DOM resize primitives for panel layouts: the drag strips render once,
 * the drag itself never re-renders React, and state commits on mouseup.
 */

export { useColumnResize } from "./hooks";

export { HorizontalResizeHandle, VerticalResizeHandle } from "./components";

export { default as ResizableSplitPanel } from "./components/ResizableSplitPanel";
