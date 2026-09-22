import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";

import {
  APP_LOCK_ERROR,
  type AppLockStatus,
  appLockErrorCode,
} from "@src/api/tauri/appLock";
import {
  appLockStateAtom,
  resolveAppLockGateMode,
} from "@src/store/appLock/appLockAtom";
import { webviewOverlayBlockedAtom } from "@src/store/ui/overlayAtom";

import { formatRetryCountdown } from "../appLockFormat";
import {
  ACTIVITY_REPORT_INTERVAL_MS,
  isActivityReportDue,
  shouldReportActivity,
} from "../useAppLockSync";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const status = (overrides: Partial<AppLockStatus> = {}): AppLockStatus => ({
  enabled: true,
  locked: false,
  lockOnLaunch: false,
  autoLockMinutes: 5,
  hint: null,
  retryAfterMs: 0,
  ...overrides,
});

describe("resolveAppLockGateMode", () => {
  it("covers the app until the first status arrives", () => {
    // A locked app must not paint its content for one IPC round trip.
    expect(resolveAppLockGateMode("unknown")).toBe("cover");
  });

  it("shows the password page only when a password exists and it is locked", () => {
    expect(resolveAppLockGateMode(status({ locked: true }))).toBe("locked");
    expect(resolveAppLockGateMode(status({ locked: false }))).toBe("open");
    expect(
      resolveAppLockGateMode(status({ enabled: false, locked: true }))
    ).toBe("open");
  });
});

describe("native webviews under the lock", () => {
  it("are blocked while the lock covers the app", () => {
    // Inline browser webviews paint above the DOM; the lock page cannot cover
    // them, so they have to be hidden instead.
    const store = createStore();
    expect(store.get(webviewOverlayBlockedAtom)).toBe(true);

    store.set(appLockStateAtom, status({ locked: true }));
    expect(store.get(webviewOverlayBlockedAtom)).toBe(true);

    store.set(appLockStateAtom, status({ locked: false }));
    expect(store.get(webviewOverlayBlockedAtom)).toBe(false);
  });
});

describe("idle activity reporting", () => {
  it("runs only when an idle auto-lock could actually fire", () => {
    expect(shouldReportActivity("unknown")).toBe(false);
    expect(shouldReportActivity(status())).toBe(true);
    expect(shouldReportActivity(status({ enabled: false }))).toBe(false);
    expect(shouldReportActivity(status({ locked: true }))).toBe(false);
    expect(shouldReportActivity(status({ autoLockMinutes: 0 }))).toBe(false);
  });

  it("is throttled on the leading edge", () => {
    expect(isActivityReportDue(null, 1_000)).toBe(true);
    expect(
      isActivityReportDue(1_000, 1_000 + ACTIVITY_REPORT_INTERVAL_MS - 1)
    ).toBe(false);
    expect(
      isActivityReportDue(1_000, 1_000 + ACTIVITY_REPORT_INTERVAL_MS)
    ).toBe(true);
  });

  it("reports far more often than the shortest auto-lock delay", () => {
    expect(ACTIVITY_REPORT_INTERVAL_MS * 3).toBeLessThanOrEqual(60_000);
  });
});

describe("appLockErrorCode", () => {
  it("recognises the stable codes and nothing else", () => {
    expect(appLockErrorCode(APP_LOCK_ERROR.THROTTLED)).toBe(
      APP_LOCK_ERROR.THROTTLED
    );
    expect(appLockErrorCode("app_lock:write_failed: disk full")).toBeNull();
    expect(appLockErrorCode(new Error("boom"))).toBeNull();
    expect(appLockErrorCode(undefined)).toBeNull();
  });
});

describe("formatRetryCountdown", () => {
  it("renders m:ss and never goes negative", () => {
    expect(formatRetryCountdown(30)).toBe("0:30");
    expect(formatRetryCountdown(65)).toBe("1:05");
    expect(formatRetryCountdown(900)).toBe("15:00");
    expect(formatRetryCountdown(0.2)).toBe("0:01");
    expect(formatRetryCountdown(-4)).toBe("0:00");
  });
});
