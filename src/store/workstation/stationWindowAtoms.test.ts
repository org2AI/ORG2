import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  emitStationWindowSession,
  openStationWindow,
} from "@src/api/tauri/stationWindow";
import { workstationActiveSessionIdAtom } from "@src/store/session/viewAtom";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  createInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";
import { isMainAppWindow } from "@src/util/platform/tauri/windowIdentity";

import {
  collapseWorkstationAtom,
  dockWorkstationAtom,
  expandWorkstationAtom,
  floatWorkstationAtom,
  workstationPresentationAtom,
} from "./presentationAtoms";
import {
  openStationInNewWindowAtom,
  restoreStationAfterWindowClosedAtom,
  stationWindowChatTakeoverAtom,
} from "./stationWindowAtoms";

vi.mock("@src/api/tauri/stationWindow", () => ({
  openStationWindow: vi.fn(() =>
    Promise.resolve("app-window-station-my-station")
  ),
  emitStationWindowSession: vi.fn(() => Promise.resolve()),
}));

vi.mock("@src/util/platform/tauri/windowIdentity", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@src/util/platform/tauri/windowIdentity")
  >()),
  isMainAppWindow: vi.fn(() => true),
}));

describe("openStationInNewWindowAtom", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(openStationWindow).mockClear();
    vi.mocked(emitStationWindowSession).mockClear();
    vi.mocked(isMainAppWindow).mockReturnValue(true);
    // `createInstrumentedStore()` is a process-wide singleton.
    resetInstrumentedStore();
  });

  it("opens the window seeded with the remembered session and retargets it", async () => {
    const store = createInstrumentedStore();
    store.set(workstationActiveSessionIdAtom, "session-1");
    store.set(stationModeAtom, "agent-station");

    await store.set(openStationInNewWindowAtom, {
      stationMode: "my-station",
      title: "My Station",
    });

    expect(openStationWindow).toHaveBeenCalledWith("my-station", {
      sessionId: "session-1",
      title: "My Station",
    });
    expect(emitStationWindowSession).toHaveBeenCalledWith(
      "my-station",
      "session-1",
      { selectStation: true }
    );
  });

  it("hands the main window to the chat panel only when detaching the station on screen", async () => {
    const store = createInstrumentedStore();
    store.set(stationModeAtom, "agent-station");
    store.set(chatPanelMaximizedAtom, false);

    await store.set(openStationInNewWindowAtom, { stationMode: "my-station" });
    expect(store.get(chatPanelMaximizedAtom)).toBe(false);
    expect(store.get(stationWindowChatTakeoverAtom)).toBeNull();

    await store.set(openStationInNewWindowAtom, {
      stationMode: "agent-station",
    });
    expect(store.get(chatPanelMaximizedAtom)).toBe(true);
    expect(store.get(stationWindowChatTakeoverAtom)).toBe("agent-station");
  });

  it("does not claim a takeover the user already made", async () => {
    const store = createInstrumentedStore();
    store.set(stationModeAtom, "my-station");
    store.set(chatPanelMaximizedAtom, true);

    await store.set(openStationInNewWindowAtom, { stationMode: "my-station" });

    expect(store.get(stationWindowChatTakeoverAtom)).toBeNull();
    store.set(restoreStationAfterWindowClosedAtom, "my-station");
    expect(store.get(chatPanelMaximizedAtom)).toBe(true);
  });

  it("never edits the layout from inside a secondary window", async () => {
    vi.mocked(isMainAppWindow).mockReturnValue(false);
    const store = createInstrumentedStore();
    store.set(stationModeAtom, "my-station");
    store.set(chatPanelMaximizedAtom, false);

    await store.set(openStationInNewWindowAtom, { stationMode: "my-station" });

    expect(openStationWindow).toHaveBeenCalledTimes(1);
    expect(store.get(chatPanelMaximizedAtom)).toBe(false);
    expect(store.get(stationWindowChatTakeoverAtom)).toBeNull();
  });

  it("leaves the layout alone when the window build fails", async () => {
    vi.mocked(openStationWindow).mockRejectedValueOnce(new Error("no window"));
    const store = createInstrumentedStore();
    store.set(stationModeAtom, "my-station");

    await expect(
      store.set(openStationInNewWindowAtom, { stationMode: "my-station" })
    ).rejects.toThrow("no window");

    expect(emitStationWindowSession).not.toHaveBeenCalled();
    expect(store.get(chatPanelMaximizedAtom)).toBe(false);
    expect(store.get(stationWindowChatTakeoverAtom)).toBeNull();
  });
});

