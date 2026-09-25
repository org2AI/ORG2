// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ROUTES } from "@src/config/routes";
import { EditorTabService } from "@src/services/workStation/EditorTabService";
import { createSessionTab } from "@src/store/chatPanel/chatPanelTabFactories";
import { chatPanelTabsAtom } from "@src/store/chatPanel/chatPanelTabsState";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  createInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";

import { openSessionSources } from "./openSessionSources";

describe("openSessionSources", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    resetInstrumentedStore();
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    window.history.replaceState({}, "", ROUTES.workStation.code.path);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resetInstrumentedStore();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("opens and refocuses the real session-bound tab while exposing the workstation", () => {
    const store = createInstrumentedStore();
    const chat = createSessionTab({ sessionId: "session-a" });
    store.set(chatPanelTabsAtom, { tabs: [chat], activeTabId: chat.id });
    store.set(stationModeAtom, "agent-station");
    store.set(chatPanelMaximizedAtom, true);
    act(() =>
      root.render(
        React.createElement(
          "button",
          { onClick: () => openSessionSources("session-a", "Sources") },
          "View all"
        )
      )
    );
    act(() => host.querySelector("button")!.click());

    expect(store.get(stationModeAtom)).toBe("my-station");
    expect(store.get(chatPanelMaximizedAtom)).toBe(false);
    const opened = EditorTabService.getActiveTab();
    expect(opened).toMatchObject({
      type: "session-sources",
      data: { sessionId: "session-a" },
    });
    act(() => host.querySelector("button")!.click());
    expect(EditorTabService.getActiveTabId()).toBe(opened!.id);
    expect(
      EditorTabService.getTabs().filter((tab) => tab.type === "session-sources")
    ).toHaveLength(1);
  });

  it("does not open a tab or reveal the workstation for an empty session reference", () => {
    const store = createInstrumentedStore();
    store.set(stationModeAtom, "agent-station");
    store.set(chatPanelMaximizedAtom, true);
    const initialTabs = EditorTabService.getTabs();
    openSessionSources(" ", "Sources");
    expect(EditorTabService.getTabs()).toEqual(initialTabs);
    expect(store.get(stationModeAtom)).toBe("agent-station");
    expect(store.get(chatPanelMaximizedAtom)).toBe(true);
  });
});
