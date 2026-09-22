// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { editorShowMinimapAtom } from "@src/store/ui/editorSettingsAtom";

import { CodeMirrorEditor } from ".";

const mocks = vi.hoisted(() => ({ factory: vi.fn(), menu: vi.fn() }));
vi.mock("@src/store/ui/editorSettingsAtom", async () => {
  const { atom } = await import("jotai");
  return { editorShowMinimapAtom: atom(false) };
});
vi.mock("@src/hooks/settings", async () => {
  const { useAtomValue } = await import("jotai");
  const { editorShowMinimapAtom } =
    await import("@src/store/ui/editorSettingsAtom");
  return {
    useEditorAppearanceSettings: () => ({
      showMinimap: useAtomValue(editorShowMinimapAtom),
      showIndentGuides: false,
      tabSize: 2,
      lineNumbers: "on",
    }),
  };
});
vi.mock("@src/util/platform/tauri/nativeMenuPopup", () => ({
  popupNativeMenu: mocks.menu,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/components/CustomScrollbar", () => ({
  CustomScrollbar: () => null,
}));
vi.mock("@src/hooks/git/useGitBlame", () => ({
  useGitBlame: () => ({ blameDataRef: { current: new Map() } }),
}));
vi.mock("@src/hooks/perf/runtimeMemoryStats", () => ({
  removeCodeMirrorMemoryEntry: () => {},
  updateCodeMirrorMemoryEntry: () => {},
}));
vi.mock("../config", async () => {
  const { minimapExtension } = await import("../config/minimap");
  return {
    BASIC_SETUP_CONFIG: {},
    getCodeMirrorTheme: () => undefined,
    codeMirrorCspNonceExtension: [],
    createCodeMirrorTheme: () => [],
    customFoldGutter: () => [],
    foldPlaceholderTheme: () => [],
    editorHistoryKeymapExtension: () => [],
    minimapExtension: (...args: Parameters<typeof minimapExtension>) => {
      mocks.factory();
      return minimapExtension(...args);
    },
  };
});
vi.mock("./hooks", async () => ({
  ...(await import("./hooks/useEditorExtensions")),
  ...(await import("./hooks/useLargeFileHandling")),
  useEditorServiceRegistration: () => ({
    handleCreateEditor: () => {},
    scrollElement: null,
    totalLines: 1,
  }),
  useLazyLanguageExtension: () => null,
  useCopyExtension: () => null,
  useCursorExtension: () => null,
  useSelectionExtension: () => null,
}));
// Keep the real EditorView/plugin lifecycle; replace only the UIW adapter.
vi.mock("@uiw/react-codemirror", async () => {
  const React = await import("react");
  const { EditorView } = await import("@codemirror/view");
  return {
    default: function MockCodeMirror({
      extensions,
      value,
    }: {
      extensions: import("@codemirror/state").Extension[];
      value: string;
    }) {
      const ref = React.useRef<HTMLDivElement>(null);
      React.useLayoutEffect(() => {
        const view = new EditorView({
          parent: ref.current!,
          doc: value,
          extensions,
        });
        return () => view.destroy();
      }, [extensions, value]);
      return React.createElement("div", { ref });
    },
  };
});
let root: Root;
let host: HTMLDivElement;
let store: ReturnType<typeof createStore>;
const tick = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
function render(enableMinimap?: boolean) {
  act(() =>
    root.render(
      React.createElement(
        Provider,
        { store },
        React.createElement(CodeMirrorEditor, {
          value: "hello",
          enableMinimap,
          enableFindReplace: false,
          enableGoToLine: false,
          enableCodeNavigation: false,
          enableDirtyDiff: false,
        })
      )
    )
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.menu.mockResolvedValue({ status: "closed" });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  store = createStore();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("editor minimap setting and native menu", () => {
  it.each([undefined, true, false])(
    "does not construct a minimap when settings are off (prop %s)",
    async (prop) => {
      render(prop);
      await tick();
      expect(mocks.factory).not.toHaveBeenCalled();
      expect(host.querySelector(".codemirror-minimap-host")).toBeNull();
    }
  );
  it("closes through the native menu, destroys the canvas, and stays off on remount", async () => {
    store.set(editorShowMinimapAtom, true);
    render(true);
    await tick();
    const minimap = host.querySelector(".codemirror-minimap-host")!;
    expect(minimap.querySelector("canvas")).not.toBeNull();
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      minimap.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    const request = mocks.menu.mock.calls[0][0];
    expect(request.source).toBe("codemirror-minimap");
    const items = request.buildItems();
    expect(items[0].text).toBe("editor.hideMinimap");
    act(() => items[0].action());
    await tick();
    expect(store.get(editorShowMinimapAtom)).toBe(false);
    expect(minimap.querySelector("canvas")).toBeNull();
    expect(host.querySelector(".codemirror-minimap-host")).toBeNull();
    mocks.factory.mockClear();
    act(() => root.unmount());
    root = createRoot(host);
    render(true);
    await tick();
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("reacts to the settings switch and preserves explicit per-editor opt-out", async () => {
    render();
    act(() => store.set(editorShowMinimapAtom, true));
    await tick();
    expect(host.querySelector(".minimap-canvas")).not.toBeNull();
    act(() => store.set(editorShowMinimapAtom, false));
    await tick();
    expect(host.querySelector(".minimap-canvas")).toBeNull();
    act(() => store.set(editorShowMinimapAtom, true));
    render(false);
    await tick();
    expect(host.querySelector(".codemirror-minimap-host")).toBeNull();
  });
});