describe("restoreStationAfterWindowClosedAtom", () => {
  beforeEach(() => {
    localStorage.clear();
    resetInstrumentedStore();
    vi.mocked(isMainAppWindow).mockReturnValue(true);
  });

  it("restores the split for the station whose detach maximized the chat", async () => {
    const store = createInstrumentedStore();
    store.set(stationModeAtom, "agent-station");
    await store.set(openStationInNewWindowAtom, {
      stationMode: "agent-station",
    });
    expect(store.get(chatPanelMaximizedAtom)).toBe(true);

    store.set(restoreStationAfterWindowClosedAtom, "my-station");
    expect(store.get(chatPanelMaximizedAtom)).toBe(true);

    store.set(restoreStationAfterWindowClosedAtom, "agent-station");
    expect(store.get(chatPanelMaximizedAtom)).toBe(false);
    expect(store.get(stationWindowChatTakeoverAtom)).toBeNull();
  });

  it("does not undo a maximize the user restored and re-applied themselves", async () => {
    const store = createInstrumentedStore();
    store.set(stationModeAtom, "my-station");
    await store.set(openStationInNewWindowAtom, { stationMode: "my-station" });
    store.set(chatPanelMaximizedAtom, false);

    store.set(restoreStationAfterWindowClosedAtom, "my-station");

    expect(store.get(chatPanelMaximizedAtom)).toBe(false);
    expect(store.get(stationWindowChatTakeoverAtom)).toBeNull();
  });
});

