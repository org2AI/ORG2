// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CodeMirrorDiff } from ".";

const settings = vi.hoisted(() => ({ centered: false }));
vi.mock("@src/hooks/settings", () => ({
  useEditorAppearanceSettings: () => ({
    lineNumbers: "on",
    wordWrap: false,
    highlightActiveLine: true,
    tabSize: 2,
    splitDiffCenteredLineNumbers: settings.centered,
  }),
}));
vi.mock("@src/services/workStation/EditorService", () => ({
  EditorService: {
    setEditorView: () => {},
    getEditorView: () => null,
    clearEditorView: () => {},
  },
}));
vi.mock("@src/components/CustomScrollbar", () => ({
  CustomScrollbar: () => null,
}));
vi.mock("../config", () => ({
  CODEMIRROR_BASE_LAYOUT_THEME: [],
  codeMirrorCspNonceExtension: [],
  customFoldGutter: () => [],
  editorHistoryKeymapExtension: () => [],
  findReplaceExtension: () => [],
  foldPlaceholderTheme: () => [],
  getCodeMirrorTheme: () => [],
  goToLineExtension: () => [],
}));
vi.mock("../shared/createCopyFileRefExtension", () => ({
  createCopyFileRefExtension: () => [],
}));
vi.mock("../shared/languageExtensions", () => ({
  getLanguageExtension: () => null,
}));

const unchanged = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => `line ${from + index}`);
const oldValue = [...unchanged(1, 40), "old", ...unchanged(42, 80)].join("\n");
const newValue = [...unchanged(1, 40), "new", ...unchanged(42, 80)].join("\n");

let root: Root;
let host: HTMLDivElement;

function render(props: { noBottomPadding?: boolean } = {}) {
  act(() =>
    root.render(
      React.createElement(CodeMirrorDiff, {
        oldValue,
        newValue,
        viewMode: "split",
        autoHeight: true,
        ...props,
      })
    )
  );
  const pane = (side: "a" | "b") =>
    host.querySelector<HTMLElement>(`.cm-editor.cm-merge-${side}`)!;
  return { a: pane("a"), b: pane("b") };
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  settings.centered = false;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

describe("CodeMirrorDiff split view", () => {
  it("keeps the split class intact when bottom padding is suppressed", () => {
    render({ noBottomPadding: true });
    // A fused class name silently disables every `--split` rule, including
    // the shared collapsed row across both panes.
    expect(
      Array.from(host.querySelector(".codemirror-diff")!.classList)
    ).toEqual([
      "codemirror-diff",
      "codemirror-diff--split",
      "codemirror-diff--no-bottom-padding",
    ]);
  });

  it("numbers each pane at its leading edge by default", () => {
    const { a, b } = render();
    for (const pane of [a, b]) {
      expect(pane.querySelector(".cm-gutters-before .cm-lineNumbers")).not.toBe(
        null
      );
      expect(pane.querySelector(".cm-gutters-after")).toBe(null);
      expect(pane.querySelector(".cm-collapseControlGutter")).toBe(null);
    }
    expect(a.querySelector(".cm-lineNumbers .cm-collapseControl")).not.toBe(
      null
    );
  });

  it("moves only the old pane's numbers between the panes when centered", () => {
    settings.centered = true;
    const { a, b } = render();
    expect(a.querySelector(".cm-gutters-after .cm-lineNumbers")).not.toBe(null);
    expect(a.querySelector(".cm-gutters-before .cm-lineNumbers")).toBe(null);
    expect(b.querySelector(".cm-gutters-before .cm-lineNumbers")).not.toBe(
      null
    );
    expect(b.querySelector(".cm-gutters-after")).toBe(null);
    // Deleted numbers keep their tint in the moved column.
    expect(
      Array.from(
        a.querySelectorAll(".cm-gutters-after .cm-diffDeletedNumber"),
        (element) => element.textContent
      )
    ).toEqual(["41"]);
    // The expansion arrows stay at the old pane's leading edge.
    expect(
      a.querySelector(
        ".cm-gutters-before .cm-collapseControlGutter .cm-collapseControl"
      )
    ).not.toBe(null);
    expect(a.querySelector(".cm-gutters-after .cm-collapseControl")).toBe(null);
  });
});
