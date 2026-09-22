/**
 * Shared desktop window-chrome dimensions.
 *
 * Keep native-titlebar spacing centralized so full-window surfaces do not
 * independently guess where macOS traffic lights end.
 */
export const WINDOW_CHROME_TOKENS = {
  titleBarHeight: 36,
  /**
   * Vertical center of the 36px title-bar row every host places its chrome
   * in (8px top breathing room + half the row). Mirrors the native
   * `TRAFFIC_LIGHT_CENTER_Y` in `src-tauri/crates/app-window`, so pinned
   * groups line up with the traffic lights.
   */
  titleBarCenterTop: 26,
  /**
   * Leading inset a bare top bar keeps clear of the overlay traffic lights
   * (x=20 + three buttons) in a detached session / station window.
   */
  macTrafficLightsLeadingInset: 84,
} as const;
