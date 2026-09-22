// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  editorHighlightActiveLineAtom,
  editorLineNumbersAtom,
  editorShowBlameAtom,
  editorShowMinimapAtom,
  editorSplitDiffCenteredLineNumbersAtom,
  editorWordWrapAtom,
} from "@src/store/ui/editorSettingsAtom";

import {
  type EditorDisplayToggles,
  resolveLineNumbersToggle,
  toggleEditorLineNumbersAtom,
  useEditorDisplayToggles,
} from "../useEditorDisplayToggles";

// Plain atoms stand in for the settings-backed ones: the hook only needs the
// read/write contract, not settings.jsonc persistence.
vi.mock("@src/store/ui/editorSettingsAtom", async () => {
  const { atom } = await import("jotai");
  return {
    editorLineNumbersAtom: atom<string>("on"),
    editorWordWrapAtom: atom(false),
    editorShowMinimapAtom: atom(false),
    editorHighlightActiveLineAtom: atom(true),
    editorShowBlameAtom: atom(false),
    editorSplitDiffCenteredLineNumbersAtom: atom(false),
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let unmount: (() => void) | null = null;

afterEach(() => {
  unmount?.();
  unmount = null;
});

function renderToggles(store: ReturnType<typeof createStore>) {
  const resultRef: { current: EditorDisplayToggles | null } = { current: null };
  const capture = (toggles: EditorDisplayToggles) => {
    resultRef.current = toggles;
  };
  function Probe({ onRender }: { onRender: typeof capture }) {
    onRender(useEditorDisplayToggles());
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(
        Provider,
        { store },
        React.createElement(Probe, { onRender: capture })
      )
    );
  });
  unmount = () => act(() => root.unmount());
  return resultRef as { current: EditorDisplayToggles };
}

describe("resolveLineNumbersToggle", () => {
  it("remembers the visible mode when turning off", () => {
    expect(resolveLineNumbersToggle("relative", false, null)).toEqual({
      next: "off",
      remember: "relative",
    });
  });

  it("restores the remembered mode, else on", () => {
    expect(resolveLineNumbersToggle("off", true, "interval")).toEqual({
      next: "interval",
      remember: "interval",
    });
    expect(resolveLineNumbersToggle("off", true, null)).toEqual({
      next: "on",
      remember: null,
    });
  });

  it("never rewrites a visible mode when enabling", () => {
    expect(resolveLineNumbersToggle("relative", true, null)).toBeNull();
    expect(resolveLineNumbersToggle("off", false, "relative")).toBeNull();
  });
});

describe("useEditorDisplayToggles", () => {
  it("round-trips relative through off without collapsing it to on", () => {
    const store = createStore();
    store.set(editorLineNumbersAtom, "relative");
    const toggles = renderToggles(store);

    expect(toggles.current.lineNumbersEnabled).toBe(true);
    act(() => toggles.current.onLineNumbersChange(false));
    expect(store.get(editorLineNumbersAtom)).toBe("off");
    expect(toggles.current.lineNumbersEnabled).toBe(false);

    act(() => toggles.current.onLineNumbersChange(true));
    expect(store.get(editorLineNumbersAtom)).toBe("relative");
    expect(toggles.current.lineNumbersEnabled).toBe(true);
  });

  it("keeps interval when the checkbox re-reports enabled", () => {
    const store = createStore();
    store.set(editorLineNumbersAtom, "interval");
    const toggles = renderToggles(store);

    act(() => toggles.current.onLineNumbersChange(true));
    expect(store.get(editorLineNumbersAtom)).toBe("interval");
  });

  it("toggles plain on/off and enables off with no memory as on", () => {
    const store = createStore();
    store.set(editorLineNumbersAtom, "off");
    const toggles = renderToggles(store);

    expect(toggles.current.lineNumbersEnabled).toBe(false);
    act(() => toggles.current.onLineNumbersChange(true));
    expect(store.get(editorLineNumbersAtom)).toBe("on");
    act(() => toggles.current.onLineNumbersChange(false));
    expect(store.get(editorLineNumbersAtom)).toBe("off");
    act(() => toggles.current.onLineNumbersChange(true));
    expect(store.get(editorLineNumbersAtom)).toBe("on");
  });

  it("keeps the remembered mode per store (session)", () => {
    const first = createStore();
    first.set(editorLineNumbersAtom, "relative");
    first.set(toggleEditorLineNumbersAtom, false);

    const second = createStore();
    second.set(editorLineNumbersAtom, "off");
    second.set(toggleEditorLineNumbersAtom, true);
    expect(second.get(editorLineNumbersAtom)).toBe("on");

    first.set(toggleEditorLineNumbersAtom, true);
    expect(first.get(editorLineNumbersAtom)).toBe("relative");
  });

  it("writes each boolean toggle to its own setting", () => {
    const store = createStore();
    const toggles = renderToggles(store);

    act(() => toggles.current.onWordWrapChange(true));
    act(() => toggles.current.onMinimapChange(true));
    act(() => toggles.current.onHighlightActiveLineChange(false));
    act(() => toggles.current.onGitBlameChange(true));
    act(() => toggles.current.onSplitCenteredLineNumbersChange(true));

    expect(store.get(editorWordWrapAtom)).toBe(true);
    expect(store.get(editorShowMinimapAtom)).toBe(true);
    expect(store.get(editorHighlightActiveLineAtom)).toBe(false);
    expect(store.get(editorShowBlameAtom)).toBe(true);
    expect(store.get(editorSplitDiffCenteredLineNumbersAtom)).toBe(true);
    expect(toggles.current).toMatchObject({
      wordWrapEnabled: true,
      minimapEnabled: true,
      highlightActiveLineEnabled: false,
      gitBlameEnabled: true,
      splitCenteredLineNumbersEnabled: true,
    });
  });
});
