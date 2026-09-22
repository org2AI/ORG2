/**
 * Tab-strip drag regions do not take focus, and macOS buttons need not take
 * focus on click either. Release header editing before tab actions/dragging.
 * Capture runs even when a descendant stops propagation for its own action.
 */
export function blurHeaderInputOnPointerDown(event: {
  button: number;
  currentTarget: HTMLElement;
}): void {
  if (event.button !== 0) return;
  const activeElement = event.currentTarget.ownerDocument.activeElement;
  if (
    (activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement) &&
    activeElement.closest("[data-workstation-tab-header]")
  ) {
    activeElement.blur();
  }
}
