// @vitest-environment jsdom
import { Provider } from "jotai";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { navigateInMainWindow } from "@src/api/tauri/stationWindow";
import { ROUTES } from "@src/config/routes";
import { navigateApp } from "@src/router/navigateApp";
import { WorkStationViewService } from "@src/services/workStation/WorkStationViewService";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import { activeWorkStationTabAtom } from "@src/store/workstation/tabs";
import {
  createInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";

import { useStationWindowNavigation } from "./useStationWindowNavigation";

vi.mock("@src/util/platform/tauri/windowIdentity", async (original) => ({
  ...(await original<
    typeof import("@src/util/platform/tauri/windowIdentity")
  >()),
  isStationWindow: () => true,
  getCurrentStationWindowMode: () => "my-station",
}));
vi.mock("@src/api/tauri/stationWindow", () => ({
  navigateInMainWindow: vi.fn(async () => {}),
}));

let root: Root;
let container: HTMLDivElement;
let store: ReturnType<typeof createInstrumentedStore>;
const navigations = vi.fn();
const initialPath = "/orgii/app/station/my-station";
function Bridge() {
  useStationWindowNavigation();
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetInstrumentedStore();
  store = createInstrumentedStore();
  localStorage.setItem("orgii:chatPanelMaximized", "true");
  localStorage.setItem("stationMode", JSON.stringify("agent-station"));
  window.history.replaceState({}, "", initialPath);
  vi.clearAllMocks();
  window.addEventListener("action-system-navigate", navigations);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(createElement(Provider, { store }, createElement(Bridge)))
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.removeEventListener("action-system-navigate", navigations);
  vi.unstubAllGlobals();
});

it.each([
  ["source-control", () => WorkStationViewService.openSourceControlTab()],
  ["terminal", () => WorkStationViewService.openTerminalTab()],
  ["explorer", () => WorkStationViewService.openFileFolderTab()],
  ["explorer", () => WorkStationViewService.openSearchSidebar("needle")],
] as const)(
  "opens %s in the station without changing main layout",
  async (type, action) => {
    await act(async () => {
      await action();
    });
    expect(store.get(activeWorkStationTabAtom)?.type).toBe(type);
    expect(store.get(chatPanelMaximizedAtom)).toBe(false);
    expect(localStorage.getItem("orgii:chatPanelMaximized")).toBe("true");
    expect(localStorage.getItem("stationMode")).toBe(
      JSON.stringify("agent-station")
    );
    expect(window.location.pathname).toBe(initialPath);
    expect(navigations).not.toHaveBeenCalled();
  }
);

it("switches station shortcuts and route intents inside the current window", async () => {
  await act(async () => {
    await WorkStationViewService.openStationMode("agent-station");
  });
  expect(store.get(stationModeAtom)).toBe("agent-station");
  await act(async () => {
    await WorkStationViewService.openTerminalTab();
  });
  expect(store.get(stationModeAtom)).toBe("agent-station");
  act(() => navigateApp(ROUTES.workStation.code.path));
  expect(store.get(stationModeAtom)).toBe("my-station");
  expect(navigations).not.toHaveBeenCalled();
  expect(navigateInMainWindow).not.toHaveBeenCalled();
});

it("sends settings to main without replacing the station shell", () => {
  act(() => navigateApp(ROUTES.app.settings.path, true));
  expect(navigateInMainWindow).toHaveBeenCalledWith({
    path: ROUTES.app.settings.path,
    replace: true,
  });
  expect(navigations).not.toHaveBeenCalled();
  expect(window.location.pathname).toBe(initialPath);
});

it("rejects shared chat-layout writes at the atom boundary", () => {
  store.set(chatPanelMaximizedAtom, false);
  store.set(chatPanelMaximizedAtom, (previous) => !previous);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: "orgii:chatPanelMaximized",
      newValue: "true",
      storageArea: localStorage,
    })
  );
  expect(store.get(chatPanelMaximizedAtom)).toBe(false);
  expect(localStorage.getItem("orgii:chatPanelMaximized")).toBe("true");
});
