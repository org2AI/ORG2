import { useEffect, useState } from "react";

/** Evict offscreen editors and snapshots, but keep their measured scroll space. */
export function useReviewViewport(
  element: HTMLElement | null,
  expanded: boolean
) {
  const [onScreen, setOnScreen] = useState(false);
  const [retainedHeight, setRetainedHeight] = useState(0);
  useEffect(() => {
    if (!element) return;
    let active = true;
    let visible = false;
    let measuredHeight = 0;
    const measure = () => {
      if (active && visible && expanded) {
        const measured = element.getBoundingClientRect().height;
        if (measured > 0) measuredHeight = measured;
      }
    };
    const intersection = new IntersectionObserver((entries) => {
      if (!active) return;
      // Capture before the offscreen render releases the heavy subtree.
      measure();
      visible = entries.some((entry) => entry.isIntersecting);
      if (!visible && measuredHeight > 0) setRetainedHeight(measuredHeight);
      setOnScreen(visible);
    });
    intersection.observe(element);
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    return () => {
      active = false;
      intersection.disconnect();
      resize.disconnect();
    };
  }, [element, expanded]);
  return { onScreen, retainedHeight: expanded ? retainedHeight : 0 };
}
