/**
 * Window identity for multi-window gating.
 *
 * The app now opens secondary OS windows (detached session windows,
 * `app-window-session-<id>`), and every window runs the same bundle through
 * the same `RootLayout`/`AppBootstrap` hook stack. App-wide singletons —
 * deep-link navigation, the updater, git auto-fetch, cloud sync — must run
 * in exactly one window, and "which window am I" is the gate.
 *
 * `getCurrentWindow().label` is synchronous in Tauri v2, so the label is
 * resolved once at first call and cached for the document's lifetime (a
 * window's label can never change).
 *
 * Outside Tauri (browser dev, unit tests) there is only one document, so it
 * plays every role: `isMainAppWindow()` returns true there. That keeps
 * existing unit tests and browser dev behavior unchanged.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";

import { STATION_MODES, type StationMode } from "@src/types/ui/workstation";

export const MAIN_WINDOW_LABEL = "main";

/** Label prefix of detached station windows (`app-window-station-<mode>`).
 *  Must match `STATION_WINDOW_LABEL_PREFIX` in the Rust `app-window` crate. */
export const STATION_WINDOW_LABEL_PREFIX = "app-window-station-";

/**
 * Deliberately NOT imported from `./index`: that barrel runs
 * `patchTauriInternals()` at module scope, which arms a self-rescheduling
 * real-timer retry chain (10ms→1s). Pulling it into a module graph makes any
 * fake-timer test that loads this file inherit a stray timeout in its fake
 * clock (observed as a flaky `getTimerCount()` off-by-one). This module must
 * stay side-effect-free, so it detects Tauri directly off the injected
 * internals instead. (`isTauriDesktop()` in the barrel is also hardcoded to
 * `true`, so it never actually guarded anything.)
 */
function hasTauriInternals(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  );
}

let cachedLabel: string | null | undefined;

/** The current Tauri window's label, or null outside Tauri. Cached. */
export function getCurrentWindowLabel(): string | null {
  if (cachedLabel !== undefined) return cachedLabel;
  if (!hasTauriInternals()) {
    cachedLabel = null;
    return cachedLabel;
  }
  try {
    cachedLabel = getCurrentWindow().label;
  } catch {
    cachedLabel = null;
  }
  return cachedLabel;
}

/**
 * Whether this document should own app-wide singleton behavior.
 * True in the Tauri main window and in non-Tauri environments
 * (browser dev / unit tests), where the single document is "the app".
 */
export function isMainAppWindow(): boolean {
  const label = getCurrentWindowLabel();
  return label === null || label === MAIN_WINDOW_LABEL;
}

/**
 * The initial station mode encoded in a detached station window's label;
 * null for every other label (main, session windows, non-Tauri).
 */
export function getStationWindowModeFromLabel(
  label: string | null
): StationMode | null {
  if (!label || !label.startsWith(STATION_WINDOW_LABEL_PREFIX)) return null;
  const mode = label.slice(STATION_WINDOW_LABEL_PREFIX.length);
  return (STATION_MODES as readonly string[]).includes(mode)
    ? (mode as StationMode)
    : null;
}

/**
 * The initial mode of a detached station document, else null. This identifies
 * the native window, not its current selection; read stationModeAtom for that.
 */
export function getCurrentStationWindowMode(): StationMode | null {
  return getStationWindowModeFromLabel(getCurrentWindowLabel());
}

/** Whether this document is a detached station window. */
export function isStationWindow(): boolean {
  return getCurrentStationWindowMode() !== null;
}

/** Test hook: clear the cached label so a test can vary the environment. */
export function resetWindowIdentityForTests(): void {
  cachedLabel = undefined;
}
