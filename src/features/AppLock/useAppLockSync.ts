/**
 * useAppLockSync
 *
 * Mounted once per window (via `AppLockGate`). Keeps `appLockStateAtom` equal
 * to the Rust-owned lock status — initial fetch plus the broadcast on every
 * change — and reports user input so the idle auto-lock, which Rust times
 * across all windows, knows the app is in use.
 */
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import {
  APP_LOCK_CHANGED_EVENT,
  type AppLockStatus,
  appLockApi,
} from "@src/api/tauri/appLock";
import { createLogger } from "@src/hooks/logger";
import { useTauriListen } from "@src/hooks/platform/useTauriListen";
import {
  type AppLockState,
  appLockStateAtom,
} from "@src/store/appLock/appLockAtom";

const logger = createLogger("AppLock");

/**
 * Activity is reported at most this often. Well under the shortest auto-lock
 * delay (one minute), so a throttled-away event can never cost the user more
 * than a few seconds of idle budget.
 */
export const ACTIVITY_REPORT_INTERVAL_MS = 10_000;

const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
] as const;

/**
 * Status to assume when the backend cannot answer at all. That only happens
 * when the commands do not exist (a frontend newer than the running backend),
 * in which case there is no lock to honor — and staying covered would leave
 * the window permanently blank.
 */
const UNAVAILABLE_STATUS: AppLockStatus = {
  enabled: false,
  locked: false,
  lockOnLaunch: false,
  autoLockMinutes: 0,
  hint: null,
  retryAfterMs: 0,
};

/** Whether this window should be reporting input to the idle timer. */
export function shouldReportActivity(state: AppLockState): boolean {
  return (
    state !== "unknown" &&
    state.enabled &&
    !state.locked &&
    state.autoLockMinutes > 0
  );
}

/**
 * Leading-edge throttle: `true` when a report is due at `now`, given the time
 * of the last one sent.
 */
export function isActivityReportDue(
  lastReportedAt: number | null,
  now: number
): boolean {
  return (
    lastReportedAt === null ||
    now - lastReportedAt >= ACTIVITY_REPORT_INTERVAL_MS
  );
}

export function useAppLockSync(state: AppLockState): void {
  const setState = useSetAtom(appLockStateAtom);

  // A broadcast is always newer than the initial fetch it can race with. If
  // one lands first, the fetch result must not overwrite it — that could
  // paint an app Rust has just locked as unlocked.
  const broadcastSeenRef = useRef(false);
  const handleBroadcast = useCallback(
    (status: AppLockStatus) => {
      broadcastSeenRef.current = true;
      setState(status);
    },
    [setState]
  );
  useTauriListen<AppLockStatus>(APP_LOCK_CHANGED_EVENT, handleBroadcast);

  useEffect(() => {
    let cancelled = false;
    appLockApi
      .status()
      .then((status) => {
        if (!cancelled && !broadcastSeenRef.current) setState(status);
      })
      .catch((error) => {
        logger.warn("status unavailable; leaving the app unlocked:", error);
        if (!cancelled && !broadcastSeenRef.current) {
          setState(UNAVAILABLE_STATUS);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [setState]);

  const reporting = shouldReportActivity(state);
  useEffect(() => {
    if (!reporting) return;
    let lastReportedAt: number | null = null;
    const report = () => {
      const now = Date.now();
      if (!isActivityReportDue(lastReportedAt, now)) return;
      lastReportedAt = now;
      appLockApi.reportActivity().catch((error) => {
        logger.warn("activity report failed:", error);
      });
    };
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, report, { capture: true, passive: true });
    }
    return () => {
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, report, { capture: true });
      }
    };
  }, [reporting]);
}
