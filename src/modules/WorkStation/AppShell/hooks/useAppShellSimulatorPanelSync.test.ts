// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BrowserSessionWebview from "@src/engines/BrowserCore/BrowserSessionWebview";
import { simulatorPrimarySidebarPositionAtom } from "@src/store/ui/simulatorAtom";
import type { LayoutMode } from "@src/store/ui/workStationLayout/splitLayoutAtoms";

import { useAppShellSimulatorPanelSync } from "./useAppShellSimulatorPanelSync";

const { updatePosition } = vi.hoisted(() => ({ updatePosition: vi.fn() }));
vi.mock("@src/hooks/platform/useInlineWebview", () => ({
  useInlineWebview: () => ({
    updatePosition,
    isWebviewAvailable: false,
    isWebviewCreated: false,
  }),
}));

const session = {
  id: "geometry-test",
  url: "https://example.com",
  title: "Example",
  history: ["https://example.com"],
  historyIndex: 0,
  isLoading: false,
  error: null,
};
const containerRef = { current: null };
const onSessionUpdate = vi.fn();
function Harness({
  isAgentStation,
  layoutMode,
  active = true,
  tabActive = true,
}: {
  isAgentStation: boolean;
  layoutMode: LayoutMode;
  active?: boolean;
  tabActive?: boolean;
}) {
  useAppShellSimulatorPanelSync({ isAgentStation, layoutMode });
  return createElement(BrowserSessionWebview, {
    session,
    containerRef,
    onSessionUpdate,
    isActive: active,
    isTabActive: tabActive,
  });
}

describe("simulator sidebar sync at the native webview boundary", () => {
  let root: Root;
  let container: HTMLDivElement;
  let store: ReturnType<typeof createStore>;
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    store = createStore();
    container = document.createElement("div");
    root = createRoot(container);
    updatePosition.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });
  function render(
    isAgentStation: boolean,
    layoutMode: LayoutMode,
    active = true,
    tabActive = true
  ) {
    act(() =>
      root.render(
        createElement(
          Provider,
          { store },
          createElement(Harness, {
            isAgentStation,
            layoutMode,
            active,
            tabActive,
          })
        )
      )
    );
  }
  function flush() {
    act(() => vi.advanceTimersByTime(200));
  }

  it("keeps My Station edits quiet and preserves Agent Station's four resize ticks", () => {
    render(false, "left");
    flush();
    expect(updatePosition).toHaveBeenCalledTimes(4);
    updatePosition.mockClear();
    render(false, "right");
    flush();
    expect(store.get(simulatorPrimarySidebarPositionAtom)).toBe("left");
    expect(updatePosition).not.toHaveBeenCalled();
    render(true, "right");
    expect(store.get(simulatorPrimarySidebarPositionAtom)).toBe("right");
    act(() => vi.advanceTimersByTime(0));
    expect(updatePosition).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(50));
    expect(updatePosition).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(50));
    expect(updatePosition).toHaveBeenCalledTimes(3);
    act(() => vi.advanceTimersByTime(70));
    expect(updatePosition).toHaveBeenCalledTimes(4);
    expect(updatePosition).toHaveBeenLastCalledWith({ force: true });
    updatePosition.mockClear();
    render(true, "right");
    flush();
    expect(updatePosition).not.toHaveBeenCalled();
    render(false, "left");
    flush();
    expect(store.get(simulatorPrimarySidebarPositionAtom)).toBe("right");
    expect(updatePosition).not.toHaveBeenCalled();
    render(true, "left");
    flush();
    expect(updatePosition).toHaveBeenCalledTimes(4);
  });

  it.each([
    [false, true],
    [true, false],
  ])("does not resize inactive webviews (%s/%s)", (active, tabActive) => {
    render(true, "right", active, tabActive);
    flush();
    render(true, "left", active, tabActive);
    flush();
    expect(updatePosition).not.toHaveBeenCalled();
  });

  it("cancels pending animation ticks on unmount", () => {
    render(true, "right");
    act(() => vi.advanceTimersByTime(0));
    expect(updatePosition).toHaveBeenCalledTimes(1);
    act(() => root.render(null));
    flush();
    expect(updatePosition).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
