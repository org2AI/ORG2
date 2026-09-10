/**
 * useColumnResize Hook
 *
 * Pure DOM horizontal column resize — zero React renders during drag,
 * commits to state on mouseup only. Mirrors `useBottomPanelResize` but on
 * the x-axis for inline file-list / sidebar columns that are NOT wrapped in
 * `ResizeProvider` (so the heavier `useResizeController` is not an option).
 *
 * Pairs with `VerticalResizeHandle` for the visual drag strip.
 *
 * Usage:
 * ```tsx
 * const { columnRef, handleMouseDown } = useColumnResize({
 *   width,
 *   setWidth,
 *   min: 180,
 *   max: 520,
 * });
 *
 * <div ref={columnRef} style={{ width }}>...</div>
 * <VerticalResizeHandle onMouseDown={handleMouseDown} />
 * ```
 */
import React, { useCallback, useEffect, useRef, useState } from "react";

import { listenForDrag } from "@src/shared/interaction/dragLifecycle";

interface UseColumnResizeOptions {
  width: number;
  setWidth: (width: number) => void;
  min: number;
  max: number;
  /**
   * If true, dragging right shrinks the column (e.g. right-anchored panel).
   * Default is false — handle sits on the right edge, drag right to grow.
   */
  inverted?: boolean;
}

interface UseColumnResizeReturn {
  columnRef: React.MutableRefObject<HTMLDivElement | null>;
  handleMouseDown: (event: React.MouseEvent) => void;
  isResizing: boolean;
}

export function useColumnResize({
  width,
  setWidth,
  min,
  max,
  inverted = false,
}: UseColumnResizeOptions): UseColumnResizeReturn {
  const columnRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const pendingWidthRef = useRef<number>(width);
  const isResizingRef = useRef<boolean>(false);
  const hasDraggedRef = useRef<boolean>(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();

      if (event.detail >= 2) return;
      if (isResizingRef.current) return;
      isResizingRef.current = true;
      hasDraggedRef.current = false;
      setIsResizing(true);

      const startX = event.clientX;
      const startWidth = width;
      pendingWidthRef.current = startWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!hasDraggedRef.current) {
          hasDraggedRef.current = true;
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }

        const rawDelta = moveEvent.clientX - startX;
        const delta = inverted ? -rawDelta : rawDelta;
        const newWidth = Math.max(min, Math.min(max, startWidth + delta));
        pendingWidthRef.current = newWidth;

        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          if (columnRef.current) {
            columnRef.current.style.width = `${newWidth}px`;
          }
        });
      };

      const handleMouseUp = () => {
        dispose();
        dragCleanupRef.current = null;
        isResizingRef.current = false;
        setIsResizing(false);

        if (hasDraggedRef.current) {
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          // Clear inline style so the committed React width takes over.
          if (columnRef.current) columnRef.current.style.width = "";
          setWidth(pendingWidthRef.current);
        }
      };

      dragCleanupRef.current = () => {
        dispose();
        dragCleanupRef.current = null;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        if (hasDraggedRef.current) {
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        }
        isResizingRef.current = false;
        setIsResizing(false);
      };

      const dispose = listenForDrag({
        onMove: handleMouseMove,
        onEnd: handleMouseUp,
        onCancel: handleMouseUp,
      });
    },
    [width, setWidth, min, max, inverted]
  );

  return { columnRef, handleMouseDown, isResizing };
}

export default useColumnResize;
