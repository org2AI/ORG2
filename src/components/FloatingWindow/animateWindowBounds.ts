import { PANE_LAYOUT_ANIMATION_OPTIONS } from "@src/components/layout/tokens/viewContainerTokens";

/** Animate an already-positioned window without scaling text or retaining a clone.
 * Inline geometry remains the destination, so cancellation always settles there.
 */
export function animateWindowBounds(
  windowElement: HTMLElement,
  from: DOMRect,
  onLayout: () => void
): () => void {
  const to = windowElement.getBoundingClientRect();
  if (
    document.hidden ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    !windowElement.animate ||
    !windowElement.isConnected ||
    from.width <= 0 ||
    from.height <= 0 ||
    to.width <= 0 ||
    to.height <= 0
  )
    return () => {};

  const left = Number.parseFloat(windowElement.style.left) || 0;
  const top = Number.parseFloat(windowElement.style.top) || 0;
  const animation = windowElement.animate(
    [
      {
        left: `${left + from.left - to.left}px`,
        top: `${top + from.top - to.top}px`,
        width: `${from.width}px`,
        height: `${from.height}px`,
      },
      {
        left: `${left}px`,
        top: `${top}px`,
        width: `${to.width}px`,
        height: `${to.height}px`,
      },
    ],
    PANE_LAYOUT_ANIMATION_OPTIONS
  );
  // Native webviews need actual intermediate layout, not a transform illusion.
  const observer = new ResizeObserver(onLayout);
  observer.observe(windowElement);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    observer.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    windowElement.removeEventListener("pointerdown", finish, true);
    animation.cancel();
    onLayout();
  };
  const onVisibility = () => {
    if (document.hidden) finish();
  };
  document.addEventListener("visibilitychange", onVisibility);
  // A drag/resize takes over immediately, without fighting the transition.
  windowElement.addEventListener("pointerdown", finish, true);
  void animation.finished.then(finish, finish);
  return finish;
}
