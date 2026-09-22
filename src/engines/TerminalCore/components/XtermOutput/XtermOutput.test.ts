// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settingsAtom } from "@src/store/settings/settingsAtom";
import { resolvedCodeFontFamilyAtom } from "@src/store/ui/editorSettingsAtom";

import XtermOutput from ".";

const runtime = vi.hoisted(() => ({
  create: vi.fn(),
  fit: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    rows = 24;
    buffer = { active: { cursorY: 0 } };
    unicode = { activeVersion: "" };
    constructor(public options: Record<string, unknown>) {
      runtime.create(this);
    }
    loadAddon() {}
    open() {}
    write() {}
    reset() {}
    clearTextureAtlas() {}
    refresh() {}
    dispose = runtime.dispose;
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = runtime.fit;
  },
}));
vi.mock("@xterm/addon-unicode11", () => ({
  Unicode11Addon: class {},
}));
vi.mock("../TerminalInteractive/terminalRendererPolicy", () => ({
  shouldLoadTerminalWebgl: () => false,
}));

describe("XtermOutput font settings", () => {
  let root: Root;
  let container: HTMLDivElement;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 16)
    );
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    vi.clearAllMocks();
    store = createStore();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function render() {
    act(() => {
      root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(XtermOutput, { content: "hello" })
        )
      );
    });
    act(() => vi.runOnlyPendingTimers());
  }

  it("uses the editor font initially and refits the same terminal on font changes", () => {
    render();
    const terminal = runtime.create.mock.calls[0][0];
    expect(terminal.options.fontFamily).toBe(
      store.get(resolvedCodeFontFamilyAtom)
    );
    expect(terminal.options.fontWeight).toBe("400");
    expect(terminal.options.fontWeightBold).toBe("700");
    runtime.fit.mockClear();

    act(() => {
      store.set(settingsAtom, {
        ...store.get(settingsAtom),
        "editor.fontFamily": "Custom",
        "editor.customFontFamily": "My Mono",
      });
    });
    act(() => vi.runOnlyPendingTimers());

    expect(terminal.options.fontFamily).toBe(
      store.get(resolvedCodeFontFamilyAtom)
    );
    expect(terminal.options.fontFamily).toContain('"My Mono"');
    expect(runtime.fit).toHaveBeenCalledOnce();
    expect(runtime.create).toHaveBeenCalledOnce();
    expect(runtime.dispose).not.toHaveBeenCalled();
  });

  it("cancels a pending font refit when unmounted", () => {
    render();
    runtime.fit.mockClear();
    act(() => {
      store.set(settingsAtom, {
        ...store.get(settingsAtom),
        "editor.fontFamily": "Hack",
      });
    });
    act(() => root.render(null));
    act(() => vi.runOnlyPendingTimers());
    expect(runtime.fit).not.toHaveBeenCalled();
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });
});
