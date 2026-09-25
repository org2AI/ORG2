// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import type { UseWorkStationPanelsReturn } from "@src/hooks/tabHost/useWorkStationPanels";
import type { WorkStationTab } from "@src/store/workstation/tabs";

import { useCodeEditorPrimarySidebarConfig } from "../useCodeEditorPrimarySidebarConfig";

it("hides the source tab tree without changing the saved sidebar state", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const close = vi.fn();
  const panels = {
    primarySidebarCollapsed: false,
    primarySidebarWidth: 300,
    closePrimarySidebar: close,
  } as unknown as UseWorkStationPanelsReturn;
  function Harness({ type }: { type: WorkStationTab["type"] }) {
    const config = useCodeEditorPrimarySidebarConfig({
      activeTab: { id: type, type, title: type, data: {} },
      sidebarContent: null,
      panels,
    });
    return React.createElement("div", {
      "data-collapsed": config.collapsed,
      "data-size": config.size,
    });
  }
  try {
    for (const [type, collapsed, size] of [
      ["file", "false", "300"],
      ["session-sources", "true", "0"],
      ["file", "false", "300"],
    ] as const) {
      act(() => root.render(React.createElement(Harness, { type })));
      expect(host.firstElementChild?.getAttribute("data-collapsed")).toBe(
        collapsed
      );
      expect(host.firstElementChild?.getAttribute("data-size")).toBe(size);
    }
    expect(close).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
