// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UnifiedTabContent } from "@src/modules/WorkStation/TabContent/UnifiedTabContent";
import type { WorkStationTab } from "@src/store/workstation/tabs/types";

const throwingRenderer = vi.hoisted(() => ({ shouldThrow: true }));

// `tab.data` is an open record restored from localStorage and every renderer
// asserts its shape, so a tab written by an older build throws here. Stand in
// for that with a renderer that throws on demand.
vi.mock("@src/modules/WorkStation/TabContent/registry", () => ({
  REGISTRY: {
    file: {
      Component: () => {
        if (throwingRenderer.shouldThrow) {
          throw new Error("Cannot read properties of undefined");
        }
        return React.createElement("div", null, "renderer ok");
      },
    },
  },
}));

vi.mock("@src/features/GitHubWork/GitHubDetailSkeleton", () => ({
  default: () => null,
}));

function makeTab(id: string): WorkStationTab {
  return { id, type: "file", title: `${id}.ts`, data: {} } as WorkStationTab;
}

describe("unified tab content error containment", () => {
  let root: Root;
  let container: HTMLDivElement;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    throwingRenderer.shouldThrow = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    // React logs caught boundary errors; keep the suite output readable.
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    consoleError.mockRestore();
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  });

  function render(tab: WorkStationTab) {
    act(() => {
      root.render(
        React.createElement(UnifiedTabContent, { tab, isActive: true })
      );
    });
  }

  it("contains a throwing renderer instead of unwinding to the app root", () => {
    // Without a boundary here the nearest ancestor is the application root,
    // which replaces the whole window and loses every open tab.
    expect(() => render(makeTab("a"))).not.toThrow();
    expect(container.textContent).not.toBe("");
  });

  it("names the failing tab so a blank pane is locatable", () => {
    render(makeTab("a"));
    expect(container.textContent).toContain("a.ts");
  });

  it("does not leave the failure on screen when the pane is reused for another tab", () => {
    render(makeTab("a"));
    expect(container.textContent).toContain("a.ts");

    // The boundary is keyed by tab id, so a different tab gets a fresh one
    // rather than inheriting the previous tab's error.
    throwingRenderer.shouldThrow = false;
    render(makeTab("b"));
    expect(container.textContent).toContain("renderer ok");
  });

  it("renders normally when the renderer does not throw", () => {
    throwingRenderer.shouldThrow = false;
    render(makeTab("a"));
    expect(container.textContent).toContain("renderer ok");
  });
});
