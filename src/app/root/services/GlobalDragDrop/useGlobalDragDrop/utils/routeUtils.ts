/**
 * Drop-target utilities for GlobalDragDrop
 *
 * Drag-drop behavior is derived from the DOM target + payload shape, not the
 * current route. A page "supports" dropping files into chat iff a
 * [data-chat-drop-target] element is mounted and visible.
 */
const CHAT_DROP_TARGET_SELECTOR =
  "[data-chat-drop-target]:not([data-chat-file-drop-disabled])";

/** Kept-alive floating panes have geometry even when hidden and inert. */
export function isVisibleChatDropTarget(element: Element): boolean {
  if (element.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
  const style = window.getComputedStyle(element);
  if (style.visibility === "hidden" || style.visibility === "collapse")
    return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function hasVisibleChatDropTarget(): boolean {
  const dropTargets = document.querySelectorAll(CHAT_DROP_TARGET_SELECTOR);
  return Array.from(dropTargets).some(isVisibleChatDropTarget);
}
