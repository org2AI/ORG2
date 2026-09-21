/**
 * useMacosPageBackdropSurface
 *
 * Callback ref for the element that paints a window's opaque page surface.
 * It registers the element with the native macOS page backdrop
 * (`@src/util/platform/macosPageBackdrop`), which shows that surface's
 * colour in the strip a window resize exposes before WebKit repaints, instead
 * of the translucent vibrancy under the webview. Put it on the element that
 * both spans the page region and paints the page colour. A no-op outside a
 * macOS window.
 */
import { type RefCallback, useCallback } from "react";

import { registerMacosPageBackdropSurface } from "@src/util/platform/macosPageBackdrop";

export function useMacosPageBackdropSurface<
  T extends HTMLElement,
>(): RefCallback<T> {
  return useCallback((surface: T | null) => {
    if (!surface) return;
    return registerMacosPageBackdropSurface(surface);
  }, []);
}
