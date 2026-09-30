// @vitest-environment jsdom
import { createStore } from "jotai";
import { expect, it } from "vitest";

import { createSessionTab } from "@src/store/chatPanel/chatPanelTabFactories";
import { chatPanelTabsAtom } from "@src/store/chatPanel/chatPanelTabsState";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";

import {
  closeSessionTrailSurfaceAtom,
  openSessionTrailSurfaceAtom,
  sessionTrailSurfaceAtom,
  toggleSessionTrailFullscreenAtom,
} from "./sessionTrailSurfaceAtom";
import { workstationLayoutAtom } from "./tabs";

it("owns one temporary slot per active parent and preserves durable chat and station state", () => {
  const store = createStore();
  const a = createSessionTab({ sessionId: "a" });
  const b = createSessionTab({ sessionId: "b" });
  store.set(chatPanelTabsAtom, { tabs: [a, b], activeTabId: a.id });
  const tabs = store.get(workstationLayoutAtom);
  const mode = store.get(stationModeAtom);
  store.set(openSessionTrailSurfaceAtom, {
    kind: "subagents",
    sessionId: "a",
    title: "Subagents",
  });
  store.set(chatPanelTabsAtom, { tabs: [a, b], activeTabId: b.id });
  expect(store.get(sessionTrailSurfaceAtom)).toBeNull();
  store.set(openSessionTrailSurfaceAtom, {
    kind: "subagents",
    sessionId: "a",
    title: "Wrong owner",
  });
  expect(store.get(sessionTrailSurfaceAtom)).toBeNull();
  store.set(openSessionTrailSurfaceAtom, {
    kind: "subagents",
    sessionId: "b",
    title: "Subagents",
    childSessionId: "b-child",
  });
  expect(store.get(sessionTrailSurfaceAtom)).toMatchObject({
    ownerTabId: b.id,
    sessionId: "b",
    childSessionId: "b-child",
  });
  store.set(closeSessionTrailSurfaceAtom);
  expect(store.get(sessionTrailSurfaceAtom)).toBeNull();
  expect(store.get(workstationLayoutAtom)).toBe(tabs);
  expect(store.get(stationModeAtom)).toBe(mode);
  expect(store.get(chatPanelTabsAtom).activeTabId).toBe(b.id);
  store.set(closeSessionTrailSurfaceAtom);
});

it("scopes fullscreen to the active subagent surface and resets on close or replacement", () => {
  const store = createStore();
  const a = createSessionTab({ sessionId: "a" });
  const b = createSessionTab({ sessionId: "b" });
  store.set(chatPanelTabsAtom, { tabs: [a, b], activeTabId: a.id });
  const tabs = store.get(workstationLayoutAtom);
  const mode = store.get(stationModeAtom);
  const request = {
    kind: "subagents" as const,
    sessionId: "a",
    title: "Subagents",
    childSessionId: "child",
  };
  store.set(openSessionTrailSurfaceAtom, request);
  store.set(toggleSessionTrailFullscreenAtom);
  expect(store.get(sessionTrailSurfaceAtom)).toMatchObject({
    fullscreen: true,
    childSessionId: "child",
  });
  expect(store.get(workstationLayoutAtom)).toBe(tabs);
  expect(store.get(stationModeAtom)).toBe(mode);
  store.set(chatPanelTabsAtom, { tabs: [a, b], activeTabId: b.id });
  store.set(toggleSessionTrailFullscreenAtom);
  expect(store.get(sessionTrailSurfaceAtom)).toBeNull();
  store.set(chatPanelTabsAtom, { tabs: [a, b], activeTabId: a.id });
  expect(store.get(sessionTrailSurfaceAtom)?.fullscreen).toBe(true);
  store.set(toggleSessionTrailFullscreenAtom);
  expect(store.get(sessionTrailSurfaceAtom)?.fullscreen).toBe(false);
  store.set(toggleSessionTrailFullscreenAtom);
  store.set(closeSessionTrailSurfaceAtom);
  store.set(openSessionTrailSurfaceAtom, request);
  expect(store.get(sessionTrailSurfaceAtom)?.fullscreen).toBeFalsy();
  store.set(toggleSessionTrailFullscreenAtom);
  store.set(openSessionTrailSurfaceAtom, {
    kind: "subagents",
    sessionId: "a",
    title: "Subagents",
  });
  expect(store.get(sessionTrailSurfaceAtom)?.fullscreen).toBeFalsy();
});
