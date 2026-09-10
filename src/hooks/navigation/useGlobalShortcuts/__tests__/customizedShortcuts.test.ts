// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import {
  resetShortcutBindings,
  setRecordingShortcut,
  setShortcutBinding,
} from "@src/config/keyboard/shortcutBindings";

import { useGlobalKeydownShortcuts } from "../useGlobalKeydownShortcuts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const dispatch = vi.hoisted(() => vi.fn());
vi.mock("@src/hooks/keyboard", () => ({ shortcutRegistry: { dispatch } }));
vi.mock("@src/util/core/state/instrumentedStore", () => ({
  getInstrumentedStore: () => ({ get: () => false }),
}));

afterEach(() => {
  resetShortcutBindings();
  setRecordingShortcut(false);
  dispatch.mockClear();
});

it("dispatches a customized command from the production global listener and stops using the original", async () => {
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const noOp = vi.fn();
  const options: Parameters<typeof useGlobalKeydownShortcuts>[0] = {
    inspectModeRef: { current: false },
    spotlightOpenRef: { current: false },
    handleInspectMoveUpLevel: async () => false,
    handleInspectMoveDownLevel: async () => false,
    handleInspectToggleLabels: async () => false,
    handleInspectHideLabels: async () => false,
    handleOpenWorkStationFilePalette: noOp,
    handleOpenWorkStationSymbolPalette: noOp,
    handleOpenAgentSessionSearch: noOp,
    handleOpenSettings: noOp,
    handleToggleSidebar: noOp,
    handleToggleWorkstationSidebar: noOp,
    handleOpenCodeEditorFileFolder: noOp,
    handleOpenCodeEditorSourceControl: noOp,
    handleOpenCodeEditorSearchSidebar: noOp,
    handleOpenCodeEditorTerminal: noOp,
    handleCloseCurrentTab: () => false,
    handleToggleWorkStationChatFocus: noOp,
    openQuitConfirmation: noOp,
    closeQuitConfirmation: noOp,
  };
  function Harness() {
    useGlobalKeydownShortcuts(options);
    return null;
  }
  await act(async () => {
    root.render(createElement(Harness));
  });
  const press = (key: string, code: string) =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        code,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
  try {
    press("n", "KeyN");
    expect(dispatch).toHaveBeenLastCalledWith("new_session");
    dispatch.mockClear();
    setShortcutBinding("new_session", "windows", {
      key: "F6",
      ctrl: true,
      meta: false,
      alt: false,
      shift: false,
    });
    press("n", "KeyN");
    expect(dispatch).not.toHaveBeenCalled();
    press("F6", "F6");
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith("new_session");
    dispatch.mockClear();
    setRecordingShortcut(true);
    press("F6", "F6");
    expect(dispatch).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    node.remove();
  }
});
