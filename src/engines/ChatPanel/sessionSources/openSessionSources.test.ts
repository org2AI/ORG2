// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ROUTES } from "@src/config/routes";
import { EditorTabService } from "@src/services/workStation/EditorTabService";
import { chatPanelCompanionAtom } from "@src/store/chatPanel/chatPanelCompanionAtom";
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

  it("opens and refocuses the real session-bound tab only with an explicit Station destination", () => {
    const store = createInstrumentedStore();
    const chat = createSessionTab({ sessionId: "session-a" });
    store.set(chatPanelTabsAtom, { tabs: [chat], activeTabId: chat.id });
    store.set(stationModeAtom, "agent-station");
    store.set(chatPanelMaximizedAtom, true);
    act(() =>
      root.render(
        React.createElement(
          "button",
          {
            onClick: () =>
              openSessionSources("session-a", "Sources", "my-station"),
          },
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

  it("defaults to the conversation companion without creating or activating a tab", () => {
    const store = createInstrumentedStore();
    const chat = createSessionTab({ sessionId: "session-a" });
    store.set(chatPanelTabsAtom, { tabs: [chat], activeTabId: chat.id });
    store.set(stationModeAtom, "agent-station");
    store.set(chatPanelMaximizedAtom, true);
    const before = EditorTabService.getTabs();
    openSessionSources("session-a", "Sources");
    const opened = store.get(chatPanelCompanionAtom);
    expect(opened).toEqual({
      type: "session-sources",
      sessionId: "session-a",
      ownerTabId: chat.id,
    });
    openSessionSources("session-a", "Sources");
    expect(store.get(chatPanelCompanionAtom)).toBe(opened);
    expect(store.get(chatPanelTabsAtom).activeTabId).toBe(chat.id);
    expect(EditorTabService.getTabs()).toEqual(before);
    expect(store.get(stationModeAtom)).toBe("agent-station");
    expect(store.get(chatPanelMaximizedAtom)).toBe(true);
  });

  it("rejects a stale action belonging to another conversation", () => {
    const store = createInstrumentedStore();
    const chat = createSessionTab({ sessionId: "session-b" });
    store.set(chatPanelTabsAtom, { tabs: [chat], activeTabId: chat.id });
    openSessionSources("session-a", "Sources");
    expect(store.get(chatPanelCompanionAtom)).toBeNull();
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
