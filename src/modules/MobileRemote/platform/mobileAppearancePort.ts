import type { SystemColorScheme } from "@src/config/appearance/globalThemes";
import { createLogger } from "@src/hooks/logger";

import type { MobileRemoteAppearancePort } from "./types";

const MOBILE_THEME_LINK_ATTRIBUTE = "data-orgii-mobile-theme";
const logger = createLogger("mobile-appearance");

export type MobileCanvasColor = [number, number, number];

/** The theme stylesheet is the palette owner; metadata/native chrome are mirrors. */
function synchronizeCanvasMetadata(
  targetDocument: Document
): MobileCanvasColor | null {
  const value = targetDocument.defaultView
    ?.getComputedStyle(targetDocument.documentElement)
    .getPropertyValue("--color-chat-container")
    .trim();
  // The two supported mobile stylesheets expose this opaque canvas as hex.
  // Do not invent a second palette while the stylesheet is still loading.
  if (!value || !/^#[\da-f]{6}$/i.test(value)) return null;
  let meta = targetDocument.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]'
  );
  if (!meta) {
    meta = targetDocument.createElement("meta");
    meta.name = "theme-color";
    targetDocument.head.append(meta);
  }
  meta.content = value;
  return [1, 3, 5].map((offset) =>
    parseInt(value.slice(offset, offset + 2), 16)
  ) as MobileCanvasColor;
}

function colorSchemeForQuery(query: MediaQueryList): SystemColorScheme {
  return query.matches ? "dark" : "light";
}

export function applyMobileColorScheme(
  colorScheme: SystemColorScheme,
  targetDocument: Document
): void {
  const links = targetDocument.querySelectorAll<HTMLLinkElement>(
    `link[${MOBILE_THEME_LINK_ATTRIBUTE}]`
  );
  links.forEach((link) => {
    link.media =
      link.getAttribute(MOBILE_THEME_LINK_ATTRIBUTE) === colorScheme
        ? "all"
        : "not all";
  });

  const root = targetDocument.documentElement;
  root.dataset.theme = colorScheme;
  root.dataset.themeId = colorScheme;
  root.style.colorScheme = colorScheme;
  root.classList.toggle("theme-dark", colorScheme === "dark");
}

export function createMobileAppearancePort(
  targetWindow: Window,
  targetDocument: Document,
  applyNativeCanvas?: (color: MobileCanvasColor) => Promise<void>
): MobileRemoteAppearancePort {
  const mediaQuery = targetWindow.matchMedia("(prefers-color-scheme: dark)");
  // At most one native write and one latest pending color. Rapid theme changes
  // cannot finish out of order or accumulate an unbounded promise queue.
  let pending: MobileCanvasColor | null = null;
  let inFlight: Promise<void> | null = null;
  const synchronizeCanvas = (): Promise<void> => {
    const color = synchronizeCanvasMetadata(targetDocument);
    if (!color || !applyNativeCanvas) return Promise.resolve();
    pending = color;
    if (!inFlight) {
      inFlight = (async () => {
        try {
          let failure: unknown;
          while (pending) {
            const next = pending;
            pending = null;
            try {
              await Promise.resolve().then(() => applyNativeCanvas(next));
              failure = undefined;
            } catch (error) {
              failure = error;
            }
          }
          if (failure) throw failure;
        } finally {
          inFlight = null;
        }
      })();
    }
    return inFlight;
  };

  return {
    getSystemColorScheme: () => colorSchemeForQuery(mediaQuery),
    subscribeSystemColorScheme(listener) {
      const handleChange = () => listener(colorSchemeForQuery(mediaQuery));
      mediaQuery.addEventListener("change", handleChange);
      // Inactive theme stylesheets may finish after first render. Resolve the
      // current root token on load, never the scheme associated with that event.
      const links = targetDocument.querySelectorAll<HTMLLinkElement>(
        `link[${MOBILE_THEME_LINK_ATTRIBUTE}]`
      );
      const handleLoad = () => {
        void synchronizeCanvas().catch((error) =>
          logger.warn("Mobile canvas appearance could not be applied", error)
        );
      };
      links.forEach((link) => link.addEventListener("load", handleLoad));
      return () => {
        mediaQuery.removeEventListener("change", handleChange);
        links.forEach((link) => link.removeEventListener("load", handleLoad));
        pending = null;
      };
    },
    applyColorScheme: (colorScheme) => {
      applyMobileColorScheme(colorScheme, targetDocument);
      return synchronizeCanvas();
    },
  };
}
