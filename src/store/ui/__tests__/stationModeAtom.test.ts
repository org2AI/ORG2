import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import { getCurrentStationWindowMode } from "@src/util/platform/tauri/windowIdentity";

vi.mock("@src/util/platform/tauri/windowIdentity", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@src/util/platform/tauri/windowIdentity")
  >()),
  getCurrentStationWindowMode: vi.fn(() => null),
}));

describe("stationModeAtom", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(getCurrentStationWindowMode).mockReturnValue(null);
  });

  it("is the persisted preference in the main window", () => {
    const store = createStore();
    expect(store.get(stationModeAtom)).toBe("my-station");

    store.set(stationModeAtom, "agent-station");
    expect(store.get(stationModeAtom)).toBe("agent-station");
    expect(localStorage.getItem("stationMode")).toBe(
      JSON.stringify("agent-station")
    );

    store.set(stationModeAtom, (previous) =>
      previous === "agent-station" ? "my-station" : "agent-station"
    );
    expect(store.get(stationModeAtom)).toBe("my-station");
  });

  it("seeds from the label and switches locally without writing main's preference", () => {
    localStorage.setItem("stationMode", JSON.stringify("agent-station"));
    vi.mocked(getCurrentStationWindowMode).mockReturnValue("agent-station");
    const store = createStore();

    expect(store.get(stationModeAtom)).toBe("agent-station");

    store.set(stationModeAtom, "my-station");
    expect(store.get(stationModeAtom)).toBe("my-station");
    store.set(stationModeAtom, (previous) =>
      previous === "my-station" ? "agent-station" : "my-station"
    );
    expect(store.get(stationModeAtom)).toBe("agent-station");
    // The write must not leak into the main window's persisted preference.
    expect(localStorage.getItem("stationMode")).toBe(
      JSON.stringify("agent-station")
    );
  });
});
