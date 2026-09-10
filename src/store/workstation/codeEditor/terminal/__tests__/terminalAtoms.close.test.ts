import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeTerminalIdAtom,
  closeTerminalSessionAtom,
  terminalSessionsAtom,
} from "../index";

vi.mock("@src/util/platform/tauri/init", () => ({
  invokeTauri: vi.fn().mockResolvedValue(undefined),
  isTauriReady: vi.fn().mockReturnValue(false),
}));

vi.mock("@src/util/ui/terminal/creationThrottle", () => ({
  tryBeginTerminalCreation: vi.fn().mockReturnValue(true),
  notifyTerminalCreationCooldown: vi.fn(),
}));

vi.mock("@src/config/settingsSchema", () => ({
  getSettingsDefaults: vi.fn().mockReturnValue({
    "terminal.shellType": "default",
    "terminal.customShellPath": "",
  }),
}));

describe("terminal close lifecycle", () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
    store.set(terminalSessionsAtom, [
      { id: "t-1", name: "Terminal 1", isActive: true },
      { id: "t-2", name: "Terminal 2", isActive: false },
    ]);
    store.set(activeTerminalIdAtom, "t-1");
  });

  it("closes an existing read-only agent tab through the normal terminal action", async () => {
    const tabId = "agent-session-legacy-1";
    store.set(terminalSessionsAtom, (sessions) => [
      ...sessions,
      {
        id: tabId,
        name: "Agent",
        isActive: false,
        readOnly: true,
        agentSessionId: "legacy-1",
      },
    ]);

    await store.set(closeTerminalSessionAtom, tabId);

    expect(
      store.get(terminalSessionsAtom).map((session) => session.id)
    ).toEqual(["t-1", "t-2"]);
    expect(store.get(activeTerminalIdAtom)).toBe("t-1");
  });
});
