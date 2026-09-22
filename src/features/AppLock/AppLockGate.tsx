/**
 * AppLockGate — mounted once per window from `AppBootstrap`.
 *
 * Projects the Rust-owned lock onto this window: while the status is unknown
 * it covers the app with a blank page (a locked app must not flash its content
 * at launch), while locked it shows the password page, and in both cases it
 * makes everything behind it inert and deaf to the keyboard.
 *
 * The app underneath stays mounted on purpose. Unmounting it would tear down
 * session streams and editor state; the point of the lock is that agents keep
 * working while nobody can watch or steer them.
 */
import { useAtomValue } from "jotai";
import React, { useEffect } from "react";
import { createPortal } from "react-dom";

import {
  appLockGateModeAtom,
  appLockStateAtom,
} from "@src/store/appLock/appLockAtom";

import { AppLockScreen } from "./AppLockScreen";
import {
  APP_LOCK_ROOT_ID,
  activateAppLockInputGuard,
} from "./appLockInputGuard";
import { useAppLockSync } from "./useAppLockSync";

export const AppLockGate: React.FC = () => {
  const state = useAtomValue(appLockStateAtom);
  const mode = useAtomValue(appLockGateModeAtom);

  useAppLockSync(state);

  const covering = mode !== "open";
  useEffect(() => {
    if (!covering) return;
    return activateAppLockInputGuard();
  }, [covering]);

  if (!covering) return null;

  return createPortal(
    // Above every app layer, including persistent portal tabs (z-200) and the
    // error page (z-300): nothing may paint over the lock.
    <div
      id={APP_LOCK_ROOT_ID}
      data-testid="app-lock-root"
      data-app-lock-mode={mode}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[2147483647] overflow-hidden bg-bg-2"
      style={{ borderRadius: "var(--border-radius-window)" }}
    >
      {mode === "locked" && <AppLockScreen />}
    </div>,
    document.body
  );
};
