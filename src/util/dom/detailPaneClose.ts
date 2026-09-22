/**
 * Marker carried by the shared list/detail close action ("x" in the detail
 * header or tab strip). Placeholders never render it, so a rendered marker
 * means a detail is open in that pane.
 */
export const DETAIL_PANE_CLOSE_ATTRIBUTE = "data-detail-pane-close";

/** Sent to the marker when the close-tab chord dismisses its detail. */
export const DETAIL_PANE_SHORTCUT_CLOSE_EVENT = "detail-pane-shortcut-close";

const DETAIL_PANE_CLOSE_SELECTOR = `[${DETAIL_PANE_CLOSE_ATTRIBUTE}] button`;

/** Every pane that hosts Chat Panel tabs, docked or in its own window. */
export const CHAT_PANE_SURFACE_SELECTOR =
  "[data-fullmode-chat-wrapper], [data-chat-panel]";

export interface CloseOpenDetailPaneScope {
  /** Only consider close actions inside this element. */
  within?: Element | null;
  /** Skip close actions inside any ancestor matching this selector. */
  outside?: string;
}

// Retained tabs stay mounted under `display: none`, and the pane that lost
// the chat-focus toggle stays mounted under `aria-hidden`.
function isRendered(button: HTMLButtonElement): boolean {
  if (!button.isConnected || button.disabled) return false;
  if (button.closest('[aria-hidden="true"]')) return false;
  if (typeof button.checkVisibility === "function") {
    return button.checkVisibility();
  }
  return button.getClientRects().length > 0;
}

/**
 * Ask the detail that is open in a list/detail surface to close, leaving the
 * right pane on its placeholder. Returns `false` when the scope shows no open
 * detail.
 */
export function closeOpenDetailPane({
  within,
  outside,
}: CloseOpenDetailPaneScope = {}): boolean {
  if (within === null) return false;
  const root = within ?? document;
  const buttons = Array.from(
    root.querySelectorAll<HTMLButtonElement>(DETAIL_PANE_CLOSE_SELECTOR)
  ).filter(
    (button) => !(outside && button.closest(outside)) && isRendered(button)
  );
  // A nested list/detail (webhooks inside runs) renders after its parent.
  const innermost = buttons.at(-1);
  if (!innermost) return false;
  innermost
    .closest(`[${DETAIL_PANE_CLOSE_ATTRIBUTE}]`)
    ?.dispatchEvent(new CustomEvent(DETAIL_PANE_SHORTCUT_CLOSE_EVENT));
  return true;
}
