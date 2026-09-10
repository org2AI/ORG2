// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { workstationActiveSessionIdAtom } from "@src/store/session/viewAtom";
import {
  type WorkStationTab,
  recentWorkstationTabsAtom,
  workstationLayoutAtom,
  workstationTabsStateAtom,
} from "@src/store/workstation/tabs";
import {
  WORKSTATION_V4_SHARED_KEY,
  emptyWorkstationTabsState,
} from "@src/store/workstation/tabs/storage";

import { useCloseTabWithGuard } from "./useCloseTabWithGuard";
import { useWorkStationTabs } from "./useWorkStationTabs";

const { ask } = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let dismiss: ReturnType<typeof useCloseTabWithGuard>;
let root: Root;
let container: HTMLDivElement;
let api: ReturnType<typeof useWorkStationTabs>;
let store: ReturnType<typeof createStore>;
function Probe() {
  const nextApi = useWorkStationTabs();
  const nextDismiss = useCloseTabWithGuard();
  useEffect(() => {
    api = nextApi;
    dismiss = nextDismiss;
  }, [nextApi, nextDismiss]);
  return null;
}
function tab(
  id: string,
  type: WorkStationTab["type"] = "file"
): WorkStationTab {
  return { id, type, title: id, data: {} };
}
function mount() {
  act(() =>
    root.render(createElement(Provider, { store }, createElement(Probe)))
  );
}
beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  ask.mockReset();
  store = createStore();
  store.set(workstationTabsStateAtom, emptyWorkstationTabsState());
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("programmatic workstation tab removal", () => {
  it("removes deleted content without putting it in recent history", () => {
    const deleted = tab("deleted", "project-workitems");
    store.set(workstationLayoutAtom, {
      mainPane: { tabs: [deleted], activeTabId: deleted.id },
    });
    mount();
    act(() => api.removeTab(deleted.id));
    expect(store.get(workstationLayoutAtom).mainPane.tabs).toEqual([]);
    expect(store.get(recentWorkstationTabsAtom)).toEqual([]);
  });

  it.each(["browser-session", "terminal"] as const)(
    "releases a %s resource and persists the removal",
    (type) => {
      const resource = tab("resource", type);
      store.set(workstationLayoutAtom, {
        mainPane: { tabs: [resource], activeTabId: resource.id },
      });
      mount();
      act(() => api.removeTab(resource.id));
      expect(store.get(workstationTabsStateAtom).shared.tabs).toEqual([]);
      expect(
        JSON.parse(localStorage.getItem(WORKSTATION_V4_SHARED_KEY)!).tabs
      ).toEqual([]);
      expect(store.get(recentWorkstationTabsAtom)).toEqual([]);
      act(() => api.removeTab(resource.id));
      expect(store.get(workstationTabsStateAtom).shared.tabs).toEqual([]);
    }
  );

  it("keeps a captured removal scoped to its original session", () => {
    mount();
    act(() => {
      store.set(workstationActiveSessionIdAtom, "session-a");
      store.set(workstationLayoutAtom, {
        mainPane: { tabs: [tab("same-id")], activeTabId: "same-id" },
      });
    });
    const removeFromA = api.removeTab;
    act(() => {
      store.set(workstationActiveSessionIdAtom, "session-b");
      store.set(workstationLayoutAtom, {
        mainPane: { tabs: [tab("same-id")], activeTabId: "same-id" },
      });
    });
    act(() => removeFromA("same-id"));
    expect(store.get(workstationLayoutAtom).mainPane.tabs).toHaveLength(1);
    act(() => store.set(workstationActiveSessionIdAtom, "session-a"));
    expect(store.get(workstationLayoutAtom).mainPane.tabs).toEqual([]);
  });
});

describe("user tab dismissal", () => {
  it("records a dismissed tab in recents", async () => {
    const file = tab("file:a");
    store.set(workstationLayoutAtom, {
      mainPane: { tabs: [file], activeTabId: file.id },
    });
    mount();
    await act(async () => {
      await dismiss({ tabId: file.id });
    });
    expect(store.get(workstationLayoutAtom).mainPane.tabs).toEqual([]);
    expect(store.get(recentWorkstationTabsAtom)).toEqual([file]);
    expect(ask).not.toHaveBeenCalled();
  });

  it("preserves dirty content on cancel and closes only after confirmation", async () => {
    const file = { ...tab("dirty"), hasUnsavedChanges: true };
    store.set(workstationLayoutAtom, {
      mainPane: { tabs: [file], activeTabId: file.id },
    });
    mount();
    ask.mockResolvedValueOnce(false);
    await act(async () => {
      await dismiss({ tabId: file.id });
    });
    expect(store.get(workstationLayoutAtom).mainPane.tabs).toEqual([file]);
    expect(store.get(recentWorkstationTabsAtom)).toEqual([]);
    ask.mockResolvedValueOnce(true);
    await act(async () => {
      await dismiss({ tabId: file.id });
    });
    expect(store.get(workstationLayoutAtom).mainPane.tabs).toEqual([]);
    expect(store.get(recentWorkstationTabsAtom)).toHaveLength(1);
    expect(ask).toHaveBeenCalledTimes(2);
  });
});
