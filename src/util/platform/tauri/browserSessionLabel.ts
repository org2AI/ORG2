import { MAIN_WINDOW_LABEL, getCurrentWindowLabel } from "./windowIdentity";

/**
 * Native webview labels are app-global, while each window owns its BrowserCore.
 * Keep main's existing labels for agent/tool compatibility and scope every
 * secondary view to its parent. Browser session IDs are UUIDs; the reserved
 * separator is decoded by browser::internal_browser_state on the Rust side.
 */
export function getBrowserSessionWebviewLabel(
  sessionId: string,
  windowLabel = getCurrentWindowLabel()
): string {
  const base = `browser-session-${sessionId}`;
  return windowLabel && windowLabel !== MAIN_WINDOW_LABEL
    ? `${base}__window__${windowLabel}`
    : base;
}
