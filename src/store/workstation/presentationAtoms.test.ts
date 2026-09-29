import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { isStationWindow } from "@src/util/platform/tauri/windowIdentity";

import {
  collapseWorkstationAtom,
  dockWorkstationAtom,
  expandWorkstationAtom,
  floatWorkstationAtom,
  resolveWorkstationPresentation,
  workstationPresentationAtom,
} from "./presentationAtoms";

vi.mock("@src/util/platform/tauri/windowIdentity", () => ({
  isStationWindow: vi.fn(() => false),
}));

beforeEach(() => vi.mocked(isStationWindow).mockReturnValue(false));

describe("Workstation presentation", () => {
  it("supports floating, collapse, expand and dock without persisting UI state", () => {
    const store = createStore();
    store.set(chatPanelMaximizedAtom, false);
    const storageBefore = { ...localStorage };
    expect(store.get(workstationPresentationAtom)).toBe("docked");
    store.set(floatWorkstationAtom);
    expect(store.get(workstationPresentationAtom)).toBe("floating");
    store.set(collapseWorkstationAtom);
    expect(store.get(workstationPresentationAtom)).toBe("collapsed");
    store.set(expandWorkstationAtom);
    expect(store.get(workstationPresentationAtom)).toBe("floating");
    store.set(dockWorkstationAtom);
    expect(store.get(workstationPresentationAtom)).toBe("docked");
    expect({ ...localStorage }).toEqual(storageBefore);
  });

  it("docking explicitly restores a split previously maximized by the user", () => {
    const store = createStore();
    store.set(chatPanelMaximizedAtom, true);
    store.set(floatWorkstationAtom);
    expect(store.get(chatPanelMaximizedAtom)).toBe(true);
    store.set(dockWorkstationAtom);
    expect(store.get(chatPanelMaximizedAtom)).toBe(false);
  });

  it("does not share presentation between window stores", () => {
    const main = createStore();
    main.set(floatWorkstationAtom);
    expect(createStore().get(workstationPresentationAtom)).toBe("docked");
  });

  it("keeps detached station windows docked", () => {
    vi.mocked(isStationWindow).mockReturnValue(true);
    const store = createStore();
    for (const action of [
      floatWorkstationAtom,
      collapseWorkstationAtom,
      expandWorkstationAtom,
    ]) {
      store.set(action);
      expect(store.get(workstationPresentationAtom)).toBe("docked");
    }
  });

  it.each([
    ["docked", false, false, false, true, false],
    ["docked", true, false, true, false, false],
    ["docked", false, true, false, true, false],
    ["docked", true, true, true, false, false],
    ["floating", false, false, true, true, true],
    ["floating", true, false, true, true, true],
    ["floating", false, true, true, false, true],
    ["floating", true, true, true, false, true],
    ["collapsed", false, false, true, false, true],
    ["collapsed", true, false, true, false, true],
    ["collapsed", false, true, true, false, true],
    ["collapsed", true, true, true, false, true],
  ] as const)(
    "projects %s with chat maximize %s and settings %s",
    (
      presentation,
      chatMaximized,
      settingsVisible,
      chatExpanded,
      workstationVisible,
      floating
    ) => {
      expect(
        resolveWorkstationPresentation({
          presentation,
          chatMaximized,
          settingsVisible,
        })
      ).toEqual({ chatExpanded, workstationVisible, floating });
    }
  );
});
