/**
 * useWindowFullscreenSync
 *
 * Mirrors the native window's full-screen state into `windowFullscreenAtom`.
 *
 * macOS native full screen hides the traffic lights, so every surface that
 * reserves room for them (sidebar top row, pinned sidebar chrome, collapsed
 * sidebar header insets) collapses that reserve while the atom is `true`.
 *
 * Tauri emits no dedicated full-screen event, but entering or leaving native
 * full screen always resizes the window, so `onResized` is the trigger and
 * `isFullscreen()` is the source of truth re-read on each resize.
 *
 * Only a real macOS window reserves traffic-light space, so the subscription
 * is limited to that host (browser mode has no window to ask).
 */
import { useSetAtom } from "jotai";
import { useEffect } from "react";

import { hasMacWindowChrome } from "@src/config/windowChromeRadius";
import { createLogger } from "@src/hooks/logger";
import { windowFullscreenAtom } from "@src/store/ui/uiAtom";
import { safeUnlisten } from "@src/util/platform/tauri/safeUnlisten";

const log = createLogger("WindowFullscreenSync");

export function useWindowFullscreenSync(): void {
  const setFullscreen = useSetAtom(windowFullscreenAtom);

  useEffect(() => {
    if (!hasMacWindowChrome()) return;

    let disposed = false;
    let unlisten: (() => void) | null = null;

    const subscribe = async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();

      const sync = async () => {
        const next = await appWindow.isFullscreen();
        if (!disposed) setFullscreen(next);
      };

      await sync();
      if (disposed) return;

      const fn = await appWindow.onResized(() => {
        if (disposed) return;
        void sync().catch((error: unknown) => {
          log.warn("Failed to read window fullscreen state", error);
        });
      });
      if (disposed) {
        safeUnlisten(fn);
        return;
      }
      unlisten = fn;
    };

    subscribe().catch((error: unknown) => {
      log.warn("Failed to subscribe to window fullscreen state", error);
    });

    return () => {
      disposed = true;
      safeUnlisten(unlisten);
      unlisten = null;
    };
  }, [setFullscreen]);
}
