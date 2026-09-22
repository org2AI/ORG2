// @vitest-environment jsdom
import { createStore } from "jotai/vanilla";
import { expect, it, vi } from "vitest";

import { installWorkStationPipelineBridge } from "@src/modules/useWorkStationPipelineBridge";
import { createInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import {
  activeSessionIdAtom,
  jumpToSessionAtom,
  workstationActiveSessionIdAtom,
} from "../viewAtom";

vi.mock("@src/util/platform/tauri/windowIdentity", async (original) => ({
  ...(await original<
    typeof import("@src/util/platform/tauri/windowIdentity")
  >()),
  isStationWindow: () => true,
  getCurrentStationWindowMode: () => "my-station",
}));

it.each(["before", "after"])(
  "keeps session following local with storage delivered %s the follow event",
  (order) => {
    localStorage.clear();
    createInstrumentedStore();
    const station = createStore();
    const release = installWorkStationPipelineBridge(true, station);
    const key = "orgii-v2-session-view";
    const payload = JSON.stringify({
      activeSessionId: "osagent-B",
      sessionName: "Main metadata",
    });
    const deliverStorage = () =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          newValue: payload,
          storageArea: localStorage,
        })
      );
    localStorage.setItem(key, payload);
    if (order === "before") deliverStorage();
    station.set(jumpToSessionAtom, "osagent-B");
    if (order === "after") deliverStorage();
    expect(station.get(workstationActiveSessionIdAtom)).toBe("osagent-B");
    expect(station.get(activeSessionIdAtom)).toBe("osagent-B");
    expect(localStorage.getItem(key)).toBe(payload);
    station.set(jumpToSessionAtom, null);
    expect(station.get(activeSessionIdAtom)).toBeNull();
    expect(localStorage.getItem(key)).toBe(payload);
    release();
  }
);
