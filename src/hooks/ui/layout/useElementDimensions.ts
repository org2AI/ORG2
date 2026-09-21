import { RefObject, useEffect, useLayoutEffect, useState } from "react";

/**
 * useElementDimensions Hook
 *
 * Measures one dimension (width or height) of an element.
 *
 * Features:
 * - ResizeObserver for accurate dimension tracking
 * - SSR-safe with useIsomorphicLayoutEffect
 * - Window resize fallback
 */

// Use useLayoutEffect on client, useEffect on server (SSR safety)
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export type DimensionType = "width" | "height";

export interface UseElementDimensionsOptions {
  /** What to measure: 'width' (clientWidth) or 'height' (clientHeight) */
  dimension: DimensionType;
  /** Disable measurement and listener ownership while the element is absent. */
  enabled?: boolean;
  /** Additional dependency to trigger re-measurement */
  deps?: unknown[];
}

/**
 * Hook for measuring an element dimension with ResizeObserver
 *
 * @example
 * const width = useElementDimensions(ref, { dimension: 'width' });
 *
 * @example
 * // With additional dependencies
 * const height = useElementDimensions(ref, { dimension: 'height', deps: [isOpen] });
 */
export function useElementDimensions(
  ref: RefObject<HTMLElement | null>,
  options: UseElementDimensionsOptions
): number {
  const { dimension, enabled = true, deps = [] } = options;

  const [size, setSize] = useState(0);

  useIsomorphicLayoutEffect(() => {
    if (!enabled) return;

    const measureDimension = () => {
      const element = ref.current;
      if (!element) return;
      setSize(
        dimension === "width" ? element.clientWidth : element.clientHeight
      );
    };

    // Measure immediately
    measureDimension();

    const element = ref.current;

    // Set up ResizeObserver for accurate tracking
    let resizeObserver: ResizeObserver | null = null;
    if (element && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(measureDimension);
      resizeObserver.observe(element);
    }

    // Listen for window resize as fallback
    window.addEventListener("resize", measureDimension);

    return () => {
      window.removeEventListener("resize", measureDimension);
      resizeObserver?.disconnect();
    };
  }, [ref, enabled, dimension, ...deps]);

  return size;
}

export default useElementDimensions;
