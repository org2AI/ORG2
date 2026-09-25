export const WEBVIEW_LAYOUT_CHANGED_EVENT = "orgii-webview-layout-changed";

export function dispatchWebviewLayoutChanged(): void {
  requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent(WEBVIEW_LAYOUT_CHANGED_EVENT));
  });
}

/** Geometry already committed by a floating host; no transition retries needed. */
export const WEBVIEW_FLOATING_LAYOUT_CHANGED_EVENT =
  "orgii-webview-floating-layout-changed";

export function dispatchWebviewFloatingLayoutChanged(): void {
  window.dispatchEvent(new CustomEvent(WEBVIEW_FLOATING_LAYOUT_CHANGED_EVENT));
}
