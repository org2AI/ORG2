/**
 * useRatioResize Hook
 *
 * Handles ratio-based resize for split panes.
 * Unlike useResizeHandle (pixel-based), this hook works with ratios (0-1)
 * relative to a container element.
 *
 * Used by:
 * - WebDevTools (DOM tree / Design panel vertical split)
 */
import {
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// ============================================
// Types
// ============================================

export interface UseRatioResizeOptions {
  /** Initial ratio (0-1), default 0.5 */
  initialRatio?: number;
  /** Minimum ratio, default 0.2 */
  minRatio?: number;
  /** Maximum ratio, default 0.8 */
  maxRatio?: number;
  /** Resize direction */
  direction?: "horizontal" | "vertical";
  /** Callback when ratio changes */
  onRatioChange?: (ratio: number) => void;
}

export interface UseRatioResizeReturn {
  /** Current ratio (0-1) */
  ratio: number;
  /** Mouse down handler for the resize handle */
  handleMouseDown: (event: ReactMouseEvent) => void;
}

// ============================================
// Hook Implementation
// ============================================

/**
 * Hook for ratio-based split pane resize.
 *
 * @param containerRef - Ref to the container element
 * @param options - Configuration options
 * @returns Object with ratio and handleMouseDown
 *
 * @example
 * ```tsx
 * import { HorizontalResizeHandle } from "@src/scaffold/Resize";
 *
 * const containerRef = useRef<HTMLDivElement>(null);
 * const { ratio, handleMouseDown } = useRatioResize(containerRef, {
 *   initialRatio: 0.45,
 *   minRatio: 0.2,
 *   maxRatio: 0.8,
 *   direction: 'vertical'
 * });
 *
 * return (
 *   <div ref={containerRef}>
 *     <div style={{ height: `${ratio * 100}%` }}>Top</div>
 *     <HorizontalResizeHandle onMouseDown={handleMouseDown} />
 *     <div style={{ height: `${(1 - ratio) * 100}%` }}>Bottom</div>
 *   </div>
 * );
 * ```
 */
export function useRatioResize(
  containerRef: RefObject<HTMLDivElement | null>,
  options: UseRatioResizeOptions = {}
): UseRatioResizeReturn {
  const {
    initialRatio = 0.5,
    minRatio = 0.2,
    maxRatio = 0.8,
    direction = "vertical",
    onRatioChange,
  } = options;

  const [ratio, setRatio] = useState(initialRatio);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  const handleMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      if (event.button !== 0) return;
      cleanupRef.current?.();
      event.preventDefault();

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if ((moveEvent.buttons & 1) === 0) {
          cleanup();
          return;
        }
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const extent = direction === "vertical" ? rect.height : rect.width;
        if (extent <= 0) return;
        const offset =
          direction === "vertical"
            ? moveEvent.clientY - rect.top
            : moveEvent.clientX - rect.left;
        const clampedRatio = Math.min(
          maxRatio,
          Math.max(minRatio, offset / extent)
        );
        setRatio(clampedRatio);
        onRatioChange?.(clampedRatio);
      };
      const handleVisibilityChange = () => {
        if (document.visibilityState === "hidden") cleanup();
      };
      const cleanup = () => {
        document.removeEventListener("mousemove", handleMouseMove, true);
        window.removeEventListener("mouseup", cleanup, true);
        window.removeEventListener("pointercancel", cleanup, true);
        window.removeEventListener("blur", cleanup);
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange
        );
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        cleanupRef.current = null;
      };
      cleanupRef.current = cleanup;
      document.body.style.cursor =
        direction === "vertical" ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMouseMove, true);
      window.addEventListener("mouseup", cleanup, true);
      window.addEventListener("pointercancel", cleanup, true);
      window.addEventListener("blur", cleanup);
      document.addEventListener("visibilitychange", handleVisibilityChange);
    },
    [containerRef, minRatio, maxRatio, direction, onRatioChange]
  );

  return { ratio, handleMouseDown };
}

export default useRatioResize;
