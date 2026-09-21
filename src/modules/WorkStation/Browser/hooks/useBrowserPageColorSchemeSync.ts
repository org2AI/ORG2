/**
 * useBrowserPageColorSchemeSync
 *
 * Pushes the persisted page color scheme to the native browser webviews: once
 * when a browser viewport mounts (so a fresh process learns the preference
 * before its first page paints) and again whenever the user changes it. Rust
 * keeps the last value and applies it to webviews created afterwards.
 */
import { useAtomValue } from "jotai";
import { useEffect } from "react";

import { createLogger } from "@src/hooks/logger";
import { browserPageColorSchemeAtom } from "@src/store/workstation/browser/pageColorSchemeAtom";
import { isMacOS } from "@src/util/platform/tauri";
import { invokeTauri } from "@src/util/platform/tauri/init";

const log = createLogger("useBrowserPageColorSchemeSync");

/** The native override exists on macOS only; elsewhere pages follow the app. */
export function isBrowserPageColorSchemeSupported(): boolean {
  return isMacOS();
}

export function useBrowserPageColorSchemeSync(): void {
  const scheme = useAtomValue(browserPageColorSchemeAtom);

  useEffect(() => {
    if (!isBrowserPageColorSchemeSupported()) return;

    void invokeTauri<string[]>("browser_webviews_set_color_scheme", {
      scheme,
    }).catch((error) => {
      log.warn("[useBrowserPageColorSchemeSync] apply failed:", error);
    });
  }, [scheme]);
}
