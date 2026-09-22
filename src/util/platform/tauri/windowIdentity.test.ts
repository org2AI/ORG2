import { afterEach, describe, expect, it } from "vitest";

import {
  getCurrentStationWindowMode,
  getCurrentWindowLabel,
  getStationWindowModeFromLabel,
  isMainAppWindow,
  isStationWindow,
  resetWindowIdentityForTests,
} from "./windowIdentity";

describe("windowIdentity", () => {
  afterEach(() => {
    resetWindowIdentityForTests();
  });

  it("treats a non-Tauri environment as the main app window", () => {
    // vitest has no __TAURI_INTERNALS__, so isTauriDesktop() is false.
    expect(getCurrentWindowLabel()).toBeNull();
    expect(isMainAppWindow()).toBe(true);
  });

  it("caches the resolved label", () => {
    expect(getCurrentWindowLabel()).toBeNull();
    expect(getCurrentWindowLabel()).toBeNull();
  });

  it("is never a station window outside Tauri", () => {
    expect(getCurrentStationWindowMode()).toBeNull();
    expect(isStationWindow()).toBe(false);
  });

  it("derives the pinned station mode from a station window label", () => {
    expect(getStationWindowModeFromLabel("app-window-station-my-station")).toBe(
      "my-station"
    );
    expect(
      getStationWindowModeFromLabel("app-window-station-agent-station")
    ).toBe("agent-station");
  });

  it("rejects labels that are not a known station mode", () => {
    expect(getStationWindowModeFromLabel(null)).toBeNull();
    expect(getStationWindowModeFromLabel("main")).toBeNull();
    expect(getStationWindowModeFromLabel("app-window-session-osagent-1")).toBe(
      null
    );
    expect(getStationWindowModeFromLabel("app-window-station-kanban")).toBe(
      null
    );
    expect(getStationWindowModeFromLabel("app-window-station-")).toBeNull();
  });
});
