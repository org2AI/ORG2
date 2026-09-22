import { invoke } from "@tauri-apps/api/core";
import { type MutableRefObject, useEffect } from "react";

export interface UseInlineWebviewNativeVisibilityParams {
  isWebviewCreated: boolean;
  isVisible: boolean;
  isWebviewAvailable: boolean;
  labelRef: MutableRefObject<string>;
  updatePosition: (options?: { force?: boolean }) => Promise<void>;
  parkOffscreen: () => Promise<void>;
  log: (...args: unknown[]) => void;
}

export function useInlineWebviewNativeVisibility(
  params: UseInlineWebviewNativeVisibilityParams
): void {
  const {
    isWebviewCreated,
    isVisible,
    isWebviewAvailable,
    labelRef,
    updatePosition,
    parkOffscreen,
    log,
  } = params;

  useEffect(() => {
    if (!isWebviewCreated || !isWebviewAvailable) return;

    let cancelled = false;

    const handleVisibility = async () => {
      try {
        if (isVisible) {
          log("Showing WebView (isVisible=true)");
          await updatePosition({ force: true });
          if (cancelled) return;
          await invoke("set_inline_webview_visibility", {
            label: labelRef.current,
            visible: true,
          });
        } else {
          log("Staging WebView offscreen (isVisible=false, but still mounted)");
          await parkOffscreen();
        }
      } catch (err) {
        if (!cancelled) {
          log("Visibility change failed:", err);
        }
      }
    };

    void handleVisibility();

    return () => {
      cancelled = true;
    };
  }, [
    isWebviewCreated,
    isVisible,
    isWebviewAvailable,
    labelRef,
    updatePosition,
    parkOffscreen,
    log,
  ]);
}