describe("floating Workstation native-window ownership", () => {
  beforeEach(() => {
    localStorage.clear();
    resetInstrumentedStore();
    vi.mocked(isMainAppWindow).mockReturnValue(true);
    vi.mocked(openStationWindow)
      .mockReset()
      .mockResolvedValue("app-window-station-my-station");
    vi.mocked(emitStationWindowSession)
      .mockReset()
      .mockResolvedValue(undefined);
  });

  it("suspends after success and restores floating without changing persisted layout", async () => {
    const store = createInstrumentedStore();
    store.set(stationModeAtom, "my-station");
    store.set(floatWorkstationAtom);
    const opening = store.set(openStationInNewWindowAtom, {
      stationMode: "my-station",
    });
    expect(store.get(workstationPresentationAtom)).toBe("floating");
    await opening;
    expect(store.get(workstationPresentationAtom)).toBe("collapsed");
    expect(store.get(chatPanelMaximizedAtom)).toBe(false);
    store.set(restoreStationAfterWindowClosedAtom, "agent-station");
    expect(store.get(workstationPresentationAtom)).toBe("collapsed");
    store.set(restoreStationAfterWindowClosedAtom, "my-station");
    expect(store.get(workstationPresentationAtom)).toBe("floating");
  });

  it("restores a close received while session retargeting is still pending", async () => {
    let completeRetarget!: () => void;
    const retargetStarted = new Promise<void>((started) => {
      vi.mocked(emitStationWindowSession).mockImplementationOnce(() => {
        started();
        return new Promise<void>((resolve) => {
          completeRetarget = resolve;
        });
      });
    });
    const store = createInstrumentedStore();
    store.set(stationModeAtom, "my-station");
    store.set(floatWorkstationAtom);
    const opening = store.set(openStationInNewWindowAtom, {
      stationMode: "my-station",
    });
    await retargetStarted;
    expect(store.get(workstationPresentationAtom)).toBe("collapsed");
    store.set(restoreStationAfterWindowClosedAtom, "my-station");
    completeRetarget();
    await opening;
    expect(store.get(workstationPresentationAtom)).toBe("floating");
  });

  it("preserves floating when open fails and supports retry", async () => {
    const store = createInstrumentedStore();
    store.set(stationModeAtom, "my-station");
    store.set(floatWorkstationAtom);
    vi.mocked(openStationWindow).mockRejectedValueOnce(new Error("failed"));
    await expect(
      store.set(openStationInNewWindowAtom, { stationMode: "my-station" })
    ).rejects.toThrow("failed");
    expect(store.get(workstationPresentationAtom)).toBe("floating");
    await store.set(openStationInNewWindowAtom, { stationMode: "my-station" });
    expect(store.get(workstationPresentationAtom)).toBe("collapsed");
  });

  it("does not restore an old docked takeover after newer floating intent", async () => {
    const store = createInstrumentedStore();
    store.set(stationModeAtom, "my-station");
    store.set(chatPanelMaximizedAtom, false);
    await store.set(openStationInNewWindowAtom, { stationMode: "my-station" });
    expect(store.get(chatPanelMaximizedAtom)).toBe(true);
    store.set(floatWorkstationAtom);
    store.set(restoreStationAfterWindowClosedAtom, "my-station");
    expect(store.get(workstationPresentationAtom)).toBe("floating");
    expect(store.get(chatPanelMaximizedAtom)).toBe(true);
  });

  it("does not restore a suspended float onto a different selected station", async () => {
    const store = createInstrumentedStore();
    store.set(stationModeAtom, "my-station");
    store.set(floatWorkstationAtom);
    await store.set(openStationInNewWindowAtom, { stationMode: "my-station" });
    store.set(stationModeAtom, "agent-station");
    store.set(restoreStationAfterWindowClosedAtom, "my-station");
    expect(store.get(workstationPresentationAtom)).toBe("collapsed");
    store.set(stationModeAtom, "my-station");
    store.set(restoreStationAfterWindowClosedAtom, "my-station");
    expect(store.get(workstationPresentationAtom)).toBe("collapsed");
  });

  it("does not reopen a float the user had already collapsed", async () => {
    const store = createInstrumentedStore();
    store.set(stationModeAtom, "my-station");
    store.set(collapseWorkstationAtom);
    await store.set(openStationInNewWindowAtom, { stationMode: "my-station" });
    store.set(restoreStationAfterWindowClosedAtom, "my-station");
    expect(store.get(workstationPresentationAtom)).toBe("collapsed");
  });

  it.each([
    [dockWorkstationAtom, "docked"],
    [collapseWorkstationAtom, "collapsed"],
    [expandWorkstationAtom, "floating"],
  ] as const)(
    "does not undo later presentation intent (%#)",
    async (action, expected) => {
      const store = createInstrumentedStore();
      store.set(stationModeAtom, "my-station");
      store.set(floatWorkstationAtom);
      await store.set(openStationInNewWindowAtom, {
        stationMode: "my-station",
      });
      store.set(action);
      store.set(restoreStationAfterWindowClosedAtom, "my-station");
      expect(store.get(workstationPresentationAtom)).toBe(expected);
    }
  );

  it("ignores a pending open completion after newer presentation intent", async () => {
    let completeOpen!: (label: string) => void;
    vi.mocked(openStationWindow).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeOpen = resolve;
        })
    );
    const store = createInstrumentedStore();
    store.set(stationModeAtom, "my-station");
    store.set(floatWorkstationAtom);
    const opening = store.set(openStationInNewWindowAtom, {
      stationMode: "my-station",
    });
    store.set(dockWorkstationAtom);
    completeOpen("app-window-station-my-station");
    await opening;
    expect(store.get(workstationPresentationAtom)).toBe("docked");
    expect(store.get(chatPanelMaximizedAtom)).toBe(false);
  });

  it("leaves the current float visible when another station is detached", async () => {
    const store = createInstrumentedStore();
    store.set(stationModeAtom, "agent-station");
    store.set(floatWorkstationAtom);
    await store.set(openStationInNewWindowAtom, { stationMode: "my-station" });
    expect(store.get(workstationPresentationAtom)).toBe("floating");
  });
});
