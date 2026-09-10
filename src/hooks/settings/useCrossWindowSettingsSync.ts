/** Apply theme CSS and terminal zoom effects for cross-window storage changes. */
import { useEffect } from "react";

import {
  getGlobalTheme,
  resolveGlobalThemePreference,
} from "@src/config/appearance/globalThemes";
import { createLogger } from "@src/hooks/logger";
import { swapThemeCss } from "@src/util/ui/theme/swapThemeCss";

const log = createLogger("CrossWindowSync");

// Special handlers for settings that need extra processing beyond atom updates
const SPECIAL_HANDLERS: Record<string, (newValue: string) => void> = {
  // Theme needs to update the CSS link element
  theme: (newValue: string) => {
    updateThemeCSS(newValue);
  },
  // UI scale needs to trigger a custom event for zoom
  orgii_ui_scale: (_newValue: string) => {
    window.dispatchEvent(new CustomEvent("uiScaleChange"));
  },
};

export function useCrossWindowSettingsSync(): void {
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      // Only handle our settings keys
      if (
        !event.key ||
        !Object.prototype.hasOwnProperty.call(SPECIAL_HANDLERS, event.key)
      )
        return;

      // Run special handlers if needed
      const handler = SPECIAL_HANDLERS[event.key];
      if (handler && event.newValue) {
        try {
          handler(event.newValue);
        } catch (error) {
          log.warn(`Handler failed for ${event.key}:`, error);
        }
      }
    };

    // Listen for storage events from other windows
    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);
}

/**
 * Update the theme CSS link element.
 * This ensures the visual theme actually changes, not just the atom.
 */
function updateThemeCSS(themeValue: string): void {
  const themeId = resolveGlobalThemePreference(themeValue);
  const themePath = getGlobalTheme(themeId).baseCssPath;
  void swapThemeCss(themePath);
}
