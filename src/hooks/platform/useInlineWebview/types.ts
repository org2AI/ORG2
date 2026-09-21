import type { Webview } from "@tauri-apps/api/webview";
import type { RefObject } from "react";

export type WebviewHistoryDirection = "back" | "forward";

export interface UseInlineWebviewOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  url: string;
  isActive?: boolean;
  isVisible?: boolean;
  userAgent?: string;
  labelPrefix?: string;
  useExactLabel?: boolean;
  incognito?: boolean;
  createDelay?: number;
  debug?: boolean;
  pollInterval?: number;
  onCreated?: (webview: Webview) => void;
  onDestroyed?: () => void;
  onNavigate?: (url: string) => void;
  /**
   * Asked once for each in-place navigation. Answer "back"/"forward" when
   * `targetUrl` is a step through the caller's own history: the native view
   * then returns to that page through its back-forward list (no refetch, scroll
   * position kept) when the list holds it, and loads the URL as usual when it
   * does not. Answer null for every other navigation.
   */
  resolveHistoryDirection?: (
    targetUrl: string
  ) => WebviewHistoryDirection | null;
  onNewWindow?: (url: string) => void;
  onError?: (error: Error) => void;
}

export interface UseInlineWebviewReturn {
  isWebviewAvailable: boolean;
  isWebviewCreated: boolean;
  isLoading: boolean;
  currentUrl: string;
  error: Error | null;
  navigate: (url: string) => Promise<void>;
  reload: () => Promise<void>;
  evaluate: (script: string) => Promise<void>;
  destroy: () => Promise<void>;
  updatePosition: (options?: { force?: boolean }) => Promise<void>;
  pollNow: () => Promise<void>;
  webview: Webview | null;
}
