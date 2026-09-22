import { createStore } from "jotai/vanilla";
import { vi } from "vitest";

import { appLockStateAtom } from "@src/store/appLock/appLockAtom";

import { webviewOverlayBlockedAtom } from "../overlayAtom";
import { activeOverlayCountAtom } from "../overlayLayerAtom";

vi.mock("@src/util/platform/tauri", () => ({
  isMacOS: () => false,
}));

describe("webviewOverlayBlockedAtom", () => {
  it("blocks native webviews for overlays when native layering is unavailable", () => {
    const store = createStore();
    // The app lock covers (and blocks webviews) until its status is known;
    // this test is about overlays, so start from a known-unlocked app.
    store.set(appLockStateAtom, {
      enabled: false,
      locked: false,
      lockOnLaunch: false,
      autoLockMinutes: 0,
      hint: null,
      retryAfterMs: 0,
    });
    expect(store.get(webviewOverlayBlockedAtom)).toBe(false);

    store.set(activeOverlayCountAtom, 1);
    expect(store.get(webviewOverlayBlockedAtom)).toBe(true);

    store.set(activeOverlayCountAtom, 0);
    expect(store.get(webviewOverlayBlockedAtom)).toBe(false);
  });
});
