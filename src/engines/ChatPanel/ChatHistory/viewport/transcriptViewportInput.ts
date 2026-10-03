export const KEYBOARD_SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  " ",
  "Spacebar",
]);

export const KEYBOARD_LINE_DELTA_PX = 40;
export const KEYBOARD_PAGE_DELTA_RATIO = 0.9;

// Descendant controls own activation and navigation keys before transcript scrolling.
export function isInteractiveKeyboardTarget(
  target: EventTarget | null
): boolean {
  return (
    target instanceof Element &&
    target.closest(
      "input, textarea, select, button, a[href], summary, [contenteditable='true'], [role='textbox'], [role='button'], [role='slider'], [role='tab'], [role='menuitem']"
    ) !== null
  );
}

/** A descendant owns wheel intent while it can scroll in that direction. */
export function descendantOwnsWheel(
  event: WheelEvent,
  root: HTMLElement
): boolean {
  let element = event.target instanceof Element ? event.target : null;
  while (element && element !== root) {
    if (element.scrollHeight > element.clientHeight) {
      const style = getComputedStyle(element);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        const canScroll =
          event.deltaY < 0
            ? element.scrollTop > 0
            : element.scrollTop + element.clientHeight < element.scrollHeight;
        if (
          canScroll ||
          style.overscrollBehaviorY === "contain" ||
          style.overscrollBehaviorY === "none"
        ) {
          return true;
        }
      }
    }
    element = element.parentElement;
  }
  return false;
}

export function isScrollbarPointerDown(
  event: PointerEvent,
  element: HTMLElement
): boolean {
  if (event.button !== 0) return false;
  const rect = element.getBoundingClientRect();
  const nativeScrollbarWidth = Math.max(
    0,
    element.offsetWidth - element.clientWidth
  );
  return event.clientX >= rect.right - Math.max(12, nativeScrollbarWidth);
}
