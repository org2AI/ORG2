/**
 * Browser host context — Phase 2.2 of the WorkStation unified-tab migration.
 *
 * Publishes the Browser host's rendering surface ABOVE the tab dispatcher so
 * that the `browser-session` renderer in `UnifiedTabContent` can consume it
 * directly, instead of receiving it as props threaded through the bespoke
 * `BrowserLayout` render tree.
 *
 * Mirrors `ProjectHostProvider` (Phase 2.1). The payload is the shared webview
 * workspace surface (`browserState` + activation flags + inspect /
 * native-devtools handlers) so `browser-session` can mount the rect-publisher
 * (`SharedBrowserWorkspace`) and position the already-hoisted global webview
 * over its pane.
 *
 * DevTools is not a tab: it stays in the Browser host's secondary panel,
 * which `BrowserLayout` renders directly.
 *
 * The webview engine (`SharedBrowserApp`) and session store
 * (`BrowserProvider`) are already mounted globally above the workstation
 * (`src/modules/index.tsx`); this context only hoists the browser-host-owned
 * state, which lives inside `BrowserLayout` today.
 */
import { type ReactNode, createContext, useContext } from "react";

import type { BrowserState } from "@src/engines/BrowserCore/types";

export interface BrowserHostContextValue {
  /** Global browser session store (from `useBrowserContextAdapter`). */
  browserState: BrowserState;
  /**
   * Host-level activation for the shared webview: browser mode is active, the
   * viewport should show, and no automation run is overlaying it. A renderer
   * ANDs this with its own `isActive`/session-match before publishing a rect.
   */
  isWorkspaceActive: boolean;
  /** Whether webviews should be hidden (mode inactive / viewport not shown). */
  hideWebviews: boolean;
  /** Bottom inset (px) reserved below the webview frame. */
  webviewBottomInsetPx: number;
  isInspectMode: boolean;
  onToggleInspectMode: () => void;
  onOpenNativeDevTools: () => void;
  /** Toggle the DevTools pane from the webview toolbar. */
  onToggleDevToolsPane: () => void;
  devToolsPaneCollapsed: boolean;
}

const BrowserHostContext = createContext<BrowserHostContextValue | null>(null);

export function BrowserHostProvider({
  value,
  children,
}: {
  value: BrowserHostContextValue;
  children: ReactNode;
}) {
  return (
    <BrowserHostContext.Provider value={value}>
      {children}
    </BrowserHostContext.Provider>
  );
}

/**
 * Read the Browser host context. Throws if used outside a
 * `BrowserHostProvider` — this guards against mounting a browser renderer
 * through the unified dispatcher before the host context has been hoisted
 * above it (which would otherwise silently render a degraded surface, e.g. a
 * webview with no rect publisher).
 */
export function useBrowserHostContext(): BrowserHostContextValue {
  const ctx = useContext(BrowserHostContext);
  if (ctx === null) {
    throw new Error(
      "useBrowserHostContext must be used within a BrowserHostProvider"
    );
  }
  return ctx;
}
