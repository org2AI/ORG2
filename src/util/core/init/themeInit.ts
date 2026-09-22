import {
  GLOBAL_THEMES,
  getGlobalTheme,
  readStoredGlobalThemePreference,
  resolveGlobalThemePreference,
} from "@src/config/appearance/globalThemes";
import { preloadThemeCss, swapThemeCss } from "@src/util/ui/theme/swapThemeCss";

function scheduleThemePreload(activeThemePath: string): void {
  const preload = () => {
    const themePaths = Array.from(
      new Set(Object.values(GLOBAL_THEMES).map((theme) => theme.baseCssPath))
    ).filter((themePath) => themePath !== activeThemePath);

    preloadThemeCss(themePaths);
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(preload, { timeout: 1500 });
    return;
  }

  setTimeout(preload, 250);
}

/**
 * index.html supplies the light base stylesheet before the bundle executes.
 * Keep it until the preferred theme has loaded. The shared swap path bounds
 * both the network wait and the paint wait, including an occluded WKWebView
 * whose animation frames never fire during a follow-system cold start.
 */
async function initTheme(): Promise<void> {
  const themeId = resolveGlobalThemePreference(
    readStoredGlobalThemePreference()
  );
  const theme = getGlobalTheme(themeId).baseCssPath;
  await swapThemeCss(theme);
  scheduleThemePreload(theme);
}

export { initTheme };
