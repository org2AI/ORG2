// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { type ReactNode, act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { workstationPresentationAtom } from "@src/store/workstation/presentationAtoms";

import {
  WorkstationFloatButton,
  WorkstationFloatingControls,
  WorkstationFloatingLauncher,
} from "./WorkstationFloatingControls";

const { stationWindow } = vi.hoisted(() => ({
  stationWindow: vi.fn(() => false),
}));
vi.mock("@src/util/platform/tauri/windowIdentity", () => ({
  isStationWindow: stationWindow,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/components/KeyboardShortcut/ToolbarTooltip", () => ({
  ToolbarTooltip: ({ children }: { children: ReactNode }) => children,
}));

describe("WorkstationFloatingControls", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    stationWindow.mockReturnValue(false);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    store = createStore();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root.render(
        createElement(
          Provider,
          { store },
          createElement(WorkstationFloatButton),
          createElement(WorkstationFloatingControls),
          createElement(WorkstationFloatingLauncher)
        )
      )
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  function click(id: string) {
    const button = container.querySelector<HTMLButtonElement>(
      `[data-testid="${id}"]`
    );
    expect(button).not.toBeNull();
    expect(
      button?.getAttribute("aria-label") || button?.textContent
    ).toBeTruthy();
    act(() => button!.click());
  }

  it("floats, collapses, reopens and restores the same workstation presentation", () => {
    click("workstation-float");
    expect(store.get(workstationPresentationAtom)).toBe("floating");
    expect(
      container.querySelector('[data-testid="workstation-float"]')
    ).toBeNull();
    click("workstation-collapse");
    expect(store.get(workstationPresentationAtom)).toBe("collapsed");
    click("workstation-expand");
    expect(store.get(workstationPresentationAtom)).toBe("floating");
    click("workstation-dock");
    expect(store.get(workstationPresentationAtom)).toBe("docked");
    expect(
      container.querySelector('[data-testid="workstation-float"]')
    ).not.toBeNull();
  });

  it("hides the floating entry in a detached station window", () => {
    stationWindow.mockReturnValue(true);
    act(() =>
      root.render(
        createElement(
          Provider,
          { store },
          createElement(WorkstationFloatButton)
        )
      )
    );
    expect(container.querySelector("button")).toBeNull();
  });
});
