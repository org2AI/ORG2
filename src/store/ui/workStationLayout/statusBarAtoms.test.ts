import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import { workstationTabsStateAtom } from "@src/store/workstation/tabs/atoms";
import { emptyWorkstationTabsState } from "@src/store/workstation/tabs/storage";
import type { WorkStationTabType } from "@src/store/workstation/tabs/types";
import {
  activeWorkstationTabHeaderAtom,
  workstationTabHeaderAtomByHost,
} from "@src/store/workstation/workstationTabBarAtoms";

import {
  activeStatusBarAppAtom,
  activeStatusBarCallbacksAtom,
  activeStatusBarStateAtom,
  perAppStatusBarCallbacksAtom,
} from "./statusBarAtoms";

function activateTab(
  store: ReturnType<typeof createStore>,
  type: WorkStationTabType
) {
  const state = emptyWorkstationTabsState();
  state.globalWorkspace = {
    tabs: [{ id: type, type, title: type, data: {} }],
    activeTabRef: { partition: "workspace", tabId: type },
    tabOrder: [{ partition: "workspace", tabId: type }],
  };
  store.set(workstationTabsStateAtom, state);
}

describe("active status-bar host", () => {
  it("switches status, callbacks, and header synchronously with the active tab", () => {
    const store = createStore();
    const callbacks = { code: {}, browser: {}, project: {} };
    store.set(perAppStatusBarCallbacksAtom, callbacks);
    const hosts = [
      ["source-control", "code"],
      ["browser-session", "browser"],
      ["project-dashboard", "project"],
      ["start", "code"],
    ] as const;
    for (const [type, host] of hosts) {
      const header = { content: host };
      store.set(workstationTabHeaderAtomByHost[host], header);
      activateTab(store, type);
      expect(store.get(activeStatusBarAppAtom)).toBe(host);
      expect(store.get(activeStatusBarStateAtom).appType).toBe(host);
      expect(store.get(activeStatusBarCallbacksAtom)).toBe(callbacks[host]);
      expect(store.get(activeWorkstationTabHeaderAtom)).toBe(header);
    }
  });

  it("falls back to code after the last tab closes without mounting AppShell", () => {
    const store = createStore();
    activateTab(store, "browser-session");
    expect(store.get(activeStatusBarAppAtom)).toBe("browser");
    store.set(workstationTabsStateAtom, emptyWorkstationTabsState());
    expect(store.get(activeStatusBarAppAtom)).toBe("code");
    expect(store.get(activeStatusBarStateAtom).appType).toBe("code");
  });

  it("keeps host selection isolated between stores", () => {
    const first = createStore();
    const second = createStore();
    activateTab(first, "browser-session");
    activateTab(second, "project-dashboard");
    expect(first.get(activeStatusBarAppAtom)).toBe("browser");
    expect(second.get(activeStatusBarAppAtom)).toBe("project");
  });
});
