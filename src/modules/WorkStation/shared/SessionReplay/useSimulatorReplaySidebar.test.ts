// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { SIMULATOR_PRIMARY_SIDEBAR } from "@src/config/simulatorPrimarySidebar";
import {
  simulatorPrimarySidebarCollapsedAtom,
  simulatorPrimarySidebarPositionAtom,
  simulatorPrimarySidebarWidthAtom,
} from "@src/store/ui/simulatorAtom";
import { workStationPrimarySidebarWidthAtom } from "@src/store/ui/workStationLayout/primarySidebarAtoms";

import { useSimulatorReplaySidebar } from "./useSimulatorReplaySidebar";

it("shares replay resize/collapse state without changing My Station dimensions", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const store = createStore();
  const root = createRoot(document.createElement("div"));
  const values: ReturnType<typeof useSimulatorReplaySidebar>[] = [];
  function Consumer({ index }: { index: number }) {
    const value = useSimulatorReplaySidebar();
    useEffect(() => {
      values[index] = value;
    }, [index, value]);
    return null;
  }
  const myWidth = store.get(workStationPrimarySidebarWidthAtom);
  try {
    act(() =>
      root.render(
        createElement(
          Provider,
          { store },
          [0, 1].map((index) => createElement(Consumer, { index, key: index }))
        )
      )
    );
    expect(values[0].sidebar.minSize).toBe(SIMULATOR_PRIMARY_SIDEBAR.minWidth);
    expect(values[0].sidebar.maxSize).toBe(SIMULATOR_PRIMARY_SIDEBAR.maxWidth);
    act(() =>
      values[0].sidebar.onSizeChange(SIMULATOR_PRIMARY_SIDEBAR.minWidth + 25)
    );
    expect(values[1].sidebar.size).toBe(
      SIMULATOR_PRIMARY_SIDEBAR.minWidth + 25
    );
    act(() => values[1].sidebar.onSizeChange(values[1].sidebar.resetSize));
    expect(store.get(simulatorPrimarySidebarWidthAtom)).toBe(
      SIMULATOR_PRIMARY_SIDEBAR.defaultWidth
    );
    act(() => {
      store.set(simulatorPrimarySidebarCollapsedAtom, true);
      store.set(simulatorPrimarySidebarPositionAtom, "right");
    });
    expect(
      values.every(
        (value) => value.sidebar.collapsed && value.layoutMode === "right"
      )
    ).toBe(true);
    expect(store.get(workStationPrimarySidebarWidthAtom)).toBe(myWidth);
    const previous = values[0].sidebar;
    act(() =>
      root.render(
        createElement(
          Provider,
          { store },
          [0, 1].map((index) => createElement(Consumer, { index, key: index }))
        )
      )
    );
    expect(values[0].sidebar).toBe(previous);
  } finally {
    act(() => root.unmount());
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
