import type { Update } from "@tauri-apps/plugin-updater";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as actions from "./actions";
import {
  checkForUpdatesManually,
  installAvailableAppUpdate,
  postponeAppUpdate,
  resetAppUpdaterForTests,
  skipAppUpdateVersion,
  startAutomaticAppUpdates,
} from "./service";
import { appUpdateInstallPromptAtom, availableAppUpdateAtom } from "./state";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  provenance: vi.fn(),
  separateInstall: vi.fn(),
  relaunch: vi.fn(),
  store: null as ReturnType<typeof createStore> | null,
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.0.0" }));
vi.mock("./channelCheck", () => ({ checkAppUpdateOnChannel: mocks.check }));
vi.mock("./buildProvenance", () => ({
  getAppBuildProvenance: mocks.provenance,
  resetAppBuildProvenanceForTests: vi.fn(),
}));
vi.mock("@src/util/core/state/instrumentedStore", () => ({
  getInstrumentedStore: () => mocks.store,
}));
vi.mock("@src/components/Message", () => ({
  default: { info: vi.fn(), success: vi.fn(), error: vi.fn(), remove: vi.fn() },
}));
vi.mock("./DownloadProgress", () => ({
  AppUpdateDownloadNoticeContent: () => null,
  getDownloadProgressTitle: () => "Downloading",
}));
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("./separateInstall", () => ({
  installAppUpdateSeparately: mocks.separateInstall,
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));

const provenance = { kind: "release", installStrategy: "inPlace" };

describe("AppUpdater service boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T00:00:00Z"));
    const values = new Map<string, string>();
    mocks.store = createStore();
    vi.clearAllMocks();
    mocks.provenance.mockResolvedValue(provenance);
    mocks.check.mockResolvedValue(null);
    mocks.separateInstall.mockResolvedValue({
      version: "1.0.1",
      targetPath: "/Applications/ORG2.app",
    });
    mocks.relaunch.mockResolvedValue(undefined);
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
          removeItem: (key: string) => values.delete(key),
        },
      })
    );
    vi.stubGlobal(
      "document",
      Object.assign(new EventTarget(), { visibilityState: "visible" })
    );
    vi.stubGlobal("navigator", { onLine: true });
    resetAppUpdaterForTests();
  });

  afterEach(() => {
    resetAppUpdaterForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe.each(["inPlace", "separateMacosApplication"])(
    "%s reminder",
    (installStrategy) => {
      beforeEach(() =>
        mocks.provenance.mockResolvedValue({ kind: "release", installStrategy })
      );

      it.each(["startup", "interval", "foreground", "online", "retry"])(
        "respects Later through the real %s scheduler trigger",
        async (reason) => {
          const update = updateFixture();
          mocks.check.mockResolvedValue(update);
          await installAvailableAppUpdate();
          postponeAppUpdate(update.version);
          expect(JSON.parse(window.localStorage.getItem(reminderKey)!)).toEqual(
            {
              version: update.version,
              remindAfter: Date.now() + day,
            }
          );
          // Simulate restart: only durable storage survives.
          resetAppUpdaterForTests();
          mocks.check.mockClear();
          if (reason === "retry")
            mocks.check.mockRejectedValueOnce(new Error("offline"));
          const stop = startAutomaticAppUpdates();
          await vi.advanceTimersByTimeAsync(10_000);
          if (reason === "interval")
            await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
          if (reason === "foreground" || reason === "online") {
            await vi.advanceTimersByTimeAsync(5 * 60_000);
            window.dispatchEvent(
              new Event(reason === "foreground" ? "focus" : "online")
            );
            await vi.advanceTimersByTimeAsync(750);
          }
          if (reason === "retry") await vi.advanceTimersByTimeAsync(72_000);
          expect(mocks.check).toHaveBeenCalledTimes(
            reason === "startup" ? 1 : 2
          );
          expect(mocks.store!.get(appUpdateInstallPromptAtom)).toBe(false);
          stop();
          expect(vi.getTimerCount()).toBe(0);
        }
      );

      it("expires after 24 hours and permits explicit prompts during cooldown", async () => {
        const update = updateFixture();
        mocks.check.mockResolvedValue(update);
        await installAvailableAppUpdate();
        postponeAppUpdate(update.version);
        await installAvailableAppUpdate();
        expect(mocks.store!.get(appUpdateInstallPromptAtom)).toBe(true);
        postponeAppUpdate(update.version);
        vi.setSystemTime(Date.now() + day);
        const stop = startAutomaticAppUpdates();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(mocks.store!.get(appUpdateInstallPromptAtom)).toBe(true);
        expect(window.localStorage.getItem(reminderKey)).toBeNull();
        stop();
      });

      it("does not suppress a newer version", async () => {
        postponeAppUpdate("1.0.1");
        mocks.check.mockResolvedValue(updateFixture("1.0.2"));
        const stop = startAutomaticAppUpdates();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(mocks.store!.get(appUpdateInstallPromptAtom)).toBe(true);
        stop();
      });

      it.each([
        "{bad",
        "null",
        "{}",
        '{"version":"1.0.1","remindAfter":"tomorrow"}',
      ])("discards invalid persisted state %s", async (stored) => {
        window.localStorage.setItem(reminderKey, stored);
        mocks.check.mockResolvedValue(updateFixture());
        const stop = startAutomaticAppUpdates();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(mocks.store!.get(appUpdateInstallPromptAtom)).toBe(true);
        expect(window.localStorage.getItem(reminderKey)).toBeNull();
        stop();
      });

      it("clears the reminder on explicit confirmed installation", async () => {
        const update = updateFixture();
        mocks.check.mockResolvedValue(update);
        await installAvailableAppUpdate();
        postponeAppUpdate(update.version);
        await installAvailableAppUpdate({ confirmed: true });
        expect(window.localStorage.getItem(reminderKey)).toBeNull();
        if (installStrategy === "inPlace") {
          expect(update.install).toHaveBeenCalledOnce();
          expect(mocks.relaunch).toHaveBeenCalledOnce();
        } else {
          expect(mocks.separateInstall).toHaveBeenCalledOnce();
          expect(update.install).not.toHaveBeenCalled();
        }
      });

      it("clears the reminder when skipping the version", () => {
        postponeAppUpdate("1.0.1");
        skipAppUpdateVersion("1.0.1");
        expect(window.localStorage.getItem(reminderKey)).toBeNull();
      });
    }
  );

  it("shares one in-flight coordinator and state between lazy actions and the mounted service", async () => {
    let resolveCheck!: (update: Update) => void;
    mocks.check.mockImplementation(
      () =>
        new Promise<Update>((resolve) => {
          resolveCheck = resolve;
        })
    );
    const lazy = actions.checkForUpdatesManually();
    const update = {
      version: "1.0.1",
      available: true,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Update;
    await vi.waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(1));
    const direct = checkForUpdatesManually();
    resolveCheck(update);
    await expect(direct).resolves.toBe(update);
    await expect(lazy).resolves.toBe(update);
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(mocks.store!.get(availableAppUpdateAtom)).toBe(update);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start background work when imported or used for a manual action", async () => {
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocks.check).not.toHaveBeenCalled();
    await actions.checkForUpdatesManually();
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels setup if unmounted before provenance resolves", async () => {
    let resolveProvenance!: (value: typeof provenance) => void;
    mocks.provenance.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProvenance = resolve;
        })
    );
    const stop = startAutomaticAppUpdates();
    stop();
    resolveProvenance(provenance);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocks.check).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves startup timing and clears all scheduler work across repeated mounts", async () => {
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const stop = startAutomaticAppUpdates();
      await vi.advanceTimersByTimeAsync(9_999);
      expect(mocks.check).toHaveBeenCalledTimes(cycle);
      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.check).toHaveBeenCalledTimes(cycle + 1);
      stop();
      expect(vi.getTimerCount()).toBe(0);
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
      expect(mocks.check).toHaveBeenCalledTimes(cycle + 1);
    }
  });
});

const reminderKey = "orgii:updater:deferred-update-reminder";
const day = 24 * 60 * 60_000;
function updateFixture(version = "1.0.1"): Update {
  return {
    version,
    available: true,
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Update;
}
