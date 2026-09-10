export const BROWSER_URL_BAR_FOCUS_EVENT = "browser-url-bar-focus";

export function focusBrowserUrlBar(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event(BROWSER_URL_BAR_FOCUS_EVENT));
    });
  });
}
