/**
 * App lock — frontend projection of the Rust-owned lock state.
 *
 * Rust (`system_services::app_lock`) is the single owner: it holds the
 * password digest, the locked flag, the throttle and the idle auto-lock, and
 * broadcasts every change. This atom only mirrors the last status it sent, so
 * a reload or a second window converges on the same answer instead of each
 * page keeping its own idea of "locked".
 */
import { atom } from "jotai";

import type { AppLockStatus } from "@src/api/tauri/appLock";

/**
 * `"unknown"` until the first status arrives. The gate covers the app while
 * unknown: a locked app must not paint its content for the length of one IPC
 * round trip on launch.
 */
export type AppLockState = AppLockStatus | "unknown";

export const appLockStateAtom = atom<AppLockState>("unknown");
appLockStateAtom.debugLabel = "appLockStateAtom";

/** A password is set. `false` while the status is still unknown. */
export const appLockEnabledAtom = atom((get) => {
  const state = get(appLockStateAtom);
  return state !== "unknown" && state.enabled;
});
appLockEnabledAtom.debugLabel = "appLockEnabledAtom";

/** How the gate should present, derived from the raw state. */
export type AppLockGateMode = "open" | "cover" | "locked";

export function resolveAppLockGateMode(state: AppLockState): AppLockGateMode {
  if (state === "unknown") return "cover";
  return state.enabled && state.locked ? "locked" : "open";
}

export const appLockGateModeAtom = atom((get) =>
  resolveAppLockGateMode(get(appLockStateAtom))
);
appLockGateModeAtom.debugLabel = "appLockGateModeAtom";
