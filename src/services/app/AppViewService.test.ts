// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppLockStatus } from "@src/api/tauri/appLock";
import { ROUTES } from "@src/config/routes";
import { appLockStateAtom } from "@src/store/appLock/appLockAtom";
import { settingsReturnPathAtom } from "@src/store/ui/settingsNavigationAtom";
import {
  createInstrumentedStore,
  getInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";

import { AppViewService } from "./AppViewService";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

describe("AppViewService.closeSettings", () => {
  const navigationEvents: Array<{ path: string; replace?: boolean }> = [];
  const handleNavigate = (event: Event) => {
    navigationEvents.push(
      (event as CustomEvent<{ path: string; replace?: boolean }>).detail
    );
  };

  beforeEach(() => {
    resetInstrumentedStore();
    createInstrumentedStore();
    navigationEvents.length = 0;
    window.addEventListener("action-system-navigate", handleNavigate);
  });

  afterEach(() => {
    window.removeEventListener("action-system-navigate", handleNavigate);
    resetInstrumentedStore();
  });

  it("restores the WorkStation URL the user entered Settings from", () => {
    const returnPath = `${ROUTES.workStation.code.path}?file=README.md`;
    getInstrumentedStore().set(settingsReturnPathAtom, returnPath);

    expect(
      AppViewService.closeSettings(`${ROUTES.app.settings.path}/appearance`)
    ).toBe(true);
    expect(navigationEvents).toEqual([{ path: returnPath }]);
  });

  it("falls back to the WorkStation root when nothing was remembered", () => {
    expect(AppViewService.closeSettings(ROUTES.app.settings.path)).toBe(true);
    expect(navigationEvents).toEqual([{ path: ROUTES.workStation.base.path }]);
  });

  it("does nothing off the Settings surface", () => {
    expect(AppViewService.closeSettings(ROUTES.workStation.base.path)).toBe(
      false
    );
    expect(navigationEvents).toEqual([]);
  });
});

describe("AppViewService.lockApp", () => {
  const navigationEvents: Array<{ path: string }> = [];
  const handleNavigate = (event: Event) => {
    navigationEvents.push((event as CustomEvent<{ path: string }>).detail);
  };
  const status = (overrides: Partial<AppLockStatus>): AppLockStatus => ({
    enabled: true,
    locked: false,
    lockOnLaunch: false,
    autoLockMinutes: 0,
    hint: null,
    retryAfterMs: 0,
    ...overrides,
  });

  beforeEach(() => {
    resetInstrumentedStore();
    createInstrumentedStore();
    navigationEvents.length = 0;
    tauri.invoke.mockReset();
    window.addEventListener("action-system-navigate", handleNavigate);
  });

  afterEach(() => {
    window.removeEventListener("action-system-navigate", handleNavigate);
    resetInstrumentedStore();
  });

  it("locks through the backend and mirrors the status it returns", async () => {
    getInstrumentedStore().set(appLockStateAtom, status({}));
    tauri.invoke.mockResolvedValue(status({ locked: true }));

    expect(await AppViewService.lockApp()).toBe(true);
    expect(tauri.invoke).toHaveBeenCalledWith("app_lock_lock");
    expect(getInstrumentedStore().get(appLockStateAtom)).toMatchObject({
      locked: true,
    });
    expect(navigationEvents).toEqual([]);
  });

  it("opens the App Lock settings when there is no password to lock with", async () => {
    getInstrumentedStore().set(appLockStateAtom, status({ enabled: false }));

    expect(await AppViewService.lockApp()).toBe(false);
    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(navigationEvents).toEqual([
      { path: `${ROUTES.app.settings.path}/app/general/app-lock` },
    ]);
  });
});
